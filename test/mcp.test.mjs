// Spawns mcp.mjs against a throwaway notebook with the fake engine and speaks the protocol to it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setupNotebook } from './helpers.mjs';

const env = setupNotebook();
const MCP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'mcp.mjs');
test.after(() => env.cleanup());

// a stream-json run whose answer cites one doc quote, one code line and one file that is not there
const ANSWER = 'Handlers go in the event [[docs/guide/a.md|"Register handlers in RegisterPayloadHandlersEvent."]]. Foo is the class [[src/java/net/x/Foo.java#L3]]. Ghosts too [[docs/ghost.md#L1]].';
function fixture(name, result) {
  const lines = [
    { type: 'system', subtype: 'init', session_id: 'sess-mcp', model: 'claude-haiku-5-5' },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: result.result ?? '' }] } },
    { type: 'result', session_id: 'sess-mcp', total_cost_usd: 0.0123, usage: { input_tokens: 5, output_tokens: 7 }, ...result },
  ];
  const f = path.join(env.root, name);
  fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return f;
}
const okFixture = fixture('ok.jsonl', { subtype: 'success', is_error: false, result: ANSWER });
const capFixture = fixture('cap.jsonl', { subtype: 'error_max_turns', is_error: true });

function start(fixturePath, { cwd, home } = {}) {
  const child = spawn(process.execPath, [MCP], {
    env: { ...process.env, LECTERN_FAKE_ENGINE: '1', LECTERN_FAKE_FIXTURE: fixturePath, LECTERN_HOME: home ?? env.home },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, ...(cwd ? { cwd } : {}),
  });
  const waiting = new Map();
  const stdout = [];
  const notes = [];
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  readline.createInterface({ input: child.stdout }).on('line', (l) => {
    stdout.push(l);
    const m = JSON.parse(l); // every stdout line must be JSON
    if (m.id != null && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } else notes.push(m);
  });
  let next = 1;
  const raw = (line) => child.stdin.write(line + '\n');
  const request = (method, params, extra = {}) => new Promise((resolve) => {
    const id = next++;
    waiting.set(id, resolve);
    raw(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}), ...extra }));
  });
  const call = async (name, args, meta) => (await request('tools/call', { name, arguments: args, ...(meta ? { _meta: meta } : {}) })).result;
  const stop = () => new Promise((resolve) => { child.on('close', (code) => resolve(code)); child.stdin.end(); });
  return { child, request, call, raw, stop, stdout, notes, stderr: () => stderr };
}

const srv = start(okFixture);
test.after(() => srv.child.kill());

