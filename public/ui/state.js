// Shared app state, a tiny event bus, and normalisers that keep the UI
// tolerant of small differences in server payloads.

import { store } from './dom.js';

export const state = {
  status: null,
  notebooks: [],
  nbId: null,
  nb: null,           // normalised notebook detail
  convId: null,
  conv: null,         // { id, title, turns: [] }
  model: store.get('model', 'opus'),
  streaming: null,    // { controller } while an answer streams
  fileIndex: null,    // [{path, root}] crawled lazily for the palette
  recipes: [],        // Studio recipes for the open notebook
  artifacts: [],      // artifact summaries, newest first
  artifactId: null,   // artifact open on the canvas
};

// ctx holds cross-module actions. app.js fills it in.
export const ctx = {};

const subs = new Map();
export const on = (evt, fn) => { if (!subs.has(evt)) subs.set(evt, new Set()); subs.get(evt).add(fn); };
export const emit = (evt, data) => subs.get(evt)?.forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });

export const GENERATORS = [
  { kind: 'study-guide', label: 'Study guide', desc: 'A structured path through the notebook' },
  { kind: 'faq', label: 'FAQ', desc: 'Questions people actually ask, answered' },
  { kind: 'cheat-sheet', label: 'Cheat sheet', desc: 'One page of the APIs you reach for' },
  { kind: 'porting-guide', label: 'Porting guide', desc: 'From the last version to this one' },
  { kind: 'glossary', label: 'Glossary', desc: 'Every term, defined against the sources' },
  { kind: 'gotchas', label: 'Gotchas', desc: 'Traps, crashes and silent failures' },
];

export const MODELS = [
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
];

// Pastel set shared by notebooks and Studio groups. Fill is for surfaces, strong for
// dots and bars, ink is the AA text color on the fill (the CSS redefines ink for Dusk).
export const PASTELS = {
  peach: { fill: '#FFD8C2', strong: '#F7A27B', ink: '#97401A' },
  lavender: { fill: '#DCD3FF', strong: '#A792FA', ink: '#5135B0' },
  mint: { fill: '#C8F0DC', strong: '#6BCF9F', ink: '#196B44' },
  sky: { fill: '#CFE6FF', strong: '#7BB5F2', ink: '#1A5591' },
  butter: { fill: '#FFF0B8', strong: '#EFC944', ink: '#735300' },
  rose: { fill: '#FFD3E2', strong: '#F28DB2', ink: '#9C2C57' },
};
export const HUES = Object.keys(PASTELS);

export const GROUPS = [
  { id: 'plan', label: 'Plan', hue: 'peach' },
  { id: 'visual', label: 'Visual', hue: 'lavender' },
  { id: 'agent', label: 'Agent', hue: 'mint' },
  { id: 'learn', label: 'Learn', hue: 'sky' },
  { id: 'code', label: 'Code', hue: 'butter' },
];
export const groupHue = (g) => GROUPS.find((x) => x.id === g)?.hue || 'rose';

export const DEFAULT_HUE = 'peach';
export const DEFAULT_COLOR = PASTELS.peach.strong;

const NAMED = {
  amber: 'peach', gold: 'butter', yellow: 'butter', orange: 'peach', red: 'rose', rose: 'rose', coral: 'peach',
  pink: 'rose', purple: 'lavender', violet: 'lavender', indigo: 'lavender', blue: 'sky', sky: 'sky',
  cyan: 'sky', teal: 'mint', emerald: 'mint', green: 'mint', lime: 'mint', slate: 'sky',
  peach: 'peach', lavender: 'lavender', mint: 'mint', butter: 'butter',
};

function hexHue(hex) {
  const m = String(hex).match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return null;
  let x = m[1];
  if (x.length === 3) x = [...x].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 0.08) return 'sky';
  let hh = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hh = (hh * 60 + 360) % 360;
  if (hh < 15 || hh >= 320) return 'rose';
  if (hh < 42) return 'peach';
  if (hh < 70) return 'butter';
  if (hh < 170) return 'mint';
  if (hh < 225) return 'sky';
  return 'lavender';
}

// Notebook colors may be a pastel name, a friendly name or hex; all land on one pastel hue.
export function resolveHue(c) {
  if (!c) return DEFAULT_HUE;
  const k = String(c).trim().toLowerCase();
  return NAMED[k] || hexHue(k) || DEFAULT_HUE;
}
export const resolveColor = (c) => PASTELS[resolveHue(c)].strong;

const pick = (o, ...keys) => { for (const k of keys) if (o?.[k] != null) return o[k]; return undefined; };

