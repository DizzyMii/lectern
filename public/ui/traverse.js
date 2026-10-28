// The trail as a map (DESIGN 11.10): which file and lines each tool call read, and a survey drawing of the visit order.
// No viewer, chat or markdown imports here, so the model code loads in Node for the tests.

import { h, esc } from './dom.js';
import { state, ctx } from './state.js';
import { sourcesOf, sourceFor, statusOf, STATUS_WORD, layerAttrs, swatch, relPath, fileKey } from './layers.js';
import { RANK } from './status.js';

const inNotebook = (p) => !/^(\/|[a-z]:|\.\.\/)/i.test(p);
const slashes = (p) => String(p ?? '').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
const LABEL = /^Read (.+?)(?: (\d+)-(\d*))?$/;

// Which file and lines a tool call read, for both engines. `to` is null when it ran to the end of the file.
// Claude Code with no limit reads 2000 lines; the API tool reads 200 and never more than 300 (shelf.mjs readTool).
export function toolRead(step, nb = state.nb) {
  if (!/^read$/i.test(step?.name || '')) return null;
  const inp = step.input;
  if (step.name === 'read' && inp?.root && inp.path != null) {
    const from = Math.max(1, Number(inp.start) || 1);
    return { path: slashes(inp.root + '/' + slashes(inp.path).replace(/^(\.\/)+/, '')), from, to: Math.min(inp.end ?? from + 199, from + 299) };
  }
  const label = LABEL.exec(String(step.summary || '').trim());
  const name = label && !label[1].startsWith('?') ? label[1] : null;
  const file = step.name === 'Read' && (inp?.file_path || inp?.path);
  if (file) {
    const p = relPath(file, nb);
    const from = Math.max(1, Number(inp.offset) || 1);
    return { path: inNotebook(p) ? p : name || p, from, to: from + (inp.limit > 0 ? Number(inp.limit) : 2000) - 1, ...(inp.limit > 0 ? {} : { open: true }) };
  }
  if (!name) return null;
  // a stripped Studio step: the label is all there is
  const from = label[2] ? Number(label[2]) : 1;
  return { path: name, from, to: label[2] ? (label[3] ? Number(label[3]) : from + 1999) : null, ...(label[2] && !label[3] ? { open: true } : {}) };
}

// sorted ranges with the ones that touch folded together; a null end is the end of the file
function merge(list) {
  const out = [];
  for (const [from, to] of [...list].sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1), end = to ?? Infinity;
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], end);
    else out.push([from, end]);
  }
  return out;
}

// Lines of one file the steps read, as merged [from, to] ranges clipped to the file
export function readRanges(steps, path, lineCount, nb = state.nb) {
  const key = fileKey(path, nb), out = [];
  for (const s of steps || []) {
    if (s.ok === false) continue;
    const r = toolRead(s, nb);
    if (r && r.from <= lineCount && fileKey(r.path, nb) === key) out.push([r.from, r.to == null ? lineCount : Math.min(lineCount, r.to)]);
  }
  return merge(out);
}

// kept for Studio, which stores this on artifacts
export function trailSummary(steps) {
  const reads = new Set(), counts = { search: 0, glob: 0, other: 0 };
  for (const s of steps) {
    if (/^read$/i.test(s.name)) reads.add(fileKey(toolRead(s)?.path) || s.summary || s.id);
    else if (/^grep$/i.test(s.name)) counts.search++;
    else if (/^(glob|ls)$/i.test(s.name)) counts.glob++;
    else counts.other++;
  }
  const parts = [];
  if (reads.size) parts.push(`Read ${reads.size} file${reads.size === 1 ? '' : 's'}`);
  if (counts.search) parts.push(`${counts.search} search${counts.search === 1 ? '' : 'es'}`);
  if (counts.glob) parts.push(`${counts.glob} file lookup${counts.glob === 1 ? '' : 's'}`);
  if (counts.other) parts.push(`${counts.other} other step${counts.other === 1 ? '' : 's'}`);
  return parts.join(', ') || 'No tool calls';
}