test('initialize negotiates the protocol version and names the server lectern', async () => {
  const r = await srv.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(r.result.protocolVersion, '2025-06-18');
  assert.equal(r.result.serverInfo.name, 'lectern');
  assert.deepEqual(r.result.capabilities, { tools: { listChanged: false }, prompts: { listChanged: false } });
  srv.raw(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  const odd = await srv.request('initialize', { protocolVersion: '1999-01-01', capabilities: {} });
  assert.equal(odd.result.protocolVersion, '2025-11-25');
  const bad = await srv.request('initialize', {});
  assert.equal(bad.error.code, -32602);
});

test('ping, unknown methods, parse errors and invalid requests follow JSON-RPC', async () => {
  assert.deepEqual((await srv.request('ping')).result, {});
  assert.equal((await srv.request('resources/list', {})).error.code, -32601);
  const before = srv.notes.length;
  srv.raw('{not json');
  srv.raw(JSON.stringify({ jsonrpc: '1.0', id: 99, method: 'ping' }));
  await srv.request('ping'); // replies come in order for these, so both errors are in by now
  const errs = srv.notes.slice(before).map((m) => m.error?.code);
  assert.deepEqual(errs, [-32700, -32600]);
  assert.equal((await srv.request('tools/call', { name: 'nope', arguments: {} })).error.code, -32602);
});

test('tools/list gives every tool a strict input schema', async () => {
  const { tools } = (await srv.request('tools/list', {})).result;
  assert.deepEqual(tools.map((t) => t.name).sort(), ['ask', 'check_notebook', 'generate', 'get_artifact', 'list_artifacts', 'list_notebooks', 'read_source', 'recall', 'search', 'submit_artifact', 'verify']);
  for (const t of tools) {
    assert.equal(t.inputSchema.type, 'object', t.name);
    assert.equal(t.inputSchema.additionalProperties, false, t.name);
    assert.ok(t.description.length > 80, `${t.name} needs a real description`);
    assert.equal(t.run, undefined);
  }
  const ask = tools.find((t) => t.name === 'ask');
  assert.deepEqual(ask.inputSchema.required, ['notebook', 'question']);
  assert.deepEqual(ask.inputSchema.properties.mode.enum, ['fast', 'deep']);
});

test('list_notebooks shows the test notebook', async () => {
  const r = await srv.call('list_notebooks', {});
  assert.equal(r.structuredContent.notebooks[0].id, 'test');
  assert.equal(r.structuredContent.notebooks[0].files, 3);
  assert.deepEqual(r.structuredContent.notebooks[0].roots, ['code']);
});

test('search finds docs and code without a model', async () => {
  const r = await srv.call('search', { notebook: 'test', query: 'payload' });
  assert.ok(!r.isError);
  const paths = r.structuredContent.hits.map((h) => h.path);
  assert.ok(paths.includes('docs/guide/a.md'));
  assert.ok(paths.includes('src/java/net/x/Foo.java'));
  assert.match(r.content[0].text, /^\d+ hits\n/);
  assert.match(r.content[0].text, /src\/java\/net\/x\/Foo\.java:4: {3}void payload\(\) \{\}/);
  const re = await srv.call('search', { notebook: 'test', query: 'Guide [AB]', regex: true });
  assert.equal(re.structuredContent.hits.length, 2);
  const badRe = await srv.call('search', { notebook: 'test', query: '(', regex: true });
  assert.equal(badRe.isError, true);
  assert.match(badRe.content[0].text, /bad regex/);
});

test('bad arguments come back as a tool error naming the problem', async () => {
  const r = await srv.call('search', { notebook: 'test', q: 'x' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /query is required/);
  assert.match(r.content[0].text, /q is not a known property/);
  const m = await srv.call('ask', { notebook: 'test', question: 'x', mode: 'turbo' });
  assert.match(m.content[0].text, /mode must be one of fast, deep/);
  const nb = await srv.call('search', { notebook: 'nope', query: 'x' });
  assert.match(nb.content[0].text, /no notebook "nope"; known notebooks: test/);
});

test('read_source returns numbered lines and refuses paths that escape', async () => {
  const r = await srv.call('read_source', { notebook: 'test', path: 'docs/guide/a.md', start: 3, end: 4 });
  assert.ok(!r.isError);
  assert.equal(r.content[0].text, 'docs/guide/a.md lines 3-4 of 6\n3  hello world, this is the\n4  first   guide about payloads.\n(more: lines 5-6)');
  const code = await srv.call('read_source', { notebook: 'test', path: 'code/net/x/Foo.java' });
  assert.match(code.content[0].text, /^src\/java\/net\/x\/Foo\.java lines 1-5 of 5\n1  package net\.x;/);
  for (const p of ['../outside.md', 'docs/../../outside.md', path.join(env.root, 'outside.md'), 'C:/Windows/win.ini']) {
    const bad = await srv.call('read_source', { notebook: 'test', path: p });
    assert.equal(bad.isError, true, p);
    assert.match(bad.content[0].text, /escapes the notebook/, p);
  }
  // inside the notebook dir but neither pinned nor under a root
  const secret = await srv.call('read_source', { notebook: 'test', path: 'secret.txt' });
  assert.equal(secret.isError, true);
  assert.match(secret.content[0].text, /not a pinned doc or a code-root file/);
  const past = await srv.call('read_source', { notebook: 'test', path: 'docs/intro.md', start: 50 });
  assert.match(past.content[0].text, /has 3 lines/);
});

test('verify re-checks citation strings in every form', async () => {
  const r = await srv.call('verify', { notebook: 'test', citations: [
    '[[docs/guide/a.md|"Register handlers in RegisterPayloadHandlersEvent."]]',
    'src/java/net/x/Foo.java#L3-L5',
    '[[docs/guide/a.md#L1|"first guide about payloads."]]',
    '[[docs/guide/a.md|"words that are not there"]]',
    '[[../outside.md#L1]]',
    '[[]]',
  ] });
  assert.deepEqual(r.structuredContent.results.map((x) => x.status), ['verified', 'verified', 'moved', 'unverified', 'missing', 'unparsed']);
  assert.equal(r.structuredContent.results[0].line, 6);
  assert.equal(r.structuredContent.results[2].line, 4);
  assert.deepEqual(r.structuredContent.counts, { verified: 2, moved: 1, unverified: 1, missing: 1, unparsed: 1 });
  assert.match(r.content[0].text, /\[3\] moved docs\/guide\/a\.md:4 "first guide about payloads\." \(cited at line 1\)/);
});

test('ask with the fake engine returns the answer, checked citations and a saved conversation', async () => {
  const r = await srv.call('ask', { notebook: 'test', question: 'Where do payload handlers go?' }, { progressToken: 'p1' });
  assert.ok(!r.isError, r.content[0].text);
  const s = r.structuredContent;
  assert.equal(s.answer, 'Handlers go in the event [1]. Foo is the class [2]. Ghosts too [3].');
  assert.deepEqual(s.citations.map((c) => [c.n, c.status, c.path, c.line]), [[1, 'verified', 'docs/guide/a.md', 6], [2, 'verified', 'src/java/net/x/Foo.java', 3], [3, 'missing', 'docs/ghost.md', 1]]);
  assert.equal(s.model, 'haiku'); // fast is the default mode
  // the saved lines are file text and stay out of what the model gets back
  assert.ok(!s.citations.some((c) => 'saw' in c));
  assert.ok(!JSON.stringify(r.structuredContent).includes('public class Foo'));
  assert.ok(!r.content.map((x) => x.text).join(' ').includes('public class Foo'));
  assert.equal(s.costUsd, 0.0123);
  assert.equal(typeof s.seconds, 'number');
  const t = r.content[0].text;
  assert.ok(t.startsWith(`${s.answer}\n\nCitations:\n[1] verified docs/guide/a.md:6 "Register handlers in RegisterPayloadHandlersEvent."\n[2] verified src/java/net/x/Foo.java:3\n[3] missing docs/ghost.md:1`), t);
  assert.match(t, new RegExp(`conversationId: ${s.conversationId}\nmodel: haiku\nseconds: [\\d.]+\ncost: \\$0\\.0123$`));
  const saved = JSON.parse(fs.readFileSync(path.join(env.nbDir, 'conversations', `${s.conversationId}.json`), 'utf8'));
  assert.equal(saved.turns.length, 1);
  assert.equal(saved.turns[0].question, 'Where do payload handlers go?');
  assert.equal(saved.turns[0].maxTurns, 4);
  assert.equal(saved.turns[0].effort, 'low');

  const deep = await srv.call('ask', { notebook: 'test', question: 'And Foo?', mode: 'deep', conversationId: s.conversationId });
  assert.equal(deep.structuredContent.model, 'opus');
  assert.equal(deep.structuredContent.conversationId, s.conversationId);
  const again = JSON.parse(fs.readFileSync(path.join(env.nbDir, 'conversations', `${s.conversationId}.json`), 'utf8'));
  assert.deepEqual(again.turns.map((x) => [x.model, x.effort, x.maxTurns]), [['haiku', 'low', 4], ['opus', 'high', 12]]);

  const lost = await srv.call('ask', { notebook: 'test', question: 'x', conversationId: 'no-such-conv' });
  assert.equal(lost.isError, true);
  assert.match(lost.content[0].text, /no conversation no-such-conv/);
});

test('list_artifacts and get_artifact read Studio artifacts with citations re-checked', async () => {
  const empty = await srv.call('list_artifacts', { notebook: 'test' });
  assert.deepEqual(empty.structuredContent.artifacts, []);
  const a = {
    id: 'art-1', recipe: 'cheat-sheet', kind: 'doc', status: 'ok', title: 'Cheats', model: 'haiku', costUsd: 0.1,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', summary: '',
    markdown: '# Cheats\n\nHandlers [^1].',
    citations: [{ n: 1, path: 'docs/guide/a.md', line: 6, endLine: 6, quote: 'Register handlers in RegisterPayloadHandlersEvent.', status: 'verified' }],
  };
  fs.mkdirSync(path.join(env.nbDir, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(env.nbDir, 'artifacts', 'art-1.json'), JSON.stringify(a));
  const list = await srv.call('list_artifacts', { notebook: 'test' });
  assert.equal(list.structuredContent.artifacts[0].id, 'art-1');
  assert.match(list.content[0].text, /^art-1 {2}cheat-sheet \(doc\) {2}ok {2}"Cheats"/);
  const got = await srv.call('get_artifact', { notebook: 'test', id: 'art-1' });
  assert.equal(got.structuredContent.markdown, '# Cheats\n\nHandlers [1].');
  assert.equal(got.structuredContent.citations[0].status, 'verified');
  // edit the file so the quote is gone: the re-check sees it
  fs.writeFileSync(path.join(env.nbDir, 'docs', 'guide', 'a.md'), '# Guide A\n\nrewritten\n');
  const drift = await srv.call('get_artifact', { notebook: 'test', id: 'art-1' });
  assert.equal(drift.structuredContent.citations[0].status, 'unverified');
  assert.match(drift.content[0].text, /\[1\] unverified docs\/guide\/a\.md:6/);
  const none = await srv.call('get_artifact', { notebook: 'test', id: 'nope' });
  assert.equal(none.isError, true);
});

test('stdout carries only protocol messages', () => {
  assert.ok(srv.stdout.length > 10);
  for (const l of srv.stdout) assert.equal(JSON.parse(l).jsonrpc, '2.0');
  assert.match(srv.stderr(), /\[lectern\] ready/);
});

test('an ask that hits the round cap says so instead of answering', async () => {
  const s = start(capFixture);
  try {
    await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
    const r = await s.call('ask', { notebook: 'test', question: 'Too big?' });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /stopped at the 4-round cap/);
    // pending replies still go out after stdin closes, then it exits cleanly
    const p = s.call('list_notebooks', {});
    const code = await s.stop();
    assert.equal((await p).structuredContent.notebooks[0].id, 'test');
    assert.equal(code, 0);
  } finally { s.child.kill(); }
});

test('verify only counts pinned docs and code-root files, and odd root names are just missing', async () => {
  const r = await srv.call('verify', { notebook: 'test', citations: [
    '[[secret.txt|"outside the shelf"]]', 'notebook.json#L1', 'constructor/x.md#L1', '__proto__/x.md#L1', 'toString/a.md#L1', 'docs/intro.md#L1',
  ] });
  assert.ok(!r.isError, r.content[0].text);
  assert.deepEqual(r.structuredContent.results.map((x) => x.status), ['missing', 'missing', 'missing', 'missing', 'missing', 'verified']);
  const rs = await srv.call('read_source', { notebook: 'test', path: 'constructor/x' });
  assert.equal(rs.isError, true);
  assert.doesNotMatch(rs.content[0].text, /must be of type string/);
});

test('argument names that are built-in object members are still unknown', async () => {
  const r = await srv.call('search', { notebook: 'test', query: 'x', constructor: 1, toString: 'y' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /constructor is not a known property/);
  assert.match(r.content[0].text, /toString is not a known property/);
});

test('a line that starts with a byte order mark still parses', async () => {
  const r = await new Promise((resolve) => {
    const id = 'bom-1';
    const t = setInterval(() => { const m = srv.notes.find((x) => x.id === id); if (m) { clearInterval(t); resolve(m); } }, 10);
    srv.raw('\uFEFF' + JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' }));
  });
  assert.deepEqual(r.result, {});
});

test('a cancel that lands while generate is still preparing stops the run', async () => {
  const before = fs.readdirSync(path.join(env.nbDir, 'artifacts')).length;
  // the call and its cancel go out in one write, so the cancel arrives before prepare finishes
  const id = 'gen-cancel';
  srv.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'generate', arguments: { notebook: 'test', recipe: 'cheat-sheet' } } }) + '\n'
    + JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id } }) + '\n');
  await srv.request('ping');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(fs.readdirSync(path.join(env.nbDir, 'artifacts')).length, before);
  assert.ok(!srv.notes.some((m) => m.id === id), 'a cancelled request gets no reply');
});

