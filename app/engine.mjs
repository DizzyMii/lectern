// Drives headless Claude Code (claude -p, stream-json) and, when an API key is set, a direct API engine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { systemPrompt, toolDefs, runTool, docBlocks, offsetToFileLine } from '../nb.mjs';
import { processAnswer, CITATION_RULES } from './cite.mjs';
import { getShelf, shelfStdin } from './sources.mjs';
import { APP_DIR, getNotebook, getConversation, newConversation, saveConversation, httpError, toPosix } from './store.mjs';

// ---------- claude binary ----------

let claudeCache;
export function findClaude() {
  if (claudeCache !== undefined) return claudeCache;
  const local = path.join(os.homedir(), '.local', 'bin');
  const candidates = [path.join(local, 'claude'), path.join(local, 'claude.exe')];
  claudeCache = candidates.find((c) => { try { return fs.statSync(c).isFile(); } catch { return false; } }) ?? null;
  if (!claudeCache) {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' });
    claudeCache = r.status === 0 ? r.stdout.split(/\r?\n/).map((s) => s.trim()).find((s) => s && !/\.(cmd|bat|ps1)$/i.test(s)) ?? null : null;
  }
  return claudeCache;
}

let versionCache;
export function claudeVersion() {
  if (versionCache !== undefined) return versionCache;
  const bin = findClaude();
  if (!bin) return (versionCache = null);
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
  versionCache = r.status === 0 ? r.stdout.trim() : null;
  return versionCache;
}

// the API engine needs a key and the SDK, which is not one of the installed deps
let sdkResolves;
export const apiEngineAvailable = () => {
  if (!process.env.ANTHROPIC_API_KEY) return false;
  if (sdkResolves === undefined) {
    try { createRequire(import.meta.url).resolve('@anthropic-ai/sdk'); sdkResolves = true; } catch { sdkResolves = false; }
  }
  return sdkResolves;
};

export const MODEL_ALIASES = ['opus', 'sonnet', 'haiku'];

// A round is one model request; each tool call costs another. fast is the cheap preset (CLI --fast, MCP mode "fast").
export const DEFAULT_MAX_TURNS = 12;
export const MODES = {
  fast: { model: 'haiku', effort: 'low', maxTurns: 4 },
  deep: { model: 'opus', effort: 'high', maxTurns: 12 },
};
const MODEL_RE = /^(opus|sonnet|haiku|claude-[a-z0-9][a-z0-9.-]*(\[1m\])?)$/;

// Returns an error message for a bad model name, or null when it is fine.
export function modelError(model) {
  if (model == null || model === '') return null;
  return MODEL_RE.test(String(model)) ? null : `unknown model "${model}": use opus, sonnet, haiku or a full claude-* model id`;
}

// ---------- prompt ----------

export function buildSystem(nb) {
  const roots = Object.entries(nb.config.roots ?? {});
  const lines = roots.map(([name, rel]) => `- ${name}: notebook path "${toPosix(rel)}", absolute "${toPosix(path.resolve(nb.dir, rel))}"`);
  return `${systemPrompt(nb.config)}

In this session your tools are Read, Grep and Glob, not grep, read and ls. Citations are not attached automatically: you write them yourself in the format below.
The pinned documents arrive in the first message as <document title="..."> blocks; inside each, every file starts with a "### FILE: <path>" line and that path is relative to the notebook directory.
The notebook directory is "${toPosix(nb.dir)}". Code roots (search these with Grep and Glob, open files with Read using the absolute path):
${lines.join('\n') || '- (none)'}
Do not read outside the pinned docs and roots.

${CITATION_RULES}`;
}

// ---------- stream-json parsing ----------

function pathLabel(nb, p) {
  if (!p) return null;
  const abs = path.resolve(nb.dir, String(p));
  for (const [name, rel] of Object.entries(nb.config.roots ?? {})) {
    const r = path.relative(path.resolve(nb.dir, rel), abs);
    if (r === '') return name;
    if (!r.startsWith('..') && !path.isAbsolute(r)) return `${name}/${toPosix(r)}`;
  }
  const r = path.relative(nb.dir, abs);
  if (r === '') return 'notebook';
  return !r.startsWith('..') && !path.isAbsolute(r) ? toPosix(r) : toPosix(String(p));
}

