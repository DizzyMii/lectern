// The API engine against a local fake Messages endpoint that replays SSE fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { setupNotebook } from './helpers.mjs';

const env = setupNotebook();
const FIX = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'fixtures', 'api');
const fixture = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');

// script: what the next requests get, in order. { file } streams a fixture, { body } streams the given text,
// { hang } streams a fixture and never ends, { status } answers with that error status.
const script = [];
const requests = [];
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => { raw += d; });
  req.on('end', () => {
    const entry = { headers: req.headers, url: req.url, body: JSON.parse(raw || '{}'), closed: false };
    requests.push(entry);
    req.on('close', () => { entry.closed = true; });
    res.on('close', () => { entry.closed = true; });
    const next = script.shift();
    if (!next) { res.writeHead(500, { 'content-type': 'application/json' }); return res.end('{"type":"error","error":{"type":"api_error","message":"script ran out"}}'); }
    if (next.status) {
      res.writeHead(next.status, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'scripted rejection' } }));
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    if (next.hang) { res.write(fixture(next.hang)); return; }
    res.end(next.body ?? fixture(next.file));
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
delete process.env.LECTERN_FAKE_ENGINE;

const engine = await import('../lib/engine.mjs');
const spend = await import('../lib/spend.mjs');
const { getNotebook, getConversation } = await import('../lib/store.mjs');
const { toolDefs } = await import('../lib/shelf.mjs');
const { invalidate } = await import('../lib/sources.mjs');
const { ask, priceUsage, pickEngine, defaultEngine, engineStatus, inputError } = engine;

const cfgFile = path.join(env.nbDir, 'notebook.json');
const baseCfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
const setBudget = (usd) => fs.writeFileSync(cfgFile, JSON.stringify(usd == null ? baseCfg : { ...baseCfg, budgetUsd: usd }));
const spendFile = path.join(env.home, 'spend.json');
const seedSpend = (usd) => fs.writeFileSync(spendFile, JSON.stringify(usd == null ? {} : { [spend.monthKey()]: { test: { usd, runs: 1 } } }));

function run(opts) {
  const events = [];
  const job = ask({ notebook: 'test', engine: 'api', ...opts, onEvent: (e) => { events.push(e); opts.onEvent?.(e, job); } });
  return { job, events };
}

test.beforeEach(() => { script.length = 0; requests.length = 0; setBudget(null); seedSpend(null); });
test.after(() => { fake.closeAllConnections(); fake.close(); env.cleanup(); });

