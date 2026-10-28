import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { setupNotebook } from './helpers.mjs';

const hasGit = spawnSync('git', ['--version'], { windowsHide: true }).status === 0;
const env = setupNotebook();
process.env.LECTERN_PUBLIC_ORIGINS = 'https://box.tail0000.ts.net';
process.env.LECTERN_ALLOW_USERS = 'me@example.com';
const { snapshotRoots, stampCitations, locate, fileAt, changesSince } = await import('../lib/history.mjs');
const store = await import('../lib/store.mjs');
const studio = await import('../lib/studio/engine.mjs');
const { createServer } = await import('../lib/server.mjs');
const { ask } = await import('../lib/engine.mjs');
test.after(() => env.cleanup());

const sh = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const put = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const commit = (dir, msg) => { sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', msg); return sh(dir, 'rev-parse', 'HEAD'); };
const FOO = ['package net.x;', '', 'public class Foo {', '  void a() {}', '  void b() {}', '}', ''];
const foo = (edit = {}) => FOO.map((l, i) => edit[i + 1] ?? l).join('\n');

// a bare notebook object is all history.mjs needs: a dir and the roots
function scratch(rootRel, repoRel = rootRel) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lectern-hist-'));
  const nb = { dir, config: { roots: { code: rootRel } } };
  const repo = path.resolve(dir, repoRel);
  fs.mkdirSync(repo, { recursive: true });
  return { nb, dir, repo, root: path.resolve(dir, rootRel) };
}
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const made = [];
const mk = (...a) => { const s = scratch(...a); made.push(s.dir); return s; };

const skip = hasGit ? false : 'git is not installed';
const t = (name, fn) => test(name, { skip }, fn);

// repo at the root folder: Foo.java with three commits, Bar.java alongside
function repoWithHistory() {
  const s = mk('src/java');
  sh(s.repo, 'init', '-q');
  put(s.root, 'net/x/Foo.java', foo());
  put(s.root, 'net/x/Bar.java', 'class Bar {}\n');
  const c1 = commit(s.repo, 'first');
  put(s.root, 'net/x/Foo.java', foo({ 5: '  void b2() {}' }));
  const c2 = commit(s.repo, 'rename b');
  put(s.root, 'net/x/Foo.java', foo({ 4: '  void a2() {}', 5: '  void b2() {}' }));
  const c3 = commit(s.repo, 'rename a');
  put(s.root, 'net/x/Bar.java', 'class Bar { int x; }\n');
  const c4 = commit(s.repo, 'touch bar');
  return { ...s, c1, c2, c3, c4 };
}

t('snapshotRoots records HEAD for a root that holds a cited file', async () => {
  const s = repoWithHistory();
  const commits = await snapshotRoots(s.nb, ['code/net/x/Foo.java']);
  assert.equal(commits.code.sha, sh(s.repo, 'rev-parse', 'HEAD'));
  assert.deepEqual(commits.code.dirty, []);
  // reads give absolute paths
  assert.equal((await snapshotRoots(s.nb, [path.join(s.root, 'net/x/Bar.java')])).code.sha, s.c4);
  assert.equal(await snapshotRoots(s.nb, ['docs/guide/a.md']), null);
});

t('an edited cited file is dirty, and stampCitations flags the citation', async () => {
  const s = repoWithHistory();
  put(s.root, 'net/x/Foo.java', foo({ 3: 'public class Foo2 {' }));
  const commits = await snapshotRoots(s.nb, ['code/net/x/Foo.java', 'code/net/x/Bar.java']);
  assert.deepEqual(commits.code.dirty, ['net/x/Foo.java']);
  const cites = [{ path: 'code/net/x/Foo.java', line: 3 }, { path: 'code/net/x/Bar.java', line: 1 }, { path: 'docs/a.md', line: 1 }];
  stampCitations(s.nb, cites, commits);
  assert.equal(cites[0].sha, s.c4);
  assert.equal(cites[0].dirty, true);
  assert.equal(cites[1].sha, s.c4);
  assert.ok(!('dirty' in cites[1]));
  assert.ok(!('sha' in cites[2]));
  stampCitations(s.nb, cites, null); // nothing to do, nothing thrown
});

