// Citation parsing and verification.
// Forms: [[path#L12]], [[path#L12-L20]], [[path|"quote"]], and [[path#L12|"quote"]].
import fs from 'node:fs';
import path from 'node:path';
import { realInside } from './paths.mjs';
import { readSpan } from './shelf.mjs';

const CITE_RE = /\[\[([^\[\]\n|#]+?)(?:#L(\d+)(?:-L?(\d+))?)?(?:\s*\|\s*(?:"([^"\n]*)"|“([^”\n]*)”|'([^'\n]*)'))?\s*\]\]/g;

export function parseCitations(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(CITE_RE)) {
    const quote = m[4] ?? m[5] ?? m[6] ?? null;
    out.push({
      raw: m[0],
      index: m.index,
      path: m[1].trim().replace(/^`|`$/g, ''),
      line: m[2] ? Number(m[2]) : null,
      endLine: m[3] ? Number(m[3]) : m[2] ? Number(m[2]) : null,
      quote: quote && quote.trim() ? quote.trim() : null,
    });
  }
  return out;
}

// Lectern footnote lines as notes, doc exports and Copy with citations write them: `[^1]: path:12-14 "quote" (verified)` or `path#L12-L14`.
// Same grammar as FOOTNOTE_RE in public/ui/markdown.js, but only our four statuses end a line, and fenced code is skipped.
// \S+? means a path with a space is not read, which the viewer does too.
const FOOTNOTE_RE = /^\[\^(\d+)\]:[ \t]*(\S+?)(?::(\d+)(?:-(\d+))?|#L(\d+)(?:-L(\d+))?)?(?:[ \t]+"(.*)")?[ \t]*\((verified|moved|unverified|missing)\)[ \t\r]*$/gm;
const FENCE_RE = /^(```|~~~)[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm;

export function parseFootnotes(text) {
  return [...String(text ?? '').replace(FENCE_RE, '').matchAll(FOOTNOTE_RE)].map((m) => {
    const line = +(m[3] || m[5]) || null;
    return { n: +m[1], path: m[2], line, endLine: +(m[4] || m[6]) || line, quote: m[7] || null, status0: m[8] };
  });
}

const inside = (base, target) => {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// Resolve a cited or requested path to an absolute file inside the notebook dir or one of its roots.
// Returns null when it escapes. With absolute: false, absolute paths are refused outright.
export function resolveInNotebook(nbDir, p, roots = {}, { absolute = true } = {}) {
  if (!p) return null;
  let rel = String(p).trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!absolute && (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel))) return null;
  const bases = [nbDir, ...Object.values(roots).map((r) => path.resolve(nbDir, r))];
  // lexical check first, then the same check on real paths so links cannot point outside
  const tryAbs = (abs) => (bases.some((b) => inside(b, abs) && realInside(b, abs)) ? abs : null);
  const direct = path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(nbDir, rel);
  const ok = tryAbs(direct);
  if (ok && fs.existsSync(ok)) return ok;
  // tolerate "<rootName>/relative/path" as a shorthand
  const slash = rel.indexOf('/');
  if (slash > 0) {
    const name = rel.slice(0, slash);
    if (Object.hasOwn(roots, name) && typeof roots[name] === 'string') {
      const rootAbs = path.resolve(nbDir, roots[name]);
      const abs = path.resolve(rootAbs, rel.slice(slash + 1));
      if (inside(rootAbs, abs) && realInside(rootAbs, abs) && fs.existsSync(abs)) return abs;
    }
  }
  return ok;
}

// Notebook-relative posix path for display. Files under a root outside the notebook
// show as "<rootName>/<rel>", and anything else as the absolute posix path.
export function displayPath(nbDir, abs, roots = {}) {
  const rel = path.relative(nbDir, abs);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
  for (const [name, r] of Object.entries(roots)) {
    const base = path.resolve(nbDir, r);
    if (inside(base, abs)) return [name, ...path.relative(base, abs).split(path.sep)].filter(Boolean).join('/');
  }
  return abs.split(path.sep).join('/');
}

// whitespace-normalised text: runs of whitespace become one space, ends trimmed, and with
// dropMarks the markdown marks * ` _ are removed first
function normalise(text, dropMarks) {
  return (dropMarks ? text.replace(/[*`_]/g, '') : text).replace(/\s+/g, ' ').trim();
}

const isSpace = (code) => code === 32 || (code >= 9 && code <= 13) || (code > 127 && /\s/.test(String.fromCharCode(code)));

// original index of the character at normalised index k, walking text the way normalise does
function origIndex(text, dropMarks, k) {
  let n = 0;
  let space = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (dropMarks && (code === 42 || code === 96 || code === 95)) continue;
    if (isSpace(code)) {
      if (!space && n) { if (n++ === k) return i; }
      space = true;
      continue;
    }
    space = false;
    if (n++ === k) return i;
  }
  return text.length - 1;
}

// 1-based line of the character before index idx, from cached line start offsets
function lineAt(file, idx) {
  const starts = file.starts ??= [0, ...[...file.text.matchAll(/\n/g)].map((m) => m.index + 1)];
  let lo = 0, hi = starts.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (starts[mid] < idx) lo = mid + 1; else hi = mid; }
  return lo;
}

function findQuote(file, quote) {
  for (const drop of [false, true]) {
    const q = normalise(quote, drop);
    if (!q) return null;
    const t = file.norm[+drop] ??= normalise(file.text, drop);
    const at = t.indexOf(q);
    if (at >= 0) {
      const start = origIndex(file.text, drop, at);
      const end = origIndex(file.text, drop, at + q.length - 1);
      return { line: lineAt(file, start + 1), endLine: lineAt(file, end + 1) };
    }
  }
  return null;
}

// Per-request cache for verify: resolved paths, file text and its normalised forms.
export function fileCache() {
  return { resolved: new Map(), files: new Map() };
}

function resolveCached(nbDir, p, roots, cache) {
  if (!cache.resolved.has(p)) cache.resolved.set(p, resolveInNotebook(nbDir, p, roots));
  return cache.resolved.get(p);
}

// same cap as sources.mjs; anything bigger counts as missing
const MAX_FILE = 2 * 1024 * 1024;

function readCached(abs, cache) {
  if (cache.files.has(abs)) return cache.files.get(abs);
  let file = null;
  try {
    const st = fs.statSync(abs);
    if (st.isFile() && st.size <= MAX_FILE) file = { text: fs.readFileSync(abs, 'utf8'), norm: [] };
  } catch {}
  cache.files.set(abs, file);
  return file;
}

const MAX_SAW_LINES = 120, MAX_SAW_CHARS = 8000;
const MIN_MOVE = 12;            // normalised length under which a block is too common to call moved
const CC_READ_LINES = 2000;     // what claude -p's Read returns when given no limit
const fold = (abs) => (process.platform === 'win32' || process.platform === 'darwin' ? abs.toLowerCase() : abs);
const linesOf = (file) => (file.lines ??= file.text.split('\n'));   // same count the viewer uses
// non-blank lines as { n, t }: 1-based line number, whitespace-normalised text
const codeLines = (file) => (file.nz ??= linesOf(file).flatMap((l, i) => { const t = normalise(l, false); return t ? [{ n: i + 1, t }] : []; }));

export const validSaw = (s) => (s && typeof s.text === 'string' && s.text.trim() && Number.isInteger(s.from) ? s : null);

function capture(file, a, b) {
  const lines = linesOf(file);
  let from = a, to = Math.min(b, lines.length);
  while (from <= to && !lines[from - 1].trim()) from++;
  while (to >= from && !lines[to - 1].trim()) to--;
  if (from > to) return null;
  const keep = [];
  let chars = 0;
  for (let n = from; n <= Math.min(to, from + MAX_SAW_LINES - 1); n++) {
    const l = lines[n - 1].replace(/\r$/, '');
    if (chars + l.length > MAX_SAW_CHARS) break;
    chars += l.length + 1;
    keep.push(l);
  }
  if (!keep.length) return null;
  const last = from + keep.length - 1;
  return { from, to: last, text: keep.join('\n'), ...(last < to ? { cut: true } : {}) };
}

// the saved lines against the file now
function compareSaw(file, base, saw, lineCount) {
  const want = saw.text.split('\n').map((l) => normalise(l, false)).filter(Boolean);
  const nz = codeLines(file);
  // still in place is the usual case, so look there before scanning the whole file
  const at0 = nz.findIndex((x) => x.n === saw.from);
  if (at0 >= 0 && at0 + want.length <= nz.length && want.every((t, k) => nz[at0 + k].t === t)) return { status: 'verified' };
  const hits = [];
  for (let i = 0; i + want.length <= nz.length; i++) if (want.every((t, k) => nz[i + k].t === t)) hits.push(nz[i].n);
  if (hits.includes(saw.from)) return { status: 'verified' };
  if (!hits.length || want.join(' ').length < MIN_MOVE) return { status: 'unverified' };
  const at = hits.reduce((a, b) => (Math.abs(b - saw.from) < Math.abs(a - saw.from) ? b : a));
  const line = Math.max(1, base.line + at - saw.from);
  return { status: 'moved', line, endLine: Math.max(line, Math.min(lineCount, base.endLine + at - saw.from)), citedLine: base.line };
}

// Lines of each file the trail read, from the saved tool calls of either engine. Keys are folded absolute
// paths; values { abs, ranges: [[from, to]] }, sorted and merged. Failed calls and calls without input are skipped.
export function readsByFile(nbDir, toolCalls, roots = {}) {
  const found = new Map();
  for (const t of toolCalls ?? []) {
    const i = t?.input;
    if (!i || t.ok === false) continue;
    let abs, span;
    if (t.name === 'Read' && typeof (i.file_path ?? i.path) === 'string') {
      abs = path.resolve(nbDir, i.file_path ?? i.path);
      const from = Math.max(1, Number(i.offset) || 1);
      span = [from, from + (Number(i.limit) > 0 ? Number(i.limit) : CC_READ_LINES) - 1];
    } else if (t.name === 'read' && typeof i.root === 'string' && Object.hasOwn(roots, i.root) && typeof roots[i.root] === 'string' && typeof i.path === 'string') {
      abs = path.resolve(nbDir, roots[i.root], i.path);
      span = readSpan(i.start, i.end);
    } else continue;
    const k = fold(abs);
    if (!found.has(k)) found.set(k, { abs, ranges: [] });
    found.get(k).ranges.push(span);
  }
  for (const f of found.values()) {
    f.ranges.sort((a, b) => a[0] - b[0]);
    f.ranges = f.ranges.reduce((m, r) => { const l = m.at(-1); if (l && r[0] <= l[1] + 1) l[1] = Math.max(l[1], r[1]); else m.push([...r]); return m; }, []).slice(0, 32);
  }
  return found;
}

export function verify(nbDir, cite, roots = {}, cache = fileCache(), { reads = null } = {}) {
  const base = { path: cite.path, line: cite.line ?? null, endLine: cite.endLine ?? cite.line ?? null, quote: cite.quote ?? null };
  // a path that cannot be resolved at all is just missing, never a failed read
  let abs = null;
  try { abs = resolveCached(nbDir, cite.path, roots, cache); } catch {}
  const file = abs ? readCached(abs, cache) : null;
  if (!file) return { ...base, status: 'missing' };
  base.path = displayPath(nbDir, abs, roots);
  const lineCount = lineAt(file, Infinity);
  if (base.quote) {
    const hit = findQuote(file, base.quote);
    if (!hit) return { ...base, status: 'unverified' };
    if (base.line == null) return { ...base, line: hit.line, endLine: hit.endLine, status: 'verified' };
    // the quote has to overlap the cited range, with a little slack
    const lo = base.line - 2, hi = (base.endLine ?? base.line) + 2;
    if (hit.endLine >= lo && hit.line <= hi) return { ...base, status: 'verified' };
    return { ...base, line: hit.line, endLine: hit.endLine, status: 'moved', citedLine: base.line };
  }
  if (base.line == null) return { ...base, status: 'verified' };
  if (base.endLine < base.line) base.endLine = base.line;
  const seen = reads ? reads.get(fold(abs))?.ranges ?? [] : undefined;       // undefined = no trail information
  const stamp = (saw) => (saw && seen && saw.read === undefined ? { ...saw, read: seen } : saw);
  const had = validSaw(cite.saw);
  if (had) return { ...base, ...compareSaw(file, base, had, lineCount), saw: stamp(had) };   // same object back when nothing changed
  if (base.line >= 1 && base.endLine <= lineCount) {
    const saw = stamp(capture(file, base.line, base.endLine));
    return { ...base, status: 'verified', ...(saw ? { saw } : {}) };
  }
  return { ...base, status: 'unverified' };
}

// ---------- re-checking saved citations ----------

const RANK = { verified: 0, moved: 1, unverified: 2, missing: 3 };
export const rank = (s) => RANK[s] ?? 3;

export function statusCounts(list) {
  const out = { verified: 0, moved: 0, unverified: 0, missing: 0 };
  for (const c of list ?? []) { const s = c?.status ?? c; if (out[s] != null) out[s]++; }
  return out;
}

// A phrase for why a citation did not check out, to follow the citation in a message: `[[x#L40]] is past the end of x (32 lines)`.
// v is verify()'s result for cite. A file over 2 MB is missing to verify(), so it gets the missing wording too.
export function whyNot(nbDir, cite, v, roots = {}, cache = fileCache()) {
  if (v.status === 'missing') return 'is not a file in the notebook';
  if (cite.quote) return `does not appear in ${v.path}`;
  if (cite.line < 1) return 'is not a line number';
  let n = null;
  // lineAt counts the empty line after a final newline, which is not a line of the file
  try { const abs = resolveCached(nbDir, cite.path, roots, cache); const f = abs && readCached(abs, cache); if (f) n = f.text ? lineAt(f, Infinity) - (f.text.endsWith('\n') ? 1 : 0) : 0; } catch {}
  return `is past the end of ${v.path}${n != null ? ` (${n} ${n === 1 ? 'line' : 'lines'})` : ''}`;
}

const pushDrift = (c, entry) => { c.drift = [...(c.drift ?? []), entry].slice(-20); };

// Verify saved citations again against the files as they are now. The first status, time and
// cited line are kept as status0, checkedAt0, line0 and endLine0.
// Returns { citations, summary, dirty }; dirty means a status or line differs from the stored copy.
export function reverify(nbDir, citations, roots = {}, { cache = fileCache(), at = new Date().toISOString(), since = null, reads = null } = {}) {
  let dirty = false;
  const out = (Array.isArray(citations) ? citations : []).map((c) => {
    if (!c || typeof c !== 'object') return c;
    const first = c.status0 == null;
    const line0 = first ? c.citedLine ?? c.line ?? null : c.line0 ?? null;
    const endLine0 = first
      ? (line0 != null && c.line != null && c.endLine != null ? line0 + Math.max(0, c.endLine - c.line) : c.endLine ?? line0)
      : c.endLine0 ?? null;
    const status0 = first ? c.status ?? 'unverified' : c.status0;
    const checkedAt0 = c.checkedAt0 ?? since ?? at;
    const had = validSaw(c.saw);
    const v = verify(nbDir, { path: c.path, line: line0, endLine: endLine0, quote: c.quote, saw: had }, roots, cache, { reads });
    // a citation saved before lines were kept gets its baseline now, and says so
    if (v.saw && !had) v.saw = { ...v.saw, base: true, at };
    const { citedLine, ...rest } = c;
    const next = { ...rest, ...v, status0, checkedAt0, line0, endLine0, checkedAt: at };
    if (v.status !== c.status || v.line !== c.line || v.endLine !== c.endLine) {
      dirty = true;
      pushDrift(next, { at, status: v.status, line: v.line });
    }
    if (v.saw && v.saw !== had) dirty = true;
    return next;
  });
  return { citations: out, summary: checkSummary(out, at, since), dirty };
}

export function checkSummary(list, at, since = null) {
  const cites = list.filter((c) => c && typeof c === 'object');
  const worse = cites.filter((c) => rank(c.status) > rank(c.status0)).length;
  return {
    checkedAt: at,
    checkedAt0: cites[0]?.checkedAt0 ?? since ?? null,
    counts: statusCounts(cites),
    counts0: statusCounts(cites.map((c) => c.status0)),
    worse,
    changed: worse > 0,
  };
}

// The same for structured refs: "path#L12" strings on data nodes, with refStatus beside them.
// Mutates data in place and keeps the first ref and status as ref0 and refStatus0.
export function reverifyRefs(nbDir, data, roots = {}, { cache = fileCache(), at = new Date().toISOString(), saws = {} } = {}) {
  const refs = [];
  let dirty = false;
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (typeof node.ref === 'string' && node.ref.trim()) {
      node.ref0 ??= node.ref;
      node.refStatus0 ??= node.refStatus ?? 'unverified';
      const c = parseCitations(`[[${node.ref0.trim()}]]`)[0];
      const v = c ? verify(nbDir, { ...c, saw: saws[node.ref0] }, roots, cache) : { status: 'missing' };
      if (v.saw && v.saw !== saws[node.ref0]) { saws[node.ref0] = validSaw(saws[node.ref0]) ? v.saw : { ...v.saw, base: true, at }; dirty = true; }
      const ref = v.status === 'missing' ? node.ref : `${v.path}${v.line ? `#L${v.line}${v.endLine && v.endLine !== v.line ? `-L${v.endLine}` : ''}` : ''}`;
      if (v.status !== node.refStatus || ref !== node.ref) {
        dirty = true;
        pushDrift(node, { at, status: v.status, ref });
      }
      node.ref = ref;
      node.refStatus = v.status;
      node.refCheckedAt = at;
      refs.push({ status: v.status, status0: node.refStatus0 });
    }
    for (const [k, v] of Object.entries(node)) if (k !== 'drift' && v && typeof v === 'object') walk(v);
  };
  walk(data);
  const worse = refs.filter((r) => rank(r.status) > rank(r.status0)).length;
  return { summary: { counts: statusCounts(refs), worse, changed: worse > 0 }, dirty };
}

// Replace each [[...]] with [^n] and return numbered, verified citations.
// Identical citations share a number.
export function processAnswer(nbDir, text, roots = {}, { reads = null } = {}) {
  const cites = parseCitations(text);
  const cache = fileCache();
  const byRaw = new Map();
  const citations = [];
  for (const c of cites) {
    const key = `${c.path}#${c.line}-${c.endLine}|${c.quote}`;
    if (byRaw.has(key)) continue;
    const v = verify(nbDir, c, roots, cache, { reads });
    const n = citations.length + 1;
    citations.push({ n, ...v });
    byRaw.set(key, n);
  }
  const src = String(text ?? '');
  const answer = src.replace(CITE_RE, (...m) => {
    const c = parseCitations(m[0])[0];
    const marker = `[^${byRaw.get(`${c.path}#${c.line}-${c.endLine}|${c.quote}`)}]`;
    // the model sometimes uses the quote as part of the sentence ("because [[p|"..."]]"); keep the words then
    const before = src.slice(Math.max(0, m.at(-2) - 40), m.at(-2));
    // escaped so a name like LECTERN_FAKE_ENGINE is not read as markdown italics
    if (c.quote && DANGLING_RE.test(before)) return `"${c.quote.replace(/([\\*_~`])/g, '\\$1')}" ${marker}`;
    return marker;
  });
  return { answer, citations };
}

// ponytail: word-list heuristic for a sentence that needs the quote to finish, extend the list when a new case shows up
const DANGLING_RE = /(?:\b(?:because|is|are|was|says?|said|states?|reads?|like|as|that|with|called|named|of|the|an?|to|by|from)|[:“"(])\s*$/i;

export const CITATION_RULES =`Citations are required. Cite every factual claim inline, right after the claim, using exactly one of these forms. A citation comes after the words it supports and is never part of the sentence: the sentence must still read correctly with every citation removed, so never use a citation as a noun, as the quoted words themselves, or after "says:".
- Docs: [[path|"short verbatim quote"]], where path is the ### FILE: path shown in the pinned documents and the quote is 3 to 15 words copied exactly from that file (case and punctuation as written, no markdown symbols you added).
- Code: [[path#L12]] or [[path#L12-L20]], where path is the code root's path from the list above + "/" + the file path inside that root, and the line numbers are the real ones you read.
Paths are always relative to the notebook directory, never absolute, never with a leading "./". Do not invent line numbers: only cite lines you actually read with Read or found with Grep. Do not put citations inside code blocks.`;
