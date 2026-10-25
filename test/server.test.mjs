import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { setupNotebook, FIXTURE } from './helpers.mjs';

const env = setupNotebook();
// the recorded fixture with a final answer that carries citations
const lines = fs.readFileSync(FIXTURE, 'utf8').trim().split('\n');
const result = JSON.parse(lines.at(-1));
result.result = 'Use the event [[docs/guide/a.md|"Register handlers in RegisterPayloadHandlersEvent."]] and see [[src/java/net/x/Foo.java#L3-L5]] but not [[docs/ghost.md#L1]].';
lines[lines.length - 1] = JSON.stringify(result);
const fixture = path.join(env.root, 'fixture.jsonl');
fs.writeFileSync(fixture, lines.join('\n') + '\n');
process.env.LECTERN_FAKE_ENGINE = '1';
process.env.LECTERN_FAKE_FIXTURE = fixture;

const { createServer } = await import('../lib/server.mjs');
const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); env.cleanup(); });

async function sse(url, body) {
  const res = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const text = await res.text();
  return text.split('\n\n').filter((b) => b.startsWith('event:')).map((b) => {
    const [ev, data] = b.split('\n');
    return { event: ev.slice(7), data: JSON.parse(data.slice(6)) };
  });
}

test('status and notebook list', async () => {
  const s = await (await fetch(base + '/api/status')).json();
  assert.equal(typeof s.claude.found, 'boolean');
  assert.equal(s.fakeEngine, true);
  const list = await (await fetch(base + '/api/notebooks')).json();
  assert.equal(list[0].id, 'test');
  assert.equal(list[0].counts.docs, 2);
  assert.equal(list[0].counts.roots, 1);
  const nb = await (await fetch(base + '/api/notebooks/test')).json();
  assert.equal(nb.shelf.length, 2);
  assert.equal(nb.roots[0].name, 'code');
});

test('file, tree and search routes', async () => {
  const f = await (await fetch(base + '/api/notebooks/test/file?path=docs/guide/a.md')).json();
  assert.equal(f.lang, 'markdown');
  const bad = await fetch(base + '/api/notebooks/test/file?path=../outside.md');
  assert.equal(bad.status, 403);
  const t = await (await fetch(base + '/api/notebooks/test/tree?root=code&dir=net')).json();
  assert.equal(t.entries[0].name, 'x');
  const r = await (await fetch(base + '/api/notebooks/test/search?q=payload')).json();
  assert.equal(r.hits.length, 3);
  assert.equal(r.truncated, false);
  assert.equal(typeof r.ms, 'number');
  const files = await (await fetch(base + '/api/notebooks/test/files')).json();
  assert.ok(files.files.some((f) => f.path === 'src/java/net/x/Foo.java' && f.root === 'code'));
});

test('missing parameters are 400s', async () => {
  assert.equal((await fetch(base + '/api/notebooks/test/file')).status, 400);
  assert.equal((await fetch(base + '/api/notebooks/test/tree')).status, 400);
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const noQ = await post('/api/notebooks/test/ask', {});
  assert.equal(noQ.status, 400);
  assert.match(noQ.headers.get('content-type'), /json/);
  const badModel = await post('/api/notebooks/test/ask', { question: 'hi', model: 'notamodel' });
  assert.equal(badModel.status, 400);
  assert.match((await badModel.json()).error, /unknown model/);
  assert.equal((await post('/api/notebooks/test/generate', { kind: 'faq', model: 'nope' })).status, 400);
});

test('requests from other sites and hosts are refused', async () => {
  const evil = await fetch(base + '/api/notebooks/test/notes', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ title: 'csrf', body: 'x' }) });
  assert.equal(evil.status, 403);
  const plain = await fetch(base + '/api/notebooks/test/notes', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ title: 'csrf', body: 'x' }) });
  assert.equal(plain.status, 403);
  const same = await fetch(base + '/api/notebooks/test/notes', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'ok note', body: 'x' }) });
  assert.equal(same.status, 201);
  assert.equal((await fetch(`${base}/api/notebooks/test/notes/${(await same.json()).slug}`, { method: 'DELETE', headers: { origin: base } })).status, 200);
  // a rebinding page reaches us under its own host name
  const port = new URL(base).port;
  const rebind = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/api/status', headers: { host: `evil.example:${port}` } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(rebind, 403);
});