t('a root below the repo top is recorded with root-relative paths', async () => {
  const s = mk('src/java', 'src');
  sh(s.repo, 'init', '-q');
  put(s.repo, 'top.txt', 'x\n');
  put(s.root, 'net/x/Foo.java', foo());
  const c1 = commit(s.repo, 'first');
  put(s.root, 'net/x/Foo.java', foo({ 4: '  void z() {}' }));
  put(s.repo, 'top.txt', 'changed\n');
  const commits = await snapshotRoots(s.nb, ['code/net/x/Foo.java']);
  assert.equal(commits.code.sha, c1);
  assert.deepEqual(commits.code.dirty, ['net/x/Foo.java']);
  assert.equal((await fileAt(s.nb, 'code/net/x/Foo.java', c1)).text, foo());
  const c2 = commit(s.repo, 'second');
  const ch = await changesSince(s.nb, 'code/net/x/Foo.java', c1, 4, 4);
  assert.deepEqual(ch.commits.map((c) => c.sha), [c2]);
});

t('roots outside git, empty repos and repos whose config runs programs give no record and do not throw', async () => {
  const plain = mk('src/java');
  put(plain.root, 'net/x/Foo.java', foo());
  assert.equal(await snapshotRoots(plain.nb, ['code/net/x/Foo.java']), null);
  const empty = mk('src/java');
  sh(empty.repo, 'init', '-q');
  put(empty.root, 'net/x/Foo.java', foo());
  assert.equal(await snapshotRoots(empty.nb, ['code/net/x/Foo.java']), null);
  const risky = repoWithHistory();
  assert.ok((await snapshotRoots(risky.nb, ['code/net/x/Foo.java'])).code);
  fs.appendFileSync(path.join(risky.repo, '.git', 'config'), '[core]\n\tfsmonitor = true\n');
  assert.equal(await snapshotRoots(risky.nb, ['code/net/x/Foo.java']), null);
  await assert.rejects(fileAt(risky.nb, 'code/net/x/Foo.java', risky.c1), /runs programs/);
});

test('locate ignores paths outside a root and resolves files that are gone', () => {
  const nb = { dir: path.resolve(env.nbDir), config: { roots: { code: 'src/java' } } };
  for (const p of ['../x', 'src/../x', 'C:/x', '/etc/passwd', 'docs/guide/a.md', ':(top)x', 'code\\..\\..\\x', '', '  ', 'code', 'src/java', 'secret.txt', 'code/../secret.txt']) {
    assert.equal(locate(nb, p), null, JSON.stringify(p));
  }
  const dir = path.resolve(env.nbDir, 'src/java');
  assert.deepEqual(locate(nb, 'src/java/net/x/Foo.java'), { root: 'code', dir, rel: 'net/x/Foo.java' });
  assert.deepEqual(locate(nb, 'code/net/x/Gone.java'), { root: 'code', dir, rel: 'net/x/Gone.java' });
  assert.deepEqual(locate(nb, 'code\\net\\x\\Gone.java'), { root: 'code', dir, rel: 'net/x/Gone.java' });
  assert.deepEqual(locate(nb, './code/net/x/Foo.java'), { root: 'code', dir, rel: 'net/x/Foo.java' });
  assert.deepEqual(locate(nb, path.join(dir, 'net', 'x', 'Foo.java')), { root: 'code', dir, rel: 'net/x/Foo.java' });
  // the longest root wins when roots nest, and a root of '.' picks up the pinned docs
  const nested = { dir: nb.dir, config: { roots: { all: '.', code: 'src/java' } } };
  assert.equal(locate(nested, 'src/java/net/x/Foo.java').root, 'code');
  assert.deepEqual(locate(nested, 'docs/guide/a.md'), { root: 'all', dir: nb.dir, rel: 'docs/guide/a.md' });
});

