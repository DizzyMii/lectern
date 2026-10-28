import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { setupNotebook } from './helpers.mjs';

const env = setupNotebook();
const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(env.nbDir, rel)), { recursive: true }); fs.writeFileSync(path.join(env.nbDir, rel), text); };
const FOO = 'package net.x;\n\npublic class Foo {\n  void payload() {}\n}\n';
const BAR = 'package net.x;\n\npublic class Bar {\n  int a;\n  int b;\n}\n';
w('src/java/net/x/Bar.java', BAR);

const store = await import('../lib/store.mjs');
const studio = await import('../lib/studio/engine.mjs');
const { processAnswer, changedSince } = await import('../lib/cite.mjs');
const watch = await import('../lib/watch.mjs');
const { createServer } = await import('../lib/server.mjs');
const nb = store.getNotebook('test');
const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
let live = null;
test.after(() => { live?.stop(); server.close(); env.cleanup(); });

const day = (n) => `2026-01-0${n}T00:00:00.000Z`;
const QUOTE = 'void payload() {}';
const { answer, citations } = processAnswer(nb.dir, `Foo has a handler [[code/net/x/Foo.java|"${QUOTE}"]].`, nb.config.roots);
const saveConv = (id, created, turns) => store.writeJson(path.join(nb.dir, 'conversations', `${id}.json`), { id, notebook: 'test', title: id, created, updated: created, turns });
saveConv('c0', day(1), []);
saveConv('c1', day(2), [{ question: 'q', answer, citations, startedAt: day(2), endedAt: day(2) }]);
const foo = (above = 0) => w('src/java/net/x/Foo.java', '// pad\n'.repeat(above) + FOO);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('changedSince finds the citations and refs a re-check changed after a time', () => {
  const a = { drift: [{ at: '2026-01-01T00:00:00.000Z' }, { at: '2026-03-01T00:00:00.000Z' }], n: 1 };
  const b = { drift: [{ at: '2026-02-01T00:00:00.000Z' }] };
  const c = { ref: 'x', drift: [{ at: '2026-04-01T00:00:00.000Z' }] };
  const tree = { citations: [a, b, 'text', null], data: { nodes: [{ id: 'n', child: c }] } };
  assert.deepEqual(changedSince(tree, '2026-02-15T00:00:00.000Z'), [a, c]);
  assert.deepEqual(changedSince(tree, '2027-01-01T00:00:00.000Z'), []);
  // the drift list itself is never walked: only the node that owns it is returned
  const inner = { at: '2026-09-01T00:00:00.000Z', drift: [{ at: '2026-09-01T00:00:00.000Z' }] };
  const holder = { drift: [inner] };
  assert.deepEqual(changedSince(holder, '2026-01-01T00:00:00.000Z'), [holder]);
  assert.deepEqual(changedSince('x', ''), []);
  assert.deepEqual(changedSince(null, ''), []);
});

test('recheckNotebook reports a moved quote, then stays quiet until something else changes', async () => {
  foo();
  assert.deepEqual(await watch.recheckNotebook(nb), []);
  foo(3);
  const found = await watch.recheckNotebook(nb);
  assert.equal(found.length, 1);
  const [item] = found;
  assert.equal(item.kind, 'answer');
  assert.equal(item.id, 'c1');
  assert.equal(item.n, 1);
  assert.equal(item.moved, true);
  assert.equal(item.label, 'Question 002');
  assert.equal(item.hash, '#/test/c1');
  assert.deepEqual(watch.unseenList(), [item]);
  assert.deepEqual(await watch.recheckNotebook(nb), []);
  assert.deepEqual(watch.unseenList(), [item]);
  const stored = JSON.parse(fs.readFileSync(path.join(nb.dir, 'conversations', 'c1.json'), 'utf8'));
  assert.ok(stored.turns[0].citations[0].drift.length >= 1);
});

test('a mended answer leaves the unseen list', async () => {
  foo();
  assert.deepEqual(await watch.recheckNotebook(nb), []);
  assert.deepEqual(watch.unseenList(), []);
});

test('a sheet whose data ref went stale is reported by its title', async () => {
  const p = studio.processStructured(nb, 'Summary.', { nodes: [{ id: 'bar', label: 'Bar fields', ref: 'code/net/x/Bar.java#L5' }] });
  studio.saveArtifact(nb, { id: 'a1', kind: 'graph', title: 'Bar fields', status: 'ok', createdAt: day(3), updatedAt: day(3), summary: p.summary, data: p.data, citations: p.citations });
  assert.deepEqual(await watch.recheckNotebook(nb), []);
  w('src/java/net/x/Bar.java', 'package net.x;\n');
  const found = await watch.recheckNotebook(nb);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'sheet');
  assert.equal(found[0].id, 'a1');
  assert.equal(found[0].label, 'Bar fields');
  assert.equal(found[0].hash, '#/test/artifact/a1');
  assert.equal(found[0].worse, 1);
  assert.equal(found[0].moved, false);
});

