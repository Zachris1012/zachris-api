'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');

const routeStorePath = path.join(__dirname, '..', 'temp', `api-keys-route-${process.pid}.json`);
process.env.API_KEYS_FILE = routeStorePath;
process.env.API_KEY = 'master-key-test-only';

const { createApiKeyStore } = require('../services/api-key-store.service');
const keysRouter = require('../routes/keys.routes');
const apiKeyAuth = require('../middlewares/apiKeyAuth');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/keys', keysRouter);
  app.get('/api/private/ping', apiKeyAuth, (req, res) => res.json({ success: true }));
  return app;
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

test('generated API keys are high-entropy, persistent, and stored as hashes', async (t) => {
  const storePath = path.join(__dirname, '..', 'temp', `api-keys-unit-${process.pid}.json`);
  const store = createApiKeyStore(storePath);
  t.after(() => fsp.unlink(storePath).catch(() => {}));

  const keys = await Promise.all(Array.from({ length: 8 }, () => store.generateApiKey()));
  assert.equal(new Set(keys.map((entry) => entry.apiKey)).size, keys.length);
  for (const entry of keys) assert.match(entry.apiKey, /^zapi-[a-f0-9]{64}$/);

  const persisted = await fsp.readFile(storePath, 'utf8');
  const data = JSON.parse(persisted);
  assert.equal(data.keys.length, 8);
  assert.ok(keys.every(({ apiKey }) => !persisted.includes(apiKey)));

  const restartedStore = createApiKeyStore(storePath);
  assert.equal(await restartedStore.isValidApiKey(keys[0].apiKey), true);
  assert.equal(await restartedStore.isValidApiKey('zapi-not-a-real-key'), false);
  assert.equal(await restartedStore.isValidApiKey('master-secret', 'master-secret'), true);
});

test('public key endpoint is rate-limited and generated keys immediately pass API auth', async (t) => {
  const server = await listen(createTestApp());
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fsp.unlink(routeStorePath).catch(() => {});
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let generatedKey;

  for (let i = 0; i < 5; i += 1) {
    const response = await fetch(`${base}/api/keys/generate`, { method: 'POST' });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.success, true);
    if (i === 0) generatedKey = body.data.apiKey;
  }
  const limited = await fetch(`${base}/api/keys/generate`, { method: 'POST' });
  assert.equal(limited.status, 429);

  const authorized = await fetch(`${base}/api/private/ping`, { headers: { 'x-api-key': generatedKey } });
  assert.equal(authorized.status, 200);
  const master = await fetch(`${base}/api/private/ping`, { headers: { 'x-api-key': process.env.API_KEY } });
  assert.equal(master.status, 200);
  const missing = await fetch(`${base}/api/private/ping`);
  assert.equal(missing.status, 401);
});
