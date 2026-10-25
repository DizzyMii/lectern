import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setupNotebook, FIXTURE } from './helpers.mjs';

const env = setupNotebook();
const { createStreamParser, summarizeTool, buildSystem, streamArgs, streamStdin } = await import('../lib/engine.mjs');
const { spawn } = await import('node:child_process');
const { getNotebook } = await import('../lib/store.mjs');
const nb = getNotebook('test');
const raw = fs.readFileSync(FIXTURE, 'utf8');
const resultLine = JSON.parse(raw.trim().split('\n').at(-1));

function feed(chunkSize) {
  const events = [];
  const p = createStreamParser(nb, (e) => events.push(e));
  if (chunkSize) for (let i = 0; i < raw.length; i += chunkSize) p.push(raw.slice(i, i + chunkSize));
  else p.push(raw);
  p.end();
  return { events, p };
}

test.after(() => env.cleanup());

test('fixture parses into deltas, one tool, one tool_result and a session id', () => {
  const { events, p } = feed();
  const deltas = events.filter((e) => e.type === 'delta').map((e) => e.text).join('');
  assert.equal(deltas, resultLine.result);
  const tools = events.filter((e) => e.type === 'tool');
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'Grep');
  assert.equal(tools[0].input.pattern, 'Deferred');
  assert.match(tools[0].summary, /^Grep "Deferred" in /);
  const results = events.filter((e) => e.type === 'tool_result');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, tools[0].id);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].chars, 'No matches found'.length);
  assert.equal(p.state.sessionId, resultLine.session_id);
  assert.equal(p.answerText(), resultLine.result);
  assert.equal(p.state.result.total_cost_usd, resultLine.total_cost_usd);
});

test('partial chunks give the same events as whole lines', () => {
  assert.deepEqual(feed(7).events, feed().events);
  assert.deepEqual(feed(1).events, feed().events);
});

test('unknown events and junk lines are ignored', () => {
  const events = [];
  const p = createStreamParser(nb, (e) => events.push(e));
  p.push('not json\n{"type":"weird_new_thing","x":1}\n{"type":"stream_event","event":{"type":"brand_new"}}\n[]\nnull\n');
  p.push('{"type":"stream_event","event":{"type":"content_block_delta","index":9,"delta":{"type":"input_json_delta","partial_json":"{"}}}\n');
  p.end();
  assert.deepEqual(events, []);
});

test('assistant message without partial deltas still yields text and tool', () => {
  const events = [];
  const p = createStreamParser(nb, (e) => events.push(e));
  p.line(JSON.stringify({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'hello' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: nb.dir + '/src/java/net/x/Foo.java', offset: 80, limit: 61 } }] } }));
  assert.deepEqual(events.map((e) => e.type), ['delta', 'tool']);
  assert.equal(events[1].summary, 'Read code/net/x/Foo.java 80-140');
  assert.equal(p.answerText(), 'hello');
});

test('tool summaries use root names', () => {
  assert.equal(summarizeTool(nb, 'Grep', { pattern: 'DeferredRegister', path: nb.dir + '/src/java' }), 'Grep "DeferredRegister" in code');
  assert.equal(summarizeTool(nb, 'Glob', { pattern: '**/*.java' }), 'Glob "**/*.java" in notebook');
});

test('a prompt over 32K goes on stdin, so spawn does not hit the Windows command line cap', async () => {
  const question = 'Plan this.\n' + 'x'.repeat(60000);
  const args = streamArgs(nb, { model: 'haiku', system: buildSystem(nb), resumeId: 'sess-1', fork: true });
  assert.ok(!args.includes(question));
  assert.equal(args[0], '-p');
  assert.notEqual(args[1], question);
  assert.deepEqual(args.slice(-3), ['--resume', 'sess-1', '--fork-session']);
  assert.ok(args.join(' ').length < 16000);
  assert.equal(streamStdin(question, null), question);
  assert.ok(streamStdin(question, [{ title: 'Guide', data: 'hello' }]).endsWith(question));
  // spawn node with the same argv shape and the prompt on stdin; it reports what arrived
  const echo = 'let n=0;process.stdin.on("data",d=>n+=d.length).on("end",()=>console.log(n))';
  const c = spawn(process.execPath, ['-e', echo, '--', ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  c.stdout.on('data', (d) => { out += d; });
  const code = await new Promise((resolve, reject) => { c.on('error', reject); c.on('close', resolve); c.stdin.end(streamStdin(question, null)); });
  assert.equal(code, 0);
  assert.equal(Number(out.trim()), Buffer.byteLength(question));
});

test('system prompt names roots and the citation format', () => {
  const s = buildSystem(nb);
  assert.match(s, /code: notebook path "src\/java"/);
  assert.match(s, /\[\[path\|"short verbatim quote"\]\]/);
  assert.match(s, /Do not read outside the pinned docs and roots/);
});

test('every ask carries a round cap, and fast is haiku at low effort with 4 rounds', async () => {
  const { MODES, DEFAULT_MAX_TURNS } = await import('../lib/engine.mjs');
  const args = streamArgs(nb, { model: 'opus', system: 's', maxTurns: DEFAULT_MAX_TURNS });
  assert.equal(args[args.indexOf('--max-turns') + 1], '12');
  assert.deepEqual(MODES.fast, { model: 'haiku', effort: 'low', maxTurns: 4 });
  assert.deepEqual(MODES.deep, { model: 'opus', effort: 'high', maxTurns: 12 });
  const { ask } = await import('../lib/engine.mjs');
  assert.throws(() => ask({ notebook: nb, question: 'x', maxTurns: 0 }), /maxTurns must be a whole number/);
});

test('cancelling a fake ask rejects its done promise', async () => {
  const { ask } = await import('../lib/engine.mjs');
  process.env.LECTERN_FAKE_ENGINE = '1';
  process.env.LECTERN_FAKE_DELAY = '200';
  try {
    const job = ask({ notebook: nb, question: 'x', persist: false });
    setTimeout(() => job.cancel(), 50);
    await assert.rejects(job.done, /cancelled/);
  } finally { delete process.env.LECTERN_FAKE_ENGINE; delete process.env.LECTERN_FAKE_DELAY; }
});
