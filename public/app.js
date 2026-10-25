// Boot, cross-module actions, the keyboard model (DESIGN 10) and the key strip hints.

import { h, clear, icon, toast, store } from './ui/dom.js';
import { api, nbPath, initApi, mockMode } from './ui/api.js';
import { state, ctx, on, emit, normNotebookSummary, normNotebook, normConversation, MODELS } from './ui/state.js';
import { initRail, focusHistory } from './ui/rail.js';
import { initChat, renderThread, focusComposer, copyAnswer, stopStreaming } from './ui/chat.js';
import { initViewer, openFile, openSearch, openNote, openSource, closeViewer, viewerOpen, showViewer, viewerHasTabs, stepDrawerCitation } from './ui/viewer.js';
import { initCites, openCitation, moveCursor, pinCitation, stepCitation, openCursor, pinCursor, challenge, clearCursor, cursorClaim } from './ui/cites.js';
import { openPalette, closePalette, paletteOpen } from './ui/palette.js';
import { openAddSource, openNewNotebook, initDrop, openShortcuts } from './ui/dialogs.js';
import { initPanes } from './ui/panes.js';
import { initStudio, openRecipe } from './ui/studio.js';
import { initCanvas, openArtifact, closeCanvas, canvasOpen } from './ui/canvas.js';
import { initChrome, effectiveTheme, syncTheme } from './ui/chrome.js';
import { kbd, glyph } from './ui/layers.js';

const app = document.getElementById('app');

Object.assign(ctx, {
  openFile, openSearch, openNote, openSource, openCitation, showViewer,
  viewerHidden: () => viewerHasTabs() && !viewerOpen(),
  openPalette, openAddSource, openNewNotebook, openShortcuts,
  openRecipe, openArtifact, closeCanvas, focusComposer, copyAnswer,
  challengeCursor: () => (cursorClaim() ? challenge() : false),
  syncHash: () => setHash(),
  setTitle: () => emit('conversation'),

  // wide screens keep Studio as a column; narrow ones float it over the page
  toggleStudio(force) {
    const narrow = window.matchMedia('(max-width: 1180px)').matches;
    const cls = narrow ? 'studio-float' : 'studio-closed';
    const open = force ?? (narrow ? !app.classList.contains(cls) : app.classList.contains(cls));
    if (narrow) app.classList.toggle('studio-float', open);
    else { app.classList.toggle('studio-closed', !open); store.set('studioOpen2', open); }
    document.getElementById('studio').inert = !open;
    emit('studio', open);
  },
  studioShown() {
    const narrow = window.matchMedia('(max-width: 1180px)').matches;
    return narrow ? app.classList.contains('studio-float') : !app.classList.contains('studio-closed');
  },

  // underline-only mode (Shift+H), remembered
  toggleBands() {
    const on = !document.documentElement.classList.contains('no-bands');
    document.documentElement.classList.toggle('no-bands', on);
    store.set('noBands', on);
  },

  copyPlain() {
    const t = state.conv?.turns.at(-1);
    if (t) navigator.clipboard?.writeText(t.answer.replace(/\[\^(\d+)\]/g, '')).then(() => toast('Markdown copied', 'ok', 1800));
  },

  async loadNotebooks() {
    const r = await api.get('/api/notebooks');
    state.notebooks = (Array.isArray(r) ? r : r.notebooks || []).map(normNotebookSummary);
    emit('notebooks');
  },

  async selectNotebook(id, opts = {}) {
    if (state.streaming) { toast('Stop the current answer before switching notebooks.', 'info'); return; }
    const summary = state.notebooks.find((n) => n.id === id);
    let detail;
    try { detail = await api.get(nbPath(id)); }
    catch (e) { toast(`Could not open ${id}: ${e.message}`); return; }
    state.nbId = id;
    state.nb = normNotebook({ id, ...detail }, summary);
    state.conv = null;
    state.convId = null;
    state.fileIndex = null;
    if (canvasOpen()) closeCanvas({ keepHash: true });
    store.set('lastNotebook', id);
    document.documentElement.dataset.hue = state.nb.hue;
    document.title = `${state.nb.title} · Lectern`;
    emit('notebook');
    setHash();
    const last = (opts.conv !== undefined ? opts.conv : store.get('conv.' + id, null));
    if (last && state.nb.conversations.some((c) => c.id === last)) await ctx.openConversation(last);
    if (opts.artifact) await openArtifact(opts.artifact);
  },

  async refreshNotebook() {
    if (!state.nbId) return;
    try {
      const detail = await api.get(nbPath(state.nbId));
      state.nb = normNotebook({ id: state.nbId, ...detail }, state.notebooks.find((n) => n.id === state.nbId));
      emit('refresh');
    } catch (e) { toast(e.message); }
  },

  async openConversation(id) {
    if (state.streaming) { toast('Stop the current answer first.', 'info'); return; }
    try {
      const c = await api.get(`/api/conversations/${encodeURIComponent(state.nbId)}/${encodeURIComponent(id)}`);
      state.conv = normConversation({ id, ...c });
      state.convId = id;
      // a follow-up stays on the model the conversation last used, not the composer's last pick
      const last = state.conv.turns?.at(-1)?.model;
      if (MODELS.some((m) => m.id === last)) state.model = last;
      store.set('conv.' + state.nbId, id);
      if (canvasOpen()) closeCanvas({ keepHash: true });
      clearCursor();
      setHash();
      renderThread();
      emit('conversation');
      app.classList.remove('rail-open');
    } catch (e) { toast(`Could not open the question: ${e.message}`); }
  },

  newConversation() {
    if (state.streaming) { toast('Stop the current answer first.', 'info'); return; }
    state.conv = null;
    state.convId = null;
    store.set('conv.' + state.nbId, null);
    if (canvasOpen()) closeCanvas({ keepHash: true });
    clearCursor();
    setHash();
    renderThread();
    emit('conversation');
    focusComposer();
  },

  // theme flips with every transition off (DESIGN 8.3)
  toggleTheme() {
    const root = document.documentElement;
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    const freeze = document.createElement('style');
    freeze.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
    document.head.append(freeze);
    root.dataset.theme = next;
    void getComputedStyle(document.body).opacity;
    freeze.remove();
    try { localStorage.setItem('nb.theme', next); } catch {}
    syncTheme();
  },
});

