// Source drawer (DESIGN 11.18): files at a cited line, a source's file tree, full-text search
// and notes. Slides over the margin from the right. Open items are kept as a small tab row.

import { h, clear, icon, iconBtn, toast, copyText, basename, esc, arrowNav, fmtNum, place } from './dom.js';
import { api, nbPath } from './api.js';
import { state, ctx, on, emit } from './state.js';
import { highlightLines, renderDocBlocks, renderAnswer, splitFootnotes } from './markdown.js';
import { readRanges } from './traverse.js';
import { lineMap, refsIn, worst, shown as stShown } from './status.js';
import { sourceFor, swatch, glyph, statusOf, STATUS_WORD, kbd, shortPath, qnum } from './layers.js';
import { loadDir } from './rail.js';
import { citeWhy } from './witness.js';
import { align, when } from './witness.js';

let root;
let tabs = [];
let active = null;
let shown = null;        // key of the tab whose body is on screen, for saving its scroll
let collapsed = false;   // drawer hidden but tabs kept
const files = new Map(); // `${nb}:${path}` -> Promise<{path,text,lang,lines}>
let wrap = window.matchMedia('(max-width: 767px)').matches; // phones start wrapped so a long line needs no panning
let selBar = null;
let depHost = null, depSeq = 0, depRefs = [], depTrunc = false, depMap = new Map(), depEl = null, depTimer = 0;

const hlCache = new Map();
function linesFor(key, file, lang) {
  let v = hlCache.get(key);
  if (!v) {
    v = highlightLines(file.text, lang);
    hlCache.set(key, v);
    if (hlCache.size > 24) hlCache.delete(hlCache.keys().next().value);
  }
  return v;
}

export function getFile(path) {
  const key = `${state.nbId}:${path}`;
  if (!files.has(key)) {
    const p = api.get(nbPath(state.nbId, `/file?path=${encodeURIComponent(path)}`)).then((r) => {
      if (typeof r === 'string') r = { path, text: r };
      r.text = (r.text ?? '').replace(/\r\n?/g, '\n');
      return r;
    });
    p.catch(() => files.delete(key));
    files.set(key, p);
  }
  return files.get(key);
}

export const isDoc = (p) => /\.(md|mdx|markdown|txt)$/i.test(p || '');

export function initViewer(el) {
  root = el;
  on('notebook', () => { tabs = []; active = null; shown = null; collapsed = false; files.clear(); hlCache.clear(); render(); });
  document.addEventListener('selectionchange', () => { if (selBar && !document.getSelection()?.toString()) dropSelBar(); });
  // "/" with lines selected in the drawer asks about them
  document.addEventListener('keydown', (e) => {
    if (selBar && e.key === '/' && !e.target.closest?.('input, textarea')) { e.preventDefault(); e.stopPropagation(); selBar.ask(); }
  }, true);
  // Esc from a field inside the drawer still closes it
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented && e.target.closest('input, textarea')) { e.preventDefault(); closeViewer(); } });
  // a pinned list closes on a click elsewhere, and Esc closes it before the drawer
  document.addEventListener('click', (e) => { if (depEl?.classList.contains('pinned') && !depEl.contains(e.target) && !e.target.closest?.('.dr-cited')) hideDeps(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !depEl) return;
    const back = depEl.opener;
    hideDeps();
    e.preventDefault(); e.stopPropagation();
    if (back?.isConnected && back.matches('.dr-cited')) back.focus();
  }, true);
  on('refresh', () => { if (depHost) loadDeps(depHost); });
  render();
}

function setOpen(open) {
  document.documentElement.classList.toggle('drawer-open', open);
  if (!open) hideDeps();
  root.inert = !open;
  const t = open ? tabs.find((x) => x.key === active) : null;
  emit('viewer', t?.path || t?.src?.prefix || null);
  emit('pane', open ? 'drawer' : 'page');
}

export function closeViewer() {
  const had = root.contains(document.activeElement);
  saveScroll(); dropSelBar(); collapsed = true; setOpen(false);
  if (had) document.getElementById('page-scroll')?.focus({ preventScroll: true });
}
export function showViewer() { if (tabs.length) { collapsed = false; render(); } }
export const viewerOpen = () => tabs.length > 0 && !collapsed;
export const viewerHasTabs = () => tabs.length > 0;

function saveScroll() {
  const cur = tabs.find((t) => t.key === shown);
  const b = root?.querySelector('.view-body');
  if (cur && b) cur.scrollTop = b.scrollTop;
}

const canRestore = (tab) => tab.scrollTop != null && !(tab.line && !tab.scrolled);

function openTab(tab) {
  collapsed = false;
  const existing = tabs.find((t) => t.key === tab.key);
  if (existing) Object.assign(existing, tab, { scrolled: false });
  else {
    const i = active ? tabs.findIndex((t) => t.key === active) + 1 : tabs.length;
    tabs.splice(i, 0, tab);
    if (tabs.length > 12) tabs.splice(tabs.findIndex((t) => t.key !== tab.key), 1);
  }
  active = tab.key;
  render();
}

export function openFile(path, { line = null, endLine = null, quote = null, mode, cite = null, list = null } = {}) {
  if (!path) return;
  openTab({ key: 'f:' + path, kind: 'file', title: basename(path), path, line, endLine, quote, cite, list, view: 'file', mode: mode || (isDoc(path) ? 'page' : 'code'), cmp: false, was: null, chg: false, changes: null });
}

export function openSource(src) {
  openTab({ key: 's:' + src.id, kind: 'source', title: src.name, src });
}

export function openSearch(q = '', regex = false) {
  openTab({ key: 'search', kind: 'search', title: q ? `Search: ${q}` : 'Search', q, regex, results: null });
}

export function openNote(note) {
  openTab({ key: 'n:' + note.slug, kind: 'note', title: note.title, note });
}

function closeTab(key) {
  const i = tabs.findIndex((t) => t.key === key);
  if (i < 0) return;
  tabs.splice(i, 1);
  if (active === key) active = tabs[Math.min(i, tabs.length - 1)]?.key || null;
  render();
}

// Lines of this file the open conversation's trail read, as merged [from, to] ranges.
// A citation that saved what its answer read (cite.saw.read) wins over walking the turns.
function trailReads(path, lineCount, cite) {
  const saved = cite?.saw?.read;
  if (Array.isArray(saved)) return saved.filter(([x]) => x <= lineCount).map(([x, y]) => [x, Math.min(y, lineCount)]);
  return readRanges((state.conv?.turns || []).flatMap((t) => t.toolCalls || []), path, lineCount);
}

