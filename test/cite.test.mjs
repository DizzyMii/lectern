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

// ---------- saved lines ----------

const { readsByFile, validSaw, reverify } = await import('../lib/cite.mjs');
const { readSpan, readTool } = await import('../lib/shelf.mjs');
const fs = await import('node:fs');
const nodePath = await import('node:path');
const FOO = 'src/java/net/x/Foo.java';
const foo = nodePath.join(env.nbDir, FOO);
const FOO_TEXT = 'package net.x;\n\npublic class Foo {\n  void payload() {}\n}\n';
const cite = (extra = {}) => ({ path: FOO, line: 3, endLine: 4, ...extra });

test('a line citation saves the lines it cites, trimmed of blank ends', () => {
  const v = verify(env.nbDir, { path: FOO, line: 2, endLine: 4 }, roots);
  assert.equal(v.status, 'verified');
  assert.deepEqual(v.saw, { from: 3, to: 4, text: 'public class Foo {\n  void payload() {}' });
});

test('saved lines in the same place stay verified through indentation and line-ending changes', () => {
  const saw = verify(env.nbDir, cite(), roots).saw;
  fs.writeFileSync(foo, 'package net.x;\r\n\r\npublic class Foo {\r\n    void payload() {}\r\n}\r\n');
  try {
    const v = verify(env.nbDir, cite({ saw }), roots);
    assert.equal(v.status, 'verified');
    assert.equal(v.saw, saw);
  } finally { fs.writeFileSync(foo, FOO_TEXT); }
});

test('the same lines further down come back moved at the new line', () => {
  const saw = verify(env.nbDir, cite(), roots).saw;
  fs.writeFileSync(foo, `a\nb\nc\nd\ne\n${FOO_TEXT}`);
  try {
    const v = verify(env.nbDir, cite({ saw }), roots);
    assert.equal(v.status, 'moved');
    assert.equal(v.line, 8);
    assert.equal(v.endLine, 9);
    assert.equal(v.citedLine, 3);
  } finally { fs.writeFileSync(foo, FOO_TEXT); }
});

test('rewritten lines are unverified and keep the cited line', () => {
  const saw = verify(env.nbDir, cite(), roots).saw;
  fs.writeFileSync(foo, FOO_TEXT.replace('payload', 'handler'));
  try {
    const v = verify(env.nbDir, cite({ saw }), roots);
    assert.equal(v.status, 'unverified');
    assert.equal(v.line, 3);
    assert.equal(v.saw, saw);
  } finally { fs.writeFileSync(foo, FOO_TEXT); }
});

test('an inserted code line inside the block is a rewrite, an inserted blank line is not', () => {
  const saw = verify(env.nbDir, cite(), roots).saw;
  try {
    fs.writeFileSync(foo, 'package net.x;\n\npublic class Foo {\n  int x;\n  void payload() {}\n}\n');
    assert.equal(verify(env.nbDir, cite({ saw }), roots).status, 'unverified');
    fs.writeFileSync(foo, 'package net.x;\n\npublic class Foo {\n\n  void payload() {}\n}\n');
    assert.equal(verify(env.nbDir, cite({ saw }), roots).status, 'verified');
  } finally { fs.writeFileSync(foo, FOO_TEXT); }
});


test('with two copies the one nearest the saved place wins', () => {
  const block = 'public class Foo {\n  void payload() {}';
  const gap = (n) => 'x\n'.repeat(n);
  try {
    // copies now start at 10 and 30
    fs.writeFileSync(foo, `${gap(9)}${block}\n${gap(18)}${block}\n`);
    let v = verify(env.nbDir, { path: FOO, line: 26, endLine: 27, saw: { from: 26, to: 27, text: block } }, roots);
    assert.deepEqual([v.status, v.line, v.endLine], ['moved', 30, 31]);
    // equidistant from 20: the earlier one
    v = verify(env.nbDir, { path: FOO, line: 20, endLine: 21, saw: { from: 20, to: 21, text: block } }, roots);
    assert.deepEqual([v.status, v.line], ['moved', 10]);
  } finally { fs.writeFileSync(foo, FOO_TEXT); }
});