// ---------- key strip ----------

const HINTS = {
  page: ['Page', [['J', 'next claim'], ['K', 'previous'], ['1-9', 'citation'], ['O', 'open at line'], ['C', 'copy'], ['/', 'ask'], ['P', 'studio']]],
  composer: ['Ask', [['Enter', 'ask'], ['Shift Enter', 'new line'], ['Up', 'edit last question'], ['M', 'model'], ['/', 'new question'], ['Esc', 'back to page']]],
  drawer: ['Drawer', [['[ ]', 'citation'], ['/', 'ask about selection'], ['Esc', 'back to answer']]],
  palette: ['Palette', [['Up Down', 'move'], ['Enter', 'open'], ['Ctrl 1-9', 'pick row'], ['Tab', 'scope'], ['Esc', 'close']]],
  rail: ['Rail', [['Up Down', 'move'], ['Enter', 'open'], ['H', 'history'], ['A', 'add source'], ['Ctrl 2', 'page']]],
  setup: ['Setup', [['Tab', 'next field'], ['Enter', 'add source'], ['Ctrl Enter', 'start asking'], ['Ctrl K', 'palette'], ['?', 'shortcuts']]],
  studio: ['Studio', [['a-z', 'type to filter'], ['00', 'jump'], ['Enter', 'open'], ['V', 'list view'], ['Esc', 'back']]],
  // artifact canvases, picked by renderer kind (copied from the boards)
  map: ['Map', [['F', 'find'], ['Left Right', 'walk nodes'], ['Enter', 'detail'], ['O', 'open at line'], ['+ -', 'zoom'], ['0', 'fit'], ['M', 'matrix'], ['P', 'studio'], ['Esc', 'back']]],
  sequence: ['Sequence', [['Up Down', 'step'], ['Enter', 'open ref'], ['O', 'open at line'], ['[ ]', 'citation'], ['Ctrl B', 'sources'], ['P', 'studio'], ['Esc', 'back']]],
  plan: ['Plan', [['J', 'next task'], ['K', 'previous'], ['Enter', 'open detail'], ['X', 'check next item'], ['O', 'open file'], ['V', 'list view'], ['P', 'studio'], ['Esc', 'back']]],
  cards: ['Cards', [['Space', 'flip'], ['Right', 'got it'], ['Left', 'again'], ['S', 'shuffle'], ['1-9', 'citation'], ['O', 'open at line'], ['P', 'studio'], ['Esc', 'back']]],
  quiz: ['Quiz', [['Enter', 'check'], ['Right', 'next'], ['Left', 'previous'], ['P', 'studio'], ['Esc', 'back']]],
  sheet: ['Sheet', [['1-9', 'citation'], ['O', 'open at line'], ['C', 'copy'], ['P', 'studio'], ['Esc', 'back']]],
};
const CANVAS_HINTS = { graph: 'map', sequence: 'sequence', plan: 'plan', doc: 'sheet', file: 'sheet' };
let pane = null;
function setHints(p) {
  if (p === pane) return;
  pane = p;
  const [label, rows] = HINTS[p] || HINTS.page;
  document.getElementById('ks-hints')?.replaceChildren(h('span', { class: 't-kicker' }, label),
    ...rows.map(([k, t]) => h('span', { class: 'ks' }, kbd(...k.split(' ')), t)));
  // Studio names its group tints on the right instead of the citation marks
  const legend = document.querySelector('.ks-legend');
  if (legend) {
    legend._marks ??= [...legend.childNodes];
    if (p === 'studio') {
      legend.setAttribute('aria-label', 'Recipe groups');
      legend.replaceChildren(...['plan', 'visual', 'agent', 'learn', 'code'].map((g) => h('span', { class: 'ks ks-group', dataset: { group: g } }, h('span', { class: 'swatch sm', 'aria-hidden': 'true' }), g)));
    } else if (legend.getAttribute('aria-label') !== 'Citation marks') {
      legend.setAttribute('aria-label', 'Citation marks');
      legend.replaceChildren(...legend._marks);
    }
  }
}
// the open sheet's renderer decides its grammar; quizzes switch between cards and questions
function canvasPane() {
  const body = document.querySelector('#canvas .canvas-body');
  const kind = body?.dataset.kind;
  if (kind === 'quiz') return body.querySelector('.r-quiz [data-mode="quiz"], [data-mode="quiz"]') ? 'quiz' : 'cards';
  return CANVAS_HINTS[kind] || 'sheet';
}
function paneOf(el) {
  if (paletteOpen()) return 'palette';
  if (el?.closest?.('.drawer')) return 'drawer';
  if (el?.closest?.('.rail')) return 'rail';
  if (el?.closest?.('.studio')) return 'studio';
  if (el?.closest?.('.composer')) return 'composer';
  if (canvasOpen()) return canvasPane();
  if (ctx.studioShown?.() && !el?.closest?.('#chat')) return 'studio';
  if (!el || el === document.body) return document.querySelector('.onboard') ? 'setup' : 'page';
  if (el.closest('.onboard')) return 'setup';
  return 'page';
}
document.addEventListener('focusin', (e) => setHints(paneOf(e.target)));
on('pane', (p) => setHints(p === 'page' ? paneOf(document.activeElement) : p));
on('artifacts', () => requestAnimationFrame(() => setHints(paneOf(document.activeElement))));
on('studio', () => requestAnimationFrame(() => setHints(paneOf(document.activeElement))));
document.addEventListener('click', () => setHints(paneOf(document.activeElement)));

