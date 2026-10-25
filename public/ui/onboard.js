// First run (SCREENS 9): one survey sheet on the page. Name the notebook, add sources,
// learn what a mark means. Stays up after the first source lands until "Start asking".

import { h } from './dom.js';
import { api } from './api.js';
import { state, ctx } from './state.js';
import { sourcesOf, swatch, glyph, kbd } from './layers.js';
import { addSource } from './dialogs.js';

let active = false;
const added = [];   // { label, kind, ok }
let nameDraft = null;
let found = null;   // { roots, docs } from /api/candidates, fetched once

export const onboardingActive = () => active || (!!state.nb && !sourcesOf().length) || (!state.nb && ctx.firstRun);

function guess(v) {
  const s = v.trim().replace(/\\/g, '/');
  if (/^https?:\/\/(www\.)?(github\.com|gitlab\.com|bitbucket\.org|codeberg\.org)\//i.test(s) || /\.git$/i.test(s)) {
    const name = s.replace(/\.git$/i, '').split('/').filter(Boolean).pop();
    return { kind: 'git', url: s, name: slug(name), label: 'git repo' };
  }
  if (/^https?:\/\//i.test(s)) return { kind: 'url', url: s, label: 'docs page' };
  const name = s.replace(/\/$/, '').split('/').pop();
  return { kind: 'folder', path: s, name: slug(name), label: 'folder' };
}
const slug = (s) => String(s || 'source').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'source';

async function ensureNotebook(title) {
  if (state.nbId) return;
  const id = slug(title);
  await api.post('/api/notebooks', { id, title, color: 'peach' });
  await ctx.loadNotebooks();
  ctx.creatingNotebook = true;
  try { await ctx.selectNotebook(id); } finally { ctx.creatingNotebook = false; ctx.firstRun = false; }
  active = true;
}

export function renderOnboarding() {
  active = true;
  const name = h('input', { class: 'input', id: 'ob-name', value: nameDraft ?? state.nb?.title ?? '', placeholder: 'My notebook', 'aria-label': 'Notebook name', readOnly: !!state.nb });
  name.addEventListener('input', () => { nameDraft = name.value; });
  const field = h('input', { class: 'input', id: 'ob-src', placeholder: 'Paste a folder, a git URL, or a docs URL', 'aria-label': 'Source to add', autocomplete: 'off', spellcheck: 'false' });
  const addBtn = h('button', { class: 'btn', type: 'submit' }, 'Add', kbd('Enter'));
  const err = h('div', { class: 'field-error', hidden: true, role: 'alert' });
  const list = h('div', { class: 'ob-added' });
  const start = h('button', { class: 'btn primary', type: 'button', onclick: () => { active = false; ctx.newConversation(); } }, 'Start asking', kbd('Ctrl', 'Enter'));
  const note = h('span', { class: 't-ui-sm ob-note' });

  const drawAdded = () => {
    const have = sourcesOf();
    const inFound = new Set([...(found?.roots || []).map((c) => c.path), ...(found?.docs || []).map((d) => d.url)]);
    list.replaceChildren(...added.filter((a) => !inFound.has(a.value)).map((a) => h('div', { class: 'ob-row' },
      (a.src = a.src || (a.ok && have.find((s) => s.name === a.name))) ? swatch(a.src) : h('span', { class: 'swatch' }),
      h('div', { class: 'ob-row-t' }, h('div', { class: 'mono' }, a.value), h('div', { class: 't-mono-sm' }, a.label)),
      h('span', { class: `ob-state st-${a.ok ? 'verified' : 'pending'}` }, a.ok ? glyph('verified', 'glyph sm') : null, a.ok ? 'Added' : 'Adding'))));
    drawFound?.();
    const ready = have.length > 0;
    start.disabled = !ready;
    note.textContent = ready ? 'You can ask while indexing. Answers will say what they missed.' : 'Add one source to start.';
  };

  async function addValue(v) {
    err.hidden = true;
    field.removeAttribute('aria-invalid');
    const body = guess(v);
    const row = { value: v, label: body.label, name: body.name, ok: false };
    added.push(row);
    drawAdded();
    addBtn.disabled = true;
    try {
      await ensureNotebook((name.value || 'My notebook').trim());
      await addSource(body);
      row.ok = true;
      if (field.value.trim() === v) field.value = '';
      state.fileIndex = null;
      await ctx.refreshNotebook();
    } catch (ex) {
      added.splice(added.indexOf(row), 1);
      err.hidden = false;
      field.setAttribute('aria-invalid', 'true');
      const missing = /not found|not a directory|no such|ENOENT|does not exist/i.test(ex.message);
      err.replaceChildren(glyph('unverified', 'glyph sm'), missing && body.kind === 'folder' ? `Folder not found: ${v}` : ex.message);
    } finally {
      addBtn.disabled = false;
      drawAdded();
      field.focus();
    }
  }

  const form = h('form', { class: 'ob-add', onsubmit: (e) => {
    e.preventDefault();
    const v = field.value.trim();
    if (v) addValue(v);
  } }, field, addBtn);

  // Found on this machine, then Pin docs (SCREENS 9); rows turn into "Added" once taken
  const foundEl = h('div', { class: 'ob-found' });
  const help = h('p', { class: 't-ui-sm ob-help' }, 'A folder becomes a code root, a git URL is cloned, a docs URL is saved as a page. Drop files anywhere to pin them.');
  const drawFound = () => {
    if (!found) return;
    const taken = new Set(added.map((a) => a.value));
    const row = (value, sub, layer, role, shown = value) => h('div', { class: 'ob-row' },
      swatch({ layer }),
      h('div', { class: 'ob-row-t' }, h('div', { class: 'mono' }, shown), sub ? h('div', { class: 't-mono-sm' }, sub) : null),
      taken.has(value)
        ? h('span', { class: `ob-state st-${added.find((a) => a.value === value)?.ok ? 'verified' : 'pending'}` }, added.find((a) => a.value === value)?.ok ? glyph('verified', 'glyph sm') : null, added.find((a) => a.value === value)?.ok ? 'Added' : 'Adding')
        : [h('span', { class: 't-ui-sm ob-role' }, role), h('button', { class: 'btn sm', type: 'button', onclick: () => addValue(value) }, 'Add')]);
    let r = 0;
    const roots = found.roots.slice(0, 5).map((c) => row(c.path, c.kind === 'repo' ? ['git repo', c.branch].filter(Boolean).join(' · ') : c.version || 'folder',
      c.kind === 'repo' ? 'moor' : ['spruce', 'sand', 'lichen', 'clay'][r++ % 4], c.kind === 'repo' ? 'Your repo' : 'Code root'));
    const docs = found.docs.map((d) => row(d.url, 'docs site', 'water', 'Pinned docs', d.label));
    // the suggestions say what each kind becomes, so the help line steps aside
    help.hidden = roots.length + docs.length > 0;
    foundEl.replaceChildren(
      roots.length ? h('div', { class: 'ob-found-h' }, h('span', { class: 't-kicker' }, 'Found on this machine'), h('span', { class: 't-mono-sm', title: found.scanned ? `Read only, one level deep in ${found.scanned}. Set LECTERN_PROJECTS_DIR to look elsewhere.` : null }, `${roots.length} folder${roots.length === 1 ? '' : 's'}${found.scanned ? ` in ${found.scanned.split(/[\/]/).filter(Boolean).pop()}` : ''}`)) : '',
      ...roots,
      docs.length ? h('div', { class: 'ob-found-h' }, h('span', { class: 't-kicker' }, 'Pin docs')) : '',
      ...docs);
  };
  if (!found) api.get('/api/candidates').then((c) => { found = { roots: c?.roots || [], docs: c?.docs || [], scanned: c?.scanned || null }; drawAdded(); }).catch(() => { found = { roots: [], docs: [] }; });

  const mark = (st, word, text, extra) => h('div', { class: `ob-mark st-${st}` },
    h('span', { class: 'ob-glyph' }, st === 'none' ? h('span', { class: 'ob-empty' }) : glyph(st), extra || null),
    h('div', null, h('div', { class: 't-kicker' }, word), h('p', null, text)));

  const sheet = h('section', { class: 'sheet neatline', 'aria-label': 'Set up this notebook' },
    h('span', { class: 'crop tl' }), h('span', { class: 'crop tr' }), h('span', { class: 'crop bl' }), h('span', { class: 'crop br' }),
    h('div', { class: 'double-rule' }),
    h('div', { class: 'sheet-grid' },
      h('div', { class: 'sheet-left' },
        h('div', { class: 't-kicker' }, h('span', { class: 'accent' }, 'Sheet 000'), ' · Setting out'),
        h('h1', { class: 't-cover-md' }, 'A blank sheet.'),
        h('p', { class: 'ob-lede' }, 'Every good map starts as one. Add the docs you trust and the code you build against. Lectern answers from them and checks every quote it cites.'),
        h('div', { class: 'ob-step' }, h('div', { class: 'ob-step-h' }, h('span', { class: 'num' }, '01'), h('label', { for: 'ob-name' }, 'Name the notebook')), name),
        h('div', { class: 'ob-step' }, h('div', { class: 'ob-step-h' }, h('span', { class: 'num' }, '02'), h('label', { for: 'ob-src' }, 'Add sources')), form, err, list, foundEl,
          help)),
      h('div', { class: 'sheet-right' },
        contour(),
        h('div', { class: 'ob-step' }, h('div', { class: 'ob-step-h' }, h('span', { class: 'num' }, '03'), h('span', null, 'What a mark means')),
          h('div', { class: 'ob-marks' },
            mark('verified', 'Verified', 'The quote was found again at that file and line.'),
            mark('moved', 'Moved', 'The same text was found at another line, and we say which.', h('span', { class: 'gm-line' }, 'L96')),
            mark('unverified', 'Unverified', 'The quote was not found. It is marked in red.'),
            mark('none', 'No mark', 'The sentence has no citation.'))))),
    h('div', { class: 'sheet-foot' }, start, note, h('span', { class: 'grow' }),
      h('span', { class: 't-ui-sm' }, 'Ask from a terminal: ', h('code', null, `lectern ask ${state.nbId || '<notebook>'}`))));
  sheet.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !start.disabled) { e.preventDefault(); start.click(); } });
  drawAdded();
  setTimeout(() => (state.nb ? field : name).focus());
  return h('div', { class: 'onboard' }, sheet);
}

