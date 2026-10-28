// lib/agents.mjs registers lectern mcp with Claude Code and Cursor. No Electron and no real claude here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mcpEntry, claudeAddArgs, planCursor, writeCursor, preview, connect, status, transientReason } from '../lib/agents.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lectern-agents-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
// the exe and script must exist; tmp points elsewhere so they are not taken for a transient unpack
const exe = path.join(dir, 'My App', 'Lectern.exe'), script = path.join(dir, 'My App', 'bin', 'lectern.mjs');
fs.mkdirSync(path.dirname(script), { recursive: true });
fs.writeFileSync(exe, ''); fs.writeFileSync(script, '');
const t = { exe, script };
const away = { tmp: path.join(dir, 'elsewhere') };
let n = 0;
const fresh = () => path.join(dir, `home${++n}`, '.cursor', 'mcp.json');
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
const entry = mcpEntry(t);
const ENV = { ELECTRON_RUN_AS_NODE: '1' };

test('mcpEntry runs the exe as node on lectern.mjs mcp', () => {
  assert.deepEqual(mcpEntry({ exe: 'E', script: 'S' }), { command: 'E', args: ['S', 'mcp'], env: ENV });
  assert.deepEqual(mcpEntry({ exe: 'E', script: 'S', home: 'H' }), { command: 'E', args: ['S', 'mcp'], env: { ...ENV, LECTERN_HOME: 'H' } });
});

test('claudeAddArgs keeps the name first and the command after --', () => {
  assert.deepEqual(claudeAddArgs({ exe: 'C:\\Program Files\\L\\Lectern.exe', script: 'C:\\a b\\lectern.mjs' }),
    ['mcp', 'add', 'lectern', '--scope', 'user', '-e', 'ELECTRON_RUN_AS_NODE=1', '--', 'C:\\Program Files\\L\\Lectern.exe', 'C:\\a b\\lectern.mjs', 'mcp']);
  assert.ok(claudeAddArgs({ exe: 'E', script: 'S', home: 'H' }).join(' ').includes('-e LECTERN_HOME=H -- E S mcp'));
});

test('planCursor adds the entry and keeps other servers and keys', () => {
  const other = { command: 'x', args: ['1'], env: { TOKEN: 'abc' } };
  const text = JSON.stringify({ foo: { a: 1 }, mcpServers: { other }, bar: 2 });
  const p = planCursor(text, entry);
  assert.ok(p.ok);
  const doc = JSON.parse(p.text);
  assert.deepEqual(doc.foo, { a: 1 });
  assert.deepEqual(doc.mcpServers.other, other);
  assert.deepEqual(doc.mcpServers.lectern, entry);
  assert.deepEqual(Object.keys(doc), ['foo', 'mcpServers', 'bar']);
  assert.deepEqual(Object.keys(doc.mcpServers), ['other', 'lectern']);
  assert.ok(p.text.endsWith('\n'));
  assert.equal(p.others, 1);
  assert.equal(p.replaces, null);
});

test('planCursor replaces an old lectern entry and reports it', () => {
  const text = JSON.stringify({ mcpServers: { lectern: { command: 'old', args: ['a', 'mcp'] } } });
  const p = planCursor(text, entry);
  assert.equal(p.replaces.command, 'old');
  assert.deepEqual(p.replaces.args, ['a', 'mcp']);
  assert.equal(p.others, 0);
  const doc = JSON.parse(p.text);
  assert.equal(Object.keys(doc.mcpServers).length, 1);
  assert.deepEqual(doc.mcpServers.lectern, entry);
});

test('planCursor starts from a missing, empty or BOM-prefixed file', () => {
  for (const text of [null, '', '  \n', '\uFEFF{"mcpServers":{}}']) assert.equal(planCursor(text, entry).ok, true, JSON.stringify(text));
});

test('planCursor refuses what it cannot parse', () => {
  for (const text of ['{ // hi\n "mcpServers": {} }', '[]', '"x"', '{"mcpServers":[]}', '{"mcpServers":"x"}']) {
    const p = planCursor(text, entry);
    assert.equal(p.ok, false, text);
    assert.match(p.error, /README/);
    assert.equal(p.text, undefined);
  }
});

test('preview never returns other servers content', () => {
  const file = put(fresh(), JSON.stringify({ mcpServers: { other: { command: 'x', env: { KEY: 'CANARY-SECRET-123' } } } }));
  const r = preview('cursor', t, { ...away, file });
  assert.ok(r.ok);
  assert.equal(r.others, 1);
  assert.ok(!JSON.stringify(r).includes('CANARY-SECRET-123'));
  assert.deepEqual(r.entry, entry);
});

test('writeCursor writes atomically, keeps a backup and makes the folder', () => {
  const file = fresh();
  const r1 = writeCursor(entry, file);
  assert.deepEqual(r1, { ok: true, file, backup: false });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['mcp.json']);
  const first = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: 'x' }, lectern: { command: 'old' } } }));
  const before = fs.readFileSync(file, 'utf8');
  assert.equal(writeCursor(entry, file).backup, true);
  assert.equal(fs.readFileSync(`${file}.bak`, 'utf8'), before);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(doc.mcpServers.other, { command: 'x' });
  assert.deepEqual(doc.mcpServers.lectern, entry);
  assert.ok(first.includes('lectern'));
  assert.ok(!fs.readdirSync(path.dirname(file)).some((f) => f.endsWith('.tmp')));
  // a refused plan leaves the file alone and makes no backup
  const bad = put(fresh(), '{ // nope\n}');
  const bytes = fs.readFileSync(bad);
  assert.equal(writeCursor(entry, bad).ok, false);
  assert.ok(fs.readFileSync(bad).equals(bytes));
  assert.equal(fs.existsSync(`${bad}.bak`), false);
});