t('fileAt returns the file as of the commit, not as it is now', async () => {
  const s = repoWithHistory();
  assert.equal((await fileAt(s.nb, 'code/net/x/Foo.java', s.c1)).text, foo());
  const now = await fileAt(s.nb, 'code/net/x/Foo.java', s.c4);
  assert.equal(now.text, foo({ 4: '  void a2() {}', 5: '  void b2() {}' }));
  assert.deepEqual({ root: now.root, rel: now.rel, sha: now.sha, truncated: now.truncated, binary: now.binary }, { root: 'code', rel: 'net/x/Foo.java', sha: s.c4, truncated: false, binary: false });
  // deleted since, still readable at the old commit
  sh(s.repo, 'rm', '-q', 'net/x/Bar.java');
  const c5 = commit(s.repo, 'drop bar');
  assert.equal((await fileAt(s.nb, 'code/net/x/Bar.java', s.c4)).text, 'class Bar { int x; }\n');
  await assert.rejects(fileAt(s.nb, 'code/net/x/Bar.java', c5), (e) => e.status === 404 && /that file is not in commit/.test(e.message));
  // a directory is refused, and so is a path outside every root
  await assert.rejects(fileAt(s.nb, 'code/net/x', s.c1), (e) => e.status === 404);
  await assert.rejects(fileAt(s.nb, 'docs/guide/a.md', s.c1), (e) => e.status === 404 && /not inside a code root/.test(e.message));
  // binary
  fs.writeFileSync(path.join(s.root, 'blob.bin'), Buffer.from([1, 0, 2, 0, 3]));
  const c6 = commit(s.repo, 'bin');
  const bin = await fileAt(s.nb, 'code/blob.bin', c6);
  assert.equal(bin.binary, true);
  assert.equal(bin.text, '');
});

t('fileAt and changesSince refuse anything but a full lowercase hex sha', async () => {
  const s = repoWithHistory();
  const head = s.c4;
  for (const bad of ['HEAD', '--output=x', 'abc123', head.slice(0, 39), head + 'a', head.toUpperCase(), 'main', 'master', '', undefined, `${head}..HEAD`]) {
    await assert.rejects(fileAt(s.nb, 'code/net/x/Foo.java', bad), (e) => e.status === 400, String(bad));
    await assert.rejects(changesSince(s.nb, 'code/net/x/Foo.java', bad, 3, 3), (e) => e.status === 400, String(bad));
  }
});

t('changesSince lists the commits since that touched the lines, newest first', async () => {
  const s = repoWithHistory();
  const lines = async (a, b, since = s.c1) => (await changesSince(s.nb, 'code/net/x/Foo.java', since, a, b));
  const four = await lines(4, 4);
  assert.equal(four.by, 'lines');
  assert.deepEqual(four.commits.map((c) => c.sha), [s.c3]);
  assert.equal(four.commits[0].short, s.c3.slice(0, 7));
  assert.equal(four.commits[0].subject, 'rename a');
  assert.equal(four.commits[0].author, 't');
  assert.match(four.commits[0].date, /^\d{4}-\d\d-\d\d$/);
  assert.equal(four.truncated, false);
  assert.equal(four.dirtyNow, false);
  // both commits touched lines 4 to 5, and the newest comes first; Bar's commit is not listed
  assert.deepEqual((await lines(4, 5)).commits.map((c) => c.sha), [s.c3, s.c2]);
  assert.deepEqual((await lines(1, 2)).commits, []);
  assert.deepEqual((await lines(4, 5, s.c2)).commits.map((c) => c.sha), [s.c3]);
  // an end line below the start is a single line
  assert.deepEqual((await lines(5, 1)).commits.map((c) => c.sha), [s.c2]);
});