// where a grep, glob or ls looked: "Grep "x" in code (*.java)" and "ls code/net" both give a label, "" is the notebook folder
function searchScope(step) {
  const sum = String(step.summary || '');
  const m = /^ls (\S+)/.exec(sum) || / in (\S+?)(?: \([^)]*\))*$/.exec(sum);
  const label = m ? m[1] : step.input?.root ? step.input.root + (step.input.dir ? '/' + step.input.dir : '') : '';
  const p = slashes(label).replace(/\/$/, '');
  return p === 'notebook' ? '' : p;
}

export function buildTraverse(steps, cites = [], nb = state.nb, isDoc = () => false) {
  const stations = [], byKey = new Map(), legs = [];
  let prev = null, searchSteps = 0;
  const visit = (key, make, kind) => {
    let st = byKey.get(key);
    if (!st) {
      st = { id: stations.length, key, ...make, band: -1, reads: [], searches: 0, via: 'trail', status: null, ns: [], cite: null };
      stations.push(st); byKey.set(key, st);
    }
    if (prev && prev !== st) legs.push({ from: prev.id, to: st.id, kind });
    prev = st;
    return st;
  };
  for (const s of steps || []) {
    if (s.name === 'Shelf' || s.ok === false) continue;
    const r = toolRead(s, nb);
    if (r) {
      visit('f:' + fileKey(r.path, nb), { kind: 'file', path: r.path, label: r.path }, 'read').reads.push([r.from, r.open ? null : r.to]);
    } else if (/^(grep|glob|ls)$/i.test(s.name)) {
      const label = searchScope(s);
      searchSteps++;
      const st = /\.\w{1,8}$/.test(label.split('/').pop())
        ? visit('f:' + fileKey(label, nb), { kind: 'file', path: label, label }, 'search')
        : visit('d:' + fileKey(label + '/', nb).replace(/\/$/, ''), { kind: 'scope', path: label, label }, 'search');
      st.searches++;
    }
  }
  for (const c of cites || []) {
    const path = slashes(c?.path);
    if (!path) continue;
    const key = 'f:' + fileKey(path, nb);
    let st = byKey.get(key);
    if (!st) {
      st = { id: stations.length, key, kind: 'file', path, label: path, band: -1, reads: [], searches: 0, via: isDoc(path) ? 'pinned' : 'cited', status: null, ns: [], cite: null };
      stations.push(st); byKey.set(key, st);
    }
    const stat = statusOf(c);
    st.ns.push(c.n);
    if (!st.cite || RANK[stat] > RANK[st.status] || (RANK[stat] === RANK[st.status] && c.n < st.cite.n)) { st.status = stat; st.cite = c; }
  }
  // the rail's order, so a source keeps its row from answer to answer
  const srcOf = (st) => sourceFor(st.kind === 'scope' ? st.path + '/' : st.path, nb);
  const used = new Set(stations.map(srcOf).filter(Boolean));
  const bands = sourcesOf(nb).filter((s) => used.has(s)).map((src) => ({ src, name: src.name, stations: [] }));
  if (stations.some((st) => !srcOf(st))) bands.push({ src: null, name: 'Other', stations: [] });
  for (const st of stations) {
    const src = srcOf(st);
    st.band = src ? bands.findIndex((b) => b.src === src) : bands.length - 1;
    bands[st.band].stations.push(st.id);
  }
  return { bands, stations, legs, cites: cites || [], summary: { files: stations.filter((s) => s.reads.length).length, searches: searchSteps, cited: stations.filter((s) => s.status).length } };
}

const range = ([a, b]) => (a === b ? `L${a}` : `L${a}-${b === Infinity ? 'end' : b}`);

// tooltip text: where, what lines, how often searched, what cited it
export function stationTitle(st) {
  const parts = [st.kind === 'scope' ? st.path || 'notebook' : st.path];
  if (st.reads.length) {
    const rs = merge(st.reads);
    parts.push(`read ${rs.slice(0, 3).map(range).join(', ')}${rs.length > 3 ? '…' : ''}`);
  }
  if (st.searches) parts.push(`searched ${st.searches} time${st.searches === 1 ? '' : 's'}`);
  if (st.status) parts.push(`cited as ${st.ns.join(', ')} (${STATUS_WORD[st.status]})`);
  if (st.via === 'pinned') parts.push('from the pinned docs');
  if (st.via === 'cited') parts.push('not opened by the trail');
  return parts.join(' · ');
}

const ROW = 40, PAD = 20, PITCH = 40, LINE = 14;