test('file reads refuse absolute paths even under a folder root', async () => {
  const post = (body) => fetch(base + '/api/notebooks/test/sources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const added = await post({ kind: 'folder', path: env.root, name: 'outer' });
  assert.equal(added.status, 201);
  const abs = path.join(env.root, 'outside.md').replace(/\\/g, '/');
  assert.equal((await fetch(base + '/api/notebooks/test/file?path=' + encodeURIComponent(abs))).status, 403);
  const viaRoot = await fetch(base + '/api/notebooks/test/file?path=outer/outside.md');
  assert.equal(viaRoot.status, 200);
  assert.equal((await viaRoot.json()).path, 'outer/outside.md');
  const del = (body) => fetch(base + '/api/notebooks/test/sources', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await del({ kind: 'root', value: 'outer' })).status, 200);
});

test('a single added file can be removed', async () => {
  const body = { kind: 'file', name: 'extra.md', base64: Buffer.from('# Extra\n').toString('base64') };
  const r = await fetch(base + '/api/notebooks/test/sources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await r.json()).path, 'sources/extra.md');
  const del = (value) => fetch(base + '/api/notebooks/test/sources', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'file', value }) });
  assert.equal((await del('docs/intro.md')).status, 400);
  assert.equal((await del('sources/extra.md')).status, 200);
  assert.equal(fs.existsSync(path.join(env.nbDir, 'sources', 'extra.md')), false);
  assert.equal((await del('sources/extra.md')).status, 404);
});

