// Command palette (DESIGN 11.14): ask, questions, files, Studio, sources, notes, sheets, commands.

import { h, clear, icon, esc, basename } from './dom.js';
import { effectiveTheme } from './chrome.js';
import { api, nbPath } from './api.js';
import { state, ctx, on, emit, GENERATORS, GROUPS, MODELS } from './state.js';
import { loadDir, when } from './rail.js';
import { sourcesOf, sourceFor, swatch, qnum, kbd, shortPath } from './layers.js';

let el = null, input, listEl, items = [], sel = 0, crawling = null, prevFocus = null, scope = 'all';
let fileItems = null, fileItemsFor = null;
const SCOPES = [['all', 'All'], ['files', 'Files'], ['studio', 'Studio'], ['questions', 'Questions']];

on('notebook', () => {
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  idle(() => crawl());
});

function fuzzy(q, text) {
  if (!q) return { score: 0, idx: [] };
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) {
    const idx = [...Array(q.length)].map((_, i) => direct + i);
    const boundary = direct === 0 || /[\s/._-]/.test(t[direct - 1]);
    return { score: 1000 - direct - t.length * 0.1 + (boundary ? 200 : 0), idx };
  }
  let ti = 0, score = 0, run = 0;
  const idx = [];
  for (const c of q) {
    const f = t.indexOf(c, ti);
    if (f < 0) return null;
    run = f === ti ? run + 1 : 0;
    score += 10 + run * 6 + (f === 0 || /[\s/._-]/.test(t[f - 1]) ? 12 : 0) - Math.min(f - ti, 20) * 0.5;
    idx.push(f);
    ti = f + 1;
  }
  // scattered letters across a long string are noise, not a match
  if (idx.at(-1) - idx[0] > q.length * 4) return null;
  return { score: score - t.length * 0.05, idx };
}

function marked(text, idx) {
  if (!idx?.length) return esc(text);
  const set = new Set(idx);
  let out = '';
  for (let i = 0; i < text.length; i++) out += set.has(i) ? `<b>${esc(text[i])}</b>` : esc(text[i]);
  return out;
}

async function crawl() {
  if (state.fileIndex || crawling || !state.nb) return crawling;
  const nbId = state.nbId;
  const out = [];
  for (const d of state.nb.shelf) for (const f of d.files) out.push({ path: f, group: d.title });
  const queue = state.nb.roots.map((r) => ({ r, dir: '' }));
  let dirs = 0;
  crawling = (async () => {
    try {
      const r = await api.get(nbPath(nbId, '/files'));
      const seen = new Set(out.map((f) => f.path));
      for (const f of r.files || []) if (!seen.has(f.path)) out.push({ path: f.path, group: f.root || 'Pinned' });
      queue.length = 0;
    } catch {}
    const worker = async () => {
      while (queue.length && out.length < 30000 && dirs < 6000) {
        const { r, dir } = queue.shift();
        dirs++;
        try {
          for (const e of await loadDir(r.name, dir)) {
            const sub = dir ? `${dir}/${e.name}` : e.name;
            if (e.dir) queue.push({ r, dir: sub });
            else out.push({ path: e.path || `${r.path}/${sub}`, group: r.name });
          }
        } catch {}
        if (el) draw();
      }
    };
    await Promise.all([...Array(8)].map(worker));
    if (state.nbId === nbId) { state.fileIndex = out; state.fileIndexAt = Date.now(); emit('fileindex'); }
    crawling = null;
    if (el) draw();
  })();
  return crawling;
}

const numOf = (r) => String(state.recipes.indexOf(r) + 1).padStart(2, '0');

