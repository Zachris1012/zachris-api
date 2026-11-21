'use strict';

const crypto = require('crypto');
const fsp = require('fs').promises;
const path = require('path');

const KEY_PREFIX = 'zapi-';
const KEY_ENTROPY_BYTES = 32; // 64 hex chars

function sha256hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function generateRawKey() {
  return KEY_PREFIX + crypto.randomBytes(KEY_ENTROPY_BYTES).toString('hex');
}

const storesByPath = new Map();

function createApiKeyStore(storePath) {
  const resolvedPath = path.resolve(storePath);
  if (storesByPath.has(resolvedPath)) {
    return storesByPath.get(resolvedPath);
  }

  let cache = null; // { keys: [{ hash, createdAt }] }
  let writeQueue = Promise.resolve(); // serialize concurrent writes

  async function load() {
    if (cache) return cache;
    try {
      const raw = await fsp.readFile(storePath, 'utf8');
      cache = JSON.parse(raw);
      if (!Array.isArray(cache.keys)) cache = { keys: [] };
    } catch {
      cache = { keys: [] };
    }
    return cache;
  }

  async function persist() {
    await fsp.mkdir(path.dirname(storePath), { recursive: true });
    await fsp.writeFile(storePath, JSON.stringify(cache, null, 2), 'utf8');
  }

  async function generateApiKey() {
    const apiKey = generateRawKey();
    const hash = sha256hex(apiKey);
    // Serialize: each call waits for the previous write to finish
    writeQueue = writeQueue.then(async () => {
      const data = await load();
      data.keys.push({ hash, createdAt: new Date().toISOString() });
      await persist();
    });
    await writeQueue;
    return { apiKey };
  }

  async function isValidApiKey(provided, masterKey = process.env.API_KEY) {
    if (!provided) return false;
    // Check master key first (timing-safe)
    if (masterKey) {
      const eq = crypto.timingSafeEqual(
        Buffer.from(sha256hex(provided), 'hex'),
        Buffer.from(sha256hex(masterKey), 'hex')
      );
      if (eq) return true;
    }
    const data = await load();
    const hash = sha256hex(provided);
    return data.keys.some((entry) => {
      try {
        return crypto.timingSafeEqual(
          Buffer.from(entry.hash, 'hex'),
          Buffer.from(hash, 'hex')
        );
      } catch {
        return false;
      }
    });
  }

  const instance = { generateApiKey, isValidApiKey };
  storesByPath.set(resolvedPath, instance);
  return instance;
}

module.exports = { createApiKeyStore };
