import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupNotebook } from './helpers.mjs';

const env = setupNotebook();
const store = await import('../lib/store.mjs');
const sources = await import('../lib/sources.mjs');
test.after(() => env.cleanup());

test('registry resolves the notebook dir and config', () => {
  const nb = store.getNotebook('test');
  assert.equal(path.resolve(nb.dir), path.resolve(env.nbDir));
  assert.equal(nb.title, 'Test Notebook');
  assert.deepEqual(nb.config.roots, { code: 'src/java' });
  assert.equal(store.getNotebook('nope'), null);
});

test('conversation round-trip, rename and delete', () => {
  const nb = store.getNotebook('test');
  const c = store.newConversation(nb, 'x'.repeat(100));
  assert.equal(c.title.length, 60);
  c.turns.push({ question: 'q', answer: 'a' });
  store.saveConversation(nb, c);
  assert.deepEqual(store.getConversation(nb, c.id).turns, [{ question: 'q', answer: 'a' }]);
  assert.equal(store.listConversations(nb)[0].id, c.id);
  assert.equal(store.renameConversation(nb, c.id, 'Renamed').title, 'Renamed');
  assert.equal(store.deleteConversation(nb, c.id), true);
  assert.equal(store.getConversation(nb, c.id), null);
  assert.throws(() => store.getConversation(nb, '../evil'), /bad conversation id/);
});

test('conversation list carries citation counts and the worst status for History', () => {
  const nb = store.getNotebook('test');
  const c = store.newConversation(nb, 'counts');
  c.turns.push({ question: 'q1', answer: 'a', citations: [{ n: 1, status: 'verified' }, { n: 2, status: 'moved' }] });
  c.turns.push({ question: 'q2', answer: 'b', citations: [{ n: 1, status: 'verified' }] });
  store.saveConversation(nb, c);
  const row = store.listConversations(nb).find((x) => x.id === c.id);
  assert.equal(row.citations, 3);
  assert.equal(row.flag, 'moved');
  c.turns.push({ question: 'q3', answer: 'c', citations: [{ n: 1, status: 'missing' }] });
  store.saveConversation(nb, c);
  assert.equal(store.listConversations(nb).find((x) => x.id === c.id).flag, 'unverified');
  const plain = store.newConversation(nb, 'plain');
  plain.turns.push({ question: 'q', answer: 'a' });
  store.saveConversation(nb, plain);
  const p = store.listConversations(nb).find((x) => x.id === plain.id);
  assert.equal(p.citations, 0);
  assert.equal(p.flag, null);
  store.deleteConversation(nb, c.id);
  store.deleteConversation(nb, plain.id);
});

test('notes round-trip', () => {
  const nb = store.getNotebook('test');
  const n = store.saveNote(nb, { title: 'My: Note', body: '# Hi\n\nbody', fromConversation: 'abc' });
  assert.equal(n.slug, 'my-note');
  assert.equal(store.getNote(nb, 'my-note').title, 'My: Note');
  assert.equal(store.getNote(nb, 'my-note').body, '# Hi\n\nbody');
  assert.equal(store.saveNote(nb, { title: 'My: Note', body: 'two' }).slug, 'my-note-2');
  assert.equal(store.listNotes(nb).length, 2);
  assert.equal(store.deleteNote(nb, 'my-note'), true);
  assert.equal(store.listNotes(nb).length, 1);
});

test('createNotebook writes notebook.json under the home folder and registers it by absolute path', () => {
  const nb = store.createNotebook({ id: 'fresh', title: 'Fresh' });
  assert.ok(fs.existsSync(path.join(env.home, 'notebooks', 'fresh', 'notebook.json')));
  assert.equal(store.loadRegistry().notebooks.fresh.dir, path.join(env.home, 'notebooks', 'fresh').split(path.sep).join('/'));
  assert.equal(store.getNotebook('fresh').title, 'Fresh');
  assert.throws(() => store.createNotebook({ id: 'fresh' }), /already exists/);
  assert.throws(() => store.createNotebook({ id: '../x' }), /id must be/);
  assert.equal(nb.id, 'fresh');
});