export function summarizeTool(nb, name, input = {}) {
  if (name === 'Grep') {
    return `Grep "${input.pattern ?? ''}" in ${pathLabel(nb, input.path) ?? 'notebook'}${input.glob ? ` (${input.glob})` : ''}${input.type ? ` (${input.type})` : ''}`;
  }
  if (name === 'Read') {
    let range = '';
    if (input.offset != null || input.limit != null) {
      const s = Number(input.offset ?? 1);
      range = input.limit != null ? ` ${s}-${s + Number(input.limit) - 1}` : ` ${s}-`;
    }
    return `Read ${pathLabel(nb, input.file_path ?? input.path) ?? '?'}${range}`;
  }
  if (name === 'Glob') return `Glob "${input.pattern ?? ''}" in ${pathLabel(nb, input.path) ?? 'notebook'}`;
  return name;
}

function resultChars(content) {
  if (typeof content === 'string') return content.length;
  if (Array.isArray(content)) return content.reduce((n, c) => n + (typeof c?.text === 'string' ? c.text.length : 0), 0);
  return 0;
}

// Feeds stream-json lines, emits engine events, keeps the pieces needed for the final result.
export function createStreamParser(nb, onEvent) {
  const st = { sessionId: null, toolCalls: [], result: null, messageText: new Map(), lastMessageId: null, model: null };
  const blocks = new Map();
  const emitted = new Set();
  const deltaMessages = new Set();
  let buf = '';

  const emitTool = (id, name, input) => {
    if (!id || emitted.has(id)) return;
    emitted.add(id);
    const call = { id, name, input, summary: summarizeTool(nb, name, input) };
    st.toolCalls.push(call);
    onEvent({ type: 'tool', ...call });
  };

  const handle = (ev) => {
    if (!ev || typeof ev !== 'object') return;
    if (ev.parent_tool_use_id) return; // subagent traffic
    switch (ev.type) {
      case 'system':
        if (ev.subtype === 'init') { st.sessionId = ev.session_id ?? st.sessionId; st.model = ev.model ?? null; }
        return;
      case 'stream_event': {
        const e = ev.event ?? {};
        const mid = ev.api_message_id ?? e.message?.id ?? st.lastMessageId;
        if (e.type === 'message_start') { blocks.clear(); st.lastMessageId = e.message?.id ?? mid; return; }
        if (e.type === 'content_block_start') {
          const b = e.content_block ?? {};
          if (b.type === 'tool_use') blocks.set(e.index, { kind: 'tool', id: b.id, name: b.name, json: '' });
          else if (b.type === 'text') blocks.set(e.index, { kind: 'text' });
          return;
        }
        if (e.type === 'content_block_delta') {
          const d = e.delta ?? {};
          if (d.type === 'text_delta' && d.text) {
            deltaMessages.add(mid);
            st.messageText.set(mid, (st.messageText.get(mid) ?? '') + d.text);
            st.lastMessageId = mid;
            onEvent({ type: 'delta', text: d.text });
          } else if (d.type === 'input_json_delta') {
            const b = blocks.get(e.index);
            if (b?.kind === 'tool') b.json += d.partial_json ?? '';
          }
          return;
        }
        if (e.type === 'content_block_stop') {
          const b = blocks.get(e.index);
          if (b?.kind === 'tool') {
            let input = {};
            try { input = b.json ? JSON.parse(b.json) : {}; } catch {}
            emitTool(b.id, b.name, input);
          }
          return;
        }
        return;
      }
      case 'assistant': {
        const m = ev.message ?? {};
        const mid = m.id ?? ev.api_message_id;
        for (const c of m.content ?? []) {
          if (c.type === 'tool_use') emitTool(c.id, c.name, c.input ?? {});
          else if (c.type === 'text' && c.text && !deltaMessages.has(mid)) {
            // no partial messages for this one: take the whole block
            st.messageText.set(mid, (st.messageText.get(mid) ?? '') + c.text);
            st.lastMessageId = mid;
            onEvent({ type: 'delta', text: c.text });
          }
        }
        return;
      }
      case 'user': {
        for (const c of ev.message?.content ?? []) {
          if (c?.type !== 'tool_result') continue;
          const ok = !c.is_error;
          const chars = resultChars(c.content);
          const call = st.toolCalls.find((t) => t.id === c.tool_use_id);
          if (call) Object.assign(call, { ok, chars });
          onEvent({ type: 'tool_result', id: c.tool_use_id, ok, chars });
        }
        return;
      }
      case 'result':
        st.result = ev;
        st.sessionId = ev.session_id ?? st.sessionId;
        return;
      default:
        return;
    }
  };

  return {
    state: st,
    line(l) {
      const s = l.trim();
      if (!s) return;
      let ev;
      try { ev = JSON.parse(s); } catch { return; }
      try { handle(ev); } catch {}
    },
    push(chunk) {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { this.line(buf.slice(0, i)); buf = buf.slice(i + 1); }
    },
    end() { if (buf) { this.line(buf); buf = ''; } },
    answerText() {
      if (typeof st.result?.result === 'string' && st.result.result) return st.result.result;
      return st.messageText.get(st.lastMessageId) ?? '';
    },
  };
}