function render() {
  saveScroll();
  dropSelBar();
  hideDeps();
  depHost = null;
  setOpen(tabs.length > 0 && !collapsed);
  if (collapsed && tabs.length) return;
  clear(root);
  shown = null;
  if (!tabs.length) return;
  const tab = tabs.find((t) => t.key === active) || tabs[0];
  active = tab.key;
  const body = h('div', { class: 'view-body', role: 'region', 'aria-label': tab.title, tabindex: -1 });
  shown = tab.key;
  window.CSS?.highlights?.delete('cite');
  if (tab.kind === 'file') renderFile(tab, body);
  else if (tab.kind === 'source') renderSource(tab, body);
  else if (tab.kind === 'search') renderSearch(tab, body);
  else renderNote(tab, body);
  if (tabs.length > 1) body.before(openRow());
  root.append(body);
}

// the other open items, one line under the header
function openRow() {
  const row = h('div', { class: 'dr-open', role: 'tablist', 'aria-label': 'Open in the drawer' },
    tabs.map((t, i) => h('span', { class: `dr-tab${t.key === active ? ' on' : ''}`, role: 'presentation' },
      h('button', { role: 'tab', 'aria-selected': String(t.key === active), id: 'dt-' + i, tabindex: t.key === active ? 0 : -1, title: t.path || t.title,
        onclick: () => { active = t.key; render(); }, onauxclick: (e) => { if (e.button === 1) closeTab(t.key); } }, t.title),
      h('button', { class: 'x', 'aria-label': `Close ${t.title}`, tabindex: -1, onclick: () => closeTab(t.key) }, icon('x', 10)))));
  row.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.key === active);
    active = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length].key;
    render();
    root.querySelector('.dr-tab.on button')?.focus();
  });
  return row;
}

function head({ src = null, name, path, extra = [] }) {
  const parts = String(path || '').split('/');
  const file = parts.pop();
  const editor = state.nb?.dir && path ? `vscode://file/${String(state.nb.dir).replace(/\\/g, '/')}/${path}` : null;
  return h('header', { class: 'dr-head' },
    src ? swatch(src) : h('span', { class: 'dr-ico' }, icon('file', 14)),
    h('span', { class: 'dr-name' }, name),
    path ? h('span', { class: 'dr-path', title: path }, h('span', { class: 'dir' }, parts.length ? parts.join('/') + '/' : ''), h('span', { class: 'file' }, file)) : h('span', { class: 'grow' }),
    extra,
    path ? iconBtn('copy', 'Copy path', () => copyText(path, `Copied ${path}`)) : null,
    editor ? h('a', { class: 'icon-btn', href: editor, 'aria-label': 'Open in editor', title: 'Open in editor' }, icon('open')) : null,
    h('button', { class: 'icon-btn esc', 'aria-label': 'Close (Esc)', title: 'Close  Esc', onclick: closeViewer }, icon('x'), kbd('Esc')));
}

// ---------- files ----------

async function renderFile(tab, body) {
  const src = sourceFor(tab.path);
  root.append(head({ src, name: src?.name || 'File', path: tab.path }));
  const bar = h('div', { class: 'dr-tabs' });
  root.append(bar);
  if (tab.cite) root.append(statusStrip(tab));
  if (tab.cite && tab.chg) root.append(changesPanel(tab));
  body.append(h('div', { class: 'dr-loading' }, `Reading ${basename(tab.path)}`));
  let file;
  try { file = await getFile(tab.path); }
  catch (e) {
    // a file that is gone is the main reason to look at the commit
    if (tab.cmp && tab.cite) { await renderCompare(tab, body, null); return; }
    clear(body).append(h('div', { class: 'dr-empty' },
      glyph('unverified'),
      h('p', null, /not found|404/i.test(e.message) ? `This file is gone from ${src?.name || 'the notebook'}. It was cited from an older index.` : `Could not open ${tab.path}.`),
      h('p', { class: 't-mono-sm' }, e.message)));
    return;
  }
  if (!body.isConnected || tabs.find((t) => t.key === active) !== tab) return;
  if (!tab.line && tab.quote) tab.line = findQuoteLine(file.text, tab.quote);
  const doc = isDoc(tab.path);
  const lineCount = file.text.split('\n').length;
  const reads = trailReads(tab.path, lineCount, tab.cite);
  const wasRead = (n) => reads.some(([x, y]) => n >= x && n <= y);
  const tabBtn = (id, label) => h('button', { class: 'tab', role: 'tab', 'aria-selected': String(tab.view === id), onclick: () => { tab.view = id; tab.cmp = false; tab.scrolled = false; render(); } }, label);
  bar.append(...[h('div', { class: 'tabs-row', role: 'tablist', 'aria-label': 'View' }, tabBtn('file', 'File'), tabBtn('outline', 'Outline')),
    doc && tab.view === 'file' ? h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Show as' },
      ['page', 'code'].map((m) => h('button', { role: 'radio', 'aria-checked': String(tab.mode === m), onclick: () => { tab.mode = m; tab.cmp = false; tab.scrolled = false; tab.scrollTop = null; render(); } }, m === 'page' ? 'Page' : 'Source'))) : null,
    tab.mode === 'code' && tab.view === 'file' && !file.binary && !tab.cmp ? h('button', { class: 'btn quiet sm', 'aria-pressed': String(wrap), onclick: (e) => {
      wrap = !wrap;
      e.currentTarget.setAttribute('aria-pressed', String(wrap));
      body.querySelector('.code')?.classList.toggle('wrap', wrap);
    } }, 'Wrap') : null,
    h('span', { class: 'grow' }),
    reads.length ? h('span', { class: 't-mono-sm dr-read', title: 'Lines the trail read for this answer' }, `read by trail ${reads.slice(0, 2).map(([x, y]) => (x === y ? `L${x}` : `L${x}-${y}`)).join(', ')}${reads.length > 2 ? '…' : ''}`) : null,
    h('span', { class: 't-mono-sm' }, `${String(file.lang || tab.path.split('.').pop()).replace(/^./, (c) => c.toUpperCase())} · ${lineCount.toLocaleString()} lines`)].filter(Boolean));
  clear(body);
  if (file.binary) {
    body.append(h('div', { class: 'dr-empty' }, h('p', null, `Binary file, not shown. ${String(file.lang || '').toUpperCase()} ${fmtNum(file.size)}B.`),
      h('button', { class: 'btn', onclick: () => copyText(tab.path, `Copied ${tab.path}`) }, 'Copy path')));
    return;
  }
  if (tab.cmp && tab.cite) { await renderCompare(tab, body, file); return; }
  if (tab.view === 'outline') { body.append(outline(tab, file)); return; }
  if (tab.mode === 'page' && doc) {
    const page = h('div', { class: 'page' }, h('div', { class: 'prose', html: renderDocBlocks(file.text) }));
    wirePage(page, tab);
    body.append(page);
    const restore = canRestore(tab);
    requestAnimationFrame(() => {
      markPage(page, tab, body);
      if (restore) body.scrollTop = tab.scrollTop;
      if (body.isConnected) { depHost = { tab, body, bar, page, lineCount }; loadDeps(depHost); }
    });
  } else {
    const lines = linesFor(`${state.nbId}:${tab.path}`, file, file.lang || tab.path.split('.').pop());
    const a = tab.line || 0, b = tab.endLine || tab.line || 0;
    const cited = tab.cite && statusOf(tab.cite) === 'moved' ? tab.cite.citedLine : null;
    let html = '';
    for (let i = 0; i < lines.length; i += 200) {
      html += '<div class="chunk">';
      for (let j = i; j < Math.min(lines.length, i + 200); j++) {
        const n = j + 1;
        const hit = a && n >= a && n <= b;
        let cls = hit ? ` hit${n === a ? ' first' : ''}${n === b ? ' last' : ''}` : '';
        if (reads.length && wasRead(n)) cls += ' read';
        let tag = '';
        if (cited && n === cited) { cls += ' cited'; tag = '<span class="ltag">cited here</span>'; }
        if (cited && n === a) tag = '<span class="ltag found">found here</span>';
        const mark = hit && n === a ? '<svg class="glyph sm lmark" viewBox="0 0 16 16" aria-hidden="true"><use href="/marks.svg#mark"/></svg>' : '';
        html += `<div class="l${cls}" data-n="${n}"><span class="n">${mark}${n}</span><span class="t">${lines[j] || ' '}</span>${tag}</div>`;
      }
      html += '</div>';
    }
    if (lines.length > 40) html += '<div class="eof">end of file</div>';
    const code = h('div', { class: `code${wrap ? ' wrap' : ''}`, html, ...(src ? { 'data-layer': src.layer } : {}) });
    code.addEventListener('dblclick', (e) => {
      const l = e.target.closest('.l');
      if (l && e.target.classList.contains('n')) copyText(`${tab.path}:${l.dataset.n}`, `Copied ${tab.path}:${l.dataset.n}`);
    });
    body.append(code);
    depHost = { tab, body, bar, code, lineCount };
    loadDeps(depHost);
    wireSelection(body, tab);
    if (canRestore(tab)) requestAnimationFrame(() => { body.scrollTop = tab.scrollTop; });
    else if (a && !tab.scrolled) {
      tab.scrolled = true;
      requestAnimationFrame(() => {
        const el = code.querySelector(`.l[data-n="${a}"]`);
        if (!el) return;
        // the cited line sits at 35% of the drawer height
        body.scrollTop = Math.max(0, (a - 1) * 22 - body.clientHeight * 0.35);
        requestAnimationFrame(() => {
          const off = el.getBoundingClientRect().top - body.getBoundingClientRect().top;
          body.scrollTop += off - body.clientHeight * 0.35;
          for (const x of code.querySelectorAll('.l.hit')) x.classList.add('flash');
        });
      });
    }
  }
}

