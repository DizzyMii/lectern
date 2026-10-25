import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupNotebook } from './helpers.mjs';

const env = setupNotebook();
const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(env.nbDir, rel)), { recursive: true }); fs.writeFileSync(path.join(env.nbDir, rel), text); };
w('docs/r.md', '# Recheck\n\nintro line\nthe quick brown fox jumps over the lazy dog\nlast line\n');
w('src/java/net/x/Bar.java', 'package net.x;\n\npublic class Bar {\n  int a;\n  int b;\n}\n');

const store = await import('../store.mjs');
const { processAnswer, reverify } = await import('../cite.mjs');
const studio = await import('../studio/engine.mjs');
const { createServer } = await import('../server.mjs');
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
  const c = (await import('../store.mjs')).getConversation(nb, 'c1', { recheck: true });
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
  studio.saveArtifact(nb, { id: 'a1', kind: 'graph', title: 'g', status: 'ok', createdAt: created, updatedAt: created, summary: p.summary, data: p.data, citations: p.citations });
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