function commands() {
  const dark = effectiveTheme() === 'dark';
  return [
    { label: 'New question', keys: ['N'], run: () => ctx.newConversation(), top: 1 },
    { label: 'Studio', keys: ['P'], run: () => ctx.toggleStudio(), top: 1 },
    { label: 'Add a source', keys: ['A'], run: () => ctx.openAddSource(), top: 1 },
    { label: dark ? 'Light theme' : 'Night chart theme', alias: 'toggle theme dark light', keys: ['Ctrl', 'Shift', 'L'], run: () => ctx.toggleTheme(), top: 1 },
    { label: 'Shortcuts', keys: ['?'], run: () => ctx.openShortcuts(), top: 1 },
    { label: 'Settings', alias: 'api key preferences', run: () => ctx.openSettings() },
    { label: 'Search all sources', alias: 'grep full text', keys: ['Ctrl', 'Shift', 'F'], run: () => ctx.openSearch('') },
    { label: 'Copy with citations', keys: ['C'], run: () => ctx.copyAnswer?.() },
    { label: 'Copy answer as markdown', run: () => ctx.copyPlain?.() },
    { label: 'Claim bands on or off', alias: 'underline only', keys: ['Shift', 'H'], run: () => ctx.toggleBands?.() },
    { label: 'New notebook', run: () => ctx.openNewNotebook() },
    ...(ctx.viewerHidden?.() ? [{ label: 'Show the source drawer', run: () => ctx.showViewer() }] : []),
    ...state.notebooks.filter((n) => n.id !== state.nbId).map((n) => ({ label: `Switch to ${n.title}`, run: () => ctx.selectNotebook(n.id) })),
    ...(!state.recipes.length ? GENERATORS.map((g) => ({ label: `Write a ${g.label.toLowerCase()} note`, sub: g.desc, run: () => ctx.generate(g.kind) })) : []),
  ];
}

function build(raw) {
  const nb = state.nb;
  const q = raw.trim();
  const ql = q.toLowerCase();
  const groups = [];
  const push = (id, label, rows, extra) => { if (rows.length) groups.push({ id, label, rows, extra }); };
  const convs = (nb?.conversations || []).map((c) => ({ label: c.title, num: qnum(c.id), sub: '', date: when(c.updated || c.created), run: () => ctx.openConversation(c.id) }));
  const cmds = commands();
  const showIn = (g) => scope === 'all' || scope === g;

  if (!q) {
    if (showIn('questions')) push('questions', 'Questions', convs.slice(0, scope === 'questions' ? 50 : 3));
    if (showIn('studio') && scope === 'studio') push('studio', 'Studio', state.recipes.map(recipeRow));
    if (scope === 'all') push('commands', 'Commands', cmds.filter((c) => c.top));
    if (scope === 'files') push('files', 'Files', fileRows().slice(0, 40).map((f) => ({ ...f })));
    return groups;
  }

  if (q.length >= 3 && scope === 'all') {
    const alias = /^surv/.test(ql);
    push('ask', 'Ask', [{ label: alias ? 'Ask (survey)' : `Ask "${q}" across all sources`, sub: `${sourcesOf().length} sources · ${MODELS.find((m) => m.id === state.model)?.label || state.model}`, keys: ['Enter'], ask: true, run: () => (alias ? ctx.focusComposer?.() : ctx.ask(q)) }]);
  }
  const match = (rows, key = 'label', limit = 6) => rows.map((r) => { const m = fuzzy(ql, r[key] + (r.alias ? ' ' + r.alias : '')); return m ? { ...r, score: m.score, idx: m.idx[0] < r[key].length ? m.idx.filter((i) => i < r[key].length) : [] } : null; })
    .filter(Boolean).sort((a, b) => b.score - a.score).slice(0, limit);
  if (showIn('questions')) push('questions', 'Questions', match(convs, 'label', scope === 'questions' ? 50 : 5));
  if (showIn('files')) {
    const pathQ = ql.includes('/');
    const all = fileRows().map((f) => {
      const m = fuzzy(ql, pathQ ? f.path : f.label);
      return m ? { ...f, score: m.score, idx: pathQ ? [] : m.idx } : null;
    }).filter(Boolean).sort((a, b) => b.score - a.score);
    const lim = scope === 'files' ? 60 : 6;
    push('files', 'Files', all.slice(0, lim), all.length > lim ? `${Math.min(lim, all.length)} of ${all.length}` : crawling ? `Indexing files · ${fileRows().length.toLocaleString()}` : '');
  }
  if (showIn('studio')) push('studio', 'Studio', match(state.recipes.map(recipeRow), 'label', scope === 'studio' ? 30 : 5));
  if (scope === 'all') {
    push('sources', 'Sources', match(sourcesOf().map((s) => ({ label: s.name, sub: s.path, src: s, run: () => ctx.openSource(s) })), 'label', 4));
    push('notes', 'Notes', match((nb?.notes || []).map((n) => ({ label: n.title, sub: 'note', run: () => ctx.openNote(n) })), 'label', 4));
    push('sheets', 'Sheets', match(state.artifacts.map((a) => ({ label: a.title || a.recipe, sub: [a.kind, a.status].filter(Boolean).join(' · '), run: () => ctx.openArtifact(a.id) })), 'label', 4));
    const cm = match(cmds, 'label', 6);
    cm.push({ label: `Search text for "${q}"`, sub: 'full text, every source', keys: ['Shift', 'Enter'], run: () => ctx.openSearch(q) });
    push('commands', 'Commands', cm);
    // nothing found besides the two ways to ask (SCREENS 8, state E)
    groups.noMatch = !groups.some((g) => g.id !== 'ask' && g.id !== 'commands') && cm.length === 1;
  }
  return groups;
}

