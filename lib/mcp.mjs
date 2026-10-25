#!/usr/bin/env node
// Lectern: the notebook app as a Model Context Protocol server over stdio.
// Newline-delimited JSON-RPC 2.0. stdout carries protocol messages only; logs go to stderr.
// Register: claude mcp add lectern -- lectern mcp
import path from 'node:path';
import readline from 'node:readline';
import { ask, MODES } from './engine.mjs';
import { listNotebooks, getNotebook } from './store.mjs';
import { readFile, allFiles, search } from './sources.mjs';
import { parseCitations, verify, resolveInNotebook } from './cite.mjs';
import * as studio from './studio/engine.mjs';
import { quietGlobWarning } from './warnings.mjs';
import { notebookCounts, countsLine } from './cli.mjs';

quietGlobWarning();
import { listRecipes } from './studio/recipes.mjs';
import { VERSION } from './version.mjs';

// anything that tries console.log would corrupt the protocol stream
const log = (...a) => process.stderr.write(`[lectern] ${a.join(' ')}\n`);
console.log = console.info = console.debug = console.warn = log;

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER = { name: 'lectern', title: 'Lectern', version: VERSION };
const SEARCH_LIMIT = 100;
const READ_MAX = 2000;
const READ_DEFAULT = 400;

const INSTRUCTIONS = `Lectern answers from local notebooks: pinned docs plus code roots, with citations checked against the files.
Start with list_notebooks. search, read_source, verify, list_artifacts and get_artifact are free and instant, so use them for lookups.
ask and generate call a model and cost money: mode "fast" (default) is haiku at low effort with at most 4 rounds, mode "deep" is opus at high effort with at most 12.`;

// ---------- schemas ----------

const notebookProp = { type: 'string', minLength: 1, maxLength: 64, description: 'Notebook id from list_notebooks, e.g. "node-docs".' };
const modeProp = (what) => ({
  type: 'string', enum: ['fast', 'deep'], default: 'fast',
  description: `"fast" (default): haiku, low effort, at most 4 tool rounds, cents per ${what}. "deep": opus, high effort, at most 12 tool rounds, tens of cents to a few dollars. Use deep only when fast came back thin or hit its round cap.`,
});
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

function recipeLines() {
  return listRecipes().map((r) => {
    const ins = r.inputs.map((i) => `${i.name}${i.required ? '*' : ''}:${i.type}`).join(', ');
    return `- ${r.id} (${r.kind})${ins ? `: ${ins}` : ''}${r.needsOne ? ` [give one of ${r.needsOne.join(', ')}]` : ''}`;
  }).join('\n');
}