test('ask streams engine events, verifies citations and persists the turn', async () => {
  const events = await sse('/api/notebooks/test/ask', { question: 'Which event registers payload handlers?', model: 'haiku' });
  const types = events.map((e) => e.event);
  assert.ok(types.includes('delta'));
  assert.ok(types.indexOf('tool') < types.indexOf('tool_result'));
  assert.equal(types.at(-1), 'done');
  const done = events.at(-1).data;
  assert.equal(done.answer, 'Use the event [^1] and see [^2] but not [^3].');
  assert.deepEqual(done.citations.map((c) => c.status), ['verified', 'verified', 'missing']);
  assert.equal(done.citations[0].line, 6);
  assert.ok(done.conversationId);
  const conv = await (await fetch(`${base}/api/conversations/test/${done.conversationId}`)).json();
  assert.equal(conv.turns.length, 1);
  assert.equal(conv.title, 'Which event registers payload handlers?');
  assert.equal(conv.sessionId, result.session_id);
  assert.equal(conv.turns[0].model, 'haiku');

  const follow = await sse('/api/notebooks/test/ask', { question: 'More?', conversationId: done.conversationId, model: 'haiku' });
  assert.equal(follow.at(-1).event, 'done');
  // the fixture reports the same session total twice, so the follow-up itself cost nothing
  assert.equal(done.costUsd, result.total_cost_usd);
  assert.equal(follow.at(-1).data.costUsd, 0);
  assert.equal(follow.at(-1).data.sessionCostUsd, result.total_cost_usd);
  assert.equal((await (await fetch(`${base}/api/conversations/test/${done.conversationId}`)).json()).turns.length, 2);

  const patched = await (await fetch(`${base}/api/conversations/test/${done.conversationId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Payloads' }) })).json();
  assert.equal(patched.title, 'Payloads');
  assert.equal((await fetch(`${base}/api/conversations/test/${done.conversationId}`, { method: 'DELETE' })).status, 200);
});

test('ask with an unknown conversation sends an error event', async () => {
  const events = await sse('/api/notebooks/test/ask', { question: 'x', conversationId: 'nope-123' });
  assert.equal(events.at(-1).event, 'error');
});

test('generate saves a note', async () => {
  const events = await sse('/api/notebooks/test/generate', { kind: 'faq', model: 'haiku' });
  const done = events.at(-1);
  assert.equal(done.event, 'done');
  const notes = await (await fetch(base + '/api/notebooks/test/notes')).json();
  assert.equal(notes.length, 1);
  assert.equal(notes[0].slug, done.data.note.slug);
  const note = await (await fetch(`${base}/api/notebooks/test/notes/${notes[0].slug}`)).json();
  assert.match(note.body, /\[\^1\]: docs\/guide\/a.md:6/);
});

test('static files and vendor route', async () => {
  const v = await fetch(base + '/vendor/marked/package.json');
  assert.equal(v.status, 200);
  assert.match(v.headers.get('content-type'), /application\/json/);
  assert.notEqual((await fetch(base + '/vendor/..%2f..%2fserver.mjs')).status, 200);
  assert.equal((await fetch(base + '/api/nope')).status, 404);
});

test('roots report their branch and version when the folders carry them', async () => {
  const src = path.join(env.nbDir, 'src');
  fs.mkdirSync(path.join(src, '.git'), { recursive: true });
  fs.writeFileSync(path.join(src, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(src, 'gradle.properties'), 'org.gradle.jvmargs=-Xmx1G\nmod_version=1.2.3\n');
  try {
    const nb = await (await fetch(base + '/api/notebooks/test')).json();
    assert.equal(nb.roots[0].branch, 'main');
    assert.equal(nb.roots[0].version, '1.2.3');
  } finally {
    fs.rmSync(path.join(src, '.git'), { recursive: true, force: true });
    fs.rmSync(path.join(src, 'gradle.properties'), { force: true });
  }
  const plain = await (await fetch(base + '/api/notebooks/test')).json();
  assert.equal('branch' in plain.roots[0], false);
});

test('ask takes a scope list and refuses anything else', async () => {
  const bad = await fetch(base + '/api/notebooks/test/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'x', scope: 'code' }) });
  assert.equal(bad.status, 400);
  const events = await sse('/api/notebooks/test/ask', { question: 'Scoped?', model: 'haiku', scope: ['code'] });
  assert.equal(events.at(-1).event, 'done');
  const conv = await (await fetch(`${base}/api/conversations/test/${events.at(-1).data.conversationId}`)).json();
  assert.equal(conv.turns[0].question, 'Scoped?');
  const { scopedQuestion } = await import('../lib/engine.mjs');
  assert.equal(scopedQuestion('q', undefined), 'q');
  assert.match(scopedQuestion('q', ['code', 'docs/guide/']), /use only these sources: code, docs\/guide\/\./);
});

test('first-run candidates list project folders no notebook uses yet', async () => {
  const dir = path.join(env.root, 'projects');
  const mk = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  mk('mymod/.git/HEAD', 'ref: refs/heads/main\n');
  mk('neolib/gradle.properties', 'minecraft_version=1.21.1\nneo_version=21.1.77\nmod_version=4.7.1\n');
  mk('notes/readme.txt', 'not a project\n');
  process.env.LECTERN_PROJECTS_DIR = dir;
  try {
    const c = await (await fetch(base + '/api/candidates')).json();
    const byName = Object.fromEntries(c.roots.map((r) => [r.name, r]));
    assert.equal(byName.mymod.kind, 'repo');
    assert.equal(byName.mymod.branch, 'main');
    assert.equal(byName.neolib.kind, 'root');
    assert.equal(byName.neolib.version, '4.7.1');
    assert.equal(byName.notes, undefined);
    assert.deepEqual(c.docs.map((d) => d.label), ['docs.neoforged.net/docs/1.21.1']);
    // a folder already used as a root is not suggested again
    assert.ok(!c.roots.some((r) => r.path.endsWith('src/java')));
  } finally { delete process.env.LECTERN_PROJECTS_DIR; }
});
