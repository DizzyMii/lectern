import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setupNotebook } from './helpers.mjs';

const env = setupNotebook();
test.after(() => env.cleanup());
const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'lectern.mjs');

const store = await import('../lib/store.mjs');
const studio = await import('../lib/studio/engine.mjs');
const { processAnswer, parseFootnotes, fileCache, rank } = await import('../lib/cite.mjs');
const { checkNotebook, formatReport, failing, savedCitations } = await import('../lib/check.mjs');
const nb = store.getNotebook('test');

const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(nb.dir, rel)), { recursive: true }); fs.writeFileSync(path.join(nb.dir, rel), text); };
const A_MD = '# Guide A\n\nhello world, this is the\nfirst   guide about payloads.\n\nRegister handlers in RegisterPayloadHandlersEvent.\n';
const FOO = 'package net.x;\n\npublic class Foo {\n  void payload() {}\n}\n';
const QUOTE = 'Register handlers in RegisterPayloadHandlersEvent.';
const created = '2026-01-01T00:00:00.000Z';
const WRITTEN = 'D:/p/CLAUDE.md';

// every test starts from the same files, saved items and notes
function seed() {
  w('docs/guide/a.md', A_MD);
  w('src/java/net/x/Foo.java', FOO);
  fs.rmSync(path.join(nb.dir, 'notes'), { recursive: true, force: true });
  const { answer, citations } = processAnswer(nb.dir, `Handlers [[docs/guide/a.md|"${QUOTE}"]] and Foo [[code/net/x/Foo.java#L3-L5]].`, nb.config.roots);
  store.writeJson(path.join(nb.dir, 'conversations', 'c1.json'), { id: 'c1', notebook: 'test', title: 'How do payloads work', created, updated: created, turns: [{ question: 'q', answer, citations, startedAt: created, endedAt: created }] });
  const doc = processAnswer(nb.dir, 'Welcome [[docs/intro.md|"Welcome."]]', nb.config.roots);
  studio.saveArtifact(nb, { id: 'a1', kind: 'doc', recipe: 'overview', title: 'Intro sheet', status: 'ok', createdAt: created, updatedAt: created, markdown: `# Intro\n\n${doc.answer}`, citations: doc.citations });
  const file = processAnswer(nb.dir, 'Foo [[code/net/x/Foo.java#L4]]', nb.config.roots);
  studio.saveArtifact(nb, { id: 'a2', kind: 'file', recipe: 'claude-md', title: 'CLAUDE.md', status: 'ok', createdAt: created, updatedAt: created, writtenTo: WRITTEN, data: { filename: 'CLAUDE.md', content: 'x' }, citations: file.citations });
  const p = studio.processStructured(nb, 'Graph', { nodes: [{ id: 'foo', label: 'Foo', ref: 'code/net/x/Foo.java#L4', drift: [{ at: created, status: 'verified', ref: 'src/java/net/x/Foo.java#L1' }] }] });
  studio.saveArtifact(nb, { id: 'a3', kind: 'graph', recipe: 'code-map', title: 'Map', status: 'ok', createdAt: created, updatedAt: created, summary: p.summary, data: p.data, citations: p.citations });
  store.saveNote(nb, { title: 'Baseline', body: 'x\n\n[^1]: docs/intro.md "Welcome." (verified)\n' });
}

const holderOf = (r, kind) => r.worse.filter((h) => h.holder.kind === kind);
const bytes = () => ['conversations/c1.json', 'artifacts/a1.json', 'artifacts/a2.json', 'artifacts/a3.json'].map((f) => fs.readFileSync(path.join(nb.dir, f), 'utf8')).join('\n');

test('parseFootnotes reads both styles', () => {
  const text = [
    '[^1]: docs/a.md:6 (verified)',
    '[^2]: docs/a.md:3-5 (moved)',
    '[^3]: src/Foo.java#L3 (unverified)',
    '[^4]: src/Foo.java#L3-L5 (missing)',
    '[^5]: docs/a.md "just a quote" (verified)',
    '[^6]: docs/a.md:6 "he said "hi" there" (verified)',
    '[^7]: C:/x/Foo.java:12-14 (verified)',
  ].join('\r\n');
  const got = parseFootnotes(text).map((f) => [f.n, f.path, f.line, f.endLine, f.quote, f.status0]);
  assert.deepEqual(got, [
    [1, 'docs/a.md', 6, 6, null, 'verified'],
    [2, 'docs/a.md', 3, 5, null, 'moved'],
    [3, 'src/Foo.java', 3, 3, null, 'unverified'],
    [4, 'src/Foo.java', 3, 5, null, 'missing'],
    [5, 'docs/a.md', null, null, 'just a quote', 'verified'],
    [6, 'docs/a.md', 6, 6, 'he said "hi" there', 'verified'],
    [7, 'C:/x/Foo.java', 12, 14, null, 'verified'],
  ]);
});

