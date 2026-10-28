// Sheet canvas: the cover header (DESIGN 12), tabs, actions, next steps, and the renderer from public/studio/<kind>.js.

import { h, clear, icon, toast, copyText } from './dom.js';
import { api, nbPath, stream } from './api.js';
import { state, ctx, on, emit, MODELS } from './state.js';
import { renderAnswer, highlight } from './markdown.js';
import { sourceFor } from './layers.js';
import {
  recipeById, runJob, addArtifact, openRecipe, markSeen, studioOpen, groupLabel, sheetNo, citeCounts, sizeText,
  contourRings, sv, mark, jobMeta, put,
} from './studio.js';

let host, coverEl, barEl, viewSlot, jobSlot, sumEl, bodyEl, kindExports = [], current = null, view = null, seq = 0, tab = 'rendered', fromStudio = false;
const modules = new Map();

const NEXT = { prd: ['tech-spec'], 'tech-spec': ['impl-plan', 'test-plan'], adr: ['tech-spec'] };

const EXPORTS = {
  doc: ['markdown'], graph: ['mermaid', 'json'], sequence: ['mermaid', 'json'],
  plan: ['markdown', 'issues'], quiz: ['json'], file: ['raw'],
};
const FORMAT_LABEL = { markdown: 'Markdown', mermaid: 'Mermaid', json: 'JSON', issues: 'GitHub issues bundle', raw: 'The file', file: 'The file' };
const formatsFor = (kind) => state.studioMeta?.exports?.[kind] || EXPORTS[kind] || ['json'];

export function initCanvas(el) {
  host = el;
  coverEl = h('section', { class: 'cover' });
  barEl = h('div', { class: 'cover-bar' });
  // the renderer's view toggle and tools move here (artifact-canvas keeps their renderer styles)
  viewSlot = h('div', { class: 'cover-view artifact-canvas' });
  jobSlot = h('div', { class: 'canvas-job' });
  sumEl = h('div', { class: 'canvas-summary' });
  bodyEl = h('div', { class: 'canvas-body has-cites', role: 'tabpanel', 'aria-label': 'Sheet' });
  // renderers without ctx.regenerate ask for a retry with this event
  bodyEl.addEventListener('studio:retry', () => regenerate());
  host.append(h('div', { class: 'canvas-scroll', tabindex: '-1' }, coverEl, barEl, jobSlot, sumEl, bodyEl));
  host.classList.add('survey-canvas');
  // recipes can arrive after a sheet opened from the URL
  on('recipes', () => { if (current) { drawCover(); drawBar(); } });
  document.addEventListener('keydown', canvasKeys);
}

export const canvasOpen = () => !!current;

export function closeCanvas({ keepHash = false } = {}) {
  const back = fromStudio;
  destroyView();
  current = null;
  fromStudio = false;
  state.artifactId = null;
  document.getElementById('center').classList.remove('show-canvas');
  document.getElementById('app').classList.remove('rail-strip');
  emit('artifacts');
  if (!keepHash) ctx.syncHash?.();
  return back;
}

// Esc goes back to where the sheet was opened from (DESIGN 12)
function canvasKeys(e) {
  if (!current || e.defaultPrevented || e.key !== 'Escape' || studioOpen()) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  if (document.documentElement.classList.contains('drawer-open') || document.querySelector('dialog[open], .palette, .menu, .popover')) return;
  e.preventDefault();
  const back = closeCanvas();
  // focus goes back to where the sheet came from, never to the body
  if (back) ctx.toggleStudio(true);
  else document.getElementById('page-scroll')?.focus({ preventScroll: true });
}

function destroyView() {
  try { view?.destroy?.(); } catch (e) { console.error(e); }
  view = null;
}