// ---------- ask ----------

// Base sessions: one claude session per notebook, model and shelf that holds only the pinned shelf.
// New conversations fork it, so their first request reads the shelf from the prompt cache instead of
// writing it again. A cache entry only matches where an earlier request ended, which is why the
// shelf needs a turn of its own. Reads refresh the entry, so a base used within the hour stays warm.
const BASES = () => path.join(APP_DIR, 'data', 'bases.json');
const BASE_TTL_MS = 55 * 60 * 1000;
const baseInflight = new Map();
function readBases() { try { return JSON.parse(fs.readFileSync(BASES(), 'utf8')); } catch { return {}; } }
function writeBases(b) { fs.mkdirSync(path.dirname(BASES()), { recursive: true }); fs.writeFileSync(BASES(), JSON.stringify(b, null, 2)); }
export function touchBase(key) { const b = readBases(); if (b[key]) { b[key].usedAt = Date.now(); writeBases(b); } }

// claude -p only reads inside its cwd unless told otherwise, so roots elsewhere (Kade's mod repos) need --add-dir.
// Sorted so the args, and with them the cached prefix, stay the same between the base and its forks.
export function addDirs(nb) {
  const out = new Set();
  for (const rel of Object.values(nb.config.roots ?? {})) {
    const abs = path.resolve(nb.dir, rel);
    const r = path.relative(nb.dir, abs);
    if (r.startsWith('..') || path.isAbsolute(r)) out.add(abs);
  }
  return [...out].sort().flatMap((d) => ['--add-dir', d]);
}

function runJson(bin, args, cwd, input, onChild) {
  return new Promise((resolve, reject) => {
    const c = spawn(bin, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    onChild?.(c);
    let out = '', err = '';
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    c.on('error', reject);
    c.on('close', (code) => {
      try { resolve(JSON.parse(out)); }
      catch { reject(new Error(err.trim().split('\n').slice(-3).join(' ') || `claude exited ${code}`)); }
    });
    c.stdin.on('error', () => {});
    c.stdin.end(input);
  });
}

// onRelease gets a function the caller runs when it stops waiting. The shared build is only
// killed once every caller waiting on it has let go.
export async function getBase({ nb, model, system, shelf, bin, emit, onRelease }) {
  const stdin = shelfStdin(shelf.docs);
  const hash = crypto.createHash('sha1').update(system).update(stdin).digest('hex').slice(0, 16);
  const key = `${nb.id}|${model}|${hash}`;
  const hit = readBases()[key];
  if (hit && Date.now() - hit.usedAt < BASE_TTL_MS) return { key, sessionId: hit.sessionId, warm: true, costUsd: hit.costUsd ?? 0 };
  if (!baseInflight.has(key)) {
    const entry = { waiters: 0, child: null };
    baseInflight.set(key, entry);
    entry.promise = (async () => {
      emit({ type: 'tool', id: 'warm', name: 'Shelf', input: {}, summary: `Loading ${shelf.stats.docs} pinned documents into a cached session` });
      const r = await runJson(bin, ['-p', '--model', model, '--output-format', 'json', '--append-system-prompt', system,
        '--allowedTools', 'Read,Grep,Glob', '--tools', 'Read,Grep,Glob', '--strict-mcp-config', ...addDirs(nb)],
        nb.dir, stdin + '\n\nThose are the pinned documents for this notebook. Questions follow in later messages. Reply with only: ready', (c) => { entry.child = c; });
      if (r.is_error || !r.session_id) throw new Error('could not load the shelf: ' + (r.result || r.subtype || 'unknown error'));
      const b = readBases();
      b[key] = { sessionId: r.session_id, usedAt: Date.now(), createdAt: Date.now(), costUsd: r.total_cost_usd ?? null };
      writeBases(b);
      emit({ type: 'tool_result', id: 'warm', ok: true, chars: stdin.length });
      return { key, sessionId: r.session_id, warm: false, costUsd: r.total_cost_usd ?? 0 };
    })().finally(() => { if (baseInflight.get(key) === entry) baseInflight.delete(key); });
  }
  const entry = baseInflight.get(key);
  entry.waiters++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (--entry.waiters === 0 && entry.child && entry.child.exitCode == null) {
      // nobody wants this build any more; a later ask starts a fresh one
      if (baseInflight.get(key) === entry) baseInflight.delete(key);
      entry.child.kill();
    }
  };
  onRelease?.(release);
  try { return await entry.promise; } finally { release(); }
}

