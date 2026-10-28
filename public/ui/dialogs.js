// Dialogs (DESIGN 11.15): add source, new notebook, confirm, settings, the shortcut sheet. Also window drag and drop.

import { h, clear, icon, iconBtn, toast, fmtNum, copyText } from './dom.js';
import { api, nbPath, stream } from './api.js';
import { state, ctx, emit, HUES } from './state.js';
import { glyph, kbd } from './layers.js';

const TABS = [
  { id: 'url', label: 'URL' },
  { id: 'file', label: 'File' },
  { id: 'folder', label: 'Folder' },
  { id: 'git', label: 'Git' },
];

// Neatline frame, scrim, focus trapped by showModal, Esc cancels.
function dialog(title, { large = false } = {}, ...body) {
  const dlg = h('dialog', { class: `dlg neatline${large ? ' large' : ''}`, 'aria-label': title });
  dlg.append(h('div', { class: 'dlg-head' }, h('h2', { class: 't-ui-title' }, title), iconBtn('x', 'Close', () => dlg.close())), ...body);
  dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 120));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

const field = (label, attrs, help) => h('label', { class: 'dlg-field' }, h('span', { class: 'field-label' }, label), h('input', { class: 'input', type: 'text', ...attrs }), help ? h('span', { class: 'help' }, help) : null);

export function readBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

export async function addSource(body, log) {
  let err = null;
  await stream(nbPath(state.nbId, '/sources'), body, (ev) => {
    const msg = ev.message || ev.text || ev.status || ev.step;
    if (ev.type === 'error') err = new Error(ev.message || 'Failed');
    else if (msg && log) log(msg);
  });
  if (err) throw err;
}

export function confirmDialog({ title, body, confirm = 'Remove', destructive = true }) {
  return new Promise((resolve) => {
    let ok = false;
    const cancel = h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel');
    const dlg = dialog(title, {},
      h('div', { class: 'dlg-body' }, h('p', { class: 't-read-sm' }, body)),
      h('div', { class: 'dlg-foot' }, cancel, h('button', { class: `btn ${destructive ? 'destructive' : 'primary'}`, type: 'button', onclick: () => { ok = true; dlg.close(); } }, confirm)));
    dlg.addEventListener('close', () => resolve(ok));
    cancel.focus();
  });
}