export async function openArtifact(id, data = null) {
  const my = ++seq;
  const nbId = state.nbId;
  if (state.artifactId !== id) tab = 'rendered';
  state.artifactId = id;
  markSeen(id);
  document.getElementById('center').classList.add('show-canvas');
  if (studioOpen()) { fromStudio = true; ctx.toggleStudio(false); }
  else if (!current) fromStudio = false;
  document.getElementById('app').classList.remove('rail-open');
  emit('artifacts');
  ctx.syncHash?.();
  let art = data && (data.data !== undefined || data.markdown !== undefined || data.raw !== undefined) ? data : null;
  if (!art) {
    destroyView();
    clear(coverEl); clear(barEl); clear(sumEl); clear(jobSlot);
    clear(bodyEl).append(h('div', { class: 'canvas-loading t-ui-sm' }, 'Opening the sheet.'));
    try { art = await api.get(nbPath(nbId, `/artifacts/${encodeURIComponent(id)}`)); }
    catch (e) {
      if (my !== seq) return;
      clear(bodyEl).append(h('div', { class: 'banner error' }, h('b', null, 'Could not open the sheet. '), e.message));
      return;
    }
  }
  if (my !== seq || state.nbId !== nbId) return;
  current = art;
  await draw();
  // keyboard focus follows the view, so the key strip and Esc act on the sheet
  if (my === seq && (!document.activeElement || document.activeElement === document.body || document.activeElement.closest('.studio, .canvas'))) host.querySelector('.canvas-scroll')?.focus({ preventScroll: true });
}

// ---------- cover header ----------

