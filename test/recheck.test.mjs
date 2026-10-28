import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupNotebook } from './helpers.mjs';

const env = setupNotebook();
const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(env.nbDir, rel)), { recursive: true }); fs.writeFileSync(path.join(env.nbDir, rel), text); };
w('docs/r.md', '# Recheck\n\nintro line\nthe quick brown fox jumps over the lazy dog\nlast line\n');
w('src/java/net/x/Bar.java', 'package net.x;\n\npublic class Bar {\n  int a;\n  int b;\n}\n');

const store = await import('../lib/store.mjs');
const { processAnswer, reverify } = await import('../lib/cite.mjs');
const studio = await import('../lib/studio/engine.mjs');
const { createServer } = await import('../lib/server.mjs');
const nb = store.getNotebook('test');
const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); env.cleanup(); });

const created = '2026-01-01T00:00:00.000Z';
const { answer, citations } = processAnswer(nb.dir, 'Foxes jump [[docs/r.md#L4|"the quick brown fox jumps"]] and Bar has fields [[code/net/x/Bar.java#L4-L5]].', nb.config.roots);
const conv = { id: 'c1', notebook: 'test', title: 't', created, updated: created, turns: [{ question: 'q', answer, citations, startedAt: created, endedAt: created }] };
const convPath = path.join(nb.dir, 'conversations', 'c1.json');
store.writeJson(convPath, conv);
const raw = () => fs.readFileSync(convPath, 'utf8');
const getConv = async () => (await fetch(`${base}/api/conversations/test/c1`)).json();

test('a fresh read verifies again and leaves the stored file alone', async () => {
  const before = raw();
  const c = await getConv();
  const [doc, code] = c.turns[0].citations;
  assert.equal(doc.status, 'verified');
  assert.equal(doc.status0, 'verified');
  assert.equal(doc.line, 4);
  assert.equal(doc.checkedAt0, created);
  assert.ok(Date.parse(doc.checkedAt) > Date.parse(created));
  assert.equal(code.status, 'verified');
  assert.deepEqual(c.turns[0].citeCheck.counts, { verified: 2, moved: 0, unverified: 0, missing: 0 });
  assert.equal(c.turns[0].citeCheck.changed, false);
  assert.equal(c.citeCheck.changed, false);
  assert.equal(raw(), before);
});

test('quote moves: moved, line updated, persisted once', async () => {
  w('docs/r.md', '# Recheck\n\nnew one\nnew two\nnew three\nintro line\nthe quick brown fox jumps over the lazy dog\nlast line\n');
  const c = await getConv();
  const doc = c.turns[0].citations[0];
  assert.equal(doc.status, 'moved');
  assert.equal(doc.status0, 'verified');
  assert.equal(doc.line, 7);
  assert.equal(doc.line0, 4);
  assert.equal(c.turns[0].citeCheck.changed, true);
  assert.equal(c.turns[0].citeCheck.counts.moved, 1);
  const stored = JSON.parse(raw());
  assert.equal(stored.turns[0].citations[0].status, 'moved');
  assert.equal(stored.turns[0].citations[0].drift.length, 1);
  assert.equal(stored.updated, created);
  // nothing changed since, so the next read does not write
  const again = raw();
  const c2 = await getConv();
  assert.equal(c2.turns[0].citations[0].status, 'moved');
  assert.equal(raw(), again);
});

test('quote disappears: unverified, changed', async () => {
  w('docs/r.md', '# Recheck\n\nintro line\nthe slow red fox\nlast line\n');
  const c = (await import('../lib/store.mjs')).getConversation(nb, 'c1', { recheck: true });
  const doc = c.turns[0].citations[0];
  assert.equal(doc.status, 'unverified');
  assert.equal(doc.status0, 'verified');
  assert.equal(c.turns[0].citeCheck.changed, true);
  assert.equal(c.turns[0].citeCheck.counts.unverified, 1);
  assert.equal(JSON.parse(raw()).turns[0].citations[0].drift.length, 2);
});

test('file deleted: missing', async () => {
  fs.unlinkSync(path.join(env.nbDir, 'docs/r.md'));
  fs.writeFileSync(path.join(env.nbDir, 'src/java/net/x/Bar.java'), 'package net.x;\n');
  const c = await getConv();
  const [doc, code] = c.turns[0].citations;
  assert.equal(doc.status, 'missing');
  assert.equal(code.status, 'unverified');
  assert.equal(code.status0, 'verified');
  assert.deepEqual(c.citeCheck.counts, { verified: 0, moved: 0, unverified: 1, missing: 1 });
  assert.equal(c.citeCheck.worse, 2);
});

