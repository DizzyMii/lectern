// Past answers, notes and sheets across notebooks, matched to typed text by shared words. Local, no model,
// writes nothing. Saved citations are re-checked against the files for the returned hits only.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, getNote } from './store.mjs';
import { reverify, fileCache, statusCounts } from './cite.mjs';

export const KINDS = ['answer', 'note', 'sheet'];
// hint: the composer offers one close match to a question being typed. search: the palette and MCP look for anything related.
export const PRESETS = { hint: { min: 0.6, minTokens: 3, bodyMin: 4 }, search: { min: 0.34, minTokens: 1, bodyMin: 1 } };
const TEXT_MAX = 6000, BODY_MAX = 20000;
const STOP = new Set('a an and are as at be by can do does for from how i in is it its my of on or so that the then there this to was we what when where which who why will with you'.split(' '));

export const tokens = (s) => new Set((String(s ?? '').toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? []).filter((w) => !STOP.has(w)));

// a typed word is found when the set has it, or (from 4 letters) a longer word starts with it, so "attach" finds "attachments"
function hits(q, set) {
  let n = 0;
  for (const w of q) {
    if (set.has(w)) { n++; continue; }
    if (w.length < 4) continue;
    for (const s of set) if (s.startsWith(w)) { n++; break; }
  }
  return n;
}

export function score(q, title, body, { bodyMin = 1 } = {}) {
  if (!q.size) return 0;
  const cos = Math.min(1, hits(q, title) / Math.sqrt(q.size * Math.max(title.size, 1)));
  const inBody = q.size >= bodyMin ? hits(q, body) / q.size : 0;
  return Math.max(cos, 0.7 * inBody);
}

const cache = new Map(); // file -> { sig, val }
function cached(file, make) {
  let st; try { st = fs.statSync(file); } catch { cache.delete(file); return null; }
  const sig = `${st.mtimeMs}:${st.size}`;
  const hit = cache.get(file);
  if (hit?.sig === sig) return hit.val;
  const val = make(file);
  cache.set(file, { sig, val });
  return val;
}

const ls = (dir, ext) => { try { return fs.readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => path.join(dir, f)); } catch { return []; } };
const flat = (s) => String(s).replace(/\s+/g, ' ').trim();

// one conversation file -> its numbering facts and one doc per answered turn. c.api (everything the model read) is never kept.
function convDocs() {
  return (file) => {
    const c = readJson(file, null);
    if (!c || typeof c !== 'object' || !c.id || !Array.isArray(c.turns)) return { meta: null, docs: [] };
    const created = c.created || c.updated || '';
    const docs = [];
    c.turns.forEach((t, turn) => {
      if (!t || typeof t.question !== 'string' || typeof t.answer !== 'string' || !t.question.trim() || !t.answer.trim()) return;
      const title = flat(t.question).slice(0, 200);
      docs.push({ kind: 'answer', id: c.id, turn, title, at: t.endedAt ?? c.updated, created, tt: tokens(t.question), bt: tokens(t.answer.slice(0, BODY_MAX)), text: t.answer.slice(0, TEXT_MAX), file });
    });
    return { meta: { id: c.id, created }, docs };
  };
}

function noteDocs(nb) {
  return (file) => {
    const slug = path.basename(file, '.md');
    const n = getNote(nb, slug);
    if (!n) return [];
    return [{ kind: 'note', id: slug, turn: null, title: n.title, at: n.updated, tt: tokens(n.title), bt: tokens(n.body.slice(0, BODY_MAX)), text: n.body.slice(0, TEXT_MAX), file }];
  };
}

// data-kind sheets match on title and summary only; walking `data` would match JSON keys and labels
function sheetDocs(nb) {
  return (file) => {
    const a = readJson(file, null);
    if (!a || typeof a !== 'object' || !a.id || a.status !== 'ok') return [];
    const title = a.title || a.recipe || a.id;
    const text = [a.summary, a.markdown].filter((s) => typeof s === 'string' && s).join('\n\n');
    return [{ kind: 'sheet', id: a.id, turn: null, title, at: a.updatedAt ?? a.createdAt, tt: tokens(title), bt: tokens(text.slice(0, BODY_MAX)), text: text.slice(0, TEXT_MAX), file }];
  };
}