function printedWhen(t) {
  const d = new Date(t);
  if (!t || isNaN(d)) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  if (d >= today) return `printed ${time}`;
  if (d >= new Date(today - 86400000)) return `printed yesterday ${time}`;
  return `printed ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

// the source names a sheet drew on: its root inputs, else the roots its citations land in
function sourcesOf(a) {
  const roots = state.nb?.roots || [];
  const named = Object.values(a.inputs || {}).flatMap((v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' && v.root ? [v.root] : [])).filter((v) => roots.some((r) => r.name === v));
  if (named.length) return [...new Set(named)];
  const hit = new Set();
  const norm = (x) => String(x || '').replace(/\\/g, '/').replace(/^\.?\//, '');
  for (const c of a.citations || []) {
    const path = norm(c.path);
    const r = roots.find((x) => x.path && path.startsWith(norm(x.path) + '/'));
    if (r) { hit.add(r.name); continue; }
    const doc = (state.nb?.shelf || []).find((d) => d.files.some((f) => norm(f) === path));
    if (doc) hit.add(doc.title);
  }
  return [...hit].slice(0, 3);
}

function fromLine(a) {
  const src = Object.values(a.inputs || {}).map((v) => state.artifacts.find((x) => x.id === v)).find(Boolean);
  if (!src) return null;
  return h('span', null, 'from ', h('a', { href: '#', class: 'cover-from', onclick: (e) => { e.preventDefault(); openArtifact(src.id); } }, `${recipeById(src.recipe)?.title || src.recipe} sheet ${sheetNo(src.recipe)}`));
}

// 56px, then 40px, then 28px on two lines, whichever fits first (DESIGN 12)
function fitTitle() {
  const el = coverEl?.querySelector('.cover-title');
  if (!el) return;
  for (const [sz, lines] of [['xl', 1], ['lg', 2], ['md', 2]]) {
    el.className = `cover-title s-${sz} measure`;
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 40;
    const fits = el.scrollHeight <= lh * lines + 2 && el.scrollWidth <= el.clientWidth + 1;
    el.className = `cover-title s-${sz}`;
    if (fits) break;
  }
}
let fitRaf = null;
window.addEventListener('resize', () => { if (!current || fitRaf) return; fitRaf = requestAnimationFrame(() => { fitRaf = null; fitTitle(); }); });

export function receiptMini(c) {
  return h('span', { class: 'cover-receipt t-mono-sm', role: 'img', 'aria-label': `${c.verified} verified, ${c.moved} moved, ${c.unverified} unverified` },
    h('span', { class: `st-verified${c.verified ? '' : ' zero'}` }, mark('verified'), `${c.verified} verified`),
    h('span', { class: `st-moved${c.moved ? '' : ' zero'}` }, mark('moved'), `${c.moved} moved`),
    h('span', { class: `st-unverified${c.unverified ? '' : ' zero'}` }, mark(c.unverified ? 'unverified' : 'mark'), `${c.unverified} unverified`));
}

function coverContour(no) {
  const seed = Number(no) || 7;
  const W = 420, H = 150;
  const base = contourRings({ cx: W * 0.62, cy: H * 0.5, rings: 9, base: 14, step: 13, stretch: 1.7, seed });
  return sv('svg', { class: 'cover-relief', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMaxYMid slice', 'aria-hidden': 'true' },
    sv('defs', null, sv('linearGradient', { id: 'cover-fade', x1: 0, x2: 1 }, sv('stop', { offset: 0, 'stop-color': '#fff', 'stop-opacity': 0 }), sv('stop', { offset: 0.35, 'stop-color': '#fff', 'stop-opacity': 1 })),
      sv('mask', { id: 'cover-mask' }, sv('rect', { width: W, height: H, fill: 'url(#cover-fade)' }))),
    sv('g', { mask: 'url(#cover-mask)' }, base.map((d, i) => sv('path', { d, class: i === 3 || i === 6 ? 'g' : null }))),
    sv('g', { class: 'cover-bm', transform: `translate(${W * 0.62 - 26} ${H * 0.5 - 7})` },
      sv('use', { href: '/marks.svg#mark', width: 12, height: 12, y: 1 }),
      sv('text', { x: 16, y: 11 }, `BM ${no || ''}`)));
}

function drawCover() {
  const a = current;
  const r = recipeById(a.recipe);
  const no = sheetNo(a.recipe);
  const group = r?.group || '';
  const title = a.title || r?.title || 'Untitled';
  const model = a.engine === 'mcp' ? `via ${a.client || 'MCP'}` : MODELS.find((m) => m.id === a.model)?.label || a.model;
  const meta = [
    sourcesOf(a).join(', ') || null,
    fromLine(a),
    ...sizeText(a),
    model || null,
    a.costUsd ? `$${Number(a.costUsd).toFixed(2)}` : null,
    printedWhen(a.updatedAt || a.createdAt) || null,
  ].filter(Boolean);
  const metaEl = h('div', { class: 'cover-meta t-mono-sm' });
  meta.forEach((m, i) => metaEl.append(i ? ' · ' : '', m));
  const status = a.status && a.status !== 'ok';
  coverEl.dataset.group = group;
  coverEl.setAttribute('aria-label', `Sheet ${no || ''}`);
  put(clear(coverEl),
    coverContour(no),
    h('div', { class: 'cover-text' },
      h('div', { class: 't-kicker cover-kicker' }, h('span', { class: 'acc' }, no ? `Sheet ${no}` : 'Sheet'), group ? ` · ${groupLabel(group)}` : '', r ? ` · ${r.title}` : ''),
      h('h1', { class: 'cover-title s-xl' }, h('span', { class: 'riso', 'aria-hidden': 'true' }, title), h('span', { class: 'ink' }, title)),
      metaEl,
      h('div', { class: 'cover-line' }, status ? h('span', { class: 'cover-bad t-mono-sm st-unverified' }, mark('unverified'), a.status === 'invalid' ? 'did not validate' : 'failed') : receiptMini(citeCounts(a)))));
  fitTitle();
}

function drawBar() {
  const a = current;
  const n = (a.citations || []).length;
  const tabs = [['rendered', 'Rendered'], ['source', 'Source'], ['citations', 'Citations', n]];
  const tablist = h('div', { class: 'cv-tabs', role: 'tablist', 'aria-label': 'Sheet view' },
    tabs.map(([id, label, count]) => h('button', { type: 'button', role: 'tab', class: 'cv-tab', id: `tab-${id}`, 'aria-selected': String(tab === id), tabindex: tab === id ? '0' : '-1',
      onclick: () => setTab(id) }, label, count != null ? h('span', { class: 't-mono-sm cv-tab-n' }, String(count)) : null)));
  tablist.addEventListener('keydown', (e) => {
    const ids = tabs.map((t) => t[0]);
    const i = ids.indexOf(tab);
    const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: ids.length - 1 }[e.key];
    if (j == null) return;
    e.preventDefault();
    setTab(ids[(j + ids.length) % ids.length]);
    barEl.querySelector(`#tab-${tab}`)?.focus();
  });
  // two next steps sit in the bar; the rest live in More
  const next = nextSteps(a).slice(0, 2);
  const busy = !!jobSlot.firstChild;
  put(clear(barEl),
    tablist,
    h('span', { class: 'grow' }),
    tab === 'rendered' && viewSlot.firstChild ? viewSlot : null,
    h('div', { class: `cover-acts${busy ? ' busy' : ''}` },
      h('button', { class: 'btn ghost', type: 'button', onclick: regenerate, title: 'Print it again with the same inputs', 'aria-label': 'Regenerate' }, icon('refresh', 14), h('span', { class: 'lbl' }, 'Regenerate')),
      h('button', { class: 'btn ghost', type: 'button', 'aria-haspopup': 'menu', 'aria-label': 'Export', onclick: (e) => exportMenu(e.currentTarget) }, icon('upload', 14), h('span', { class: 'lbl' }, 'Export')),
      h('button', { class: 'btn ghost', type: 'button', 'aria-label': 'Copy', onclick: copyArtifact }, icon('copy', 14), h('span', { class: 'lbl' }, 'Copy')),
      h('button', { class: 'btn ghost', type: 'button', 'aria-haspopup': 'menu', 'aria-label': 'More actions', onclick: (e) => moreMenu(e.currentTarget) }, h('span', { class: 'dots', 'aria-hidden': 'true' }, '···'), h('span', { class: 'lbl' }, 'More'))),
    next.length ? h('span', { class: 'cover-sep', 'aria-hidden': 'true' }) : null,
    next.length ? h('div', { class: 'cover-next' }, h('span', { class: 't-kicker' }, 'Next step'),
      next.map(([rid, label, prefill]) => h('button', { class: 'btn', type: 'button', onclick: () => openRecipe(rid, prefill) }, label, icon('arrow', 14)))) : null);
}