t('changesSince falls back to the path and reports delete and rename', async () => {
  const s = repoWithHistory();
  // past the end of the file: the lines cannot be asked for, the path can
  const past = await changesSince(s.nb, 'code/net/x/Foo.java', s.c1, 90, 99);
  assert.equal(past.by, 'path');
  assert.deepEqual(past.commits.map((c) => [c.sha, c.change]), [[s.c3, 'M'], [s.c2, 'M']]);
  assert.equal((await changesSince(s.nb, 'code/net/x/Foo.java', s.c1, null, null)).by, 'path');
  // renamed
  sh(s.repo, 'mv', 'net/x/Bar.java', 'net/x/Baz.java');
  const c5 = commit(s.repo, 'rename bar');
  const ren = await changesSince(s.nb, 'code/net/x/Bar.java', s.c1, 1, 1);
  assert.equal(ren.by, 'path');
  assert.deepEqual(ren.commits.map((c) => [c.sha, c.change]), [[c5, 'R'], [s.c4, 'M']]);
  assert.equal(ren.commits[0].to, 'net/x/Baz.java');
  // deleted
  sh(s.repo, 'rm', '-q', 'net/x/Baz.java');
  const c6 = commit(s.repo, 'drop baz');
  const gone = await changesSince(s.nb, 'code/net/x/Baz.java', c5, 1, 1);
  assert.deepEqual(gone.commits.map((c) => [c.sha, c.change]), [[c6, 'D']]);
  // added since
  put(s.root, 'net/x/New.java', 'class New {}\n');
  const c7 = commit(s.repo, 'add new');
  assert.deepEqual((await changesSince(s.nb, 'code/net/x/New.java', c6, null, null)).commits.map((c) => [c.sha, c.change]), [[c7, 'A']]);
});

t('changesSince with sha equal to HEAD returns no commits, runs no log, and reports dirtyNow when the file has edits', async () => {
  const s = repoWithHistory();
  const clean = await changesSince(s.nb, 'code/net/x/Foo.java', s.c4, 3, 3);
  assert.deepEqual({ commits: clean.commits, by: clean.by, dirtyNow: clean.dirtyNow, truncated: clean.truncated }, { commits: [], by: 'lines', dirtyNow: false, truncated: false });
  put(s.root, 'net/x/Foo.java', foo({ 3: 'public class Foo2 {' }));
  assert.equal((await changesSince(s.nb, 'code/net/x/Foo.java', s.c4, 3, 3)).dirtyNow, true);
  assert.equal((await changesSince(s.nb, 'code/net/x/Bar.java', s.c4, 1, 1)).dirtyNow, false);
});

t('a sha that is not in the repo is a 404', async () => {
  const s = repoWithHistory();
  const nope = 'f'.repeat(40);
  await assert.rejects(fileAt(s.nb, 'code/net/x/Foo.java', nope), (e) => e.status === 404 && /is not in this repo any more/.test(e.message));
  await assert.rejects(changesSince(s.nb, 'code/net/x/Foo.java', nope, 3, 3), (e) => e.status === 404 && /is not in this repo any more/.test(e.message));
  await assert.rejects(changesSince(s.nb, 'code/net/x/Foo.java', nope, null, null), (e) => e.status === 404);
});

// ---------- through the server ----------

const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
test.after(() => server.close());
const get = (p, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: p, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
    let b = '';
    res.on('data', (d) => { b += d; });
    res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
  }).on('error', reject);
});

// the test notebook's own root becomes a repo
let nbHead;
const nbRoot = path.join(env.nbDir, 'src/java');
function repoInNotebook() {
  if (nbHead) return nbHead;
  sh(nbRoot, 'init', '-q');
  nbHead = commit(nbRoot, 'first');
  return nbHead;
}

t('history routes work for localhost and are refused for the tailnet host', async () => {
  const sha = repoInNotebook();
  const was = `/api/notebooks/test/history/was?path=${encodeURIComponent('code/net/x/Foo.java')}&sha=${sha}`;
  const ok = await get(was);
  assert.equal(ok.status, 200);
  assert.match(ok.body.text, /public class Foo/);
  const ch = await get(`/api/notebooks/test/history/changes?path=${encodeURIComponent('code/net/x/Foo.java')}&sha=${sha}&line=3&endLine=3`);
  assert.equal(ch.status, 200);
  assert.deepEqual(ch.body.commits, []);
  const away = { host: 'box.tail0000.ts.net', 'tailscale-user-login': 'me@example.com' };
  for (const u of [was, `/api/notebooks/test/history/changes?path=x&sha=${sha}`]) {
    const r = await get(u, away);
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'history can only be read on this machine');
  }
  assert.equal((await get(`/api/notebooks/test/history/was?path=code/net/x/Foo.java&sha=HEAD`)).status, 400);
  assert.equal((await get(`/api/notebooks/test/history/other?path=a&sha=${sha}`)).status, 404);
});