test('a tool round then a cited answer, with the request shaped per the API rules', async () => {
  script.push({ file: 'tool-round.sse' }, { file: 'cited-answer.sse' });
  const { job, events } = run({ question: 'How do I register payload handlers?' });
  const out = await job.done;

  // first request: model id, adaptive thinking, explicit effort, docs with citations, cache breakpoints, fallback
  const r1 = requests[0];
  assert.ok(r1.url.startsWith('/v1/messages'));
  assert.equal(r1.body.model, 'claude-opus-5-5');
  assert.equal(r1.body.stream, true);
  assert.deepEqual(r1.body.thinking, { type: 'adaptive' });
  assert.ok(!JSON.stringify(r1.body).includes('budget_tokens'));
  assert.deepEqual(r1.body.output_config, { effort: 'medium' });
  assert.equal(r1.body.fallbacks, 'default');
  assert.match(String(r1.headers['anthropic-beta']), /server-side-fallback-2026-07-01/);
  assert.deepEqual(r1.body.cache_control, { type: 'ephemeral', ttl: '1h' });
  const docs = r1.body.messages[0].content.filter((c) => c.type === 'document');
  assert.equal(docs.length, 2);
  assert.ok(docs.every((d) => d.citations?.enabled === true));
  assert.deepEqual(docs.map((d) => d.cache_control ?? null), [null, { type: 'ephemeral', ttl: '1h' }]);
  assert.deepEqual(r1.body.tools.map((t) => t.name), ['grep', 'read', 'ls']);
  assert.ok(r1.body.tools.every((t) => t.eager_input_streaming === true));
  assert.match(r1.body.system, /\[\[path#L12\]\]/);

  // second request: the assistant turn goes back whole (thinking signature included) and both tool results ride in one user message
  const r2 = requests[1];
  const asst = r2.body.messages.at(-2);
  assert.equal(asst.role, 'assistant');
  assert.equal(asst.content[0].type, 'thinking');
  assert.equal(asst.content[0].signature, 'sig-fixture');
  const results = r2.body.messages.at(-1).content;
  assert.deepEqual(results.map((c) => c.type), ['tool_result', 'tool_result']);
  assert.deepEqual(results.map((c) => c.tool_use_id), ['toolu_grep', 'toolu_read']);
  assert.match(results[0].content, /net\/x\/Foo\.java:4:/);
  assert.match(results[1].content, /^1: package net\.x;/);

  // events follow the claude-code contract
  const tools = events.filter((e) => e.type === 'tool');
  assert.deepEqual(tools.map((t) => t.summary), ['Grep "payload" in code', 'Read code/net/x/Foo.java 1-5']);
  assert.deepEqual(events.filter((e) => e.type === 'tool_result').map((e) => [e.id, e.ok]), [['toolu_grep', true], ['toolu_read', true]]);
  const deltas = events.filter((e) => e.type === 'delta').map((e) => e.text).join('');
  assert.ok(deltas.startsWith('Let me look in the code.Handlers are registered'));
  assert.equal(events.at(-1).type, 'done');

  // API citations map to file:line, the [[...]] code form is verified the same way
  const doc = out.citations.find((c) => c.path === 'docs/guide/a.md');
  assert.ok(doc, JSON.stringify(out.citations));
  assert.equal(doc.line, 6);
  assert.equal(doc.status, 'verified');
  const code = out.citations.find((c) => c.path === 'src/java/net/x/Foo.java');
  assert.equal(code.line, 4);
  assert.equal(code.status, 'verified');
  // the lines are saved with what the trail read of that file (the read tool's root is a root name)
  assert.ok(code.saw.text.includes('void payload'));
  assert.deepEqual(code.saw.read, [[1, 5]]);
  assert.ok(!out.answer.includes('Let me look'), 'only the last message is the answer');

  // usage and cost add up across both rounds
  assert.equal(out.usage.input_tokens, 1500);
  assert.equal(out.usage.cache_read_input_tokens, 3000);
  assert.equal(out.usage.output_tokens, 200);
  const want = priceUsage('claude-opus-5-5', { input_tokens: 1200, cache_creation_input_tokens: 3000, output_tokens: 80 })
    + priceUsage('claude-opus-5-5', { input_tokens: 300, cache_read_input_tokens: 3000, output_tokens: 120 });
  assert.ok(Math.abs(out.costUsd - want) < 1e-6, `${out.costUsd} vs ${want}`);
  assert.ok(Math.abs(spend.spentUsd('test') - want) < 1e-6);
  const conv = getConversation(getNotebook('test'), out.conversationId);
  assert.equal(conv.engine, 'api');
  assert.equal(conv.turns[0].costUsd, out.costUsd);
  assert.deepEqual(conv.turns[0].citations.find((c) => c.path === 'src/java/net/x/Foo.java').saw.read, [[1, 5]]);
});

test('fast mode is haiku at low effort with no server fallback, and a refusal fails the run', async () => {
  script.push({ file: 'refusal.sse' });
  const { job, events } = run({ question: 'something declined', fast: true });
  await assert.rejects(job.done, /declined to answer this \(cyber\): This request was declined/);
  const r = requests[0].body;
  assert.equal(r.model, 'claude-haiku-5-5');
  assert.deepEqual(r.output_config, { effort: 'low' });
  assert.equal(r.fallbacks, undefined);
  assert.ok(!String(requests[0].headers['anthropic-beta'] ?? '').includes('server-side-fallback'));
  assert.equal(events.at(-1).type, 'error');
  assert.ok(spend.spentUsd('test') > 0, 'the refused run is still counted');
});

test('deep mode is opus at high effort', async () => {
  script.push({ file: 'cited-answer.sse' });
  const { job } = run({ question: 'q', model: engine.MODES.deep.model, effort: engine.MODES.deep.effort, maxTurns: engine.MODES.deep.maxTurns });
  await job.done;
  assert.equal(requests[0].body.model, 'claude-opus-5-5');
  assert.deepEqual(requests[0].body.output_config, { effort: 'high' });
  assert.equal(engine.MODES.deep.maxTurns, 12);
  assert.deepEqual(engine.MODES.fast, { model: 'haiku', effort: 'low', maxTurns: 4 });
});

test('ANTHROPIC_WORKSPACE_ID goes out as the anthropic-workspace-id header', async () => {
  process.env.ANTHROPIC_WORKSPACE_ID = 'wrkspc_test123';
  try {
    script.push({ file: 'cited-answer.sse' });
    const { job } = run({ question: 'q', fast: true });
    await job.done;
    assert.equal(requests[0].headers['anthropic-workspace-id'], 'wrkspc_test123');
  } finally { delete process.env.ANTHROPIC_WORKSPACE_ID; }
});

test('cancel mid-stream aborts the request', async () => {
  script.push({ hang: 'cancel-head.sse' });
  const { job, events } = run({ question: 'slow one', onEvent: (e, j) => { if (e.type === 'delta') j.cancel(); } });
  const t0 = Date.now();
  await assert.rejects(job.done, /cancelled/);
  assert.ok(Date.now() - t0 < 5000);
  assert.ok(events.some((e) => e.type === 'delta'));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].closed, true);
});

test('max_tokens on a text answer keeps the text and says it was cut off', async () => {
  script.push({ file: 'max-tokens.sse' });
  const { job } = run({ question: 'long', model: 'sonnet' });
  const out = await job.done;
  assert.match(out.answer, /A long answer that ran out/);
  assert.match(out.answer, /cut off at the output limit/);
  assert.equal(requests[0].body.model, 'claude-sonnet-5-5');
});

test('round cap with a tool call still pending fails like the claude-code engine', async () => {
  script.push({ file: 'tool-round.sse' });
  const { job } = run({ question: 'q', maxTurns: 1 });
  await assert.rejects(job.done, /1-round cap/);
});

test('budget: warning at 80%, refusal at 100% unless override', async () => {
  setBudget(1);
  seedSpend(0.85);
  script.push({ file: 'cited-answer.sse' });
  let r = run({ question: 'q' });
  await r.job.done;
  const warn = r.events.find((e) => e.type === 'warning');
  assert.ok(warn, 'warned');
  assert.match(warn.message, /\$0\.85 of a \$1\.00 budget \(85%\)/);
  assert.equal(r.events.indexOf(warn), 0, 'warning comes before any answer text');

  seedSpend(1);
  assert.throws(() => ask({ notebook: 'test', engine: 'api', question: 'q' }), (e) => e.status === 402 && /override/.test(e.message) && e.budget.state === 'over');
  assert.equal(requests.length, 1, 'no request went out');

  script.push({ file: 'cited-answer.sse' });
  r = run({ question: 'q', override: true });
  await r.job.done;
  assert.ok(spend.spentUsd('test') > 1);
});

test('budget: a run that crosses 80% warns at the end', async () => {
  setBudget(1);
  seedSpend(0.5);
  script.push({ file: 'max-tokens.sse' }); // sonnet, 64000 output tokens is about $0.65
  const r = run({ question: 'q', model: 'sonnet' });
  const out = await r.job.done;
  const warn = r.events.find((e) => e.type === 'warning');
  assert.ok(warn);
  assert.ok(r.events.indexOf(warn) < r.events.findIndex((e) => e.type === 'done'));
  assert.equal(out.budget.state, 'over');
  assert.equal(spend.budgetStatus(getNotebook('test')).state, 'over');
});

test('the claude-code engine ignores the API budget', () => {
  setBudget(1);
  seedSpend(5);
  process.env.LECTERN_FAKE_ENGINE = '1';
  try {
    const job = ask({ notebook: 'test', engine: 'claude-code', question: 'q' });
    job.cancel();
    return job.done.catch(() => {});
  } finally { delete process.env.LECTERN_FAKE_ENGINE; }
});

test('engine choice: key means api, then claude, explicit requests honoured when possible', () => {
  assert.equal(defaultEngine(), 'api');
  assert.equal(pickEngine(undefined), 'api');
  assert.equal(pickEngine('api'), 'api');
  assert.equal(engineStatus().label, 'API');
  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.equal(pickEngine('api'), 'claude-code');
    const s = engineStatus();
    assert.equal(s.api.available, false);
    if (engine.findClaude()) {
      assert.equal(s.default, 'claude-code');
      assert.equal(s.label, 'personal: uses your Claude Code login');
    } else {
      assert.equal(s.default, null);
      assert.match(s.onboarding, /ANTHROPIC_API_KEY/);
    }
  } finally { process.env.ANTHROPIC_API_KEY = key; }
});