function recipeRow(r) {
  return { label: r.title, alias: r.id, num: numOf(r), sub: `${GROUPS.find((g) => g.id === r.group)?.label.toLowerCase() || ''} · ${r.kind || ''}`.replace(/^ · | · $/g, ''), run: () => ctx.openRecipe(r.id) };
}

function fileRows() {
  const index = state.fileIndex || (state.nb?.shelf || []).flatMap((d) => d.files.map((f) => ({ path: f, group: d.title })));
  if (fileItemsFor !== index) {
    fileItemsFor = index;
    fileItems = index.map((f) => {
      const src = sourceFor(f.path);
      const dir = f.path.split('/').slice(-3, -1).join('/');
      return { label: basename(f.path), path: f.path, sub: `${src?.name || f.group}${dir ? ' · ' + dir : ''}`, src, run: () => ctx.openFile(f.path) };
    });
  }
  return fileItems;
}

function draw() {
  if (!el) return;
  const groups = build(input.value);
  items = groups.flatMap((g) => g.rows);
  sel = Math.min(sel, Math.max(0, items.length - 1));
  clear(listEl);
  if (!items.length) {
    const q = input.value.trim();
    listEl.append(h('div', { class: 'p-none' }, q ? `No match. Enter asks "${q}" across all sources.` : 'Nothing here yet.'));
    input.removeAttribute('aria-activedescendant');
    return;
  }
  if (groups.noMatch) listEl.append(h('div', { class: 'p-none' }, `No match. Enter asks "${input.value.trim()}" across all sources.`));
  let i = 0;
  for (const g of groups) {
    listEl.append(h('div', { class: 'p-group', role: 'presentation' }, h('span', { class: 't-kicker' }, g.label), g.extra ? h('span', { class: 't-mono-sm' }, g.extra) : null));
    for (const it of g.rows) {
      const k = i++;
      const lead = it.src ? swatch(it.src) : it.num ? h('span', { class: 'p-num' }, it.num) : it.ask ? icon('search', 14) : h('span', { class: 'p-dot' });
      listEl.append(h('div', { class: `p-item${k === sel ? ' sel' : ''}`, role: 'option', id: `pi-${k}`, 'aria-selected': String(k === sel),
        onclick: () => choose(k), onpointermove: () => { if (sel !== k) { sel = k; mark(); } } },
      h('span', { class: 'p-lead' }, lead),
      h('span', { class: 'p-title', html: marked(it.label, it.idx) }),
      it.sub ? h('span', { class: 'p-sub' }, it.sub) : null,
      h('span', { class: 'grow' }),
      it.date ? h('span', { class: 'p-date' }, it.date) : null,
      it.keys ? h('span', { class: 'p-keys' }, kbd(...it.keys)) : null));
    }
  }
  input.setAttribute('aria-activedescendant', `pi-${sel}`);
}