// The question rides on stdin, never argv: Windows caps a command line near 32K chars and a
// chained studio prompt (a whole tech spec inlined) passes that. A bare -p reads the prompt from stdin.
export function streamArgs(nb, { model, system, effort, resumeId, fork, maxTurns } = {}) {
  const args = ['-p', '--model', model, '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--append-system-prompt', system, '--allowedTools', 'Read,Grep,Glob', '--tools', 'Read,Grep,Glob', '--strict-mcp-config', ...addDirs(nb)];
  if (effort) args.push('--effort', String(effort));
  if (maxTurns) args.push('--max-turns', String(maxTurns));
  if (resumeId) args.push('--resume', resumeId);
  if (resumeId && fork) args.push('--fork-session');
  return args;
}

export function streamStdin(question, shelfDocs) {
  return shelfDocs ? `${shelfStdin(shelfDocs)}\n\n${String(question)}` : String(question);
}

const FIXTURE = () => process.env.NB_FAKE_FIXTURE || path.join(APP_DIR, 'test', 'fixtures', 'stream.jsonl');

function normalizeUsage(u = {}) {
  return {
    input_tokens: u.input_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
  };
}

// resume = { sessionId, costUsd } continues a session that has no stored conversation (studio repair turns)
// A narrowed scope rides along with this turn's message only; the stored question stays as asked.
export function scopedQuestion(question, scope) {
  if (!Array.isArray(scope) || !scope.length) return question;
  return `${question}

(Scope for this question: use only these sources: ${scope.join(', ')}. Do not search, read or cite the others.)`;
}