// the step button that was clicked keeps focus after the strip redraws
let refocusStep = null;

function statusStrip(tab) {
  const c = tab.cite;
  const st = statusOf(c);
  const line = citeWhy(c, shortPath(c.path, 1))?.short ?? (c.line ? `line ${c.line}${c.endLine && c.endLine !== c.line ? '-' + c.endLine : ''}` : '');
  const list = tab.list || [];
  const i = list.findIndex((x) => x.n === c.n);
  const step = (d) => {
    const next = list[i + d];
    if (next) openFile(next.path, { line: next.line, endLine: next.endLine, quote: next.quote, cite: next, list });
  };
  tab.step = step;
  return h('div', { class: `dr-status st-${st}` }, glyph(st, 'glyph sm'),
    h('span', { class: 't-ui-strong' }, `Citation ${c.n}`), h('span', { class: 'sep' }, '·'), h('span', { class: 'st-word' }, STATUS_WORD[st]),
    line ? [h('span', { class: 'sep' }, '·'), h('span', null, line)] : null,
    h('span', { class: 'grow' }),
    historyButtons(tab),
    list.length > 1 ? [stepBtn('Previous citation', '[', i <= 0, () => step(-1)),
      h('span', { class: 't-mono-sm' }, `${i + 1} of ${list.length}`),
      stepBtn('Next citation', ']', i >= list.length - 1, () => step(1))] : null);
}

function stepBtn(label, key, disabled, go) {
  const b = h('button', { class: 'kbtn', 'aria-label': label, disabled, onclick: () => { refocusStep = label; go(); } }, kbd(key));
  if (refocusStep === label) {
    requestAnimationFrame(() => {
      if (!b.isConnected) return;
      refocusStep = null;
      (b.disabled ? b.parentElement?.querySelector('.kbtn:not([disabled])') : b)?.focus({ preventScroll: true });
    });
  }
  return b;
}

// [ and ] in the drawer step through the answer's citations
export function stepDrawerCitation(d) {
  const t = tabs.find((x) => x.key === active);
  if (!viewerOpen() || !t?.step) return false;
  t.step(d);
  return true;
}

// E and D in the drawer: the code as it was, and the commits that touched these lines
export function drawerHistory(kind) {
  const t = tabs.find((x) => x.key === active);
  if (!viewerOpen() || !t?.history) return false;
  return t.history(kind);
}

// ---------- as it was ----------

// like refocusStep: the history button that was pressed gets focus back after the redraw
let refocusHist = null;

function historyButtons(tab) {
  const c = tab.cite;
  tab.history = (kind) => {
    const b = root?.querySelector(`.dr-status [data-hist="${kind}"]`);
    if (!b) return false;
    b.click();
    return true;
  };
  if (!['moved', 'unverified', 'missing'].includes(c.status)) return null;
  const btn = (kind, prop, label, key) => {
    const b = h('button', { class: 'btn quiet sm', 'data-hist': kind, 'aria-pressed': String(Boolean(tab[prop])),
      onclick: () => { refocusHist = kind; tab[prop] = !tab[prop]; tab.scrolled = false; tab.scrollTop = null; render(); } }, label, kbd(key));
    if (refocusHist === kind) requestAnimationFrame(() => { refocusHist = null; if (b.isConnected) b.focus({ preventScroll: true }); });
    return b;
  };
  const was = c.sha && !c.dirty ? 'Show as it was' : c.saw ? 'Compare saved lines' : null;
  return [was ? btn('was', 'cmp', was, 'E') : null, c.sha ? btn('changes', 'chg', 'What changed it', 'D') : null];
}

