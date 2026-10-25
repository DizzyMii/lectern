// The rail (DESIGN 11.4): sources as a map legend, numbered history, notes, and the status footer.

import { h, clear, icon, toast, copyText, fmtNum, ago } from './dom.js';
import { api, nbPath } from './api.js';
import { state, ctx, on, emit, normTreeEntries } from './state.js';
import { sourcesOf, swatch, layerAttrs, qnum, kbd, inScope, toggleScope } from './layers.js';
import { confirmDialog } from './dialogs.js';
import { effectiveTheme } from './chrome.js';

let rail, legend, hist, notesEl, footEl, menuEl = null, filterEl = null, selected = null;
const dirCache = new Map(); // `${nb}|${root}|${dir}` -> Promise<entries>

export function loadDir(rootName, dir = '') {
  const key = `${state.nbId}|${rootName}|${dir}`;
  if (!dirCache.has(key)) {
    const p = api.get(nbPath(state.nbId, `/tree?root=${encodeURIComponent(rootName)}&dir=${encodeURIComponent(dir)}`)).then(normTreeEntries);
    p.catch(() => dirCache.delete(key));
    dirCache.set(key, p);
  }
  return dirCache.get(key);
}

export function initRail(el) {
  rail = el;
  rail.setAttribute('role', 'navigation');
  legend = h('section', { class: 'legend', 'aria-label': 'Sources' });
  hist = h('section', { class: 'history', 'aria-label': 'History' });
  notesEl = h('section', { class: 'notes', 'aria-label': 'Notes' });
  footEl = h('div', { class: 'rail-foot' });
  rail.append(h('div', { class: 'rail-scroll' }, phoneNav(), legend, hist, notesEl), footEl);
  on('notebook', drawAll);
  on('refresh', drawAll);
  on('conversation', drawHistory);
  on('status', drawFoot);
  setInterval(drawFoot, 60000);
  on('scope', drawLegend);
  on('firstrun', drawAll);
  on('fileindex', () => { drawLegend(); drawFoot(); });
  on('viewer', (path) => { selected = path || null; markSelected(); });
  hist.addEventListener('keydown', listKeys);
  legend.addEventListener('keydown', listKeys);
  drawAll();
}

// A phone has no P key and no room for the theme button, so the rail sheet carries both
function phoneNav() {
  const app = document.getElementById('app');
  const done = () => app.classList.remove('rail-open');
  const theme = h('button', { type: 'button', class: 'btn quiet' });
  const drawTheme = () => { const dark = effectiveTheme() === 'dark'; theme.replaceChildren(icon(dark ? 'sun' : 'moon'), dark ? 'Light' : 'Night'); };
  theme.addEventListener('click', () => { ctx.toggleTheme(); drawTheme(); });
  drawTheme();
  return h('nav', { class: 'rail-phone', 'aria-label': 'Views' },
    h('button', { type: 'button', class: 'btn quiet', onclick: () => { if (ctx.studioShown()) ctx.toggleStudio(false, { focus: false }); else ctx.closeCanvas(); done(); } }, icon('chat'), 'Answers'),
    h('button', { type: 'button', class: 'btn quiet', onclick: () => { ctx.toggleStudio(true, { focus: false }); done(); } }, icon('layers'), 'Studio'),
    theme);
}

function drawAll() { drawLegend(); drawHistory(); drawNotes(); drawFoot(); }

// root file counts come from the palette's file index when the API does not send them
function countOf(s) {
  if (s.count != null) return s.count;
  if (!state.fileIndex) return null;
  return state.fileIndex.filter((f) => f.group === s.name).length || null;
}

const GROUPS = [
  ['docs', 'Pinned docs', (s) => s.kind === 'docs' || s.kind === 'primer', 'docs URL'],
  ['roots', 'Code roots', (s) => s.kind === 'root', 'folder'],
  ['repo', 'Your repo', (s) => s.kind === 'repo', 'git repo'],
];

function drawLegend() {
  clear(legend);
  const nb = state.nb;
  // first run has no notebook yet, but the rail still shows its empty legend (DESIGN 13)
  if (!nb && !ctx.firstRun) return;
  const all = sourcesOf();
  const on = all.filter(inScope).length;
  legend.append(h('div', { class: 'rl-head' }, h('span', { class: 't-kicker' }, 'Sources'), h('span', { class: 't-mono-sm' }, all.length ? `scope ${on} of ${all.length}` : 'no sources yet')));
  for (const [id, label, test, hint] of GROUPS) {
    const list = all.filter(test);
    const grp = h('div', { class: 'rl-group', dataset: { group: id } }, h('div', { class: 'rl-ghead' }, h('span', { class: 't-kicker' }, label), groupNote(id, list)));
    if (!list.length) {
      grp.append(h('button', { class: 'slot', onclick: () => ctx.openAddSource(id === 'docs' ? 'url' : id === 'roots' ? 'folder' : 'git') },
        h('span', { class: 'slot-sw', 'aria-hidden': 'true' }), '+ Add', h('span', { class: 'grow' }), h('span', { class: 't-mono-sm' }, hint)));
    }
    for (const s of list) grp.append(sourceRow(s));
    legend.append(grp);
  }
  legend.append(h('button', { class: 'add-src', onclick: () => ctx.openAddSource() }, '+ Add a source', h('span', { class: 'grow' }), kbd('A')));
  markSelected();
}