export function ask({ notebook, question, conversationId, model, effort, fast = false, maxTurns, onEvent = () => {}, engine = 'claude-code', persist = true, kind, resume, scope } = {}) {
  const preset = fast ? MODES.fast : null;
  model ||= preset?.model ?? 'opus';
  effort ||= preset?.effort;
  maxTurns = maxTurns == null || maxTurns === '' ? preset?.maxTurns ?? DEFAULT_MAX_TURNS : Number(maxTurns);
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 100) throw httpError(400, 'maxTurns must be a whole number from 1 to 100');
  const nb = typeof notebook === 'string' ? getNotebook(notebook) : notebook;
  if (!nb) throw httpError(404, `no notebook ${notebook}`);
  if (!question || !String(question).trim()) throw httpError(400, 'question is required');
  const badModel = modelError(model);
  if (badModel) throw httpError(400, badModel);
  let conv = null;
  if (conversationId) {
    conv = getConversation(nb, conversationId);
    if (!conv) throw httpError(404, `no conversation ${conversationId}`);
  }
  const startedAt = new Date();
  let cancelled = false;
  let child = null;
  let fakeTimer = null;
  let stopWaiting = null; // rejects whatever the run is waiting on with 'cancelled'
  let releaseBase = null;
  let finished = false;

  const emit = (e) => { if (!finished || e.type === 'done' || e.type === 'error') { try { onEvent(e); } catch {} } };

  const finish = (final) => {
    const { answer, citations } = processAnswer(nb.dir, final.text, nb.config.roots);
    const endedAt = new Date();
    // claude reports total_cost_usd for the whole session, so a resumed turn costs the difference
    const sessionCostUsd = final.costUsd ?? null;
    let costUsd = sessionCostUsd;
    const prev = conv?.sessionId && engine !== 'api' ? conv.turns.at(-1) : null;
    // a fork's total starts at the base session's cost, so its first turn subtracts that
    const prevTotal = prev ? prev.sessionCostUsd ?? prev.costUsd : resume ? resume.costUsd ?? null : (final.baseCostUsd ?? null);
    if (costUsd != null && prevTotal != null && costUsd >= prevTotal) costUsd = Math.round((costUsd - prevTotal) * 1e7) / 1e7;
    const out = {
      answer,
      rawAnswer: final.text,
      citations,
      toolCalls: final.toolCalls,
      usage: normalizeUsage(final.usage),
      costUsd,
      sessionCostUsd,
      sessionId: final.sessionId ?? null,
      seconds: Math.round((endedAt - startedAt) / 100) / 10,
      model,
      conversationId: null,
    };
    if (persist) {
      conv ??= newConversation(nb, question);
      if (out.sessionId) conv.sessionId = out.sessionId;
      conv.model = model;
      conv.engine = engine;
      conv.turns.push({
        question, answer: out.answer, rawAnswer: out.rawAnswer, citations, toolCalls: out.toolCalls, usage: out.usage,
        costUsd: out.costUsd, sessionCostUsd: out.sessionCostUsd, model, effort: effort ?? null, maxTurns, kind: kind ?? null,
        startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), seconds: out.seconds,
      });
      saveConversation(nb, conv);
      out.conversationId = conv.id;
    }
    return out;
  };

  const done = (async () => {
    if (engine === 'api') return finish(await runApi(nb, conv, { question: scopedQuestion(question, scope), model, effort, maxTurns, emit, isCancelled: () => cancelled }));
    const parser = createStreamParser(nb, emit);
    const shelf = conv?.sessionId || resume?.sessionId ? null : await getShelf(nb);
    if (cancelled) throw new Error('cancelled');
    const system = buildSystem(nb);
    let base = null;
    // ponytail: NB_NO_BASE=1 sends the shelf with every new conversation, the old behaviour
    if (shelf && process.env.NB_FAKE_ENGINE !== '1' && process.env.NB_NO_BASE !== '1') {
      const bin0 = findClaude();
      if (!bin0) throw new Error('claude binary not found');
      const cancelP = new Promise((_, reject) => { stopWaiting = () => reject(new Error('cancelled')); });
      cancelP.catch(() => {});
      try {
        base = await Promise.race([getBase({ nb, model, system, shelf, bin: bin0, emit, onRelease: (fn) => { releaseBase = fn; } }), cancelP]);
      } catch (e) { throw cancelled ? new Error('cancelled') : e; }
      stopWaiting = null;
      if (cancelled) throw new Error('cancelled');
    }
    await new Promise((resolve, reject) => {
      if (process.env.NB_FAKE_ENGINE === '1') {
        const lines = fs.readFileSync(FIXTURE(), 'utf8').split('\n');
        const delay = Number(process.env.NB_FAKE_DELAY ?? 0);
        let i = 0;
        stopWaiting = () => reject(new Error('cancelled'));
        const step = () => {
          if (cancelled) return reject(new Error('cancelled'));
          if (i >= lines.length) { parser.end(); return resolve(); }
          parser.line(lines[i++]);
          fakeTimer = delay ? setTimeout(step, delay) : setImmediate(step);
        };
        step();
        return;
      }
      const bin = findClaude();
      if (!bin) return reject(new Error('claude binary not found'));
      const resumeId = conv?.sessionId || resume?.sessionId || base?.sessionId || null;
      const args = streamArgs(nb, { model, system, effort, maxTurns, resumeId, fork: !conv?.sessionId && !resume?.sessionId && Boolean(base) });
      child = spawn(bin, args, { cwd: nb.dir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d) => parser.push(d));
      child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
      child.on('error', (e) => reject(e));
      child.on('close', (code) => {
        parser.end();
        if (cancelled) return reject(new Error('cancelled'));
        if (!parser.state.result && code !== 0) return reject(new Error(stderr.trim().split('\n').slice(-3).join(' ') || `claude exited ${code}`));
        resolve();
      });
      child.stdin.on('error', () => {});
      child.stdin.end(streamStdin(scopedQuestion(question, scope), shelf && !base ? shelf.docs : null));
    });
    const r = parser.state.result;
    if (r?.subtype === 'error_max_turns') throw new Error(`stopped at the ${maxTurns}-round cap before it finished answering; ask again with more rounds (deep mode, or a higher maxTurns)`);
    if (r?.is_error) throw new Error(typeof r.result === 'string' && r.result ? r.result : `claude error: ${r.subtype ?? 'unknown'}`);
    if (!r) throw new Error('claude ended without a result');
    if (base) touchBase(base.key);
    return finish({ text: parser.answerText(), toolCalls: parser.state.toolCalls, usage: r.usage, costUsd: r.total_cost_usd, sessionId: parser.state.sessionId, baseCostUsd: base && !base.warm ? null : base?.costUsd ?? null });
  })().then(
    (out) => { emit({ type: 'done', ...out }); finished = true; return out; },
    (err) => { emit({ type: 'error', message: err.message }); finished = true; throw err; },
  );
  done.catch(() => {});

  return {
    done,
    cancel() {
      cancelled = true;
      if (fakeTimer) { clearTimeout(fakeTimer); clearImmediate(fakeTimer); }
      releaseBase?.();
      stopWaiting?.();
      if (child && child.exitCode == null) child.kill();
    },
  };
}