// ---------- recipe prompts and submit_artifact ----------

const { listRecipes } = await import('../lib/studio/recipes.mjs');
const rpc = async (s, method, params) => (await s.request(method, params));
const promptText = (r) => r.result.messages[0].content.text;
const artDir = path.join(env.nbDir, 'artifacts');
const artFiles = () => (fs.existsSync(artDir) ? fs.readdirSync(artDir).filter((f) => f.endsWith('.json')) : []);
const fence = (o, before = 'The map shows the main class.') => `${before}\n\n\`\`\`json\n${JSON.stringify(o, null, 2)}\n\`\`\`\n`;
const PAD = 'These notes cover the intro page and one page that is not there, and they run long enough to pass the length check. ';

test('prompts/list gives every recipe a slash command with its inputs as arguments', async () => {
  const { prompts } = (await rpc(srv, 'prompts/list', {})).result;
  const recipes = listRecipes();
  assert.equal(prompts.length, 24);
  assert.deepEqual(prompts.map((p) => p.name), recipes.map((r) => r.id));
  for (const p of prompts) {
    assert.ok(p.title, p.name);
    assert.ok(p.description.length > 20, p.name);
    const last = p.arguments.at(-1);
    assert.equal(last.name, 'notebook', p.name);
    assert.equal(last.required, false, p.name);
    assert.equal(new Set(p.arguments.map((a) => a.name)).size, p.arguments.length, `${p.name} repeats an argument name`);
  }
  const args = (n) => prompts.find((p) => p.name === n).arguments.map((a) => [a.name, a.required]);
  assert.deepEqual(args('diff-review'), [['diff', true], ['notebook', false]]);
  assert.deepEqual(args('adr'), [['decision', true], ['options', false], ['notebook', false]]);
  assert.match(prompts.find((p) => p.name === 'tech-spec').description, /Give one of: source, idea/);
  for (const p of prompts) for (const a of p.arguments) assert.doesNotMatch(a.description, /[?!]\.|[^.]\.\.(\s|$)/, `${p.name}.${a.name} doubles its punctuation`);
});