// ---------- keys ----------

function globalKeys(e) {
  if (e.defaultPrevented) return;
  const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  const modal = document.querySelector('dialog[open]');
  if (mod && k === 'k') { e.preventDefault(); paletteOpen() ? closePalette() : openPalette(); return; }
  if (mod && e.shiftKey && k === 'l') { e.preventDefault(); ctx.toggleTheme(); return; }
  if (mod && e.shiftKey && k === 'f') { e.preventDefault(); openSearch(''); return; }
  if (mod && k === 'b') { e.preventDefault(); app.classList.toggle('rail-open'); if (app.classList.contains('rail-open')) document.querySelector('.rail .src-open, .rail .h-open')?.focus(); return; }
  if (mod && ['1', '2', '3'].includes(e.key) && !paletteOpen()) {
    e.preventDefault();
    if (e.key === '1') (document.querySelector('.rail .src-open, .rail .h-open'))?.focus();
    else if (e.key === '2') document.getElementById('page-scroll')?.focus();
    else (document.querySelector('.turn:last-of-type .mcard') || document.querySelector('.turn:last-of-type .margin'))?.focus();
    return;
  }
  if (e.altKey && k === 'n') { e.preventDefault(); ctx.newConversation(); return; }
  if (e.key === 'Escape' && !typing && !paletteOpen() && !modal && !document.querySelector('.menu')) {
    if (viewerOpen()) closeViewer();
    else if (app.classList.contains('rail-open')) app.classList.remove('rail-open');
    else if (app.classList.contains('studio-float')) ctx.toggleStudio(false);
    else if (state.streaming) stopStreaming();
    else clearCursor();
    return;
  }
  if (typing || mod || e.altKey || modal || paletteOpen()) return;
  const inDrawer = e.target.closest?.('.drawer');
  const act = (fn) => { e.preventDefault(); fn(); };
  switch (e.key) {
    case '/': return act(() => focusComposer());
    case '?': return act(() => openShortcuts());
    case 'j': case 'J': if (!e.shiftKey) return act(() => moveCursor(1)); break;
    case 'k': case 'K': if (!e.shiftKey) return act(() => moveCursor(-1)); break;
    case 'o': case 'O': return act(() => openCursor());
    case 'c': case 'C': return act(() => copyAnswer());
    case 'x': case 'X': return act(() => { if (!challenge()) toast('Pick a claim with J and K first, then press X.', 'info', 2400); });
    case 'w': case 'W': return act(() => document.querySelector('.turn:last-of-type .btn.scrutiny')?.click());
    case 'l': case 'L': return act(() => { const btn = [...document.querySelectorAll('#chat .trail-sum')].at(-1); btn?.click(); });
    case 'h': return act(() => focusHistory());
    case 'H': return act(() => ctx.toggleBands());
    case 'n': case 'N': return act(() => ctx.newConversation());
    case 'p': case 'P': return act(() => ctx.toggleStudio());
    case 'a': case 'A': return act(() => openAddSource());
    case '[': return act(() => { if (!((inDrawer || viewerOpen()) && stepDrawerCitation(-1))) stepCitation(-1); });
    case ']': return act(() => { if (!((inDrawer || viewerOpen()) && stepDrawerCitation(1))) stepCitation(1); });
    case 'Enter': if (cursorClaim() && !e.target.closest('button, a')) return act(() => pinCursor()); break;
    case 'End': if (state.streaming) return act(() => { const sc = document.getElementById('page-scroll'); sc.scrollTop = sc.scrollHeight; }); break;
    default:
      if (/^[1-9]$/.test(e.key)) return act(() => pinCitation(Number(e.key)));
  }
}

