// Recall: saved answers, notes and sheets found by shared words, with citations re-checked and nothing written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupNotebook } from './helpers.mjs';

const env = setupNotebook();
const store = await import('../lib/store.mjs');
const studio = await import('../lib/studio/engine.mjs');
const { recall, tokens, score } = await import('../lib/recall.mjs');
const { recallParts, recallSub } = await import('../public/ui/recall.js');
const { createServer } = await import('../lib/server.mjs');
const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); env.cleanup(); });

const nb = () => store.getNotebook('test');
const convDir = path.join(env.nbDir, 'conversations');
const clean = () => {
  for (const d of ['conversations', 'notes', 'artifacts']) fs.rmSync(path.join(env.nbDir, d), { recursive: true, force: true });
  fs.rmSync(path.join(env.root, 'other', 'conversations'), { recursive: true, force: true });
};
const turn = (question, answer, citations = [], extra = {}) => ({ question, answer, citations, ...extra });
function conv(id, turns, extra = {}, dir = convDir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify({ id, notebook: 'test', title: id, created: '2026-01-01T00:00:00Z', updated: '2026-01-02T00:00:00Z', turns, ...extra }));
  return file;
}
const WELCOME = { n: 1, path: 'docs/intro.md', quote: 'Welcome.', line: 3, endLine: 3, status: 'verified' };

test('tokens drops stop words and splits on punctuation', () => {
  assert.deepEqual(tokens('How do I register the PayloadHandlers? neoforge.mods.toml'), new Set(['register', 'payloadhandlers', 'neoforge', 'mods', 'toml']));
  assert.ok(tokens('développeur').has('développeur'));
});

test('score ranks a reworded question above an unrelated one', () => {
  const q4 = tokens('where do payload handlers go in neoforge'), title = tokens('Where do payload handlers go?');
  assert.ok(Math.abs(score(q4, title, new Set()) - 0.87) < 0.01);
  assert.ok(Math.abs(score(tokens('payload handlers'), title, new Set()) - 0.82) < 0.01);
  assert.ok(score(q4, tokens('How are recipes registered?'), new Set()) < 0.2);
  // a longer word in the text satisfies the typed start, a short typed word needs the exact word
  assert.equal(score(tokens('attach'), new Set(), tokens('attachments'), { bodyMin: 1 }), 0.7);
  assert.equal(score(tokens('att'), new Set(), tokens('attachments'), { bodyMin: 1 }), 0);
  // a one-word match in the body alone counts for search and not for the composer
  assert.equal(score(tokens('attachments'), tokens('one two three four five six seven eight nine ten eleven twelve'), tokens('attachments here'), { bodyMin: 1 }), 0.7);
  assert.equal(score(tokens('attachments'), new Set(), tokens('attachments here'), { bodyMin: 4 }), 0);
  assert.equal(score(new Set(), new Set(['a']), new Set(['a'])), 0);
});

test('recall finds a saved answer by its question and re-checks its citations now', () => {
  clean();
  const file = conv('c1', [turn('Where do payload handlers go?', 'They go in the event [^1].', [WELCOME])]);
  const before = fs.readFileSync(file);
  const [hit, ...rest] = recall([nb()], 'where do the payload handlers go', { mode: 'hint' });
  assert.equal(rest.length, 0);
  assert.equal(hit.kind, 'answer');
  assert.equal(hit.turn, 0);
  assert.equal(hit.num, '001');
  assert.ok(hit.score >= 0.9);
  assert.deepEqual(hit.cites, { total: 1, verified: 1, moved: 0, unverified: 0, missing: 0 });
  assert.equal(hit.notebookTitle, 'Test Notebook');
  assert.match(hit.text, /\[\^1\]/);
  // the quote is gone from the file: the hit stays, its citation does not
  const intro = path.join(env.nbDir, 'docs/intro.md');
  const orig = fs.readFileSync(intro);
  fs.writeFileSync(intro, '# Intro\n\nHello there.\n');
  try {
    const [now] = recall([nb()], 'where do the payload handlers go', { mode: 'hint' });
    assert.equal(now.cites.unverified, 1);
    assert.equal(now.cites.verified, 0);
    assert.equal(now.citations[0].status, 'unverified');
  } finally { fs.writeFileSync(intro, orig); }
  assert.ok(fs.readFileSync(file).equals(before));
});

