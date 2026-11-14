'use strict';

const { execFile, spawn } = require('child_process');
const fsp = require('fs').promises;
const path = require('path');
const { randomUUID } = require('crypto');
const { TEMP_DIR, TTL_MS, scheduleDelete } = require('./cleanup.service');

const TIMEOUT_MS = (parseInt(process.env.YTDLP_TIMEOUT_SECONDS, 10) || 25) * 1000;
const DOWNLOAD_TIMEOUT_MS = (parseInt(process.env.YTDLP_DOWNLOAD_TIMEOUT_SECONDS, 10) || 600) * 1000;
const MAX_CONCURRENT = parseInt(process.env.YTDLP_MAX_CONCURRENT, 10) || 2;
const MAX_DOWNLOAD_CONCURRENT = parseInt(process.env.YTDLP_DOWNLOAD_MAX_CONCURRENT, 10) || 1;
const MAX_BUFFER = 30 * 1024 * 1024; // JSON -J bisa besar untuk video panjang
const MAX_URL_LENGTH = 2048;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

const PLATFORMS = {
  youtube: ['youtube.com', 'youtu.be'],
  tiktok: ['tiktok.com'],
  instagram: ['instagram.com', 'instagr.am'],
  twitter: ['twitter.com', 'x.com', 't.co'],
  facebook: ['facebook.com', 'fb.watch', 'fb.com'],
};

const FORWARDED_HEADERS = ['User-Agent', 'Referer', 'Cookie'];

let running = 0;
let downloadRunning = 0;
const downloadJobs = new Map();

/* ---------- Error helper ---------- */

function createError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true; // pesan aman ditampilkan ke client
  return err;
}

/* ---------- Validasi URL ---------- */

function parseAndValidateUrl(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw createError(400, 'Field "url" wajib diisi.');
  }

  const raw = input.trim();
  if (raw.length > MAX_URL_LENGTH) {
    throw createError(400, 'URL terlalu panjang.');
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw createError(400, 'Format URL tidak valid.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw createError(400, 'Hanya URL http/https yang diterima.');
  }
  if (parsed.username || parsed.password) {
    throw createError(400, 'URL tidak boleh mengandung kredensial.');
  }

  const host = parsed.hostname.toLowerCase();
  const platform = Object.keys(PLATFORMS).find((name) =>
    PLATFORMS[name].some((d) => host === d || host.endsWith(`.${d}`))
  );

  if (!platform) {
    throw createError(
      400,
      `Platform tidak didukung. Yang didukung: ${Object.keys(PLATFORMS).join(', ')}.`
    );
  }

  return { url: parsed.href, platform };
}

/* ---------- Eksekusi yt-dlp ---------- */

function mapExecError(err, stderr) {
  if (err.code === 'ENOENT') {
    return createError(503, 'yt-dlp tidak ditemukan di server. Install: pkg install yt-dlp');
  }
  if (err.killed) {
    return createError(
      504,
      `Waktu habis (${(err.timeoutMs || TIMEOUT_MS) / 1000} detik). Koneksi lambat atau sumber tidak merespons.`
    );
  }
  if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return createError(502, 'Respons metadata terlalu besar.');
  }

  const msg = String(stderr || '');
  console.error('[YT-DLP]', msg.trim().split('\n').pop() || err.message);

  if (/ffmpeg not found|ffprobe.*not found/i.test(msg)) {
    return createError(503, 'FFmpeg tidak ditemukan di server. Install: pkg install ffmpeg');
  }
  if (/http error 403|403 forbidden|access denied/i.test(msg)) {
    return createError(502, 'Sumber menolak akses atau CDN membatasi request. Coba lagi nanti atau periksa akses URL.');
  }
  if (/unsupported url/i.test(msg)) {
    return createError(422, 'URL ini tidak berisi media yang bisa diunduh.');
  }
  if (/private|log ?in|sign in|cookies|authenticat|confirm your age|age[- ]restrict/i.test(msg)) {
    return createError(422, 'Konten privat, dibatasi umur, atau memerlukan login.');
  }
  if (/not available|unavailable|removed|deleted|does not exist|404/i.test(msg)) {
    return createError(404, 'Konten tidak tersedia atau sudah dihapus.');
  }
  return createError(502, 'Gagal mengambil data dari sumber.');
}