// a cited station prints its citation numbers under its mark, clear of the line the legs run along
const textW = (st) => (st.status ? 7 * st.ns.join(',').length : 0);

export function traverseSvg(m) {
  const n = m.stations.length, H = m.bands.length * ROW;
  // the visit order sets the order, and a station whose numbers are wider than the gap pushes the next one along.
  // The numbers start 8px left of their mark, so the next station sits past their end with room for the leg's riser.
  const xs = [];
  m.stations.forEach((st, i) => { xs.push(i ? xs[i - 1] + Math.max(PITCH, textW(m.stations[i - 1]) + 18) : PAD); });
  const W = Math.max(120, (xs.at(-1) ?? PAD) + (m.stations.length ? Math.max(0, textW(m.stations.at(-1)) - 8) : 0) + PAD);
  const x = (st) => xs[st.id], y = (st) => st.band * ROW + LINE;
  const bands = m.bands.map((b, i) => `<rect class="tm-band"${b.src ? ` data-layer="${esc(b.src.layer)}"${b.src.dense ? ' data-dense' : ''}` : ''} x="0" y="${i * ROW}" width="${W}" height="${ROW - 2}"/>`).join('');
  // a leg runs along the station line, rises in the gap just before the station it reaches and never crosses a row of numbers
  const legs = m.legs.map((l) => {
    const a = m.stations[l.from], b = m.stations[l.to];
    const d = y(a) === y(b) ? `M${x(a)} ${y(a)}H${x(b)}` : `M${x(a)} ${y(a)}H${x(b) - 14}V${y(b)}H${x(b)}`;
    return `<path class="tm-leg ${l.kind}" d="${d}"/>`;
  }).join('');
  const pts = m.stations.map((st) => {
    const cls = ['tm-pt', st.kind, st.status && `cited st-${st.status}`, st.via === 'pinned' && 'pinned', st.via === 'cited' && !st.status && 'cited'].filter(Boolean).join(' ');
    const mark = st.status
      ? `<circle class="tm-halo" r="9"/><use href="/marks.svg#${esc(st.status)}" x="-8" y="-8" width="16" height="16"/><text class="tm-n" x="-8" y="${ROW - LINE - 7}">${esc(st.ns.join(','))}</text>`
      : st.kind === 'scope' ? '<rect class="tm-dot" x="-4" y="-4" width="8" height="8"/>' : '<circle class="tm-dot" r="4.5"/>';
    const src = m.bands[st.band]?.src;
    return `<g class="${cls}"${src ? ` data-layer="${esc(src.layer)}"` : ''} data-i="${st.id}" transform="translate(${x(st)} ${y(st)})"><title>${esc(stationTitle(st))}</title><circle class="tm-hit" r="12"/>${mark}</g>`;
  }).join('');
  const label = `Trail map: ${n} stations in ${m.bands.length} source${m.bands.length === 1 ? '' : 's'}, ${m.summary.cited} cited. The log below lists every step.`;
  return `<svg class="tm-svg" width="${W}" height="${H}" role="img" aria-label="${esc(label)}" focusable="false">${bands}${legs}${pts}</svg>`;
}

export function drawTraverse(m) {
  const labels = h('div', { class: 'tm-labels' }, m.bands.map((b) => h('div', { class: 'tm-label', ...layerAttrs(b.src), title: b.name }, b.src ? swatch(b.src, true) : null, h('span', null, b.name))));
  const scroll = h('div', { class: 'tm-scroll', tabindex: '0', html: traverseSvg(m) });
  scroll.addEventListener('click', (e) => {
    const g = e.target.closest?.('.tm-pt');
    const st = g && m.stations[+g.dataset.i];
    if (!st) return;
    const c = st.cite;
    if (c) ctx.openFile(st.path, { line: c.line, endLine: c.endLine, quote: c.quote, cite: c, list: m.cites });
    else if (st.kind === 'file') ctx.openFile(st.path, { line: st.reads[0]?.[0] > 1 ? st.reads[0][0] : null });
    else if (m.bands[st.band]?.src) ctx.openSource(m.bands[st.band].src);
  });
  return h('figure', { class: 'tmap-fig' }, h('div', { class: 'tm-grid' }, labels, scroll),
    h('figcaption', { class: 'tm-cap' }, 'Marked stations were cited. Hollow ones were read and not cited. Dashed legs are searches.'));
}