function setTab(id) {
  if (tab === id) return;
  tab = id;
  drawBar();
  drawTab();
}

function nextSteps(a) {
  if (a.status !== 'ok') return [];
  const own = recipeById(a.recipe)?.next;
  if (Array.isArray(own) && own.length) {
    // an artifact input takes this sheet; any other input carries over the same-named value
    return own.map((n) => {
      const t = recipeById(n.recipe);
      if (!t) return null;
      const spec = t.inputs.find((s) => s.name === n.input);
      const val = spec?.type === 'artifact' ? a.id : a.inputs?.[n.input];
      return [n.recipe, t.title, n.input && val != null && val !== '' ? { [n.input]: val } : null];
    }).filter(Boolean);
  }
  const ids = [...(NEXT[a.recipe] || [])];
  if (a.kind === 'doc' && !ids.includes('claude-md') && a.recipe !== 'claude-md') ids.push('claude-md');
  const out = [];
  for (const id of ids) {
    const r = recipeById(id);
    if (!r) continue;
    const spec = r.inputs.find((s) => s.type === 'artifact' && (!s.from?.length || s.from.includes('*') || s.from.includes(a.recipe)));
    out.push([id, r.title, spec ? { [spec.name]: a.id } : null]);
  }
  return out;
}

// ---------- body ----------

// Only for the fallback view; renderer modules show the summary themselves.
function drawSummary() {
  const a = current;
  clear(sumEl);
  if (!a.summary || a.kind === 'doc') return;
  const prose = h('div', { class: 'prose has-cites', html: renderAnswer(a.summary, a.citations || []).html });
  prose.cites = citeMap(a);
  sumEl.append(prose);
}

const citeMap = (a) => new Map((a.citations || []).map((c) => [String(c.n), c]));

