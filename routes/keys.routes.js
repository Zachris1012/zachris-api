'use strict';

const express = require('express');
const path = require('path');
const { createApiKeyStore } = require('../services/api-key-store.service');

const router = express.Router();

const KEYS_FILE = process.env.API_KEYS_FILE || path.join(__dirname, '..', 'temp', 'api-keys.json');
const store = createApiKeyStore(KEYS_FILE);

// In-memory rate limiter: max 5 successful generate requests per IP per hour
const rateLimitMap = new Map();
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT = 5;

function checkRateLimit(ip) {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    rateLimitMap.set(ip, entry);
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count += 1;
  return true;
}

// POST /api/keys/generate — public, rate-limited
router.post('/generate', async (req, res, next) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    if (!checkRateLimit(ip)) {
      return res.status(429).json({
        success: false,
        error: 'Terlalu banyak permintaan. Coba lagi nanti.',
      });
    }
    const { apiKey } = await store.generateApiKey();
    return res.status(201).json({ success: true, data: { apiKey } });
  } catch (err) {
    return next(err);
  }
});

// Export store so apiKeyAuth middleware can reference the same instance
router.store = store;

module.exports = router;
