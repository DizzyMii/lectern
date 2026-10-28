import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setupNotebook } from './helpers.mjs';

setupNotebook();
process.env.LECTERN_PUBLIC_ORIGINS = 'https://box.tail0000.ts.net';
process.env.LECTERN_ALLOW_USERS = 'me@example.com';
const { createServer } = await import('../lib/server.mjs');
const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
test.after(() => server.close());

const get = (headers, path = '/api/status') => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path, headers }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
});

test('the tailnet address works for an allowed tailnet login', async () => {
  assert.equal(await get({ host: 'box.tail0000.ts.net', 'tailscale-user-login': 'me@example.com' }), 200);
  assert.equal(await get({ host: 'box.tail0000.ts.net', 'tailscale-user-login': 'me@example.com', origin: 'https://box.tail0000.ts.net', referer: 'https://box.tail0000.ts.net/' }), 200);
});

test('the tailnet address refuses other logins and requests without one', async () => {
  assert.equal(await get({ host: 'box.tail0000.ts.net' }), 403);
  assert.equal(await get({ host: 'box.tail0000.ts.net', 'tailscale-user-login': 'someone@else.com' }), 403);
});

test('other hosts and origins are still refused, localhost still works', async () => {
  assert.equal(await get({ host: 'evil.example', 'tailscale-user-login': 'me@example.com' }), 403);
  assert.equal(await get({ host: `127.0.0.1:${port}`, origin: 'https://evil.example' }), 403);
  assert.equal(await get({ host: `127.0.0.1:${port}` }), 200);
});

// Tailscale Serve copies the client's Host header, so a tailnet device can send Host: 127.0.0.1:<port>
test('a request that came through a proxy is never this machine, whatever its Host says', async () => {
  const spoof = { host: `127.0.0.1:${port}`, 'x-forwarded-for': '100.64.0.7' };
  assert.equal(await get(spoof), 403);
  assert.equal(await get({ ...spoof, 'tailscale-user-login': 'someone@else.com' }), 403);
  const put = await new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: '/api/settings', method: 'PUT', headers: { ...spoof, 'content-type': 'application/json' } }, (res) => { res.resume(); resolve(res.statusCode); });
    r.on('error', reject);
    r.end(JSON.stringify({ PORT: '1' }));
  });
  assert.equal(put, 403);
});