test('prompts/get returns the recipe prompt, the agent steps and the exact submit call', async () => {
  const r = await rpc(srv, 'prompts/get', { name: 'adr', arguments: { decision: 'How should we store settings?' } });
  assert.equal(r.result.messages.length, 1);
  assert.equal(r.result.messages[0].role, 'user');
  assert.equal(r.result.messages[0].content.type, 'text');
  const t = promptText(r);
  for (const bit of ['architecture decision record', 'How should we store settings?', 'submit_artifact', 'read_source', 'notebook "test"', 'recipe "adr"', 'inputs {"decision":"How should we store settings?"}']) assert.ok(t.includes(bit), bit);
  assert.match(r.result.description, /Test Notebook/);
  const map = await rpc(srv, 'prompts/get', { name: 'code-map', arguments: { root: 'code' } });
  assert.ok(promptText(map).includes('notebook path "src/java"'));
  // the agent block lists the roots itself, so recipes that name none still get them
  const gloss = promptText(await rpc(srv, 'prompts/get', { name: 'glossary', arguments: { notebook: '' } }));
  assert.match(gloss, /these code roots also work[^]*\n {2}- code: .*src[\\/]java/);
});

test('prompts/get errors are invalid params, not crashes', async () => {
  const bad = async (params) => (await rpc(srv, 'prompts/get', params)).error;
  let e = await bad({ name: 'nope', arguments: {} });
  assert.equal(e.code, -32602); assert.match(e.message, /Unknown prompt/);
  e = await bad({ name: 'adr', arguments: {} });
  assert.equal(e.code, -32602); assert.match(e.message, /decision is required/);
  e = await bad({ name: 'adr', arguments: { decision: 'x', extra: 'y' } });
  assert.equal(e.code, -32602); assert.match(e.message, /not a known property/);
  e = await bad({ name: 'adr', arguments: { decision: 5 } });
  assert.equal(e.code, -32602); assert.match(e.message, /must be a string/);
  e = await bad({ name: 'adr', arguments: { decision: 'x', notebook: 'ghost' } });
  assert.equal(e.code, -32602); assert.match(e.message, /no notebook "ghost"; known notebooks: test/);
  e = await bad({ name: 'tech-spec', arguments: {} });
  assert.equal(e.code, -32602); assert.match(e.message, /give one of/);
  assert.deepEqual((await rpc(srv, 'ping')).result, {});
});

