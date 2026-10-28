// Top bar and key strip: notebook switcher, breadcrumb, palette field, index status, theme toggle.
// The mini receipt (#tb-receipt) and running-recipe chip (#tb-run) are left for their owners to fill.

import { h, clear, icon, fmtNum, ago } from './dom.js';
import { state, ctx, on } from './state.js';
import { qnum, nextQnum, sourcesOf } from './layers.js';

let nbBtn, crumb, indexEl, engineEl, themeBtn, menuEl = null;

export function initChrome() {
  nbBtn = document.getElementById('tb-notebook');
  crumb = document.getElementById('tb-crumb');
  indexEl = document.getElementById('tb-index');
  themeBtn = document.getElementById('tb-theme');
  engineEl = h('button', { class: 'tb-index tb-engine', id: 'tb-engine', type: 'button' });
  indexEl.after(engineEl);
  on('status', drawEngine);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTheme);
  document.getElementById('tb-palette').addEventListener('click', () => ctx.openPalette());
  document.querySelector('.tb-brand').addEventListener('click', (e) => { e.preventDefault(); ctx.newConversation?.(); });
  themeBtn.addEventListener('click', () => ctx.toggleTheme());
  document.getElementById('tb-settings').addEventListener('click', () => ctx.openSettings());
  engineEl.addEventListener('click', () => ctx.openSettings());
  nbBtn.addEventListener('mousedown', (e) => { if (e.button === 0) { e.preventDefault(); toggleMenu(); } });
  nbBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); toggleMenu(); } });
  for (const ev of ['notebook', 'notebooks', 'refresh']) on(ev, () => { drawNotebook(); drawCrumb(); drawIndex(); });
  on('conversation', drawCrumb);
  on('refresh', drawCrumb);
  on('artifacts', drawCrumb);
  on('fileindex', drawIndex);
  setInterval(drawIndex, 60000);
  on('firstrun', () => { drawNotebook(); drawCrumb(); drawIndex(); });
  drawNotebook(); drawCrumb(); drawIndex(); drawEngine(); syncTheme();
}

export function effectiveTheme() {
  const t = document.documentElement.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function syncTheme() {
  if (!themeBtn) return;
  const dark = effectiveTheme() === 'dark';
  themeBtn.replaceChildren(icon(dark ? 'sun' : 'moon'));
  window.lecternApp?.setTheme(dark);
  themeBtn.title = `${dark ? 'Switch to light' : 'Switch to dark'}  Ctrl+Shift+L`;
}

function drawNotebook() {
  const nb = state.nb || state.notebooks.find((n) => n.id === state.nbId);
  clear(nbBtn).append(h('span', { class: 'lbl' }, nb?.title || (ctx.firstRun ? 'New notebook' : 'Notebooks')), icon('down', 12));
}

function drawCrumb() {
  clear(crumb);
  if (ctx.firstRun && !state.nb) { crumb.append(icon('chev', 12), h('span', { class: 'lbl' }, 'Setting out')); return; }
  const title = state.artifactId ? (state.artifacts.find((a) => a.id === state.artifactId)?.title || 'Sheet') : state.conv?.title;
  if (!title) return;
  const n = !state.artifactId && (state.convId ? qnum(state.convId) : nextQnum());
  crumb.append(icon('chev', 12), n ? h('span', { class: 'qnum' }, n) : null, h('span', { class: 'lbl' }, title));
}

function drawIndex() {
  clear(indexEl);
  const nb = state.nb;
  if (!nb) { if (ctx.firstRun) indexEl.append(h('span', { class: 'sdot', 'aria-hidden': 'true' }), 'Nothing indexed'); return; }
  const srcs = sourcesOf(nb);
  const files = state.fileIndex ? state.fileIndex.length : srcs.reduce((n, s) => n + (Number(s.count) || 0), 0);
  const sources = srcs.length;
  if (!sources) { indexEl.append(h('span', { class: 'sdot', 'aria-hidden': 'true' }), 'Nothing indexed'); return; }
  indexEl.append(h('span', { class: 'sdot ok', 'aria-hidden': 'true' }),
    files ? `${files.toLocaleString()} files · ${state.fileIndexAt ? ago(state.fileIndexAt) : `${sources} source${sources === 1 ? '' : 's'}`}` : `${sources} source${sources === 1 ? '' : 's'}`);
}

// which engine answers: the API, the personal Claude Code login, or nothing yet
function drawEngine() {
  const e = state.status?.engine;
  clear(engineEl);
  if (!e) return;
  const ok = Boolean(e.default);
  engineEl.title = e.onboarding || (e.default === 'api' ? 'Answers use the Anthropic API with your key. Click for settings' : 'Answers use your Claude Code login, on this machine only. Click for settings');
  engineEl.append(h('span', { class: `sdot${ok ? ' ok' : ''}`, 'aria-hidden': 'true' }), ok ? e.label : 'No engine: add an API key');
}

function toggleMenu() {
  if (menuEl) return closeMenu();
  nbBtn.setAttribute('aria-expanded', 'true');
  const r = nbBtn.getBoundingClientRect();
  menuEl = h('div', { class: 'menu', role: 'menu', style: { position: 'fixed', top: `${r.bottom + 4}px`, left: `${r.left}px` } },
    h('div', { class: 'menu-label' }, 'Notebooks'),
    state.notebooks.map((n) => h('button', { class: `menu-item${n.id === state.nbId ? ' sel' : ''}`, role: 'menuitem', onclick: () => { closeMenu(); ctx.selectNotebook(n.id); } },
      h('span', { class: 'lbl' }, n.title))),
    h('div', { class: 'menu-sep' }),
    h('button', { class: 'menu-item', role: 'menuitem', onclick: () => { closeMenu(); ctx.openNewNotebook(); } }, 'New notebook'));
  document.body.append(menuEl);
  menuEl.querySelector('.menu-item')?.focus();
  menuEl.addEventListener('keydown', (e) => {
    const items = [...menuEl.querySelectorAll('.menu-item')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); nbBtn.focus(); }
  });
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
}

function outside(e) { if (!menuEl?.contains(e.target) && e.target !== nbBtn && !nbBtn.contains(e.target)) closeMenu(); }

function closeMenu() {
  menuEl?.remove();
  menuEl = null;
  nbBtn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', outside, true);
}
