import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setupNotebook } from './helpers.mjs';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'lectern.mjs');
const env = setupNotebook();
test.after(() => env.cleanup());

const { stopVerdict, installHook } = await import('../lib/hook.mjs');
const { notebookFor } = await import('../lib/store.mjs');
const { verify, whyNot, fileCache } = await import('../lib/cite.mjs');

const cwd = path.join(env.nbDir, 'src/java/net/x');
const FOO = 'src/java/net/x/Foo.java';
const say = (text, extra = {}) => stopVerdict({ cwd, last_assistant_message: text, ...extra });
const childEnv = () => { const e = { ...process.env, LECTERN_HOME: env.home }; delete e.LECTERN_OWN_RUN; return e; };
const run = (args, input) => spawnSync(process.execPath, [BIN, ...args], { input, encoding: 'utf8', env: childEnv() });

test('code, wiki links and bare brackets are not citations', () => {
  const msg = [
    'Look at this:',
    '```cpp',
    '[[nodiscard]] int f(); a[[0]]',
    '```',
    'and `[[a/b.md#L9]]` here, plus [[wiki link]] and [[Note#Heading]].',
  ].join('\n');
  assert.equal(say(msg), null);
  assert.equal(say('text\n~~~\n[[docs/ghost.md#L1]]\nnever closed'), null);
});

test('a line past the end blocks with the line count', () => {
  const v = say(`See [[${FOO}#L40]] for it.`);
  assert.equal(v.decision, 'block');
  assert.match(v.reason, /\[\[src\/java\/net\/x\/Foo\.java#L40\]\] is past the end of src\/java\/net\/x\/Foo\.java \(5 lines\)/);
  assert.match(v.reason, /"Test Notebook"/);
});

test('a missing file and an absent quote block with their own words', () => {
  const v = say('[[docs/ghost.md#L1]] and [[docs/guide/a.md|"words that are not there"]]');
  assert.equal(v.decision, 'block');
  assert.match(v.reason, /\[\[docs\/ghost\.md#L1\]\] is not a file in the notebook/);
  assert.match(v.reason, /"words that are not there"\]\] does not appear in docs\/guide\/a\.md/);
});

test('verified and moved citations let Claude stop', () => {
  assert.equal(say('[[docs/guide/a.md|"Register handlers in RegisterPayloadHandlersEvent."]]'), null);
  assert.equal(say('[[docs/guide/a.md#L1|"first guide about payloads."]]'), null);
  assert.equal(say(`[[${FOO}#L3]] and [[${FOO}#L1-L5]]`), null);
});

test('paths resolve beside the cwd, inside a root, as the notebook knows them, or absolute', () => {
  const at = path.join(env.nbDir, 'src/java');
  const sayAt = (t) => stopVerdict({ cwd: at, last_assistant_message: t });
  assert.equal(sayAt('[[net/x/Foo.java#L3]]'), null);
  assert.match(sayAt('[[net/x/Foo.java#L99]]').reason, /is past the end of src\/java\/net\/x\/Foo\.java/);
  assert.equal(sayAt('[[code/net/x/Foo.java#L3]]'), null);
  assert.equal(sayAt(`[[${path.join(env.nbDir, FOO)}#L3]]`), null);
  assert.match(sayAt('[[../../../outside.md#L1]]').reason, /is not a file in the notebook/);
  assert.match(sayAt(`[[${path.join(env.root, 'outside.md')}#L1]]`).reason, /is not a file in the notebook/);
});

test('a repeated citation is listed once and a long list is cut', () => {
  const many = Array.from({ length: 12 }, (_, i) => `[[docs/ghost${i}.md#L1]]`).join(' ');
  const r = stopVerdict({ cwd, last_assistant_message: many }, { max: 10 });
  assert.ok(r.reason.includes('12 citations'));
  assert.ok(r.reason.includes('\n- and 2 more\n'));
  assert.equal(r.reason.split('\n').filter((l) => l.startsWith('- ')).length, 11);
  const twice = say('[[docs/ghost.md#L1]] again [[docs/ghost.md#L1]]');
  assert.equal(twice.reason.split('docs/ghost.md#L1').length, 2);
  assert.ok(twice.reason.includes('1 citation '));
});

test('stop_hook_active never blocks', () => {
  const v = say(`[[${FOO}#L40]]`, { stop_hook_active: true });
  assert.equal(v.decision, undefined);
  assert.match(v.systemMessage, /past the end/);
});

test('anything else lets Claude stop', () => {
  const bad = `[[${FOO}#L40]]`;
  assert.equal(stopVerdict({ cwd: os.tmpdir(), last_assistant_message: bad }), null);
  assert.equal(stopVerdict({ cwd }), null);
  assert.equal(stopVerdict({ cwd, last_assistant_message: 42 }), null);
  assert.equal(stopVerdict(null), null);
  process.env.LECTERN_OWN_RUN = '1';
  try { assert.equal(say(bad), null); } finally { delete process.env.LECTERN_OWN_RUN; }
});

test('notebookFor picks the deepest folder or root', () => {
  const other = path.join(env.root, 'other');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'notebook.json'), JSON.stringify({ name: 'other', title: 'Other', pinned: [], roots: { net: path.join(env.nbDir, 'src/java/net') } }));
  const reg = JSON.parse(fs.readFileSync(env.registry, 'utf8'));
  reg.notebooks.other = { dir: other.split(path.sep).join('/'), title: 'Other', color: 'amber' };
  fs.writeFileSync(env.registry, JSON.stringify(reg));
  try {
    assert.equal(notebookFor(path.join(env.nbDir, 'src/java/net/x')).id, 'other');
    assert.equal(notebookFor(path.join(env.nbDir, 'docs')).id, 'test');
    assert.equal(notebookFor(env.nbDir).id, 'test');
    assert.equal(notebookFor(os.tmpdir()), null);
  } finally {
    delete reg.notebooks.other;
    fs.writeFileSync(env.registry, JSON.stringify(reg));
  }
});

test('whyNot words each kind of failure', () => {
  const roots = { code: path.join(env.nbDir, 'src/java') };
  const why = (cite) => whyNot(env.nbDir, cite, verify(env.nbDir, cite, roots, fileCache()), roots);
  assert.equal(why({ path: FOO, line: 40, endLine: 40 }), 'is past the end of src/java/net/x/Foo.java (5 lines)');
  assert.equal(why({ path: FOO, line: 0, endLine: 0 }), 'is not a line number');
  assert.equal(why({ path: 'docs/guide/a.md', line: null, quote: 'nope nope' }), 'does not appear in docs/guide/a.md');
  assert.equal(why({ path: 'docs/ghost.md', line: 1, endLine: 1 }), 'is not a file in the notebook');
});

test('the hook binary speaks the Claude Code contract', () => {
  const bad = run(['hook', 'stop'], JSON.stringify({ cwd, last_assistant_message: `x [[${FOO}#L40]]`, stop_hook_active: false }));
  assert.equal(bad.status, 0);
  const out = JSON.parse(bad.stdout);
  assert.equal(out.decision, 'block');
  assert.equal(typeof out.reason, 'string');
  for (const input of [JSON.stringify({ cwd, last_assistant_message: `fine [[${FOO}#L3]]` }), 'not json', '']) {
    const r = run(['hook', 'stop'], input);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  }
});

const COMMAND_RE = /^"([^"]+)" "([^"]+)" hook stop$/;

test('install prints the snippet and does not write', () => {
  const dir = path.join(env.nbDir, 'docs');
  const r = run(['hook', 'install', '--dir', dir]);
  assert.equal(r.status, 0);
  const snippet = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1));
  const h = snippet.hooks.Stop[0].hooks[0];
  assert.equal(h.type, 'command');
  assert.equal(h.timeout, 30);
  assert.match(h.command, COMMAND_RE);
  assert.ok(!fs.existsSync(path.join(dir, '.claude')));
  assert.match(r.stdout, /settings\.local\.json/);
  assert.match(r.stdout, /inside notebook "test"/);
  const outside = fs.mkdtempSync(path.join(env.root, 'plain-'));
  assert.match(run(['hook', 'install', '--dir', outside]).stdout, /will do nothing/);
  assert.equal(run(['hook', 'install', '--dir', path.join(outside, 'nope')]).status, 2);
});

