'use strict';

const crypto = require('crypto');

// Hash dulu supaya panjang buffer sama & perbandingan timing-safe
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest();

module.exports = function apiKeyAuth(req, res, next) {
  const provided = req.get('x-api-key');

  if (!provided) {
    return res.status(401).json({
      success: false,
      error: 'API key tidak ditemukan. Sertakan header x-api-key.',
    });
  }

  const valid = crypto.timingSafeEqual(sha256(provided), sha256(process.env.API_KEY));

  if (!valid) {
    return res.status(403).json({ success: false, error: 'API key tidak valid.' });
  }

  next();
};