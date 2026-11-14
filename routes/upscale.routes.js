'use strict';

const express = require('express');
const multer = require('multer');
const { randomUUID } = require('crypto');
const { TEMP_DIR } = require('../services/cleanup.service');
const { createError } = require('../services/upscaler.service');
const { upscale, downloadResult } = require('../controllers/upscale.controller');

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB
const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, TEMP_DIR),
    filename: (req, file, cb) => cb(null, `in-${randomUUID()}${EXT_BY_MIME[file.mimetype]}`),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 },
  fileFilter: (req, file, cb) => {
    if (EXT_BY_MIME[file.mimetype]) return cb(null, true);
    cb(createError(415, 'Hanya file gambar JPEG, PNG, atau WebP yang diterima.'));
  },
});

const router = express.Router();

router.post('/', upload.single('image'), upscale);
router.get('/result/:filename', downloadResult);

module.exports = router;