// Two engines: the Anthropic API (the default when ANTHROPIC_API_KEY is set) and headless Claude Code (claude -p, stream-json).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { onPath, isExec } from './which.mjs';
import { systemPrompt, toolDefs, runTool, docBlocks, offsetToFileLine } from './shelf.mjs';
import { processAnswer, readsByFile, CITATION_RULES } from './cite.mjs';
import { homeFile } from './home.mjs';
import { RUN_AS_NODE } from './gitsafe.mjs';
import { addSpend, budgetStatus, checkBudget, warningText } from './spend.mjs';
import { getShelf, shelfStdin } from './sources.mjs';
import { snapshotRoots, stampCitations } from './history.mjs';
import { APP_DIR, getNotebook, getConversation, newConversation, saveConversation, httpError, toPosix } from './store.mjs';

// ---------- claude binary ----------

let claudeCache;
// CLAUDE_BIN, then the native installer's ~/.local/bin, then PATH. Only the no-argument lookup is cached.
export function findClaude(opts) {
  if (!opts && claudeCache !== undefined) return claudeCache;
  const { env = process.env, platform = process.platform, home = os.homedir(), exists = isExec } = opts ?? {};
  const p = platform === 'win32' ? path.win32 : path.posix;
  const local = p.join(home, '.local', 'bin');
  const names = platform === 'win32' ? ['claude.exe', 'claude'] : ['claude'];
  const candidates = [env.CLAUDE_BIN, ...names.map((n) => p.join(local, n))].filter(Boolean);
  const found = candidates.find((c) => exists(c, platform)) ?? onPath('claude', { env, platform, exists });
  if (!opts) claudeCache = found;
  return found;
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

// the API engine needs a key; the SDK is a dependency but a trimmed install could lack it
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
const BASES = () => homeFile('bases.json');
const BASE_TTL_MS = 55 * 60 * 1000;
const baseInflight = new Map();
function readBases() { try { return JSON.parse(fs.readFileSync(BASES(), 'utf8')); } catch { return {}; } }
function writeBases(b) { fs.mkdirSync(path.dirname(BASES()), { recursive: true }); fs.writeFileSync(BASES(), JSON.stringify(b, null, 2)); }
export function touchBase(key) { const b = readBases(); if (b[key]) { b[key].usedAt = Date.now(); writeBases(b); } }

// claude -p only reads inside its cwd unless told otherwise, so roots elsewhere on disk need --add-dir.
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

// claude -p bills the API key in its env over the Claude Code login, so the key stays out of it
export function claudeEnv() {
  const env = { ...process.env, ...RUN_AS_NODE };
  for (const k of Object.keys(env)) if (/^ANTHROPIC_(API_KEY|AUTH_TOKEN|BASE_URL)$/i.test(k)) delete env[k];
  return env;
}

let helpText;
const claudeHelp = (bin) => (helpText ??= spawnSync(bin, ['--help'], { encoding: 'utf8', timeout: 15_000, windowsHide: true }).stdout ?? '');

// What keeps claude -p inside the notebook. A PreToolUse hook refuses Read, Grep and Glob outside
// the notebook dir and its roots, and --restricted (when this claude has it) also confines the
// file tools and skips user and project settings, such as hooks in a notebook's own .claude folder.
export function sandboxArgs(nb, bin = findClaude()) {
  const dirs = [nb.dir, ...Object.values(nb.config.roots ?? {}).map((r) => path.resolve(nb.dir, r))];
  const fwd = (p) => p.split(path.sep).join('/');
  const arg = Buffer.from(JSON.stringify(dirs)).toString('base64url');
  const command = `"${fwd(process.execPath)}" "${fwd(path.join(APP_DIR, 'lib', 'claude-guard.mjs'))}" ${arg}`;
  const settings = { hooks: { PreToolUse: [{ matcher: 'Read|Grep|Glob', hooks: [{ type: 'command', command }] }] } };
  const out = ['--settings', JSON.stringify(settings)];
  if (bin && /--restricted\b/.test(claudeHelp(bin))) out.push('--restricted');
  return out;
}

function runJson(bin, args, cwd, input, onChild) {
  return new Promise((resolve, reject) => {
    const c = spawn(bin, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv() });
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
      emit({ type: 'tool', id: 'warm', name: 'Shelf', input: {}, summary: shelf.stats.docs ? `Loading ${shelf.stats.docs} pinned ${shelf.stats.docs === 1 ? 'document' : 'documents'} into a cached session` : 'Starting a cached session (nothing is pinned)' });
      const r = await runJson(bin, ['-p', '--model', model, '--output-format', 'json', '--append-system-prompt', system,
        '--allowedTools', 'Read,Grep,Glob', '--tools', 'Read,Grep,Glob', '--strict-mcp-config', ...addDirs(nb), ...sandboxArgs(nb, bin)],
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
    '--append-system-prompt', system, '--allowedTools', 'Read,Grep,Glob', '--tools', 'Read,Grep,Glob', '--strict-mcp-config', ...addDirs(nb), ...sandboxArgs(nb)];
  if (effort) args.push('--effort', String(effort));
  if (maxTurns) args.push('--max-turns', String(maxTurns));
  if (resumeId) args.push('--resume', resumeId);
  if (resumeId && fork) args.push('--fork-session');
  return args;
}

export function streamStdin(question, shelfDocs) {
  return shelfDocs ? `${shelfStdin(shelfDocs)}\n\n${String(question)}` : String(question);
}

const FIXTURE = () => process.env.LECTERN_FAKE_FIXTURE || path.join(APP_DIR, 'test', 'fixtures', 'stream.jsonl');

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

export function ask({ notebook, question, conversationId, model, effort, fast = false, maxTurns, onEvent = () => {}, engine, persist = true, kind, resume, scope, override = false } = {}) {
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
  // a follow-up stays on the engine its conversation started on when nothing else is asked for
  engine = pickEngine(engine ?? conv?.engine);
  const budgetAtStart = engine === 'api' ? checkBudget(nb, override) : null;
  const abort = new AbortController();
  const startedAt = new Date();
  let cancelled = false;
  let child = null;
  let fakeTimer = null;
  let stopWaiting = null; // rejects whatever the run is waiting on with 'cancelled'
  let releaseBase = null;
  let finished = false;

  const emit = (e) => { if (!finished || e.type === 'done' || e.type === 'error') { try { onEvent(e); } catch {} } };

  const finish = async (final) => {
    // reads count for the whole conversation: the model keeps what it read in earlier turns
    const reads = readsByFile(nb.dir, [...(conv?.turns ?? []).flatMap((t) => t.toolCalls ?? []), ...(final.toolCalls ?? [])], nb.config.roots);
    const { answer, citations } = processAnswer(nb.dir, final.text, nb.config.roots, { reads });
    const commits = await snapshotRoots(nb, citations.map((c) => c.path).concat([...reads.values()].map((r) => r.abs)));
    stampCitations(nb, citations, commits);
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
      ...(commits ? { commits } : {}),
    };
    if (persist) {
      conv ??= newConversation(nb, question);
      if (out.sessionId) conv.sessionId = out.sessionId;
      if (engine === 'api') { if (final.transcript) conv.api = final.transcript; else delete conv.api; }
      conv.model = model;
      conv.engine = engine;
      conv.turns.push({
        question, answer: out.answer, rawAnswer: out.rawAnswer, citations, toolCalls: out.toolCalls, usage: out.usage,
        costUsd: out.costUsd, sessionCostUsd: out.sessionCostUsd, model, effort: effort ?? null, maxTurns, kind: kind ?? null,
        startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), seconds: out.seconds,
        ...(commits ? { commits } : {}),
      });
      saveConversation(nb, conv);
      out.conversationId = conv.id;
    }
    return out;
  };

  const done = (async () => {
    if (engine === 'api') {
      await null; // let the caller attach to the job before the first event
      if (budgetAtStart.state === 'warn' || budgetAtStart.state === 'over') emit({ type: 'warning', message: warningText(budgetAtStart), budget: budgetAtStart });
      const meter = newMeter();
      let r;
      try {
        r = await runApi(nb, conv, { question: scopedQuestion(question, scope), model, effort, maxTurns, emit, signal: abort.signal, meter });
      } finally {
        // refused, failed and cancelled runs were still billed for what streamed
        addSpend(nb.id, meter.costUsd);
        const after = budgetStatus(nb);
        if (budgetAtStart.state !== 'warn' && budgetAtStart.state !== 'over' && (after.state === 'warn' || after.state === 'over')) emit({ type: 'warning', message: warningText(after), budget: after });
      }
      const out = await finish(r);
      out.budget = budgetStatus(nb);
      return out;
    }
    const parser = createStreamParser(nb, emit);
    const shelf = conv?.sessionId || resume?.sessionId ? null : await getShelf(nb);
    if (cancelled) throw new Error('cancelled');
    const system = buildSystem(nb);
    let base = null;
    // ponytail: LECTERN_NO_BASE=1 sends the shelf with every new conversation, the old behaviour
    if (shelf && process.env.LECTERN_FAKE_ENGINE !== '1' && process.env.LECTERN_NO_BASE !== '1') {
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
      if (process.env.LECTERN_FAKE_ENGINE === '1') {
        const lines = fs.readFileSync(FIXTURE(), 'utf8').split('\n');
        const delay = Number(process.env.LECTERN_FAKE_DELAY ?? 0);
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
      child = spawn(bin, args, { cwd: nb.dir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv() });
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
    return await finish({ text: parser.answerText(), toolCalls: parser.state.toolCalls, usage: r.usage, costUsd: r.total_cost_usd, sessionId: parser.state.sessionId, baseCostUsd: base && !base.warm ? null : base?.costUsd ?? null });
  })().then(
    (out) => { emit({ type: 'done', ...out }); finished = true; return out; },
    (err) => { emit({ type: 'error', message: err.message }); finished = true; throw err; },
  );
  done.catch(() => {});

  return {
    done,
    cancel() {
      cancelled = true;
      abort.abort();
      if (fakeTimer) { clearTimeout(fakeTimer); clearImmediate(fakeTimer); }
      releaseBase?.();
      stopWaiting?.();
      if (child && child.exitCode == null) child.kill();
    },
  };
}


// ---------- API engine ----------

// Choice: an explicit request wins when that engine can run, then LECTERN_PREFER_CLAUDE_CODE=1 with a
// claude binary means claude-code, then ANTHROPIC_API_KEY means api (the published default), then a
// claude binary means claude-code. null means neither is set up.
export const CLAUDE_CODE_LABEL = 'personal: uses your Claude Code login';
export const NO_ENGINE_HELP = 'Lectern needs an Anthropic API key to answer. Create one at console.anthropic.com and paste it into Settings (the gear in the top bar), or set ANTHROPIC_API_KEY in the environment that starts Lectern. If Claude Code is installed and signed in, Lectern can use that instead.';

export function defaultEngine() {
  if (process.env.LECTERN_FAKE_ENGINE === '1') return 'claude-code';
  if (process.env.LECTERN_PREFER_CLAUDE_CODE === '1' && findClaude()) return 'claude-code';
  if (apiEngineAvailable()) return 'api';
  return findClaude() ? 'claude-code' : null;
}

export function pickEngine(requested) {
  if (requested === 'api' && apiEngineAvailable()) return 'api';
  if (requested === 'claude-code' && (findClaude() || process.env.LECTERN_FAKE_ENGINE === '1')) return 'claude-code';
  return defaultEngine() ?? 'claude-code';
}

export function engineStatus() {
  const def = defaultEngine();
  return {
    default: def,
    label: def === 'api' ? 'API' : def === 'claude-code' ? CLAUDE_CODE_LABEL : 'no engine',
    api: { available: apiEngineAvailable(), keySet: Boolean(process.env.ANTHROPIC_API_KEY) },
    claudeCode: { found: Boolean(findClaude()), label: CLAUDE_CODE_LABEL },
    onboarding: def ? null : NO_ENGINE_HELP,
  };
}

export const API_MODELS = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' };
export const apiModelId = (m) => API_MODELS[m] ?? String(m).replace(/\[1m\]$/, '');
// Haiku has no server-side refusal fallback; the other two take fallbacks: "default"
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const HAS_FALLBACK = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

// $ per million tokens: input, output, cache read. Cache writes cost 1.25x input for 5 minutes, 2x for an hour.
// Haiku 5.5 moves to the second row once a request's prompt passes 100K tokens.
const PRICES = {
  'claude-opus-5-5': [4, 20, 0.2],
  'claude-sonnet-5-5': [2, 10, 0.2],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, [0.5, 2.5, 0.05]],
  'claude-opus-5': [5, 25, 0.5],
  'claude-opus-4-8': [5, 25, 0.5],
};

export function priceUsage(modelId, u = {}) {
  let p = PRICES[modelId] ?? PRICES['claude-opus-5-5']; // unknown ids priced as opus so budgets never undercount
  const inTok = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  if (p[3] && inTok > 100_000) p = p[3];
  // every breakpoint Lectern sets is a one-hour one, so writes without the TTL split count as one-hour
  const writes = u.cache_creation_input_tokens ?? 0;
  const hour = u.cache_creation ? Math.min(writes, u.cache_creation.ephemeral_1h_input_tokens ?? 0) : writes;
  const usd = ((u.input_tokens ?? 0) * p[0] + (writes - hour) * p[0] * 1.25 + hour * p[0] * 2
    + (u.cache_read_input_tokens ?? 0) * p[2] + (u.output_tokens ?? 0) * p[1]) / 1e6;
  return Math.round(usd * 1e7) / 1e7;
}

export function apiSystem(nb) {
  const roots = Object.entries(nb.config.roots ?? {});
  const lines = roots.map(([name, rel]) => `- ${name}: cite as "${toPosix(rel).replace(/\/$/, '')}/<file>"`);
  return `${systemPrompt(nb.config)}

Your tools are grep, read and ls over the code roots. Tool output paths are relative to the root you searched.
The pinned documents are document blocks in the first message, each file inside starting with a "### FILE: <path>" line. Quote them and the API attaches the citation, so do not write a citation for docs.
Code citations are not attached automatically. Write them right after the claim as [[path#L12]] or [[path#L12-L20]], where path is the root's path below + "/" + the file path inside that root, and the line numbers are ones you actually read. This replaces any other code citation form above. The sentence must read correctly with the citation removed, and citations never go inside code blocks.
Code roots:
${lines.join('\n') || '- (none)'}`;
}

export function apiToolSummary(name, input = {}) {
  if (name === 'grep') return `Grep "${input.pattern ?? ''}" in ${input.root ?? '?'}${input.glob ? ` (${input.glob})` : ''}`;
  if (name === 'read') return `Read ${input.root ?? '?'}/${input.path ?? '?'}${input.start != null ? ` ${input.start}-${input.end ?? ''}` : ''}`;
  if (name === 'ls') return `ls ${input.root ?? '?'}/${input.dir ?? ''}`;
  return name;
}

// eager input streaming means the API no longer validates tool input, so it is checked against the schema here
export function inputError(tool, input) {
  if (!tool) return 'unknown tool';
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'input is not an object';
  const { properties, required = [] } = tool.input_schema;
  for (const k of required) if (input[k] === undefined) return `missing ${k}`;
  for (const [k, v] of Object.entries(input)) {
    const p = properties[k];
    if (!p) return `unexpected field ${k}`;
    if (p.type === 'string' && typeof v !== 'string') return `${k} must be a string`;
    if (p.type === 'integer' && !Number.isInteger(v)) return `${k} must be an integer`;
    if (p.enum && !p.enum.includes(v)) return `${k} must be one of ${p.enum.join(', ')}`;
  }
  return null;
}

// One-hour cache entries: people read an answer and ask the follow-up well past the 5-minute default.
export const CACHE = { type: 'ephemeral', ttl: '1h' };
// A turn whose last request (shelf included) passed this many tokens isn't saved for resending: with
// the 1M window it leaves room for one more turn of tool rounds. The next follow-up replays plain text,
// which starts the transcript small again.
const MAX_REPLAY_TOKENS = 600_000;

// What replayed thinking blocks were produced against: the system prompt, the tools and the pinned docs.
// When any of them changed (a source or code root was added), the API refuses old thinking blocks for
// newer accounts, so the follow-up replays plain text instead.
export function prefixKey(system, tools, docs) {
  return crypto.createHash('sha256').update(JSON.stringify([system, tools, docs.map((d) => [d.title, d.data])])).digest('hex');
}

// After a mid-output fallback, only the text the declined model wrote goes back from before the last
// fallback block; its thinking and tool calls don't. Lectern uses no server tools, so that's the whole rule.
// The fallback block itself is an audit marker the API lets you drop, and Haiku requests don't carry the
// beta that defines it, so it never goes back.
export function echoContent(content) {
  const last = content.findLastIndex((b) => b.type === 'fallback');
  return last < 0 ? content : content.filter((b, i) => (i > last || b.type === 'text') && b.type !== 'fallback');
}

// Only an answer that ends in text, carries no unanswered tool call and has every thinking block signed
// can sit in the middle of a later request; anything else is a 400 there.
const replayable = (content) => content.some((b) => b.type === 'text' && b.text?.trim())
  && !content.some((b) => b.type === 'tool_use' || (b.type === 'thinking' && !b.signature));

// a read point on the last block of the request before, which can sit more than 20 blocks back
function markLast(message) {
  const b = message?.content?.findLast?.((x) => x.type === 'text' || x.type === 'tool_result' || x.type === 'tool_use');
  if (b) b.cache_control = CACHE;
}

export function newMeter() {
  return { usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, costUsd: 0 };
}

function meterAdd(meter, modelId, u) {
  if (!u) return;
  for (const k of Object.keys(meter.usage)) meter.usage[k] += u[k] ?? 0;
  meter.costUsd = Math.round((meter.costUsd + priceUsage(modelId, u)) * 1e7) / 1e7;
}

// native doc citations become [[file#Ln|"quote"]] so they go through the same verifier as the claude-code engine.
// After a server-side fallback only the text after the last fallback block is the answer.
export function apiAnswerText(content, docs) {
  const lastFallback = content.findLastIndex((b) => b.type === 'fallback');
  let text = '';
  for (const b of content.slice(lastFallback + 1)) {
    if (b.type !== 'text') continue;
    text += b.text;
    for (const c of b.citations ?? []) {
      const doc = docs[c.document_index];
      if (!doc || c.type !== 'char_location') continue;
      const loc = offsetToFileLine(doc, c.start_char_index);
      const quote = String(c.cited_text ?? '').split('\n').map((s) => s.trim()).find((s) => s && !s.startsWith('### FILE:')) ?? '';
      text += quote ? `[[${loc.file}#L${loc.line}|"${quote.slice(0, 160).split('"')[0]}"]]` : `[[${loc.file}#L${loc.line}]]`;
    }
  }
  return text;
}

export async function runApi(nb, conv, { question, model, effort, maxTurns = DEFAULT_MAX_TURNS, emit = () => {}, signal, meter = newMeter() }) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // key and base URL from the environment; retries are the SDK's own. Keys not scoped to a workspace
  // must name one per request, so ANTHROPIC_WORKSPACE_ID becomes the anthropic-workspace-id header.
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  const client = new Anthropic(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {});
  const shelf = await getShelf(nb);
  const roots = nb.config.roots ?? {};
  const tools = toolDefs(Object.keys(roots)).map((t) => ({ ...t, eager_input_streaming: true }));
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const system = apiSystem(nb);
  const id = apiModelId(model);
  // The shelf rides on the first message. A follow-up sends the earlier turns exactly as they went last
  // time, tool rounds and thinking blocks included, so the model keeps what it read and the cache hits
  // all of it. When the prefix changed, or the saved transcript is missing or behind, it falls back to
  // the answers as plain text, which carries no thinking blocks that could fail the API's prefix check.
  const key = prefixKey(system, tools, shelf.docs);
  const prior = conv?.turns ?? [];
  const saved = conv?.api;
  const text = (t) => [{ type: 'text', text: t }];
  const plain = () => [
    ...prior.flatMap((t, i) => [
      { role: 'user', content: i === 0 ? [...docBlocks(shelf.docs), ...text(t.question)] : text(t.question) },
      { role: 'assistant', content: text(t.rawAnswer || t.answer || '(no answer)') },
    ]),
    { role: 'user', content: prior.length ? text(question) : [...docBlocks(shelf.docs), ...text(question)] },
  ];
  let replaying = Boolean(prior.length && saved?.key === key && saved.turns === prior.length && saved.messages?.length);
  let messages;
  if (replaying) {
    messages = structuredClone(saved.messages);
    messages[0].content.unshift(...docBlocks(shelf.docs));
    markLast(messages.at(-2)); // the last request of the turn before; its answer was never part of a request
    messages.push({ role: 'user', content: text(question) });
  } else messages = plain();
  const toolCalls = [];
  const cancelled = () => new Error('cancelled');
  let jsonRetries = 0;
  let msg = null;
  for (let round = 0; round < maxTurns; round++) {
    if (signal?.aborted) throw cancelled();
    const stream = client.beta.messages.stream({
      model: id, max_tokens: 64000, system, tools, messages,
      thinking: { type: 'adaptive' }, output_config: { effort: effort || 'medium' },
      cache_control: CACHE, // moves with the conversation; the shelf has its own breakpoint
      ...(HAS_FALLBACK.has(id) ? { betas: [FALLBACK_BETA], fallbacks: 'default' } : {}),
    }, { signal });
    stream.on('text', (t) => emit({ type: 'delta', text: t }));
    stream.on('contentBlock', (b) => { if (b.type === 'fallback') emit({ type: 'fallback', from: b.from?.model ?? null, to: b.to?.model ?? null }); });
    try {
      msg = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      const partial = stream.currentMessage;
      meterAdd(meter, partial?.model ?? id, partial?.usage);
      if (signal?.aborted || err instanceof Anthropic.APIUserAbortError) throw cancelled();
      if (err instanceof Anthropic.APIError && /not scoped to a workspace|anthropic-workspace-id/.test(String(err.message))) {
        throw new Error('This API key is not tied to a workspace. Set ANTHROPIC_WORKSPACE_ID to the workspace id (Anthropic Console, Settings, Workspaces, it starts with wrkspc_), or use a key created inside a workspace.');
      }
      // a resent transcript the API won't take must not wedge the conversation: ask once more with plain text
      if (replaying && round === 0 && err instanceof Anthropic.BadRequestError) {
        replaying = false;
        messages = plain();
        round--;
        continue;
      }
      if (err instanceof Anthropic.APIError) throw new Error(`Anthropic API error${err.status ? ` ${err.status}` : ''}: ${err.message}`);
      // only an unparseable tool input lands here; the turn is sent again
      if (jsonRetries++ >= 2) throw err;
      round--;
      continue;
    }
    meterAdd(meter, msg.model ?? id, msg.usage);
    const content = echoContent(msg.content);
    const uses = content.filter((c) => c.type === 'tool_use');
    if (msg.stop_reason === 'refusal') {
      const d = msg.stop_details ?? {};
      const e = new Error(`the model declined to answer this${d.category ? ` (${d.category})` : ''}${d.explanation ? `: ${d.explanation}` : ''}`);
      e.refusal = true;
      throw e;
    }
    if (msg.stop_reason === 'max_tokens' && uses.length) throw new Error('a tool call was cut off at the output limit; ask a narrower question');
    if (msg.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content }); continue; }
    if (msg.stop_reason !== 'tool_use' || !uses.length) break;
    if (round === maxTurns - 1) throw new Error(`stopped at the ${maxTurns}-round cap before it finished answering; ask again with more rounds (deep mode, or a higher maxTurns)`);
    messages.push({ role: 'assistant', content });
    const results = [];
    for (const b of uses) {
      const call = { id: b.id, name: b.name, input: b.input, summary: apiToolSummary(b.name, b.input) };
      toolCalls.push(call);
      emit({ type: 'tool', ...call });
      const bad = inputError(byName[b.name], b.input);
      const r = bad ? { content: `INVALID_INPUT: ${bad}`, is_error: true } : runTool(roots, nb.dir, b.name, b.input);
      Object.assign(call, { ok: !r.is_error, chars: r.content.length });
      emit({ type: 'tool_result', id: b.id, ok: !r.is_error, chars: r.content.length });
      results.push({ type: 'tool_result', tool_use_id: b.id, content: r.content, ...(r.is_error ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });
  }
  if (!msg) throw new Error('the API returned no message');
  let answer = apiAnswerText(msg.content, shelf.docs);
  if (msg.stop_reason === 'max_tokens') answer += '\n\n(The answer was cut off at the output limit.)';
  // what the next follow-up sends ahead of its question: this turn as it went, minus the docs and markers
  const last = echoContent(msg.content);
  const u = msg.usage ?? {};
  const size = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0);
  let transcript = null;
  if (replayable(last) && size <= MAX_REPLAY_TOKENS) {
    const kept = structuredClone([...messages, { role: 'assistant', content: last }]);
    kept[0].content.splice(0, shelf.docs.length);
    for (const m of kept) for (const b of m.content) delete b.cache_control;
    transcript = { key, turns: prior.length + 1, messages: kept };
  }
  return { text: answer, toolCalls, usage: { ...meter.usage }, costUsd: meter.costUsd, sessionId: null, model: msg.model ?? id, transcript };
}