test('the installed command actually runs', () => {
  const outside = fs.mkdtempSync(path.join(env.root, 'plain-'));
  const r = run(['hook', 'install', '--dir', outside]);
  const cmd = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1)).hooks.Stop[0].hooks[0].command.match(COMMAND_RE);
  const p = spawnSync(cmd[1], [cmd[2], 'hook', 'stop'], { input: JSON.stringify({ cwd, last_assistant_message: `[[${FOO}#L40]]` }), encoding: 'utf8', env: childEnv() });
  assert.equal(p.status, 0);
  assert.equal(JSON.parse(p.stdout).decision, 'block');
});

test('--write merges, is idempotent, keeps what was there, and refuses what it cannot merge', () => {
  const dir = fs.mkdtempSync(path.join(env.root, 'repo-'));
  const file = path.join(dir, '.claude', 'settings.local.json');
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const echo = { hooks: [{ type: 'command', command: 'echo hi' }] };
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { Stop: [echo], PreToolUse: [] } }));
  assert.equal(run(['hook', 'install', '--dir', dir, '--write']).status, 0);
  assert.equal(run(['hook', 'install', '--dir', dir, '--write']).status, 0);
  let s = read();
  assert.deepEqual(s.permissions, { allow: ['Bash(ls)'] });
  assert.deepEqual(s.hooks.PreToolUse, []);
  assert.equal(s.hooks.Stop.length, 2);
  assert.deepEqual(s.hooks.Stop[0], echo);
  assert.match(s.hooks.Stop[1].hooks[0].command, COMMAND_RE);

  // an earlier Lectern entry with another node path is replaced
  s.hooks.Stop[1].hooks[0].command = '"/old/node" "/old/lectern/bin/lectern.mjs" hook stop';
  fs.writeFileSync(file, JSON.stringify(s));
  assert.equal(installHook({ dir, write: true }).wrote, true);
  s = read();
  assert.equal(s.hooks.Stop.length, 2);
  assert.ok(!s.hooks.Stop[1].hooks[0].command.includes('/old/'));

  // a file it cannot merge into is left byte for byte
  for (const body of ['[1]', '{ not json', '{"hooks":{"Stop":{}}}', '{"hooks":[]}']) {
    fs.writeFileSync(file, body);
    const r = run(['hook', 'install', '--dir', dir, '--write']);
    assert.equal(r.status, 2, body);
    assert.equal(r.stderr.trim().split('\n')[0].includes('settings.local.json'), true);
    assert.equal(fs.readFileSync(file, 'utf8'), body);
  }

  // a link is refused
  const linked = fs.mkdtempSync(path.join(env.root, 'repo-'));
  fs.mkdirSync(path.join(linked, '.claude'));
  const target = path.join(linked, 'real.json');
  fs.writeFileSync(target, '{}');
  let made = true;
  try { fs.symlinkSync(target, path.join(linked, '.claude', 'settings.local.json')); } catch { made = false; }
  if (made) {
    assert.equal(run(['hook', 'install', '--dir', linked, '--write']).status, 2);
    assert.equal(fs.readFileSync(target, 'utf8'), '{}');
  }

  assert.equal(run(['hook']).status, 2);
  assert.equal(run(['hook', 'nope']).status, 2);
});