function buildInfoArgs(url, cookies = process.env.YTDLP_COOKIES) {
  const args = [
    '-J', '--no-playlist', '--no-warnings', '--socket-timeout', '10',
    '--retries', '3', '--fragment-retries', '3',
    '--user-agent', USER_AGENT, '--referer', url, '--force-ipv4',
    '--format-sort', 'lang,quality,res,fps', '--format-sort-force',
  ];
  if (cookies) args.push('--cookies', cookies);
  args.push('--', url);
  return args;
}

function buildDownloadArgs(url, outputTemplate, cookies = process.env.YTDLP_COOKIES) {
  const args = [
    '--no-playlist', '--no-warnings', '--newline', '--socket-timeout', '20',
    '--retries', '3', '--fragment-retries', '3', '--retry-sleep', 'http:exp=1:4',
    '--user-agent', USER_AGENT, '--referer', url, '--force-ipv4',
    '--format-sort', 'lang,quality,res,fps', '--format-sort-force',
    '--format', 'bestvideo+bestaudio/best',
    '--merge-output-format', 'mp4', '--remux-video', 'mp4',
    '--output', outputTemplate,
  ];
  if (cookies) args.push('--cookies', cookies);
  args.push('--', url);
  return args;
}

function runYtDlp(url) {
  if (running >= MAX_CONCURRENT) {
    return Promise.reject(createError(429, 'Server sedang sibuk, coba lagi sebentar.'));
  }
  running += 1;

  const args = buildInfoArgs(url);

  return new Promise((resolve, reject) => {
    execFile(
      'yt-dlp',
      args,
      { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, killSignal: 'SIGKILL' },
      (err, stdout, stderr) => {
        running -= 1;
        if (err) return reject(mapExecError(err, stderr));
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(createError(502, 'Output yt-dlp tidak dapat dibaca.'));
        }
      }
    );
  });
}

function publicDownloadJob(job) {
  return {
    id: job.id,
    status: job.status,
    percent: job.percent,
    downloadedBytes: job.downloadedBytes,
    totalBytes: job.totalBytes,
    error: job.error,
    expiresInSeconds: job.status === 'complete' ? Math.ceil(TTL_MS / 1000) : null,
  };
}

function scheduleJobExpiry(id) {
  const timer = setTimeout(() => downloadJobs.delete(id), TTL_MS);
  timer.unref();
}

async function removeDownloadArtifacts(id) {
  const prefix = `media-${id}.`;
  try {
    const files = await fsp.readdir(TEMP_DIR);
    await Promise.all(
      files.filter((name) => name.startsWith(prefix)).map((name) => fsp.unlink(path.join(TEMP_DIR, name)).catch(() => {}))
    );
  } catch {}
}

