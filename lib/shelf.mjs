// The pinned shelf (globbing docs into documents), the code-root tools and the base system prompt.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { onPath } from './which.mjs';
import { realInside } from './paths.mjs';
import { scanSync, MAX_PATTERN } from './regexscan.mjs';

const GREP_CAP = 8000;
const GREP_MAX_FILE = 2 * 1024 * 1024;
const toPosix = (p) => p.split(path.sep).join('/');

// ---------- globbing ----------

// ponytail: tiny glob->regex for the fallback walk, handles ** and * only
const globToRegex = (g) =>
  new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '(.*/)?') + '$');

// symlinks and junctions are skipped, so the walk never leaves the folder it started in
function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
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
    // glob follows links; drop any match whose real path is outside cwd
    return out.filter((f) => realInside(cwd, path.join(cwd, f))).sort();
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
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel) || !realInside(rootDir, target)) throw new Error(`path escapes the root: ${p}`);
  return target;
}

function grepNode(rootDir, pattern, glob) {
  const gre = glob ? globToRegex(glob.includes('/') ? glob : '**/' + glob) : null;
  // skip what rg would skip by default: VCS and dependency folders, big files, binaries
  const files = walk(rootDir)
    .filter((rel) => (!gre || gre.test(rel)) && !rel.split('/').some((s) => s === '.git' || s === 'node_modules'))
    .map((rel) => ({ abs: path.join(rootDir, rel), path: rel }));
  return scanSync({ files, pattern, perFile: 40, maxFile: GREP_MAX_FILE }).hits.map((h) => `${h.path}:${h.line}:${h.text}`);
}

// The node scan is the default; rg is used when it is on PATH and accepts the pattern.
export function grepTool(rootDir, { pattern, glob }) {
  if (String(pattern).length > MAX_PATTERN) throw new Error(`pattern is longer than ${MAX_PATTERN} characters`);
  const rg = process.env.LECTERN_NO_RG === '1' ? null : onPath('rg');
  const r = rg && spawnSync(rg, ['-n', '--no-heading', '--max-count', '40', ...(glob ? ['-g', glob] : []), '-e', pattern, '.'], { cwd: rootDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  let lines;
  if (!r || r.error || r.status === 2) lines = grepNode(rootDir, pattern, glob);
  // only the path before the first colon gets forward slashes, the matched text stays as it is
  else lines = r.stdout.split('\n').filter(Boolean).map((l) => l.replace(/^\.[\\/]/, '').replace(/\r$/, '').replace(/^[^:]*/, (p) => p.replace(/\\/g, '/')));
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
      input_schema: obj({ root, pattern: { type: 'string' }, glob: { type: 'string', description: 'e.g. *.ts' } }, ['root', 'pattern']) },
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
  // target is an optional notebook.json field, e.g. "Python 3.12 with Django 5.1"
  const target = typeof nb.target === 'string' && nb.target.trim() ? `The target is ${nb.target.trim()}. ` : '';
  let s = `You are a notebook. You answer only from the pinned documents in the first user message and from the code roots (${roots}) you can search with the grep, read and ls tools.
${target}Never answer API questions from memory. If the sources do not cover something, say so plainly.
When you quote the pinned docs, the API attaches citations automatically.
When you look in code with the tools, cite the file as root/relative/path:line in your answer.
Prefer reading the real signature over paraphrasing it.`;
  if (nb.system) s += '\n\n' + nb.system;
  return s;
}

// The last doc carries the shelf's own one-hour breakpoint, so a new conversation or a follow-up asked
// within the hour reads the whole shelf from cache. A one-hour entry has to come before any shorter one.
export function docBlocks(docs) {
  return docs.map((d, i) => ({
    type: 'document', source: { type: 'text', media_type: 'text/plain', data: d.data }, title: d.title, citations: { enabled: true },
    ...(i === docs.length - 1 ? { cache_control: { type: 'ephemeral', ttl: '1h' } } : {}),
  }));
}
