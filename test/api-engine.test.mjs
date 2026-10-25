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

// script: what the next requests get, in order. { file } streams a fixture, { hang } streams one and never ends.
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
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    if (next.hang) { res.write(fixture(next.hang)); return; }
    res.end(fixture(next.file));
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
delete process.env.LECTERN_FAKE_ENGINE;

const engine = await import('../lib/engine.mjs');
const { getNotebook, getConversation } = await import('../lib/store.mjs');
const { toolDefs } = await import('../lib/shelf.mjs');
const { ask, priceUsage, pickEngine, defaultEngine, engineStatus, inputError } = engine;

function run(opts) {
  const events = [];
  const job = ask({ notebook: 'test', engine: 'api', ...opts, onEvent: (e) => { events.push(e); opts.onEvent?.(e, job); } });
  return { job, events };
}

test.beforeEach(() => { script.length = 0; requests.length = 0; });
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
  assert.deepEqual(r1.body.cache_control, { type: 'ephemeral' });
  const docs = r1.body.messages[0].content.filter((c) => c.type === 'document');
  assert.equal(docs.length, 2);
  assert.ok(docs.every((d) => d.citations?.enabled === true));
  assert.deepEqual(docs.map((d) => Boolean(d.cache_control)), [false, true]);
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
  assert.ok(!out.answer.includes('Let me look'), 'only the last message is the answer');

  // usage and cost add up across both rounds
  assert.equal(out.usage.input_tokens, 1500);
  assert.equal(out.usage.cache_read_input_tokens, 3000);
  assert.equal(out.usage.output_tokens, 200);
  const want = priceUsage('claude-opus-5-5', { input_tokens: 1200, cache_creation_input_tokens: 3000, output_tokens: 80 })
    + priceUsage('claude-opus-5-5', { input_tokens: 300, cache_read_input_tokens: 3000, output_tokens: 120 });
  assert.ok(Math.abs(out.costUsd - want) < 1e-6, `${out.costUsd} vs ${want}`);
  const conv = getConversation(getNotebook('test'), out.conversationId);
  assert.equal(conv.engine, 'api');
  assert.equal(conv.turns[0].costUsd, out.costUsd);
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

test('tool input is checked against the schema', () => {
  const [grep, read] = toolDefs(['code']);
  assert.equal(inputError(grep, { root: 'code', pattern: 'x' }), null);
  assert.match(inputError(grep, { root: 'code' }), /missing pattern/);
  assert.match(inputError(grep, { root: 'nope', pattern: 'x' }), /must be one of/);
  assert.match(inputError(read, { root: 'code', path: 'a', start: '1' }), /integer/);
  assert.match(inputError(read, { root: 'code', path: 'a', extra: 1 }), /unexpected/);
});

test('/api/status exposes the engine', async () => {
  const { createServer } = await import('../lib/server.mjs');
  const srv = createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${srv.address().port}`;
    const st = await (await fetch(`${base}/api/status`)).json();
    assert.equal(st.engine.default, 'api');
    assert.equal(st.apiEngine, true);
  } finally { srv.close(); }
});
