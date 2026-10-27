import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setupNotebook } from './helpers.mjs';

setupNotebook();
process.env.LECTERN_PUBLIC_ORIGINS = 'https://box.tail0000.ts.net';
process.env.LECTERN_ALLOW_USERS = 'me@example.com';
process.env.ANTHROPIC_WORKSPACE_ID = 'wrkspc_from_env';
delete process.env.ANTHROPIC_API_KEY;
const { createServer } = await import('../lib/server.mjs');
const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
test.after(() => server.close());

const call = (method, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body === undefined ? null : JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port, path: '/api/settings', method, headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
    let s = '';
    res.on('data', (c) => { s += c; });
    res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(s) }));
  }).on('error', reject);
  req.end(data);
});
const byKey = (r) => Object.fromEntries(r.body.settings.map((s) => [s.key, s]));

test('a saved key reaches process.env and never comes back whole', async () => {
  const r = await call('PUT', { ANTHROPIC_API_KEY: 'sk-ant-secret-wxyz' });
  assert.equal(r.status, 200);
  assert.equal(process.env.ANTHROPIC_API_KEY, 'sk-ant-secret-wxyz');
  const key = byKey(await call('GET')).ANTHROPIC_API_KEY;
  assert.equal(key.value, '');
  assert.equal(key.hint, '…wxyz');
  assert.ok(!JSON.stringify((await call('GET')).body).includes('sk-ant-secret'));
});

test('clearing a setting puts the environment value back', async () => {
  await call('PUT', { ANTHROPIC_WORKSPACE_ID: 'wrkspc_saved' });
  assert.equal(process.env.ANTHROPIC_WORKSPACE_ID, 'wrkspc_saved');
  await call('PUT', { ANTHROPIC_WORKSPACE_ID: null });
  assert.equal(process.env.ANTHROPIC_WORKSPACE_ID, 'wrkspc_from_env');
  assert.equal(byKey(await call('GET')).ANTHROPIC_WORKSPACE_ID.fromEnv, true);
});

test('unknown keys and bad values are refused without saving anything', async () => {
  assert.equal((await call('PUT', { PATH: 'x' })).status, 400);
  assert.equal((await call('PUT', { PORT: '1', CLAUDE_BIN: 'a\nb' })).status, 400);
  assert.equal(byKey(await call('GET')).PORT.set, false);
});

test('a tailnet login can read settings but not change them', async () => {
  const remote = { host: 'box.tail0000.ts.net', 'tailscale-user-login': 'me@example.com' };
  const r = await call('GET', undefined, remote);
  assert.equal(r.status, 200);
  assert.equal(r.body.editable, false);
  assert.equal((await call('PUT', { PORT: '9999' }, remote)).status, 403);
});