const repoState = (s) => (s.branch || s.dirty ? [s.branch || '', s.branch && s.dirty ? ' · ' : '', s.dirty ? h('span', { class: 'dirty' }, `${s.dirty} dirty`) : null] : null);

// the group head carries what its rows share: "live" for code roots, "main · 3 dirty" for a single repo
function groupNote(id, list) {
  if (id === 'roots' && list.some((s) => s.version || s.branch)) return h('span', { class: 'rl-gnote', title: 'Read from the folder as it is now' }, 'live');
  if (id === 'repo' && list.length === 1) { const st = repoState(list[0]); if (st) return h('span', { class: 'rl-gnote' }, ...st); }
  return null;
}

// a missing folder, or a repo's branch when several repos share the group, takes a second line
function subLine(s) {
  if (s.exists === false) return h('span', { class: 'src-sub bad' }, 'Folder not found');
  const repos = sourcesOf().filter((x) => x.kind === 'repo').length;
  if (s.kind === 'repo' && repos > 1) { const st = repoState(s); if (st) return h('span', { class: 'src-sub' }, ...st); }
  return null;
}

function sourceRow(s) {
  const n = countOf(s);
  const on = inScope(s);
  const sub = subLine(s);
  const open = h('button', { class: 'src-open', title: `${s.path}
Space toggles scope`, onclick: () => ctx.openSource(s) },
    swatch(s),
    h('span', { class: 'src-text' }, h('span', { class: 'src-name' }, s.name, s.kind === 'root' && (s.version || s.branch) ? h('span', { class: 'src-ver' }, s.version || s.branch) : null), sub),
    s.exists === false ? h('span', { class: 'src-bad', title: 'Folder not found' }, '?') : null,
    h('span', { class: 'grow' }),
    h('span', { class: 'src-count' }, n != null && on ? fmtCount(n) : ''));
  open.addEventListener('keydown', (e) => { if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); flip(s); } });
  const tog = h('button', { class: 'scope-tog', role: 'switch', 'aria-checked': String(on), 'aria-label': `${s.name} in scope`, title: on ? 'In scope. Space or click to leave it out of asks' : 'Out of scope. Space or click to ask it again', ...layerAttrs(s), onclick: () => flip(s) });
  const more = h('button', { class: 'icon-btn row-more', 'aria-label': `More for ${s.name}`, 'aria-haspopup': 'menu' }, icon('menu', 14));
  more.addEventListener('mousedown', (e) => { if (e.button === 0) { e.preventDefault(); rowMenu(more, s); } });
  more.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); rowMenu(more, s); } });
  return h('div', { class: `src-row${s.exists === false ? ' error' : ''}${on ? '' : ' out'}${sub ? ' two' : ''}`, dataset: { id: s.id, prefix: s.prefix }, ...layerAttrs(s) }, open, tog, more);
}

function flip(s) {
  if (!toggleScope(s)) { toast('One source has to stay in scope.', 'info', 2200); return; }
  legend.querySelector(`.src-row[data-id="${CSS.escape(s.id)}"] .src-open`)?.focus();
}

const fmtCount = (n) => (n >= 10000 ? fmtNum(n) : n.toLocaleString());

function markSelected() {
  for (const row of legend.querySelectorAll('.src-row')) row.classList.toggle('sel', !!selected && selected.startsWith(row.dataset.prefix));
}

function rowMenu(anchor, s) {
  closeMenu();
  const r = anchor.getBoundingClientRect();
  const item = (label, fn, cls = '') => h('button', { class: `menu-item ${cls}`, role: 'menuitem', onclick: () => { closeMenu(); fn(); } }, label);
  menuEl = h('div', { class: 'menu', role: 'menu', style: { position: 'fixed', top: `${r.bottom + 4}px`, left: `${Math.min(r.left, window.innerWidth - 220)}px`, width: '200px' } },
    item('Browse files', () => ctx.openSource(s)),
    item('Copy path', () => copyText(s.path, `Copied ${s.path}`)),
    h('div', { class: 'menu-sep' }),
    h('button', { class: 'menu-item danger', role: 'menuitem', onclick: () => { closeMenu(); removeSource(s); } }, icon('trash', 14), 'Remove'));
  showMenu(anchor);
}

