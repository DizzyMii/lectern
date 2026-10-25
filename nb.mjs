// nb.mjs - throwaway spike: ask a pinned-docs + code-roots "notebook" a question.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const MAX_ROUNDS = 12;
const GREP_CAP = 8000;
const toPosix = (p) => p.split(path.sep).join('/');

// ---------- globbing ----------

// ponytail: tiny glob->regex for the fallback walk, handles ** and * only
const globToRegex = (g) =>
  new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '(.*/)?') + '$');

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else out.push(toPosix(path.relative(base, full)));
  }
  return out;
}

export async function globFiles(pattern, cwd) {
  try {
    if (typeof fs.promises.glob !== 'function') throw new Error('no fs.promises.glob');
    const out = [];
    for await (const f of fs.promises.glob(pattern, { cwd })) out.push(toPosix(f));
    return out.sort();
  } catch {
    if (!fs.existsSync(cwd)) return [];
    const re = globToRegex(pattern);
    return walk(cwd).filter((f) => re.test(f)).sort();
  }
}

// static part of a glob, e.g. "a/b/**/*.md" -> "a/b"
const globBase = (g) => g.split('/').filter((_, i, a) => !a.slice(0, i + 1).some((s) => /[*?[{]/.test(s))).join('/');

// ---------- pinned shelf ----------

export function buildDocument(title, files /* [{rel, text}] */) {
  let data = '';
  const starts = [];
  for (const f of files) {
    const header = `### FILE: ${f.rel}\n`;
    starts.push({ file: f.rel, start: data.length, contentStart: data.length + header.length });
    data += header + f.text + (f.text.endsWith('\n') ? '' : '\n');
  }
  return { title, data, starts };
}

export function offsetToFileLine(doc, idx) {
  let hit = doc.starts[0];
  for (const s of doc.starts) if (s.start <= idx) hit = s;
  if (!hit) return { file: doc.title, line: 1 };
  const from = hit.contentStart;
  if (idx <= from) return { file: hit.file, line: 1 };
  return { file: hit.file, line: doc.data.slice(from, idx).split('\n').length };
}

export async function loadShelf(nbDir, pinned) {
  const docs = [];
  for (const pattern of pinned) {
    const base = globBase(pattern);
    const groups = new Map();
    for (const rel of await globFiles(pattern, nbDir)) {
      const under = path.posix.relative(base, rel).split('/');
      const group = under.length > 1 ? under[0] : path.posix.basename(base);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push({ rel, text: fs.readFileSync(path.join(nbDir, rel), 'utf8') });
    }
    for (const [group, files] of groups) docs.push(buildDocument(group, files));
  }
  return docs;
}

// ---------- tools ----------

export function safePath(rootDir, p = '.') {
  const target = path.resolve(rootDir, p);
  const rel = path.relative(rootDir, target);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error(`path escapes the root: ${p}`);
  return target;
}

function grepNode(rootDir, pattern, glob) {
  const re = new RegExp(pattern);
  const gre = glob ? globToRegex(glob.includes('/') ? glob : '**/' + glob) : null;
  const lines = [];
  for (const rel of walk(rootDir)) {
    if (gre && !gre.test(rel)) continue;
    let n = 0;
    fs.readFileSync(path.join(rootDir, rel), 'utf8').split('\n').forEach((l, i) => {
      if (n < 40 && re.test(l)) { n++; lines.push(`${rel}:${i + 1}:${l}`); }
    });
  }
  return lines;
}

export function grepTool(rootDir, { pattern, glob }) {
  const args = ['-n', '--no-heading', '--max-count', '40', ...(glob ? ['-g', glob] : []), '-e', pattern, '.'];
  const r = spawnSync('rg', args, { cwd: rootDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let lines;
  if (r.error) lines = grepNode(rootDir, pattern, glob); // ponytail: rg missing -> slow JS scan
  else lines = r.stdout.split('\n').filter(Boolean).map((l) => toPosix(l.replace(/^\.[\\/]/, '')));
  let out = '', kept = 0;
  for (const l of lines) { if (out.length + l.length + 1 > GREP_CAP) break; out += l + '\n'; kept++; }
  if (kept < lines.length) out += `[cut ${lines.length - kept} more lines]\n`;
  return { text: out || 'no matches', hits: lines.length };
}

export function readTool(rootDir, { path: p, start, end }) {
  const all = fs.readFileSync(safePath(rootDir, p), 'utf8').split('\n');
  const s = Math.max(1, start ?? 1);
  const e = Math.min(all.length, end ?? s + 199, s + 299);
  return { text: all.slice(s - 1, e).map((l, i) => `${s + i}: ${l}`).join('\n'), start: s, end: e };
}

export function lsTool(rootDir, { dir }) {
  return fs.readdirSync(safePath(rootDir, dir ?? '.'), { withFileTypes: true })
    .map((e) => e.name + (e.isDirectory() ? '/' : '')).sort().join('\n');
}

const obj = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
export function toolDefs(rootNames) {
  const root = { type: 'string', enum: rootNames, description: 'which code root' };
  return [
    { name: 'grep', strict: true, description: 'ripgrep a regex over a code root. Returns root-relative path:line:text.',
      input_schema: obj({ root, pattern: { type: 'string' }, glob: { type: 'string', description: 'e.g. *.java' } }, ['root', 'pattern']) },
    { name: 'read', strict: true, description: 'Read numbered lines of a file in a code root (default 200, max 300 per call).',
      input_schema: obj({ root, path: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' } }, ['root', 'path']) },
    { name: 'ls', strict: true, description: 'List one directory level in a code root.',
      input_schema: obj({ root, dir: { type: 'string' } }, ['root']) },
  ];
}

export function runTool(roots, nbDir, name, input) {
  const rel = roots[input.root];
  if (!rel) return { content: `unknown root: ${input.root}`, is_error: true, trace: `${name} bad root` };
  const rootDir = path.resolve(nbDir, rel);
  try {
    if (name === 'grep') {
      const r = grepTool(rootDir, input);
      return { content: r.text, trace: `grep ${input.pattern} in ${input.root}: ${r.hits} lines` };
    }
    if (name === 'read') {
      const r = readTool(rootDir, input);
      return { content: r.text, trace: `read ${input.root}/${input.path} ${r.start}-${r.end}` };
    }
    if (name === 'ls') return { content: lsTool(rootDir, input), trace: `ls ${input.root}/${input.dir ?? ''}` };
    return { content: `unknown tool: ${name}`, is_error: true, trace: `${name}?` };
  } catch (e) {
    return { content: String(e.message), is_error: true, trace: `${name} error: ${e.message}` };
  }
}

// ---------- prompt ----------

export function systemPrompt(nb) {
  const roots = Object.keys(nb.roots ?? {}).join(', ') || '(none)';
  let s = `You are a notebook. You answer only from the pinned documents in the first user message and from the code roots (${roots}) you can search with the grep, read and ls tools.
The target is Minecraft 1.21.1 with NeoForge 21.1. Never answer NeoForge API questions from memory. If the sources do not cover something, say so plainly.
When you quote the pinned docs, the API attaches citations automatically.
When you look in code with the tools, cite the file as root/relative/path.java:line in your answer.
Prefer reading the real signature over paraphrasing it.`;
  if (nb.system) s += '\n\n' + nb.system;
  return s;
}

export function docBlocks(docs) {
  return docs.map((d, i) => ({
    type: 'document', source: { type: 'text', media_type: 'text/plain', data: d.data }, title: d.title, citations: { enabled: true },
    ...(i === docs.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
  }));
}

// ---------- answer rendering ----------

export function renderAnswer(content, docs) {
  let answer = '';
  const citations = [];
  for (const b of content) {
    if (b.type !== 'text') continue;
    answer += b.text;
    for (const c of b.citations ?? []) {
      const doc = docs[c.document_index];
      const loc = doc && c.type === 'char_location' ? offsetToFileLine(doc, c.start_char_index) : { file: c.document_title, line: null };
      citations.push({ n: citations.length + 1, file: loc.file, line: loc.line, cited_text: c.cited_text, title: c.document_title });
      answer += `[${citations.length}]`;
    }
  }
  return { answer, citations };
}

// ---------- main ----------

function parseArgs(argv) {
  const [cmd, nbDir, question, ...rest] = argv;
  const flag = (n) => rest.includes(n);
  const opt = (n, d) => (rest.indexOf(n) >= 0 ? rest[rest.indexOf(n) + 1] : d);
  return { cmd, nbDir, question, json: flag('--json'), dry: flag('--dry-run'), model: opt('--model', 'claude-opus-5-5'), effort: opt('--effort', 'high') };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.cmd !== 'ask' || !a.nbDir || !a.question) {
    console.error('usage: node nb.mjs ask <notebookDir> "<question>" [--json] [--model m] [--effort e] [--dry-run]');
    process.exit(2);
  }
  const nbDir = path.resolve(a.nbDir);
  const nb = JSON.parse(fs.readFileSync(path.join(nbDir, 'notebook.json'), 'utf8'));
  const docs = await loadShelf(nbDir, nb.pinned ?? []);
  const system = systemPrompt(nb);
  const tools = toolDefs(Object.keys(nb.roots ?? {}));

  if (a.dry) {
    const words = docs.reduce((n, d) => n + d.data.split(/\s+/).filter(Boolean).length, 0);
    console.log(`notebook: ${nb.name}`);
    console.log(`documents: ${docs.length} (${docs.map((d) => `${d.title}:${d.starts.length}`).join(', ')})`);
    console.log(`estimated tokens: ${Math.round(words * 1.3)} (${words} words * 1.3)`);
    for (const [k, v] of Object.entries(nb.roots ?? {})) console.log(`root ${k}: ${v} ${fs.existsSync(path.resolve(nbDir, v)) ? '(ok)' : '(MISSING)'}`);
    console.log('tools:\n' + JSON.stringify(tools, null, 2));
    console.log('system (first 300 chars):\n' + system.slice(0, 300));
    return;
  }

  const client = new Anthropic();
  // docs (with the cache breakpoint on the last one) lead messages[0], the question goes after,
  // so tools+system+docs is the same cached prefix on every round and every question
  const messages = [{ role: 'user', content: [...docBlocks(docs), { type: 'text', text: a.question }] }];
  const usage = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
  const toolCalls = [];
  const trace = [];
  let msg, rounds = 0;
  while (true) {
    rounds++;
    msg = await client.messages.stream({ model: a.model, max_tokens: 16000, system, tools, messages, output_config: { effort: a.effort } }).finalMessage();
    for (const k of Object.keys(usage)) usage[k] += msg.usage?.[k] ?? 0;
    if (msg.stop_reason !== 'tool_use' || rounds >= MAX_ROUNDS) break;
    messages.push({ role: 'assistant', content: msg.content });
    const results = [];
    for (const b of msg.content.filter((b) => b.type === 'tool_use')) {
      const r = runTool(nb.roots ?? {}, nbDir, b.name, b.input);
      trace.push(r.trace);
      toolCalls.push({ tool: b.name, input: b.input, chars: r.content.length });
      results.push({ type: 'tool_result', tool_use_id: b.id, content: r.content, ...(r.is_error ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });
  }
  // ponytail: only the final message's text is the answer; earlier rounds' narration is dropped
  const { answer, citations } = renderAnswer(msg.content, docs);
  const capped = msg.stop_reason === 'tool_use' ? ` (stopped at ${MAX_ROUNDS} rounds)` : '';

  if (a.json) {
    console.log(JSON.stringify({ answer, citations, toolCalls, usage, rounds, model: a.model, stop_reason: msg.stop_reason }, null, 2));
    return;
  }
  console.log(answer.trim() + '\n');
  for (const c of citations) console.log(`[${c.n}] ${c.file}:${c.line}  "${c.cited_text.replace(/\s+/g, ' ').slice(0, 80)}"`);
  if (trace.length) console.log('\ntools:\n' + trace.map((t) => '  ' + t).join('\n'));
  console.log(`\nusage: in ${usage.input_tokens}, cache write ${usage.cache_creation_input_tokens}, cache read ${usage.cache_read_input_tokens}, out ${usage.output_tokens}, rounds ${rounds}${capped}, ${a.model}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e instanceof Anthropic.APIError ? `API error ${e.status}: ${e.message}` : e); process.exit(1); });
}
