// Sequence artifacts: actor boxes, dashed lifelines, numbered arrows, notes,
// activation bars between a call and its reply, and a step panel on the right
// with the current step's citations. Up/Down walk the steps, Enter or O opens the ref.

import {
  h, s, textWidth, clip, slug, download, copy, btn, menuButton,
  citeHost, mdInline, stateView, emptyView, summaryBlock, inlineSvg, svgToPng, cssVar, mermaidId, mermaidText,
  layerOf, statusOf, statusLine, markShapes, swatch, citesIn, citeCard, midPath, sourceName, refLabel, isExternal, regenButton,
  UI_FONT, MONO_FONT, STATUS_WORD,
} from './common.js';

const LABEL_FONT = `400 12.5px ${UI_FONT}`;
const CODE_FONT = `400 12px ${MONO_FONT}`;
const NOTE_FONT = `400 14px "Newsreader Variable", Newsreader, Georgia, serif`;
const ACTOR_FONT = `580 13px ${UI_FONT}`;
const KIND_FONT = `450 11.5px ${MONO_FONT}`;
// auto fit never goes below this, so 12px labels stay readable
const MIN_AUTO_K = 0.92;
const LINE = 16;
const NOTE_LINE = 20;
const plain = (t) => String(t ?? '').replace(/\[\^\d+\]/g, '').replace(/\[\[[^\]]*\]\]/g, '').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
const looksLikeCode = (t) => /^[\w.$<>]+\(.*\)$/.test(t) || /^[\w$]+(\.[\w$]+)+$/.test(t);

function wrap(text, max, font) {
  const words = plain(text).split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (cur && textWidth(next, font) > max) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length > 4) { lines.length = 4; lines[3] = clip(lines[3], Math.max(8, lines[3].length - 2)) + (lines[3].endsWith('…') ? '' : '…'); }
  return lines.length ? lines : [''];
}