test('hint mode needs three words and a close question, search mode takes one word', () => {
  clean();
  conv('c1', [turn('Where do payload handlers go?', 'In the event.')]);
  assert.deepEqual(recall([nb()], 'payload', { mode: 'hint' }), []);
  assert.equal(recall([nb()], 'payload', { mode: 'search' })[0].id, 'c1');
  assert.deepEqual(recall([nb()], 'payload handlers', { mode: 'hint' }), []);
  assert.equal(recall([nb()], 'payload handlers', { mode: 'search' }).length, 1);
  assert.deepEqual(recall([nb()], 'what is the', { mode: 'search' }), []);
  assert.deepEqual(recall([nb()], 'how do recipes get registered', { mode: 'hint' }), []);
});

test('numbering matches the app', () => {
  clean();
  const t = (q) => [turn(q, 'An answer.')];
  conv('zz', t('numbered gamma question here'), { created: '2026-03-01T00:00:00Z' });
  conv('aa', t('numbered alpha question here'), { created: '2026-01-01T00:00:00Z' });
  conv('mm', t('numbered beta question here'), { created: '2026-02-01T00:00:00Z' });
  const by = Object.fromEntries(recall([nb()], 'numbered question here', { mode: 'search' }).map((h) => [h.id, h.num]));
  assert.deepEqual(by, { aa: '001', mm: '002', zz: '003' });
  // no created: updated stands in, and a conversation with no answered turn still takes a number
  conv('old', t('numbered delta question here'), { created: undefined, updated: '2025-12-01T00:00:00Z' });
  conv('empty', [], { created: '2026-02-15T00:00:00Z' });
  const again = Object.fromEntries(recall([nb()], 'numbered question here', { mode: 'search' }).map((h) => [h.id, h.num]));
  assert.deepEqual(again, { old: '001', aa: '002', mm: '003', zz: '005' });
});

test('recall reads every notebook and skip drops the open conversation', () => {
  clean();
  conv('c1', [turn('Where do payload handlers go?', 'In the event.')]);
  const otherDir = path.join(env.root, 'other');
  const other = store.createNotebook({ id: 'other', title: 'Other Book', dir: otherDir });
  conv('c1', [turn('Where should payload handlers go?', 'In the other event.')], {}, path.join(otherDir, 'conversations'));
  const nbs = store.listNotebooks();
  const hits = recall(nbs, 'where do payload handlers go', { mode: 'hint' });
  assert.deepEqual(hits.map((h) => [h.notebook, h.notebookTitle]).sort(), [['other', 'Other Book'], ['test', 'Test Notebook']]);
  const skipped = recall(nbs, 'where do payload handlers go', { mode: 'hint', skip: { notebook: 'test', id: 'c1' } });
  assert.deepEqual(skipped.map((h) => h.notebook), ['other']);
  const foreign = recall(nbs, 'where do payload handlers go', { mode: 'hint', skip: { notebook: 'elsewhere', id: 'c1' } });
  assert.equal(foreign.length, 2);
  assert.equal(other.id, 'other');
});

test('a conversation appears once, with its best turn', () => {
  clean();
  conv('c1', [turn('Where do payload handlers go?', 'A.'), turn('Where do payload handlers go in neoforge?', 'B.'), turn('Anything about recipes at all?', 'C.')]);
  const hits = recall([nb()], 'where do payload handlers go in neoforge', { mode: 'search' });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].turn, 1);
});