function parseRef(ref) {
  if (!ref) return null;
  if (typeof ref === 'object') return ref.path ? ref : null;
  const m = String(ref).match(/^(.+?)(?:#L(\d+)(?:-L?(\d+))?)?$/);
  if (!m) return null;
  return { path: m[1], line: m[2] ? +m[2] : null, endLine: m[3] ? +m[3] : m[2] ? +m[2] : null };
}

function rendererCtx(a) {
  const nbId = state.nbId;
  const base = nbPath(nbId, `/artifacts/${encodeURIComponent(a.id)}`);
  return {
    // same layer and source name as the rail and the hover card
    layerFor: (p) => sourceFor(p)?.layer || null,
    sourceNameFor: (p) => sourceFor(p)?.name || null,
    openRef(ref) {
      const r = parseRef(ref);
      if (r) ctx.openFile(r.path, { line: r.line, endLine: r.endLine, quote: r.quote || null });
    },
    openCitation(n) {
      const c = (a.citations || []).find((x) => String(x.n) === String(n));
      // same drawer as answers: status strip and [ ] stepping across this sheet's citations
      if (c) ctx.openFile(c.path, { line: c.line, endLine: c.endLine, quote: c.quote, cite: c, list: [...(a.citations || [])].sort((x, y) => x.n - y.n) });
      else toast(`Citation ${n} is not in this sheet`, 'info', 2000);
    },
    api: { ...api, stream, nbPath: (rest = '') => nbPath(nbId, rest), artifactPath: (rest = '') => base + rest, notebook: nbId, roots: state.nb?.roots || [] },
    async patchArtifact(changes) {
      const res = await api.patch(base, changes);
      Object.assign(a, changes, res && typeof res === 'object' && res.id ? res : {});
      return a;
    },
    toast,
    notebookId: nbId,
    regenerate: () => regenerate(),
  };
}

async function draw() {
  document.getElementById('app').classList.toggle('rail-strip', current.kind === 'sequence');
  drawCover();
  drawBar();
  await drawTab();
}

async function drawTab() {
  const a = current;
  const my = seq;
  clear(sumEl);
  destroyView();
  clear(viewSlot);
  kindExports = [];
  bodyEl.cites = citeMap(a);
  bodyEl.dataset.kind = a.kind;
  bodyEl.dataset.tab = tab;
  bodyEl.setAttribute('aria-labelledby', `tab-${tab}`);
  if (tab === 'source') { clear(bodyEl).append(sourceView(a)); return; }
  if (tab === 'citations') { clear(bodyEl).append(citationsView(a)); return; }
  clear(bodyEl).append(h('div', { class: 'canvas-loading t-ui-sm' }, 'Drawing the sheet.'));
  let mod = null;
  try { mod = await loadRenderer(a.kind); } catch (e) { console.warn(`renderer for ${a.kind} not available`, e); }
  if (my !== seq || current !== a || tab !== 'rendered') return;
  clear(bodyEl);
  const mount = h('div', { class: `renderer r-${a.kind}` });
  bodyEl.append(mount);
  if (mod?.render) {
    try { view = mod.render(mount, a, rendererCtx(a)) || null; adoptTools(mount); emit('pane', 'page'); return; }
    catch (e) { console.error(e); clear(mount); mount.append(h('div', { class: 'banner error' }, h('b', null, 'The renderer failed. '), e.message)); }
  }
  fallback(mount, a);
}

// One header row: the renderer's toolbar folds into the cover bar. Its Export
// items join the header Export menu and its count line goes (the cover meta has it).
function adoptTools(mount) {
  const bar = ['graph', 'sequence', 'plan', 'quiz'].includes(current?.kind) && mount.querySelector('.sa > .sa-toolbar');
  if (!bar) return;
  for (const m of bar.querySelectorAll('.sa-menu-wrap')) if (m.exportItems) { kindExports.push(...m.exportItems); m.remove(); }
  for (const el of [...bar.children]) if (!el.matches('.sa-spacer, .sa-meta')) viewSlot.append(el);
  bar.remove();
  drawBar();
}

async function loadRenderer(kind) {
  if (!modules.has(kind)) {
    const p = import(`/studio/${kind}.js`);
    p.catch(() => modules.delete(kind));
    modules.set(kind, p);
  }
  return modules.get(kind);
}

function rawOf(a) {
  if (a.kind === 'doc' && a.markdown != null) return { text: a.markdown, lang: 'markdown', name: 'markdown' };
  if (a.kind === 'file' && a.data?.content) return { text: a.data.content, lang: a.data.language || (a.data.filename || '').split('.').pop(), name: a.data.filename || 'file' };
  if (a.data != null) return { text: JSON.stringify(a.data, null, 2), lang: 'json', name: 'data.json' };
  return { text: a.raw || a.markdown || '', lang: 'markdown', name: 'raw output' };
}

function sourceView(a) {
  const raw = rawOf(a);
  return h('div', { class: 'cv-source' },
    h('pre', { class: 'well' }, h('code', { class: 'hljs', html: highlight(raw.text.slice(0, 400000), raw.lang) })),
    h('div', { class: 'well-cap t-mono-sm' }, `${raw.name} · ${raw.text.split('\n').length} lines`));
}

function citationsView(a) {
  const cites = a.citations || [];
  if (!cites.length) return h('p', { class: 'cv-empty t-ui-sm' }, 'This sheet has no citations.');
  const label = { verified: 'verified', moved: 'moved', unverified: 'unverified', pending: 'checking' };
  return h('ol', { class: 'cv-cites' }, cites.map((c) => {
    const st = label[c.status] ? c.status : 'pending';
    const moved = st === 'moved' && c.foundLine ? `cited L${c.line}, found at L${c.foundLine}` : null;
    return h('li', null, h('button', { type: 'button', class: `cv-cite st-${st}`, onclick: () => ctx.openFile(c.path, { line: c.foundLine || c.line, endLine: c.endLine, quote: c.quote }) },
      h('span', { class: 'cv-n t-mono-sm' }, String(c.n)),
      mark(st === 'pending' ? 'pending' : st, 'glyph'),
      h('span', { class: 'cv-main' },
        h('span', { class: 'cv-path t-mono-sm' }, `${c.path}${c.line ? `:${c.line}` : ''}`),
        c.quote ? h('span', { class: 'cv-quote' }, `"${c.quote}"`) : null),
      h('span', { class: 'cv-st t-mono-sm' }, moved || label[st])));
  }));
}

// Plain view used until the kind's renderer module exists or when it throws.
function fallback(mount, a) {
  drawSummary();
  if (a.status && a.status !== 'ok') {
    const errs = a.errors || [];
    mount.append(h('div', { class: 'banner error', role: 'alert' },
      h('b', null, a.status === 'invalid' ? `This sheet did not validate. ${errs.length} error${errs.length === 1 ? '' : 's'}.` : 'Printing hit an error.'),
      errs.length ? h('ul', { class: 't-mono-sm' }, errs.slice(0, 8).map((x) => h('li', null, typeof x === 'string' ? x : JSON.stringify(x)))) : a.error ? h('p', null, String(a.error)) : null,
      h('button', { class: 'btn primary sm', type: 'button', onclick: regenerate }, 'Retry')));
  }
  if (a.kind === 'doc' && a.markdown) { mount.append(h('article', { class: 'prose doc-fallback', html: renderAnswer(a.markdown, a.citations || []).html })); return; }
  const raw = rawOf(a);
  if (!raw.text) return;
  mount.append(h('div', { class: 'cv-source' }, h('pre', { class: 'well' }, h('code', { class: 'hljs', html: highlight(raw.text.slice(0, 400000), raw.lang) })), h('div', { class: 'well-cap t-mono-sm' }, raw.name)));
}

// ---------- actions ----------

async function regenerate() {
  const a = current;
  if (!a || jobSlot.firstChild) return;
  const r = recipeById(a.recipe);
  const res = await runJob({
    path: nbPath(state.nbId, `/artifacts/${encodeURIComponent(a.id)}/regenerate`), body: { model: a.model }, recipe: r, compact: true,
    title: `Reprinting ${a.title || r?.title || ''}`.trim(), meta: jobMeta(r, a.inputs, a.model),
    mount: (job) => { clear(jobSlot).append(job.el); barEl.querySelector('.cover-acts')?.classList.add('busy'); },
    onFail: (job, msg) => job.fail(msg, () => { clear(jobSlot); regenerate(); }, () => { clear(jobSlot); drawBar(); }),
  });
  barEl.querySelector('.cover-acts')?.classList.remove('busy');
  if (res.error) return;
  clear(jobSlot);
  if (!res.artifact) { drawBar(); return; }
  if (res.artifact.id !== a.id) state.artifacts = state.artifacts.filter((x) => x.id !== a.id);
  addArtifact(res.artifact);
  toast(`Sheet ${sheetNo(a.recipe) || ''} reprinted.`, 'ok', 2400);
  if (state.artifactId === a.id || state.artifactId === res.artifact.id) openArtifact(res.artifact.id, res.artifact);
}

function download(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = h('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function popMenu(anchor, cls, items) {
  document.querySelector(`.menu.${cls}`)?.remove();
  const menu = h('div', { class: `menu ${cls}`, role: 'menu' }, items);
  const rect = anchor.getBoundingClientRect();
  Object.assign(menu.style, { position: 'fixed', top: rect.bottom + 4 + 'px', left: Math.max(16, rect.right - 220) + 'px', width: '220px' });
  document.body.append(menu);
  menu.querySelector('.menu-item')?.focus();
  const outside = (e) => { if (!menu.contains(e.target) && !anchor.contains(e.target)) close(); };
  const close = () => { menu.remove(); document.removeEventListener('pointerdown', outside); };
  setTimeout(() => document.addEventListener('pointerdown', outside), 0);
  menu.addEventListener('click', (e) => { if (e.target.closest('.menu-item')) close(); });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); anchor.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const list = [...menu.querySelectorAll('.menu-item')];
      const i = list.indexOf(document.activeElement);
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
    }
  });
  return menu;
}

