'use strict';

const os = require('os');
const fsp = require('fs').promises;
const { execFile } = require('child_process');
const { TEMP_DIR, TTL_MS } = require('../services/cleanup.service');

let ytdlpVersionCache = null;

function getYtDlpVersion() {
  if (ytdlpVersionCache) return Promise.resolve(ytdlpVersionCache);

  return new Promise((resolve) => {
    execFile('yt-dlp', ['--version'], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null); // tidak di-cache, supaya bisa terdeteksi setelah install
      ytdlpVersionCache = stdout.trim();
      resolve(ytdlpVersionCache);
    });
  });
}

function getSharpInfo() {
  try {
    const sharp = require('sharp');
    return { available: true, version: sharp.versions.sharp, libvips: sharp.versions.vips };
  } catch (err) {
    return { available: false, error: err.message.split('\n')[0] };
  }
}

async function countTempFiles() {
  try {
    const files = await fsp.readdir(TEMP_DIR);
    return files.filter((f) => f !== '.gitkeep').length;
  } catch {
    return 0;
  }
}

exports.getStatus = async (req, res, next) => {
  try {
    const [ytdlp, tempFiles] = await Promise.all([getYtDlpVersion(), countTempFiles()]);
    const mem = process.memoryUsage();

    res.json({
      success: true,
      status: 'online',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      memory: {
        rssMB: +(mem.rss / 1048576).toFixed(1),
        heapUsedMB: +(mem.heapUsed / 1048576).toFixed(1),
        systemFreeMB: +(os.freemem() / 1048576).toFixed(0),
      },
      dependencies: {
        sharp: getSharpInfo(),
        ytdlp: { available: !!ytdlp, version: ytdlp },
      },
      temp: {
        files: tempFiles,
        ttlMinutes: TTL_MS / 60000,
      },
    });
  } catch (err) {
    next(err);
  }
};