test('notes and sheets are searched, sheets that did not validate are not', () => {
  clean();
  store.saveNote(nb(), { title: 'Lifecycle events', body: 'Mod events fire in order.' });
  studio.saveArtifact(nb(), { id: 'a-ok', recipe: 'cheat-sheet', kind: 'doc', status: 'ok', title: 'Cheats', summary: 'Everything about lifecycle ordering.', markdown: '# Cheats', citations: [WELCOME], createdAt: '2026-01-01T00:00:00Z' });
  studio.saveArtifact(nb(), { id: 'a-bad', recipe: 'cheat-sheet', kind: 'doc', status: 'invalid', title: 'Cheats too', summary: 'Everything about lifecycle ordering.', markdown: '', citations: [] });
  const all = recall([nb()], 'lifecycle', { mode: 'search' });
  assert.deepEqual(all.map((h) => `${h.kind}:${h.id}`).sort(), ['note:lifecycle-events', 'sheet:a-ok']);
  const note = all.find((h) => h.kind === 'note'), sheet = all.find((h) => h.kind === 'sheet');
  assert.equal(note.cites, null);
  assert.equal(note.num, null);
  assert.equal(sheet.cites.verified, 1);
  assert.equal(recall([nb()], 'lifecycle', { mode: 'search', kinds: ['note'] }).length, 1);
  assert.equal(recall([nb()], 'lifecycle', { mode: 'search', limit: 1 }).length, 1);
  assert.equal(recall([nb()], 'lifecycle', { mode: 'search', kinds: ['note', 'bogus'] }).length, 1);
  assert.deepEqual(recall([nb()], 'lifecycle', { mode: 'search', kinds: ['bogus'] }), []);
});

