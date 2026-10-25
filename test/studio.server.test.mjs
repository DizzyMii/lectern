import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupNotebook, FIXTURE } from './helpers.mjs';

const env = setupNotebook();
// the recorded fixture, with a final answer that is a valid code map
const graph = {
  title: 'Fake map', layout: 'layered',
  nodes: [{ id: 'p', label: 'net.x', kind: 'package' }, { id: 'f', label: 'Foo', kind: 'class', ref: 'src/java/net/x/Foo.java#L3', detail: 'Main type [[src/java/net/x/Foo.java#L3-L5]].' }, { id: 'e', label: 'Lib', kind: 'external' }],
  edges: [{ from: 'p', to: 'f', label: 'contains' }, { from: 'f', to: 'e', label: 'uses' }],
};
const lines = fs.readFileSync(FIXTURE, 'utf8').trim().split('\n');
const result = JSON.parse(lines.at(-1));
result.result = `The package holds one class [[docs/guide/a.md|"Register handlers in RegisterPayloadHandlersEvent."]].\n\n\`\`\`json\n${JSON.stringify(graph)}\n\`\`\`\n`;
lines[lines.length - 1] = JSON.stringify(result);
const fixture = path.join(env.root, 'fixture.jsonl');
fs.writeFileSync(fixture, lines.join('\n') + '\n');
process.env.LECTERN_FAKE_ENGINE = '1';
process.env.LECTERN_FAKE_FIXTURE = fixture;

const { createServer } = await import('../lib/server.mjs');
const studio = await import('../lib/studio/engine.mjs');
const { getNotebook } = await import('../lib/store.mjs');
const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); env.cleanup(); });

const J = { 'content-type': 'application/json' };
const post = (url, body, method = 'POST') => fetch(base + url, { method, headers: J, body: JSON.stringify(body) });
async function sse(url, body) {
  const res = await post(url, body);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const text = await res.text();
  return text.split('\n\n').filter((b) => b.startsWith('event:')).map((b) => {
    const [ev, data] = b.split('\n');
    return { event: ev.slice(7), data: JSON.parse(data.slice(6)) };
  });
}

test('GET studio lists groups, recipes, kinds, exports and roots', async () => {
  const s = await (await fetch(base + '/api/notebooks/test/studio')).json();
  assert.equal(s.recipes.length, 24);
  assert.deepEqual(s.groups.map((g) => g.id), ['plan', 'visual', 'agent', 'learn', 'code']);
  assert.deepEqual(s.roots, ['code']);
  assert.deepEqual(s.exports.plan, ['markdown', 'issues', 'json']);
  const cm = s.recipes.find((r) => r.id === 'code-map');
  assert.equal(cm.kind, 'graph');
  assert.equal(cm.inputs[0].type, 'root');
  assert.equal(cm.prompt, undefined);
});

test('bad requests are JSON errors before any stream opens', async () => {
  const unknown = await post('/api/notebooks/test/artifacts', { recipe: 'nope', inputs: {} });
  assert.equal(unknown.status, 400);
  assert.match((await unknown.json()).error, /unknown recipe/);
  const missing = await post('/api/notebooks/test/artifacts', { recipe: 'code-map', inputs: {} });
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /"Code root" is required/);
  const model = await post('/api/notebooks/test/artifacts', { recipe: 'code-map', inputs: { root: 'code' }, model: 'gpt' });
  assert.equal(model.status, 400);
  assert.equal((await fetch(base + '/api/notebooks/test/artifacts/nothere')).status, 404);
  assert.equal((await fetch(base + '/api/notebooks/test/artifacts/nothere', { method: 'PUT' })).status, 404);
});