function contour() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 280 170');
  svg.setAttribute('class', 'ob-contour');
  svg.setAttribute('aria-hidden', 'true');
  // a main hill and a spur, lobed rings drawn as smooth closed curves
  const hill = (cx, cy, rx, ry, n, wob) => Array.from({ length: n }, (_, k) => {
    const f = 1 - k / n;
    const pts = Array.from({ length: 14 }, (_, i) => {
      const t = (i / 14) * Math.PI * 2;
      const r = 1 + wob * (Math.sin(3 * t + 0.7 + k * 0.35) * 0.55 + Math.sin(5 * t + 2.1 - k * 0.2) * 0.3 + Math.sin(2 * t + 4) * 0.4) * (0.6 + 0.4 * f);
      return [cx + (1 - f) * 10 + Math.cos(t) * rx * f * r, cy - (1 - f) * 8 + Math.sin(t) * ry * f * r];
    });
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[(i + pts.length - 1) % pts.length], p1 = pts[i], p2 = pts[(i + 1) % pts.length], p3 = pts[(i + 2) % pts.length];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${c1.map((v) => v.toFixed(1)).join(' ')} ${c2.map((v) => v.toFixed(1)).join(' ')} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d + 'Z';
  });
  const rings = [...hill(150, 92, 128, 72, 9, 0.12), ...hill(52, 168, 48, 26, 4, 0.1)];
  svg.innerHTML = rings.map((d) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1"/>`).join('')
    + '<use href="/marks.svg#mark" x="150" y="62" width="12" height="12" class="ob-bm"/><text x="168" y="72" class="ob-bm-t">BM 000</text>';
  return svg;
}

export function endOnboarding() { active = false; }