test('old and odd files do not break it', () => {
  clean();
  conv('plain', [{ question: 'Where do payload handlers go?', answer: 'In the event.' }], { created: undefined });
  fs.writeFileSync(path.join(convDir, 'junk.json'), 'not json {');
  fs.writeFileSync(path.join(convDir, 'list.json'), '[]');
  fs.mkdirSync(path.join(env.nbDir, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(env.nbDir, 'notes', 'bare.md'), 'Just words about payload handlers, no front matter.');
  const hits = recall([nb()], 'payload handlers', { mode: 'search' });
  const answer = hits.find((h) => h.kind === 'answer'), note = hits.find((h) => h.kind === 'note');
  assert.equal(answer.id, 'plain');
  assert.deepEqual(answer.cites, { total: 0, verified: 0, moved: 0, unverified: 0, missing: 0 });
  assert.equal(answer.at, '2026-01-02T00:00:00Z');
  assert.equal(note.id, 'bare');
  assert.equal(note.title, 'bare');
  // a notebook whose folder is gone is empty, not an error
  assert.deepEqual(recall([{ id: 'gone', title: 'Gone', dir: path.join(env.root, 'nowhere'), config: { roots: {} } }], 'payload handlers'), []);
});

test('a changed file is picked up and a deleted one drops out', () => {
  clean();
  const file = conv('c1', [turn('Where do payload handlers go?', 'In the event.')]);
  assert.equal(recall([nb()], 'payload handlers', { mode: 'search' }).length, 1);
  fs.writeFileSync(file, JSON.stringify({ id: 'c1', created: 'x', turns: [turn('How are recipes serialized?', 'With codecs.')] }));
  const t = new Date(Date.now() + 5000);
  fs.utimesSync(file, t, t);
  assert.equal(recall([nb()], 'payload handlers', { mode: 'search' }).length, 0);
  assert.equal(recall([nb()], 'recipes serialized', { mode: 'search' })[0].id, 'c1');
  fs.unlinkSync(file);
  assert.deepEqual(recall([nb()], 'recipes serialized', { mode: 'search' }), []);
});

test('recallParts wording follows the receipt', () => {
  const hit = (cites, extra = {}) => ({ kind: 'answer', num: '044', notebook: 'test', notebookTitle: 'NeoForge 1.21.1', title: 't', cites, ...extra });
  assert.deepEqual(recallParts(hit({ total: 9, verified: 9, moved: 0, unverified: 0, missing: 0 }), 'test'), { status: 'verified', text: 'Asked before: Question 044. 9 citations, all still verified.' });
  assert.equal(recallParts(hit({ total: 1, verified: 1 }), 'test').text, 'Asked before: Question 044. 1 citation, still verified.');
  assert.deepEqual(recallParts(hit({ total: 9, verified: 7, moved: 1, unverified: 1 }), 'test'), { status: 'unverified', text: 'Asked before: Question 044. 9 citations: 7 verified, 1 moved, 1 unverified.' });
  assert.equal(recallParts(hit({ total: 2, verified: 1, moved: 0, unverified: 0, missing: 1 }), 'test').text, 'Asked before: Question 044. 2 citations: 1 verified, 1 unverified.');
  assert.deepEqual(recallParts(hit({ total: 2, verified: 1, moved: 1, unverified: 0, missing: 0 }), 'test'), { status: 'moved', text: 'Asked before: Question 044. 2 citations: 1 verified, 1 moved.' });
  assert.equal(recallParts(hit({ total: 9, verified: 9 }), 'other').text, 'Asked before: Question 044 in NeoForge 1.21.1. 9 citations, all still verified.');
  assert.deepEqual(recallParts(hit(null), 'test'), { status: null, text: 'Asked before: Question 044. No citations.' });
  assert.deepEqual(recallParts(hit({ total: 0, verified: 0 }), 'test'), { status: null, text: 'Asked before: Question 044. No citations.' });
  assert.equal(recallSub(hit({ total: 9, verified: 8, moved: 0, unverified: 1, missing: 0 }), 'test'), '8 verified, 1 unverified');
  assert.equal(recallSub(hit({ total: 9, verified: 9 }), 'other'), 'NeoForge 1.21.1 · 9 verified');
  assert.equal(recallSub(hit(null), 'test'), 'no citations');
  assert.equal(recallSub({ kind: 'note', notebook: 'test', notebookTitle: 'T', cites: null }, 'test'), 'note');
  assert.equal(recallSub({ kind: 'sheet', notebook: 'x', notebookTitle: 'Other', cites: { total: 1, verified: 1 } }, 'test'), 'Other · sheet');
});

test('two ids on one folder each get their own tag and skip', () => {
  clean();
  conv('c1', [turn('Where do payload handlers go?', 'They go in the event.')]);
  const reg = fs.readFileSync(env.registry);
  try {
    store.createNotebook({ id: 'again', title: 'Same folder', dir: env.nbDir });
    const q = 'where do payload handlers go', both = store.listNotebooks();
    assert.deepEqual(recall(both, q, { mode: 'hint', limit: 5 }).map((h) => h.notebook).sort(), ['again', 'test']);
    assert.deepEqual(recall([store.getNotebook('again')], q, { mode: 'hint' }).map((h) => h.notebook), ['again']);
    assert.deepEqual(recall(both, q, { mode: 'hint', skip: { notebook: 'again', id: 'c1' } }).map((h) => h.notebook), ['test']);
  } finally { fs.writeFileSync(env.registry, reg); }
});

test('recall route finds a saved answer, honours mode and skip, and refuses a blank query', async () => {
  clean();
  conv('c1', [turn('Where do payload handlers go?', 'They go in the event [^1].', [WELCOME])]);
  const get = (qs, headers) => fetch(`${base}/api/recall${qs}`, { headers });
  const r = await get('?q=where%20do%20the%20payload%20handlers%20go&mode=hint&nb=test');
  assert.equal(r.status, 200);
  const { hits } = await r.json();
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'c1');
  assert.equal(hits[0].num, '001');
  assert.equal(hits[0].notebookTitle, 'Test Notebook');
  assert.equal(hits[0].cites.verified, 1);
  assert.equal('text' in hits[0], false);
  assert.equal('citations' in hits[0], false);
  const skipped = await (await get('?q=where%20do%20the%20payload%20handlers%20go&mode=hint&nb=test&skip=c1')).json();
  assert.deepEqual(skipped.hits, []);
  assert.equal((await get('')).status, 400);
  assert.equal((await get('?q=%20')).status, 400);
  for (let i = 0; i < 34; i++) conv(`m${i}`, [turn(`Payload handler question ${i}?`, 'Answer.')]);
  assert.equal((await (await get('?q=payload&limit=1000')).json()).hits.length, 30);
  assert.equal(recall([nb()], 'payload', { limit: 1000 }).length, 30);
  assert.equal((await (await get('?q=payload&kinds=note')).json()).hits.length, 0);
  assert.equal((await get('?q=payload', { origin: 'https://evil.example' })).status, 403);
});