const sha7 = (c) => String(c.sha || '').slice(0, 7);

// The file at the recorded commit, or the lines saved with the answer. Never throws.
function loadWas(tab) {
  tab.was ??= (async () => {
    const c = tab.cite;
    let note = null;
    if (c.sha && !c.dirty) {
      try {
        const r = await api.get(nbPath(state.nbId, `/history/was?path=${encodeURIComponent(c.path)}&sha=${c.sha}`));
        return { text: String(r.text ?? '').replace(/\r\n?/g, '\n'), from: 1, full: true, label: sha7(c), truncated: Boolean(r.truncated), binary: Boolean(r.binary) };
      } catch (e) { note = `Could not read ${sha7(c)}: ${String(e.message).replace(/\.$/, '')}.`; }
    } else if (c.sha) note = 'This file had uncommitted edits when the answer was written, so the commit is not what it read.';
    if (typeof c.saw?.text === 'string') return { text: c.saw.text, from: c.saw.from, full: false, label: 'saved lines', note };
    return { empty: true, note: [note, 'There is nothing saved to compare.'].filter(Boolean).join(' ') };
  })();
  return tab.was;
}

const CMP_ROW = 22;

// rows in the same markup as the code view, so every row is 22px and the two panes stay in step
function cmpRows(lines, from, a, b) {
  let html = '';
  for (let i = 0; i < lines.length; i += 200) {
    html += '<div class="chunk">';
    for (let j = i; j < Math.min(lines.length, i + 200); j++) {
      const n = from + j;
      const hit = a && n >= a && n <= b;
      html += `<div class="l${hit ? ` hit${n === a ? ' first' : ''}${n === b ? ' last' : ''}` : ''}" data-n="${n}"><span class="n">${n}</span><span class="t">${lines[j] || ' '}</span></div>`;
    }
    html += '</div>';
  }
  return html;
}

// the file at the commit beside today's file, the cited lines lined up
async function renderCompare(tab, body, file) {
  const c = tab.cite;
  const was = await loadWas(tab);
  if (!body.isConnected || tabs.find((t) => t.key === active) !== tab || !tab.cmp) return;
  clear(body);
  if (was.empty) { body.append(h('div', { class: 'dr-empty' }, h('p', null, was.note))); return; }
  const lang = (f) => f?.lang || tab.path.split('.').pop();
  const when0 = !was.full && c.saw?.base ? c.saw.at : c.checkedAt0;
  const date = when0 ? ` · ${when(when0)}` : '';
  const a1 = c.line ?? tab.line ?? null, b1 = c.endLine ?? a1;
  const a0 = c.line0 ?? a1, b0 = c.endLine0 ?? c.endLine ?? a0;
  let oldHtml = null, newHtml = null, oldRow = 0, newRow = 0;
  const todayLines = file ? linesFor(`${state.nbId}:${tab.path}`, file, lang(file)) : null;
  if (was.full) {
    if (!was.binary) {
      oldHtml = cmpRows(linesFor(`${state.nbId}:${tab.path}@${c.sha}`, { text: was.text }, lang(file)), 1, a0, b0);
      oldRow = Math.max(0, (a0 || 1) - 1);
    }
    if (todayLines) { newHtml = cmpRows(todayLines, 1, a1, b1); newRow = Math.max(0, (a1 || 1) - 1); }
  } else {
    const saved = highlightLines(was.text, lang(file));
    oldHtml = cmpRows(saved, was.from, was.from, was.from + saved.length - 1);
    if (todayLines && a1) {
      const first = Math.max(1, a1 - 3);
      const part = todayLines.slice(first - 1, (b1 || a1) + 3);
      if (part.length && first <= todayLines.length) { newHtml = cmpRows(part, first, a1, b1); newRow = a1 - first; }
    }
  }
  const pad = align(oldRow, newRow);
  const notes = [was.note, was.truncated ? 'Showing the first 2 MB.' : null].filter(Boolean);
  const pane = (kicker, label, html, none, padRows) => h('div', { class: 'cmp-col', role: 'group', 'aria-label': label },
    h('div', { class: 'cmp-head t-kicker' }, kicker),
    html != null ? h('div', { class: 'code', style: `--pad: ${padRows * CMP_ROW}px`, ...(sourceFor(tab.path)?.layer ? { 'data-layer': sourceFor(tab.path).layer } : {}), html })
      : h('p', { class: 'cmp-none t-ui-sm' }, none));
  const old = pane(was.full ? `As it was · ${was.label}${date}` : `Saved lines${date}`, was.full ? `The file at ${was.label}` : 'Saved lines', oldHtml,
    was.binary ? 'Binary file, not shown.' : 'There is nothing saved to compare.', pad.old);
  const now = pane('Today', 'The file today', newHtml, file ? 'Today\'s file no longer has these lines.' : 'This file is not in the notebook now.', pad.new);
  body.append(h('div', { class: 'dr-cmp' }, notes.length ? h('p', { class: 'cmp-note t-ui-sm' }, notes.join(' ')) : null, old, now));
  if (tab.scrolled && tab.scrollTop != null) { requestAnimationFrame(() => { body.scrollTop = tab.scrollTop; }); return; }
  tab.scrolled = true;
  // the cited line sits at 35% of the drawer height, as in the file view
  requestAnimationFrame(() => {
    body.scrollTop = Math.max(0, (Math.max(oldRow + pad.old, newRow + pad.new)) * CMP_ROW - body.clientHeight * 0.35);
    requestAnimationFrame(() => {
      const el = body.querySelector('.l.first') || body.querySelector('.l.hit');
      if (!el) return;
      body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top - body.clientHeight * 0.35;
    });
  });
}

const span = (a, b) => (!a ? '' : !b || a === b ? `L${a}` : `L${a}-${b}`);
const CHANGE_WORD = { D: 'deleted', R: 'renamed', A: 'added', M: 'changed' };

