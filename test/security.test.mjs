// Regression tests for the v1 security review: no remote loads from rendered text, no reads or
// writes through links, no repo config that runs programs, no cross-site API calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setupNotebook } from './helpers.mjs';

const env = setupNotebook();
process.env.LECTERN_FAKE_ENGINE = '1';
process.env.LECTERN_NO_RG = '1';
process.env.LECTERN_REGEX_TIMEOUT_MS = '700';
const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// a folder outside the notebook, linked from inside the code root
const outside = path.join(env.root, 'outside');
fs.mkdirSync(outside);
fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP SECRET outside\n');
const link = path.join(env.nbDir, 'src', 'java', 'jdir');
fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');

const store = await import('../lib/store.mjs');
const sources = await import('../lib/sources.mjs');
const shelf = await import('../lib/shelf.mjs');
const studio = await import('../lib/studio/engine.mjs');
const inputs = await import('../lib/studio/inputs.mjs');
const { createServer } = await import('../lib/server.mjs');
const nb = () => store.getNotebook('test');

const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); env.cleanup(); });

test('the sanitizer config drops media tags and every attribute that fetches on its own', async () => {
  const { SANITIZE_CONFIG, safeResource, afterAttributes } = await import('../public/ui/sanitize.js');
  for (const t of ['video', 'audio', 'source', 'picture', 'track', 'iframe', 'object', 'embed', 'style', 'form']) assert.ok(SANITIZE_CONFIG.FORBID_TAGS.includes(t), t);
  for (const a of ['srcset', 'poster', 'background', 'ping', 'style']) assert.ok(SANITIZE_CONFIG.FORBID_ATTR.includes(a), a);
  for (const u of ['http://127.0.0.1:4612/x', '//evil.example/x', '/\\evil.example/x', '/\t/evil.example', 'https://a/b', 'javascript:1']) assert.equal(safeResource(u), false, u);
  for (const u of ['/marks.svg', 'data:image/png;base64,AAAA']) assert.equal(safeResource(u), true, u);
  // a stand-in element: the hook strips remote URLs from every fetching attribute, not only img src
  const node = (tagName, attrs) => ({
    tagName, attrs: { ...attrs },
    getAttribute(k) { return this.attrs[k] ?? null; }, hasAttribute(k) { return k in this.attrs; },
    removeAttribute(k) { delete this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; },
  });
  const cases = [
    node('IMG', { src: 'http://127.0.0.1:4612/mdimg?d=x', srcset: 'http://127.0.0.1:4612/srcset?d=SECRET1 1x' }),
    node('TABLE', { background: 'http://127.0.0.1:4612/bg?d=SECRET3' }),
    node('TD', { background: '//127.0.0.1:4612/bg' }),
  ];
  for (const n of cases) { afterAttributes(n); assert.deepEqual(n.attrs, {}, n.tagName); }
  const a = node('A', { href: 'https://example.org', ping: 'http://127.0.0.1:4612/ping' });
  afterAttributes(a);
  assert.equal(a.attrs.ping, undefined);
  assert.equal(a.attrs.rel, 'noopener noreferrer');
  // and the renderer itself uses that config, with no eval for highlight.js
  const md = fs.readFileSync(path.join(APP, 'public/ui/markdown.js'), 'utf8');
  assert.match(md, /DOMPurify\.sanitize\(html, SANITIZE_CONFIG\)/);
  assert.doesNotMatch(md, /new Function|eval\(/);
});

test('every response carries a CSP that blocks other hosts, and the page script hash matches', async () => {
  for (const p of ['/', '/api/status', '/vendor/highlight.js/lib/core.esm.js']) {
    const res = await fetch(base + p);
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, p);
    for (const d of ["default-src 'self'", "img-src 'self' data: blob:", "media-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]) assert.ok(csp.includes(d), `${p}: ${d}`);
    assert.doesNotMatch(csp, /unsafe-eval/);
    if (p.endsWith('.js')) assert.match(await res.text(), /export default module\.exports/);
  }
});

test('cross-site API GETs are refused, same-origin and header-less ones are not', async () => {
  const q = '/api/notebooks/test/search?q=payload';
  for (const headers of [{ 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }, { origin: 'https://evil.example' }, { origin: 'null' }, { referer: 'https://evil.example/page' }]) {
    const res = await fetch(base + q, { headers });
    assert.equal(res.status, 403, JSON.stringify(headers));
  }
  assert.equal((await fetch(base + q, { headers: { 'sec-fetch-site': 'same-origin', referer: base + '/' } })).status, 200);
  assert.equal((await fetch(base + q)).status, 200);
});

test('a catastrophic regex times out with a 400 and the server keeps answering', async () => {
  fs.writeFileSync(path.join(env.nbDir, 'docs', 'long.md'), 'a'.repeat(40) + '\n');
  sources.invalidate(nb());
  const t0 = Date.now();
  const res = await fetch(base + '/api/notebooks/test/search?regex=1&q=' + encodeURIComponent('(a*a*)*^^^b'));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /took too long/);
  assert.ok(Date.now() - t0 < 5000);
  assert.equal((await fetch(base + '/api/status')).status, 200);
  fs.writeFileSync(path.join(env.nbDir, 'src', 'java', 'long.txt'), 'a'.repeat(40) + '\n');
  const g = shelf.runTool({ code: 'src/java' }, env.nbDir, 'grep', { root: 'code', pattern: '(a*a*)*^^^b' });
  assert.equal(g.is_error, true);
  assert.match(g.content, /took too long/);
  fs.rmSync(path.join(env.nbDir, 'docs', 'long.md'));
  fs.rmSync(path.join(env.nbDir, 'src', 'java', 'long.txt'));
});

test('a link inside a root cannot be read, listed or written through', () => {
  assert.throws(() => sources.readFile(nb(), 'code/jdir/secret.txt'), /escapes|not found/);
  assert.ok(!sources.tree(nb(), 'code', '').entries.some((e) => e.name === 'jdir'));
  assert.throws(() => sources.tree(nb(), 'code', 'jdir'), /escapes/);
  const r = shelf.runTool({ code: 'src/java' }, env.nbDir, 'read', { root: 'code', path: 'jdir/secret.txt' });
  assert.equal(r.is_error, true);
  assert.doesNotMatch(r.content, /TOP SECRET/);
  const g = shelf.runTool({ code: 'src/java' }, env.nbDir, 'grep', { root: 'code', pattern: 'SECRET|payload', glob: '*' });
  assert.ok(!g.is_error, g.content);
  assert.doesNotMatch(g.content, /TOP SECRET/);
  assert.throws(() => studio.resolveWritePath(nb(), 'code/jdir/WRITTEN_OUTSIDE.txt'), /only be written/);
});

test('allFiles skips links, and honours .gitignore in a repo root', async () => {
  const files = await sources.allFiles(nb());
  assert.ok(!files.some((f) => f.path.includes('jdir')));
  const repo = path.join(env.root, 'repo');
  fs.mkdirSync(path.join(repo, 'internal'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'a.md'), 'kept\n');
  fs.writeFileSync(path.join(repo, 'internal', 'b.md'), 'ignored\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'internal/\n');
  execFileSync('git', ['init', '-q', repo]);
  const n = nb();
  sources.addSource(n, { kind: 'folder', path: repo, name: 'repo' });
  const paths = (await sources.allFiles(n)).filter((f) => f.root === 'repo').map((f) => f.path);
  assert.ok(paths.includes('repo/a.md'), paths.join());
  assert.ok(!paths.some((p) => p.includes('internal')));
  sources.removeSource(n, { kind: 'root', value: 'repo' });
});

test('write-to refuses .git, .claude and the notebook state files', () => {
  for (const p of ['code/.git/hooks/pre-commit', '.claude/settings.json', 'notebook.json', 'conversations/x.json', 'artifacts/x.json']) {
    assert.throws(() => studio.resolveWritePath(nb(), p), /does not write|keeps its own state/, p);
  }
  assert.ok(studio.resolveWritePath(nb(), 'code/net/x/New.java'));
});

test('a repo whose config runs programs is refused for git inputs, and fsmonitor never runs', async () => {
  const repo = path.join(env.root, 'evil');
  fs.mkdirSync(repo);
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git('add', '.'); git('commit', '-qm', 'one');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'two\n');
  const marker = path.join(env.root, 'FSMONITOR_RAN');
  git('config', 'core.fsmonitor', `node -e "require('fs').writeFileSync(${JSON.stringify(marker)},'pwned')"`);
  const n = nb();
  sources.addSource(n, { kind: 'folder', path: repo, name: 'evil' });
  await assert.rejects(inputs.resolveDiff(n, { root: 'evil', range: 'HEAD' }), /runs programs \(core\.fsmonitor\)/);
  // even git calls that skip the check pass core.fsmonitor=false
  await inputs.git(repo, ['diff', '--no-color', 'HEAD', '--', '.']);
  assert.equal(fs.existsSync(marker), false);
  sources.removeSource(n, { kind: 'root', value: 'evil' });
});

test('escaped markup in a fetched page stays text', () => {
  const { markdown } = sources.htmlToMarkdown('<p>Hello &lt;img srcset=&quot;http://127.0.0.1:4612/fromdoc 1x&quot;&gt; a &lt; b</p><pre>List&lt;String&gt;</pre>');
  assert.doesNotMatch(markdown, /<img/);
  assert.match(markdown, /&lt;img/);
  assert.match(markdown, /a < b/);
  assert.match(markdown, /List<String>/);
});

test('url sources refuse loopback, private and link-local hosts', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.3.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1']) assert.equal(sources.privateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '2606:4700::1']) assert.equal(sources.privateAddress(ip), false, ip);
  await assert.rejects(sources.addSource(nb(), { kind: 'url', url: `${base}/api/status` }), /local or private address/);
  await assert.rejects(sources.addSource(nb(), { kind: 'url', url: 'http://localhost:1/x' }), /local or private address/);
});