let mapId;
test('POST artifacts streams phases and engine events and ends with done{artifact}', async () => {
  const events = await sse('/api/notebooks/test/artifacts', { recipe: 'code-map', inputs: { root: 'code' }, model: 'haiku' });
  const types = events.map((e) => e.event);
  assert.equal(types[0], 'phase');
  assert.equal(events[0].data.name, 'generate');
  assert.ok(types.includes('delta'));
  assert.ok(types.indexOf('tool') < types.indexOf('tool_result'));
  assert.equal(types.at(-1), 'done');
  assert.ok(!types.includes('error'));
  const a = events.at(-1).data.artifact;
  assert.equal(a.status, 'ok');
  assert.equal(a.kind, 'graph');
  assert.equal(a.model, 'haiku');
  assert.equal(a.title, 'Fake map');
  assert.deepEqual(a.citations.map((c) => c.status), ['verified', 'verified']);
  assert.equal(a.data.nodes[1].detail, 'Main type [^2].');
  assert.equal(a.data.nodes[1].refStatus, 'verified');
  mapId = a.id;
  const list = await (await fetch(base + '/api/notebooks/test/artifacts')).json();
  assert.equal(list[0].id, mapId);
  assert.equal(list[0].data, undefined);
  const one = await (await fetch(`${base}/api/notebooks/test/artifacts/${mapId}`)).json();
  assert.equal(one.data.nodes.length, 3);
});

test('a recipe whose output fails validation streams a repair phase and saves invalid', async () => {
  // a doc recipe gets the graph answer: no heading, so it fails twice
  const events = await sse('/api/notebooks/test/artifacts', { recipe: 'gotchas', inputs: {}, model: 'haiku' });
  const repair = events.find((e) => e.event === 'phase' && e.data.name === 'repair');
  assert.ok(repair);
  assert.match(repair.data.errors.join(), /no markdown heading/);
  const a = events.at(-1).data.artifact;
  assert.equal(events.at(-1).event, 'done');
  assert.equal(a.status, 'invalid');
  assert.equal(a.attempts.length, 2);
  assert.match(a.raw, /repair attempt/);
  assert.equal((await post(`/api/notebooks/test/artifacts/${a.id}/export`, {})).status, 409);
});

test('export, patch, regenerate in place and delete', async () => {
  const ex = await (await post(`/api/notebooks/test/artifacts/${mapId}/export`, { format: 'mermaid' })).json();
  assert.match(ex.text, /^flowchart TD/);
  assert.equal(ex.filename, 'fake-map.mmd');
  assert.equal((await post(`/api/notebooks/test/artifacts/${mapId}/export`, { format: 'pdf' })).status, 400);
  const patched = await (await post(`/api/notebooks/test/artifacts/${mapId}`, { title: 'My map' }, 'PATCH')).json();
  assert.equal(patched.title, 'My map');
  const events = await sse(`/api/notebooks/test/artifacts/${mapId}/regenerate`, {});
  const a = events.at(-1).data.artifact;
  assert.equal(a.id, mapId);
  assert.equal(a.model, 'haiku');
  assert.equal(a.title, 'Fake map');
  const del = await fetch(`${base}/api/notebooks/test/artifacts/${mapId}`, { method: 'DELETE', headers: { origin: base } });
  assert.deepEqual(await del.json(), { ok: true });
  assert.equal((await fetch(`${base}/api/notebooks/test/artifacts/${mapId}`)).status, 404);
});

test('write route for file artifacts', async () => {
  const nb = getNotebook('test');
  studio.saveArtifact(nb, { id: 'file-1', recipe: 'agents-md', kind: 'file', title: 'AGENTS.md', status: 'ok', inputs: { root: 'code' }, data: { filename: 'AGENTS.md', language: 'markdown', content: '# AGENTS.md\n' }, citations: [] });
  const w = await post('/api/notebooks/test/artifacts/file-1/write', {});
  assert.equal(w.status, 200);
  const { path: written } = await w.json();
  assert.ok(written.endsWith('/nb/src/java/AGENTS.md'));
  const again = await post('/api/notebooks/test/artifacts/file-1/write', {});
  assert.equal(again.status, 409);
  const body = await again.json();
  assert.equal(body.exists, true);
  assert.equal(body.path, written);
  assert.equal((await post('/api/notebooks/test/artifacts/file-1/write', { overwrite: true })).status, 200);
  assert.equal((await post('/api/notebooks/test/artifacts/file-1/write', { path: '../../escape.md' })).status, 403);
  assert.equal((await post(`/api/notebooks/test/artifacts/file-1/export`, {})).status, 200);
});

test('the old generate route still works', async () => {
  const events = await sse('/api/notebooks/test/generate', { kind: 'faq', model: 'haiku' });
  assert.equal(events.at(-1).event, 'done');
  assert.ok(events.at(-1).data.note.slug);
});