test('one odd conversation file does not stop the pass', async () => {
  store.writeJson(path.join(nb.dir, 'conversations', 'odd.json'), { id: '../x', title: 'odd', created: day(9), updated: day(9), turns: [{ citations: [{ n: 1, path: 'docs/intro.md', line: 1, status: 'verified' }] }] });
  foo(4);   // the cited line is 4 and a quote within two lines of it still counts as verified
  const found = await watch.recheckNotebook(nb);
  assert.deepEqual(found.map((i) => i.id), ['c1']);
  assert.equal(found[0].label, 'Question 002');
});

test('hashFor only builds hashes from ids that pass ID_RE', () => {
  assert.equal(watch.hashFor('test', 'answer', 'a b'), null);
  assert.equal(watch.hashFor('bad/nb', 'answer', 'x'), null);
  assert.equal(watch.hashFor('test', 'answer', undefined), null);
  assert.equal(watch.hashFor('test', 'answer', 'c1'), '#/test/c1');
  assert.equal(watch.hashFor('test', 'sheet', 'a1'), '#/test/artifact/a1');
});

test('describe says moved or changed with counts and carries no file text', () => {
  const item = (n, moved = true, label = 'Question 047') => ({ n, moved, label });
  const one = watch.describe({ title: 'Test Notebook' }, [item(3)]);
  assert.deepEqual(one, { title: 'Test Notebook', body: 'Moved 3 citations in Question 047' });
  assert.equal(watch.describe({ title: 't' }, [item(1)]).body, 'Moved 1 citation in Question 047');
  assert.equal(watch.describe({ title: 't' }, [item(2), item(3, true, 'Question 048')]).body, 'Moved 5 citations across 2 answers');
  assert.equal(watch.describe({ title: 't' }, [item(2), item(1, false)]).body, 'Changed 3 citations across 2 answers');
  assert.doesNotMatch(JSON.stringify(one), /payload/);
});

test('opening an answer through the API marks it seen', async () => {
  foo();
  w('src/java/net/x/Bar.java', BAR);
  await watch.recheckNotebook(nb);
  foo(4);
  w('src/java/net/x/Bar.java', 'package net.x;\n');
  const found = await watch.recheckNotebook(nb);
  assert.deepEqual(found.map((i) => i.kind).sort(), ['answer', 'sheet']);
  assert.equal(watch.unseenList().length, 2);

  await fetch(`${base}/api/conversations/test/c1`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'renamed' }) });
  await fetch(`${base}/api/notebooks/test/artifacts/a1/export`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(watch.unseenList().length, 2);

  let seen = 0;
  watch.watchEvents.on('unseen', () => { seen++; });
  assert.equal((await fetch(`${base}/api/conversations/test/c1`)).status, 200);
  assert.deepEqual(watch.unseenList().map((i) => i.kind), ['sheet']);
  assert.equal((await fetch(`${base}/api/notebooks/test/artifacts/a1`)).status, 200);
  assert.deepEqual(watch.unseenList(), []);
  assert.equal(seen, 2);
});

// a stand-in for fs.watch that hands the test each listener
function fakeWatch() {
  const calls = [];
  const watch = (dir, opts, fn) => {
    const watcher = new EventEmitter();
    watcher.close = () => { watcher.closed = true; };
    calls.push({ dir, opts, fn, watcher });
    return watcher;
  };
  return { calls, watch };
}
const codeRoot = path.join(env.nbDir, 'src', 'java');

test('startWatch folds a burst of saves into one pass and ignores dependency folders', async () => {
  const f = fakeWatch();
  const seen = [];
  const h = watch.startWatch({ onDrift() {}, watch: f.watch, recheck: async (n) => { seen.push(n.id); return []; }, wait: 30, every: 1e9 });
  assert.equal(f.calls.length, 1);
  assert.equal(path.resolve(f.calls[0].dir), codeRoot);
  assert.equal(f.calls[0].opts.recursive, true);
  const { fn } = f.calls[0];
  for (let i = 0; i < 5; i++) fn('change', 'src/A.java');
  fn('change', 'node_modules\\x\\y.js');
  fn('rename', '.git\\HEAD');
  await sleep(150);
  assert.deepEqual(seen, ['test']);
  h.stop();

  const g = fakeWatch();
  let passes = 0;
  const h2 = watch.startWatch({ onDrift() {}, watch: g.watch, recheck: async () => { passes++; return []; }, wait: 30, every: 1e9 });
  g.calls[0].fn('change', 'node_modules\\x\\y.js');
  g.calls[0].fn('change', '.git/HEAD');
  g.calls[0].fn('change', 'build/out/Foo.class');
  await sleep(120);
  assert.equal(passes, 0);
  h2.stop();
});