test('prompts/get picks the notebook from where Claude Code was started when there are several', async () => {
  const other = path.join(env.root, 'other');
  fs.mkdirSync(path.join(other, 'code'), { recursive: true });
  fs.writeFileSync(path.join(other, 'notebook.json'), JSON.stringify({ name: 'other', title: 'Other', pinned: [], roots: { src: 'code' } }));
  const home = path.join(env.root, 'home2');
  fs.mkdirSync(home, { recursive: true });
  const posix = (p) => p.split(path.sep).join('/');
  fs.writeFileSync(path.join(home, 'registry.json'), JSON.stringify({ notebooks: { test: { dir: posix(env.nbDir), title: 'Test Notebook' }, other: { dir: posix(other), title: 'Other' } } }));
  const inRoot = start(okFixture, { home, cwd: path.join(env.nbDir, 'src', 'java', 'net') });
  const outside = start(okFixture, { home, cwd: env.root });
  try {
    const r = await rpc(inRoot, 'prompts/get', { name: 'adr', arguments: { decision: 'x' } });
    assert.ok(promptText(r).includes('notebook "test"'));
    const e = (await rpc(outside, 'prompts/get', { name: 'adr', arguments: { decision: 'x' } })).error;
    assert.equal(e.code, -32602);
    assert.match(e.message, /notebook is required; you have: test, other/);
  } finally { inRoot.child.kill(); outside.child.kill(); }
});