t('a cancel that lands while the commits are being read saves nothing', async () => {
  repoInNotebook();
  const text = 'It is a class [[src/java/net/x/Foo.java#L3]].';
  const lines = [
    { type: 'system', subtype: 'init', session_id: 'sess-c', model: 'claude-haiku-5-5' },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text }] } },
    { type: 'result', subtype: 'success', is_error: false, result: text, session_id: 'sess-c', total_cost_usd: 0.01, usage: { input_tokens: 5, output_tokens: 7 } },
  ];
  const fx = path.join(env.root, 'cancel.jsonl');
  fs.writeFileSync(fx, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  process.env.LECTERN_FAKE_ENGINE = '1';
  process.env.LECTERN_FAKE_FIXTURE = fx;
  const nb = store.getNotebook('test');
  const before = store.listConversations(nb).length;
  // the answer text arrives, then git is asked for HEAD and the diff: two spawns, well over the 5 ms before the cancel
  const job = ask({ notebook: 'test', question: 'cancel me', engine: 'claude-code', onEvent: (e) => { if (e.type === 'delta') setTimeout(() => job.cancel(), 5); } });
  await assert.rejects(job.done, /cancelled/);
  assert.equal(store.listConversations(nb).length, before);
});

t('ask records commits on the saved turn and stamps its citations', async () => {
  const sha = repoInNotebook();
  const lines = [
    { type: 'system', subtype: 'init', session_id: 'sess-h', model: 'claude-haiku-5-5' },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu0', name: 'Read', input: { file_path: path.join(nbRoot, 'net/x/Foo.java') } }] } },
    { type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'It is a class [[src/java/net/x/Foo.java#L3]].' }] } },
    { type: 'result', subtype: 'success', is_error: false, result: 'It is a class [[src/java/net/x/Foo.java#L3]].', session_id: 'sess-h', total_cost_usd: 0.01, usage: { input_tokens: 5, output_tokens: 7 } },
  ];
  const fx = path.join(env.root, 'hist.jsonl');
  fs.writeFileSync(fx, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  process.env.LECTERN_FAKE_ENGINE = '1';
  process.env.LECTERN_FAKE_FIXTURE = fx;
  const out = await ask({ notebook: 'test', question: 'What is Foo?', engine: 'claude-code' }).done;
  assert.equal(out.commits.code.sha, sha);
  assert.equal(out.citations[0].sha, sha);
  const conv = store.getConversation(store.getNotebook('test'), out.conversationId);
  assert.equal(conv.turns[0].commits.code.sha, sha);
  assert.deepEqual(conv.turns[0].commits.code.dirty, []);
  assert.equal(conv.turns[0].citations[0].sha, sha);
  assert.ok(!('dirty' in conv.turns[0].citations[0]));
  // an edited file is flagged on the next answer
  fs.appendFileSync(path.join(nbRoot, 'net/x/Foo.java'), '// local edit\n');
  const again = await ask({ notebook: 'test', question: 'And now?', engine: 'claude-code' }).done;
  assert.deepEqual(again.commits.code.dirty, ['net/x/Foo.java']);
  assert.equal(again.citations[0].dirty, true);
  sh(nbRoot, 'checkout', '--', 'net/x/Foo.java');
});