test('artifact citations and data refs re-check on the GET route', async () => {
  w('docs/r.md', '# Recheck\n\nthe quick brown fox jumps\n');
  w('src/java/net/x/Bar.java', 'package net.x;\n\npublic class Bar {\n  int a;\n  int b;\n}\n');
  const p = studio.processStructured(nb, 'Summary [[docs/r.md|"the quick brown fox jumps"]].', {
    nodes: [{ id: 'bar', label: 'Bar fields [[code/net/x/Bar.java#L4]]', ref: 'code/net/x/Bar.java#L5' }],
  });
  assert.equal(p.data.nodes[0].refStatus, 'verified');
  studio.saveArtifact(nb, { id: 'a1', kind: 'graph', title: 'g', status: 'ok', createdAt: created, updatedAt: created, summary: p.summary, data: p.data, citations: p.citations, sawRefs: p.sawRefs });
  const file = path.join(nb.dir, 'artifacts', 'a1.json');
  const before = fs.readFileSync(file, 'utf8');
  let a = await (await fetch(`${base}/api/notebooks/test/artifacts/a1`)).json();
  assert.equal(a.citeCheck.changed, false);
  assert.deepEqual(a.citeCheck.counts, { verified: 2, moved: 0, unverified: 0, missing: 0 });
  assert.equal(a.citeCheck.refs.counts.verified, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), before);

  w('src/java/net/x/Bar.java', 'package net.x;\n');
  a = await (await fetch(`${base}/api/notebooks/test/artifacts/a1`)).json();
  assert.equal(a.data.nodes[0].refStatus, 'unverified');
  assert.equal(a.data.nodes[0].refStatus0, 'verified');
  assert.equal(a.citeCheck.refs.changed, true);
  assert.equal(a.citeCheck.changed, true);
  assert.equal(a.citeCheck.counts.unverified, 1);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).data.nodes[0].refStatus, 'unverified');
});

test('50 citations across a few big files re-check well under 250 ms', (t) => {
  const words = Array.from({ length: 40_000 }, (_, i) => `word${i}${i % 9 === 0 ? '\n' : ' '}`).join('');
  for (let f = 0; f < 5; f++) w(`docs/big${f}.md`, words);
  const cites = [];
  for (let i = 0; i < 50; i++) cites.push({ n: i + 1, path: `docs/big${i % 5}.md`, quote: `word${i * 700 + 1} word${i * 700 + 2} word${i * 700 + 3}`, line: null, endLine: null, status: 'verified' });
  reverify(nb.dir, cites.slice(0, 1), nb.config.roots); // warm up the JIT
  // best of three, so a busy machine does not fail it
  let ms = Infinity, r;
  for (let k = 0; k < 3; k++) {
    const t0 = performance.now();
    r = reverify(nb.dir, cites, nb.config.roots);
    ms = Math.min(ms, performance.now() - t0);
  }
  assert.equal(r.summary.counts.verified, 50);
  assert.ok(ms < 250, `took ${ms.toFixed(1)} ms`);
  t.diagnostic(`50 citations: ${ms.toFixed(1)} ms`);
});

// ---------- saved lines ----------

const BAZ = 'package net.x;\n\npublic class Baz {\n  public void register(Handler h) {}\n  public void unregister(Handler h) {}\n}\n';
const bazFile = 'src/java/net/x/Baz.java';
const convOf = (id, turns) => {
  const f = path.join(nb.dir, 'conversations', `${id}.json`);
  store.writeJson(f, { id, notebook: 'test', title: id, created, updated: created, turns });
  return { f, raw: () => fs.readFileSync(f, 'utf8'), get: async () => (await fetch(`${base}/api/conversations/test/${id}`)).json() };
};
const turnOf = (text, extra = {}) => ({ question: 'q', ...processAnswer(nb.dir, text, nb.config.roots), startedAt: created, endedAt: created, ...extra });