test('submit_artifact saves a checked doc, reports statuses and replaces its own draft', async () => {
  await srv.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '1' } });
  const bad = `# Cheats\n\n${PAD}Welcome text [[docs/intro.md|"Welcome."]]. A ghost [[docs/ghost.md#L1]].`;
  const r = await srv.call('submit_artifact', { notebook: 'test', recipe: 'cheat-sheet', draft: bad });
  assert.ok(!r.isError, r.content[0].text);
  const s = r.structuredContent;
  assert.equal(s.saved, true);
  assert.deepEqual(s.counts, { verified: 1, moved: 0, unverified: 0, missing: 1 });
  assert.match(r.content[0].text, /Fix every unverified or missing/);
  assert.ok(r.content[0].text.includes('[2] missing docs/ghost.md:1'));
  const saved = JSON.parse(fs.readFileSync(path.join(artDir, `${s.id}.json`), 'utf8'));
  assert.equal(saved.engine, 'mcp');
  assert.equal(saved.client, 'claude-code');
  assert.equal(saved.model, null);
  assert.equal(saved.status, 'ok');
  assert.ok(saved.markdown.includes('[^1]'));
  assert.equal((await srv.call('get_artifact', { notebook: 'test', id: s.id })).structuredContent.id, s.id);

  const good = `# Cheats\n\n${PAD}Welcome text [[docs/intro.md|"Welcome."]]. The title line [[docs/intro.md#L1]].`;
  const again = await srv.call('submit_artifact', { notebook: 'test', recipe: 'cheat-sheet', draft: good, replaces: s.id });
  assert.ok(!again.isError, again.content[0].text);
  assert.equal(again.structuredContent.id, s.id);
  assert.deepEqual(again.structuredContent.counts, { verified: 2, moved: 0, unverified: 0, missing: 0 });
  assert.doesNotMatch(again.content[0].text, /Fix every/);
  const after = JSON.parse(fs.readFileSync(path.join(artDir, `${s.id}.json`), 'utf8'));
  assert.equal(after.createdAt, saved.createdAt);
  const list = await srv.call('list_artifacts', { notebook: 'test' });
  assert.equal(list.structuredContent.artifacts.filter((a) => a.recipe === 'cheat-sheet' && a.id !== 'art-1').length, 1);
});