test('a block shorter than 12 characters is never called moved', () => {
  const saw = verify(env.nbDir, { path: FOO, line: 5, endLine: 5 }, roots).saw;
  assert.equal(saw.text, '}');
  try {
    fs.writeFileSync(foo, `x\n${FOO_TEXT}}\n`);
    assert.equal(verify(env.nbDir, { path: FOO, line: 5, endLine: 5, saw }, roots).status, 'unverified');
    // still verified when it has not moved
    fs.writeFileSync(foo, `${FOO_TEXT}}\n`);
    assert.equal(verify(env.nbDir, { path: FOO, line: 5, endLine: 5, saw }, roots).status, 'verified');
  } finally { fs.writeFileSync(foo, FOO_TEXT); }
});

test('nothing is saved for blank ranges, and a long range keeps 120 lines with cut', () => {
  const BIG = 'src/java/net/x/Big.java';
  const big = nodePath.join(env.nbDir, BIG);
  fs.writeFileSync(big, `a\n\n\n\n${Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n')}\n`);
  const blank = verify(env.nbDir, { path: BIG, line: 2, endLine: 3 }, roots);
  assert.equal(blank.status, 'verified');
  assert.ok(!('saw' in blank));
  const long = verify(env.nbDir, { path: BIG, line: 5, endLine: 204 }, roots);
  assert.equal(long.saw.from, 5);
  assert.equal(long.saw.to, 124);
  assert.equal(long.saw.cut, true);
  assert.equal(long.saw.text.split('\n').length, 120);
  // a few very long lines stop at the character cap
  fs.writeFileSync(big, `${'y'.repeat(5000)}\n${'z'.repeat(5000)}\nend\n`);
  const wide = verify(env.nbDir, { path: BIG, line: 1, endLine: 3 }, roots);
  assert.deepEqual([wide.saw.to, wide.saw.cut], [1, true]);
  // a first line over the cap saves nothing
  fs.writeFileSync(big, `${'y'.repeat(9000)}\nend\n`);
  assert.ok(!('saw' in verify(env.nbDir, { path: BIG, line: 1, endLine: 2 }, roots)));
});

test('a citation with no saved lines still verifies by range and gets a fresh capture', () => {
  const v = verify(env.nbDir, cite({ saw: { text: 7 } }), roots);
  assert.equal(v.status, 'verified');
  assert.equal(v.saw.text, 'public class Foo {\n  void payload() {}');
  assert.equal(validSaw({ text: 7, from: 1 }), null);
  assert.equal(validSaw({ text: '  ', from: 1 }), null);
  assert.equal(verify(env.nbDir, { path: FOO, line: 40, endLine: 41 }, roots).status, 'unverified');
});

test('processAnswer saves lines and read ranges', () => {
  const text = 'See [[src/java/net/x/Foo.java#L2-L4]].';
  const reads = readsByFile(env.nbDir, [{ name: 'Read', input: { file_path: foo, offset: 1, limit: 5 } }], roots);
  assert.deepEqual(processAnswer(env.nbDir, text, roots, { reads }).citations[0].saw.read, [[1, 5]]);
  assert.deepEqual(processAnswer(env.nbDir, text, roots, { reads: new Map() }).citations[0].saw.read, []);
  assert.ok(!('read' in processAnswer(env.nbDir, text, roots).citations[0].saw));
});

test('readsByFile handles both engines', () => {
  const intro = nodePath.join(env.nbDir, 'docs/intro.md');
  const calls = [
    { name: 'Read', input: { file_path: foo, offset: 2, limit: 3 } },
    { name: 'Read', input: { file_path: intro } },
    { name: 'read', input: { root: 'code', path: 'net/x/Foo.java', start: 1, end: 5 } },
    { name: 'read', input: { root: 'code', path: 'net/x/Foo.java', start: 10, end: 12 } },
    { name: 'read', input: { root: 'code', path: 'net/x/Foo.java', start: 13, end: 20 } },
    { name: 'Read', ok: false, input: { file_path: foo, offset: 100, limit: 5 } },
    { name: 'Read' },
    { name: 'read', input: { root: 'nope', path: 'net/x/Foo.java' } },
    { name: 'read', input: { root: 'constructor', path: 'x' } },
    { name: 'read', input: { root: 'code', path: 7 } },
    { name: 'Read', input: { file_path: 7 } },
    null,
  ];
  const m = readsByFile(env.nbDir, calls, roots);
  const rangesOf = (p) => m.get(process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p)?.ranges;
  assert.deepEqual(rangesOf(foo), [[1, 5], [10, 20]]);
  assert.deepEqual(rangesOf(intro), [[1, 2000]]);
  assert.equal(m.size, 2);
  assert.equal(readsByFile(env.nbDir, undefined).size, 0);
  assert.deepEqual([...readsByFile(env.nbDir, [calls[0]]).values()][0].ranges, [[2, 4]]);
});