function exportMenu(anchor) {
  const a = current;
  const own = kindExports.map((it) => h('button', { class: 'menu-item', role: 'menuitem', type: 'button', onclick: () => it.run() }, it.label, it.hint ? h('span', { class: 'hint' }, it.hint) : null));
  popMenu(anchor, 'export-menu', [h('div', { class: 'menu-label' }, 'Export as'),
    ...own, own.length ? h('div', { class: 'menu-sep' }) : null,
    ...formatsFor(a.kind).map((fmt) => h('button', { class: 'menu-item', role: 'menuitem', type: 'button', onclick: async () => {
      try {
        const r = await api.post(nbPath(state.nbId, `/artifacts/${encodeURIComponent(a.id)}/export`), { format: fmt });
        download(r.text ?? '', r.filename || `${a.id}.txt`);
      } catch (e) {
        const text = fmt === 'json' ? JSON.stringify(a.data, null, 2) : a.markdown || a.data?.content || JSON.stringify(a.data, null, 2);
        download(text, a.kind === 'file' ? a.data?.filename || 'file.txt' : `${a.id}.${fmt === 'json' ? 'json' : 'md'}`);
        toast(`Export route failed (${e.message}), saved the raw content instead`, 'info', 3200);
      }
    } }, FORMAT_LABEL[fmt] || fmt))]);
}

