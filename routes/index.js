'use strict';

const express = require('express');
const apiKeyAuth = require('../middlewares/apiKeyAuth');

const router = express.Router();

// Endpoint publik (tidak perlu API key)
router.use('/keys', require('./keys.routes'));

// Semua endpoint di bawah /api wajib x-api-key
router.use(apiKeyAuth);

router.use('/status', require('./status.routes'));
router.use('/download', require('./download.routes'));
router.use('/upscale', require('./upscale.routes'));

module.exports = router;