function showMenu(anchor) {
  document.body.append(menuEl);
  anchor.setAttribute('aria-expanded', 'true');
  menuEl._anchor = anchor;
  menuEl.querySelector('.menu-item')?.focus();
  menuEl.addEventListener('keydown', (e) => {
    const items = [...menuEl.querySelectorAll('.menu-item')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); anchor.focus(); }
  });
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
}
function outside(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }
function closeMenu() {
  menuEl?._anchor?.setAttribute('aria-expanded', 'false');
  menuEl?.remove(); menuEl = null;
  document.removeEventListener('pointerdown', outside, true);
}

async function removeSource(s) {
  const what = s.root ? `the code root "${s.name}"` : `"${s.name}"`;
  if (!(await confirmDialog({ title: `Remove ${s.name}?`, body: `Remove ${what} from this notebook. Files on disk stay. Past answers keep their citations.`, confirm: 'Remove source' }))) return;
  try {
    if (s.root) await api.del(nbPath(state.nbId, '/sources'), { kind: 'root', value: s.name });
    else {
      // a docs source is the set of pinned patterns under its folder
      const pats = state.nb.pinned.filter((p) => p.startsWith(s.prefix) || s.prefix.startsWith(p.replace(/\*.*$/, '')));
      for (const p of pats) await api.del(nbPath(state.nbId, '/sources'), { kind: 'pinned', value: p });
    }
    toast(`Removed ${s.name}`, 'info', 2400);
    for (const k of [...dirCache.keys()]) if (k.startsWith(`${state.nbId}|${s.name}|`)) dirCache.delete(k);
    state.fileIndex = null;
    await ctx.refreshNotebook();
  } catch (e) { toast(e.message); }
}

// ---------- history ----------

export function when(t) {
  const d = new Date(t);
  if (isNaN(d)) return '';
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 86400000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function drawHistory() {
  clear(hist);
  const nb = state.nb;
  if (!nb) {
    if (ctx.firstRun) hist.append(h('div', { class: 'rl-head' }, h('span', { class: 't-kicker' }, 'History'), kbd('H')), h('p', { class: 'rl-empty' }, 'No questions yet.'));
    return;
  }
  filterEl = h('input', { class: 'input rl-filter', placeholder: 'Filter questions', 'aria-label': 'Filter history', hidden: true });
  filterEl.addEventListener('input', filterHistory);
  filterEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); filterEl.value = ''; filterHistory(); filterEl.hidden = true; hist.querySelector('.h-open')?.focus(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); hist.querySelector('.h-row:not([hidden]) .h-open')?.focus(); }
  });
  hist.append(h('div', { class: 'rl-head' }, h('span', { class: 't-kicker' }, 'History'), h('button', { class: 'icon-btn sm', 'aria-label': 'New question (N)', title: 'New question  N', onclick: () => ctx.newConversation() }, icon('plus', 14)), kbd('H')), filterEl);
  if (!nb.conversations.length) { hist.append(h('p', { class: 'rl-empty' }, 'No questions yet.')); return; }
  for (const c of nb.conversations.slice(0, 300)) {
    const on = c.id === state.convId;
    const cites = c.citations ? `${c.citations} citation${c.citations === 1 ? '' : 's'}` : null;
    const meta = [when(c.updated), c.turns > 1 ? `${c.turns} questions` : null, cites].filter(Boolean).join(' · ');
    const open = h('button', { class: 'h-open', title: c.title, 'aria-current': on ? 'true' : null, onclick: () => ctx.openConversation(c.id) },
      h('span', { class: 'h-num' }, qnum(c.id) || ''),
      h('span', { class: 'h-body' }, h('span', { class: 'h-title' }, c.title), h('span', { class: 'h-meta' }, meta, c.flag ? h('span', { class: `h-dot st-${c.flag}`, title: c.flag === 'moved' ? 'A citation moved' : 'A quote was not found' }) : null)));
    const more = h('button', { class: 'icon-btn row-more', 'aria-label': `More for ${c.title}`, 'aria-haspopup': 'menu' }, icon('menu', 14));
    more.addEventListener('mousedown', (e) => { if (e.button === 0) { e.preventDefault(); convMenu(more, c, open); } });
    more.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); convMenu(more, c, open); } });
    open.addEventListener('keydown', (e) => {
      if (e.key === 'F2') { e.preventDefault(); rename(c, open); }
      if (e.key === 'Delete') { e.preventDefault(); delConv(c); }
    });
    hist.append(h('div', { class: `h-row${on ? ' on' : ''}`, dataset: { q: c.title.toLowerCase() } }, open, more));
  }
}

function filterHistory() {
  const q = filterEl.value.trim().toLowerCase();
  for (const r of hist.querySelectorAll('.h-row')) r.hidden = !!q && !r.dataset.q.includes(q);
}

