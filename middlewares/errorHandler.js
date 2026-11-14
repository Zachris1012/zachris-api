'use strict';

const multer = require('multer');

const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: 'Ukuran file terlalu besar (maksimal 10MB).',
  LIMIT_UNEXPECTED_FILE: 'Unggah satu file saja pada field "image".',
  LIMIT_FILE_COUNT: 'Hanya satu file yang diperbolehkan.',
  LIMIT_FIELD_COUNT: 'Terlalu banyak field pada form.',
};

// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'Body JSON tidak valid.' });
  }

  // Error dari multer (ukuran, jumlah file, field tak terduga, dll.)
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      error: MULTER_MESSAGES[err.code] || err.message,
      code: err.code,
    });
  }

  // Body multipart rusak / boundary hilang
  if (!err.status && /multipart|boundary|unexpected end of form/i.test(err.message || '')) {
    return res
      .status(400)
      .json({ success: false, error: 'Format multipart/form-data tidak valid.' });
  }

  const status = err.status || err.statusCode || 500;
  const expose = status < 500 || err.expose === true;

  if (!expose) console.error('[ERROR]', err);

  res.status(status).json({
    success: false,
    error: expose ? err.message : 'Terjadi kesalahan pada server.',
  });
};