function moreMenu(anchor) {
  const extra = nextSteps(current).slice(2);
  popMenu(anchor, 'more-menu', [
    ...extra.map(([rid, label, prefill]) => h('button', { class: 'menu-item', role: 'menuitem', type: 'button', onclick: () => openRecipe(rid, prefill) }, `Next: ${label}`)),
    extra.length ? h('div', { class: 'menu-sep' }) : null,
    h('button', { class: 'menu-item', role: 'menuitem', type: 'button', onclick: () => ctx.toggleStudio(true) }, 'Back to Studio', h('span', { class: 'hint' }, 'P')),
    h('div', { class: 'menu-sep' }),
    h('button', { class: 'menu-item danger', role: 'menuitem', type: 'button', onclick: delArtifact }, icon('trash', 14), 'Delete sheet')]);
}

function copyArtifact() {
  const a = current;
  let text;
  if (a.kind === 'doc') {
    const cites = a.citations || [];
    text = (a.markdown || '') + (cites.length ? '\n\n' + cites.map((c) => `[^${c.n}]: ${c.path}${c.line ? `#L${c.line}${c.endLine && c.endLine !== c.line ? '-L' + c.endLine : ''}` : ''}${c.quote ? ` "${c.quote}"` : ''} (${c.status})`).join('\n') : '');
  } else if (a.kind === 'file') text = a.data?.content || '';
  else text = JSON.stringify(a.data ?? a.raw ?? null, null, 2);
  copyText(text, 'Copied');
}

async function delArtifact() {
  const a = current;
  if (!confirm(`Delete "${a.title}"?`)) return;
  try {
    await api.del(nbPath(state.nbId, `/artifacts/${encodeURIComponent(a.id)}`));
    state.artifacts = state.artifacts.filter((x) => x.id !== a.id);
    const back = closeCanvas();
    if (back) ctx.toggleStudio(true);
    toast('Sheet deleted', 'info', 2000);
  } catch (e) { toast(e.message); }
}