function createDownloadJob(rawUrl) {
  const { url } = parseAndValidateUrl(rawUrl);
  if (downloadRunning >= MAX_DOWNLOAD_CONCURRENT) {
    throw createError(429, 'Server sedang mengunduh media lain, coba lagi sebentar.');
  }

  const id = randomUUID();
  const outputTemplate = path.join(TEMP_DIR, `media-${id}.%(ext)s`);
  const outputPath = path.join(TEMP_DIR, `media-${id}.mp4`);
  const job = {
    id,
    status: 'downloading',
    percent: null,
    downloadedBytes: null,
    totalBytes: null,
    error: null,
    filePath: outputPath,
    fileName: `zachris-api-${id}.mp4`,
    createdAt: Date.now(),
  };
  downloadJobs.set(id, job);
  downloadRunning += 1;

  const args = buildDownloadArgs(url, outputTemplate);
  let child;
  try {
    child = spawn('yt-dlp', args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    downloadRunning -= 1;
    job.status = 'error';
    job.error = mapExecError(err, '').message;
    scheduleJobExpiry(id);
    return publicDownloadJob(job);
  }

  let stderr = '';
  let settled = false;
  const timeout = setTimeout(() => {
    job.timedOut = true;
    child.kill('SIGKILL');
  }, DOWNLOAD_TIMEOUT_MS);
  timeout.unref();

  const finish = () => {
    if (settled) return false;
    settled = true;
    clearTimeout(timeout);
    downloadRunning -= 1;
    job.finishedAt = Date.now();
    scheduleJobExpiry(id);
    return true;
  };

  const fail = async (err) => {
    if (!finish()) return;
    if (job.timedOut) err.killed = true;
    err.timeoutMs = DOWNLOAD_TIMEOUT_MS;
    job.status = 'error';
    job.error = mapExecError(err, stderr).message;
    await removeDownloadArtifacts(id);
  };

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderr = (stderr + text).slice(-12000);
    if (/\[Merger\]|Merging formats|\[VideoRemuxer\]|Remuxing/i.test(text)) job.status = 'merging';
    for (const match of text.matchAll(/\[download\]\s+(\d+(?:\.\d+)?)%/g)) {
      job.percent = Math.max(0, Math.min(100, Number(match[1])));
    }
  });

  child.on('error', (err) => fail(err));
  child.on('close', async (code, signal) => {
    if (settled) return;
    if (code !== 0) {
      const err = new Error(`yt-dlp exited with ${signal || `code ${code}`}`);
      err.code = 'YTDLP_EXIT';
      return fail(err);
    }
    try {
      const stat = await fsp.stat(outputPath);
      if (!stat.isFile()) throw new Error('Hasil unduhan bukan file.');
      if (!finish()) return;
      job.status = 'complete';
      job.percent = 100;
      job.size = stat.size;
      scheduleDelete(outputPath);
    } catch (err) {
      await fail(err);
    }
  });

  return publicDownloadJob(job);
}

function getDownloadJobStatus(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id || '')) throw createError(404, 'Unduhan tidak ditemukan atau sudah kedaluwarsa.');
  const job = downloadJobs.get(id);
  if (!job) throw createError(404, 'Unduhan tidak ditemukan atau sudah kedaluwarsa.');
  return publicDownloadJob(job);
}

function getCompletedDownload(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id || '')) throw createError(404, 'Unduhan tidak ditemukan atau sudah kedaluwarsa.');
  const job = downloadJobs.get(id);
  if (!job) throw createError(404, 'Unduhan tidak ditemukan atau sudah kedaluwarsa.');
  if (job.status !== 'complete') {
    throw createError(job.status === 'error' ? 422 : 409, job.error || 'Unduhan masih diproses.');
  }
  return { filePath: job.filePath, fileName: job.fileName, size: job.size };
}

/* ---------- Filter & format output ---------- */

const isDirect = (f) => f.protocol === 'https' || f.protocol === 'http';
const isStream = (f) => /^m3u8/.test(f.protocol || '');
const hasVideoTrack = (f) => f.vcodec !== 'none' && !!(f.vcodec || f.height || f.width);
const hasAudioTrack = (f) => f.acodec !== 'none';
const isAudioOnly = (f) => f.vcodec === 'none' && f.acodec !== 'none';

const videoScore = (f) => (f.ext === 'mp4' ? 1e6 : 0) + (f.tbr || 0);
const audioScore = (f) => (f.ext === 'm4a' ? 1e6 : 0) + (f.abr || f.tbr || 0);

// Ambil format terbaik per kunci (mis. per resolusi / per ekstensi)
function bestBy(list, keyFn, scoreFn) {
  const map = new Map();
  for (const f of list) {
    const key = keyFn(f);
    const cur = map.get(key);
    if (!cur || scoreFn(f) > scoreFn(cur)) map.set(key, f);
  }
  return [...map.values()];
}

function pickHeaders(headers) {
  if (!headers) return undefined;
  const out = {};
  for (const name of FORWARDED_HEADERS) {
    if (headers[name]) out[name] = headers[name];
  }
  return Object.keys(out).length ? out : undefined;
}

function toVideoItem(f, withAudio) {
  return {
    quality: f.height ? `${f.height}p` : f.format_note || 'default',
    ext: f.ext,
    width: f.width || null,
    height: f.height || null,
    fps: f.fps || null,
    filesize: f.filesize || f.filesize_approx || null,
    hasAudio: withAudio,
    protocol: f.protocol,
    url: f.url,
    headers: pickHeaders(f.http_headers),
  };
}