test('parseFootnotes ignores what is not ours', () => {
  const text = '[^1]: https://example.com (2020)\n[^2]: See the README (verified)\n```\n[^3]: docs/a.md:6 (verified)\n```\n[^4]: docs/a.md:6 (maybe)\n';
  assert.deepEqual(parseFootnotes(text), []);
  assert.deepEqual(parseFootnotes(null), []);
});

test('the Studio doc export round-trips through parseFootnotes', () => {
  seed();
  const { answer, citations } = processAnswer(nb.dir, `A [[docs/guide/a.md#L6|"${QUOTE}"]] and B [[code/net/x/Foo.java#L3-L5]].`, nb.config.roots);
  const a = { id: 'x', kind: 'doc', title: 'Doc', status: 'ok', markdown: `# Doc\n\n${answer}`, citations };
  const parsed = parseFootnotes(studio.exportArtifact(a, 'markdown').text);
  assert.equal(parsed.length, 2);
  citations.forEach((c, i) => {
    assert.deepEqual([parsed[i].n, parsed[i].path, parsed[i].line, parsed[i].endLine, parsed[i].quote, parsed[i].status0], [c.n, c.path, c.line, c.endLine, c.quote, c.status]);
  });
});

test('a clean notebook reports nothing worse', () => {
  seed();
  const r = checkNotebook(nb);
  assert.deepEqual(r.scanned, { conversations: 1, sheets: 3, notes: 1, files: 0 });
  assert.equal(r.total, 2 + 1 + 1 + 1 + 1);
  assert.equal(Object.values(r.counts).reduce((a, b) => a + b, 0), r.total);
  assert.equal(r.counts.verified, r.total);
  assert.deepEqual(r.worse, []);
  assert.equal(r.badAtBirth, 0);
  const t = formatReport(r);
  assert.match(t, /^check test: 1 conversation, 3 sheets, 1 note, 0 files, 6 citations\n6 verified, 0 moved, 0 unverified, 0 missing/);
  assert.ok(t.endsWith('Nothing got worse.'));
  assert.equal(rank('moved'), 1);
});

test('a moved quote is a hit with the old and new line', () => {
  seed();
  w('docs/guide/a.md', `${A_MD.split('\n').slice(0, 2).join('\n')}\nnew 1\nnew 2\nnew 3\n${A_MD.split('\n').slice(2).join('\n')}`);
  const r = checkNotebook(nb);
  assert.equal(r.worse.length, 1);
  const h = r.worse[0];
  assert.deepEqual([h.file, h.was, h.status, h.wasLine, h.line], ['docs/guide/a.md', 'verified', 'moved', 6, 9]);
  assert.deepEqual(h.holder, { kind: 'answer', id: 'c1', title: 'How do payloads work', turn: 0, n: 1 });
  assert.match(formatReport(r), /docs\/guide\/a\.md\n {2}was verified at L6, now moved to L9 {2}conversation c1 turn 1 \[\^1\] "Register handlers in RegisterPayloadHandlersEvent."/);
  assert.match(formatReport(r), /\n1 citation got worse\./);
});

test('a shrunk code file and a deleted file are hits', () => {
  seed();
  w('src/java/net/x/Foo.java', 'package net.x;\n');
  fs.rmSync(path.join(nb.dir, 'docs/guide/a.md'));
  const r = checkNotebook(nb);
  const doc = r.worse.find((h) => h.file === 'docs/guide/a.md');
  const code = r.worse.find((h) => h.holder.kind === 'answer' && h.file === 'src/java/net/x/Foo.java');
  assert.equal(doc.status, 'missing');
  assert.deepEqual([code.status, code.was, code.wasLine, code.wasEndLine], ['unverified', 'verified', 3, 5]);
  for (const level of ['unverified', 'moved']) {
    const f = failing(r, level);
    assert.ok(f.includes(doc) && f.includes(code), level);
  }
  assert.match(formatReport(r), /was verified at L3-L5, now unverified {2}conversation c1 turn 1 \[\^2\]/);
});

