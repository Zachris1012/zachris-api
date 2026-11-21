'use strict';

const {
  getMediaInfo,
  createDownloadJob,
  getDownloadJobStatus,
  getCompletedDownload,
} = require('../services/downloader.service');

exports.getDownloadInfo = async (req, res, next) => {
  try {
    const data = await getMediaInfo(req.body ? req.body.url : undefined);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

exports.startDownload = (req, res, next) => {
  try {
    const { url, mode } = req.body || {};
    const data = createDownloadJob(url, mode);
    res.status(202).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

exports.getDownloadStatus = (req, res, next) => {
  try {
    res.json({ success: true, data: getDownloadJobStatus(req.params.id) });
  } catch (err) {
    next(err);
  }
};

exports.downloadMediaFile = (req, res, next) => {
  try {
    const file = getCompletedDownload(req.params.id);
    const contentType = file.fileName.endsWith('.mp3') ? 'audio/mpeg' : 'video/mp4';
    res.set({ 'Content-Type': contentType, 'Cache-Control': 'private, no-store' });
    res.download(file.filePath, file.fileName, (err) => {
      if (err && !res.headersSent) next(err);
    });
  } catch (err) {
    next(err);
  }
};