const TOOLS = [
  {
    name: 'list_notebooks',
    title: 'List notebooks',
    description: 'List the notebooks this server can answer from: id, title, description, how many pinned docs and files, the code root names, and the approximate token size of the pinned shelf. Free. Call this first to get the notebook id the other tools need.',
    inputSchema: obj({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: toolListNotebooks,
  },
  {
    name: 'ask',
    title: 'Ask a notebook',
    description: 'Ask a question answered from the notebook\'s pinned docs and code roots by a Claude model that can Grep, Glob and Read them. The answer carries [n] markers; each citation is checked against the files and comes back as verified (quote or lines found where cited), moved (found elsewhere, new line given), unverified (not found) or missing (no such file). Treat only verified and moved citations as evidence, and show the Citations block to the user as returned; structuredContent.citations has every one. Costs money and takes 10 to 60 seconds; for a plain lookup use search and read_source instead. Pass the returned conversationId to ask a follow-up in the same conversation. The conversation is saved in the notebook like the CLI and web app do.',
    inputSchema: obj({
      notebook: notebookProp,
      question: { type: 'string', minLength: 1, maxLength: 20000, description: 'The question, in plain words. Name the classes, events or files you care about.' },
      mode: modeProp('question'),
      conversationId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', description: 'Continue this earlier conversation (from a previous ask result). Omit to start a new one.' },
    }, ['notebook', 'question']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: toolAsk,
  },
  {
    name: 'search',
    title: 'Search a notebook',
    description: `Full-text search over every pinned doc and every text file under the code roots. Free, no model call, usually under a second. Plain text by default (case-insensitive unless the query has a capital letter); set regex true for a JavaScript regular expression. Returns up to ${SEARCH_LIMIT} hits as "path:line: text"; pass a path and line to read_source to see the context.`,
    inputSchema: obj({
      notebook: notebookProp,
      query: { type: 'string', minLength: 1, maxLength: 1000, description: 'Text to find, e.g. "RegisterPayloadHandlersEvent".' },
      regex: { type: 'boolean', default: false, description: 'Treat query as a regular expression.' },
    }, ['notebook', 'query']),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: toolSearch,
  },
  {
    name: 'read_source',
    title: 'Read a source file',
    description: `Read numbered lines from one pinned doc or code-root file. Free. path is notebook-relative as search, ask and citations print it (or "<rootName>/<path inside the root>"); absolute paths and paths that leave the notebook are refused. start and end are 1-based and inclusive; without them you get the first ${READ_DEFAULT} lines, and one call returns at most ${READ_MAX}.`,
    inputSchema: obj({
      notebook: notebookProp,
      path: { type: 'string', minLength: 1, maxLength: 1000, description: 'File path, e.g. "docs/networking/payloads.md".' },
      start: { type: 'integer', minimum: 1, description: 'First line to return (default 1).' },
      end: { type: 'integer', minimum: 1, description: `Last line to return (default start + ${READ_DEFAULT - 1}).` },
    }, ['notebook', 'path']),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: toolReadSource,
  },
  {
    name: 'verify',
    title: 'Verify citations',
    description: 'Re-check citation strings against the notebook files as they are now. Free. Each string is one citation in one of these forms, with or without the surrounding [[ ]]: [[path#L12]], [[path#L12-L20]], [[path|"verbatim quote"]], [[path#L12|"verbatim quote"]]. Statuses: verified, moved (the quote is elsewhere; the new lines are given), unverified (quote not found or lines out of range), missing (no such file inside the notebook), unparsed (not a citation).',
    inputSchema: obj({
      notebook: notebookProp,
      citations: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'string', minLength: 1, maxLength: 2000 }, description: 'Citation strings, e.g. ["[[docs/a.md|\\"Register handlers in\\"]]", "src/Foo.java#L3-L5"].' },
    }, ['notebook', 'citations']),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: toolVerify,
  },
  {
    name: 'list_artifacts',
    title: 'List Studio artifacts',
    description: 'List the Studio artifacts saved in a notebook (generated docs, code maps, plans, quizzes, files), newest first, with id, recipe, kind, status, title, citation counts and cost. Free. Fetch one with get_artifact.',
    inputSchema: obj({ notebook: notebookProp }, ['notebook']),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: toolListArtifacts,
  },
  {
    name: 'get_artifact',
    title: 'Get a Studio artifact',
    description: 'Fetch one Studio artifact: its markdown (doc kind) or JSON data (graph, sequence, plan, quiz, file kinds), its summary, and its citations re-checked against the current files, so statuses reflect any edits since it was made. Free.',
    inputSchema: obj({
      notebook: notebookProp,
      id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', description: 'Artifact id from list_artifacts or generate.' },
    }, ['notebook', 'id']),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: toolGetArtifact,
  },
  {
    name: 'generate',
    title: 'Generate a Studio artifact',
    description: `Run a Studio recipe: a model reads the notebook and writes a structured artifact, which is validated (with one repair attempt), citation-checked and saved. Costs money and takes one to three minutes. Inputs are an object keyed by input name; * marks required. Input types: text and longtext are strings; root is a code root name from list_notebooks; artifact is an artifact id; path is a relative output path; diff is pasted diff text or {"root","range"}; gitlog is {"root","range"} with a range like "v1.0..HEAD". Recipes:\n${recipeLines()}`,
    inputSchema: obj({
      notebook: notebookProp,
      recipe: { type: 'string', enum: listRecipes().map((r) => r.id), description: 'Recipe id from the list above.' },
      inputs: {
        type: 'object', description: 'Recipe inputs keyed by name, e.g. {"root": "service"} for code-map.',
        additionalProperties: { anyOf: [{ type: 'string', maxLength: 400000 }, obj({ root: { type: 'string' }, range: { type: 'string' } }, ['root', 'range'])] },
      },
      mode: modeProp('artifact'),
    }, ['notebook', 'recipe']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: toolGenerate,
  },
];
const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// Checks the JSON Schema subset used above. Returns a list of problems.
function check(schema, v, at = 'arguments') {
  if (schema.anyOf) {
    const fails = schema.anyOf.map((s) => check(s, v, at));
    return fails.some((f) => !f.length) ? [] : fails[0];
  }
  const errs = [];
  switch (schema.type) {
    case 'object': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return [`${at} must be an object`];
      for (const k of schema.required ?? []) if (v[k] === undefined) errs.push(`${at}.${k} is required`);
      for (const [k, x] of Object.entries(v)) {
        const p = Object.hasOwn(schema.properties ?? {}, k) ? schema.properties[k] : undefined;
        if (p) errs.push(...check(p, x, `${at}.${k}`));
        else if (schema.additionalProperties === false) errs.push(`${at}.${k} is not a known property (allowed: ${Object.keys(schema.properties ?? {}).join(', ') || 'none'})`);
        else if (typeof schema.additionalProperties === 'object') errs.push(...check(schema.additionalProperties, x, `${at}.${k}`));
      }
      return errs;
    }
    case 'string':
      if (typeof v !== 'string') return [`${at} must be a string`];
      if (schema.minLength != null && v.length < schema.minLength) errs.push(`${at} must not be empty`);
      if (schema.maxLength != null && v.length > schema.maxLength) errs.push(`${at} is longer than ${schema.maxLength} characters`);
      if (schema.enum && !schema.enum.includes(v)) errs.push(`${at} must be one of ${schema.enum.join(', ')}`);
      if (schema.pattern && !new RegExp(schema.pattern).test(v)) errs.push(`${at} has the wrong format`);
      return errs;
    case 'integer':
      if (!Number.isInteger(v)) return [`${at} must be an integer`];
      if (schema.minimum != null && v < schema.minimum) errs.push(`${at} must be at least ${schema.minimum}`);
      return errs;
    case 'boolean':
      return typeof v === 'boolean' ? [] : [`${at} must be true or false`];
    case 'array':
      if (!Array.isArray(v)) return [`${at} must be an array`];
      if (schema.minItems != null && v.length < schema.minItems) errs.push(`${at} needs at least ${schema.minItems} item(s)`);
      if (schema.maxItems != null && v.length > schema.maxItems) errs.push(`${at} takes at most ${schema.maxItems} items`);
      v.forEach((x, i) => errs.push(...check(schema.items, x, `${at}[${i}]`)));
      return errs;
    default:
      return [];
  }
}

// ---------- formatting ----------

const marks = (s) => String(s ?? '').replace(/\[\^(\d+)\]/g, '[$1]');
const lines = (c) => (c.line ? `:${c.line}${c.endLine && c.endLine !== c.line ? `-${c.endLine}` : ''}` : '');
const citeLine = (c) => `[${c.n}] ${c.status} ${c.path}${lines(c)}${c.quote ? ` "${c.quote}"` : ''}${c.citedLine ? ` (cited at line ${c.citedLine})` : ''}${c.was ? ` (was ${c.was} when written)` : ''}`;
const citeData = (c) => ({
  n: c.n, status: c.status, path: c.path, line: c.line ?? null, endLine: c.endLine ?? null, quote: c.quote ?? null,
  ...(c.citedLine ? { citedLine: c.citedLine } : {}), ...(c.status0 && c.status0 !== c.status ? { was: c.status0 } : {}),
});
const money = (x) => (x == null ? 'unknown' : `$${Number(x).toFixed(4)}`);
const text = (t, structuredContent) => ({ content: [{ type: 'text', text: t }], ...(structuredContent ? { structuredContent } : {}) });

function needNotebook(id) {
  const nb = getNotebook(id);
  if (nb) return nb;
  const known = listNotebooks().map((n) => n.id);
  throw new Error(`no notebook "${id}"; known notebooks: ${known.join(', ') || 'none'}`);
}

function artifactResult(a) {
  const citations = (a.citations ?? []).map(citeData);
  const parts = [`# ${a.title}`, `id: ${a.id}  recipe: ${a.recipe}  kind: ${a.kind}  status: ${a.status}  model: ${a.model ?? '?'}  cost: ${money(a.costUsd)}`];
  if (a.summary) parts.push(marks(a.summary));
  if (a.kind === 'doc' || a.markdown != null) parts.push(marks(a.markdown ?? ''));
  else if (a.data != null) parts.push('```json\n' + marks(JSON.stringify(a.data, null, 2)) + '\n```');
  if (a.errors?.length) parts.push(`Validation errors:\n${a.errors.map((e) => `- ${e}`).join('\n')}`);
  if (citations.length) parts.push(`Citations:\n${citations.map(citeLine).join('\n')}`);
  return text(parts.join('\n\n'), {
    id: a.id, recipe: a.recipe, kind: a.kind, status: a.status, title: a.title, model: a.model ?? null, costUsd: a.costUsd ?? null,
    summary: marks(a.summary ?? ''), ...(a.markdown != null ? { markdown: marks(a.markdown) } : { data: a.data ?? null }),
    ...(a.errors?.length ? { errors: a.errors } : {}), citations,
  });
}

// ---------- tools ----------

async function toolListNotebooks() {
  const out = [];
  for (const nb of listNotebooks()) {
    const c = await notebookCounts(nb);
    out.push({ id: nb.id, title: nb.title, description: nb.description, docs: c.docs, files: c.pinnedFiles, roots: Object.keys(nb.config.roots ?? {}), rootFiles: c.rootFiles, shelfTokens: c.tokens, line: countsLine(c) });
  }
  const t = out.map((n) => `${n.id}  "${n.title}"  ${n.line}${n.description ? `\n  ${n.description}` : ''}`).join('\n');
  for (const n of out) delete n.line;
  return text(t || 'no notebooks registered', { notebooks: out });
}

async function toolAsk({ notebook, question, mode = 'fast', conversationId }, ctx) {
  const nb = needNotebook(notebook);
  const m = MODES[mode];
  const job = ask({ notebook: nb, question, conversationId, model: m.model, effort: m.effort, maxTurns: m.maxTurns, onEvent: ctx.progress });
  ctx.onCancel(() => job.cancel());
  const out = await job.done;
  const citations = out.citations.map(citeData);
  const body = [
    marks(out.answer).trim(),
    citations.length ? `Citations:\n${citations.map(citeLine).join('\n')}` : 'Citations: none',
    `conversationId: ${out.conversationId}\nmodel: ${out.model}\nseconds: ${out.seconds}\ncost: ${money(out.costUsd)}`,
  ].join('\n\n');
  return text(body, { answer: marks(out.answer).trim(), citations, conversationId: out.conversationId, model: out.model, seconds: out.seconds, costUsd: out.costUsd ?? null });
}

async function toolSearch({ notebook, query, regex = false }) {
  const nb = needNotebook(notebook);
  const r = await search(nb, query, { regex, limit: SEARCH_LIMIT });
  const hits = r.hits.map(({ path: p, line, text: t }) => ({ path: p, line, text: t }));
  const head = `${hits.length} hit${hits.length === 1 ? '' : 's'}${r.truncated ? ` (stopped at ${SEARCH_LIMIT}; narrow the query)` : ''}`;
  return text([head, ...hits.map((h) => `${h.path}:${h.line}: ${h.text}`)].join('\n'), { hits, truncated: r.truncated });
}

async function toolReadSource({ notebook, path: p, start = 1, end }) {
  const nb = needNotebook(notebook);
  const f = readFile(nb, p); // refuses absolute and escaping paths
  const abs = resolveInNotebook(nb.dir, p, nb.config.roots, { absolute: false });
  const known = await allFiles(nb);
  if (!known.some((x) => path.resolve(x.abs) === abs)) throw new Error(`${p} is not a pinned doc or a code-root file; use search to find source paths`);
  if (f.binary) throw new Error(`${f.path} is a ${f.lang} file and has no text lines`);
  const all = f.text.split('\n');
  if (all.at(-1) === '') all.pop();
  if (start > all.length) throw new Error(`${f.path} has ${all.length} lines; start ${start} is past the end`);
  const last = Math.min(all.length, end ?? start + READ_DEFAULT - 1, start + READ_MAX - 1);
  if (last < start) throw new Error('end must not be before start');
  const width = String(last).length;
  const body = all.slice(start - 1, last).map((l, i) => `${String(start + i).padStart(width)}  ${l.replace(/\r$/, '')}`).join('\n');
  const more = last < all.length ? `\n(more: lines ${last + 1}-${all.length})` : '';
  return text(`${f.path} lines ${start}-${last} of ${all.length}\n${body}${more}`, { path: f.path, start, end: last, totalLines: all.length });
}

async function toolVerify({ notebook, citations }) {
  const nb = needNotebook(notebook);
  // same rule as read_source: only pinned docs and code-root files count, anything else is missing
  const known = new Set((await allFiles(nb)).map((x) => path.resolve(x.abs)));
  const results = citations.map((s, i) => {
    const raw = s.trim();
    const c = parseCitations(raw.startsWith('[[') ? raw : `[[${raw}]]`)[0];
    if (!c) return { n: i + 1, input: s, status: 'unparsed', path: null, line: null, endLine: null, quote: null };
    const abs = resolveInNotebook(nb.dir, c.path, nb.config.roots);
    const v = abs && known.has(abs) ? verify(nb.dir, c, nb.config.roots) : { path: c.path, line: c.line, endLine: c.endLine, quote: c.quote, status: 'missing' };
    return { input: s, ...citeData({ n: i + 1, ...v }) };
  });
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const t = results.map((r) => (r.status === 'unparsed' ? `[${r.n}] unparsed ${r.input}` : citeLine(r))).join('\n');
  return text(`${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')}\n${t}`, { results, counts });
}

async function toolListArtifacts({ notebook }) {
  const nb = needNotebook(notebook);
  const list = studio.listArtifacts(nb);
  const t = list.map((a) => `${a.id}  ${a.recipe} (${a.kind})  ${a.status}  "${a.title}"  ${a.citations} citations (${a.cites.verified} verified)  ${money(a.costUsd)}  ${a.updatedAt}`).join('\n');
  return text(t || 'no artifacts yet; make one with generate', { artifacts: list });
}

async function toolGetArtifact({ notebook, id }) {
  const nb = needNotebook(notebook);
  const a = studio.getArtifact(nb, id, { recheck: true });
  if (!a) throw new Error(`no artifact "${id}" in ${nb.id}; see list_artifacts`);
  return artifactResult(a);
}

async function toolGenerate({ notebook, recipe, inputs = {}, mode = 'fast' }, ctx) {
  const nb = needNotebook(notebook);
  const m = MODES[mode];
  const prepared = await studio.prepare(nb, recipe, inputs);
  const job = studio.run(nb, prepared, { model: m.model, effort: m.effort, maxTurns: m.maxTurns, onEvent: ctx.progress });
  ctx.onCancel(() => job.cancel());
  try {
    return artifactResult(await job.done);
  } catch (e) {
    if (e.artifact) e.message += ` (saved as artifact ${e.artifact.id} with status ${e.artifact.status})`;
    throw e;
  }
}

// ---------- protocol ----------

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message, data) => ({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } });

