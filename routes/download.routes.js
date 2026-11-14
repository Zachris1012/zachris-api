'use strict';

const express = require('express');
const {
  getDownloadInfo,
  startDownload,
  getDownloadStatus,
  downloadMediaFile,
} = require('../controllers/download.controller');

const router = express.Router();

router.post('/jobs', startDownload);
router.get('/jobs/:id', getDownloadStatus);
router.get('/jobs/:id/file', downloadMediaFile);
router.post('/', getDownloadInfo);

module.exports = router;