export function openAddSource(tabId = 'url', presetFiles = null) {
  let tab = tabId;
  let files = presetFiles ? [...presetFiles] : [];
  const tabsEl = h('div', { class: 'tabs-row', role: 'tablist', 'aria-label': 'Source type' });
  tabsEl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === tab);
    tab = TABS[(i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length].id;
    draw();
    tabsEl.querySelector(`#src-tab-${tab}`)?.focus();
  });
  const bodyEl = h('div', { class: 'dlg-body', role: 'tabpanel', id: 'src-panel' });
  const logEl = h('div', { class: 'progress-log', hidden: true, 'aria-live': 'polite' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Add to notebook');
  const form = h('form', { method: 'dialog' }, h('div', { class: 'dlg-tabs' }, tabsEl), bodyEl, h('div', { class: 'dlg-body tight' }, logEl),
    h('div', { class: 'dlg-foot' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel'), submit));
  const dlg = dialog(`Add a source to ${state.nb?.title || 'notebook'}`, {}, form);

  const draw = () => {
    clear(tabsEl).append(...TABS.map((t) => h('button', { type: 'button', class: 'tab', role: 'tab', id: 'src-tab-' + t.id, 'aria-controls': 'src-panel', 'aria-selected': String(t.id === tab), tabindex: t.id === tab ? 0 : -1, onclick: () => { tab = t.id; draw(); } }, t.label)));
    bodyEl.setAttribute('aria-labelledby', 'src-tab-' + tab);
    clear(bodyEl);
    if (tab === 'url') {
      bodyEl.append(field('Page URL', { name: 'url', type: 'url', placeholder: 'https://docs.example.org/guide', required: true, autofocus: true }),
        h('p', { class: 'help' }, 'The page is converted to markdown and pinned, so it rides along with every question.'));
    } else if (tab === 'file') {
      const input = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => { files.push(...input.files); draw(); } });
      const zone = h('div', { class: 'drop-zone', tabindex: 0, role: 'button', onclick: () => input.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } } },
        icon('upload', 20), h('div', null, 'Drop files here or click to choose'),
        h('div', { class: 'help' }, 'Markdown and text are pinned. PDF, Java, JSON and others become a readable root.'));
      zone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.add('over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('over'));
      zone.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); files.push(...e.dataTransfer.files); draw(); });
      bodyEl.append(input, zone);
      if (files.length) bodyEl.append(h('div', { class: 'file-list' }, files.map((f) => h('div', null, h('span', null, f.name), h('span', null, fmtNum(f.size) + 'B')))));
    } else if (tab === 'folder') {
      bodyEl.append(field('Folder path on this machine', { name: 'path', placeholder: 'D:/projects/my-app/src', required: true, autofocus: true }),
        field('Root name', { name: 'name', placeholder: 'my-app', required: true, pattern: '([A-Za-z0-9._]|-)+' }, 'Short id used in citations and searches.'));
    } else {
      bodyEl.append(field('Repository URL', { name: 'url', placeholder: 'https://github.com/owner/repo', required: true, autofocus: true }),
        h('div', { class: 'row2' }, field('Branch', { name: 'branch', placeholder: 'default' }), field('Subdirectory', { name: 'subdir', placeholder: 'src/main/java' })),
        field('Root name', { name: 'name', placeholder: 'repo-src', required: true, pattern: '([A-Za-z0-9._]|-)+' }, 'Shallow, sparse clone into corpus/<name>.'));
    }
    submit.textContent = tab === 'file' && files.length ? `Add ${files.length} file${files.length === 1 ? '' : 's'}` : 'Add to notebook';
    setTimeout(() => bodyEl.querySelector('input:not([type=file])')?.focus(), 0);
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const log = (m) => { logEl.hidden = false; logEl.append(h('div', null, m)); logEl.scrollTop = logEl.scrollHeight; };
    submit.disabled = true;
    submit.replaceChildren('Adding', h('span', { class: 'segbar' }, h('i', { class: 'on' }), h('i', { class: 'cur' }), h('i')));
    try {
      if (tab === 'file') {
        if (!files.length) throw new Error('Choose at least one file');
        for (const f of files) {
          log(`Uploading ${f.name}`);
          await addSource({ kind: 'file', name: f.name, base64: await readBase64(f) }, log);
        }
      } else {
        const body = { kind: tab };
        for (const [k, v] of Object.entries(data)) if (String(v).trim()) body[k] = String(v).trim();
        await addSource(body, log);
      }
      toast('Source added', 'ok', 2200);
      state.fileIndex = null;
      await ctx.refreshNotebook();
      dlg.close();
    } catch (err) {
      log('Error: ' + err.message);
      submit.disabled = false;
      submit.textContent = 'Try again';
    }
  });
  draw();
}

export async function addDroppedFiles(list) {
  const files = [...list];
  if (!files.length || !state.nbId) return;
  toast(`Adding ${files.length} file${files.length === 1 ? '' : 's'} to ${state.nb?.title}`, 'info', 2400);
  let ok = 0;
  for (const f of files) {
    try { await addSource({ kind: 'file', name: f.name, base64: await readBase64(f) }); ok++; }
    catch (e) { toast(`${f.name}: ${e.message}`); }
  }
  if (ok) { toast(`Added ${ok} file${ok === 1 ? '' : 's'}`, 'ok', 2200); state.fileIndex = null; await ctx.refreshNotebook(); }
}

export function initDrop() {
  let depth = 0, overlay = null;
  const show = () => {
    if (overlay) return;
    overlay = h('div', { class: 'drop-overlay', 'aria-hidden': 'true' },
      h('div', { class: 'drop-card neatline' }, icon('upload', 24), h('h3', { class: 't-ui-title' }, `Drop to add to ${state.nb?.title || 'notebook'}`), h('p', { class: 't-ui-sm' }, 'Markdown is pinned, everything else becomes readable source.')));
    document.body.append(overlay);
  };
  const hide = () => { overlay?.remove(); overlay = null; depth = 0; };
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e) || document.querySelector('dialog[open]')) return; depth++; show(); });
  window.addEventListener('dragleave', () => { if (--depth <= 0) hide(); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    hide();
    if (!document.querySelector('dialog[open]')) addDroppedFiles(e.dataTransfer.files);
  });
}