test('readSpan matches readTool', () => {
  assert.deepEqual(readSpan(), [1, 200]);
  assert.deepEqual(readSpan(10, 900), [10, 309]);
  assert.deepEqual(readSpan(0, 3), [1, 3]);
  const dir = nodePath.join(env.nbDir, 'src/java');
  const span = (o) => { const r = readTool(dir, { path: 'net/x/Foo.java', ...o }); return [r.start, r.end]; };
  assert.deepEqual(span({}), [1, 6]);
  assert.deepEqual(span({ start: 2, end: 3 }), [2, 3]);
  assert.deepEqual(span({ start: 4, end: 900 }), [4, 6]);
});

test('reverify stamps read ranges once and writes a baseline for saved citations without lines', () => {
  const reads = readsByFile(env.nbDir, [{ name: 'Read', input: { file_path: foo, offset: 3, limit: 3 } }], roots);
  const first = reverify(env.nbDir, [{ n: 1, path: FOO, line: 3, endLine: 4, quote: null, status: 'verified' }], roots, { reads });
  const c = first.citations[0];
  assert.equal(c.saw.base, true);
  assert.deepEqual(c.saw.read, [[3, 5]]);
  assert.equal(first.dirty, true);
  const again = reverify(env.nbDir, first.citations, roots, { reads });
  assert.equal(again.dirty, false);
  assert.equal(again.citations[0].saw, c.saw);
});

// ---------- line counts ----------

const { whyNot } = await import('../lib/cite.mjs');
const lineFile = (name, text) => { fs.writeFileSync(nodePath.join(env.nbDir, 'src/java', name), text); return `src/java/${name}`; };
const at = (p, line, endLine = line) => verify(env.nbDir, { path: p, line, endLine }, roots);

test('the last line of a file ending in a newline verifies and the line after it does not', () => {
  const p = lineFile('Three.txt', 'one\ntwo\nthree\n');
  assert.equal(at(p, 3).status, 'verified');
  assert.equal(at(p, 4).status, 'unverified');
  assert.equal(at(p, 2, 4).status, 'unverified');
  assert.equal(whyNot(env.nbDir, { path: p, line: 4 }, at(p, 4), roots), `is past the end of ${p} (3 lines)`);
});

test('a file with no final newline has the same line count', () => {
  const p = lineFile('Bare.txt', 'one\ntwo\nthree');
  assert.equal(at(p, 3).status, 'verified');
  assert.equal(at(p, 4).status, 'unverified');
});

test('CRLF files count the same lines', () => {
  const p = lineFile('Crlf.txt', 'one\r\ntwo\r\nthree\r\n');
  assert.equal(at(p, 3).status, 'verified');
  assert.equal(at(p, 4).status, 'unverified');
});

test('an empty file has no lines to cite', () => {
  const p = lineFile('Empty.txt', '');
  assert.equal(at(p, 1).status, 'unverified');
  assert.equal(whyNot(env.nbDir, { path: p, line: 1 }, at(p, 1), roots), `is past the end of ${p} (0 lines)`);
});

test('a file of one blank line has one line', () => {
  const p = lineFile('Blank.txt', '\n');
  assert.equal(at(p, 1).status, 'verified');
  assert.equal(at(p, 2).status, 'unverified');
});

test('a moved range is clamped to the last real line', () => {
  const p = lineFile('Moved.txt', 'a\n'.repeat(5) + 'alpha beta gamma\ndelta epsilon zeta\n');
  const saw = { from: 1, to: 2, text: 'alpha beta gamma\ndelta epsilon zeta' };
  const v = verify(env.nbDir, { path: p, line: 1, endLine: 20, saw }, roots);
  assert.equal(v.status, 'moved');
  assert.equal(v.endLine, 7);
});