test('code that moves is moved, then verified again when it moves back', async () => {
  w(bazFile, BAZ);
  const c = convOf('m1', [turnOf('Handlers register here [[code/net/x/Baz.java#L4]].')]);
  assert.equal((await c.get()).turns[0].citations[0].status, 'verified');
  w(bazFile, `// one\n// two\n${BAZ}`);
  let got = (await c.get()).turns[0].citations[0];
  assert.equal(got.status, 'moved');
  assert.equal(got.line, 6);
  assert.equal(got.line0, 4);
  assert.equal(JSON.parse(c.raw()).turns[0].citations[0].drift.length, 1);
  w(bazFile, BAZ);
  got = (await c.get()).turns[0].citations[0];
  assert.equal(got.status, 'verified');
  assert.equal(got.line, 4);
  assert.equal(JSON.parse(c.raw()).turns[0].citations[0].drift.length, 2);
});

test('rewritten code drifts to unverified and the saved lines stay in the stored file', async () => {
  w(bazFile, BAZ);
  const c = convOf('m2', [turnOf('Handlers register here [[code/net/x/Baz.java#L4]].')]);
  const saved = JSON.parse(c.raw()).turns[0].citations[0].saw.text;
  w(bazFile, BAZ.replace('register(Handler h)', 'register(Handler h, int priority)'));
  const got = await c.get();
  assert.equal(got.turns[0].citations[0].status, 'unverified');
  assert.equal(got.turns[0].citations[0].status0, 'verified');
  assert.equal(got.turns[0].citeCheck.changed, true);
  assert.equal(got.citeCheck.changed, true);
  const stored = JSON.parse(c.raw()).turns[0].citations[0];
  assert.equal(stored.status, 'unverified');
  assert.equal(stored.saw.text, saved);
});

test('a citation saved before lines were kept gets a labelled baseline, written once', async () => {
  w('src/java/net/x/Bar.java', 'package net.x;\n\npublic class Bar {\n  int a;\n  int b;\n}\n');
  const old = { n: 1, path: 'src/java/net/x/Bar.java', line: 4, endLine: 4, quote: null, status: 'verified' };
  const c = convOf('m3', [{ question: 'q', answer: 'x [^1]', citations: [old], startedAt: created, endedAt: created }]);
  const first = (await c.get()).turns[0].citations[0];
  assert.equal(first.status, 'verified');
  assert.equal(first.saw.base, true);
  assert.ok(first.saw.at);
  assert.equal(first.saw.text, '  int a;');
  assert.ok(!('read' in first.saw));
  assert.equal(JSON.parse(c.raw()).turns[0].citations[0].saw.base, true);
  // the second read writes nothing
  const before = c.raw();
  await c.get();
  assert.equal(c.raw(), before);
  w('src/java/net/x/Bar.java', 'package net.x;\n\npublic class Bar {\n  long a;\n  int b;\n}\n');
  const after = (await c.get()).turns[0].citations[0];
  assert.equal(after.status, 'unverified');
  assert.equal(after.status0, 'verified');
});

test('old turns that kept their tool calls get their read ranges at the next re-check', async () => {
  w('src/java/net/x/Bar.java', 'package net.x;\n\npublic class Bar {\n  int a;\n  int b;\n}\n');
  const barAbs = path.join(nb.dir, 'src/java/net/x/Bar.java');
  const text = 'Fields [[code/net/x/Bar.java#L4-L5]].';
  const c = convOf('m4', [
    turnOf(text, { toolCalls: [] }),
    turnOf(text, { toolCalls: [{ id: 't', name: 'Read', input: { file_path: barAbs, offset: 3, limit: 3 } }] }),
    turnOf(text),
  ]);
  const turns = (await c.get()).turns;
  assert.deepEqual(turns[0].citations[0].saw.read, []);
  assert.deepEqual(turns[1].citations[0].saw.read, [[3, 5]]);
  assert.ok(!('read' in turns[2].citations[0].saw));
  assert.deepEqual(JSON.parse(c.raw()).turns[1].citations[0].saw.read, [[3, 5]]);
  // written once
  const before = c.raw();
  await c.get();
  assert.equal(c.raw(), before);
});