const inflight = new Map(); // request id -> { cancel, cancelled }
let initialized = false;

async function callTool(id, params, entry) {
  const tool = BY_NAME.get(params?.name);
  if (!tool) return fail(id, -32602, `Unknown tool: ${params?.name}`);
  const args = params.arguments ?? {};
  const problems = check(tool.inputSchema, args);
  // bad arguments come back as a tool error so the calling model can fix them and retry
  if (problems.length) return reply(id, { ...text(`invalid arguments for ${tool.name}:\n${problems.map((p) => `- ${p}`).join('\n')}`), isError: true });
  const token = params._meta?.progressToken;
  let step = 0;
  const ctx = {
    progress: (e) => {
      if (token == null || entry.cancelled) return;
      const message = e.type === 'tool' ? e.summary : e.type === 'phase' ? `phase: ${e.name}` : null;
      if (message) send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: ++step, message } });
    },
    // a cancel that came in before the job existed runs as soon as it does
    onCancel: (fn) => { entry.cancel = fn; if (entry.cancelled || entry.stopping) fn(); },
  };
  try {
    return reply(id, await tool.run(args, ctx));
  } catch (e) {
    if (!(e.status < 500)) log(`${tool.name} failed:`, e.stack ?? e.message);
    return reply(id, { ...text(`${tool.name} failed: ${e.message}`), isError: true });
  }
}

