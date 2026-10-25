// Studio: the full-page sheet index (P), the selected recipe's form, printing jobs and printed sheets.
// Sheet numbers are the recipe's place in the recipe table, so every count comes from data.

import { h, clear, icon, toast, store } from './dom.js';
import { api, nbPath, stream } from './api.js';
import { state, ctx, on, emit, GROUPS, groupHue, MODELS } from './state.js';
import { trailSummary } from './chat.js';

const RECIPE_ICON = {
  prd: 'target', 'tech-spec': 'blueprint', 'impl-plan': 'checklist', adr: 'scale', 'test-plan': 'flask',
  'code-map': 'map', 'concept-map': 'bulb', 'flow-diagram': 'flow', 'sequence-diagram': 'seq', 'dependency-graph': 'deps',
  'claude-md': 'bot', 'agents-md': 'bot', skill: 'wand', 'agent-quiz': 'quiz',
  onboarding: 'cap', 'cheat-sheet': 'bolt', 'porting-guide': 'swap', gotchas: 'alert', glossary: 'type', flashcards: 'cards',
  'gap-report': 'split', 'diff-review': 'diff', 'build-x': 'hammer', 'release-notes': 'tag',
};
export const KIND_ICON = { doc: 'file', graph: 'graph', sequence: 'seq', plan: 'checklist', quiz: 'quiz', file: 'code' };
export const KIND_LABEL = { doc: 'Document', graph: 'Graph', sequence: 'Sequence', plan: 'Plan', quiz: 'Quiz', file: 'File' };

export const recipeIcon = (r) => RECIPE_ICON[r?.id] || KIND_ICON[r?.kind] || 'spark';
export const recipeById = (id) => state.recipes.find((r) => r.id === id) || null;
export const hueOf = (recipeId) => groupHue(recipeById(recipeId)?.group);
export const groupLabel = (g) => GROUPS.find((x) => x.id === g)?.label || g || 'Other';

// legacy pastel chip, still used by chat.js
export function blob(name, hue, size = 'md') {
  return h('span', { class: `blob ${size}`, dataset: { hue } }, icon(name, size === 'xs' ? 12 : size === 'sm' ? 14 : 17));
}

// ---------- shared drawing helpers (canvas.js uses these too) ----------

const SVGNS = 'http://www.w3.org/2000/svg';
export function sv(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k);
  return el;
}