const blocks = (m) => (Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }]);
const markers = (body) => body.messages.flatMap(blocks).filter((b) => b.cache_control).length + (body.cache_control ? 1 : 0);

test('a follow-up sends the first turn whole, tool rounds and thinking included, with a read point on it', async () => {
  script.push({ file: 'tool-round.sse' }, { file: 'cited-answer.sse' });
  const first = await run({ question: 'How do I register payload handlers?' }).job.done;
  script.push({ file: 'cited-answer.sse' });
  const out = await run({ question: 'And where is that event fired?', conversationId: first.conversationId }).job.done;

  const msgs = requests[2].body.messages;
  assert.deepEqual(msgs.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user']);
  assert.equal(msgs[0].content.filter((c) => c.type === 'document').length, 2, 'docs go back in on the first message');
  assert.deepEqual(msgs[0].content.filter((c) => c.type === 'document').at(-1).cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.equal(msgs[1].content[0].signature, 'sig-fixture', 'the thinking block goes back unchanged');
  assert.deepEqual(msgs[2].content.map((c) => c.type), ['tool_result', 'tool_result']);
  assert.deepEqual(msgs[2].content.at(-1).cache_control, { type: 'ephemeral', ttl: '1h' }, 'read point on the last request of turn one');
  assert.match(blocks(msgs[3]).map((b) => b.text ?? '').join(''), /Handlers are registered/);
  assert.equal(blocks(msgs[4])[0].text, 'And where is that event fired?');
  assert.ok(markers(requests[2].body) <= 4, 'the API allows four breakpoints');
  // the turn-one prefix is byte-identical apart from markers, so its cache entries can be read
  const strip = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'cache_control' ? undefined : v)));
  assert.deepEqual(strip(msgs.slice(0, 3)), strip(requests[1].body.messages));

  const conv = getConversation(getNotebook('test'), out.conversationId);
  assert.equal(conv.api.turns, 2);
  assert.equal(conv.api.messages.length, 6);
  assert.ok(!JSON.stringify(conv.api).includes('cache_control'), 'markers are not saved');
  assert.ok(!conv.api.messages[0].content.some((c) => c.type === 'document'), 'docs are not saved');
});