async function dispatch(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return fail(null, -32600, 'Invalid Request: expected a JSON-RPC object');
  // replies to requests we never send
  if (msg.method === undefined && ('result' in msg || 'error' in msg)) return null;
  const hasId = 'id' in msg;
  const idOk = typeof msg.id === 'string' || Number.isInteger(msg.id);
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string' || (hasId && !idOk)) {
    return fail(idOk ? msg.id : null, -32600, 'Invalid Request: needs jsonrpc "2.0", a string method, and a string or integer id');
  }
  const { id, method } = msg;
  const params = msg.params ?? {};
  if (!hasId) {
    if (method === 'notifications/initialized') initialized = true;
    else if (method === 'notifications/cancelled') {
      const e = inflight.get(params.requestId);
      if (e) { e.cancelled = true; e.cancel?.(); }
    }
    return null;
  }
  if (params === null || typeof params !== 'object') return fail(id, -32602, 'params must be an object');
  switch (method) {
    case 'initialize': {
      if (typeof params.protocolVersion !== 'string') return fail(id, -32602, 'initialize needs params.protocolVersion');
      const protocolVersion = VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0];
      log(`initialize from ${params.clientInfo?.name ?? 'unknown client'}, protocol ${protocolVersion}`);
      return reply(id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions: INSTRUCTIONS });
    }
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: TOOLS.map(({ run, ...t }) => t) });
    case 'tools/call': {
      if (!initialized) log('tools/call before notifications/initialized');
      const entry = { cancel: null, cancelled: false };
      inflight.set(id, entry);
      try {
        const r = await callTool(id, params, entry);
        return entry.cancelled ? null : r; // a cancelled request gets no response
      } finally { inflight.delete(id); }
    }
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

async function onLine(line) {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line.replace(/^﻿/, '')); } catch { return send(fail(null, -32700, 'Parse error')); }
  if (Array.isArray(msg)) {
    if (!msg.length) return send(fail(null, -32600, 'Invalid Request: empty batch'));
    const out = (await Promise.all(msg.map((m) => dispatch(m).catch((e) => fail(m?.id ?? null, -32603, e.message))))).filter(Boolean);
    if (out.length) send(out);
    return;
  }
  const r = await dispatch(msg).catch((e) => fail(msg?.id ?? null, -32603, `Internal error: ${e.message}`));
  if (r) send(r);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const pending = new Set();
// concurrent, so ping and cancel work while an ask runs
rl.on('line', (l) => { const p = onLine(l).finally(() => pending.delete(p)); pending.add(p); });
// stdin closing is the shutdown signal: stop model runs, let the quick replies go out, then exit
rl.on('close', async () => {
  for (const e of inflight.values()) { e.stopping = true; e.cancel?.(); }
  await Promise.allSettled([...pending]);
  log('stdin closed, exiting');
  process.exit(0);
});
log(`ready (pid ${process.pid})`);