export function render(container, artifact, ctx = {}) {
  container.classList.add('artifact-canvas');
  const root = h('div', { class: 'sa sa-seq' });
  container.append(root);
  const cleanup = [];
  const done = { destroy() { cleanup.forEach((f) => f()); root.remove(); } };
  const data = artifact.data;
  const ok = data && Array.isArray(data.actors) && Array.isArray(data.steps);
  if (artifact.status === 'invalid' || artifact.status === 'error' || (data && !ok)) {
    root.append(stateView(container, artifact, ctx, artifact.status === 'error' ? { message: artifact.error || 'The run ended with an error.' } : {}));
    return done;
  }
  if (!ok || !data.actors.length || !data.steps.length) { root.append(emptyView('No steps.', null, regenButton(container, artifact, ctx))); return done; }

  // actors, plus any step endpoint the model forgot to declare
  const actors = data.actors.map((a) => ({ ...a, id: String(a.id), label: String(a.label ?? a.id), kind: a.kind ? String(a.kind) : '' }));
  const aIdx = new Map(actors.map((a, i) => [a.id, i]));
  for (const st of data.steps) for (const k of ['from', 'to']) {
    const id = String(st[k]);
    if (!aIdx.has(id)) { aIdx.set(id, actors.length); actors.push({ id, label: id, kind: 'external', implied: true }); }
  }
  const steps = data.steps.map((st, i) => ({ ...st, n: i + 1, a: aIdx.get(String(st.from)), b: aIdx.get(String(st.to)), st: st.ref ? statusOf(st.ref, artifact) : null }));

  // a sync step from B back to A while A's call to B is open is that call's reply
  const stack = [];
  const bars = [];
  steps.forEach((st, i) => {
    if (st.a === st.b || st.async) return;
    let j = stack.length - 1;
    while (j >= 0 && !(stack[j].a === st.b && stack[j].b === st.a)) j--;
    if (j >= 0) { st.ret = true; bars.push({ actor: st.a, from: stack[j].i, to: i }); stack.length = j; return; }
    stack.push({ a: st.a, b: st.b, i });
  });

  // an actor takes the layer of the refs on steps it receives, else those it sends
  for (const [ai, a] of actors.entries()) {
    a.ext = a.implied || isExternal(a.kind);
    if (a.ext) continue;
    if (a.ref) { a.layer = layerOf(a.ref, ctx); continue; }
    const pick = (list) => {
      const count = new Map();
      for (const st of list) if (st.ref) { const L = layerOf(st.ref, ctx); count.set(L, (count.get(L) || 0) + 1); }
      return [...count].sort((x, y) => y[1] - x[1])[0]?.[0] || null;
    };
    a.layer = pick(steps.filter((st) => st.b === ai && !st.ret)) || pick(steps.filter((st) => st.a === ai));
  }

  // geometry
  const PADX = 28;
  const aw = actors.map((a) => Math.max(136, Math.min(220, Math.max(textWidth(clip(a.label, 26), ACTOR_FONT), a.kind ? textWidth(a.kind, KIND_FONT) : 0) + 28)));
  const gap = actors.slice(0, -1).map((_, i) => Math.max(160, (aw[i] + aw[i + 1]) / 2 + 24));
  const fontOf = (t) => (looksLikeCode(plain(t)) ? CODE_FONT : LABEL_FONT);
  for (const st of steps) {
    if (st.a === st.b) {
      if (st.a < actors.length - 1) gap[st.a] = Math.max(gap[st.a], Math.min(260, textWidth(plain(st.label), fontOf(st.label))) + 80);
      continue;
    }
    const lo = Math.min(st.a, st.b), hi = Math.max(st.a, st.b);
    const need = Math.min(320, textWidth(plain(st.label), fontOf(st.label)) + 64);
    let have = 0;
    for (let i = lo; i < hi; i++) have += gap[i];
    if (need > have) { const add = (need - have) / (hi - lo); for (let i = lo; i < hi; i++) gap[i] += add; }
  }
  const ax = [];
  let x = PADX + aw[0] / 2;
  actors.forEach((_, i) => { ax[i] = x; x += gap[i] ?? 0; });
  const W0 = ax[actors.length - 1] + aw[actors.length - 1] / 2 + PADX + (steps.some((st) => st.a === actors.length - 1 && st.b === st.a) ? 220 : 0);
  // row bands run the full width of the pane even when the diagram is narrower
  const W = Math.max(W0, (container.clientWidth || 0) - 304);
  const HEAD = 64;
  let y = HEAD + 22;
  const rows = steps.map((st) => {
    const self = st.a === st.b;
    const span = self ? 200 : Math.abs(ax[st.b] - ax[st.a]) - 40;
    const font = fontOf(st.label);
    const lines = wrap(st.label, Math.max(90, Math.min(300, span)), font);
    const top = y;
    const arrowY = top + lines.length * LINE + 4;
    let bottom = arrowY + (self ? 18 : 0);
    let note = null;
    if (st.note) {
      // a note stays inside the lane its arrow spans, so it does not run under the next actors
      const nl = wrap(st.note, self ? 260 : Math.max(160, Math.min(300, span - 36)), NOTE_FONT);
      const nw = Math.max(...nl.map((l) => textWidth(l, NOTE_FONT))) + 28;
      const nx = self ? ax[st.a] + 16 : (ax[st.a] + ax[st.b]) / 2 - nw / 2;
      note = { lines: nl, x: Math.max(6, Math.min(W - nw - 6, nx)), y: bottom + 12, w: nw, h: nl.length * NOTE_LINE + 16 };
      bottom = note.y + note.h;
    }
    y = Math.max(bottom + 18, top + 40);
    return { st, self, lines, font, top, arrowY, note, bottom };
  });
  const H = y + 12;

  // ---------- svg ----------
  const svg = s('svg', { class: 'sq-svg', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${data.title || artifact.title || 'Sequence'}: ${actors.length} participants, ${steps.length} steps` });
  const content = s('g', { class: 'sq-content' });
  svg.append(content);
  const gRows = s('g', { class: 'sq-rows' });
  const gLife = s('g', { class: 'sq-life' });
  const gBars = s('g', { class: 'sq-bars' });
  const gMsgs = s('g', { class: 'sq-msgs' });
  content.append(gRows, gLife, gBars, gMsgs);

  const actorBox = (i, yy) => {
    const a = actors[i];
    const w = aw[i];
    return s('g', { class: `sq-actor${a.ext ? ' ext' : ''}${a.layer ? ' has-layer' : ''}`, 'data-layer': a.layer || null, transform: `translate(${ax[i].toFixed(1)},${yy})` },
      s('rect', { x: -w / 2, y: 0, width: w, height: 46, rx: 4 }),
      a.kind ? s('text', { class: 'kind', x: -w / 2 + 12, y: 15, 'dominant-baseline': 'central' }, clip(a.kind, 24)) : null,
      s('text', { class: 'label', x: -w / 2 + 12, y: a.kind ? 32 : 23, 'dominant-baseline': 'central' }, clip(a.label, 26)),
      s('title', null, `${a.label}${a.kind ? ' (' + a.kind + ')' : ''}`));
  };
  actors.forEach((_, i) => {
    gLife.append(s('line', { class: 'sq-lifeline', x1: ax[i], x2: ax[i], y1: 54, y2: H - 4 }));
    gLife.append(actorBox(i, 8));
  });
  for (const b of bars) {
    const y1 = rows[b.from].arrowY, y2 = rows[b.to].arrowY;
    gBars.append(s('rect', { class: 'sq-bar', x: ax[b.actor] - 4, y: y1, width: 8, height: Math.max(8, y2 - y1) }));
  }

  const rowEls = [];
  const rowBgs = [];
  rows.forEach((r, ri) => {
    const { st } = r;
    const x1 = ax[st.a], x2 = ax[st.b];
    const dirn = Math.sign(x2 - x1) || 1;
    const L = st.ref ? layerOf(st.ref, ctx) : null;
    const bg = s('rect', { class: 'sq-row-bg', 'data-layer': L, x: 0, y: r.top - 10, width: W, height: r.bottom - r.top + 18 });
    gRows.append(bg);
    rowBgs.push(bg);
    const g = s('g', { class: `sq-msg${st.async ? ' async' : ''}${st.ret ? ' ret' : ''}${st.ref ? ' has-ref' : ''}`, tabindex: '-1', role: 'button', 'aria-label': `Step ${st.n}: ${actors[st.a].label} to ${actors[st.b].label}, ${plain(st.label)}${st.st ? ', ' + STATUS_WORD[st.st] : ''}${st.ref ? '. Opens source' : ''}` });
    const mono = r.font === CODE_FONT;
    const tx = r.self ? x1 + 38 : x1 + dirn * 14;
    const anchor = r.self || dirn > 0 ? 'start' : 'end';
    r.lines.forEach((l, li) => g.append(s('text', { class: `sq-label${mono ? ' code' : ''}`, x: tx, y: r.top + li * LINE + 7, 'text-anchor': anchor, 'dominant-baseline': 'central' }, l)));
    if (st.ref) {
      const last = r.lines[r.lines.length - 1];
      const lw = textWidth(last, r.font);
      const gx = anchor === 'start' ? tx + lw + 5 : tx + 5;
      const gy = r.top + (r.lines.length - 1) * LINE + 7;
      g.append(s('g', { class: `mk${st.st ? ' st-' + st.st : ''}`, transform: `translate(${gx.toFixed(1)},${(gy - 6).toFixed(1)}) scale(0.75)` }, markShapes(st.st)));
    }
    const ay = r.arrowY;
    let end, from;
    if (r.self) {
      const d = `M${x1 + 4},${ay} h22 v14 h-18`;
      g.append(s('path', { class: 'sq-line', d }));
      end = { x: x1 + 6, y: ay + 14 }; from = { x: x1 + 20, y: ay + 14 };
    } else {
      const sx = x1 + dirn * 9, ex = x2 - dirn * (st.ret ? 1 : 5);
      g.append(s('path', { class: 'sq-line', d: `M${sx},${ay} L${ex},${ay}` }));
      end = { x: ex, y: ay }; from = { x: ex - dirn * 10, y: ay };
    }
    const ang = Math.atan2(end.y - from.y, end.x - from.x);
    const AL = 6, AW = 3.4;
    const bx = end.x - Math.cos(ang) * AL, by = end.y - Math.sin(ang) * AL;
    const px = -Math.sin(ang) * AW, py = Math.cos(ang) * AW;
    g.append(st.async || st.ret
      ? s('path', { class: 'sq-head open', d: `M${bx + px},${by + py} L${end.x},${end.y} L${bx - px},${by - py}` })
      : s('path', { class: 'sq-head', d: `M${end.x},${end.y} L${bx + px},${by + py} L${bx - px},${by - py} Z` }));
    g.append(s('g', { class: 'sq-num', transform: `translate(${x1},${ay})` }, s('circle', { r: 8 }), s('text', { x: 0, y: 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, st.n)));
    if (r.note) {
      g.append(s('g', { class: 'sq-note', transform: `translate(${r.note.x.toFixed(1)},${r.note.y.toFixed(1)})` },
        s('rect', { width: r.note.w, height: r.note.h }),
        r.note.lines.map((l, li) => s('text', { x: 14, y: 8 + NOTE_LINE / 2 + li * NOTE_LINE, 'dominant-baseline': 'central' }, l))));
    }
    g.append(s('title', null, `${st.n}. ${plain(st.label)}${st.note ? '\n' + plain(st.note) : ''}${st.ref ? '\n' + st.ref : ''}`));
    g.addEventListener('click', () => { select(ri); if (st.ref) ctx.openRef?.(st.ref); });
    g.addEventListener('pointerenter', () => bg.classList.add('hover'));
    g.addEventListener('pointerleave', () => bg.classList.remove('hover'));
    gMsgs.append(g);
    rowEls.push(g);
  });

  // sticky actor row
  const headSvg = s('svg', { class: 'sq-head-svg', width: W, height: HEAD, viewBox: `0 0 ${W} ${HEAD}`, 'aria-hidden': 'true' });
  actors.forEach((_, i) => headSvg.append(actorBox(i, 8)));
  const sticky = h('div', { class: 'sq-sticky' }, headSvg);
  const scroller = h('div', { class: 'sq-scroll', tabindex: '0', 'aria-label': 'Sequence diagram. Up and Down step through, Enter opens the source.' }, sticky, h('div', { class: 'sq-body' }, svg));
  const edge = () => scroller.classList.toggle('more-right', scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 4);
  const onScroll = () => { sticky.classList.toggle('show', scroller.scrollTop > HEAD * k * 0.6); edge(); };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(edge) : null;
  ro?.observe(scroller);
  cleanup.push(() => ro?.disconnect());

  let k = 1;
  const setZoom = (nk) => {
    k = Math.max(0.4, Math.min(2.2, nk));
    for (const el of [svg, headSvg]) { el.setAttribute('width', (W * k).toFixed(0)); el.setAttribute('height', ((el === svg ? H : HEAD) * k).toFixed(0)); }
    sticky.style.height = (HEAD * k).toFixed(0) + 'px';
    sticky.style.marginBottom = (-HEAD * k).toFixed(0) + 'px';
    requestAnimationFrame(edge);
  };
  const fitWidth = () => setZoom(Math.min(1.2, (scroller.clientWidth - 8) / W0));
  // one finger scrolls the diagram natively; two pinch the zoom around their midpoint
  let pinch = null;
  const spread = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
  scroller.addEventListener('touchstart', (e) => { if (e.touches.length === 2) pinch = { d: spread(e.touches), k }; }, { passive: true });
  scroller.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const r = scroller.getBoundingClientRect();
    const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
    const before = k;
    setZoom(pinch.k * spread(e.touches) / pinch.d);
    const f = k / before;
    scroller.scrollLeft = (scroller.scrollLeft + mx) * f - mx;
    scroller.scrollTop = (scroller.scrollTop + my) * f - my;
  }, { passive: false });
  scroller.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch = null; }, { passive: true });

  // ---------- legend ----------
  const usedLayers = [];
  for (const a of actors) if (a.layer && !usedLayers.includes(a.layer)) usedLayers.push(a.layer);
  const srcName = (L) => {
    const st = steps.find((x) => x.ref && layerOf(x.ref, ctx) === L);
    return st ? sourceName(st.ref, ctx) : L;
  };
  const legendLine = (cls) => s('svg', { class: `sq-key ${cls}`, width: 28, height: 10, viewBox: '0 0 28 10', 'aria-hidden': 'true' },
    s('path', { class: 'l', d: 'M1 5H25' }), cls === 'call' ? s('path', { class: 'hd', d: 'M27 5L21 2V8Z' }) : s('path', { class: 'ho', d: 'M21 2L27 5L21 8' }));
  const legend = h('div', { class: 'sq-legend' },
    h('span', { class: 't-kicker' }, 'Messages'),
    h('span', { class: 'it' }, legendLine('call'), 'call'),
    steps.some((st) => st.async) ? h('span', { class: 'it' }, legendLine('async'), 'async') : null,
    bars.length ? h('span', { class: 'it' }, legendLine('ret'), 'return') : null,
    bars.length ? h('span', { class: 'it' }, h('span', { class: 'bar' }), 'handling') : null,
    usedLayers.length || actors.some((a) => a.ext) ? h('span', { class: 't-kicker gap' }, 'Layers') : null,
    usedLayers.map((L) => h('span', { class: 'it' }, swatch(L), srcName(L))),
    actors.some((a) => a.ext) ? h('span', { class: 'it' }, h('span', { class: 'swatch ext' }), 'external') : null);

  // ---------- step panel ----------
  let cur = -1;
  const curBox = h('div', { class: 'sq-cur', 'aria-live': 'polite' });
  citeHost(curBox, artifact, ctx);
  const cited = steps.filter((st) => st.ref).length;
  const listItems = [];
  const list = h('ol', { class: 'sq-list' }, steps.map((st, ri) => {
    const L = st.ref ? layerOf(st.ref, ctx) : null;
    const li = h('li', { 'data-layer': L },
      h('button', { type: 'button', onclick: () => { select(ri, true); } },
        h('span', { class: 'n' }, String(st.n).padStart(2, '0')),
        st.ref ? [swatch(L, true), h('bdi', { class: 'p' }, refLabel(st.ref))] : h('span', { class: 'u' }, clip(plain(st.label), 28), h('span', { class: 'x' }, ' · uncited')),
        st.ref ? h('span', { class: `g${st.st ? ' st-' + st.st : ''}` }, s('svg', { class: 'sa-glyph', viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': 'true' }, markShapes(st.st))) : null));
    listItems.push(li);
    return li;
  }));
  const stepsBox = h('div', { class: 'sq-steps' },
    h('div', { class: 'sq-side-head' }, h('span', { class: 't-kicker' }, 'Steps'), h('span', { class: 'cnt' }, `${cited} cited · ${steps.length - cited} uncited`)),
    list);
  const side = h('aside', { class: 'sq-side', 'aria-label': 'Steps' }, curBox, stepsBox);

  function drawCur() {
    const st = steps[cur];
    const cites = citesIn(artifact, st.label, st.note);
    curBox.replaceChildren(...[
      h('div', { class: 'sq-side-head' },
        h('span', { class: 't-kicker' }, `Step ${st.n} of ${steps.length}`),
        h('div', { class: 'sa-spacer' }),
        h('button', { type: 'button', class: 'kb', 'aria-label': 'Previous step', onclick: () => step(-1) }, h('kbd', null, '↑')),
        h('button', { type: 'button', class: 'kb', 'aria-label': 'Next step', onclick: () => step(1) }, h('kbd', null, '↓'))),
      h('div', { class: `sq-cur-label${looksLikeCode(plain(st.label)) ? ' code' : ''}` }, mdInline(st.label, artifact)),
      h('div', { class: 'sq-cur-who' }, h('bdi', null, actors[st.a].label), st.async ? ' ⇢ ' : ' → ', h('bdi', null, actors[st.b].label), st.async ? ' · async' : st.ret ? ' · reply' : ''),
      st.note ? h('div', { class: 'sq-cur-note' }, mdInline(st.note, artifact)) : null,
      cites.length ? h('div', { class: 'sq-cites' }, cites.map((c) => citeCard(c, ctx))) : null,
      st.ref ? h('div', { class: 'sq-cur-ref', 'data-layer': layerOf(st.ref, ctx) },
        h('div', { class: 'top' }, refNum(st.ref, st.st), statusLine(st.st)),
        h('div', { class: 'path' }, swatch(layerOf(st.ref, ctx), true), midPath(st.ref.replace(/#L/, ':').replace(/-L?(\d+)$/, '-$1'))),
        h('div', { class: 'sa-row' }, btn('Open at line', () => ctx.openRef?.(st.ref), { kbd: 'O' }), h('div', { class: 'sa-spacer' }), btn('Copy ref', () => copy(st.ref, ctx, 'Ref copied'), { cls: 'quiet' }))) : null,
      !st.ref && !cites.length ? h('p', { class: 'sa-muted' }, 'This step has no source.') : null].filter(Boolean));
  }

  function select(ri, reveal = false) {
    cur = ri;
    rowBgs.forEach((b, i) => b.classList.toggle('sel', i === ri));
    rowEls.forEach((g, i) => g.classList.toggle('sel', i === ri));
    listItems.forEach((li, i) => li.classList.toggle('sel', i === ri));
    drawCur();
    if (reveal) {
      // instant scroll: keyboard actions never animate
      const r = rows[ri];
      const top = r.top * k, bottom = r.bottom * k;
      if (top - HEAD * k < scroller.scrollTop || bottom > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = Math.max(0, top - scroller.clientHeight / 3);
      listItems[ri]?.scrollIntoView({ block: 'nearest' });
    }
  }
  const step = (d) => select(Math.max(0, Math.min(steps.length - 1, cur + d)), true);
  root.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'J') step(1);
    else if (e.key === 'ArrowUp' || e.key === 'k' || e.key === 'K') step(-1);
    else if ((e.key === 'Enter' || e.key === 'o' || e.key === 'O') && cur >= 0 && steps[cur].ref && !e.target.closest('button')) ctx.openRef?.(steps[cur].ref);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  const exportSource = () => inlineSvg(content, { box: { x: 0, y: 0, w: W0, h: H }, background: cssVar(container, '--paper', '#ffffff') });
  const toolbar = h('div', { class: 'sa-toolbar' },
    h('div', { class: 'sa-meta' }, `${actors.length} actors · ${steps.length} steps · ${cited} cited`),
    h('div', { class: 'sa-spacer' }),
    h('div', { class: 'sa-group' },
      h('button', { type: 'button', class: 'icon-btn sa-icon', 'aria-label': 'Zoom out', title: 'Zoom out', onclick: () => setZoom(k / 1.2) }, h('span', { 'aria-hidden': 'true' }, '−')),
      h('button', { type: 'button', class: 'icon-btn sa-icon', 'aria-label': 'Zoom in', title: 'Zoom in', onclick: () => setZoom(k * 1.2) }, h('span', { 'aria-hidden': 'true' }, '+')),
      btn('Fit width', fitWidth, { cls: 'quiet' })),
    menuButton('Export', [
      { label: 'SVG image', hint: '.svg', run: () => download(exportSource(), slug(artifact.title || data.title) + '.svg', 'image/svg+xml') },
      { label: 'PNG image', hint: '.png, 2x', run: async () => { try { download(await svgToPng(exportSource(), W0, H, 2), slug(artifact.title || data.title) + '.png', 'image/png'); } catch (e) { ctx.toast?.(e.message); } } },
      { label: 'Mermaid', hint: 'copy', run: () => copy(mermaid(), ctx, 'Mermaid copied') },
      { label: 'Mermaid file', hint: '.mmd', run: () => download(mermaid(), slug(artifact.title || data.title) + '.mmd') },
    ]));
  root.append(toolbar, h('div', { class: 'sq-layout' }, h('div', { class: 'sq-main' }, scroller, legend), side));
  const sum = summaryBlock(artifact);
  if (sum) { citeHost(sum, artifact, ctx); root.append(sum); }
  setZoom(1);
  select(Math.max(0, steps.findIndex((st) => st.ref)));
  // shrink to fit only while labels stay readable; past that the scroller pans sideways
  requestAnimationFrame(() => {
    const z = (scroller.clientWidth - 8) / W0;
    if (scroller.clientWidth && W0 > scroller.clientWidth && z >= MIN_AUTO_K) setZoom(z);
  });

  // every step card carries a number chip, like the citation cards above it
  function refNum(ref, status) {
    const p = String(ref).split('#')[0];
    const c = (artifact.citations || []).find((x) => x.path === p);
    return h('button', { type: 'button', class: `n st-${status || 'pending'}`, 'aria-label': c ? `Open citation ${c.n}` : 'Open the cited line', onclick: () => (c ? ctx.openCitation?.(Number(c.n)) : ctx.openRef?.(ref)) }, c ? c.n : '·');
  }

  function mermaid() {
    const used = new Map();
    const out = ['sequenceDiagram'];
    if (data.title) out.push(`  title ${mermaidText(plain(data.title))}`);
    for (const a of actors) {
      const word = /^(user|actor|person|human)$/i.test(a.kind || '') ? 'actor' : 'participant';
      out.push(`  ${word} ${mermaidId(a.id, used)} as ${mermaidText(a.label).replace(/[;#]/g, ' ')}`);
    }
    for (const st of steps) {
      const a = mermaidId(actors[st.a].id, used), b = mermaidId(actors[st.b].id, used);
      const text = plain(st.label).replace(/[;#]/g, ',');
      out.push(`  ${a}${st.async ? '-)' : st.ret ? '-->>' : '->>'}${b}: ${text}`);
      if (st.note) out.push(st.a === st.b ? `  Note right of ${a}: ${plain(st.note).replace(/[;#]/g, ',')}` : `  Note over ${a},${b}: ${plain(st.note).replace(/[;#]/g, ',')}`);
    }
    return out.join('\n') + '\n';
  }

  return done;
}
