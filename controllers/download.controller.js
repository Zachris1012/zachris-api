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
    const data = createDownloadJob(req.body ? req.body.url : undefined);
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
    res.set({ 'Content-Type': 'video/mp4', 'Cache-Control': 'private, no-store' });
    res.download(file.filePath, file.fileName, (err) => {
      if (err && !res.headersSent) next(err);
    });
  } catch (err) {
    next(err);
  }
};