test('writeCursor leaves no tmp copy behind when the rename fails', { skip: process.platform !== 'win32' && 'only Windows refuses to replace a read-only file' }, () => {
  const file = put(fresh(), JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
  fs.chmodSync(file, 0o444);
  assert.throws(() => writeCursor(entry, file));
  fs.chmodSync(file, 0o666);
  assert.ok(!fs.readdirSync(path.dirname(file)).some((f) => f.endsWith('.tmp')));
});

test('transientReason flags the portable build and anything under the temp folder', () => {
  assert.ok(transientReason(path.join(os.homedir(), 'x', 'Lectern.exe'), { env: { PORTABLE_EXECUTABLE_DIR: 'C:\\p' } }));
  assert.ok(transientReason(path.join(os.tmpdir(), 'abc', 'Lectern.exe'), { env: {} }));
  assert.equal(transientReason(path.join(os.homedir(), 'x', 'Lectern.exe'), { env: {} }), null);
});

test('connect for claude-code removes the old entry, then adds, and ignores a failed remove', async () => {
  const calls = [];
  const run = async (bin, args) => { calls.push([bin, args]); if (args[1] === 'remove') throw new Error('no such server'); };
  const r = await connect('claude-code', t, { ...away, claude: 'CLAUDE', run, env: {} });
  assert.equal(r.ok, true);
  assert.deepEqual(calls.map((c) => c[0]), ['CLAUDE', 'CLAUDE']);
  assert.deepEqual(calls[0][1], ['mcp', 'remove', 'lectern', '--scope', 'user']);
  assert.deepEqual(calls[1][1], claudeAddArgs(t));
});

test("connect for claude-code reports claude's own first line when add fails, and a missing claude", async () => {
  const calls = [];
  const run = async (bin, args) => { calls.push(args[1]); if (args[1] === 'add') throw Object.assign(new Error('x'), { stderr: 'boom\nmore' }); };
  const r = await connect('claude-code', t, { ...away, claude: 'C', run, env: {} });
  assert.deepEqual([r.ok, r.error], [false, 'boom']);
  assert.deepEqual(calls, ['remove', 'add']);
  const none = [];
  const r2 = await connect('claude-code', t, { ...away, claude: null, run: async (b, a) => { none.push(a); }, env: {} });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /Claude Code/);
  assert.equal(none.length, 0);
});

test('connect and preview refuse a transient exe and an unknown agent before doing anything', async () => {
  let ran = 0;
  const run = async () => { ran++; };
  const file = fresh();
  const portable = { claude: 'C', run, file, env: { PORTABLE_EXECUTABLE_DIR: 'x' } };
  assert.equal((await connect('claude-code', t, portable)).ok, false);
  assert.equal((await connect('cursor', t, portable)).ok, false);
  assert.equal(preview('cursor', t, portable).ok, false);
  for (const id of ['../x', 'claude']) {
    assert.deepEqual(await connect(id, t, { ...away, claude: 'C', run, file }), { ok: false, error: 'unknown agent' });
    assert.equal(preview(id, t, { ...away, file }).ok, false);
  }
  assert.equal(ran, 0);
  assert.equal(fs.existsSync(path.dirname(file)), false);
});

test('the claude child never gets the API key', async () => {
  const keep = { ...process.env };
  Object.assign(process.env, { ANTHROPIC_API_KEY: 'sk-x', ANTHROPIC_AUTH_TOKEN: 'tok', ANTHROPIC_BASE_URL: 'http://x' });
  try {
    const seen = [];
    const r = await connect('claude-code', t, { ...away, claude: 'C', run: async (b, a, env) => { seen.push(env); } });
    assert.equal(r.ok, true);
    assert.equal(seen.length, 2);
    for (const env of seen) for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL']) assert.ok(!(k in env), k);
  } finally {
    for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL']) { if (k in keep) process.env[k] = keep[k]; else delete process.env[k]; }
  }
});

test('status reports the refusal reason and whether claude exists', () => {
  assert.deepEqual(status(t, { ...away, claude: '/x/claude' }), { reason: null, claude: true });
  assert.deepEqual(status(t, { ...away, claude: null }), { reason: null, claude: false });
  assert.ok(status(t, { env: { PORTABLE_EXECUTABLE_DIR: 'x' }, claude: null }).reason);
  assert.match(status({ exe: path.join(dir, 'gone.exe'), script }, { ...away, claude: null }).reason, /own files/);
});

test('every agents IPC handler in main.mjs checks the sender', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'electron', 'main.mjs'), 'utf8').split('\n');
  const handlers = src.filter((l) => l.includes("ipcMain.handle('agents:"));
  assert.equal(handlers.length, 3);
  for (const l of handlers) assert.ok(l.includes('mine(e)'), l);
  assert.equal(src.filter((l) => /const mine = \(e\) => e\.sender === win\.webContents;/.test(l)).length, 1);
});
