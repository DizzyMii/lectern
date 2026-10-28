import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupNotebook } from './helpers.mjs';

const env = setupNotebook();
const store = await import('../lib/store.mjs');
const { savedCitations } = await import('../lib/check.mjs');
const { createServer } = await import('../lib/server.mjs');
const nb = store.getNotebook('test');
const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); env.cleanup(); });

const FOO = 'src/java/net/x/Foo.java';
const A_MD = 'docs/guide/a.md';
const QUOTE = 'Register handlers in RegisterPayloadHandlersEvent.';
const FOO_TEXT = 'package net.x;\n\npublic class Foo {\n  void payload() {}\n}\n';
const A_TEXT = '# Guide A\n\nhello world, this is the\nfirst   guide about payloads.\n\nRegister handlers in RegisterPayloadHandlersEvent.\n';
const created = '2026-01-01T00:00:00.000Z';

const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(nb.dir, rel)), { recursive: true }); fs.writeFileSync(path.join(nb.dir, rel), text); };
const cite = (n, p, line, endLine, extra = {}) => ({ n, path: p, line, endLine, quote: null, status: 'verified', ...extra });
const conv = (id, turns) => store.writeJson(path.join(nb.dir, 'conversations', `${id}.json`), { id, notebook: 'test', title: `title ${id}`, created, updated: created, turns });
const get = async (p) => { const r = await fetch(`${base}/api/notebooks/test/cited${p === undefined ? '' : '?path=' + encodeURIComponent(p)}`); return { status: r.status, body: await r.json() }; };

// every test starts from the same files and saved items
function seed() {
  for (const d of ['conversations', 'artifacts', 'notes']) fs.rmSync(path.join(nb.dir, d), { recursive: true, force: true });
  w(FOO, FOO_TEXT);
  w(A_MD, A_TEXT);
  conv('c1', [
    { question: 'How does Foo work?', citations: [cite(1, FOO, 3, 4), cite(2, A_MD, 6, 6, { quote: QUOTE })] },
    { question: 'And again?', citations: [cite(1, 'code/net/x/Foo.java', 4, 4)] },
  ]);
  store.writeJson(path.join(nb.dir, 'artifacts', 'a1.json'), {
    id: 'a1', kind: 'graph', recipe: 'code-map', title: 'Foo map', status: 'ok', createdAt: created, updatedAt: created,
    citations: [cite(1, FOO, 3, 3)],
    data: { nodes: [{ id: 'foo', label: 'Foo', ref: `${FOO}#L3`, refStatus: 'verified' }], drift: [{ ref: `${FOO}#L1` }] },
  });
  store.saveNote(nb, { title: 'Foo notes', body: `Foo is the entry point.[^1]\n\n[^1]: ${FOO}:3-4 "public class Foo" (verified)\n` });
}

test('saved answers, sheets and notes appear under the file they cite', async () => {
  seed();
  const { status, body } = await get(FOO);
  assert.equal(status, 200);
  assert.equal(body.path, FOO);
  assert.equal(body.truncated, false);
  const kinds = (k) => body.refs.filter((r) => r.kind === k);
  assert.deepEqual(kinds('answer').map((r) => [r.id, r.turn, r.n, r.line, r.endLine]), [['c1', 0, 1, 3, 4], ['c1', 1, 1, 4, 4]]);
  assert.equal(kinds('answer')[0].question, 'How does Foo work?');
  assert.equal(kinds('answer')[0].title, 'title c1');
  const sheet = kinds('sheet');
  assert.equal(sheet.length, 2);
  assert.deepEqual(sheet.filter((r) => r.node == null).map((r) => [r.id, r.recipe, r.n, r.line]), [['a1', 'code-map', 1, 3]]);
  assert.deepEqual(sheet.filter((r) => r.node != null).map((r) => [r.id, r.node, r.n, r.line]), [['a1', 'Foo', null, 3]]);
  assert.deepEqual(kinds('note').map((r) => [r.title, r.n, r.line, r.endLine]), [['Foo notes', 1, 3, 4]]);
  assert.equal(body.refs.length, 5);
  assert.ok(body.refs.every((r) => Number.isInteger(r.line) && r.status === 'verified'));
  assert.deepEqual(body.refs.map((r) => r.line), [...body.refs.map((r) => r.line)].sort((a, b) => a - b));
  // the other file only has its own citation
  assert.deepEqual((await get(A_MD)).body.refs.map((r) => [r.kind, r.id, r.n, r.line]), [['answer', 'c1', 2, 6]]);
});

test('a root shorthand lands on the same file', async () => {
  seed();
  const want = (await get(FOO)).body;
  const got = (await get('code/net/x/Foo.java')).body;
  assert.equal(got.path, FOO);
  assert.deepEqual(got.refs, want.refs);
  if (process.platform === 'win32') assert.deepEqual((await get('SRC/java/net/x/foo.java')).body.refs, want.refs);
});

test('status is current, and nothing is written', async () => {
  seed();
  w(FOO, 'package net.x;\n');
  w(A_MD, '# Guide A\n\nhello\n\n\n\n\n\n' + QUOTE + '\n');
  const files = ['conversations/c1.json', 'artifacts/a1.json', 'notes/foo-notes.md'];
  const before = files.map((f) => fs.readFileSync(path.join(nb.dir, f), 'utf8'));
  const foo = (await get(FOO)).body.refs;
  assert.equal(foo.length, 5);
  assert.ok(foo.every((r) => r.status === 'unverified'));
  const a = (await get(A_MD)).body.refs[0];
  assert.equal(a.status, 'moved');
  assert.equal(a.line, 9);
  assert.equal(a.citedLine, 6);
  assert.deepEqual(files.map((f) => fs.readFileSync(path.join(nb.dir, f), 'utf8')), before);
});

