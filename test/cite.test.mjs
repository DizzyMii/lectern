import test from 'node:test';
import assert from 'node:assert/strict';
import { setupNotebook } from './helpers.mjs';

const env = setupNotebook();
const { parseCitations, verify, processAnswer } = await import('../lib/cite.mjs');
const roots = { code: 'src/java' };
test.after(() => env.cleanup());

test('parses the three citation forms', () => {
  const c = parseCitations('a [[x/y.java#L12]] b [[x/y.java#L12-L20]] c [[docs/a.md|"some quote"]] d [[docs/a.md#L3|“curly”]]');
  assert.deepEqual(c.map(({ path, line, endLine, quote }) => ({ path, line, endLine, quote })), [
    { path: 'x/y.java', line: 12, endLine: 12, quote: null },
    { path: 'x/y.java', line: 12, endLine: 20, quote: null },
    { path: 'docs/a.md', line: null, endLine: null, quote: 'some quote' },
    { path: 'docs/a.md', line: 3, endLine: 3, quote: 'curly' },
  ]);
});

test('verified: line range exists', () => {
  const v = verify(env.nbDir, { path: 'src/java/net/x/Foo.java', line: 3, endLine: 5 }, roots);
  assert.equal(v.status, 'verified');
});

test('verified: quote found with whitespace normalised, line filled in', () => {
  const v = verify(env.nbDir, { path: 'docs/guide/a.md', quote: 'this is the first guide' }, roots);
  assert.equal(v.status, 'verified');
  assert.equal(v.line, 3);
  assert.equal(v.endLine, 4);
});

test('quotes are case-sensitive', () => {
  assert.equal(verify(env.nbDir, { path: 'docs/guide/a.md', quote: 'Hello World' }, roots).status, 'unverified');
});

test('moved: quote found away from the cited line', () => {
  const v = verify(env.nbDir, { path: 'docs/guide/a.md', line: 40, endLine: 40, quote: 'RegisterPayloadHandlersEvent' }, roots);
  assert.equal(v.status, 'moved');
  assert.equal(v.line, 6);
});

test('unverified: file exists, quote not found, or line out of range', () => {
  assert.equal(verify(env.nbDir, { path: 'docs/guide/a.md', quote: 'not in here at all' }, roots).status, 'unverified');
  assert.equal(verify(env.nbDir, { path: 'src/java/net/x/Foo.java', line: 50, endLine: 60 }, roots).status, 'unverified');
});

test('missing: no such file, or outside the notebook', () => {
  assert.equal(verify(env.nbDir, { path: 'docs/nope.md', quote: 'x' }, roots).status, 'missing');
  assert.equal(verify(env.nbDir, { path: '../outside.md', quote: 'not in the notebook' }, roots).status, 'missing');
  assert.equal(verify(env.nbDir, { path: env.root + '/outside.md', line: 1 }, roots).status, 'missing');
});

test('root-name shorthand resolves to the root path', () => {
  const v = verify(env.nbDir, { path: 'code/net/x/Foo.java', line: 3, endLine: 3 }, roots);
  assert.equal(v.status, 'verified');
  assert.equal(v.path, 'src/java/net/x/Foo.java');
});

test('processAnswer numbers citations, dedupes and rewrites markers', () => {
  const text = 'One [[docs/guide/a.md|"hello world"]]. Two [[src/java/net/x/Foo.java#L3]]. Again [[docs/guide/a.md|"hello world"]]. Bad [[nope.md#L1]].';
  const { answer, citations } = processAnswer(env.nbDir, text, roots);
  assert.equal(answer, 'One [^1]. Two [^2]. Again [^1]. Bad [^3].');
  assert.deepEqual(citations.map((c) => [c.n, c.status]), [[1, 'verified'], [2, 'verified'], [3, 'missing']]);
  assert.equal(citations[0].line, 3);
});

test('a path whose first segment is a built-in object member is missing, not an error', () => {
  for (const p of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const r = processAnswer(env.nbDir, `x [[${p}/a.md#L1]]`, roots);
    assert.deepEqual(r.citations.map((c) => c.status), ['missing'], p);
  }
});