function toAudioItem(f) {
  const bitrate = f.abr || f.tbr || null;
  return {
    quality: bitrate ? `${Math.round(bitrate)}kbps` : 'default',
    ext: f.ext,
    bitrate: bitrate ? Math.round(bitrate) : null,
    filesize: f.filesize || f.filesize_approx || null,
    protocol: f.protocol,
    url: f.url,
    headers: pickHeaders(f.http_headers),
  };
}

function buildOptions(info) {
  const all =
    Array.isArray(info.formats) && info.formats.length ? info.formats : info.url ? [info] : [];
  const usable = all.filter((f) => f.url && f.ext !== 'mhtml'); // buang storyboard

  // 1) Video + audio sekaligus (prioritas: direct http, fallback m3u8)
  const combined = usable.filter((f) => hasVideoTrack(f) && hasAudioTrack(f));
  let pool = combined.filter(isDirect);
  if (!pool.length) pool = combined.filter(isStream);

  const video = bestBy(pool, (f) => f.height || 0, videoScore)
    .sort((a, b) => (b.height || 0) - (a.height || 0))
    .slice(0, 4)
    .map((f) => toVideoItem(f, true));

  // 2) Video tanpa audio, hanya yang resolusinya lebih tinggi dari opsi di atas
  const maxCombined = video.length ? video[0].height || 0 : 0;
  const videoOnly = bestBy(
    usable.filter((f) => hasVideoTrack(f) && f.acodec === 'none' && isDirect(f)),
    (f) => f.height || 0,
    videoScore
  )
    .filter((f) => (f.height || 0) > maxCombined)
    .sort((a, b) => (b.height || 0) - (a.height || 0))
    .slice(0, 3)
    .map((f) => toVideoItem(f, false));

  // 3) Audio saja: terbaik per ekstensi (m4a diutamakan)
  const audio = bestBy(usable.filter((f) => isAudioOnly(f) && isDirect(f)), (f) => f.ext, audioScore)
    .sort((a, b) => audioScore(b) - audioScore(a))
    .slice(0, 2)
    .map(toAudioItem);

  return { video, videoOnly, audio };
}

function formatDuration(sec) {
  if (!sec || sec < 0) return null;
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

function pickThumbnail(info) {
  if (info.thumbnail) return info.thumbnail;
  if (Array.isArray(info.thumbnails) && info.thumbnails.length) {
    return info.thumbnails[info.thumbnails.length - 1].url || null;
  }
  return null;
}

/* ---------- API publik service ---------- */

async function getMediaInfo(rawUrl) {
  const { url, platform } = parseAndValidateUrl(rawUrl);
  let info = await runYtDlp(url);

  // Beberapa post (carousel IG / tweet multi-video) dikembalikan sebagai playlist
  let itemCount = 1;
  if (info._type === 'playlist') {
    const entries = (info.entries || []).filter(Boolean);
    if (!entries.length) throw createError(404, 'Tidak ada media ditemukan pada URL ini.');
    itemCount = entries.length;
    info = { ...entries[0], webpage_url: info.webpage_url || entries[0].webpage_url };
  }

  const options = buildOptions(info);
  if (!options.video.length && !options.videoOnly.length && !options.audio.length) {
    throw createError(422, 'Tidak ada format yang bisa diunduh langsung dari URL ini.');
  }

  return {
    platform,
    id: info.id || null,
    title: info.title || info.fulltitle || null,
    uploader: info.uploader || info.channel || null,
    duration: info.duration ? Math.round(info.duration) : null,
    durationText: formatDuration(info.duration),
    thumbnail: pickThumbnail(info),
    webpageUrl: info.webpage_url || url,
    itemCount,
    ...options,
  };
}

module.exports = {
  getMediaInfo,
  parseAndValidateUrl,
  buildInfoArgs,
  buildDownloadArgs,
  createDownloadJob,
  getDownloadJobStatus,
  getCompletedDownload,
};