test('a drift pass reaches onDrift with the notebook and its items', async () => {
  const f = fakeWatch();
  const got = [];
  const item = { nb: 'test', kind: 'answer', id: 'c1', label: 'Question 002', n: 1, moved: true, worse: 1, hash: '#/test/c1' };
  const h = watch.startWatch({ onDrift: (n, items) => got.push([n.id, items]), watch: f.watch, recheck: async () => [item], wait: 20, every: 1e9 });
  f.calls[0].fn('change', null);   // a null name counts as a change
  await sleep(120);
  assert.deepEqual(got, [['test', [item]]]);
  h.stop();
});

test('startWatch still passes when events never go quiet', async () => {
  const f = fakeWatch();
  let passes = 0;
  const h = watch.startWatch({ onDrift() {}, watch: f.watch, recheck: async () => { passes++; return []; }, wait: 50, maxWait: 100, every: 1e9 });
  const timer = setInterval(() => f.calls[0].fn('change', 'src/log.txt'), 10);
  await sleep(300);
  clearInterval(timer);
  assert.ok(passes >= 1, 'a pass ran while the events kept coming');
  h.stop();
});

test('startWatch drops a watcher that errors and opens it again on the next sync', () => {
  const f = fakeWatch();
  const h = watch.startWatch({ onDrift() {}, watch: f.watch, recheck: async () => [], every: 1e9 });
  assert.equal(f.calls.length, 1);
  f.calls[0].watcher.emit('error', Object.assign(new Error('EPERM'), { code: 'EPERM' }));
  assert.equal(f.calls[0].watcher.closed, true);
  h.sync();
  assert.equal(f.calls.length, 2);
  h.sync();
  assert.equal(f.calls.length, 2);
  h.stop();
  assert.equal(f.calls[1].watcher.closed, true);
});

test('notebooks that share a root share one watcher and are both re-checked', async () => {
  const nb2 = path.join(env.root, 'nb2');
  fs.mkdirSync(nb2, { recursive: true });
  fs.writeFileSync(path.join(nb2, 'notebook.json'), JSON.stringify({ name: 'second', title: 'Second', roots: { code: '../nb/src/java' } }));
  const reg = JSON.parse(fs.readFileSync(env.registry, 'utf8'));
  fs.writeFileSync(env.registry, JSON.stringify({ notebooks: { ...reg.notebooks, second: { dir: nb2.split(path.sep).join('/'), title: 'Second', color: 'amber' } } }));
  try {
    const f = fakeWatch();
    const seen = [];
    const h = watch.startWatch({ onDrift() {}, watch: f.watch, recheck: async (n) => { seen.push(n.id); return []; }, wait: 20, every: 1e9 });
    assert.equal(f.calls.length, 1);
    f.calls[0].fn('change', 'net/x/Foo.java');
    await sleep(120);
    assert.deepEqual(seen.sort(), ['second', 'test']);
    h.stop();
  } finally {
    fs.writeFileSync(env.registry, JSON.stringify(reg));
  }
});

test('a real save in a code root reaches onDrift', async () => {
  foo();
  await watch.recheckNotebook(nb);
  assert.deepEqual(watch.unseenList(), []);
  const got = [];
  live = watch.startWatch({ onDrift: (n, items) => got.push(...items), wait: 50, every: 1e9 });
  await sleep(100);
  foo(5);
  for (let i = 0; i < 80 && !got.length; i++) await sleep(100);
  live.stop();
  live = null;
  assert.equal(got.length, 1);
  assert.equal(got[0].id, 'c1');
  assert.equal(got[0].moved, true);
});

test('startWatch lets go of a code root that was deleted and watches it again once it is back', async () => {
  const opened = [];
  const spy = (...a) => { const wt = fs.watch(...a); wt.closed = false; wt.on('close', () => { wt.closed = true; }); opened.push(wt); return wt; };
  let passes = 0;
  const h = watch.startWatch({ onDrift() {}, watch: spy, recheck: async () => { passes++; return []; }, wait: 30, maxWait: 100, every: 1e9 });
  assert.equal(opened.length, 1);
  fs.rmSync(codeRoot, { recursive: true, force: true });
  await sleep(300);
  h.sync();
  assert.equal(opened[0].closed, true, 'the dead watcher is closed');
  const after = passes;
  await sleep(400);
  assert.equal(passes, after, 'no passes keep coming from the dead handle');
  h.sync();
  assert.equal(opened.length, 1, 'nothing to open while the folder is missing');

  w('src/java/net/x/Bar.java', BAR);
  foo();
  h.sync();
  assert.equal(opened.length, 2);
  await sleep(100);
  foo(2);
  for (let i = 0; i < 50 && passes === after; i++) await sleep(100);
  assert.ok(passes > after, 'a save in the new folder starts a pass');
  h.stop();
});
