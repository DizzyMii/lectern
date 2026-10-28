// Small DOM helpers shared by every module.

export function h(tag, attrs, ...kids) {
  const el = tag === 'svg' || tag === 'path' ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : String(k));
  }
}

export const clear = (el) => { el.replaceChildren(); return el; };

const ICONS = {
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5',
  x: 'M6 6l12 12M18 6L6 18',
  chev: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  code: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M10 12l-2 2 2 2M14 12l2 2-2 2',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M8 7h7',
  chat: 'M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  note: 'M5 4h10l4 4v12H5zM15 4v4h4M8 12h8M8 16h5',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  up: 'M12 19V5M6 11l6-6 6 6',
  stop: 'M7 7h10v10H7z',
  play: 'M8 5l11 7-11 7z',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  check: 'M5 12.5l4.5 4.5L19 7',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z',
  git: 'M6 3v12M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 6a3 3 0 1 0 0 .01M18 9c0 4-6 3-12 6',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  panel: 'M4 5h16v14H4zM14 5v14',
  alert: 'M12 4l9 16H3zM12 10v4M12 17v.01',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  bookmark: 'M7 4h10v16l-5-4-5 4z',
  quote: 'M7 7h4v5H8c0 2 1 3 3 3v2c-3 0-5-2-5-5zM14 7h4v5h-3c0 2 1 3 3 3v2c-3 0-5-2-5-5z',
  regex: 'M17 3v8M13.5 5l7 4M20.5 5l-7 4M5 17h4v4H5z',
  wrap: 'M4 6h16M4 12h13a3 3 0 0 1 0 6h-4M4 18h5M15 16l-2 2 2 2',
  open: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  cpu: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  graph: 'M6 4a2 2 0 1 0 .01 0M18 4a2 2 0 1 0 .01 0M12 16a2 2 0 1 0 .01 0M7 7.5l4 7M17 7.5l-4 7M8 6h8',
  seq: 'M6 3v18M18 3v18M6 8h12M15 5.5L18 8l-3 2.5M18 15H6M9 12.5L6 15l3 2.5',
  checklist: 'M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M11 6.5h9M11 12.5h9M11 18.5h9',
  quiz: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.01',
  cards: 'M8 4h10a2 2 0 0 1 2 2v9M4 9a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  blueprint: 'M4 4h16v16H4zM4 9h16M9 9v11M13 13h4M13 16h3',
  scale: 'M12 4v16M8 20h8M5 7h14M5 7l-3 7h6zM19 7l-3 7h6z',
  flask: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 15h9',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z',
  flow: 'M4 4h6v5H4zM14 15h6v5h-6zM7 9v4a2 2 0 0 0 2 2h5',
  deps: 'M4 4h5v5H4zM15 4h5v5h-5zM15 15h5v5h-5zM9 6.5h6M17.5 9v6M6.5 9v6.5A2.5 2.5 0 0 0 9 18h6',
  bot: 'M8 8h8a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3zM12 4v4M9.5 13v1M14.5 13v1M2 13v2M22 13v2',
  wand: 'M4 20L15 9M14 3v2M19 8h2M17.5 5.5l1-1M19 12l1 1M12 7l5 5',
  cap: 'M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5M22 9v6',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  swap: 'M4 8h14l-3-3M20 16H6l3 3',
  type: 'M5 7V5h14v2M12 5v14M9 19h6',
  split: 'M12 3v18M4 7h5M4 12h5M4 17h5M15 7h5M15 12h3M15 17h5',
  diff: 'M5 3h14v18H5zM9 8h6M12 5v6M9 16h6',
  hammer: 'M14 4l6 6-3 3-6-6zM12.5 8.5L4 17l3 3 8.5-8.5',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 7.5a.5.5 0 1 0 .01 0',
  back: 'M15 6l-6 6 6 6',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  studio: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
};

export function icon(name, size = 16) {
  const svg = h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  svg.append(h('path', { d: ICONS[name] || ICONS.file }));
  return svg;
}

export function iconBtn(name, label, onclick, cls = '') {
  return h('button', { class: `icon-btn ${cls}`, 'aria-label': label, title: label, onclick }, icon(name));
}

export function toast(msg, kind = 'error', ms = 5200) {
  const box = document.getElementById('toasts');
  const t = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    h('div', { class: 'msg' }, msg),
    iconBtn('x', 'Dismiss', () => close()));
  const close = () => { t.classList.add('out'); setTimeout(() => t.remove(), 200); };
  box.append(t);
  if (ms) setTimeout(close, ms);
  while (box.children.length > 4) box.firstChild.remove();
}

// the quick-ask popup (?quick=1) shares this origin's storage with the main window, so it reads it and never writes it
export const quickMode = typeof location !== 'undefined' && new URLSearchParams(location.search).has('quick');
export const store = {
  get(k, d) { try { const v = localStorage.getItem('nb.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { if (quickMode) return; try { localStorage.setItem('nb.' + k, JSON.stringify(v)); } catch {} },
};

export async function copyText(text, what = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(what, 'ok', 1800); }
  catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }, text);
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast(what, 'ok', 1800); } catch { toast('Copy failed'); }
    ta.remove();
  }
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function fmtNum(n) {
  if (n == null || isNaN(n)) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k';
  return String(Math.round(n));
}

export function fmtAgo(t) {
  if (!t) return '';
  const d = (Date.now() - new Date(t).getTime()) / 1000;
  if (!isFinite(d)) return '';
  if (d < 60) return 'now';
  if (d < 3600) return Math.floor(d / 60) + 'm';
  if (d < 86400) return Math.floor(d / 3600) + 'h';
  if (d < 86400 * 7) return Math.floor(d / 86400) + 'd';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const basename = (p) => String(p || '').split('/').pop();

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Positions a fixed element next to an anchor rect, flipping to stay on screen.
export function place(el, rect, gap = 8) {
  const w = el.offsetWidth, hgt = el.offsetHeight;
  let left = Math.min(Math.max(16, rect.left + rect.width / 2 - w / 2), window.innerWidth - w - 16);
  let top = rect.bottom + gap;
  if (top + hgt > window.innerHeight - 16) top = Math.max(16, rect.top - hgt - gap);
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}

// Up/down keyboard movement over a list of focusable elements.
export function arrowNav(container, selector) {
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...container.querySelectorAll(selector)].filter((x) => x.offsetParent);
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  });
}

// "just now", "2 min ago", "3 h ago" for the index age in the top bar and rail
export function ago(t) {
  const m = Math.floor((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`;
}

// A path that drops its middle, never its file name. When fewer than about 6 characters of
// the folder part would survive, the folder part goes entirely rather than dangle as "e…".
const dirWatch = typeof ResizeObserver === 'function' ? new ResizeObserver((list) => {
  for (const { target: el } of list) {
    el.classList.remove('no-dir');
    const dir = el.firstChild;
    if (dir.scrollWidth > dir.clientWidth + 1 && dir.clientWidth < 6 * (parseFloat(getComputedStyle(dir).fontSize) || 12) * 0.6) el.classList.add('no-dir');
  }
}) : null;
export function midPath(p, tail = '') {
  const i = String(p).lastIndexOf('/');
  const el = h('span', { class: 'mid-path', title: p + tail }, h('span', { class: 'dir' }, i >= 0 ? p.slice(0, i + 1) : ''), h('bdi', { class: 'file' }, p.slice(i + 1) + tail));
  dirWatch?.observe(el);
  return el;
}
