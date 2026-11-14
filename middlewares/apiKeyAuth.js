'use strict';

const crypto = require('crypto');
const path = require('path');
const { createApiKeyStore } = require('../services/api-key-store.service');

const KEYS_FILE = process.env.API_KEYS_FILE || path.join(__dirname, '..', 'temp', 'api-keys.json');
const store = createApiKeyStore(KEYS_FILE);

// Hash dulu supaya panjang buffer sama & perbandingan timing-safe
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest();

module.exports = async function apiKeyAuth(req, res, next) {
  const provided = req.get('x-api-key');

  if (!provided) {
    return res.status(401).json({
      success: false,
      error: 'API key tidak ditemukan. Sertakan header x-api-key.',
    });
  }

  try {
    // 1. Cek master key (env API_KEY) dulu
    if (process.env.API_KEY) {
      const valid = crypto.timingSafeEqual(sha256(provided), sha256(process.env.API_KEY));
      if (valid) return next();
    }

    // 2. Cek generated keys dari store
    const validFromStore = await store.isValidApiKey(provided);
    if (validFromStore) return next();

    return res.status(403).json({ success: false, error: 'API key tidak valid.' });
  } catch {
    return res.status(403).json({ success: false, error: 'API key tidak valid.' });
  }
};