test('structured refs: a moved ref updates ref, a rewritten ref is unverified', async () => {
  w(bazFile, BAZ);
  const p = studio.processStructured(nb, 'Summary.', { nodes: [{ id: 'baz', label: 'Baz', ref: 'code/net/x/Baz.java#L4' }] });
  const key = 'src/java/net/x/Baz.java#L4';
  assert.equal(p.sawRefs[key].text, '  public void register(Handler h) {}');
  studio.saveArtifact(nb, { id: 'a2', kind: 'graph', title: 'g', status: 'ok', createdAt: created, updatedAt: created, summary: p.summary, data: p.data, citations: p.citations, sawRefs: p.sawRefs });
  const file = path.join(nb.dir, 'artifacts', 'a2.json');
  const get = async () => (await fetch(`${base}/api/notebooks/test/artifacts/a2`)).json();
  const before = fs.readFileSync(file, 'utf8');
  assert.equal((await get()).data.nodes[0].refStatus, 'verified');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  w(bazFile, `// one\n// two\n${BAZ}`);
  let a = await get();
  assert.equal(a.data.nodes[0].refStatus, 'moved');
  assert.equal(a.data.nodes[0].ref, 'src/java/net/x/Baz.java#L6');
  assert.equal(a.citeCheck.refs.counts.moved, 1);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).sawRefs), [key]);
  w(bazFile, BAZ.replace('register(Handler h)', 'register(Handler h, int n)'));
  a = await get();
  assert.equal(a.data.nodes[0].refStatus, 'unverified');
  assert.equal(a.data.nodes[0].refStatus0, 'verified');
  assert.equal(a.citeCheck.refs.changed, true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).sawRefs[key].text, p.sawRefs[key].text);
  // an artifact saved before sawRefs existed gets labelled baselines
  const old = JSON.parse(before);
  delete old.sawRefs;
  w(bazFile, BAZ);
  store.writeJson(file, old);
  a = await get();
  assert.equal(a.sawRefs[key].base, true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).sawRefs[key].base, true);
});

test('50 line citations in one 2 MB file re-check in under 250 ms', (t) => {
  const text = Array.from({ length: 36_000 }, (_, i) => `const value${i} = compute(${i}, 'padding text');`).join('\n');
  assert.ok(text.length < 2 * 1024 * 1024 && text.length > 1.5 * 1024 * 1024, String(text.length));
  w('src/java/net/x/Huge.java', text);
  const first = [];
  for (let i = 0; i < 50; i++) first.push({ n: i + 1, path: 'src/java/net/x/Huge.java', line: i * 700 + 1, endLine: i * 700 + 5, quote: null, status: 'verified' });
  const seeded = reverify(nb.dir, first, nb.config.roots).citations;
  assert.ok(seeded.every((c) => c.saw));
  let ms = Infinity, r;
  for (let k = 0; k < 3; k++) {
    const t0 = performance.now();
    r = reverify(nb.dir, seeded, nb.config.roots);
    ms = Math.min(ms, performance.now() - t0);
  }
  assert.equal(r.summary.counts.verified, 50);
  assert.ok(ms < 250, `took ${ms.toFixed(1)} ms`);
  t.diagnostic(`50 line citations: ${ms.toFixed(1)} ms`);
});

// ---------- commits ----------

test('re-checks keep sha and dirty on a citation', async () => {
  w(bazFile, BAZ);
  const sha = 'b'.repeat(40);
  const stamped = turnOf('Handlers register here [[code/net/x/Baz.java#L4]].');
  Object.assign(stamped.citations[0], { sha, dirty: true });
  stamped.commits = { code: { sha, dirty: ['net/x/Baz.java'] } };
  const c = convOf('k1', [stamped]);
  assert.equal((await c.get()).turns[0].citations[0].sha, sha);
  w(bazFile, `// one\n// two\n${BAZ}`);
  const moved = (await c.get()).turns[0];
  assert.equal(moved.citations[0].status, 'moved');
  assert.equal(moved.citations[0].sha, sha);
  assert.equal(moved.citations[0].dirty, true);
  assert.deepEqual(moved.commits, { code: { sha, dirty: ['net/x/Baz.java'] } });
  const stored = JSON.parse(c.raw()).turns[0];
  assert.equal(stored.citations[0].sha, sha);
  assert.equal(stored.citations[0].dirty, true);
  w(bazFile, BAZ);
});

test('an old turn with no commits loads and has no sha anywhere', async () => {
  w(bazFile, BAZ);
  const c = convOf('k2', [turnOf('Handlers register here [[code/net/x/Baz.java#L4]].')]);
  const turn = (await c.get()).turns[0];
  assert.equal(turn.citations[0].status, 'verified');
  assert.ok(!('commits' in turn));
  assert.ok(!('sha' in turn.citations[0]));
  assert.ok(!('dirty' in turn.citations[0]));
  assert.ok(!c.raw().includes('"sha"'));
});