// kind glyphs on the 16 grid (DESIGN 7)
const KIND_GLYPH = {
  doc: ['M3.5 2.5H9.5L12.5 5.5V13.5H3.5Z', 'M5.5 8.5H10.5M5.5 11H10.5'],
  graph: ['M2.5 2.5H5.5V5.5H2.5ZM10.5 2.5H13.5V5.5H10.5ZM6.5 10.5H9.5V13.5H6.5Z', 'M5.5 4H10.5M4.5 5.5L7 10.5M11.5 5.5L9 10.5'],
  sequence: ['M3.5 2.5V13.5M12.5 2.5V13.5', 'M3.5 8H11.5M9.5 6L11.5 8L9.5 10'],
  plan: ['M2.5 4.5L4 6L6.5 3.5M8.5 4.75H13.5M2.5 11L4 12.5L6.5 10M8.5 11.25H13.5'],
  quiz: ['M2.5 2.5H13.5V13.5H2.5Z', 'M6.4 6.6A1.6 1.6 0 1 1 8.6 8.1C8.2 8.3 8 8.6 8 9.1V9.6', 'M8 10.75V12.25'],
  file: ['M3.5 2.5H9.5L12.5 5.5V13.5H3.5Z', 'M7 8.25L5.5 9.75L7 11.25M9 8.25L10.5 9.75L9 11.25'],
};
export function kindGlyph(kind, size = 16) {
  return sv('svg', { viewBox: '0 0 16 16', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', 'aria-hidden': 'true', class: 'kglyph' },
    (KIND_GLYPH[kind] || KIND_GLYPH.doc).map((d) => sv('path', { d })));
}

// status glyph from the marks sprite: verified, moved, unverified, pending, mark
export function mark(name, cls = 'glyph sm') {
  return sv('svg', { viewBox: '0 0 16 16', class: cls, 'aria-hidden': 'true' }, sv('use', { href: `/marks.svg#${name}` }));
}

export const pad2 = (n) => String(n).padStart(2, '0');
export const sheetNo = (recipeId) => {
  const i = state.recipes.findIndex((r) => r.id === recipeId);
  return i < 0 ? null : pad2(i + 1);
};
export const plural = (n, word) => `${n} ${n === 1 ? word.replace(/s$/, '') : word}`;

export function agoWord(t) {
  const d = new Date(t);
  if (!t || isNaN(d)) return '';
  const s = (Date.now() - d) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (d >= today) return `${Math.floor(s / 3600)}h ago`;
  if (d >= new Date(today - 86400000)) return 'yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// citation status counts from a full citation list or the list summary's `cites`
export function citeCounts(a) {
  if (a?.cites && typeof a.cites === 'object') return { verified: a.cites.verified || 0, moved: a.cites.moved || 0, unverified: a.cites.unverified || 0 };
  const out = { verified: 0, moved: 0, unverified: 0 };
  if (Array.isArray(a?.citations)) for (const c of a.citations) if (out[c.status] != null) out[c.status]++;
  return out;
}
export const citeTotal = (a) => (Array.isArray(a?.citations) ? a.citations.length : Number(a?.citations) || 0);

// what a sheet is made of, from the list summary's `size` or the full artifact
export function sheetSize(a) {
  if (Array.isArray(a?.size)) return a.size;
  const d = a?.data || {};
  const len = (x) => (Array.isArray(x) ? x.length : 0);
  switch (a?.kind) {
    case 'doc': return a.markdown != null ? [{ n: (String(a.markdown).match(/^## /gm) || []).length, unit: 'sections' }] : [];
    case 'graph': return a.data ? [{ n: len(d.nodes), unit: 'nodes' }, { n: len(d.edges), unit: 'edges' }] : [];
    case 'sequence': return a.data ? [{ n: len(d.actors), unit: 'actors' }, { n: len(d.steps), unit: 'steps' }] : [];
    case 'plan': return a.data ? [{ n: len(d.phases), unit: 'phases' }, { n: (d.phases || []).reduce((n, p) => n + len(p?.tasks), 0), unit: 'tasks' }] : [];
    case 'quiz': return a.data ? [{ n: len(d.questions), unit: a.recipe === 'flashcards' ? 'cards' : 'questions' }] : [];
    case 'file': return d.content ? [{ n: String(d.content).split('\n').length, unit: 'lines' }] : [];
    default: return [];
  }
}
export const sizeText = (a, max = 2) => sheetSize(a).slice(0, max).map((x) => plural(x.n, x.unit));

// Seeded closed contour rings, nested and never crossing (DESIGN 6.3). Returns path strings.
function rng(seed) {
  let t = seed >>> 0;
  return () => { t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}
export function contourRings({ cx, cy, rings = 7, base = 24, step = 14, stretch = 1.5, seed = 1, wobble = 0.16 }) {
  const rand = rng(seed * 9973 + 17);
  const waves = [2, 3, 5].map((k) => ({ k, a: wobble * (0.5 + rand()) / k * 1.6, p: rand() * Math.PI * 2, drift: (rand() - 0.5) * 0.5 }));
  const out = [];
  for (let i = 0; i < rings; i++) {
    const r0 = base + i * step;
    let d = '';
    const N = 72;
    for (let j = 0; j <= N; j++) {
      const th = (j / N) * Math.PI * 2;
      let f = 1;
      for (const w of waves) f += w.a * Math.sin(w.k * th + w.p + w.drift * i);
      const r = r0 * f;
      d += `${j ? 'L' : 'M'}${(cx + Math.cos(th) * r * stretch).toFixed(1)} ${(cy + Math.sin(th) * r).toFixed(1)}`;
    }
    out.push(d + 'Z');
  }
  return out;
}

// append that skips null and false, which native append would print as text
export const put = (el, ...kids) => { el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false)); return el; };

export function segbar(done, total, cur = null, wide = false) {
  return h('span', { class: `segbar${wide ? ' fill' : ''}`, 'aria-hidden': 'true' },
    Array.from({ length: total }, (_, i) => h('i', { class: i < done ? 'on' : cur != null && i === cur - 1 && i >= done ? 'cur' : null })));
}

// ---------- module state ----------

let root, headEl, subEl, bodyEl, detailEl, jobsEl, printedEl, filterIn, viewSeg;
let view = store.get('studioView', 'index');   // index | list
let query = '';
let selId = null;
let digitBuf = '', digitTimer = null;
const drafts = new Map();    // recipeId -> form values kept while another sheet is selected
const jobs = new Map();      // recipeId -> PrintJob
const finishing = new Set(); // recipe ids whose cell just finished printing
let landedId = null;         // printed sheet row that just slid in

const unseenKey = () => `studio.unseen.${state.nbId}`;
const unseen = () => new Set(store.get(unseenKey(), []));
export function markSeen(id) {
  const s = unseen();
  if (s.delete(id)) { store.set(unseenKey(), [...s]); if (root) { drawBody(); drawPrinted(); } }
}

export const studioOpen = () => !!document.getElementById('app')?.classList.contains('studio-view');

export function initStudio(el) {
  root = el;
  filterIn = h('input', { class: 'input sv-filter-in', type: 'search', placeholder: 'Type to filter', 'aria-label': 'Filter sheets', autocomplete: 'off', spellcheck: 'false',
    oninput: () => { query = filterIn.value.trim().toLowerCase(); drawBody(); } });
  viewSeg = h('div', { class: 'segmented sv-viewseg', role: 'radiogroup', 'aria-label': 'Sheet index view' });
  headEl = h('div', { class: 'sv-head' });
  subEl = h('div', { class: 'sv-sub' });
  bodyEl = h('div', { class: 'sv-body' });
  detailEl = h('section', { class: 'sv-detail', 'aria-label': 'Selected sheet' });
  jobsEl = h('section', { class: 'sv-jobs', 'aria-label': 'Printing', 'aria-live': 'polite' });
  printedEl = h('section', { class: 'sv-printed', 'aria-label': 'Printed sheets' });
  clear(root).append(h('div', { class: 'sv' },
    h('section', { class: 'sv-main', 'aria-label': 'Sheet index' }, headEl, subEl, bodyEl),
    h('div', { class: 'sv-side' }, detailEl, jobsEl, printedEl)));
  root.classList.add('survey-studio');
  root.addEventListener('keydown', studioKeys);

  // Studio is a full view in the page area, not a column (DESIGN 0.3, 5.2)
  Object.assign(ctx, {
    toggleStudio: (force) => setStudio(force ?? !studioOpen()),
    studioShown: studioOpen,
  });
  document.addEventListener('keydown', globalP);
  for (const ev of ['conversation', 'artifacts', 'notebook', 'studio']) on(ev, drawCrumb);
  on('notebook', load);
  on('artifacts', () => { drawBody(); drawPrinted(); drawSub(); });
  on('refresh', () => { drawBody(); drawDetail(); });
  document.getElementById('tb-run')?.addEventListener('click', () => { const id = jobs.keys().next().value; if (id) openRecipe(id); });
  window.matchMedia('(max-width: 1023px)').addEventListener('change', () => drawBody());
  draw();
}

function setStudio(open, { focus = true } = {}) {
  const app = document.getElementById('app');
  app.classList.remove('studio-closed', 'studio-float');
  if (open === studioOpen()) { root.inert = !open; if (open && focus) focusSel(); return; }
  if (open && document.getElementById('center')?.classList.contains('show-canvas')) {
    // P from a sheet selects that sheet's recipe
    const a = state.artifacts.find((x) => x.id === state.artifactId);
    if (a && recipeById(a.recipe)) selId = a.recipe;
    ctx.closeCanvas?.({ keepHash: true });
  }
  app.classList.toggle('studio-view', open);
  root.inert = !open;
  emit('studio', open);
  if (open) { draw(); if (focus) focusSel(); }
  else if (!document.getElementById('center')?.classList.contains('show-canvas')) document.querySelector('#chat textarea')?.focus({ preventScroll: true });
}


// chrome.js draws the conversation crumb; Studio and sheets add their own after it
function drawCrumb() {
  const crumb = document.getElementById('tb-crumb');
  if (!crumb) return;
  const a = state.artifactId ? state.artifacts.find((x) => x.id === state.artifactId) : null;
  if (!studioOpen() && !a) return;
  const link = h('a', { href: '#', class: 'lbl sv-crumb-link', onclick: (e) => { e.preventDefault(); setStudio(true); } }, 'Studio');
  if (studioOpen()) crumb.replaceChildren(icon('chev', 12), link, h('span', { class: 'lbl' }, ' · sheet index'));
  else {
    const no = sheetNo(a.recipe);
    put(clear(crumb), icon('chev', 12), link, icon('chev', 12), no ? h('span', { class: 'qnum' }, no) : null, h('span', { class: 'lbl' }, a.title || 'Sheet'));
  }
}

function globalP(e) {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== 'p') return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  if (document.querySelector('dialog[open], .palette, .menu') || document.documentElement.classList.contains('drawer-open')) return;
  e.preventDefault();
  setStudio(!studioOpen());
}

async function load() {
  const nbId = state.nbId;
  state.recipes = [];
  state.artifacts = [];
  drafts.clear();
  selId = null;
  draw(true);
  const [rec, arts] = await Promise.allSettled([api.get(nbPath(nbId, '/studio')), api.get(nbPath(nbId, '/artifacts'))]);
  if (state.nbId !== nbId) return;
  if (rec.status === 'fulfilled') {
    state.recipes = normRecipes(rec.value);
    state.studioMeta = { exports: rec.value?.exports || null, models: rec.value?.models || null };
    state.studioError = null;
  } else state.studioError = rec.reason?.message || 'no recipes';
  if (arts.status === 'fulfilled') state.artifacts = normArtifactList(arts.value);
  const saved = store.get('studio.sel', null);
  selId = state.recipes.some((r) => r.id === saved) ? saved : state.recipes[0]?.id || null;
  draw();
  emit('artifacts');
  emit('recipes');
}

export async function reloadArtifacts() {
  try { state.artifacts = normArtifactList(await api.get(nbPath(state.nbId, '/artifacts'))); emit('artifacts'); }
  catch (e) { toast(e.message); }
}

// short sheet names and cell blurbs from SCREENS 2; the server's longer text stays for the detail panel
const SHORT = {
  prd: ['PRD', 'Problem, users, goals, checked against the sources'],
  'tech-spec': ['Tech spec', 'How it will be built, from a PRD or an idea'],
  'impl-plan': ['Build plan', 'Phases and tasks with files and checks'],
  adr: ['ADR', 'One decision, its options and why'],
  'test-plan': ['Test plan', 'What to test and how to know it passed'],
  'code-map': ['Code map', "Graph of the codebase's main parts"],
  'concept-map': ['Concept map', 'How the ideas in the sources connect'],
  'flow-diagram': ['Flow diagram', 'Trace how something happens, step by step'],
  'sequence-diagram': ['Sequence diagram', 'Who calls whom, in order'],
  'dependency-graph': ['Dependency graph', 'Imports between packages, cycles marked'],
  'claude-md': ['CLAUDE.md', 'Project memory for Claude Code'],
  'agents-md': ['AGENTS.md', 'Instructions for any coding agent'],
  skill: ['Skill', 'A SKILL.md with valid frontmatter'],
  'agent-quiz': ['Agent quiz', 'Questions an agent must answer from the sources'],
  onboarding: ['Onboarding', 'First day in this codebase'],
  'cheat-sheet': ['Cheat sheet', 'One page of the things you look up'],
  'porting-guide': ['Porting guide', 'From one version to another'],
  gotchas: ['Gotchas', 'What bites, with the right way cited'],
  glossary: ['Glossary', 'Terms and where they are defined'],
  flashcards: ['Flashcards', 'Cards to drill the essentials'],
  'gap-report': ['Gap report', 'Where the code and the docs disagree'],
  'diff-review': ['Diff review', 'Findings on a diff, ranked'],
  'build-x': ['Build X here', "How to build something using this codebase's patterns"],
  'release-notes': ['Release notes', 'From a git log'],
};

// the shorter cell text the Studio board prints, so cells read without ellipses; SCREENS text stays as the tooltip
const CELL = {
  prd: 'Problem, users and goals, cited', 'tech-spec': 'How it gets built, from a PRD', 'impl-plan': 'Phases and tasks, checked',
  adr: 'One decision and why it won', 'test-plan': 'What to test and what passes', 'code-map': 'The main parts and their links',
  'concept-map': 'How the ideas in it connect', 'flow-diagram': 'How it happens, in steps', 'sequence-diagram': 'Who calls whom, in order',
  'dependency-graph': 'Package imports, cycles marked', 'claude-md': 'Project memory for Claude Code', 'agents-md': 'Rules for any coding agent',
  skill: 'A SKILL.md with valid frontmatter', 'agent-quiz': 'Questions an agent must pass', onboarding: 'First day in this codebase',
  'cheat-sheet': 'One page of what you look up', 'porting-guide': 'From one version to the next', gotchas: 'What bites, and the cited fix',
  glossary: 'Terms and where each is defined', flashcards: 'Cards to drill the essentials', 'gap-report': 'Where code and docs disagree',
  'diff-review': 'Findings on a diff, ranked', 'build-x': "Build it with this repo's patterns", 'release-notes': 'Notes written from a git log',
};

function normRecipes(r) {
  let list = Array.isArray(r) ? r : r.recipes || [];
  if (!list.length && Array.isArray(r.groups) && r.groups[0]?.recipes) list = r.groups.flatMap((g) => g.recipes.map((x) => ({ group: g.id, ...x })));
  return list.map((x) => {
    const blurb = x.blurb || x.description || '';
    const [title, short] = SHORT[x.id] || [x.title, blurb];
    return { ...x, inputs: x.inputs || [], title, longTitle: x.title, blurb, short, cell: CELL[x.id] || short };
  });
}

export function normArtifactList(r) {
  const list = Array.isArray(r) ? r : r.artifacts || r.items || [];
  return list.map((a) => ({ ...a, status: a.status || 'ok', createdAt: a.createdAt || a.created || '' }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// ---------- drawing ----------

function draw(loading = false) {
  if (!root) return;
  drawHead(); drawSub(); drawBody(loading); drawDetail(); drawJobs(); drawPrinted(loading);
}

function drawHead() {
  viewSeg.replaceChildren(...[['index', 'Index', 'grid'], ['list', 'List', 'menu']].map(([v, label, ic]) =>
    h('button', { type: 'button', role: 'radio', 'aria-checked': String(view === v), onclick: () => setViewMode(v) }, icon(ic, 13), label)));
  if (headEl.childNodes.length) return;
  headEl.append(
    h('h2', { class: 't-kicker sv-kicker' }, 'Studio · sheet index'),
    h('span', { class: 'grow' }),
    h('div', { class: 'sv-viewbox' }, viewSeg, h('kbd', { title: 'Toggle view' }, 'V')),
    h('label', { class: 'sv-filter' }, icon('search', 14), filterIn));
}

function setViewMode(v) {
  view = v;
  store.set('studioView', v);
  drawHead(); drawBody();
}

function drawSub() {
  if (!subEl) return;
  const n = state.recipes.length;
  const printed = state.artifacts.filter((a) => a.status === 'ok').length;
  clear(subEl).append(
    h('p', { class: 'sv-blurb' }, n ? `Print the notebook as one of ${n} sheets. Every sheet keeps its citations.` : state.studioError ? `Studio is not available: ${state.studioError}` : 'Loading the sheet index.'),
    h('span', { class: 'sv-stats t-mono-sm' }, n ? [plural(n, 'recipes'), `${printed} printed`, jobs.size ? `${jobs.size} printing` : null].filter(Boolean).join(' · ') : ''));
}

const matches = (r) => !query || [r.title, r.longTitle, r.id, r.short, groupLabel(r.group)].some((x) => String(x || '').toLowerCase().includes(query));

function latestByRecipe() {
  const m = new Map();
  for (const a of state.artifacts) if (!m.has(a.recipe)) m.set(a.recipe, a);
  return m;
}

function needsOf(r) {
  const lbl = { root: 'root', diff: 'diff', gitlog: 'git log' };
  const req = r.inputs.filter((i) => i.required && lbl[i.type]);
  return req.length ? `needs ${req.map((i) => lbl[i.type]).join(', ')}` : '';
}

// a required input this notebook cannot supply
function blockedBy(r) {
  if (!state.nb || state.nb.roots?.length) return '';
  if (r.inputs.some((i) => i.required && i.type === 'gitlog')) return 'needs a git root';
  if (r.inputs.some((i) => i.required && i.type === 'root')) return 'needs a code root';
  return '';
}

function orderedGroups() {
  const known = GROUPS.map((g) => g.id);
  const seen = [];
  for (const r of state.recipes) if (!seen.includes(r.group)) seen.push(r.group);
  return seen.sort((a, b) => (known.indexOf(a) + 1 || 99) - (known.indexOf(b) + 1 || 99));
}

const listMode = () => view === 'list' || window.matchMedia('(max-width: 1023px)').matches;

function drawBody(loading = false) {
  if (!root) return;
  root.dataset.view = listMode() ? 'list' : 'index';
  if (!state.recipes.length) {
    clear(bodyEl).append(h('div', { class: 'sv-frame sv-frame-empty' }, contourBack(800, 520, 3),
      h('p', { class: 't-ui-sm' }, loading || !state.studioError ? 'Loading the sheet index.' : `Studio is not available: ${state.studioError}`)));
    return;
  }
  const latest = latestByRecipe();
  const fresh = unseen();
  if (listMode()) drawList(latest, fresh);
  else drawGrid(latest, fresh);
}

function cellState(r, latest, fresh) {
  const job = jobs.get(r.id);
  const last = latest.get(r.id);
  return {
    job,
    unseen: !job && last && last.status === 'ok' && fresh.has(last.id),
    failed: !job && last && last.status !== 'ok',
    blocked: blockedBy(r),
    hidden: !matches(r),
  };
}

function drawGrid(latest, fresh) {
  const cells = [];
  for (const g of orderedGroups()) {
    const list = state.recipes.filter((r) => r.group === g);
    list.forEach((r, i) => cells.push(cell(r, state.recipes.indexOf(r) + 1, i === 0 ? { label: groupLabel(g), count: list.length } : null, cellState(r, latest, fresh))));
  }
  const grid = h('div', { class: 'sv-grid', role: 'grid', 'aria-label': `Sheet index, ${plural(cells.length, 'recipes')}` }, cells);
  clear(bodyEl).append(h('div', { class: 'sv-frame' }, contourBack(900, 640, 7), grid));
}

function cell(r, num, tab, st) {
  const sel = r.id === selId;
  const p = st.job?.progress();
  const bottom = st.job
    ? h('span', { class: 'sc-run t-mono-sm' }, p.text)
    : st.failed ? h('span', { class: 'sc-fail t-mono-sm' }, 'Last run failed')
      : h('span', { class: 'sc-needs t-mono-sm' }, st.blocked || needsOf(r));
  const label = [`${pad2(num)} ${r.title}.`, r.short, st.job ? `Printing, ${p.text}.` : '', st.unseen ? 'New sheet, not opened yet.' : '', st.failed ? 'Last run failed.' : '', st.blocked ? `Disabled, ${st.blocked}.` : ''].filter(Boolean).join(' ');
  return h('button', {
    type: 'button', role: 'gridcell',
    class: `sc${sel ? ' sel' : ''}${st.job ? ' running' : ''}${st.hidden ? ' out' : ''}${st.blocked ? ' blocked' : ''}${finishing.has(r.id) ? ' finished' : ''}`,
    dataset: { group: r.group, recipe: r.id }, 'aria-label': label, 'aria-selected': String(sel), tabindex: sel && !st.hidden ? '0' : '-1',
    'aria-disabled': st.hidden ? 'true' : null, title: st.blocked ? `${r.title} ${st.blocked}. Add one from the rail.` : null,
    onclick: () => { if (!st.hidden) select(r.id); },
    ondblclick: () => { if (!st.hidden) openForm(r.id); },
  },
  h('span', { class: 'sc-band', 'aria-hidden': 'true' }, tab ? h('span', { class: 'sc-tab' }, h('span', { class: 'sc-tabl' }, tab.label), h('span', { class: 'sc-tabn' }, String(tab.count))) : null),
  st.job && p.frac != null ? trace(p.frac) : finishing.has(r.id) ? trace(1) : null,
  h('span', { class: 'sc-corner' },
    st.job ? h('span', { class: 'sc-dot run', title: 'Printing' }) : st.unseen ? h('span', { class: 'sc-dot new', title: 'New, not opened' }) : null,
    kindGlyph(r.kind)),
  h('span', { class: 'sc-body' },
    h('span', { class: 'sc-num' }, pad2(num)),
    h('span', { class: 'sc-title' }, r.title),
    h('span', { class: 'grow' }),
    h('span', { class: 'sc-blurb', title: r.short }, r.cell),
    bottom));
}

// neatline trace: a determinate progress line around the running cell (DESIGN 8.2)
function trace(frac) {
  return sv('svg', { class: 'sc-trace', 'aria-hidden': 'true' },
    sv('rect', { class: 'sc-trace-bed', pathLength: 100 }),
    sv('rect', { class: 'sc-trace-ink', pathLength: 100, 'stroke-dasharray': `${(Math.max(0, Math.min(1, frac)) * 100).toFixed(1)} 100` }));
}

function contourBack(w, hgt, seed) {
  const rings = [
    contourRings({ cx: w * 0.8, cy: hgt * 0.18, rings: 10, base: 16, step: 22, stretch: 1.6, seed }),
    contourRings({ cx: w * 0.1, cy: hgt * 0.9, rings: 8, base: 20, step: 24, stretch: 1.3, seed: seed + 5 }),
  ].flat();
  return sv('svg', { class: 'sv-contour', viewBox: `0 0 ${w} ${hgt}`, preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' }, rings.map((d) => sv('path', { d })));
}

function drawList(latest, fresh) {
  const out = h('div', { class: 'sv-list', role: 'listbox', 'aria-label': 'Sheet contents' });
  for (const g of orderedGroups()) {
    const list = state.recipes.filter((r) => r.group === g);
    out.append(h('div', { class: 'sl-group', dataset: { group: g } }, h('span', { class: 'swatch', 'aria-hidden': 'true' }), h('span', { class: 't-kicker' }, groupLabel(g)), h('span', { class: 't-mono-sm' }, String(list.length))));
    for (const r of list) {
      const st = cellState(r, latest, fresh);
      const sel = r.id === selId;
      const p = st.job?.progress();
      out.append(h('button', {
        type: 'button', role: 'option', class: `sl-row${sel ? ' sel' : ''}${st.hidden ? ' out' : ''}${st.blocked ? ' blocked' : ''}`, dataset: { group: r.group, recipe: r.id },
        'aria-selected': String(sel), tabindex: sel && !st.hidden ? '0' : '-1', 'aria-disabled': st.hidden ? 'true' : null, title: st.blocked || r.blurb || null,
        onclick: () => { if (!st.hidden) select(r.id); }, ondblclick: () => { if (!st.hidden) openForm(r.id); },
      },
      h('span', { class: 'sl-num t-mono-sm' }, sheetNo(r.id)),
      h('span', { class: 'sl-title' }, r.title),
      st.unseen ? h('span', { class: 'sc-dot new', title: 'New, not opened' }) : null,
      h('span', { class: 'sl-leader', 'aria-hidden': 'true' }),
      st.job ? h('span', { class: 'sl-run t-mono-sm' }, h('span', { class: 'sc-dot run' }), p.total ? segbar(p.done, p.total, p.cur) : null, p.text) : null,
      st.failed ? h('span', { class: 'sc-fail t-mono-sm' }, 'failed') : null,
      h('span', { class: 'sl-kind t-mono-sm' }, r.kind),
      h('span', { class: 'sl-needs t-mono-sm' }, st.blocked || needsOf(r))));
    }
  }
  clear(bodyEl).append(out);
}

function select(id, { focus = true } = {}) {
  selId = id;
  store.set('studio.sel', id);
  drawBody(); drawDetail();
  if (focus) focusSel();
}

function focusSel() {
  requestAnimationFrame(() => bodyEl.querySelector('[aria-selected="true"]:not(.out)')?.focus());
}

function openForm(id) {
  select(id, { focus: false });
  requestAnimationFrame(() => detailEl.querySelector('input:not([type=hidden]), textarea, select:not(.sv-model), .btn.primary')?.focus());
}

// Open a recipe's form from elsewhere (empty state, "/" menu, palette, next-step chips, the top-bar chip).
export function openRecipe(id, prefill = null) {
  const r = recipeById(id);
  if (!r) { toast(`Unknown recipe ${id}`); return; }
  if (prefill) drafts.set(id, { ...(drafts.get(id) || {}), ...prefill });
  query = '';
  if (filterIn) filterIn.value = '';
  selId = id;
  setStudio(true, { focus: false });
  draw();
  openForm(id);
}

// ---------- keyboard (DESIGN 10, Studio rows) ----------

function studioKeys(e) {
  if (e.defaultPrevented || document.documentElement.classList.contains('drawer-open')) return;
  const t = e.target;
  const mod = e.ctrlKey || e.metaKey || e.altKey;
  if (t === filterIn) {
    if (e.key === 'Escape') { e.preventDefault(); if (filterIn.value) { filterIn.value = ''; query = ''; drawBody(); } focusSel(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); firstMatch(); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = firstMatch(); if (r) openForm(r.id); }
    return;
  }
  if (t.closest('.sv-side')) {
    if (e.key === 'Escape' && t.closest('.sv-detail')) { e.preventDefault(); focusSel(); }
    return;
  }
  if (t.closest('input, textarea, select')) return;
  const visible = state.recipes.filter(matches);
  const i = visible.findIndex((r) => r.id === selId);
  const grid = bodyEl.querySelector('.sv-grid');
  const cols = listMode() || !grid ? 1 : getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
  if (move && !mod) {
    e.preventDefault();
    if (!visible.length) return;
    if (cols > 1 && !query) {
      // the grid follows sheet order, so up and down keep the column
      const k = state.recipes.findIndex((r) => r.id === selId) + move;
      if (k >= 0 && k < state.recipes.length) select(state.recipes[k].id);
      return;
    }
    select(visible[Math.max(0, Math.min(visible.length - 1, i < 0 ? 0 : i + Math.sign(move)))].id);
    return;
  }
  if (e.key === 'Enter' && !mod) { e.preventDefault(); if (selId) openForm(selId); return; }
  if (e.key === 'Escape') { e.preventDefault(); setStudio(false); return; }
  if (mod || e.key.length !== 1) return;
  // P and ? work everywhere (DESIGN 10), so they are not filter text while the filter is empty
  if (e.key === '?') { e.preventDefault(); ctx.openShortcuts?.(); return; }
  if (!query && e.key.toLowerCase() === 'p') { e.preventDefault(); setStudio(false); return; }
  if (/\d/.test(e.key)) {
    e.preventDefault();
    digitBuf += e.key;
    clearTimeout(digitTimer);
    if (digitBuf.length === 2) {
      const r = state.recipes[Number(digitBuf) - 1];
      digitBuf = '';
      if (r) { query = ''; filterIn.value = ''; select(r.id); }
    } else digitTimer = setTimeout(() => { digitBuf = ''; }, 900);
    return;
  }
  if (e.key.toLowerCase() === 'v') { e.preventDefault(); setViewMode(view === 'index' ? 'list' : 'index'); focusSel(); return; }
  if (/\S/.test(e.key)) {
    // typing filters: hand the key to the filter field
    e.preventDefault();
    filterIn.focus();
    filterIn.value += e.key;
    query = filterIn.value.trim().toLowerCase();
    drawBody();
  }
}

function firstMatch() {
  const r = state.recipes.find(matches);
  if (r) select(r.id, { focus: false });
  return r;
}

// ---------- recipe form (DESIGN 11.20) ----------

function rootSelect(value, onchange, label, id) {
  const roots = state.nb?.roots || [];
  return h('select', { class: 'select', id, 'aria-label': label, onchange: (e) => onchange(e.target.value) },
    h('option', { value: '' }, roots.length ? 'Pick a root' : 'No roots in this notebook'),
    roots.map((x) => h('option', { value: x.name, selected: x.name === value }, x.name)));
}

function inputField(spec, vals) {
  const id = `in-${spec.name}`;
  const set = (v) => { vals[spec.name] = v; };
  const v = vals[spec.name];
  const label = h('div', { class: 'ff-label' }, h('label', { class: 'field-label', for: id }, spec.label || spec.name), spec.required ? h('span', { class: 't-mono-sm ff-req' }, 'required') : null);
  let control;
  switch (spec.type) {
    case 'longtext':
      control = h('textarea', { id, class: 'textarea', rows: 3, placeholder: spec.placeholder || '', oninput: (e) => set(e.target.value) }, typeof v === 'string' ? v : '');
      break;
    case 'root':
      if (!v && spec.required && state.nb?.roots.length === 1) set(state.nb.roots[0].name);
      control = rootSelect(vals[spec.name], set, spec.label, id);
      break;
    case 'artifact': {
      const from = spec.from?.length && !spec.from.includes('*') ? new Set(spec.from) : null;
      const opts = state.artifacts.filter((a) => a.status === 'ok' && (!from || from.has(a.recipe)));
      control = h('select', { id, class: 'select', onchange: (e) => set(e.target.value) },
        h('option', { value: '' }, opts.length ? 'None' : `No ${spec.from?.map((x) => recipeById(x)?.title || x).join(' or ') || 'sheets'} yet`),
        opts.map((a) => h('option', { value: a.id, selected: a.id === v }, `${a.title} · sheet ${sheetNo(a.recipe) || '?'} · ${agoWord(a.createdAt)}`)));
      if (!opts.length) control.disabled = true;
      break;
    }
    case 'diff':
    case 'gitlog': {
      const isDiff = spec.type === 'diff';
      let mode = isDiff ? (v && typeof v === 'object' ? 'range' : 'paste') : 'range';
      const box = h('div', { class: 'ff-stack' });
      const drawBox = () => {
        clear(box);
        if (isDiff) {
          box.append(h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Diff source' },
            [['paste', 'Paste'], ['range', 'From git']].map(([m, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(mode === m), onclick: () => { mode = m; set(m === 'paste' ? '' : { root: '', range: '' }); drawBox(); } }, l))));
        }
        if (mode === 'paste') {
          box.append(h('textarea', { id, rows: 5, class: 'textarea mono', placeholder: 'Paste a unified diff', oninput: (e) => set(e.target.value) }, typeof vals[spec.name] === 'string' ? vals[spec.name] : ''));
        } else {
          const cur = (vals[spec.name] && typeof vals[spec.name] === 'object') ? vals[spec.name] : { root: '', range: '' };
          if (!cur.root && state.nb?.roots.length === 1) cur.root = state.nb.roots[0].name;
          set(cur);
          box.append(h('div', { class: 'ff-row' }, rootSelect(cur.root, (x) => { cur.root = x; }, 'Repository root', id),
            h('input', { type: 'text', class: 'input mono', 'aria-label': 'Git range', placeholder: isDiff ? 'HEAD~5..HEAD' : 'v1.2.0..HEAD', value: cur.range || '', oninput: (e) => { cur.range = e.target.value; } })));
        }
      };
      drawBox();
      control = box;
      break;
    }
    default:
      control = h('input', { id, type: 'text', class: `input${spec.type === 'path' ? ' mono' : ''}`, placeholder: spec.placeholder || '', value: typeof v === 'string' ? v : '', oninput: (e) => set(e.target.value) });
  }
  return h('div', { class: 'ff' }, label, control);
}

const filled = (v) => v != null && v !== '' && !(typeof v === 'object' && (!v.root || !v.range));

function missing(r, vals) {
  for (const s of r.inputs) if (s.required && !filled(vals[s.name])) return s;
  if (Array.isArray(r.needsOne) && r.needsOne.length && !r.needsOne.some((n) => filled(vals[n]))) return r.inputs.find((s) => s.name === r.needsOne[0]) || null;
  return null;
}

function drawDetail() {
  if (!detailEl) return;
  const r = recipeById(selId);
  clear(detailEl);
  if (!r) return;
  const vals = drafts.get(r.id) || {};
  drafts.set(r.id, vals);
  const last = latestByRecipe().get(r.id);
  const blocked = blockedBy(r);
  const job = jobs.get(r.id);
  let model = vals.__model || r.model || state.model || 'sonnet';
  if (model === 'api') model = 'opus';
  const modelSel = h('select', { class: 'select sv-model', 'aria-label': 'Model', onchange: (e) => { vals.__model = e.target.value; } },
    MODELS.map((m) => h('option', { value: m.id, selected: m.id === model }, m.label)));
  const go = h('button', { class: 'btn primary', type: 'submit', disabled: !!job || !!blocked }, job ? 'Printing' : 'Print sheet', job ? null : h('span', { class: 'keys' }, h('kbd', null, 'Ctrl'), h('kbd', null, 'Enter')));
  const f = h('form', { class: 'sv-form', novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    if (jobs.has(r.id) || blocked) return;
    f.querySelectorAll('.ff.invalid').forEach((w) => { w.classList.remove('invalid'); w.querySelector('.field-error')?.remove(); });
    f.querySelectorAll('[aria-invalid]').forEach((x) => x.removeAttribute('aria-invalid'));
    const miss = missing(r, vals);
    if (miss) {
      const fld = f.querySelector(`#in-${miss.name}`);
      const wrap = fld?.closest('.ff');
      const msg = !miss.required && r.needsOne?.includes(miss.name) ? `Fill in ${r.needsOne.map((n) => r.inputs.find((s) => s.name === n)?.label || n).join(' or ')}` : `${miss.label || miss.name} is required`;
      if (!wrap) { toast(msg, 'info', 2400); return; }
      wrap.classList.add('invalid');
      wrap.append(h('div', { class: 'field-error', role: 'alert', id: `err-${miss.name}` }, msg));
      fld.setAttribute('aria-invalid', 'true');
      fld.setAttribute('aria-describedby', `err-${miss.name}`);
      fld.focus();
      return;
    }
    const inputs = {};
    for (const s of r.inputs) if (filled(vals[s.name])) inputs[s.name] = vals[s.name];
    generate(r, inputs, modelSel.value);
  } },
  r.inputs.length ? r.inputs.map((s) => inputField(s, vals)) : h('p', { class: 'sv-noinput t-ui-sm' }, 'No inputs needed. It reads the whole notebook.'),
  h('div', { class: 'sv-form-foot' }, h('label', { class: 'sv-model-l t-ui-sm' }, 'Model', modelSel), h('span', { class: 'grow' }), go));
  f.addEventListener('input', unmark);
  f.addEventListener('change', unmark);
  f.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); f.requestSubmit(); } });
  detailEl.dataset.group = r.group;
  put(detailEl,
    h('div', { class: 'sv-detail-top' },
      h('span', { class: 't-kicker' }, h('span', { class: 'acc' }, `Sheet ${sheetNo(r.id)}`), ` · ${groupLabel(r.group)}`),
      h('span', { class: 'sv-kind t-mono-sm' }, kindGlyph(r.kind, 14), r.kind)),
    h('h3', { class: 't-headline-sm sv-title' }, r.title),
    r.blurb ? h('p', { class: 'sv-desc' }, r.blurb) : null,
    blocked ? h('div', { class: 'banner info' }, `${r.title} ${blocked}. Add a code root from the rail to print it.`) : null,
    last && last.status !== 'ok' && !job ? h('div', { class: 'banner error' }, h('b', null, last.status === 'invalid' ? 'Last run did not validate. ' : 'Last run failed. '),
      h('button', { type: 'button', class: 'btn link', onclick: () => ctx.openArtifact(last.id) }, 'See it'), ' · ', h('button', { type: 'button', class: 'btn link', onclick: () => f.requestSubmit() }, 'Retry')) : null,
    f);
}

function unmark(e) {
  const w = e.target.closest?.('.ff.invalid');
  if (!w) return;
  w.classList.remove('invalid'); w.querySelector('.field-error')?.remove();
  w.querySelectorAll('[aria-invalid]').forEach((x) => { x.removeAttribute('aria-invalid'); x.removeAttribute('aria-describedby'); });
}

// ---------- printing (DESIGN 11.22, SCREENS 2 live generation block) ----------

// pipeline stages for kinds without fixed sections
const STAGES = ['Read', 'Write', 'Save'];

class PrintJob {
  constructor({ recipe, title, meta, onCancel, compact = false }) {
    this.recipe = recipe;
    this.known = recipe?.kind === 'doc' && Array.isArray(recipe.sections) && recipe.sections.length ? recipe.sections : null;
    this.steps = [];
    this.text = '';
    this.heads = [];        // [{ name, cites }] as H2 headings stream in
    this.stage = 0;
    this.phase = '';
    this.started = Date.now();
    this.title = title;
    this.meta = meta;
    this.onCancel = onCancel;
    this.listeners = new Set();
    this.draftOpen = false;
    this.el = h('div', { class: `pj${compact ? ' compact' : ''}`, dataset: { group: recipe?.group || '' }, role: 'status' });
    this.render();
    this.timer = setInterval(() => this.renderClock(), 1000);
  }
  on(fn) { this.listeners.add(fn); }
  changed() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = null; this.render(); this.listeners.forEach((fn) => fn(this)); });
  }
  tool(ev) {
    this.steps.push({ id: ev.id, name: ev.name, summary: ev.summary || ev.name, done: false });
    this.lastWasText = false;
    this.changed();
  }
  result(ev) {
    const s = this.steps.find((x) => x.id === ev.id) || [...this.steps].reverse().find((x) => !x.done);
    if (s) { s.done = true; s.ok = ev.ok !== false; s.chars = ev.chars; }
    this.changed();
  }
  delta(t) {
    this.text += t;
    this.lastWasText = true;
    if (this.text.replace(/\s/g, '').length > 160) this.stage = Math.max(this.stage, 1);
    const parts = this.text.split(/^## +(.+)$/m);
    this.heads = [];
    for (let i = 1; i < parts.length; i += 2) this.heads.push({ name: parts[i].trim(), cites: (parts[i + 1].match(/\[\[|\[\^\d+\]/g) || []).length });
    this.changed();
  }
  setPhase(name) {
    this.phase = name;
    if (name === 'save') this.stage = 2;
    this.changed();
  }
  progress() {
    const cur = this.heads.length;
    if (this.known) {
      const total = Math.max(this.known.length, cur);
      const done = this.phase === 'save' ? total : Math.max(0, cur - 1);
      const name = cur ? this.known[cur - 1] || this.heads[cur - 1].name : 'Reading';
      return { done, total, cur, frac: done / total, text: `${cur} of ${total} · ${name}` };
    }
    if (this.recipe?.kind === 'doc' && cur) return { done: null, total: null, cur, frac: null, text: `${plural(cur, 'sections')} · ${this.heads[cur - 1].name}` };
    const s = this.stage;
    return { done: s, total: STAGES.length, cur: s + 1, frac: s / STAGES.length, text: `${s + 1} of ${STAGES.length} · ${this.phase === 'repair' ? 'Fixing' : STAGES[s]}` };
  }
  trail() {
    const words = this.steps.slice(-3).map((s) => s.summary.replace(/^(\w+)/, (m) => m.toLowerCase()));
    const now = this.phase === 'save' ? 'saving' : this.phase === 'repair' ? 'fixing the output' : this.heads.length ? `writing section ${this.heads.length}` : this.lastWasText ? 'writing' : null;
    return [...words, now].filter(Boolean).join(' > ') || 'starting';
  }
  elapsed() {
    const s = Math.floor((Date.now() - this.started) / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${pad2(s % 60)}s`;
  }
  renderClock() { if (this.clockEl) this.clockEl.textContent = this.elapsed(); }
  render() {
    const p = this.progress();
    this.clockEl = h('span', { class: 't-mono-sm pj-clock' }, this.elapsed());
    const rows = this.known
      ? this.known.map((name, i) => sectionRow(i + 1, name, i < p.done ? 'done' : i === p.cur - 1 ? 'cur' : 'todo', this.heads[i]?.cites))
      : this.heads.map((x, i) => sectionRow(i + 1, x.name, i < this.heads.length - 1 || this.phase === 'save' ? 'done' : 'cur', x.cites));
    put(clear(this.el),
      h('div', { class: 'pj-top' },
        h('span', { class: 'sc-dot run', 'aria-hidden': 'true' }), h('span', { class: 't-kicker' }, 'Printing'), this.clockEl,
        h('span', { class: 'grow' }),
        h('button', { type: 'button', class: 'btn ghost sm', 'aria-expanded': String(this.draftOpen), onclick: () => { this.draftOpen = !this.draftOpen; this.render(); } }, this.draftOpen ? 'Hide draft' : 'Open draft'),
        h('button', { type: 'button', class: 'btn ghost sm', onclick: this.onCancel }, 'Cancel')),
      h('div', { class: 'pj-title t-ui-strong' }, this.title),
      this.meta ? h('div', { class: 'pj-meta t-mono-sm' }, this.meta) : null,
      h('div', { class: 'pj-bar' }, p.total ? segbar(p.done, p.total, p.cur, true) : null, h('span', { class: 't-mono-sm' }, p.text)),
      this.phase === 'repair' ? h('div', { class: 'banner warn' }, 'First draft failed validation. Asking for a fix (1 of 1).') : null,
      rows.length ? h('ol', { class: `pj-sections${rows.length > 6 ? ' long' : ''}` }, rows) : null,
      h('div', { class: 'pj-trail t-mono-sm' }, h('span', { class: 't-kicker' }, 'Trail'), ' ', this.trail()),
      this.draftOpen ? h('pre', { class: 'pj-draft t-mono-sm' }, this.text.slice(-4000) || 'Nothing written yet.') : null);
  }
  fail(msg, retry, dismiss) {
    this.stop();
    this.el.classList.add('failed');
    this.el.replaceChildren(h('div', { class: 'banner error' }, h('b', null, 'Printing failed. '), msg || 'Unknown error', ' ',
      h('button', { class: 'btn link', type: 'button', onclick: retry }, 'Retry'), ' · ', h('button', { class: 'btn link', type: 'button', onclick: dismiss }, 'Dismiss')));
  }
  stop() { clearInterval(this.timer); }
}

function sectionRow(n, name, st, cites) {
  return h('li', { class: `pj-sec ${st}` },
    st === 'done' ? mark('mark', 'glyph sm') : h('span', { class: st === 'cur' ? 'pj-cur' : 'pj-gap', 'aria-hidden': 'true' }),
    h('span', { class: 't-mono-sm pj-n' }, String(n)),
    h('span', { class: 'pj-name' }, name),
    cites ? h('span', { class: 't-mono-sm pj-c' }, plural(cites, 'citations')) : null);
}

// Shared by new sheets and regeneration. Resolves to { job, artifact } or { error } or { stopped }.
export async function runJob({ path, body, title, meta, recipe, mount, onFail, compact = false }) {
  const controller = new AbortController();
  const job = new PrintJob({ recipe: recipe || recipeById(body?.recipe), title, meta, compact, onCancel: () => controller.abort() });
  mount(job);
  let artifact = null, error = null;
  try {
    await stream(path, body, (ev) => {
      switch (ev.type) {
        case 'tool': job.tool(ev); break;
        case 'tool_result': job.result(ev); break;
        case 'delta': case 'text': job.delta(ev.text ?? ''); break;
        case 'phase': job.setPhase(ev.name); break;
        case 'done': artifact = ev.artifact || (ev.id && ev.kind ? ev : null); break;
        case 'error': error = ev.message || ev.error || 'error'; if (ev.artifact) addArtifact(ev.artifact); break;
        default: break;
      }
    }, controller.signal);
    if (!artifact && !error) error = 'The stream ended without a sheet.';
  } catch (e) {
    job.stop();
    if (e.name === 'AbortError') { toast('Printing cancelled', 'info', 2000); return { job, artifact: null, stopped: true }; }
    error = e.message;
  }
  job.stop();
  if (error) { onFail?.(job, error); return { job, artifact: null, error }; }
  if (job.steps.length) artifact.trail = trailSummary(job.steps.map((s) => ({ ...s, done: true })));
  return { job, artifact };
}

function jobTitle(r, inputs) {
  const first = Object.values(inputs).find((v) => typeof v === 'string' && v.trim() && !state.artifacts.some((a) => a.id === v));
  return first ? `${r.title} · ${first.trim().replace(/\s+/g, ' ').slice(0, 48)}` : r.title;
}

export function jobMeta(r, inputs, model) {
  const src = Object.values(inputs || {}).map((v) => state.artifacts.find((a) => a.id === v)).find(Boolean);
  const from = src ? `from ${recipeById(src.recipe)?.title || src.recipe} sheet ${sheetNo(src.recipe)}` : null;
  return [`sheet ${sheetNo(r?.id)}`, from, MODELS.find((m) => m.id === model)?.label || model].filter(Boolean).join(' · ');
}

async function generate(r, inputs, model) {
  const nbId = state.nbId;
  const res = await runJob({
    path: nbPath(nbId, '/artifacts'), body: { recipe: r.id, inputs, model }, recipe: r,
    title: jobTitle(r, inputs), meta: jobMeta(r, inputs, model),
    mount: (job) => {
      jobs.set(r.id, job);
      job.on(() => { drawBodySoon(); drawRunChip(); });
      draw(); drawRunChip();
    },
    onFail: (job, msg) => job.fail(msg, () => { jobs.delete(r.id); draw(); generate(r, inputs, model); }, () => { jobs.delete(r.id); draw(); drawRunChip(); }),
  });
  if (res.error) { drawBody(); drawSub(); drawRunChip(); return; }
  jobs.delete(r.id);
  drawRunChip();
  if (state.nbId !== nbId) return;
  if (!res.artifact) { draw(); return; }
  drafts.delete(r.id);
  const a = res.artifact;
  const s = unseen(); s.add(a.id); store.set(unseenKey(), [...s]);
  // print finish: the neatline closes and holds, the new row slides in (DESIGN 8.2)
  finishing.add(r.id);
  landedId = a.id;
  setTimeout(() => { finishing.delete(r.id); landedId = null; drawBody(); }, 1400);
  addArtifact(a);
  draw();
  const size = sizeText(a, 1)[0];
  const open = h('button', { type: 'button', class: 'btn link toast-act', onclick: () => ctx.openArtifact(a.id, a) }, 'Open');
  toast(h('span', null, `Sheet ${sheetNo(r.id)} printed. ${r.title}${size ? ` · ${size}` : ''}. `, open), 'ok', 6000);
}

let bodyRaf = null;
function drawBodySoon() {
  if (bodyRaf) return;
  bodyRaf = requestAnimationFrame(() => { bodyRaf = null; if (studioOpen()) { drawBody(); drawSub(); } });
}

function drawJobs() {
  if (!jobsEl) return;
  clear(jobsEl);
  for (const job of jobs.values()) jobsEl.append(job.el);
  jobsEl.hidden = !jobs.size;
}

// running-recipe chip in the top bar (DESIGN 11.22)
function drawRunChip() {
  const chip = document.getElementById('tb-run');
  if (!chip) return;
  const first = jobs.entries().next().value;
  if (!first) { chip.hidden = true; clear(chip); return; }
  const [id, job] = first;
  chip.hidden = false;
  chip.setAttribute('role', 'button');
  chip.tabIndex = 0;
  chip.title = 'Open Studio at this sheet';
  chip.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRecipe(id); } };
  put(clear(chip), h('span', { class: 'sdot run', 'aria-hidden': 'true' }), `${recipeById(id)?.title || id} · ${job.progress().text.split(' · ')[0]}`, jobs.size > 1 ? ` +${jobs.size - 1}` : null);
}

export function addArtifact(a) {
  state.artifacts = [{ ...a, status: a.status || 'ok', createdAt: a.createdAt || new Date().toISOString() }, ...state.artifacts.filter((x) => x.id !== a.id)];
  emit('artifacts');
}

// ---------- printed sheets (DESIGN 11.21) ----------

export function sheetThumb(group, kind) {
  return h('span', { class: 'ps-thumb', dataset: { group: group || '' }, 'aria-hidden': 'true' }, h('span', { class: 'ps-thumb-band' }), kindGlyph(kind, 14));
}

export function printedMeta(a) {
  const no = sheetNo(a.recipe);
  const total = citeTotal(a);
  const c = citeCounts(a);
  return [no ? `sheet ${no}` : a.recipe, ...sizeText(a), total ? `${c.verified}/${total} verified` : null].filter(Boolean).join(' · ');
}

function drawPrinted(loading = false) {
  if (!printedEl) return;
  const list = state.artifacts;
  const fresh = unseen();
  clear(printedEl).append(h('div', { class: 'sv-printed-head' }, h('h3', { class: 't-kicker' }, 'Printed sheets'), h('span', { class: 't-mono-sm' }, list.length ? String(list.length) : '')));
  if (loading === true && !list.length) { printedEl.append(h('p', { class: 'sv-empty t-ui-sm' }, 'Loading.')); return; }
  if (!list.length) {
    printedEl.append(h('div', { class: 'sv-empty' },
      sv('svg', { class: 'sv-empty-art', viewBox: '0 0 160 96', 'aria-hidden': 'true' },
        contourRings({ cx: 80, cy: 48, rings: 6, base: 8, step: 8, stretch: 1.7, seed: 4 }).map((d) => sv('path', { d })),
        sv('path', { class: 'sheet', d: 'M64 20H90L98 28V78H64ZM90 20V28H98' })),
      h('p', { class: 't-ui-sm' }, 'No sheets printed yet. Pick one on the index and press Print sheet.')));
    return;
  }
  const ul = h('ul', { class: 'ps-list', role: 'list' });
  for (const a of list) {
    const r = recipeById(a.recipe);
    const on = a.id === state.artifactId;
    const bad = a.status && a.status !== 'ok';
    ul.append(h('li', { class: `ps-row${on ? ' sel' : ''}${a.id === landedId ? ' landed' : ''}`, dataset: { group: r?.group || '' } },
      h('button', { type: 'button', class: 'ps-open', 'aria-current': on ? 'true' : null, title: a.title, onclick: () => ctx.openArtifact(a.id) },
        sheetThumb(r?.group, a.kind),
        h('span', { class: 'ps-text' },
          h('span', { class: 'ps-line' }, h('span', { class: 'ps-title' }, a.title || r?.title || a.recipe), fresh.has(a.id) ? h('span', { class: 'sc-dot new', title: 'New, not opened' }) : null,
            h('span', { class: 'grow' }), h('span', { class: 'ps-when t-mono-sm' }, agoWord(a.createdAt))),
          h('span', { class: 'ps-meta t-mono-sm' }, printedMeta(a)),
          bad ? h('span', { class: 'ps-bad t-mono-sm st-unverified' }, mark('unverified'), a.status === 'invalid' ? 'invalid' : 'failed') : null)),
      bad && r ? h('button', { type: 'button', class: 'btn ghost sm ps-retry', onclick: () => openRecipe(r.id, a.inputs || null) }, 'Retry') : null));
  }
  printedEl.append(ul);
}
