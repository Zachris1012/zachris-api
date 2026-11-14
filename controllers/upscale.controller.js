'use strict';

const fsp = require('fs').promises;
const path = require('path');
const { TEMP_DIR, TTL_MS, scheduleDelete } = require('../services/cleanup.service');
const { upscaleImage, parseScale, createError } = require('../services/upscaler.service');

const RESULT_NAME_REGEX = /^out-[0-9a-f-]{36}\.(jpg|png|webp)$/;

function safeBaseName(originalName = 'image') {
  const base = path.parse(originalName).name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
  return base || 'image';
}

exports.upscale = async (req, res, next) => {
  const file = req.file;

  try {
    if (!file) {
      throw createError(
        400,
        'File gambar wajib diunggah pada field "image" (multipart/form-data).'
      );
    }
    scheduleDelete(file.path); // jaring pengaman untuk file input

    const scale = parseScale(req.query.scale ?? (req.body && req.body.scale));
    const mode = String(req.query.mode || 'binary').toLowerCase();
    if (!['binary', 'json'].includes(mode)) {
      throw createError(400, 'Parameter mode harus "binary" atau "json".');
    }

    const result = await upscaleImage({
      inputPath: file.path,
      inputSize: file.size,
      scale,
    });

    if (mode === 'json') {
      const urlPath = `${req.baseUrl}/result/${result.outputName}`;
      return res.json({
        success: true,
        data: {
          original: result.original,
          result: { ...result.result, mime: result.mime },
          scale: result.scale,
          processingMs: result.processingMs,
          file: {
            name: result.outputName,
            path: urlPath,
            url: `${req.protocol}://${req.get('host')}${urlPath}`,
            expiresInSeconds: TTL_MS / 1000,
            expiresAt: new Date(Date.now() + TTL_MS).toISOString(),
            note: 'Unduh dengan header x-api-key yang sama.',
          },
        },
      });
    }

    // Mode binary: kirim file langsung
    const downloadName = `${safeBaseName(file.originalname)}-${result.scale.applied}x.${
      result.outputName.split('.').pop()
    }`;

    res.set({
      'Content-Type': result.mime,
      'X-Original-Size': `${result.original.width}x${result.original.height}`,
      'X-Result-Size': `${result.result.width}x${result.result.height}`,
      'X-Scale-Applied': String(result.scale.applied),
      'Access-Control-Expose-Headers': 'X-Original-Size, X-Result-Size, X-Scale-Applied',
      'Cache-Control': 'private, no-store',
    });

    res.download(result.outputPath, downloadName, (err) => {
      if (err && !res.headersSent) next(err);
    });
  } catch (err) {
    next(err);
  } finally {
    // File input tidak diperlukan lagi setelah diproses
    if (file) fsp.unlink(file.path).catch(() => {});
  }
};

exports.downloadResult = (req, res, next) => {
  const { filename } = req.params;

  if (!RESULT_NAME_REGEX.test(filename)) {
    return next(createError(404, 'File tidak ditemukan atau sudah kedaluwarsa.'));
  }

  res.sendFile(
    filename,
    { root: TEMP_DIR, dotfiles: 'deny', headers: { 'Cache-Control': 'private, no-store' } },
    (err) => {
      if (!err || res.headersSent) return;
      if (err.code === 'ENOENT' || err.status === 404) {
        return next(createError(404, 'File tidak ditemukan atau sudah kedaluwarsa.'));
      }
      next(err);
    }
  );
};