test('a follow-up after the shelf changed replays plain text, with no thinking blocks', async () => {
  script.push({ file: 'tool-round.sse' }, { file: 'cited-answer.sse' });
  const first = await run({ question: 'How do I register payload handlers?' }).job.done;
  const doc = path.join(env.nbDir, 'docs', 'guide', 'b.md');
  const was = fs.readFileSync(doc, 'utf8');
  fs.writeFileSync(doc, was + '\nA line added after the first answer.\n');
  invalidate(getNotebook('test')); // what adding a source does; otherwise the shelf is cached for 30 s
  try {
    script.push({ file: 'cited-answer.sse' });
    await run({ question: 'And where is that event fired?', conversationId: first.conversationId }).job.done;
    const msgs = requests[2].body.messages;
    assert.deepEqual(msgs.map((m) => m.role), ['user', 'assistant', 'user']);
    assert.ok(!JSON.stringify(msgs).includes('"thinking"'), 'no thinking block may go back against a changed prefix');
    assert.deepEqual(msgs[1].content.map((c) => c.type), ['text']);
  } finally { fs.writeFileSync(doc, was); invalidate(getNotebook('test')); }
});

test('one-hour cache writes are priced at 2x and count as one-hour when the split is missing', () => {
  const m = 1_000_000;
  assert.equal(priceUsage('claude-opus-5-5', { cache_creation_input_tokens: m, cache_creation: { ephemeral_5m_input_tokens: m, ephemeral_1h_input_tokens: 0 } }), 5);
  assert.equal(priceUsage('claude-opus-5-5', { cache_creation_input_tokens: m, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: m } }), 8);
  assert.equal(priceUsage('claude-opus-5-5', { cache_creation_input_tokens: m }), 8);
});