export function openNewNotebook() {
  const color = HUES[(state.notebooks.length + 1) % HUES.length];
  const title = h('input', { class: 'input', type: 'text', name: 'title', placeholder: 'Django 5.1', required: true, autofocus: true });
  const id = h('input', { class: 'input', type: 'text', name: 'id', placeholder: 'django-5.1', required: true, pattern: '[a-z0-9]([a-z0-9._]|-)*' });
  let touched = false;
  title.addEventListener('input', () => { if (!touched) id.value = title.value.toLowerCase().trim().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, ''); });
  id.addEventListener('input', () => { touched = true; });
  const form = h('form', { method: 'dialog' },
    h('div', { class: 'dlg-body' },
      h('label', { class: 'dlg-field' }, h('span', { class: 'field-label' }, 'Title'), title),
      h('label', { class: 'dlg-field' }, h('span', { class: 'field-label' }, 'Id'), id, h('span', { class: 'help' }, 'Folder name under notebooks/. Lowercase, dashes and dots.'))),
    h('div', { class: 'dlg-foot' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Create notebook')));
  const dlg = dialog('New notebook', {}, form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/notebooks', { id: id.value.trim(), title: title.value.trim(), color });
      dlg.close();
      await ctx.loadNotebooks();
      await ctx.selectNotebook(id.value.trim());
    } catch (err) { toast(err.message); }
  });
}

// Desktop app: Connect registers lectern mcp with an agent, through the installed exe. In a browser or from the
// portable exe there is a command to copy instead.
const MCP_CMD = 'npm install -g @dizzymii/lectern\nclaude mcp add lectern --scope user -- lectern mcp';

async function agentsSection() {
  const app = window.lecternApp?.agents;
  let st = null;
  try { st = app ? await app.status() : null; } catch {}
  const sec = h('div', { class: 'dlg-field' }, h('span', { class: 'field-label' }, 'Agents'));
  if (!st || st.reason) {
    sec.append(
      h('span', { class: 'help' }, st?.reason || 'To let Claude Code search your notebooks for free, run this in a terminal. Cursor is in the README.'),
      h('pre', { class: 'progress-log' }, MCP_CMD),
      h('div', null, h('button', { class: 'btn', type: 'button', onclick: () => copyText(MCP_CMD, 'Command copied') }, 'Copy')));
    return sec;
  }
  const line = h('span', { class: 'help', 'aria-live': 'polite' }, st.claude ? '' : 'Claude Code was not found. Install it, or set Claude Code binary above and open Settings again.');
  const button = (label, off, go) => h('button', { class: 'btn', type: 'button', disabled: off, onclick: async (e) => {
    const b = e.currentTarget;
    b.disabled = true; line.textContent = '';
    try { const r = await go(); if (r) { line.textContent = r.ok ? r.message : r.error; if (r.ok) toast(`Connected ${label}`, 'ok', 2200); } }
    catch (err) { line.textContent = err.message; }
    b.disabled = off;
  } }, `Connect ${label}`);
  const cursor = async () => {
    const p = await app.preview('cursor');
    if (!p.ok) return p;
    const body = h('div', { class: 'dlg-field' },
      h('p', { class: 't-read-sm' }, `This adds a lectern server under mcpServers in ${p.file}. ${p.others ? `The other ${p.others} server${p.others === 1 ? '' : 's'} in it stay as they are. ` : ''}${p.replaces ? `It replaces your current lectern entry (${p.replaces.command}). ` : ''}A copy of the old file is kept next to it as mcp.json.bak.`),
      h('pre', { class: 'progress-log' }, JSON.stringify({ mcpServers: { lectern: p.entry } }, null, 2)));
    return (await confirmDialog({ title: 'Add Lectern to Cursor', body, confirm: 'Write the file', destructive: false })) ? app.connect('cursor') : null;
  };
  sec.append(h('span', { class: 'help' }, 'Lets Claude Code or Cursor search your notebooks without spending anything. Both run Lectern through this app, so nothing else needs installing.'),
    h('div', { class: 'row2' }, button('Claude Code', !st.claude, () => app.connect('claude-code')), button('Cursor', false, cursor)), line);
  return sec;
}