export function normNotebookSummary(n) {
  const c = n.counts || {};
  return {
    id: n.id,
    title: n.title || n.name || n.id,
    color: resolveColor(n.color),
    hue: resolveHue(n.color),
    description: n.description || '',
    counts: {
      docs: pick(c, 'docs', 'documents') ?? pick(n, 'docs', 'documents') ?? 0,
      files: pick(c, 'files') ?? pick(n, 'files') ?? 0,
      roots: pick(c, 'roots') ?? (typeof n.roots === 'number' ? n.roots : 0),
      conversations: pick(c, 'conversations') ?? 0,
      notes: pick(c, 'notes') ?? 0,
    },
    tokens: pick(n, 'tokens', 'shelfTokens', 'estTokens', 'estimatedTokens') ?? pick(c, 'tokens') ?? 0,
  };
}

export function normNotebook(d, summary) {
  const cfg = d.config || d.notebook || {};
  const rootsRaw = d.roots ?? cfg.roots ?? {};
  const roots = Array.isArray(rootsRaw)
    ? rootsRaw.map((r) => (typeof r === 'string' ? { name: r, path: cfg.roots?.[r] || r } : { name: r.name, path: r.path || r.dir || cfg.roots?.[r.name] || '', files: r.files, exists: r.exists, own: r.own, branch: r.branch, version: r.version, dirty: r.dirty }))
    : Object.entries(rootsRaw).map(([name, v]) => (typeof v === 'string' ? { name, path: v } : { name, path: v.path || v.dir || '', files: v.files }));
  const shelfRaw = d.shelf ?? d.documents ?? [];
  const shelf = shelfRaw.map((doc) => {
    const files = (doc.files || doc.paths || []).map((f) => (typeof f === 'string' ? f : f.path || f.rel || f.file));
    return { title: doc.title || doc.name || 'documents', files, tokens: doc.tokens };
  });
  const s = summary || {};
  return {
    id: d.id || s.id,
    title: d.title || cfg.title || s.title || d.id,
    color: resolveColor(d.color || cfg.color || s.color),
    hue: resolveHue(d.color || cfg.color || s.color),
    description: d.description || cfg.description || s.description || '',
    dir: d.dir || '',
    pinned: cfg.pinned || d.pinned || [],
    roots,
    shelf,
    conversations: (d.conversations || []).map(normConvSummary).sort((a, b) => (b.updated || '').localeCompare(a.updated || '')),
    notes: (d.notes || []).map(normNote),
    tokens: pick(d, 'tokens', 'shelfTokens', 'estTokens', 'estimatedTokens') ?? s.tokens ?? 0,
    suggestions: d.suggestions || cfg.suggestions || null,
    labels: cfg.labels || {},
  };
}

export function normConvSummary(c) {
  return { id: c.id, title: c.title || 'Untitled', updated: String(c.updated || c.updatedAt || c.mtime || c.created || ''), created: String(c.created || c.updated || ''), turns: typeof c.turns === 'number' ? c.turns : (c.turns?.length ?? null), citations: typeof c.citations === 'number' ? c.citations : null, flag: c.flag || null };
}

export function normNote(n) {
  const slug = n.slug || n.id || (n.path ? n.path.split('/').pop().replace(/\.md$/, '') : n.title);
  return { slug, title: n.title || slug, body: n.body ?? n.text ?? null, updated: n.updated || n.updatedAt || n.created || '', path: n.path || `notes/${slug}.md`, kind: n.kind };
}

export function normTurn(t) {
  return {
    question: t.question ?? t.q ?? '',
    kind: t.kind || t.generator || null,
    answer: t.answer ?? '',
    citations: t.citations || [],
    toolCalls: t.toolCalls || t.tools || [],
    usage: t.usage || null,
    model: t.model || '',
    seconds: t.seconds ?? (t.startedAt && t.endedAt ? (new Date(t.endedAt) - new Date(t.startedAt)) / 1000 : null),
    costUsd: t.costUsd,
    error: t.error || null,
    startedAt: t.startedAt || null,
  };
}

export function normConversation(c) {
  return { id: c.id, title: c.title || 'Untitled', turns: (c.turns || c.messages || []).map(normTurn) };
}

export function normTreeEntries(res) {
  const list = Array.isArray(res) ? res : res.entries || res.items || res.children || [];
  return list.map((e) => {
    if (typeof e === 'string') return { name: e.replace(/\/$/, ''), dir: e.endsWith('/') };
    const dir = e.dir === true || e.type === 'dir' || e.type === 'directory' || e.isDir === true || e.kind === 'dir';
    return { name: e.name, dir, path: e.path };
  }).sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
}

export function tokensOf(usage) {
  if (!usage) return null;
  const inp = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.input || 0);
  const out = (usage.output_tokens || 0) + (usage.output || 0);
  return { inp, out };
}

export const apiEngineAvailable = () => {
  const s = state.status || {};
  return !!(s.apiEngine === true || s.apiEngine?.available || s.api === true || s.api?.available || s.apiAvailable || s.engines?.api);
};