test('sheets: citations, writtenTo and data refs', () => {
  seed();
  assert.equal(savedCitations(nb).filter((x) => x.id === 'a3').length, 1, 'drift entries are not refs');
  w('src/java/net/x/Foo.java', 'package net.x;\n');
  const r = checkNotebook(nb);
  const sheets = holderOf(r, 'sheet');
  const written = sheets.find((h) => h.holder.id === 'a2');
  assert.equal(written.holder.writtenTo, WRITTEN);
  assert.match(formatReport(r), new RegExp(`sheet a2 "CLAUDE\\.md" \\(written to ${WRITTEN.replace('.', '\\.')}\\) \\[\\^1\\]`));
  const ref = sheets.find((h) => h.holder.id === 'a3');
  assert.equal(ref.holder.ref, true);
  assert.equal('n' in ref.holder, false);
  assert.deepEqual([ref.was, ref.status, ref.wasLine], ['verified', 'unverified', 4]);
  assert.match(formatReport(r), /sheet a3 "Map" \(data ref\)/);
});

test('notes: both footnote styles are re-checked against the written status', () => {
  seed();
  store.saveNote(nb, { title: 'Mine', body: `Text.\n\n[^1]: docs/guide/a.md:6 "${QUOTE}" (verified)\n[^2]: src/java/net/x/Foo.java#L3-L5 (verified)\n` });
  store.saveNote(nb, { title: 'Born bad', body: '[^1]: docs/guide/a.md "nothing like this here" (unverified)\n' });
  assert.equal(checkNotebook(nb).worse.length, 0);
  assert.equal(checkNotebook(nb).badAtBirth, 1);
  w('docs/guide/a.md', '# Guide A\n\nsomething else now\n');
  const r = checkNotebook(nb);
  const hits = holderOf(r, 'note');
  assert.equal(hits.length, 1);
  assert.deepEqual([hits[0].holder.id, hits[0].holder.n, hits[0].status, hits[0].was], ['mine', 1, 'unverified', 'verified']);
  assert.equal(r.badAtBirth, 1);
  assert.match(formatReport(r), /\n1 more was already moved, unverified or missing when written, and is not counted\./);
});

test('named files: footnotes are checked, files without any are listed', () => {
  seed();
  w('src/java/net/x/Foo.java', 'package net.x;\n');
  const r = checkNotebook(nb, { files: [{ name: 'docs/x.md', text: '[^1]: src/java/net/x/Foo.java:3-5 (verified)\n' }, { name: 'CLAUDE.md', text: '# no footnotes' }] });
  assert.equal(r.scanned.files, 2);
  const hit = holderOf(r, 'file');
  assert.equal(hit.length, 1);
  assert.deepEqual(hit[0].holder, { kind: 'file', id: 'docs/x.md', title: 'docs/x.md', n: 1 });
  assert.deepEqual(r.empty, ['CLAUDE.md']);
  assert.ok(formatReport(r).endsWith('No Lectern footnotes in: CLAUDE.md'));
});

test('the check never writes, and a stray conversation file does not stop it', () => {
  seed();
  store.writeJson(path.join(nb.dir, 'conversations', 'odd.json'), { id: '../odd', title: 'odd', updated: created, turns: [{ citations: [{ n: 1, path: 'docs/intro.md', quote: 'Welcome.', status: 'verified' }] }] });
  w('src/java/net/x/Foo.java', 'package net.x;\n');
  w('docs/guide/a.md', 'gone\n');
  const before = bytes();
  const r = checkNotebook(nb);
  assert.ok(r.worse.length >= 3);
  assert.equal(r.scanned.conversations, 2);
  assert.equal(bytes(), before);
  // the normal re-check still stamps drift into the file
  store.getConversation(nb, 'c1', { recheck: true });
  assert.notEqual(bytes(), before);
  fs.rmSync(path.join(nb.dir, 'conversations', 'odd.json'));
});

test('getConversation and getArtifact use a cache passed in', () => {
  seed();
  let cache = fileCache();
  store.getConversation(nb, 'c1', { recheck: true, cache });
  assert.ok(cache.files.size > 0);
  cache = fileCache();
  studio.getArtifact(nb, 'a2', { recheck: true, cache });
  assert.ok(cache.files.size > 0);
});