test('a warm index still re-checks statuses on every request', async () => {
  seed();
  assert.ok((await get(FOO)).body.refs.every((r) => r.status === 'verified'));
  assert.equal((await get(A_MD)).body.refs[0].status, 'verified');
  w(FOO, 'package net.x;\n');
  w(A_MD, '# Guide A\n\nhello\n\n\n\n\n\n' + QUOTE + '\n');
  assert.ok((await get(FOO)).body.refs.every((r) => r.status === 'unverified'));
  assert.equal((await get(A_MD)).body.refs[0].status, 'moved');
});

test('a citation saved while its file was missing is listed once the file exists', async () => {
  seed();
  const bar = 'src/java/net/x/Bar.java';
  conv('c3', [{ question: 'Bar?', citations: [cite(1, 'code/net/x/Bar.java', 1, 1, { status: 'missing' })] }]);
  assert.deepEqual((await get(bar)).body.refs.map((r) => [r.id, r.status]), [['c3', 'missing']]);
  w(bar, 'class Bar {}\n');
  assert.deepEqual((await get(bar)).body.refs.map((r) => [r.id, r.status]), [['c3', 'verified']]);
  fs.rmSync(path.join(nb.dir, bar));
});

test('a saved turn written by another process shows up on the next request', async () => {
  seed();
  assert.equal((await get(FOO)).body.refs.filter((r) => r.id === 'c2').length, 0);
  conv('c2', [{ question: 'from the CLI', citations: [cite(1, FOO, 2, 2)] }]);
  const withIt = (await get(FOO)).body.refs.filter((r) => r.id === 'c2');
  assert.deepEqual(withIt.map((r) => [r.turn, r.n, r.line]), [[0, 1, 2]]);
  fs.rmSync(path.join(nb.dir, 'conversations', 'c2.json'));
  assert.equal((await get(FOO)).body.refs.filter((r) => r.id === 'c2').length, 0);
});

test('bad paths', async () => {
  seed();
  assert.equal((await get()).status, 400);
  assert.equal((await get('../outside.md')).status, 403);
  assert.equal((await get(path.join(nb.dir, A_MD))).status, 403);
  const missing = await get('docs/nope.md');
  assert.equal(missing.status, 200);
  assert.deepEqual(missing.body, { path: 'docs/nope.md', refs: [], truncated: false });
});

test('old and broken saved data does not break the index', async () => {
  seed();
  conv('old', [{ question: 'q' }, null, { citations: null }, { citations: [null, 'x', { n: 1 }, cite(2, FOO, 3, 3)] }]);
  store.writeJson(path.join(nb.dir, 'conversations', 'shape.json'), { id: 'shape', turns: 'oops' });
  store.writeJson(path.join(nb.dir, 'artifacts', 'bad.json'), { id: 'bad', status: 'error' });
  store.writeJson(path.join(nb.dir, 'artifacts', 'odd.json'), { id: 'odd', citations: 'x', data: null });
  store.saveNote(nb, { title: 'Plain', body: 'no footnotes here\n' });
  fs.writeFileSync(path.join(nb.dir, 'conversations', 'junk.json'), 'not json {');
  const { status, body } = await get(FOO);
  assert.equal(status, 200);
  assert.equal(body.refs.length, 6);
  assert.deepEqual(body.refs.filter((r) => r.id === 'old').map((r) => [r.turn, r.n]), [[3, 2]]);
});

test('refs are capped', async () => {
  seed();
  fs.rmSync(path.join(nb.dir, 'artifacts'), { recursive: true, force: true });
  fs.rmSync(path.join(nb.dir, 'notes'), { recursive: true, force: true });
  conv('many', [{ question: 'q', citations: Array.from({ length: 600 }, (_, i) => cite(i + 1, FOO, 3, 3)) }]);
  const { body } = await get(FOO);
  assert.equal(body.refs.length, 500);
  assert.equal(body.truncated, true);
});

test('savedCitations walks answers, sheet citations, sheet data refs and note footnotes', () => {
  seed();
  const list = savedCitations(nb);
  const by = (k) => list.filter((x) => x.kind === k);
  assert.deepEqual(by('answer').map((x) => [x.id, x.turn, x.n, x.cite.path, x.cite.line]), [['c1', 0, 1, FOO, 3], ['c1', 0, 2, A_MD, 6], ['c1', 1, 1, 'code/net/x/Foo.java', 4]]);
  const sheet = by('sheet');
  assert.deepEqual(sheet.map((x) => [x.id, x.recipe, x.n, x.node ?? null]), [['a1', 'code-map', 1, null], ['a1', 'code-map', null, 'Foo']]);
  assert.equal(sheet[1].cite.path, FOO);
  assert.equal(sheet[1].cite.line, 3);
  assert.deepEqual(by('note').map((x) => [x.id, x.n, x.cite.path, x.cite.line, x.cite.endLine]), [['foo-notes', 1, FOO, 3, 4]]);
});