test('an answer from a notebook with no git has no commits and still saves', async () => {
  const plainEnv = setupNotebook();
  try {
    const nb = store.getNotebook('test');
    const fx = path.join(plainEnv.root, 'plain.jsonl');
    const text = 'It is a class [[src/java/net/x/Foo.java#L3]].';
    const lines = [
      { type: 'system', subtype: 'init', session_id: 'sess-p', model: 'claude-haiku-5-5' },
      { type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text }] } },
      { type: 'result', subtype: 'success', is_error: false, result: text, session_id: 'sess-p', total_cost_usd: 0.01, usage: { input_tokens: 5, output_tokens: 7 } },
    ];
    fs.writeFileSync(fx, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    process.env.LECTERN_FAKE_FIXTURE = fx;
    const out = await ask({ notebook: 'test', question: 'q', engine: 'claude-code' }).done;
    assert.equal(out.commits, undefined);
    assert.equal(out.citations[0].sha, undefined);
    const conv = store.getConversation(nb, out.conversationId);
    assert.ok(!('commits' in conv.turns[0]));
  } finally { plainEnv.cleanup(); process.env.LECTERN_HOME = env.home; }
});

test('a studio run copies commits onto the artifact and stamps its citations', async () => {
  const nb = store.getNotebook('test');
  const sha = 'a'.repeat(40);
  const commits = { code: { sha, dirty: [] } };
  const body = 'This is the body of the document, long enough to pass the length check for docs.';
  const text = `# Product PRD\n\n${body} Handlers go in the event [[docs/guide/a.md|"Register handlers in RegisterPayloadHandlersEvent."]] and Foo is a class [[src/java/net/x/Foo.java#L3]].`;
  const impl = (opts) => {
    opts.onEvent({ type: 'delta', text: 'x' });
    const done = Promise.resolve({ answer: text, rawAnswer: text, citations: [], toolCalls: [], usage: {}, costUsd: 0.01, sessionCostUsd: 0.01, sessionId: 's', seconds: 1, commits });
    return { done, cancel() {} };
  };
  const job = await studio.generate(nb, 'prd', { idea: 'A thing' }, { model: 'haiku', askImpl: impl });
  const a = await job.done;
  assert.equal(a.status, 'ok');
  assert.deepEqual(a.commits, commits);
  const code = a.citations.find((c) => c.path.endsWith('Foo.java'));
  const doc = a.citations.find((c) => c.path.endsWith('a.md'));
  assert.equal(code.sha, sha);
  assert.ok(!('sha' in doc));
  assert.equal(studio.getArtifact(nb, a.id).citations.find((c) => c.path.endsWith('Foo.java')).sha, sha);
  // no commits from the engine: nothing is added
  const bare = await (await studio.generate(nb, 'prd', { idea: 'B' }, { model: 'haiku', askImpl: (o) => ({ done: Promise.resolve({ answer: text, rawAnswer: text, citations: [], toolCalls: [], usage: {}, sessionId: 's' }), cancel() {} }) })).done;
  assert.ok(!('commits' in bare));
  assert.ok(bare.citations.every((c) => !('sha' in c)));
});

t('a cited file is checked for edits however many files the conversation read', async () => {
  const s = mk('src/java');
  sh(s.repo, 'init', '-q');
  for (let i = 0; i < 45; i++) put(s.root, `F${i}.java`, `class F${i} {}\n`);
  commit(s.repo, 'many');
  put(s.root, 'F44.java', 'class F44 { int x; }\n');
  const reads = Array.from({ length: 45 }, (_, i) => `code/F${i}.java`);
  const commits = await snapshotRoots(s.nb, [...reads.slice(0, 44), 'code/F44.java']);
  assert.deepEqual(commits.code.dirty, ['F44.java']);
});

t('locate prefers the named root when the notebook-relative file is not there', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lectern-hist-nb-'));
  made.push(dir);
  const ext = path.join(dir, 'outside-repo');
  fs.mkdirSync(ext);
  const nb = { dir, config: { roots: { all: '.', ext: 'outside-repo' } } };
  assert.equal(locate(nb, 'ext/Foo.java').root, 'ext');
  assert.deepEqual(locate(nb, 'ext/Foo.java'), { root: 'ext', dir: ext, rel: 'Foo.java' });
  // a real file at that notebook-relative path still belongs to the '.' root
  put(dir, 'ext/Foo.java', 'x');
  assert.equal(locate(nb, 'ext/Foo.java').root, 'all');
  assert.equal(locate(nb, 'docs/a.md').root, 'all');
});
