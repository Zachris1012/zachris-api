'use strict';

const fsp = require('fs').promises;
const path = require('path');
const { randomUUID } = require('crypto');
const { execFile } = require('child_process');
const { TEMP_DIR, scheduleDelete } = require('./cleanup.service');

let sharp = null;
try {
  sharp = require('sharp');
  // Hemat RAM di perangkat mobile
  sharp.cache(false);
  sharp.concurrency(parseInt(process.env.SHARP_CONCURRENCY, 10) || 2);
} catch {
  sharp = null;
}

function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

async function probeImageWithFfprobe(inputPath) {
  const { stdout } = await runCommand('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,codec_name',
    '-of', 'json',
    inputPath,
  ]);
  const parsed = JSON.parse(stdout || '{}');
  const stream = parsed.streams?.[0];
  if (!stream?.width || !stream?.height) throw new Error('Dimensi gambar tidak terbaca.');

  const codecToFormat = { mjpeg: 'jpeg', png: 'png', webp: 'webp' };
  const format = codecToFormat[stream.codec_name];
  if (!format) throw createError(415, 'Format gambar tidak didukung. Gunakan JPEG, PNG, atau WebP.');

  return { width: Number(stream.width), height: Number(stream.height), format };
}

const MAX_OUTPUT_DIMENSION = parseInt(process.env.UPSCALE_MAX_DIMENSION, 10) || 4096;
const MAX_INPUT_PIXELS = 25_000_000; // ~5000x5000
const MAX_CONCURRENT = parseInt(process.env.UPSCALE_MAX_CONCURRENT, 10) || 1;
const ALLOWED_SCALES = [2, 4];

const FORMATS = {
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  png: { ext: 'png', mime: 'image/png' },
  webp: { ext: 'webp', mime: 'image/webp' },
};

let active = 0;

function createError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

function parseScale(raw) {
  if (raw === undefined || raw === null || raw === '') return 2;
  const n = Number(raw);
  if (!ALLOWED_SCALES.includes(n)) {
    throw createError(400, `Parameter scale harus salah satu dari: ${ALLOWED_SCALES.join(', ')}.`);
  }
  return n;
}

// Penajaman dibuat ringan agar 4x tidak menimbulkan halo di tepi objek.
function getUpscaleConfig(scale) {
  return {
    kernel: sharp ? sharp.kernel.lanczos3 : 'lanczos3',
    sharpen: { sigma: scale >= 4 ? 0.7 : 0.6, m1: 0.5, m2: 1.2 },
  };
}

/**
 * Upscale gambar dari file di disk (Sharp jika tersedia, fallback ke FFmpeg Lanczos).
 * Hasil disimpan di temp/ dan otomatis dijadwalkan untuk dihapus.
 */
async function upscaleImage({ inputPath, inputSize = null, scale = 2 }) {
  if (active >= MAX_CONCURRENT) {
    throw createError(429, 'Server sedang memproses gambar lain, coba lagi sebentar.');
  }
  active += 1;

  const started = Date.now();
  let outputPath;

  try {
    // 1) Baca metadata gambar
    let srcW;
    let srcH;
    let format;

    if (sharp) {
      let meta;
      try {
        meta = await sharp(inputPath, { limitInputPixels: false }).metadata();
      } catch {
        throw createError(422, 'File bukan gambar yang valid atau rusak.');
      }
      format = meta.format;
      const swap = meta.orientation >= 5;
      srcW = swap ? meta.height : meta.width;
      srcH = swap ? meta.width : meta.height;
    } else {
      try {
        const probed = await probeImageWithFfprobe(inputPath);
        srcW = probed.width;
        srcH = probed.height;
        format = probed.format;
      } catch (err) {
        if (err.expose) throw err;
        throw createError(422, 'File bukan gambar yang valid atau rusak.');
      }
    }

    const fmt = FORMATS[format];
    if (!fmt) {
      throw createError(415, 'Format gambar tidak didukung. Gunakan JPEG, PNG, atau WebP.');
    }
    if (!srcW || !srcH) throw createError(422, 'Dimensi gambar tidak terbaca.');

    if (srcW * srcH > MAX_INPUT_PIXELS) {
      throw createError(
        422,
        `Resolusi gambar terlalu besar (maksimal ${MAX_INPUT_PIXELS / 1e6} megapiksel).`
      );
    }

    // 2) Hitung faktor efektif dengan batas dimensi output
    const maxFactor = MAX_OUTPUT_DIMENSION / Math.max(srcW, srcH);
    if (maxFactor <= 1) {
      throw createError(
        422,
        `Gambar sudah berukuran ${srcW}x${srcH}, mencapai batas ${MAX_OUTPUT_DIMENSION}px sehingga tidak dapat di-upscale.`
      );
    }
    const factor = Math.min(scale, maxFactor);
    const targetW = Math.min(MAX_OUTPUT_DIMENSION, Math.max(1, Math.round(srcW * factor)));
    const targetH = Math.min(MAX_OUTPUT_DIMENSION, Math.max(1, Math.round(srcH * factor)));

    // 3) Pipeline: Sharp (PC) atau FFmpeg Lanczos + unsharp (Termux ARM64)
    const outputName = `out-${randomUUID()}.${fmt.ext}`;
    outputPath = path.join(TEMP_DIR, outputName);

    let resultInfo;
    if (sharp) {
      const upscaleConfig = getUpscaleConfig(scale);
      const pipeline = sharp(inputPath, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
        .rotate()
        .resize({
          width: targetW,
          height: targetH,
          fit: 'fill',
          kernel: upscaleConfig.kernel,
        })
        .sharpen(upscaleConfig.sharpen);

      if (format === 'jpeg') pipeline.jpeg({ quality: 92 });
      else if (format === 'png') pipeline.png({ compressionLevel: 6 });
      else pipeline.webp({ quality: 92 });

      resultInfo = await pipeline.toFile(outputPath);
    } else {
      const sharpAmount = scale >= 4 ? '0.45' : '0.35';
      const vf = `scale=${targetW}:${targetH}:flags=lanczos,unsharp=3:3:${sharpAmount}:3:3:0.0`;
      const ffArgs = ['-y', '-i', inputPath, '-vf', vf];

      if (format === 'jpeg') ffArgs.push('-q:v', '2');
      else if (format === 'webp') ffArgs.push('-quality', '92');

      ffArgs.push(outputPath);
      await runCommand('ffmpeg', ffArgs);

      const stat = await fsp.stat(outputPath);
      resultInfo = { width: targetW, height: targetH, size: stat.size, format };
    }

    scheduleDelete(outputPath);

    return {
      outputPath,
      outputName,
      mime: fmt.mime,
      original: { width: srcW, height: srcH, size: inputSize, format },
      result: {
        width: resultInfo.width,
        height: resultInfo.height,
        size: resultInfo.size,
        format: resultInfo.format,
      },
      scale: { requested: scale, applied: +factor.toFixed(2), clamped: factor < scale },
      processingMs: Date.now() - started,
    };
  } catch (err) {
    if (outputPath) fsp.unlink(outputPath).catch(() => {});
    if (err.expose) throw err;
    if (/vips|corrupt|invalid|unsupported|premature|header/i.test(err.message || '')) {
      throw createError(422, 'Gambar rusak atau tidak dapat diproses.');
    }
    throw err;
  } finally {
    active -= 1;
  }
}

module.exports = { upscaleImage, parseScale, createError, getUpscaleConfig };