// commits since the answer that touched the cited lines, from git log -L
function changesPanel(tab) {
  const c = tab.cite;
  const box = h('div', { class: 'dr-changes', role: 'region', 'aria-label': 'Commits since the answer', 'aria-live': 'polite' }, h('p', { class: 't-mono-sm' }, 'Asking git'));
  const fill = (res) => {
    clear(box);
    if (res.error) { box.append(h('p', { class: 't-ui-sm' }, res.error)); return; }
    const r = res.ok;
    const by = r.by === 'path';
    box.append(h('p', { class: 't-ui-sm' }, by ? `Commits since ${sha7(c)} that touched this path.` : `Commits since ${sha7(c)} that touched ${span(c.line, c.endLine) || 'these lines'}, as of the last commit.`));
    if (!r.commits.length) box.append(h('p', { class: 't-ui-sm' }, `No commit since ${sha7(c)} touched ${by ? 'this path' : 'these lines'}.${r.dirtyNow ? ' The difference is in uncommitted edits.' : ''}`));
    else {
      box.append(...r.commits.map((k) => h('button', { class: 'chg-row', title: `Copy ${k.sha}`, onclick: () => copyText(k.sha, `Copied ${k.short}`) },
        h('span', { class: 'chg-sha t-mono-sm' }, k.short),
        h('span', { class: 'chg-sub' }, by && k.change ? `${CHANGE_WORD[k.change]}: ${k.subject}` : k.subject),
        h('span', { class: 'chg-meta t-mono-sm' }, `${k.date} · ${k.author}`))));
      if (r.truncated) box.append(h('p', { class: 't-mono-sm' }, 'Showing the latest 20.'));
      if (r.dirtyNow) box.append(h('p', { class: 't-ui-sm' }, 'This file also has uncommitted edits, which are not commits.'));
    }
  };
  tab.changes ??= api.get(nbPath(state.nbId, `/history/changes?path=${encodeURIComponent(c.path)}&sha=${c.sha}&line=${c.line ?? ''}&endLine=${c.endLine ?? ''}`))
    .then((ok) => ({ ok }), (e) => ({ error: e.message }));
  tab.changes.then((res) => { if (box.isConnected) fill(res); });
  return box;
}

// headings for docs; class, method and field declarations for code
function outline(tab, file) {
  const rows = [];
  const lines = file.text.split('\n');
  if (isDoc(tab.path)) {
    let fence = false;
    lines.forEach((l, i) => {
      if (/^\s*(```|~~~)/.test(l)) fence = !fence;
      const m = !fence && l.match(/^(#{1,4})\s+(.*)/);
      if (m) rows.push({ depth: m[1].length - 1, text: m[2].replace(/[`*_]/g, ''), n: i + 1 });
    });
  } else {
    lines.forEach((l, i) => {
      const cls = l.match(/^(\s*)(?:(?:public|protected|private|abstract|final|static|sealed|export|default)\s+)*(class|interface|enum|record|@interface|function)\s+(\w+)/);
      const fn = !cls && l.match(/^(\s+)(?:(?:public|protected|private|static|final|abstract|synchronized|default|override|async)\s+)+[\w<>?,.[\]\s]*?\b(\w+)\s*\([^;]*$/);
      if (cls) rows.push({ depth: Math.min(3, Math.floor(cls[1].length / 4)), text: cls[3], kind: cls[2], n: i + 1 });
      else if (fn && !/^(if|for|while|switch|return|new)$/.test(fn[2])) rows.push({ depth: Math.min(4, Math.floor(fn[1].length / 4)), text: fn[2] + '()', n: i + 1 });
    });
  }
  if (!rows.length) return h('div', { class: 'dr-empty' }, h('p', null, 'No outline for this file.'));
  const list = h('div', { class: 'tree', role: 'tree', 'aria-label': 'Outline' }, rows.slice(0, 600).map((r) => h('button', { class: 'tree-row', role: 'treeitem', style: { paddingLeft: `${12 + r.depth * 14}px` },
    onclick: () => { tab.line = r.n; tab.endLine = r.n; tab.view = 'file'; tab.scrolled = false; tab.scrollTop = null; tab.cite = null; render(); } },
  h('span', { class: 'tr-name' }, r.text), r.kind ? h('span', { class: 'tr-kind' }, r.kind) : null, h('span', { class: 'grow' }), h('span', { class: 'tr-count' }, r.n))));
  arrowNav(list, '.tree-row');
  return list;
}

