'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInfoArgs, buildDownloadArgs } = require('../services/downloader.service');

const URL = 'https://www.youtube.com/watch?v=sample123';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

test('metadata extraction sends browser headers and prefers the source-language track', () => {
  const args = buildInfoArgs(URL);
  assert.ok(args.includes('--user-agent'));
  assert.equal(args[args.indexOf('--user-agent') + 1], UA);
  assert.ok(args.includes('--referer'));
  assert.equal(args[args.indexOf('--referer') + 1], URL);
  assert.ok(args.includes('--force-ipv4'));
  assert.ok(args.includes('--format-sort'));
  assert.ok(args.includes('--format-sort-force'));
  assert.match(args[args.indexOf('--format-sort') + 1], /^lang,/);
});

test('media download chooses best video and audio, then merges and remuxes to MP4', () => {
  const args = buildDownloadArgs(URL, 'C:/Temp/media-test.%(ext)s');
  assert.equal(args[args.indexOf('--format') + 1], 'bestvideo+bestaudio/best');
  assert.equal(args[args.indexOf('--merge-output-format') + 1], 'mp4');
  assert.equal(args[args.indexOf('--remux-video') + 1], 'mp4');
  assert.equal(args[args.indexOf('--output') + 1], 'C:/Temp/media-test.%(ext)s');
  assert.ok(args.includes('--force-ipv4'));
  assert.ok(args.includes('--user-agent'));
  assert.ok(args.includes('--format-sort'));
  assert.ok(args.includes('--format-sort-force'));
  assert.match(args[args.indexOf('--format-sort') + 1], /^lang,/);
});
