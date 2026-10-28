// Which engine answers, and that the Claude Code login never answers a request from another device.
// Remote requests are simulated the way remote.test.mjs does it: a Host and a Tailscale login that the gate accepts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { setupNotebook } from './helpers.mjs';

const env = setupNotebook();
process.env.CLAUDE_BIN = process.execPath; // any real executable stands in for claude
process.env.LECTERN_PUBLIC_ORIGINS = 'https://box.tail0000.ts.net';
process.env.LECTERN_ALLOW_USERS = 'me@example.com';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.LECTERN_PREFER_CLAUDE_CODE;
delete process.env.LECTERN_FAKE_ENGINE;

// a Messages endpoint that answers every request with the recorded cited answer
const answer = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'fixtures', 'api', 'cited-answer.sse'), 'utf8');
let apiRequests = 0;
const fake = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    apiRequests++;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.end(answer);
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fake.address().port}`;

const { defaultEngine, pickEngine, resolveEngine, engineStatus, ask, NO_ENGINE_HELP, PINNED_OFF_HELP } = await import('../lib/engine.mjs');
const studio = await import('../lib/studio/engine.mjs');
const { getNotebook } = await import('../lib/store.mjs');
const { createServer } = await import('../lib/server.mjs');
const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

test.after(() => { server.close(); fake.closeAllConnections(); fake.close(); env.cleanup(); });

const LOCAL = { host: `127.0.0.1:${port}` };
const REMOTE = { host: 'box.tail0000.ts.net', 'tailscale-user-login': 'me@example.com' };

const call = (method, url, who, body) => new Promise((resolve, reject) => {
  const data = body === undefined ? null : JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { ...who, ...(data ? { 'content-type': 'application/json' } : {}) } }, (res) => {
    let text = '';
    res.on('data', (c) => { text += c; });
    res.on('end', () => {
      if (/event-stream/.test(res.headers['content-type'] ?? '')) {
        const events = text.split('\n\n').filter((b) => b.startsWith('event:')).map((b) => { const [ev, d] = b.split('\n'); return { event: ev.slice(7), data: JSON.parse(d.slice(6)) }; });
        return resolve({ status: res.statusCode, events });
      }
      resolve({ status: res.statusCode, json: text ? JSON.parse(text) : null });
    });
  });
  req.on('error', reject);
  req.end(data);
});
const post = (url, who, body) => call('POST', url, who, body);

// run with the given environment, then put it back
async function withEnv(vars, fn) {
  const was = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
const none = { ANTHROPIC_API_KEY: null, LECTERN_PREFER_CLAUDE_CODE: null, LECTERN_FAKE_ENGINE: null };
const keyOnly = { ...none, ANTHROPIC_API_KEY: 'test-key' };
const optIn = { ...none, ANTHROPIC_API_KEY: 'test-key', LECTERN_PREFER_CLAUDE_CODE: '1', LECTERN_FAKE_ENGINE: '1' };

test('no key and claude on PATH with no opt-in gives no engine', () => withEnv(none, () => {
  assert.equal(defaultEngine(), null);
  assert.equal(pickEngine(undefined), null);
  const s = engineStatus();
  assert.equal(s.default, null);
  assert.equal(s.label, 'no engine');
  assert.equal(s.claudeCode.found, true);
  assert.equal(s.onboarding, NO_ENGINE_HELP);
  assert.doesNotMatch(NO_ENGINE_HELP, /Claude Code|login/i);
  assert.throws(() => resolveEngine({}), (e) => e.status === 409 && e.message === NO_ENGINE_HELP);
  assert.throws(() => ask({ notebook: 'test', question: 'q' }), (e) => e.status === 409);
}));

test('an API key alone gives the API engine, even with claude on PATH', () => withEnv(keyOnly, () => {
  assert.equal(defaultEngine(), 'api');
  assert.equal(resolveEngine({}), 'api');
}));

test('the opt-in gives claude-code, and an explicit claude-code on this machine works without it', async () => {
  await withEnv({ ...none, LECTERN_PREFER_CLAUDE_CODE: '1' }, () => {
    assert.equal(defaultEngine(), 'claude-code');
    assert.match(engineStatus().label, /Claude Code login/);
  });
  await withEnv({ ...keyOnly, LECTERN_PREFER_CLAUDE_CODE: '1' }, () => assert.equal(defaultEngine(), 'claude-code'));
  await withEnv(none, () => assert.equal(resolveEngine({ requested: 'claude-code' }), 'claude-code'));
});

test('a conversation saved on the login does not keep using it here once the opt-in is off', async () => {
  await withEnv(keyOnly, () => {
    assert.throws(() => resolveEngine({ pinned: 'claude-code' }), (e) => e.status === 409 && e.message === PINNED_OFF_HELP);
    assert.throws(() => ask({ notebook: 'test', question: 'q', conversationId: 'x' }), (e) => e.status === 404);
    assert.equal(resolveEngine({ requested: 'claude-code', pinned: 'claude-code' }), 'claude-code', 'naming it counts as asking');
    assert.equal(resolveEngine({ requested: 'api', pinned: 'claude-code' }), 'api');
  });
  await withEnv({ ...keyOnly, LECTERN_PREFER_CLAUDE_CODE: '1' }, () => assert.equal(resolveEngine({ pinned: 'claude-code' }), 'claude-code'));
});

test('the fake engine still stands in for claude-code', () => withEnv({ ...none, LECTERN_FAKE_ENGINE: '1' }, () => assert.equal(defaultEngine(), 'claude-code')));

test('the same checks apply below the routes: remote means never claude-code', () => withEnv(optIn, () => {
  assert.equal(defaultEngine({ local: false }), 'api');
  assert.equal(pickEngine('claude-code', { local: false }), 'api');
  assert.equal(resolveEngine({ local: false }), 'api');
  assert.throws(() => resolveEngine({ requested: 'claude-code', local: false }), (e) => e.status === 403);
  assert.throws(() => resolveEngine({ pinned: 'claude-code', local: false }), (e) => e.status === 403);
  assert.throws(() => resolveEngine({ requested: 'api', pinned: 'claude-code', local: false }), (e) => e.status === 403);
  assert.throws(() => ask({ notebook: 'test', question: 'q', engine: 'claude-code', local: false }), (e) => e.status === 403);
}));

test('a remote ask with the opt-in on answers on the API engine', () => withEnv(optIn, async () => {
  apiRequests = 0;
  const r = await post('/api/notebooks/test/ask', REMOTE, { question: 'Which event registers payload handlers?', model: 'haiku' });
  assert.equal(r.status, 200);
  const done = r.events.at(-1);
  assert.equal(done.event, 'done');
  assert.equal(apiRequests, 1);
  const conv = (await call('GET', `/api/conversations/test/${done.data.conversationId}`, REMOTE)).json;
  assert.equal(conv.engine, 'api');
}));

test('a remote ask with no key and no way to answer gets the no-engine error', () => withEnv({ ...none, LECTERN_FAKE_ENGINE: '1' }, async () => {
  const r = await post('/api/notebooks/test/ask', REMOTE, { question: 'Anything?' });
  assert.equal(r.status, 409);
  assert.equal(r.json.error, NO_ENGINE_HELP);
}));

test('a remote ask that names claude-code is refused, and so is the quick ask preset', () => withEnv(optIn, async () => {
  const msg = /only answers questions asked on this machine.*API key in Settings/;
  const r = await post('/api/notebooks/test/ask', REMOTE, { question: 'Hi?', engine: 'claude-code' });
  assert.equal(r.status, 403);
  assert.match(r.json.error, msg);
  const fast = await post('/api/notebooks/test/ask', REMOTE, { question: 'Hi?', engine: 'claude-code', fast: true });
  assert.equal(fast.status, 403);
  // the preset on its own settles on the API engine
  apiRequests = 0;
  const plain = await post('/api/notebooks/test/ask', REMOTE, { question: 'Hi?', fast: true });
  assert.equal(plain.status, 200);
  assert.equal(plain.events.at(-1).event, 'done');
  assert.equal(apiRequests, 1);
  const gen = await post('/api/notebooks/test/generate', REMOTE, { kind: 'faq', engine: 'claude-code' });
  assert.equal(gen.status, 403);
}));

test('a remote follow-up on a claude-code conversation is refused, a local one goes through', () => withEnv(optIn, async () => {
  const first = await post('/api/notebooks/test/ask', LOCAL, { question: 'What is Foo?', model: 'haiku' });
  assert.equal(first.status, 200);
  const done = first.events.at(-1);
  assert.equal(done.event, 'done');
  const id = done.data.conversationId;
  assert.equal((await call('GET', `/api/conversations/test/${id}`, LOCAL)).json.engine, 'claude-code');

  const remote = await post('/api/notebooks/test/ask', REMOTE, { question: 'And more?', conversationId: id, model: 'haiku' });
  assert.equal(remote.status, 403);
  assert.match(remote.json.error, /runs on the Claude Code login, which only answers on this machine/);
  assert.equal((await call('GET', `/api/conversations/test/${id}`, LOCAL)).json.turns.length, 1, 'the refused question was not saved');
  // naming the API engine does not move the owner's conversation off the login
  const viaApi = await post('/api/notebooks/test/ask', REMOTE, { question: 'And more?', conversationId: id, model: 'haiku', engine: 'api' });
  assert.equal(viaApi.status, 403);
  assert.equal((await call('GET', `/api/conversations/test/${id}`, LOCAL)).json.engine, 'claude-code');
  const bad = await post('/api/notebooks/test/ask', REMOTE, { question: 'Hi?', engine: 'x' });
  assert.equal(bad.status, 400);

  const local = await post('/api/notebooks/test/ask', LOCAL, { question: 'And more?', conversationId: id, model: 'haiku' });
  assert.equal(local.status, 200);
  assert.equal(local.events.at(-1).event, 'done');
  assert.equal((await call('GET', `/api/conversations/test/${id}`, LOCAL)).json.turns.length, 2);
}));

test('Studio runs and regenerates are refused on claude-code from another device, and run here', () => withEnv(optIn, async () => {
  const listed = async () => (await call('GET', '/api/notebooks/test/artifacts', LOCAL)).json.length;
  const before = await listed();
  const body = { recipe: 'prd', inputs: { idea: 'A thing' } };
  const r = await post('/api/notebooks/test/artifacts', REMOTE, { ...body, engine: 'claude-code' });
  assert.equal(r.status, 403);
  assert.match(r.json.error, /only answers questions asked on this machine/);
  assert.equal(await listed(), before, 'a refused run saves nothing');

  const here = await post('/api/notebooks/test/artifacts', LOCAL, body);
  assert.equal(here.status, 200);
  const artifact = here.events.at(-1).data.artifact;
  assert.equal(artifact.engine, 'claude-code');

  const regen = await post(`/api/notebooks/test/artifacts/${artifact.id}/regenerate`, REMOTE, { engine: 'claude-code' });
  assert.equal(regen.status, 403);
  await withEnv(none, async () => {
    const noEngine = await post(`/api/notebooks/test/artifacts/${artifact.id}/regenerate`, REMOTE, {});
    assert.equal(noEngine.status, 409);
  });
}));

test('studio.run itself refuses a remote claude-code run before it saves anything', async () => {
  const nb = getNotebook('test');
  const prepared = await studio.prepare(nb, 'prd', { idea: 'Another thing' });
  const before = studio.listArtifacts(nb).length;
  assert.throws(() => studio.run(nb, prepared, { engine: 'claude-code', local: false }), (e) => e.status === 403);
  assert.equal(studio.listArtifacts(nb).length, before);
});

test('/api/status tells a remote client about the engine it would get', () => withEnv(optIn, async () => {
  const local = (await call('GET', '/api/status', LOCAL)).json;
  assert.equal(local.engine.default, 'claude-code');
  const remote = (await call('GET', '/api/status', REMOTE)).json;
  assert.equal(remote.engine.default, 'api');
  assert.equal(remote.engine.label, 'API');
  assert.equal(remote.engine.onboarding, null);
  await withEnv({ ANTHROPIC_API_KEY: null }, async () => {
    const bare = (await call('GET', '/api/status', REMOTE)).json;
    assert.equal(bare.engine.default, null);
    assert.equal(bare.engine.onboarding, NO_ENGINE_HELP);
  });
}));

// Tailscale Serve copies the client's Host header and adds X-Forwarded-For, so a tailnet device can claim to be 127.0.0.1
test('a proxied request that claims a local Host is not this machine', () => withEnv(optIn, async () => {
  const SPOOF = { host: `127.0.0.1:${port}`, 'tailscale-user-login': 'stranger@other.com', 'x-forwarded-for': '100.64.0.9' };
  const status = await call('GET', '/api/status', SPOOF);
  assert.equal(status.status, 403);
  assert.equal((await post('/api/notebooks/test/ask', SPOOF, { question: 'Hi?', engine: 'claude-code' })).status, 403);
  assert.equal((await post('/api/notebooks/test/artifacts', SPOOF, { recipe: 'prd', inputs: { idea: 'A thing' } })).status, 403);
  const before = process.env.LECTERN_PREFER_CLAUDE_CODE;
  assert.equal((await call('PUT', '/api/settings', SPOOF, { LECTERN_PREFER_CLAUDE_CODE: '0' })).status, 403);
  assert.equal(process.env.LECTERN_PREFER_CLAUDE_CODE, before);
  // an allowed login through the real hostname still gets the API engine, and X-Forwarded-For alone is enough to mark a request remote
  const viaProxy = await call('GET', '/api/status', { ...REMOTE, 'x-forwarded-for': '100.64.0.9' });
  assert.equal(viaProxy.json.engine.default, 'api');
  const fwd = await call('GET', '/api/status', { ...LOCAL, 'x-forwarded-for': '100.64.0.9' });
  assert.equal(fwd.status, 403);
}));