// a floating mini toolbar over selected lines: ask about them, or copy their ref
function wireSelection(body, tab) {
  body.addEventListener('mouseup', () => setTimeout(() => {
    const sel = document.getSelection();
    const text = sel?.toString().trim();
    if (!text || !body.contains(sel.anchorNode)) { dropSelBar(); return; }
    const lineOf = (n) => {
      const el = (n.nodeType === 3 ? n.parentElement : n)?.closest('.l, .blk');
      return el ? [Number(el.dataset.n || el.dataset.l1), Number(el.dataset.n || el.dataset.l2)] : [null, null];
    };
    const [a1, a2] = lineOf(sel.anchorNode), [b1, b2] = lineOf(sel.focusNode);
    const l1 = Math.min(a1 ?? b1, b1 ?? a1), l2 = Math.max(a2 ?? b2, b2 ?? a2);
    const ref = l1 ? `L${l1}${l2 && l2 !== l1 ? '-' + l2 : ''}` : '';
    const r = sel.getRangeAt(0).getBoundingClientRect();
    dropSelBar();
    const ask = () => { dropSelBar(); ctx.askAbout?.({ text: text.slice(0, 1200), path: tab.path, line: l1, endLine: l2 }); };
    selBar = h('div', { class: 'selbar', role: 'toolbar', 'aria-label': 'Selection' },
      h('button', { class: 'btn quiet', onclick: ask }, 'Ask about this', kbd('/')),
      h('button', { class: 'btn quiet', onclick: () => { copyText(`${tab.path}${l1 ? ':' + l1 + (l2 !== l1 ? '-' + l2 : '') : ''}`, 'Copied ref'); dropSelBar(); } }, 'Copy ref', ref ? h('span', { class: 't-mono-sm' }, ref) : null));
    selBar.ask = ask;
    selBar.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(selBar);
    selBar.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - selBar.offsetWidth - 8))}px`;
    selBar.style.top = `${Math.max(56, r.top - selBar.offsetHeight - 8)}px`;
  }));
}
function dropSelBar() { selBar?.remove(); selBar = null; }

// Doc links resolve against the doc, not the app, and images we cannot serve become a label.
function wirePage(page, tab) {
  for (const img of page.querySelectorAll('img')) {
    if (!/^(https?:|data:)/i.test(img.getAttribute('src') || '')) img.replaceWith(h('span', { class: 'img-missing' }, img.getAttribute('alt') || 'image'));
  }
  page.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (/^(https?:|mailto:)/i.test(href)) return;
    e.preventDefault();
    if (href.startsWith('#')) {
      const id = decodeURIComponent(href.slice(1));
      (page.querySelector(`[id="${CSS.escape(id)}"]`) || [...page.querySelectorAll('h1,h2,h3,h4')].find((x) => slugish(x.textContent) === slugish(id)))?.scrollIntoView({ block: 'start' });
      return;
    }
    const base = tab.path.split('/').slice(0, -1).join('/');
    let target;
    try { target = decodeURIComponent(new URL(href.replace(/#.*/, ''), 'http://x/' + (base ? base + '/' : '')).pathname.slice(1)); } catch { return; }
    if (!target) return;
    openFile(/\.(md|mdx|txt)$/i.test(target) ? target : target.replace(/\/$/, '') + '.md');
  });
  wireSelection(page.parentElement || page, tab);
}

const slugish = (s) => String(s).toLowerCase().trim().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
const norm = (s) => s.replace(/\s+/g, ' ').trim();

function findQuoteLine(text, quote) {
  const q = norm(quote);
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (norm(lines.slice(i, i + 4).join(' ')).includes(q.slice(0, 60))) return i + 1;
  }
  return null;
}

function markPage(page, tab, body) {
  wireSelection(body, tab);
  const a = tab.line || 0, b = tab.endLine || a;
  const cited = tab.cite && statusOf(tab.cite) === 'moved' ? tab.cite.citedLine : null;
  let first = null;
  for (const blk of page.querySelectorAll('.blk')) {
    const l1 = +blk.dataset.l1, l2 = +blk.dataset.l2;
    if (a && l2 >= a && l1 <= b) { blk.classList.add('hit'); first ||= blk; }
    if (cited && l1 <= cited && l2 >= cited && !(l2 >= a && l1 <= b)) blk.classList.add('cited');
  }
  if (first && cited) first.dataset.tag = 'found here';
  const src = sourceFor(tab.path);
  if (src) page.dataset.layer = src.layer;
  if (tab.quote && window.CSS?.highlights && window.Highlight) {
    const range = findTextRange(first || page, tab.quote) || findTextRange(page, tab.quote);
    if (range) {
      CSS.highlights.set('cite', new Highlight(range));
      if (!first) first = range.startContainer.parentElement;
    }
  }
  if (first && !tab.scrolled) {
    tab.scrolled = true;
    body.scrollTop = Math.max(0, first.offsetTop - body.clientHeight * 0.35);
  }
}

// ---------- what depends on a line (DESIGN 11.18) ----------
// GET /cited lists the saved answers, sheets and notes that cite this file. Marks are an extra: any failure leaves the file as it was.

async function loadDeps(host) {
  if (!host.body.isConnected) return;
  const my = ++depSeq;
  let r;
  try { r = await api.get(nbPath(state.nbId, '/cited?path=' + encodeURIComponent(host.tab.path))); } catch { return; }
  if (my !== depSeq || depHost !== host || !host.body.isConnected) return;
  depRefs = Array.isArray(r?.refs) ? r.refs : [];
  depTrunc = !!r?.truncated;
  paintDeps(host);
}

function paintDeps(host) {
  for (const el of host.body.querySelectorAll('.dep')) el.classList.remove('dep', 'st-verified', 'st-moved', 'st-unverified', 'st-pending');
  for (const b of host.body.querySelectorAll('.dmark')) b.remove();
  host.bar.querySelector('.dr-cited')?.remove();
  hideDeps();
  if (!depRefs.length) return;
  if (host.code) {
    depMap = lineMap(depRefs, host.lineCount);
    for (const [n, e] of depMap) {
      const el = host.code.children[(n - 1) / 200 | 0]?.children[(n - 1) % 200];
      if (!el?.classList.contains('l')) continue;
      el.classList.add('dep', 'st-' + e.status);
      if (e.start) el.querySelector('.n')?.prepend(dmark(e));
    }
  } else {
    for (const blk of host.page.querySelectorAll('.blk')) {
      const refs = refsIn(depRefs, +blk.dataset.l1, +blk.dataset.l2);
      if (!refs.length) continue;
      const st = worst(refs.map((r) => r.status));
      blk.classList.add('dep', 'st-' + st);
      blk.prepend(dmark({ refs, status: st }));
    }
  }
  if (!host.wired) {
    host.wired = true;
    (host.code || host.page).addEventListener('pointerover', depOver);
    (host.code || host.page).addEventListener('pointerout', depOut);
    host.body.addEventListener('scroll', () => hideDeps(), { passive: true });
  }
  const st = worst(depRefs.map((r) => r.status));
  const count = new Set(depRefs.map((r) => `${r.kind}:${r.id}:${r.turn ?? ''}`)).size;
  const btn = h('button', { type: 'button', class: `btn quiet sm dr-cited st-${st}`, 'aria-haspopup': 'dialog', onclick: () => showDeps(depRefs, btn, true, true) },
    glyph(st, 'glyph sm'), `Cited by ${count}${depTrunc ? '+' : ''}`);
  host.bar.querySelector('.grow')?.after(btn);
}

// a mouse and touch target only: hundreds of tab stops would be worse than none, the header button is the keyboard way in
function dmark(e) {
  const n = e.refs.length;
  return h('button', { type: 'button', class: 'dmark', tabindex: -1, 'aria-label': `${n} saved citation${n === 1 ? '' : 's'} here, ${STATUS_WORD[e.status]}`,
    onclick: (ev) => { ev.stopPropagation(); if (n === 1) openDep(e.refs[0]); else showDeps(e.refs, ev.currentTarget, true); } }, glyph(e.status, 'glyph sm'));
}

let depAt = null; // the line or block the open list belongs to
const DEP_HIT = '.l.dep .n, .blk.dep .dmark';
const refsFor = (el) => (el.matches('.blk') ? refsIn(depRefs, +el.dataset.l1, +el.dataset.l2) : depMap.get(+el.dataset.n)?.refs || []);

function depOver(e) {
  const x = e.target.closest?.(DEP_HIT);
  if (!x || depEl?.classList.contains('pinned')) return;
  const el = x.closest('.l, .blk');
  clearTimeout(depTimer);
  if (depAt === el) return;
  depTimer = setTimeout(() => { showDeps(refsFor(el), x, false); depAt = el; }, 120);
}

function depOut(e) {
  const x = e.target.closest?.(DEP_HIT);
  if (!x || x.contains(e.relatedTarget) || depEl?.classList.contains('pinned')) return;
  clearTimeout(depTimer);
  depTimer = setTimeout(() => hideDeps(), 160);
}

function hideDeps() {
  clearTimeout(depTimer);
  depEl?.remove();
  depEl = null;
  depAt = null;
}

function openDep(r) { hideDeps(); ctx.openDependent?.(r); }

const sheetNum = (r) => { const i = state.recipes.findIndex((x) => x.id === r.recipe); return i < 0 ? null : String(i + 1).padStart(2, '0'); };

function depLabel(r) {
  const cite = r.n != null ? ` [${r.n}]` : '';
  if (r.kind === 'answer') { const q = qnum(r.id); return (q ? `Q${q}${r.turn > 0 ? '.' + (r.turn + 1) : ''}` : r.title || 'Answer') + cite; }
  if (r.kind === 'sheet') { const no = sheetNum(r); return `${no ? `Sheet ${no}` : r.title || 'Sheet'}${r.node != null ? (r.node ? ` node ${r.node}` : ' data ref') : cite}`; }
  return `Note ${r.title || r.id}${cite}`;
}

function depRow(r) {
  const st = stShown(r.status);
  const sub = r.kind === 'answer' ? r.question : r.kind === 'sheet' ? r.title : '';
  const at = r.line ? `L${r.line}${r.endLine && r.endLine !== r.line ? '-' + r.endLine : ''}${st === 'moved' && r.citedLine ? ` · cited L${r.citedLine}` : ''}` : '';
  return h('button', { type: 'button', class: `dc-row st-${st}`, onclick: () => openDep(r) }, glyph(st, 'glyph sm'),
    h('div', { class: 'dc-main' }, h('div', { class: 'dc-label' }, depLabel(r)), sub ? h('div', { class: 'dc-sub' }, sub) : null),
    h('div', { class: 'dc-st' }, h('div', null, STATUS_WORD[st]), at ? h('div', { class: 't-mono-sm' }, at) : null));
}

function showDeps(refs, anchor, pinned, whole = false) {
  hideDeps();
  const list = h('div', { class: 'dc-list' }, refs.map(depRow));
  arrowNav(list, '.dc-row');
  depEl = h('div', { class: 'hovercard depcard' + (pinned ? ' pinned' : ''), role: 'dialog', 'aria-label': 'Cited here' },
    h('div', { class: 'hc-head' }, h('span', { class: 't-kicker' }, whole ? 'Cited in this file' : 'Cited here'), h('span', { class: 'grow' }), h('span', { class: 't-mono-sm' }, refs.length)), list);
  depEl.opener = anchor;
  depEl.addEventListener('pointerenter', () => clearTimeout(depTimer));
  depEl.addEventListener('pointerleave', () => { if (!pinned) depTimer = setTimeout(() => hideDeps(), 160); });
  document.body.append(depEl);
  place(depEl, anchor.getBoundingClientRect());
  if (whole) list.querySelector('.dc-row')?.focus();
}

function findTextRange(scope, quote) {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let all = '';
  for (let n; (n = walker.nextNode());) { nodes.push({ n, at: all.length }); all += n.data; }
  const flat = all.replace(/\s/g, ' ');
  let q = norm(quote);
  const idx = flat.indexOf(q);
  if (idx >= 0) return rangeAt(nodes, idx, idx + q.length);
  // whitespace-insensitive search over a collapsed copy, mapped back
  const map = [];
  let col = '';
  for (let i = 0; i < flat.length; i++) {
    if (flat[i] === ' ' && col.endsWith(' ')) continue;
    map.push(i); col += flat[i];
  }
  let j = col.indexOf(q);
  if (j < 0) {
    q = q.split(' ').slice(0, 6).join(' ');
    j = col.indexOf(q);
    if (j < 0) return null;
  }
  return rangeAt(nodes, map[j], map[j + q.length - 1] + 1);
}

function rangeAt(nodes, start, end) {
  const loc = (pos) => {
    for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i].at <= pos) return [nodes[i].n, Math.min(pos - nodes[i].at, nodes[i].n.length)];
    return null;
  };
  const s = loc(start), e = loc(end);
  if (!s || !e) return null;
  const r = document.createRange();
  r.setStart(...s); r.setEnd(...e);
  return r;
}

// ---------- a source's files (DESIGN 11.17) ----------

function renderSource(tab, body) {
  const s = tab.src;
  root.append(head({ src: s, name: s.name, path: s.path }));
  root.append(h('div', { class: 'dr-tabs' }, h('span', { class: 't-kicker' }, s.root ? 'Code root' : s.kind === 'primer' ? 'Primers' : 'Pinned docs'), h('span', { class: 'grow' }),
    h('span', { class: 't-mono-sm' }, s.count != null ? `${s.count.toLocaleString()} files` : '')));
  const tree = h('div', { class: 'tree', role: 'tree', 'aria-label': `${s.name} files` });
  body.append(tree);
  const row = (name, depth, isDir, onOpen, path) => {
    const b = h('button', { class: 'tree-row', role: 'treeitem', style: { paddingLeft: `${12 + depth * 14}px` }, title: path || name, 'aria-expanded': isDir ? 'false' : null },
      h('span', { class: 'chev' }, isDir ? icon('chev', 12) : null), h('span', { class: 'tr-name' }, name));
    b.addEventListener('click', onOpen);
    return b;
  };
  if (s.root) {
    const fill = async (dir, depth, after) => {
      const entries = await loadDir(s.root.name, dir).catch((e) => { toast(e.message); return []; });
      let at = after;
      for (const e of entries.slice(0, 1000)) {
        const sub = dir ? `${dir}/${e.name}` : e.name;
        const path = e.path || `${s.root.path}/${sub}`;
        const r = e.dir ? row(e.name, depth, true, async () => {
          const open = r.getAttribute('aria-expanded') === 'true';
          r.setAttribute('aria-expanded', String(!open));
          if (open) { let n = r.nextElementSibling; while (n && Number(n.dataset.depth) > depth) { const x = n.nextElementSibling; n.remove(); n = x; } }
          else await fill(sub, depth + 1, r);
        }, sub) : row(e.name, depth, false, () => openFile(path), path);
        r.dataset.depth = depth;
        if (at) at.after(r); else tree.append(r);
        at = r;
      }
    };
    fill('', 0, null);
  } else {
    // pinned docs: build folders from the paths under the source prefix
    const dirs = new Map();
    for (const f of s.files) {
      const rel = f.slice(s.prefix.length);
      const parts = rel.split('/');
      const name = parts.pop();
      const dir = parts.join('/');
      if (!dirs.has(dir)) dirs.set(dir, []);
      dirs.get(dir).push({ name, path: f });
    }
    const common = [...dirs.keys()].reduce((p, d) => { while (p && !(d + '/').startsWith(p + '/')) p = p.split('/').slice(0, -1).join('/'); return p; }, [...dirs.keys()][0] || '');
    for (const [dir, list] of [...dirs].sort((a, b) => a[0].localeCompare(b[0]))) {
      const label = dir.slice(common.length).replace(/^\//, '');
      if (label) tree.append(h('div', { class: 'tree-row dir', role: 'presentation' }, h('span', { class: 'chev' }, icon('down', 12)), h('span', { class: 'tr-name' }, label)));
      for (const f of list) tree.append(row(f.name, label ? 1 : 0, false, () => openFile(f.path), f.path));
    }
  }
  arrowNav(tree, '.tree-row:not(.dir)');
}

// ---------- search ----------

let searchSeq = 0;

function renderSearch(tab, body) {
  root.append(head({ name: 'Search all sources' }));
  const input = h('input', { type: 'search', class: 'input', value: tab.q || '', placeholder: 'Search pinned docs and code roots', 'aria-label': 'Search text' });
  const rx = h('button', { class: 'btn quiet sm', 'aria-pressed': String(!!tab.regex), title: 'Regular expression', onclick: () => { tab.regex = !tab.regex; rx.setAttribute('aria-pressed', String(tab.regex)); run(); } }, '.*');
  const list = h('div', { class: 'search-results' });
  const run = async () => {
    const q = input.value.trim();
    tab.q = q;
    tab.title = q ? `Search: ${q}` : 'Search';
    if (!q) { clear(list); return; }
    const seq = ++searchSeq;
    clear(list).append(h('div', { class: 'search-meta' }, 'Searching'));
    const t0 = performance.now();
    try {
      const r = await api.get(nbPath(state.nbId, `/search?q=${encodeURIComponent(q)}&regex=${tab.regex ? 1 : 0}`));
      if (seq !== searchSeq) return;
      tab.results = Array.isArray(r) ? r : r.hits || r.results || [];
      tab.meta = { ms: r.ms ?? ((performance.now() - t0) | 0), truncated: !!r.truncated, engine: r.engine || null };
      drawResults(list, tab, q);
    } catch (e) {
      if (seq !== searchSeq) return;
      clear(list).append(h('div', { class: 'search-meta' }, e.message));
    }
  };
  let t;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 220); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(t); run(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); list.querySelector('.search-hit')?.focus(); }
  });
  root.append(h('div', { class: 'dr-tabs search-head' }, icon('search', 14), input, rx));
  body.append(list);
  arrowNav(list, '.search-hit');
  if (tab.results) drawResults(list, tab, tab.q);
  else if (tab.q) run();
  setTimeout(() => { input.focus(); input.select(); }, 0);
}

function matcher(q, regex) {
  try { return new RegExp(regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), /[A-Z]/.test(q) ? 'g' : 'gi'); } catch { return null; }
}

function drawResults(list, tab, q) {
  clear(list);
  const hits = tab.results || [];
  const { ms = null, truncated = false, engine = null } = tab.meta || {};
  const groups = new Map();
  for (const hit of hits) { if (!groups.has(hit.path)) groups.set(hit.path, []); groups.get(hit.path).push(hit); }
  list.append(h('div', { class: 'search-meta' },
    hits.length ? `${hits.length}${truncated ? '+' : ''} matches in ${groups.size} files` : 'No matches',
    ms != null ? ` · ${ms} ms` : '', engine ? ` · ${engine}` : '', /[A-Z]/.test(q) ? ' · case-sensitive' : ''));
  const re = matcher(q, tab.regex);
  for (const [path, hs] of groups) {
    const grp = h('div', null, h('div', { class: 'search-file' }, swatch(sourceFor(path), true), h('span', { class: 'fp', title: path }, h('bdi', null, shortPath(path, 4))), h('span', { class: 'c' }, hs.length)));
    for (const hit of hs) {
      const text = String(hit.text ?? '').slice(0, 400);
      let html = esc(text);
      if (re) {
        re.lastIndex = 0;
        let out = '', last = 0, m, guard = 0;
        while ((m = re.exec(text)) && guard++ < 50) {
          if (!m[0].length) { re.lastIndex++; continue; }
          out += esc(text.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>';
          last = m.index + m[0].length;
        }
        html = out + esc(text.slice(last));
      }
      grp.append(h('button', { class: 'search-hit', onclick: () => openFile(path, { line: hit.line, endLine: hit.line, mode: isDoc(path) ? 'code' : undefined }) },
        h('span', { class: 'n' }, hit.line), h('span', { class: 'tx', html })));
    }
    list.append(grp);
  }
}

// ---------- notes ----------

async function renderNote(tab, body) {
  const note = tab.note;
  let text = note.body;
  const del = h('button', { class: 'btn quiet sm', onclick: async () => {
    const { confirmDialog } = await import('./dialogs.js');
    if (!(await confirmDialog({ title: 'Delete this note?', body: `"${note.title}" will be deleted.`, confirm: 'Delete' }))) return;
    try {
      await api.del(nbPath(state.nbId, `/notes/${encodeURIComponent(note.slug)}`), { slug: note.slug });
      closeTab(tab.key);
      ctx.refreshNotebook();
      toast('Note deleted', 'info', 2000);
    } catch (e) { toast(e.message); }
  } }, icon('trash', 14), 'Delete');
  const copy = h('button', { class: 'btn quiet sm', onclick: () => copyText(text || '', 'Note copied') }, 'Copy');
  root.append(head({ name: note.title, path: note.path, extra: [] }), h('div', { class: 'dr-tabs' }, h('span', { class: 't-kicker' }, 'Note'), h('span', { class: 'grow' }), copy, del));
  if (text == null) {
    body.append(h('div', { class: 'dr-loading' }, `Reading ${note.title}`));
    try { text = (await api.get(nbPath(state.nbId, `/notes/${encodeURIComponent(note.slug)}`))).body ?? ''; note.body = text; }
    catch (e) { clear(body).append(h('div', { class: 'dr-empty' }, h('p', null, e.message))); return; }
    clear(body);
  }
  const { body: md, cites } = splitFootnotes(text);
  const prose = h('div', { class: 'prose has-cites', html: renderAnswer(md, cites).html });
  prose.cites = new Map(cites.map((c) => [String(c.n), c]));
  const page = h('div', { class: 'page' }, prose);
  if (cites.length) {
    page.append(h('section', { class: 'note-cites' }, h('div', { class: 't-kicker' }, `Citations ${cites.length}`),
      cites.map((c) => h('button', { class: `nc-row st-${statusOf(c)}`, onclick: () => openFile(c.path, { line: c.line, endLine: c.endLine, quote: c.quote, cite: c, list: cites }) },
        glyph(statusOf(c), 'glyph sm'), h('span', { class: 'n' }, c.n), h('span', { class: 'p', title: c.path }, h('bdi', null, shortPath(c.path, 3) + (c.line ? ':' + c.line : ''))), h('span', { class: 'st-word' }, STATUS_WORD[statusOf(c)])))));
  }
  body.append(page);
}