test('submit_artifact refuses a draft that breaks the contract and saves nothing', async () => {
  const before = artFiles().length;
  const r = await srv.call('submit_artifact', { notebook: 'test', recipe: 'code-map', inputs: { root: 'code' }, draft: 'no json here' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /Nothing was saved/);
  assert.match(r.content[0].text, /no ```json block/);
  assert.equal(r.structuredContent.saved, false);
  const noCite = await srv.call('submit_artifact', { notebook: 'test', recipe: 'cheat-sheet', draft: `# Cheats\n\n${PAD}${PAD}` });
  assert.equal(noCite.isError, true);
  assert.match(noCite.content[0].text, /has no citations/);
  assert.equal(artFiles().length, before);
});

test('submit_artifact checks inputs like generate and only replaces its own drafts', async () => {
  const draft = `# Cheats\n\n${PAD}Welcome text [[docs/intro.md|"Welcome."]].`;
  const noInput = await srv.call('submit_artifact', { notebook: 'test', recipe: 'adr', draft: '# x' });
  assert.equal(noInput.isError, true);
  assert.match(noInput.content[0].text, /Decision to make/);

  const foreign = path.join(artDir, 'other-1.json');
  fs.writeFileSync(foreign, JSON.stringify({ id: 'other-1', recipe: 'cheat-sheet', kind: 'doc', status: 'ok', title: 'Mine', markdown: '# Mine', citations: [] }));
  const bytes = fs.readFileSync(foreign);
  const notMine = await srv.call('submit_artifact', { notebook: 'test', recipe: 'cheat-sheet', draft, replaces: 'other-1' });
  assert.equal(notMine.isError, true);
  assert.match(notMine.content[0].text, /was not made by submit_artifact/);
  assert.ok(fs.readFileSync(foreign).equals(bytes));

  const gone = await srv.call('submit_artifact', { notebook: 'test', recipe: 'cheat-sheet', draft, replaces: 'nope-1' });
  assert.match(gone.content[0].text, /no artifact nope-1 to replace/);
  const odd = await srv.call('submit_artifact', { notebook: 'test', recipe: 'cheat-sheet', draft, replaces: '../x' });
  assert.match(odd.content[0].text, /has the wrong format/);

  const mine = await srv.call('submit_artifact', { notebook: 'test', recipe: 'cheat-sheet', draft });
  const other = await srv.call('submit_artifact', { notebook: 'test', recipe: 'glossary', draft, replaces: mine.structuredContent.id });
  assert.equal(other.isError, true);
  assert.match(other.content[0].text, /was not made by submit_artifact for glossary/);
});

test('submit_artifact lists data refs that did not verify', async () => {
  const graph = {
    title: 'Code map', layout: 'layered',
    nodes: [
      { id: 'pkg', label: 'net.x', kind: 'package' },
      { id: 'foo', label: 'Foo', kind: 'class', ref: 'src/java/net/x/Foo.java#L3', detail: 'The main class [[src/java/net/x/Foo.java#L3-L5]].' },
      { id: 'ghost', label: 'Ghost', kind: 'class', ref: 'src/java/Ghost.java#L1', detail: 'Not there.' },
    ],
    edges: [{ from: 'pkg', to: 'foo', label: 'contains', kind: 'contains' }, { from: 'pkg', to: 'ghost' }],
  };
  const r = await srv.call('submit_artifact', { notebook: 'test', recipe: 'code-map', inputs: { root: 'code' }, draft: fence(graph, 'The map shows the package [[docs/intro.md|"Welcome."]].') });
  assert.ok(!r.isError, r.content[0].text);
  assert.deepEqual(r.structuredContent.badRefs, ['src/java/Ghost.java#L1 (missing)']);
  assert.match(r.content[0].text, /Fix every unverified or missing citation and ref/);
});

test('recall returns saved answers with citations re-checked, and a plain message when nothing is close', async () => {
  const dir = path.join(env.nbDir, 'conversations');
  fs.mkdirSync(dir, { recursive: true });
  const cite = { n: 1, path: 'docs/intro.md', quote: 'Welcome.', line: 3, endLine: 3, status: 'verified' };
  fs.writeFileSync(path.join(dir, 'recall-1.json'), JSON.stringify({ id: 'recall-1', notebook: 'test', title: 'intro', created: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z',
    turns: [{ question: 'How does the intro greet new readers?', answer: 'It opens with a welcome line [^1].', citations: [cite] }] }));
  const r = await srv.call('recall', { query: 'intro greet readers' });
  assert.ok(!r.isError, r.content[0].text);
  const hit = r.structuredContent.hits.find((h) => h.id === 'recall-1');
  assert.equal(hit.kind, 'answer');
  assert.equal(hit.cites.verified, 1);
  assert.equal(hit.citations[0].status, 'verified');
  assert.doesNotMatch(hit.text, /\[\^1\]/);
  assert.match(r.content[0].text, /Citations \(checked just now\):/);
  assert.match(r.content[0].text, /conversationId: recall-1/);
  const none = await srv.call('recall', { query: 'zzqq xxyy' });
  assert.match(none.content[0].text, /^No saved answer/);
  assert.deepEqual(none.structuredContent.hits, []);
});

test('recall takes one notebook, a kinds filter and rejects bad arguments', async () => {
  const ghost = await srv.call('recall', { query: 'intro greet readers', notebook: 'ghost' });
  assert.equal(ghost.isError, true);
  assert.match(ghost.content[0].text, /no notebook "ghost"/);
  const one = await srv.call('recall', { query: 'intro greet readers', notebook: 'test', limit: 1 });
  assert.equal(one.structuredContent.hits.length, 1);
  const sheets = await srv.call('recall', { query: 'intro greet readers', kinds: ['sheet'] });
  assert.ok(sheets.structuredContent.hits.every((h) => h.kind === 'sheet'));
  const bogus = await srv.call('recall', { query: 'intro', kinds: ['bogus'] });
  assert.equal(bogus.isError, true);
  assert.match(bogus.content[0].text, /must be one of answer, note, sheet/);
  const zero = await srv.call('recall', { query: 'intro', limit: 0 });
  assert.match(zero.content[0].text, /must be at least 1/);
});