test('createNotebook registers a folder anywhere', () => {
  const dir = path.join(env.root, 'elsewhere', 'mine');
  const nb = store.createNotebook({ id: 'mine', title: 'Mine', dir });
  assert.equal(nb.dir, dir);
  assert.equal(store.readConfig(dir).title, 'Mine');
});

test('shelf groups pinned docs like nb.mjs', async () => {
  const nb = store.getNotebook('test');
  const shelf = await sources.getShelf(nb);
  assert.deepEqual(shelf.summary.map((d) => d.title).sort(), ['docs', 'guide']);
  assert.equal(shelf.stats.files, 3);
  assert.match(sources.shelfStdin(shelf.docs), /<document title="guide">\n### FILE: docs\/guide\/a.md/);
});

test('file reads refuse escaping paths', () => {
  const nb = store.getNotebook('test');
  assert.equal(sources.readFile(nb, 'src/java/net/x/Foo.java').lang, 'java');
  assert.equal(sources.readFile(nb, 'docs/guide/a.md').lines, 7);
  for (const p of ['../outside.md', env.root + '/outside.md', '..\\outside.md']) {
    assert.throws(() => sources.readFile(nb, p), (e) => e.status === 403, p);
  }
  assert.throws(() => sources.tree(nb, 'code', '../..'), (e) => e.status === 403);
});

test('tree lists one level, dirs first', () => {
  const nb = store.getNotebook('test');
  assert.deepEqual(sources.tree(nb, 'code', '').entries, [{ name: 'net', type: 'dir', dir: 'net' }]);
  assert.deepEqual(sources.tree(nb, 'code', 'net/x').entries, [{ name: 'Foo.java', type: 'file', path: 'src/java/net/x/Foo.java' }]);
});

test('search finds hits in pinned docs and roots', async () => {
  const nb = store.getNotebook('test');
  const r = await sources.search(nb, 'payload');
  assert.deepEqual(r.hits.map((h) => `${h.path}:${h.line}`).sort(), ['docs/guide/a.md:4', 'docs/guide/a.md:6', 'src/java/net/x/Foo.java:4']);
  const rx = await sources.search(nb, 'Register\\w+Event', { regex: true });
  assert.equal(rx.hits.length, 1);
  assert.equal(rx.hits[0].line, 6);
  assert.equal((await sources.search(nb, 'outside the shelf')).hits.length, 0);
});

test('adding a file source and removing it', async () => {
  const nb = store.getNotebook('test');
  const r = await sources.addSource(nb, { kind: 'file', name: 'notes.md', base64: Buffer.from('# N\n').toString('base64') });
  assert.equal(r.path, 'sources/notes.md');
  assert.ok(store.getNotebook('test').config.pinned.includes('sources/**/*.md'));
  const bin = await sources.addSource(nb, { kind: 'file', name: 'x.json', base64: Buffer.from('{}').toString('base64') });
  assert.equal(bin.root, 'files');
  assert.equal(store.getNotebook('test').config.roots.files, 'sources/files');
  sources.removeSource(nb, { kind: 'root', value: 'files' });
  sources.removeSource(nb, { kind: 'pinned', value: 'sources/**/*.md' });
  assert.deepEqual(store.getNotebook('test').config.roots, { code: 'src/java' });
});

test('html fallback strips to markdown', () => {
  const { title, markdown } = sources.htmlToMarkdown('<html><head><title>T &amp; U</title><script>x()</script></head><body><h2>Head</h2><p>Para <code>a</code></p><ul><li>one</li></ul></body></html>');
  assert.equal(title, 'T & U');
  assert.match(markdown, /## Head/);
  assert.match(markdown, /Para `a`/);
  assert.match(markdown, /- one/);
  assert.doesNotMatch(markdown, /x\(\)/);
});