// #/<notebook>[/<conversation>] or #/<notebook>/artifact/<id>
function setHash() {
  const tail = state.artifactId ? '/artifact/' + encodeURIComponent(state.artifactId) : state.convId ? '/' + encodeURIComponent(state.convId) : '';
  const want = state.nbId ? `#/${encodeURIComponent(state.nbId)}${tail}` : '';
  if (location.hash !== want) history.replaceState(null, '', want || location.pathname + location.search);
}

function readHash() {
  const [nb, conv, aid] = location.hash.replace(/^#\/?/, '').split('/').map((s) => s && decodeURIComponent(s));
  if (conv === 'artifact') return { nb: nb || null, conv: null, artifact: aid || null };
  return { nb: nb || null, conv: conv || null, artifact: null };
}

async function followHash() {
  const { nb, conv, artifact } = readHash();
  if (!nb || !state.notebooks.some((n) => n.id === nb)) return false;
  if (nb !== state.nbId) await ctx.selectNotebook(nb, { conv, artifact });
  else if (artifact && artifact !== state.artifactId) await openArtifact(artifact);
  else if (!artifact && canvasOpen()) closeCanvas({ keepHash: true });
  if (nb === state.nbId && conv && conv !== state.convId) await ctx.openConversation(conv);
  return true;
}

function fatal(msg, retry) {
  clear(document.querySelector('#chat .page-inner') || document.getElementById('chat')).append(h('div', { class: 'fatal' },
    h('div', { class: 'banner error', role: 'alert' }, glyph('unverified'),
      h('div', { class: 'bn-body' }, h('strong', null, 'The notebook server is not answering. '), msg, h('br'),
        'Start it with ', h('code', null, 'node app/server.mjs'), ', or open the page with ', h('code', null, '?mock=1'), ' to try the UI on fake data.')),
    h('button', { class: 'btn primary', onclick: retry }, 'Try again')));
}

async function boot() {
  await initApi();
  initPanes(app);
  initChrome();
  initRail(document.getElementById('rail'));
  initChat(document.getElementById('chat'));
  initCanvas(document.getElementById('canvas'));
  initStudio(document.getElementById('studio'));
  initViewer(document.getElementById('viewer'));
  // Studio is a separate view now, so it starts closed and P opens it
  if (store.get('studioOpen2', false) !== true) app.classList.add('studio-closed');
  document.getElementById('studio').inert = !ctx.studioShown();
  if (store.get('noBands', false)) document.documentElement.classList.add('no-bands');
  // the narrow rail sheet needs a way in from the top bar
  document.querySelector('.tb-brand')?.before(h('button', { class: 'icon-btn tb-rail', 'aria-label': 'Sources and history (Ctrl+B)', title: 'Sources and history  Ctrl+B', onclick: () => app.classList.toggle('rail-open') }, icon('menu')));
  app.addEventListener('pointerdown', (e) => {
    if (app.classList.contains('studio-float') && !e.target.closest('.studio, .drawer, .toasts, dialog, .menu')) ctx.toggleStudio(false);
    if (app.classList.contains('rail-open') && !e.target.closest('.rail, .menu, dialog')) app.classList.remove('rail-open');
  });
  window.matchMedia('(max-width: 1180px)').addEventListener('change', () => { app.classList.remove('studio-float'); document.getElementById('studio').inert = !ctx.studioShown(); emit('studio'); });
  initCites();
  initDrop();
  document.addEventListener('keydown', globalKeys);
  setHints('page');
  if (mockMode) toast('Mock mode: fake notebooks and a scripted answer stream.', 'info', 3500);
  api.get('/api/status').then((s) => { state.status = s; emit('status'); }).catch(() => { state.status = { found: false }; emit('status'); });
  try {
    await ctx.loadNotebooks();
  } catch (e) {
    fatal(e.message, () => location.reload());
    return;
  }
  if (!state.notebooks.length) { ctx.firstRun = true; emit('firstrun'); renderThread(); setHints('setup'); return; }
  window.addEventListener('hashchange', followHash);
  if (!(await followHash())) {
    const last = store.get('lastNotebook', null);
    await ctx.selectNotebook(state.notebooks.some((n) => n.id === last) ? last : state.notebooks[0].id);
  }
  // reading an answer starts on the page (J and K work); a blank question starts in Ask
  if (state.convId) document.getElementById('page-scroll')?.focus({ preventScroll: true }); else focusComposer();
}

boot();
