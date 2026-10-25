// Sources as map layers (DESIGN 3.3), question numbers, and the small Survey glyph helpers.
// The API has no layer or source-kind fields yet, so both are derived here from paths, the
// same way every time, so a source keeps its tint across reloads.

import { h, store, midPath } from './dom.js';
import { state, emit } from './state.js';
export { midPath };

const LAYERS = ['water', 'heath', 'spruce', 'sand', 'moor', 'lichen', 'clay', 'dusk'];
const ORDER = {
  docs: ['water', 'heath', 'dusk'],
  primer: ['heath', 'lichen'],
  root: ['spruce', 'sand', 'lichen', 'clay'],
  repo: ['moor'],
};

const cache = new WeakMap();

// "neoforge-docs" -> "NeoForge docs", borrowing the casing of words in the notebook title
function pretty(slug, title = '') {
  const known = new Map(String(title).split(/[\s/]+/).filter(Boolean).map((w) => [w.toLowerCase(), w]));
  const words = String(slug).split(/[-_\s]+/).filter(Boolean).map((w) => known.get(w.toLowerCase()) || w.toLowerCase());
  if (words.length && words[0] === words[0].toLowerCase()) words[0] = words[0][0].toUpperCase() + words[0].slice(1);
  return words.join(' ');
}

// Pinned docs grouped by the folder they came from; code roots one each.
export function sourcesOf(nb = state.nb) {
  if (!nb) return [];
  if (cache.has(nb)) return cache.get(nb);
  const groups = new Map();
  for (const d of nb.shelf) {
    for (const f of d.files) {
      const seg = f.split('/');
      const base = seg[0] === 'corpus' && seg.length > 2 ? seg.slice(0, 2) : seg.slice(0, 1);
      const pi = seg.indexOf('primers');
      const primer = pi > 0;
      const prefix = (primer ? seg.slice(0, pi + 1) : base).join('/') + '/';
      if (!groups.has(prefix)) {
        const slug = base[base.length - 1];
        const name = primer ? 'Primers' : slug === 'sources' ? 'Saved pages' : slug === 'notes' ? 'Notes' : pretty(slug, nb.title);
        groups.set(prefix, { id: 'd:' + prefix, kind: primer ? 'primer' : 'docs', name, prefix, files: [], path: prefix.slice(0, -1) });
      }
      groups.get(prefix).files.push(f);
    }
  }
  const docs = [...groups.values()];
  const roots = nb.roots.map((r) => ({ id: 'r:' + r.name, kind: r.own ? 'repo' : 'root', name: r.name, root: r, path: r.path, prefix: (r.path || r.name) + '/', count: r.files ?? null, exists: r.exists !== false, branch: r.branch || null, version: r.version || null, dirty: r.dirty ?? null }));
  const used = new Map();
  const take = (kind) => {
    for (const l of ORDER[kind]) if (!used.has(l)) { used.set(l, 1); return { layer: l, dense: false }; }
    // more sources than hues: reuse the least used one with the dense hatch, never a ninth hue
    const l = [...LAYERS].sort((a, b) => (used.get(a) || 0) - (used.get(b) || 0))[0];
    used.set(l, (used.get(l) || 0) + 1);
    return { layer: l, dense: used.get(l) > 1 };
  };
  // saved pages come after primers, so primers keep heath
  const saved = (s) => s.name === 'Saved pages';
  const all = [...docs.filter((s) => s.kind === 'docs' && !saved(s)), ...docs.filter((s) => s.kind === 'primer'), ...docs.filter(saved), ...roots.filter((s) => s.kind === 'root'), ...roots.filter((s) => s.kind === 'repo')];
  for (const s of all) Object.assign(s, take(s.kind));
  for (const s of docs) s.count = s.files.length;
  cache.set(nb, all);
  return all;
}

// Scope (DESIGN 11.4): sources switched off for asking, remembered per notebook by source id.
const scopeKey = () => 'scope.off.' + state.nbId;
export const scopeOff = () => new Set(store.get(scopeKey(), []));
export const inScope = (s) => !scopeOff().has(s.id);
export function toggleScope(s) {
  const off = scopeOff();
  const all = sourcesOf();
  if (off.has(s.id)) off.delete(s.id);
  else if (all.filter((x) => !off.has(x.id)).length > 1) off.add(s.id);
  else return false; // the last source in scope stays on
  store.set(scopeKey(), [...off].filter((id) => all.some((x) => x.id === id)));
  emit('scope');
  return true;
}
// what the ask sends: root names and docs folders in scope, or nothing when everything is
export function scopeForAsk() {
  const all = sourcesOf();
  const on = all.filter(inScope);
  return on.length === all.length ? undefined : on.map((s) => (s.root ? s.name : s.prefix));
}

// A citation or file path to the source it lives in (longest prefix wins).
export function sourceFor(path, nb = state.nb) {
  if (!path) return null;
  let best = null;
  for (const s of sourcesOf(nb)) {
    const prefixes = s.root ? [s.prefix, s.root.name + '/'] : [s.prefix];
    for (const p of prefixes) if (path.startsWith(p) && (!best || p.length > best.len)) best = { s, len: p.length };
  }
  return best?.s || null;
}

export const layerFor = (path) => sourceFor(path)?.layer || null;

// Put data-layer (and data-dense) on an element so it reads --l-* tokens.
export function layerAttrs(src) {
  if (!src) return {};
  return src.dense ? { 'data-layer': src.layer, 'data-dense': '' } : { 'data-layer': src.layer };
}

export function swatch(src, sm = false) {
  return h('span', { class: `swatch${sm ? ' sm' : ''}`, 'aria-hidden': 'true', ...layerAttrs(src) });
}

// Answers are numbered per notebook in the order they were first asked.
export function qnum(convId, nb = state.nb) {
  if (!nb || !convId) return null;
  const sorted = [...nb.conversations].sort((a, b) => String(a.created || a.updated).localeCompare(String(b.created || b.updated)));
  const i = sorted.findIndex((c) => c.id === convId);
  return i < 0 ? null : pad3(i + 1);
}
export const nextQnum = (nb = state.nb) => pad3((nb?.conversations.length || 0) + 1);
export const pad3 = (n) => String(n).padStart(3, '0');

// status words and glyphs (DESIGN 6.1). "missing" is shown as unverified.
export const statusOf = (c) => (c?.status === 'missing' ? 'unverified' : c?.status || 'pending');
export const STATUS_WORD = { verified: 'verified', moved: 'moved', unverified: 'unverified', pending: 'checking' };

export function glyph(status, cls = 'glyph') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '/marks.svg#' + (status === 'missing' ? 'unverified' : status || 'pending'));
  svg.append(use);
  return svg;
}

export const kbd = (...keys) => keys.map((k) => h('kbd', null, k));

// path tail for cards: "networking/payload.md"
export const shortPath = (p, n = 2) => String(p || '').split('/').slice(-n).join('/');

// a path that loses its middle, not its file name, when space runs out (DESIGN 11.7)
// The absolute path of a notebook file, for vscode:// links and trail paths.
export function relPath(p, nb = state.nb) {
  const dir = String(nb?.dir || '').replace(/\\/g, '/').replace(/\/$/, '');
  const s = String(p || '').replace(/\\/g, '/');
  return dir && s.toLowerCase().startsWith(dir.toLowerCase() + '/') ? s.slice(dir.length + 1) : s;
}
