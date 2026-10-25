// Shared pieces for the Studio renderers: SVG helpers, layers and status,
// text measuring, downloads, the invalid/empty state and citation hosts.

import { h, icon, esc, midPath } from '../ui/dom.js';
import { renderAnswer } from '../ui/markdown.js';

const NS = 'http://www.w3.org/2000/svg';

export function s(tag, attrs, ...kids) {
  const el = document.createElementNS(NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

// ---------- layers and status ----------

export const LAYERS = ['water', 'heath', 'spruce', 'sand', 'moor', 'lichen', 'clay', 'dusk'];
const CODE_LAYERS = ['spruce', 'sand', 'lichen', 'clay', 'dusk'];
const EXTERNAL = /^(external|system|user|actor|person|human|input|transport|third-party|thirdparty)$/i;
export const isExternal = (kind) => EXTERNAL.test(String(kind || '').trim());

const pathOf = (ref) => String((ref && typeof ref === 'object' ? ref.path : ref) || '').replace(/#.*$/, '').replace(/\\/g, '/');

// The source layer a path belongs to. The shell can answer through ctx.layerFor;
// otherwise roots with a layer win, then the default order from DESIGN 3.3.
export function layerOf(ref, ctx = {}) {
  const p = pathOf(ref);
  if (!p) return null;
  const given = ctx.layerFor?.(p);
  if (given) return given;
  const roots = ctx.api?.roots || ctx.roots || [];
  const seg = p.split('/')[0];
  for (const [i, r] of roots.entries()) {
    const name = typeof r === 'string' ? r : r?.name;
    const dir = typeof r === 'string' ? '' : String(r?.path || '').replace(/\\/g, '/');
    if (name !== seg && !(dir && p.startsWith(dir))) continue;
    if (r?.layer) return r.layer;
    if (r?.own) return 'moor';
    return CODE_LAYERS[i % CODE_LAYERS.length];
  }
  if (/\.(md|mdx|markdown|txt)$/i.test(p)) return 'water';
  let x = 0;
  for (const ch of seg) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return CODE_LAYERS[x % CODE_LAYERS.length];
}

// the app resolves a path to its source record; standalone, the first path segment stands in
export const sourceName = (ref, ctx = {}) => ctx.sourceNameFor?.(pathOf(ref)) || pathOf(ref).split('/')[0] || '';

const ST = { verified: 'verified', moved: 'moved', unverified: 'unverified', missing: 'unverified', pending: 'pending' };
export const STATUS_WORD = { verified: 'verified', moved: 'moved', unverified: 'unverified', pending: 'checking' };
export const normStatus = (st) => ST[st] || null;

// Status of a ref, from a citation on the same file (overlapping lines first).
export function statusOf(ref, artifact) {
  const p = pathOf(ref);
  if (!p) return null;
  const m = String(ref).match(/#L(\d+)/);
  const line = m ? +m[1] : null;
  const same = (artifact.citations || []).filter((c) => c.path && (c.path === p || c.path.endsWith('/' + p) || p.endsWith('/' + c.path)));
  if (!same.length) return null;
  const hit = line == null ? same[0] : same.find((c) => line >= (c.line ?? 0) && line <= (c.endLine ?? c.line ?? Infinity)) || same[0];
  return normStatus(hit.status);
}

// Citations a markdown string points at with [^n].
export function citesIn(artifact, ...texts) {
  const ns = new Set();
  for (const t of texts) for (const m of String(t ?? '').matchAll(/\[\^(\d+)\]/g)) ns.add(m[1]);
  return (artifact.citations || []).filter((c) => ns.has(String(c.n)));
}

// The benchmark mark and its variants (DESIGN 6.1) drawn as SVG children, so
// they survive SVG and PNG export. status null draws the plain mark.
export function markShapes(status) {
  const p = (d, extra = {}) => s('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', ...extra });
  if (status === 'unverified') {
    return [s('circle', { cx: 8, cy: 8, r: 6, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-dasharray': '2 2' }),
      p('M6.3 6.6a1.75 1.75 0 1 1 2.6 1.5c-.6.3-.9.7-.9 1.3v.6M8 11v1.2', { 'stroke-width': 1.5 })];
  }
  const w = status === 'pending' ? { 'stroke-width': 1, opacity: 0.6 } : {};
  const out = [p('M3 3.5H13', w), p('M8 6V13.5', w), p('M3.6 13.5L8 6L12.4 13.5', w)];
  if (status === 'moved') out.push(p('M12.4 13.5L15 11'));
  return out;
}

// Glyph as an inline element; status words go next to it, never colour alone.
export function glyph(status, size = 12) {
  const st = normStatus(status);
  return s('svg', { class: `sa-glyph${st ? ' st-' + st : ''}`, viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': 'true', overflow: 'visible' }, markShapes(st));
}

export function statusLine(status, extra) {
  const st = normStatus(status);
  return h('span', { class: `sa-status${st ? ' st-' + st : ''}` }, glyph(st, 12), h('span', null, st ? STATUS_WORD[st] : 'not checked'), extra ? h('span', { class: 'x' }, extra) : null);
}

export function swatch(layer, sm = false) {
  return h('span', { class: `swatch${sm ? ' sm' : ''}`, 'data-layer': layer || null, 'aria-hidden': 'true' });
}

// Hatch patterns for SVG (DESIGN 6.2), one per layer, ids prefixed per diagram.
export function hatchDefs(prefix, layers) {
  const defs = s('defs');
  const line = (attrs) => s('path', { class: 'hl', ...attrs });
  for (const L of layers) {
    const id = `${prefix}-${L}`;
    let pat;
    const bg = s('rect', { class: 'hb', width: 12, height: 12 });
    if (L === 'water') pat = s('pattern', { id, width: 3, height: 3, patternUnits: 'userSpaceOnUse' }, bg, line({ d: 'M0 0.5H3' }));
    else if (L === 'lichen') pat = s('pattern', { id, width: 3, height: 3, patternUnits: 'userSpaceOnUse' }, bg, line({ d: 'M0.5 0V3' }));
    else if (L === 'heath') pat = s('pattern', { id, width: 4, height: 4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, bg, line({ d: 'M0.5 0V4' }));
    else if (L === 'clay') pat = s('pattern', { id, width: 4, height: 4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(-45)' }, bg, line({ d: 'M0.5 0V4' }));
    else if (L === 'moor') pat = s('pattern', { id, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, bg, line({ d: 'M0.5 0V5M0 0.5H5' }));
    else if (L === 'spruce') pat = s('pattern', { id, width: 6, height: 6, patternUnits: 'userSpaceOnUse' }, bg, s('circle', { class: 'hr', cx: 3, cy: 3, r: 1.5 }));
    else if (L === 'sand') pat = s('pattern', { id, width: 4, height: 4, patternUnits: 'userSpaceOnUse' }, bg, s('circle', { class: 'hd', cx: 2, cy: 2, r: 0.8 }));
    else pat = s('pattern', { id, width: 6, height: 3, patternUnits: 'userSpaceOnUse' }, bg, s('rect', { class: 'hd', width: 3, height: 1 }));
    pat.setAttribute('data-layer', L);
    defs.append(pat);
  }
  return defs;
}

// ---------- text ----------

let measureCtx = null;
export const UI_FONT = '"Archivo Variable", Archivo, system-ui, sans-serif';
export const MONO_FONT = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace';
export function textWidth(text, font = `500 13px ${UI_FONT}`) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = font;
  return measureCtx.measureText(String(text)).width;
}

export function clip(text, max) {
  const t = String(text ?? '');
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

export function slug(text) {
  return String(text || 'artifact').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'artifact';
}

export function download(text, filename, type = 'text/plain') {
  const blob = text instanceof Blob ? text : new Blob([text], { type: type + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function copy(text, ctx, what = 'Copied') {
  try { await navigator.clipboard.writeText(text); ctx.toast?.(what, 'ok'); }
  catch { ctx.toast?.('Copy failed, the browser blocked clipboard access'); }
}

// ---------- controls (base classes come from styles.css) ----------

const BTN_CLS = { primary: 'primary', small: 'sm', danger: 'danger', quiet: 'quiet' };
export function btn(label, onclick, { iconName, cls = '', title, pressed, kbd } = {}) {
  const extra = cls.split(/\s+/).filter(Boolean).map((c) => (BTN_CLS[c] && BTN_CLS[c] !== c ? `${c} ${BTN_CLS[c]}` : c)).join(' ');
  return h('button', { type: 'button', class: `btn sa-btn ${extra}`, title: title || null, 'aria-pressed': pressed == null ? null : String(pressed), onclick },
    iconName ? icon(iconName, 14) : null, label ? h('span', null, label) : null, kbd ? h('kbd', null, kbd) : null);
}

export function iconButton(name, label, onclick, cls = '') {
  return h('button', { type: 'button', class: `icon-btn sa-icon ${cls}`, 'aria-label': label, title: label, onclick }, icon(name, 15));
}

export function segmented(options, value, onchange, label) {
  const wrap = h('div', { class: 'segmented sa-seg', role: 'radiogroup', 'aria-label': label });
  const draw = (v) => {
    for (const b of wrap.children) { const on = b.dataset.v === v; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }
  };
  for (const [v, text] of options) {
    wrap.append(h('button', { type: 'button', role: 'radio', 'data-v': v, onclick: () => { draw(v); onchange(v); } }, text));
  }
  wrap.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const bs = [...wrap.children];
    const i = bs.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const nb = bs[(i + (e.key === 'ArrowRight' ? 1 : bs.length - 1)) % bs.length];
    nb.click(); nb.focus(); e.preventDefault(); e.stopPropagation();
  });
  draw(value);
  wrap.set = draw;
  return wrap;
}

// A small popup menu anchored to a button.
export function menuButton(label, items, { iconName = 'upload' } = {}) {
  const wrap = h('div', { class: 'sa-menu-wrap' });
  const list = h('div', { class: 'sa-menu', role: 'menu', hidden: true });
  const close = () => { list.hidden = true; trigger.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside, true); };
  const outside = (e) => { if (!wrap.contains(e.target)) close(); };
  const trigger = btn(label, () => {
    if (!list.hidden) return close();
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    list.querySelector('button')?.focus();
    document.addEventListener('pointerdown', outside, true);
  }, { iconName, cls: 'quiet' });
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  for (const it of items) list.append(h('button', { type: 'button', role: 'menuitem', onclick: () => { close(); it.run(); } }, it.label, it.hint ? h('span', { class: 'hint' }, it.hint) : null));
  list.addEventListener('keydown', (e) => {
    const bs = [...list.querySelectorAll('button')];
    const i = bs.indexOf(document.activeElement);
    if (e.key === 'Escape') { close(); trigger.focus(); e.stopPropagation(); }
    if (e.key === 'ArrowDown') { bs[(i + 1) % bs.length].focus(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { bs[(i - 1 + bs.length) % bs.length].focus(); e.preventDefault(); }
  });
  wrap.append(trigger, list);
  // the app shell folds Export menus into the sheet header's own Export
  if (label === 'Export') wrap.exportItems = items;
  return wrap;
}

// ---------- citations ----------

// Chips call ctx.openCitation; hover popovers from the shell keep working
// because the host carries the .has-cites map.
export function citeHost(el, artifact, ctx) {
  el.classList.add('has-cites');
  el.cites = new Map((artifact.citations || []).map((c) => [String(c.n), c]));
  el.addEventListener('click', (e) => {
    const chip = e.target.closest?.('.chip');
    if (!chip || !el.contains(chip)) return;
    // inside the app, cites.js gives these chips the answer behaviour: hover card, pin, then drawer
    if (document.documentElement.hasAttribute('data-cite-cards')) return;
    e.preventDefault();
    e.stopPropagation();
    ctx.openCitation?.(Number(chip.dataset.n));
  });
  return el;
}

export function md(text, artifact, cls = '') {
  const { html } = renderAnswer(String(text ?? ''), artifact.citations || []);
  return h('div', { class: `sa-md ${cls}`, html });
}

// Inline markdown for short strings: strips the outer paragraph.
export function mdInline(text, artifact) {
  const { html } = renderAnswer(String(text ?? ''), artifact.citations || []);
  return h('span', { class: 'sa-md-inline', html: html.replace(/^<p>([\s\S]*)<\/p>\s*$/, '$1') });
}

export function citeLine(c) {
  const end = c.endLine && c.endLine !== c.line ? `-${c.endLine}` : '';
  return `${c.path}${c.line ? ':' + c.line + end : ''}`;
}

// Exhibit card for one citation: number, status word, quote, path, moved note.
export function citeCard(c, ctx) {
  const st = normStatus(c.status);
  const L = layerOf(c.path, ctx);
  const moved = st === 'moved' && c.citedLine ? `Cited L${c.citedLine}, found at L${c.line}.` : null;
  return h('div', { class: `sa-cite st-${st || 'pending'}`, 'data-layer': L },
    h('div', { class: 'top' },
      h('button', { type: 'button', class: 'n', 'aria-label': c.n != null ? `Open citation ${c.n}` : 'Open the cited line', onclick: () => (c.n != null ? ctx.openCitation?.(Number(c.n)) : ctx.openRef?.(citeLine(c))) }, c.n ?? '·'),
      statusLine(st)),
    c.quote ? h('blockquote', null, c.quote) : null,
    h('div', { class: 'path', title: citeLine(c) }, swatch(L, true), midPath(citeLine(c))),
    moved ? h('div', { class: 'moved' }, moved) : null);
}

// one middle-truncate helper for answers and sheets alike (ui/dom.js)
export { midPath };

export function retry(container, artifact, ctx) {
  if (typeof ctx.regenerate === 'function') return ctx.regenerate(artifact);
  container.dispatchEvent(new CustomEvent('studio:retry', { bubbles: true, detail: { id: artifact.id, artifact } }));
}

// ---------- states ----------

// Shown for status invalid/error, or data the renderer cannot draw (DESIGN 12).
export function stateView(container, artifact, ctx, { title, message, raw, errors } = {}) {
  const rawText = raw ?? artifact.raw ?? artifact.text ?? (artifact.data ? JSON.stringify(artifact.data, null, 2) : artifact.markdown) ?? '';
  const isError = artifact.status === 'error';
  const errs = errors ?? artifact.errors ?? (artifact.error && !isError ? [artifact.error] : []);
  const count = errs.length ? ` ${errs.length} ${errs.length === 1 ? 'error' : 'errors'}.` : '';
  const head = title || (isError ? 'Generation failed.' : `This sheet did not validate.${count}`);
  const text = (e) => (typeof e === 'string' ? e : JSON.stringify(e));
  const details = [head, message, ...errs.map(text)].filter(Boolean).join('\n');
  const el = h('div', { class: 'sa-state', tabindex: '-1' },
    h('div', { class: 'sa-banner error', role: 'alert' },
      h('div', { class: 'bh' }, glyph('unverified', 16), h('span', null, head)),
      message ? h('p', { class: 'msg' }, message) : null,
      errs.length ? h('ul', { class: 'sa-errors' }, errs.slice(0, 12).map((e) => h('li', null, text(e)))) : null,
      h('div', { class: 'sa-row' },
        btn('Retry', () => retry(container, artifact, ctx), { cls: 'primary', kbd: 'R' }),
        btn('Copy details', () => copy(details + (rawText ? '\n\n' + rawText : ''), ctx, 'Details copied'), { cls: 'quiet' }))),
    rawText ? h('section', { class: 'sa-raw' }, h('div', { class: 't-kicker' }, 'Raw output'), h('pre', null, h('code', null, rawText))) : null,
    artifact.model ? h('div', { class: 'sa-raw-meta' }, [artifact.model, artifact.attempts ? `${artifact.attempts} attempts` : null].filter(Boolean).join(' · ')) : null);
  el.addEventListener('keydown', (e) => {
    if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest?.('input, textarea, [contenteditable]')) { e.preventDefault(); retry(container, artifact, ctx); }
  });
  return el;
}

// Empty data: the renderer's line plus Regenerate (DESIGN 12).
export function emptyView(text, sub, action = null) {
  return h('div', { class: 'sa-state' }, h('div', { class: 'sa-empty' },
    h('p', { class: 'line' }, text), sub ? h('p', { class: 'sub' }, sub) : null,
    action ? h('div', { class: 'sa-row' }, action) : null));
}

export function regenButton(container, artifact, ctx) {
  return btn('Regenerate', () => retry(container, artifact, ctx), { iconName: 'refresh' });
}

// Summary prose the server kept outside the JSON block.
export function summaryBlock(artifact, open = false) {
  if (!artifact.summary || !String(artifact.summary).trim()) return null;
  return h('details', { class: 'sa-summary', open }, h('summary', null, h('span', { class: 't-kicker' }, 'Notes from the model')), md(artifact.summary, artifact));
}

export function refLabel(ref) {
  const m = String(ref || '').match(/^(.*?)(?:#L(\d+)(?:-L?(\d+))?)?$/);
  if (!m) return String(ref);
  const base = m[1].split('/').pop();
  return m[2] ? `${base}:${m[2]}${m[3] ? '-' + m[3] : ''}` : base;
}

// A file reference: layer swatch, file and line, status glyph. Opens the drawer.
export function refChip(ref, ctx, artifact) {
  if (!ref) return null;
  const L = layerOf(ref, ctx);
  const st = artifact ? statusOf(ref, artifact) : null;
  return h('button', { type: 'button', class: 'sa-ref', title: `Open ${ref}${st ? ' (' + STATUS_WORD[st] + ')' : ''}`, onclick: (e) => { e.stopPropagation(); ctx.openRef?.(ref); } },
    swatch(L, true), h('bdi', null, refLabel(ref)), st ? glyph(st, 12) : null);
}

// ---------- export ----------

// Copy computed paint onto a cloned SVG so it renders the same outside the page.
const PAINT = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'letter-spacing', 'text-anchor', 'dominant-baseline', 'color'];
export function inlineSvg(srcRoot, { box, background }) {
  const clone = srcRoot.cloneNode(true);
  const a = [srcRoot, ...srcRoot.querySelectorAll('*')];
  const b = [clone, ...clone.querySelectorAll('*')];
  a.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const t = b[i];
    for (const p of PAINT) { const v = cs.getPropertyValue(p); if (v) t.style.setProperty(p, v); }
    if (cs.display === 'none' || cs.visibility === 'hidden') t.setAttribute('display', 'none');
    t.removeAttribute('class');
  });
  const svg = s('svg', { xmlns: NS, viewBox: `${box.x} ${box.y} ${box.w} ${box.h}`, width: Math.round(box.w), height: Math.round(box.h) });
  if (background) svg.append(s('rect', { x: box.x, y: box.y, width: box.w, height: box.h, fill: background }));
  svg.append(clone);
  return new XMLSerializer().serializeToString(svg);
}

export function svgToPng(svgText, w, h2, scale = 2) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(w * scale); c.height = Math.round(h2 * scale);
      const g = c.getContext('2d');
      g.scale(scale, scale);
      g.drawImage(img, 0, 0, w, h2);
      c.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed'))), 'image/png');
    };
    img.onerror = () => reject(new Error('PNG export failed'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
  });
}

export const cssVar = (el, name, fallback = '') => getComputedStyle(el).getPropertyValue(name).trim() || fallback;

// Mermaid ids must be simple words.
export function mermaidId(id, used) {
  let base = String(id).replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, 'n$1') || 'n';
  if (/^(end|graph|subgraph|style|class|click|default)$/i.test(base)) base = 'n_' + base;
  let out = base, i = 2;
  while (used.has(out) && used.get(out) !== id) out = base + '_' + i++;
  used.set(out, id);
  return out;
}
export const mermaidText = (t) => String(t ?? '').replace(/\[\[[^\]]*\]\]/g, '').replace(/"/g, '#quot;').replace(/[\r\n]+/g, ' ').trim();

export { h, icon, esc };
