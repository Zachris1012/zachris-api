'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { TEMP_DIR } = require('../services/cleanup.service');
const { upscaleImage, getUpscaleConfig } = require('../services/upscaler.service');

test('4x upscale uses Lanczos3 and restrained edge sharpening', () => {
  const config = getUpscaleConfig(4);
  assert.equal(config.kernel, sharp.kernel.lanczos3);
  assert.equal(config.sharpen.sigma, 0.7);
  assert.ok(config.sharpen.m1 < config.sharpen.m2);
});

test('4x upscale writes four-times dimensions', async () => {
  const inputPath = path.join(TEMP_DIR, `test-input-${process.pid}.png`);
  try {
    await sharp({
      create: { width: 12, height: 8, channels: 3, background: { r: 80, g: 130, b: 190 } },
    }).png().toFile(inputPath);
    const result = await upscaleImage({ inputPath, inputSize: 120, scale: 4 });
    assert.equal(result.result.width, 48);
    assert.equal(result.result.height, 32);
    assert.equal(result.scale.applied, 4);
    await fsp.unlink(result.outputPath);
  } finally {
    await fsp.unlink(inputPath).catch(() => {});
  }
});