function convMenu(anchor, c, open) {
  closeMenu();
  const r = anchor.getBoundingClientRect();
  menuEl = h('div', { class: 'menu', role: 'menu', style: { position: 'fixed', top: `${r.bottom + 4}px`, left: `${Math.min(r.left, window.innerWidth - 220)}px`, width: '200px' } },
    h('button', { class: 'menu-item', role: 'menuitem', onclick: () => { closeMenu(); rename(c, open); } }, 'Rename', h('span', { class: 'hint' }, kbd('F2'))),
    h('div', { class: 'menu-sep' }),
    h('button', { class: 'menu-item danger', role: 'menuitem', onclick: () => { closeMenu(); delConv(c); } }, icon('trash', 14), 'Delete', h('span', { class: 'hint' }, kbd('Del'))));
  showMenu(anchor);
}

function rename(c, open) {
  const input = h('input', { class: 'input', value: c.title, 'aria-label': 'Question title' });
  open.hidden = true;
  open.after(input);
  input.focus(); input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return; done = true;
    const t = input.value.trim();
    if (save && t && t !== c.title) {
      try {
        await api.patch(`/api/conversations/${encodeURIComponent(state.nbId)}/${encodeURIComponent(c.id)}`, { title: t });
        c.title = t;
        if (state.conv?.id === c.id) state.conv.title = t;
        emit('conversation');
      } catch (e) { toast(e.message); }
    }
    drawHistory();
  };
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
  input.addEventListener('blur', () => finish(true));
}

async function delConv(c) {
  if (!(await confirmDialog({ title: 'Delete this question?', body: `"${c.title}" and its answers will be deleted. This cannot be undone.`, confirm: 'Delete' }))) return;
  try {
    await api.del(`/api/conversations/${encodeURIComponent(state.nbId)}/${encodeURIComponent(c.id)}`);
    if (state.convId === c.id) ctx.newConversation();
    await ctx.refreshNotebook();
  } catch (e) { toast(e.message); }
}

// ---------- notes ----------

function drawNotes() {
  clear(notesEl);
  const nb = state.nb;
  if (!nb || !nb.notes.length) return;
  notesEl.append(h('div', { class: 'rl-head' }, h('span', { class: 't-kicker' }, 'Notes'), h('span', { class: 't-mono-sm' }, String(nb.notes.length))));
  for (const n of nb.notes.slice(0, 200)) {
    notesEl.append(h('div', { class: 'h-row note' }, h('button', { class: 'h-open', title: n.title, onclick: () => ctx.openNote(n) },
      h('span', { class: 'h-body' }, h('span', { class: 'h-title' }, n.title), h('span', { class: 'h-meta' }, when(n.updated))))));
  }
}

// ---------- footer ----------

function drawFoot() {
  clear(footEl);
  const nb = state.nb;
  const srcs = sourcesOf();
  const files = state.fileIndex ? state.fileIndex.length : srcs.reduce((n, s) => n + (countOf(s) || 0), 0);
  if (nb && srcs.length && state.fileIndexAt) footEl.append(h('div', null, `Indexed ${ago(state.fileIndexAt)}`));
  footEl.append(h('div', null, nb && srcs.length ? `${files ? files.toLocaleString() + ' files · ' : ''}${srcs.length} source${srcs.length === 1 ? '' : 's'}` : 'Nothing indexed yet'));
  const s = state.status;
  if (!s) { footEl.append(h('div', null, h('span', { class: 'sdot' }), 'Connecting')); return; }
  const found = s.claude?.found ?? s.claudeFound ?? s.found ?? !!(s.version || s.claude?.version);
  const ver = String(s.claude?.version || s.version || '').replace(/\s*\(.*\)\s*$/, '');
  footEl.append(h('div', { title: found ? `Claude Code ${ver}`.trim() : 'Install Claude Code and put claude on PATH' },
    h('span', { class: `sdot ${found ? 'ok' : ''}` }), found ? 'Claude Code ready' : 'Claude Code not found'));
}

// ---------- keys ----------

// arrows move inside a list; typing in History filters it
function listKeys(e) {
  const sel = e.currentTarget === hist ? '.h-row:not([hidden]) .h-open, .h-row .input' : '.src-open, .slot, .add-src';
  const items = [...e.currentTarget.querySelectorAll(sel)].filter((x) => x.offsetParent);
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (i < 0) return;
    e.preventDefault();
    items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  } else if (e.currentTarget === hist && e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && document.activeElement !== filterEl && e.target.closest('.h-open')) {
    e.preventDefault();
    e.stopPropagation();
    filterEl.hidden = false;
    filterEl.value += e.key;
    filterEl.focus();
    filterHistory();
  }
}

export function focusHistory() {
  const cur = hist.querySelector('.h-row.on .h-open') || hist.querySelector('.h-open');
  cur?.focus();
  return !!cur;
}