test('a citation after a closed fence or beside inline code is still checked', () => {
  const ghost = '[[docs/ghost.md#L1]]';
  assert.equal(say('````md\n```js\nx\n```\n````\nsee ' + ghost).decision, 'block');
  assert.equal(say('```\n' + ghost + '\n```\nthen ' + ghost).decision, 'block');
  assert.equal(say('1. step\n   ```\n   ' + ghost + '\n   ```\n'), null);
  assert.equal(say('use ``' + ghost + '`` here'), null);
});

test('whyNot counts an empty file as no lines', () => {
  const rel = 'docs/empty.md';
  fs.writeFileSync(path.join(env.nbDir, rel), '');
  const cite = { path: rel, line: 2, endLine: 2 };
  assert.equal(whyNot(env.nbDir, cite, verify(env.nbDir, cite, {}, fileCache()), {}), 'is past the end of docs/empty.md (0 lines)');
});

test('a working directory reached through a junction still resolves', () => {
  const link = path.join(fs.mkdtempSync(path.join(env.root, 'jn-')), 'x');
  fs.symlinkSync(path.join(env.nbDir, 'src/java/net/x'), link, 'junction');
  assert.equal(stopVerdict({ cwd: link, last_assistant_message: '[[Foo.java#L3]]' }), null);
  assert.match(stopVerdict({ cwd: link, last_assistant_message: '[[Foo.java#L40]]' }).reason, /is past the end of src\/java\/net\/x\/Foo\.java \(5 lines\)/);
});

test('an exec-form entry is kept in exec form, not duplicated', () => {
  const dir = fs.mkdtempSync(path.join(env.root, 'repo-'));
  const file = path.join(dir, '.claude', 'settings.local.json');
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: '/old/node', args: ['/old/bin/lectern.mjs', 'hook', 'stop'] }] }] } }));
  installHook({ dir, write: true });
  const stop = JSON.parse(fs.readFileSync(file, 'utf8')).hooks.Stop;
  assert.equal(stop.length, 1);
  assert.equal(stop[0].hooks[0].args.at(-1), 'stop');
  assert.ok(!stop[0].hooks[0].command.includes('old'));
  // unquoted shell form counts as ours too
  fs.writeFileSync(file, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node /old/bin/lectern.mjs hook stop' }] }] } }));
  installHook({ dir, write: true });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).hooks.Stop.length, 1);
});

test('a .claude folder that is a junction is refused, and --dir needs a value', () => {
  const real = fs.mkdtempSync(path.join(env.root, 'real-'));
  const dir = fs.mkdtempSync(path.join(env.root, 'repo-'));
  fs.symlinkSync(real, path.join(dir, '.claude'), 'junction');
  const r = run(['hook', 'install', '--dir', dir, '--write']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /is a link/);
  assert.deepEqual(fs.readdirSync(real), []);
  assert.equal(run(['hook', 'install', '--dir', '--write']).status, 2);
});