test('git sources take https or git@ only, and no option-like subdir', async () => {
  await assert.rejects(sources.addSource(nb(), { kind: 'git', url: 'http://example.org/x.git' }), /https:\/\/ or git@/);
  await assert.rejects(sources.addSource(nb(), { kind: 'git', url: 'https://example.org/x.git', subdir: '--help' }), /bad subdir/);
  const { stripUserinfo } = await import('../lib/gitsafe.mjs');
  assert.equal(stripUserinfo('https://me:tok@example.org/x.git'), 'https://example.org/x.git');
});

test('claude -p runs without API keys in its env and with the read guard', async () => {
  const { claudeEnv, sandboxArgs } = await import('../lib/engine.mjs');
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  process.env.ANTHROPIC_BASE_URL = 'http://x';
  try {
    const e = claudeEnv();
    assert.equal(e.ANTHROPIC_API_KEY, undefined);
    assert.equal(e.ANTHROPIC_BASE_URL, undefined);
    assert.equal(e.LECTERN_OWN_RUN, '1');
  } finally { delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_BASE_URL; }
  const args = sandboxArgs(nb(), null);
  const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
  const hook = settings.hooks.PreToolUse[0];
  assert.equal(hook.matcher, 'Read|Grep|Glob');
  // run the hook the way Claude Code would
  const parts = hook.hooks[0].command.match(/"([^"]+)" "([^"]+)" (\S+)/);
  const call = (tool_name, tool_input) => spawnSync(parts[1], [parts[2], parts[3]], { input: JSON.stringify({ tool_name, tool_input, cwd: env.nbDir }), encoding: 'utf8' }).status;
  assert.equal(call('Read', { file_path: path.join(env.nbDir, 'docs', 'intro.md') }), 0);
  assert.equal(call('Read', { file_path: path.join(env.root, 'outside.md') }), 2);
  assert.equal(call('Read', { file_path: path.join(link, 'secret.txt') }), 2);
  assert.equal(call('Grep', { pattern: 'x', path: outside }), 2);
  assert.equal(call('Glob', { pattern: '/**' }), 2);
  assert.equal(call('Grep', { pattern: 'x' }), 0);
});
