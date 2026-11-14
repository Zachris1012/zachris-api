'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const TEMP_DIR = path.join(__dirname, '..', 'temp');
const TTL_MS = (parseInt(process.env.TEMP_TTL_MINUTES, 10) || 3) * 60 * 1000;
const SWEEP_INTERVAL_MS = 30 * 1000;
const IGNORED = new Set(['.gitkeep']);

/**
 * Jadwalkan penghapusan satu file setelah TTL.
 * Panggil ini setiap kali selesai membuat file di temp/.
 */
function scheduleDelete(filePath, ttl = TTL_MS) {
  const timer = setTimeout(() => {
    fsp.unlink(filePath).catch((err) => {
      if (err.code !== 'ENOENT') console.error('[CLEANUP] Gagal hapus:', filePath, err.message);
    });
  }, ttl);
  timer.unref(); // jangan menahan proses saat shutdown
}

/**
 * Sapu folder temp/: hapus semua file yang lebih tua dari TTL.
 * Jaring pengaman jika server restart (timer hilang) atau ada file yatim.
 */
async function sweep() {
  try {
    const entries = await fsp.readdir(TEMP_DIR);
    const now = Date.now();

    await Promise.all(
      entries
        .filter((name) => !IGNORED.has(name))
        .map(async (name) => {
          const full = path.join(TEMP_DIR, name);
          try {
            const stat = await fsp.stat(full);
            if (now - stat.mtimeMs > TTL_MS) {
              await fsp.rm(full, { recursive: true, force: true });
              console.log('[CLEANUP] Dihapus:', name);
            }
          } catch (err) {
            if (err.code !== 'ENOENT') console.error('[CLEANUP]', name, err.message);
          }
        })
    );
  } catch (err) {
    console.error('[CLEANUP] Sweep gagal:', err.message);
  }
}

function startCleanup() {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  sweep();
  setInterval(sweep, SWEEP_INTERVAL_MS).unref();
  console.log(`[OK] Auto-cleanup aktif (TTL ${TTL_MS / 60000} menit)`);
}

module.exports = { TEMP_DIR, TTL_MS, scheduleDelete, sweep, startCleanup };