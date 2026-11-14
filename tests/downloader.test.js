'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInfoArgs, buildDownloadArgs, normalizeDownloadMode } = require('../services/downloader.service');

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

test('video mode prefers H.264/AAC MP4 and falls back to an available MP4 or best format', () => {
  const args = buildDownloadArgs(URL, 'C:/Temp/media-test.%(ext)s', 'video');
  const selector = args[args.indexOf('--format') + 1];
  assert.equal(
    selector,
    'bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[acodec^=mp4a][ext=m4a]/best[vcodec^=avc1][ext=mp4]/best[ext=mp4]/best'
  );
  assert.equal(args[args.indexOf('--merge-output-format') + 1], 'mp4');
  assert.equal(args[args.indexOf('--remux-video') + 1], 'mp4');
  assert.equal(args[args.indexOf('--output') + 1], 'C:/Temp/media-test.%(ext)s');
  assert.ok(args.includes('--force-ipv4'));
  assert.ok(args.includes('--format-sort-force'));
  assert.match(args[args.indexOf('--format-sort') + 1], /^lang,/);
});

test('audio mode extracts the best track to high-quality MP3 without video remuxing', () => {
  const args = buildDownloadArgs(URL, 'C:/Temp/audio-test.%(ext)s', 'audio');
  assert.equal(args[args.indexOf('--format') + 1], 'bestaudio/best');
  assert.ok(args.includes('-x'));
  assert.equal(args[args.indexOf('--audio-format') + 1], 'mp3');
  assert.equal(args[args.indexOf('--audio-quality') + 1], '0');
  assert.equal(args[args.indexOf('--output') + 1], 'C:/Temp/audio-test.%(ext)s');
  assert.ok(!args.includes('--merge-output-format'));
  assert.ok(!args.includes('--remux-video'));
});

test('download mode accepts video/audio and mp4/mp3 aliases, rejecting unknown values', () => {
  assert.equal(normalizeDownloadMode(undefined), 'video');
  assert.equal(normalizeDownloadMode('mp4'), 'video');
  assert.equal(normalizeDownloadMode('audio'), 'audio');
  assert.equal(normalizeDownloadMode('MP3'), 'audio');
  assert.throws(() => normalizeDownloadMode('gif'), { status: 400 });
});