// ---------- API engine ----------

const API_MODELS = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' };

async function runApi(nb, conv, { question, model, effort, maxTurns = DEFAULT_MAX_TURNS, emit, isCancelled }) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const shelf = await getShelf(nb);
  const roots = nb.config.roots ?? {};
  const tools = toolDefs(Object.keys(roots));
  const system = `${systemPrompt(nb.config)}

When you cite code you read with the tools, write [[<root path>/<file>#L12]] or [[<root path>/<file>#L12-L20]], where the root paths are: ${Object.entries(roots).map(([k, v]) => `${k} = ${v}`).join(', ') || '(none)'}.`;
  // follow-ups replay earlier turns as plain text; the shelf rides on the first message
  const messages = [];
  const prior = conv?.turns ?? [];
  prior.forEach((t, i) => {
    messages.push({ role: 'user', content: i === 0 ? [...docBlocks(shelf.docs), { type: 'text', text: t.question }] : t.question });
    messages.push({ role: 'assistant', content: t.rawAnswer || t.answer || '(no answer)' });
  });
  messages.push({ role: 'user', content: prior.length ? question : [...docBlocks(shelf.docs), { type: 'text', text: question }] });
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const toolCalls = [];
  let msg;
  for (let round = 0; round < maxTurns; round++) {
    if (isCancelled()) throw new Error('cancelled');
    const stream = client.messages.stream({
      model: API_MODELS[model] ?? model, max_tokens: 64000, system, tools, messages,
      thinking: { type: 'adaptive' }, ...(effort ? { output_config: { effort } } : {}),
    });
    stream.on('text', (t) => emit({ type: 'delta', text: t }));
    msg = await stream.finalMessage();
    for (const k of Object.keys(usage)) usage[k] += msg.usage?.[k] ?? 0;
    if (msg.stop_reason !== 'tool_use') break;
    messages.push({ role: 'assistant', content: msg.content });
    const results = [];
    for (const b of msg.content.filter((c) => c.type === 'tool_use')) {
      const summary = `${b.name} ${b.input.root ?? ''} ${b.input.pattern ?? b.input.path ?? b.input.dir ?? ''}`.trim();
      const call = { id: b.id, name: b.name, input: b.input, summary };
      toolCalls.push(call);
      emit({ type: 'tool', ...call });
      const r = runTool(roots, nb.dir, b.name, b.input);
      Object.assign(call, { ok: !r.is_error, chars: r.content.length });
      emit({ type: 'tool_result', id: b.id, ok: !r.is_error, chars: r.content.length });
      results.push({ type: 'tool_result', tool_use_id: b.id, content: r.content, ...(r.is_error ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });
  }
  // native doc citations become [[file#Ln|"quote"]] so they go through the same verifier
  let text = '';
  for (const b of msg.content) {
    if (b.type !== 'text') continue;
    text += b.text;
    for (const c of b.citations ?? []) {
      const doc = shelf.docs[c.document_index];
      if (!doc || c.type !== 'char_location') continue;
      const loc = offsetToFileLine(doc, c.start_char_index);
      const quote = String(c.cited_text ?? '').split('\n').map((s) => s.trim()).find((s) => s && !s.startsWith('### FILE:')) ?? '';
      text += quote ? `[[${loc.file}#L${loc.line}|"${quote.slice(0, 160).split('"')[0]}"]]` : `[[${loc.file}#L${loc.line}]]`;
    }
  }
  return { text, toolCalls, usage, costUsd: null, sessionId: null };
}