// Each setting is an environment variable on the server. Only fields that changed are sent, and the
// API key comes back as its last four characters, so an empty key field means leave it alone.
export async function openSettings() {
  let data;
  try { data = await api.get('/api/settings'); } catch (e) { return toast(e.message); }
  const cleared = new Set();
  const inputs = new Map();
  const rows = data.settings.map((s) => {
    const was = s.fromEnv ? 'set in the environment' : '';
    let input;
    if (s.bool) input = h('input', { type: 'checkbox', checked: s.value === '1' });
    else input = h('input', { class: 'input', type: s.secret ? 'password' : 'text', value: s.value, autocomplete: 'off', spellcheck: 'false',
      placeholder: s.secret ? (s.set ? `saved, ending ${s.hint}` : was || 'sk-ant-...') : was });
    input.disabled = !data.editable;
    inputs.set(s.key, input);
    const clear = s.secret && s.set && data.editable
      ? h('button', { class: 'btn', type: 'button', onclick: () => { cleared.add(s.key); input.value = ''; input.placeholder = 'cleared when you save'; clear.remove(); } }, 'Remove')
      : null;
    if (s.bool) return h('label', { class: 'dlg-field' }, h('span', { class: 'field-label' }, input, ' ', s.label), h('span', { class: 'help' }, s.help));
    return h('label', { class: 'dlg-field' }, h('span', { class: 'field-label' }, s.label), clear ? h('div', { class: 'row2' }, input, clear) : input, h('span', { class: 'help' }, s.help));
  });
  const agents = data.editable ? await agentsSection() : null;
  const save = h('button', { class: 'btn primary', type: 'submit', disabled: !data.editable }, 'Save');
  const form = h('form', { method: 'dialog' },
    h('div', { class: 'dlg-body' }, data.editable ? null : h('p', { class: 'help' }, 'Settings can only be changed on the machine Lectern runs on.'), rows, agents),
    h('div', { class: 'dlg-foot' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel'), save));
  const dlg = dialog('Settings', {}, form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const patch = {};
    for (const s of data.settings) {
      const input = inputs.get(s.key);
      if (s.secret) {
        if (input.value.trim()) patch[s.key] = input.value.trim();
        else if (cleared.has(s.key)) patch[s.key] = null;
      } else {
        const v = s.bool ? (input.checked ? '1' : '') : input.value.trim();
        if (v !== s.value) patch[s.key] = v || null;
      }
    }
    save.disabled = true;
    try {
      if (Object.keys(patch).length) await api.put('/api/settings', patch);
      state.status = await api.get('/api/status');
      emit('status');
      toast('Settings saved', 'ok', 2200);
      dlg.close();
    } catch (err) { toast(err.message); save.disabled = false; }
  });
}

const KEYS = [
  ['Reading', [['J', 'next claim'], ['K', 'previous claim'], ['1-9', 'open citation n'], ['[ ]', 'previous or next citation'], ['Enter', 'pin the claim\u2019s card'], ['O', 'open at line'], ['V', 'proof ribbons: cited files in the margin'], ['E', 'show the code as it was'], ['D', 'what changed these lines'], ['C', 'copy with citations'], ['X', 'challenge the claim'], ['W', 'what could make this wrong'], ['L', 'trail log'], ['Shift H', 'claim bands on or off']]],
  ['Asking', [['/', 'focus Ask'], ['N', 'new question'], ['Up', 'edit last question'], ['M', 'model, in an empty Ask'], ['Enter', 'ask'], ['Esc', 'stop the answer']]],
  ['Moving', [['Ctrl K', 'command palette'], ['H', 'history'], ['A', 'add a source'], ['P', 'Studio'], ['Ctrl 1 2 3', 'rail, page, margin'], ['Ctrl B', 'toggle rail'], ['Ctrl Shift F', 'search all sources'], ['Ctrl Shift L', 'theme'], ['Esc', 'close the top layer'], ['?', 'this sheet']]],
];

if (window.lecternApp) KEYS[1][1].push(['Ctrl Alt Space', 'quick ask from any app, when switched on in Settings']);

export function openShortcuts() {
  if (document.querySelector('dialog.shortcuts[open]')) return;
  const dlg = dialog('Shortcuts', { large: true },
    h('div', { class: 'dlg-body keys-grid' }, KEYS.map(([group, rows]) => h('section', null, h('div', { class: 't-kicker' }, group),
      h('dl', null, rows.map(([k, label]) => [h('dt', null, kbd(...k.split(' '))), h('dd', null, label)]))))),
    h('div', { class: 'dlg-foot' }, h('span', { class: 'ks-legend t-ui-sm' }, h('span', { class: 'st-verified' }, glyph('verified', 'glyph sm')), 'verified ', h('span', { class: 'st-moved' }, glyph('moved', 'glyph sm')), 'moved ', h('span', { class: 'st-unverified' }, glyph('unverified', 'glyph sm')), 'unverified, no mark = uncited')));
  dlg.classList.add('shortcuts');
}
