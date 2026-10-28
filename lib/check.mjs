// lectern check: re-verify everything a notebook saved, and the Lectern footnotes in named markdown files. Never calls a model, never writes.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, listNotes, getNote } from './store.mjs';
import { parseCitations, parseFootnotes, reverify, fileCache, rank } from './cite.mjs';

export const FAIL_LEVELS = ['moved', 'unverified'];

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// footnote lines as saved citations, with the written status as the status they start from
const footnoteSaved = (text) => parseFootnotes(text).map((f) => ({ n: f.n, path: f.path, line: f.line, endLine: f.endLine, quote: f.quote, status: f.status0 }));

// footnotes -> re-verified citations carrying the written status as status0 and the written lines as line0/endLine0
export function footnoteCites(nb, text, cache = fileCache()) {
  return reverify(nb.dir, footnoteSaved(text), nb.config.roots, { cache }).citations;
}

const arr = (v) => (Array.isArray(v) ? v : []);

const readAll = (dir, newest) => {
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch {}
  return names.map((f) => ({ id: f.slice(0, -5), v: readJson(path.join(dir, f), null) })).filter((x) => x.v && typeof x.v === 'object')
    .sort((a, b) => String(b.v[newest]).localeCompare(String(a.v[newest])));
};

// same walk as reverifyRefs: any node with a ref string, never the drift history
function walkRefs(node, fn) {
  if (Array.isArray(node)) return node.forEach((x) => walkRefs(x, fn));
  if (!node || typeof node !== 'object') return;
  if (typeof node.ref === 'string' && node.ref.trim()) fn(node);
  for (const [k, v] of Object.entries(node)) if (k !== 'drift' && v && typeof v === 'object') walkRefs(v, fn);
}

const refCite = (a, node) => {
  const ref0 = node.ref0 ?? node.ref;
  const was = parseCitations(`[[${ref0.trim()}]]`)[0];
  const now = parseCitations(`[[${node.ref.trim()}]]`)[0] ?? was;
  const status = node.refStatus ?? 'unverified';
  return { path: was?.path ?? ref0, line: now?.line ?? null, endLine: now?.endLine ?? null, quote: null, status, status0: node.refStatus0 ?? status, line0: was?.line ?? null, endLine0: was?.endLine ?? null, saw: a.sawRefs?.[ref0] };
};

// Everything the notebook saved, read straight off disk (never through getConversation, so nothing is written and conv.api stays out).
// Items are { kind: 'answer'|'sheet'|'note', id, title, turn?, question?, n, node?, ref?, recipe?, writtenTo?, cite }; cite is a copy, status0 and friends included.
function walk(nb) {
  const items = [], scanned = { conversations: 0, sheets: 0, notes: 0, files: 0 };
  for (const { id, v: conv } of readAll(path.join(nb.dir, 'conversations'), 'updated')) {
    scanned.conversations++;
    arr(conv.turns).forEach((t, turn) => arr(t?.citations).forEach((c) => {
      if (c && typeof c === 'object') items.push({ kind: 'answer', id: conv.id ?? id, title: conv.title, turn, question: clip(String(t.question ?? ''), 200), n: c.n, cite: { ...c } });
    }));
  }
  for (const { id, v: a } of readAll(path.join(nb.dir, 'artifacts'), 'updatedAt')) {
    scanned.sheets++;
    const base = { kind: 'sheet', id: a.id ?? id, title: a.title, recipe: a.recipe, writtenTo: a.writtenTo };
    arr(a.citations).forEach((c) => { if (c && typeof c === 'object') items.push({ ...base, n: c.n, cite: { ...c } }); });
    walkRefs(a.data, (node) => {
      const label = [node.label, node.title, node.id].find((s) => typeof s === 'string' && s);
      items.push({ ...base, n: null, node: label ? clip(label, 80) : undefined, ref: true, cite: refCite(a, node) });
    });
  }
  for (const { slug, title } of listNotes(nb)) {
    scanned.notes++;
    for (const cite of footnoteSaved(getNote(nb, slug)?.body)) items.push({ kind: 'note', id: slug, title, n: cite.n, cite });
  }
  return { items, scanned };
};

export const savedCitations = (nb) => walk(nb).items;