test('after a mid-output fallback only text from before the boundary goes back', () => {
  const content = [
    { type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: 'a' }, { type: 'tool_use', id: 't1', name: 'grep', input: {} },
    { type: 'fallback', from: { model: 'x' }, to: { model: 'y' } }, { type: 'text', text: 'b' }, { type: 'tool_use', id: 't2', name: 'read', input: {} },
  ];
  assert.deepEqual(engine.echoContent(content).map((b) => b.type + (b.id ?? b.text ?? '')), ['texta', 'textb', 'tool_uset2']);
  assert.equal(engine.echoContent(content.slice(0, 3)).length, 3, 'nothing changes without a fallback block');
});

const EMPTY_ANSWER = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_empty","type":"message","role":"assistant","model":"claude-opus-5-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":1}}}',
  '', 'event: message_delta', 'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}',
  '', 'event: message_stop', 'data: {"type":"message_stop"}', '', '',
].join('\n');

test('an answer with no text is not saved for resending, so the follow-up replays plain text', async () => {
  script.push({ body: EMPTY_ANSWER });
  const first = await run({ question: 'How do I register payload handlers?' }).job.done;
  assert.equal(getConversation(getNotebook('test'), first.conversationId).api, undefined);
  script.push({ file: 'cited-answer.sse' });
  await run({ question: 'And where is that event fired?', conversationId: first.conversationId }).job.done;
  const msgs = requests[1].body.messages;
  assert.deepEqual(msgs.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.deepEqual(msgs[1].content, [{ type: 'text', text: '(no answer)' }]);
});

test('a turn whose request came near the context window is not saved for resending', async () => {
  script.push({ body: fixture('cited-answer.sse').replace('"input_tokens":300', '"input_tokens":700000') });
  const out = await run({ question: 'How do I register payload handlers?' }).job.done;
  assert.equal(getConversation(getNotebook('test'), out.conversationId).api, undefined);
});

test('a 400 on a resent transcript asks once more with plain text instead of wedging the conversation', async () => {
  script.push({ file: 'tool-round.sse' }, { file: 'cited-answer.sse' });
  const first = await run({ question: 'How do I register payload handlers?' }).job.done;
  script.push({ status: 400 }, { file: 'cited-answer.sse' });
  const out = await run({ question: 'And where is that event fired?', conversationId: first.conversationId }).job.done;
  assert.ok(JSON.stringify(requests[2].body.messages).includes('sig-fixture'), 'the first try resent the transcript');
  assert.deepEqual(requests[3].body.messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.ok(!JSON.stringify(requests[3].body.messages).includes('"thinking"'), 'the retry carries no thinking blocks');
  const conv = getConversation(getNotebook('test'), out.conversationId);
  assert.equal(conv.turns.length, 2);
  assert.equal(conv.api.turns, 2, 'the transcript starts again from what the retry sent');
});

test('tool input is checked against the schema', () => {
  const [grep, read] = toolDefs(['code']);
  assert.equal(inputError(grep, { root: 'code', pattern: 'x' }), null);
  assert.match(inputError(grep, { root: 'code' }), /missing pattern/);
  assert.match(inputError(grep, { root: 'nope', pattern: 'x' }), /must be one of/);
  assert.match(inputError(read, { root: 'code', path: 'a', start: '1' }), /integer/);
  assert.match(inputError(read, { root: 'code', path: 'a', extra: 1 }), /unexpected/);
});

test('/api/notebooks and /api/status expose spend and the engine', async () => {
  setBudget(2);
  seedSpend(0.5);
  const { createServer } = await import('../lib/server.mjs');
  const srv = createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${srv.address().port}`;
    const list = await (await fetch(`${base}/api/notebooks`)).json();
    const nb = list.find((n) => n.id === 'test');
    assert.deepEqual({ ...nb.spend, month: null }, { month: null, spentUsd: 0.5, budgetUsd: 2, fraction: 0.25, state: 'ok' });
    const st = await (await fetch(`${base}/api/status`)).json();
    assert.equal(st.engine.default, 'api');
    assert.equal(st.apiEngine, true);
  } finally { srv.close(); }
});