function cli(...args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { env: { ...process.env, LECTERN_HOME: env.home }, encoding: 'utf8', windowsHide: true });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('CLI exit codes', () => {
  seed();
  let r = cli('check', 'test', '--fail-on', 'unverified');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Nothing got worse\./);
  // only a quote moved: unverified passes, moved fails, no flag passes
  w('docs/guide/a.md', `# Guide A\n\nnew 1\nnew 2\nnew 3\nnew 4\n${A_MD.split('\n').slice(2).join('\n')}`);
  assert.equal(cli('check', 'test', '--fail-on', 'unverified').code, 0);
  r = cli('check', 'test', '--fail-on', 'moved');
  assert.equal(r.code, 1);
  assert.match(r.err, /^1 citation fails --fail-on moved/);
  assert.equal(cli('check', 'test').code, 0);
  // a code file shrinking is unverified
  w('src/java/net/x/Foo.java', 'package net.x;\n');
  r = cli('check', 'test', '--fail-on', 'unverified');
  assert.equal(r.code, 1);
  assert.match(r.err, /citations fail --fail-on unverified/);
  assert.equal(cli('check', 'test').code, 0);
  // usage errors are 2 and short
  assert.equal(cli('check', 'test', '--fail-on').code, 2);
  r = cli('check', 'test', '--fail-on', 'nope');
  assert.equal(r.code, 2);
  assert.ok(!r.err.includes('usage:'), r.err);
  assert.match(r.err, /unknown --fail-on level "nope": use moved or unverified/);
  assert.equal(cli('check', 'nope').code, 2);
  assert.equal(cli('check', 'test', path.join(env.root, 'no-such-file.md')).code, 2);
  assert.equal(cli('check').code, 2);
  const j = JSON.parse(cli('check', 'test', '--fail-on', 'moved', '--json').out);
  assert.equal(j.failOn, 'moved');
  assert.ok(j.failing >= 2);
  assert.equal(j.worse.length, j.failing);
  // a named file is read from disk
  const f = path.join(env.root, 'design.md');
  fs.writeFileSync(f, '[^1]: src/java/net/x/Foo.java:3-5 (verified)\n');
  r = cli('check', 'test', f, '--json');
  assert.equal(JSON.parse(r.out).scanned.files, 1);
});

// a small client for `lectern mcp`
function mcp() {
  const child = spawn(process.execPath, [BIN, 'mcp'], { env: { ...process.env, LECTERN_HOME: env.home }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const waiting = new Map();
  readline.createInterface({ input: child.stdout }).on('line', (l) => { const m = JSON.parse(l); waiting.get(m.id)?.(m); });
  let next = 1;
  const request = (method, params) => new Promise((resolve) => { const id = next++; waiting.set(id, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  return { child, request, call: async (name, args) => (await request('tools/call', { name, arguments: args })).result };
}

test('check_notebook over MCP', async () => {
  seed();
  w('docs/guide/fn.md', '# Notes\n\n[^1]: src/java/net/x/Foo.java:3-5 (verified)\n');
  const srv = mcp();
  test.after(() => srv.child.kill());
  await srv.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  const { tools } = (await srv.request('tools/list', {})).result;
  const t = tools.find((x) => x.name === 'check_notebook');
  assert.equal(t.inputSchema.additionalProperties, false);
  assert.deepEqual(t.inputSchema.required, ['notebook']);
  assert.equal(t.annotations.readOnlyHint, true);
  let r = await srv.call('check_notebook', { notebook: 'test' });
  assert.ok(!r.isError, r.content[0].text);
  assert.deepEqual(r.structuredContent.worse, []);
  w('src/java/net/x/Foo.java', 'package net.x;\n');
  r = await srv.call('check_notebook', { notebook: 'test', files: ['docs/guide/fn.md'] });
  assert.ok(!r.isError, r.content[0].text);
  assert.ok(r.structuredContent.worse.length >= 3);
  assert.ok(r.structuredContent.worse.some((h) => h.holder.kind === 'file' && h.holder.id === 'docs/guide/fn.md'));
  assert.match(r.content[0].text, /^check test: /);
  for (const p of ['../outside.md', path.join(env.root, 'outside.md')]) {
    const bad = await srv.call('check_notebook', { notebook: 'test', files: [p] });
    assert.equal(bad.isError, true, p);
    assert.match(bad.content[0].text, /escapes the notebook/, p);
  }
  const secret = await srv.call('check_notebook', { notebook: 'test', files: ['secret.txt'] });
  assert.equal(secret.isError, true);
  assert.match(secret.content[0].text, /not a pinned doc or a code-root file/);
});