// files: [{ name, text }]. Returns the report documented in the README.
export function checkNotebook(nb, { files = [] } = {}) {
  const cache = fileCache();
  const { items, scanned } = walk(nb);
  const done = reverify(nb.dir, items.map((x) => x.cite), nb.config.roots, { cache }).citations;
  const r = { notebook: nb.id, checkedAt: new Date().toISOString(), scanned, total: 0, counts: { verified: 0, moved: 0, unverified: 0, missing: 0 }, badAtBirth: 0, worse: [], empty: [] };
  const see = (c, holder) => {
    if (!c || typeof c !== 'object' || !Object.hasOwn(r.counts, c.status)) return;
    r.total++; r.counts[c.status]++;
    if (rank(c.status) > rank(c.status0)) r.worse.push({ file: c.path, status: c.status, was: c.status0, line: c.line ?? null, endLine: c.endLine ?? null, wasLine: c.line0 ?? null, wasEndLine: c.endLine0 ?? null, quote: c.quote ?? null, holder });
    else if (c.status !== 'verified') r.badAtBirth++;
  };
  items.forEach((x, i) => see(done[i], { kind: x.kind, id: x.id, title: x.title, ...(x.turn != null && { turn: x.turn }), ...(x.ref ? { ref: true } : { n: x.n }), ...(x.writtenTo && { writtenTo: x.writtenTo }) }));
  for (const { name, text } of files) {
    r.scanned.files++;
    const cs = footnoteCites(nb, text, cache);
    if (!cs.length) r.empty.push(name);
    for (const c of cs) see(c, { kind: 'file', id: name, title: name, n: c.n });
  }
  return r;
}

// the hits that fail --fail-on <level>: moved means any hit, unverified means current status unverified or missing
export const failing = (r, level) => r.worse.filter((h) => rank(h.status) >= (level === 'unverified' ? 2 : 1));

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const span = (a, b) => (a == null ? '' : b != null && b !== a ? `L${a}-L${b}` : `L${a}`);

const holderText = (h) => {
  if (h.kind === 'answer') return `conversation ${h.id} turn ${h.turn + 1} [^${h.n}]`;
  if (h.kind === 'sheet') return `sheet ${h.id} "${clip(String(h.title ?? ''), 30)}"${h.writtenTo ? ` (written to ${h.writtenTo})` : ''}${h.ref ? ' (data ref)' : ` [^${h.n}]`}`;
  if (h.kind === 'note') return `note ${h.id} [^${h.n}]`;
  return `${h.id} [^${h.n}]`;
};

export function formatReport(r) {
  const k = r.counts, s = r.scanned;
  const out = [
    `check ${r.notebook}: ${plural(s.conversations, 'conversation')}, ${plural(s.sheets, 'sheet')}, ${plural(s.notes, 'note')}, ${plural(s.files, 'file')}, ${plural(r.total, 'citation')}`,
    `${k.verified} verified, ${k.moved} moved, ${k.unverified} unverified, ${k.missing} missing`,
  ];
  const groups = new Map();
  for (const h of r.worse) groups.set(h.file, [...(groups.get(h.file) ?? []), h]);
  for (const file of [...groups.keys()].sort((a, b) => String(a).localeCompare(String(b)))) {
    out.push('', file);
    for (const h of groups.get(file)) {
      const was = h.wasLine != null ? ` at ${span(h.wasLine, h.wasEndLine)}` : '';
      const now = h.status === 'moved' ? ` to ${span(h.line, h.endLine)}` : '';
      out.push(`  was ${h.was}${was}, now ${h.status}${now}  ${holderText(h.holder)}${h.quote ? ` "${clip(h.quote, 50)}"` : ''}`);
    }
  }
  out.push('', r.worse.length ? `${plural(r.worse.length, 'citation')} got worse.` : 'Nothing got worse.');
  if (r.badAtBirth) out.push(`${r.badAtBirth} more ${r.badAtBirth === 1 ? 'was' : 'were'} already moved, unverified or missing when written, and ${r.badAtBirth === 1 ? 'is' : 'are'} not counted.`);
  if (r.empty.length) out.push(`No Lectern footnotes in: ${r.empty.join(', ')}`);
  return out.join('\n');
}