// same rule as qnum() in the app: 1-based place of the conversation among its notebook's, oldest created first
function numbers(metas) {
  const sorted = [...metas].sort((a, b) => String(a.created).localeCompare(String(b.created)) || String(a.id).localeCompare(String(b.id)));
  return new Map(sorted.map((m, i) => [m.id, String(i + 1).padStart(3, '0')]));
}

// notebooks: nb objects from listNotebooks(). skip: { notebook, id } drops that conversation (the one open in the composer).
// -> [{ kind, notebook, notebookTitle, id, turn, num, title, at, score, cites, citations, text }]
export function recall(notebooks, query, { mode = 'search', kinds = KINDS, limit = 5, skip = null } = {}) {
  const p = PRESETS[mode] ?? PRESETS.search;
  const q = tokens(String(query ?? '').slice(0, 1000));
  if (q.size < p.minTokens) return [];
  const want = new Set((Array.isArray(kinds) ? kinds : KINDS).filter((k) => KINDS.includes(k)));
  const max = Math.max(1, Math.min(30, Number(limit) || 5));
  const best = new Map(); // notebook/kind/id -> best doc, with its score
  const nums = new Map(); // notebook -> Map(conversation id -> '044')
  for (const nb of notebooks) {
    const metas = [], found = [];
    for (const f of ls(path.join(nb.dir, 'conversations'), '.json')) {
      const r = cached(f, convDocs());
      if (!r) continue;
      if (r.meta) metas.push(r.meta);
      if (want.has('answer')) found.push(...r.docs);
    }
    nums.set(nb.id, numbers(metas));
    if (want.has('note')) for (const f of ls(path.join(nb.dir, 'notes'), '.md')) found.push(...(cached(f, noteDocs(nb)) ?? []));
    if (want.has('sheet')) for (const f of ls(path.join(nb.dir, 'artifacts'), '.json')) found.push(...(cached(f, sheetDocs(nb)) ?? []));
    for (const d of found) {
      if (skip && d.kind === 'answer' && nb.id === skip.notebook && d.id === skip.id) continue;
      const s = score(q, d.tt, d.bt, p);
      if (s < p.min) continue;
      const key = `${nb.id}/${d.kind}/${d.id}`;
      if (!best.has(key) || s > best.get(key).s) best.set(key, { d: { ...d, notebook: nb.id }, s });
    }
  }
  const top = [...best.values()].sort((a, b) => b.s - a.s || String(b.d.at).localeCompare(String(a.d.at))).slice(0, max);
  const byId = new Map(notebooks.map((nb) => [nb.id, nb]));
  // the cache keys resolved paths by their text, so each notebook needs its own
  const caches = new Map(), at = new Date().toISOString();
  return top.map(({ d, s }) => {
    const nb = byId.get(d.notebook);
    let cites = null, citations = [];
    if (d.kind !== 'note') {
      const src = readJson(d.file, null);
      const list = d.kind === 'answer' ? src?.turns?.[d.turn]?.citations : src?.citations;
      citations = reverify(nb.dir, Array.isArray(list) ? list : [], nb.config?.roots ?? {}, { cache: caches.get(nb.id) ?? caches.set(nb.id, fileCache()).get(nb.id), at }).citations;
      cites = { total: citations.length, ...statusCounts(citations) };
    }
    return {
      kind: d.kind, notebook: nb.id, notebookTitle: nb.title, id: d.id, turn: d.turn, num: d.kind === 'answer' ? nums.get(nb.id).get(d.id) ?? null : null,
      title: d.title, at: d.at ?? null, score: Math.round(s * 100) / 100, cites, citations, text: d.text,
    };
  });
}
