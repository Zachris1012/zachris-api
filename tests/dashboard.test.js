'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');

const dashboardPath = path.join(__dirname, '..', 'public', 'dashboard.html');

test('dashboard is branded and persists the API key locally', async () => {
  const html = await fsp.readFile(dashboardPath, 'utf8');
  assert.match(html, /Zachris API/);
  assert.match(html, /API_KEY_STORAGE = 'zachris-api-key'/);
  assert.match(html, /localStorage\.setItem\(API_KEY_STORAGE/);
  assert.match(html, /const data = await api\('\/api\/status'\)/);
});

test('dashboard exposes live status, merged downloads, and image comparisons', async () => {
  const html = await fsp.readFile(dashboardPath, 'utf8');
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /\/api\/download\/jobs/);
  assert.match(html, /preview-pair/);
});