function mark() {
  listEl.querySelectorAll('.p-item').forEach((r) => { const on = r.id === `pi-${sel}`; r.classList.toggle('sel', on); r.setAttribute('aria-selected', String(on)); });
  listEl.querySelector('.p-item.sel')?.scrollIntoView({ block: 'nearest' });
  input.setAttribute('aria-activedescendant', `pi-${sel}`);
}

function choose(i) {
  const it = items[i];
  const q = input.value.trim();
  closePalette(false);
  if (!it) { if (q) ctx.ask(q); return; }
  it.run();
  if (!document.activeElement || document.activeElement === document.body) prevFocus?.focus?.();
}

function drawScopes(box) {
  box.replaceChildren(...SCOPES.map(([id, label]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(scope === id), tabindex: -1, onclick: () => { scope = id; sel = 0; drawScopes(box); draw(); input.focus(); } }, label)));
}

export function closePalette(restore = true) {
  el?.remove(); el = null;
  emit('pane', 'page');
  if (restore) prevFocus?.focus?.();
}

export function openPalette(prefill = '', startScope = 'all', { mouse = false } = {}) {
  if (el) { input.focus(); input.select(); return; }
  prevFocus = document.activeElement;
  scope = SCOPES.some(([id]) => id === startScope) ? startScope : 'all';
  document.getElementById('cite-card')?.remove();
  input = h('input', { type: 'text', placeholder: 'Ask, jump to a file, or run a recipe', 'aria-label': 'Command palette', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-list', autocomplete: 'off', spellcheck: 'false', value: prefill });
  listEl = h('div', { class: 'palette-list', role: 'listbox', id: 'palette-list' });
  const scopes = h('div', { class: 'segmented p-scopes', role: 'radiogroup', 'aria-label': 'Scope' });
  drawScopes(scopes);
  el = h('div', { class: `palette${mouse ? ' by-mouse' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette', onpointerdown: (e) => { if (e.target === el) closePalette(); } },
    h('div', { class: 'palette-box neatline' },
      h('div', { class: 'palette-input' }, icon('search', 16), input, scopes, kbd('Esc')),
      listEl,
      h('div', { class: 'palette-foot' }, kbd('Up'), kbd('Down'), ' to move · ', kbd('Enter'), ' to open · ', kbd('Tab'), ' to scope · ', kbd('Ctrl'), kbd('Enter'), ' ask in new question')));
  sel = 0;
  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    const q = input.value.trim();
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = items.length ? (sel + 1) % items.length : 0; mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = items.length ? (sel - 1 + items.length) % items.length : 0; mark(); }
    else if (e.key === 'Enter' && e.shiftKey && q) { e.preventDefault(); closePalette(false); ctx.openSearch(q); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && q) { e.preventDefault(); closePalette(false); ctx.newConversation(); ctx.ask(q); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const i = SCOPES.findIndex(([id]) => id === scope);
      scope = SCOPES[(i + (e.shiftKey ? -1 : 1) + SCOPES.length) % SCOPES.length][0];
      sel = 0; drawScopes(scopes); draw();
    } else if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)) { e.preventDefault(); choose(Number(e.key) - 1); }
  });
  document.body.append(el);
  emit('pane', 'palette');
  draw();
  input.focus();
  crawl();
}

export const paletteOpen = () => !!el;
