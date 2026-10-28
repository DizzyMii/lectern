// Citations on the page (DESIGN 11.5 to 11.9): claim spans, gutter marks, margin cards,
// the receipt, the hover card and the J/K claim cursor.

import { h, clear, icon, copyText } from './dom.js';
import { highlightLines } from './markdown.js';
import { getFile, openFile, isDoc } from './viewer.js';
import { ctx } from './state.js';
import { sourceFor, layerAttrs, swatch, glyph, statusOf, STATUS_WORD, shortPath, midPath, kbd } from './layers.js';
import { RANK, changedCite, compare, series, shown, dayWord } from './status.js';

const BLOCKS = 'p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, dd, dt';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce';

export function citeFor(chip) {
  const host = chip?.closest?.('.has-cites');
  return host?.cites?.get(String(chip.dataset.n)) || null;
}

const range = (c) => (c?.line ? `${c.line}${c.endLine && c.endLine !== c.line ? '-' + c.endLine : ''}` : '');
const refOf = (c) => `${c.path}${c.line ? ':' + range(c) : ''}`;
// the drawer also gets the answer's other citations, for [ and ]
const listFor = (c) => { const t = [...document.querySelectorAll('.has-cites')].find((x) => x.cites?.get(String(c.n)) === c); return t ? [...t.cites.values()].sort((a, b) => a.n - b.n) : null; };
const openAt = (c) => c && openFile(c.path, { line: c.line, endLine: c.endLine, quote: c.quote, cite: c, list: listFor(c) });

// chip, or a number from a renderer (common.js passes the citation number)
export function openCitation(arg) {
  let chip = arg;
  if (typeof arg === 'number' || typeof arg === 'string') chip = document.querySelector(`#canvas .chip[data-n="${arg}"]`) || document.querySelector(`.answer .chip[data-n="${arg}"]`);
  const c = chip?.nodeType ? citeFor(chip) : null;
  if (!c) return;
  hideCard(true);
  openAt(c);
}

// ---------- claims ----------

const TERM = /[.!?]["')\]”]*\s+/g;

function textNodesBetween(block, from, to) {
  const out = [];
  const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest('.chip, .code-head') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n; (n = w.nextNode());) {
    if (from && !(from.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    if (from && from.contains(n)) continue;
    if (!(to.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING)) break;
    out.push(n);
  }
  return out;
}

// The clause a chip covers: from the last sentence break (or the previous chip) to the chip.
function claimRange(block, prevChip, chip) {
  const nodes = textNodesBetween(block, prevChip, chip);
  let text = '';
  const at = [];
  for (const n of nodes) { at.push(text.length); text += n.data; }
  const inCode = (pos) => {
    for (let i = nodes.length - 1; i >= 0; i--) if (at[i] <= pos) return !!nodes[i].parentElement.closest('code');
    return false;
  };
  const ends = [];
  for (const m of text.matchAll(TERM)) if (!inCode(m.index)) ends.push(m.index + m[0].length);
  let end = text.replace(/[\s:;,]+$/, '').length;
  let start = 0;
  for (let i = ends.length - 1; i >= 0; i--) {
    if (ends[i] < end) { start = ends[i]; break; }
  }
  // the chip follows a finished sentence ("... thread. [1]"): cover that sentence
  if (!text.slice(start, end).trim() && ends.length) {
    end = text.slice(0, start).replace(/\s+$/, '').length;
    start = 0;
    for (let i = ends.length - 1; i >= 0; i--) if (ends[i] < end) { start = ends[i]; break; }
  }
  while (start < end && /[\s,;:.)\]]/.test(text[start])) start++;
  if (start >= end) return [];
  const parts = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = at[i], b = at[i] + nodes[i].data.length;
    const s = Math.max(a, start), e = Math.min(b, end);
    if (e > s) parts.push([nodes[i], s - a, e - a]);
  }
  return parts;
}

function wrap(parts, claim) {
  for (const [node, s, e] of parts) {
    let n = node;
    if (e < n.data.length) n.splitText(e);
    if (s > 0) n = n.splitText(s);
    const span = h('span', { class: `claim st-${claim.status}`, dataset: { claim: claim.id }, ...layerAttrs(claim.src) });
    n.replaceWith(span);
    span.append(n);
    claim.spans.push(span);
  }
  // an inline element the claim covers whole goes inside the band, padding and all
  for (let i = 0; i < claim.spans.length; i++) {
    let sp = claim.spans[i];
    let p = sp.parentElement;
    while (p && /^(CODE|STRONG|EM|B|I|A|BDI|SPAN)$/.test(p.tagName) && !p.classList.contains('claim') && !p.classList.contains('chip-wrap') && p.textContent === sp.textContent) {
      sp.replaceWith(...sp.childNodes);
      const outer = sp.cloneNode(false);
      p.replaceWith(outer);
      outer.append(p);
      sp = outer;
      p = sp.parentElement;
    }
    claim.spans[i] = sp;
  }
}

let claimSeq = 0;

function buildClaims(answer) {
  for (const s of answer.querySelectorAll('.imark')) s.remove();
  for (const s of answer.querySelectorAll('span.claim, span.glue')) s.replaceWith(...s.childNodes);
  answer.normalize();
  const claims = [];
  let prev = null, prevBlock = null, last = null;
  for (const chip of answer.querySelectorAll('.chip')) {
    const block = chip.closest(BLOCKS) || answer;
    const c = citeFor(chip);
    if (block !== prevBlock) { prev = null; prevBlock = block; }
    // chips side by side share one claim
    const gap = prev ? textNodesBetween(block, prev, chip).map((n) => n.data).join('') : null;
    if (last && prev && gap != null && /^[\s.,;:)\]]*$/.test(gap)) {
      last.chips.push(chip);
      if (c) last.cites.push(c);
    } else {
      last = { id: 'c' + (++claimSeq), chips: [chip], cites: c ? [c] : [], spans: [], block, prevChip: prev };
      claims.push(last);
    }
    prev = chip;
  }
  for (const cl of claims) {
    cl.status = cl.cites.map(statusOf).sort((a, b) => RANK[b] - RANK[a])[0] || 'unverified';
    cl.src = sourceFor(cl.cites[0]?.path);
    cl.n = Number(cl.chips[0].dataset.n);
    wrap(claimRange(cl.block, cl.prevChip, cl.chips[0]), cl);
    if (!cl.spans.length) cl.anchor = cl.chips[0];
    else glue(cl);
  }
  return claims;
}

// Keep the chip on the same line as the last word of its claim (DESIGN 11.5).
function glue(cl) {
  const end = cl.chips.at(-1).closest('.chip-wrap') || cl.chips.at(-1);
  const w = document.createTreeWalker(cl.block, NodeFilter.SHOW_TEXT);
  w.currentNode = cl.chips[0];
  let t;
  while ((t = w.previousNode()) && (!/\S/.test(t.data) || t.parentElement.closest('.chip'))) { /* skip */ }
  if (!t || !t.parentElement.closest('.claim')) return;
  const r = document.createRange();
  const code = t.parentElement.closest('code');
  if (code) {
    if (code.textContent.length > 40) return;
    let el = code;
    while (el.parentElement?.classList.contains('claim') && el.parentElement.textContent === el.textContent) el = el.parentElement;
    r.setStartBefore(el);
  } else {
    const at = t.data.search(/\S+\s*$/);
    r.setStart(t, Math.max(0, at));
  }
  r.setEndAfter(end);
  const span = h('span', { class: 'glue' });
  span.append(r.extractContents());
  r.insertNode(span);
  const all = [...cl.block.querySelectorAll(`.claim[data-claim="${cl.id}"]`)];
  cl.spans = all.filter((s) => s.textContent);
  for (const s of all) if (!s.textContent) s.remove();
}

// Sentences in prose blocks that carry no citation (DESIGN 11.9 "uncited").
function uncitedCount(answer, claims) {
  let total = 0;
  for (const b of answer.querySelectorAll('p, li')) {
    if (b.querySelector('p')) continue;
    const t = [...b.childNodes].map((n) => (n.nodeType === 3 ? n.data : n.classList?.contains('chip') ? '' : n.textContent)).join('');
    total += t.split(TERM).filter((s) => s.replace(/[\s\d.,;:()[\]]/g, '').length > 3).length;
  }
  return Math.max(0, total - claims.length);
}

export function counts(turn, answer, claims) {
  const out = { verified: 0, moved: 0, unverified: 0, pending: 0, uncited: 0, total: 0 };
  for (const c of turn.citations || []) { out[statusOf(c)]++; out.total++; }
  if (answer && claims) out.uncited = uncitedCount(answer, claims);
  return out;
}

// ---------- receipt ----------

const fmtTime = (d) => (d && !isNaN(d) ? d.toTimeString().slice(0, 5) : '');

export function receipt(turn, k, { checking = false } = {}) {
  const col = (n, st, word) => h('div', { class: `rc-col st-${st}${n ? '' : ' zero'}${checking ? ' checking' : ''}`, role: 'button', tabindex: 0, 'aria-label': `${n} ${word}`, dataset: { st } },
    h('span', { class: 'rc-num t-numeral-xl' }, checking ? '‒' : String(n), st !== 'uncited' && !checking ? glyph(st, 'glyph sm') : null),
    h('span', { class: 'rc-word' }, word));
  const t = turn.citeCheck?.checkedAt ? new Date(turn.citeCheck.checkedAt) : turn.startedAt ? new Date(new Date(turn.startedAt).getTime() + (turn.seconds || 0) * 1000) : null;
  const d = !checking && k.total ? compare(turn.citations, { at0: turn.citeCheck?.checkedAt0 }) : null;
  let caption;
  if (checking) caption = k.total ? `Checking ${k.total} citation${k.total === 1 ? '' : 's'}...` : 'Checking citations...';
  else if (!k.total) caption = 'This answer has no citations. Treat it as a sketch.';
  else if (k.unverified) caption = `${k.unverified} quote${k.unverified === 1 ? ' was' : 's were'} not found. ${k.unverified === 1 ? 'It is' : 'They are'} marked in red.`;
  else caption = 'Every quote here was found again in its file, or where it moved to. Sentences with no mark are uncited.';
  const el = h('section', { class: `receipt neatline${!checking && k.total && k.verified === k.total && k.total > 1 ? ' all-ok' : ''}${!checking && !k.total ? ' none' : ''}`,
    'aria-label': `${k.verified} verified, ${k.moved} moved, ${k.unverified} unverified, ${k.uncited} uncited` },
  h('div', { class: 'double-rule' }),
  h('div', { class: 'rc-head' }, h('span', { class: 't-kicker' }, 'Checked'), fmtTime(t) && !checking ? h('span', { class: 't-mono-sm' }, 're-read ' + fmtTime(t)) : null),
  h('div', { class: `rc-cols${Math.max(k.verified, k.moved, k.unverified, k.uncited) >= 100 ? ' wide' : ''}` }, col(k.verified, 'verified', 'verified'), col(k.moved, 'moved', 'moved'), col(k.unverified, 'unverified', 'unverified'), col(k.uncited, 'uncited', 'uncited')),
  d ? h('p', { class: 'rc-drift t-mono-sm' }, d.then, h('span', { class: 'rc-now' }, d.now)) : null,
  h('p', { class: `rc-caption${!checking && !k.total ? ' warn' : ''}` }, caption));
  return el;
}

export function miniReceipt(k) {
  if (!k) return [];
  const item = (st, n) => h('span', { class: `mr st-${st}${n ? '' : ' zero'}` }, glyph(st, 'glyph sm'), String(n));
  return [h('span', { class: 'mini-receipt', role: 'img', 'aria-label': `${k.verified} verified, ${k.moved} moved, ${k.unverified} unverified, ${k.uncited} uncited` },
    item('verified', k.verified), item('moved', k.moved), item('unverified', k.unverified), h('span', { class: 'mr-unc' }, `· ${k.uncited} uncited`))];
}

// reopened sheet: chips whose citation changed since it was printed stamp in again
export function stampChanged(host) {
  if (reduced()) return;
  for (const chip of host.querySelectorAll('.chip:not(.static)[data-n]')) if (changedCite(host.cites?.get(chip.dataset.n))) chip.classList.add('stamp');
}

// numerals count up once over 300ms when the last check lands
function countUp(el) {
  if (reduced()) return;
  for (const num of el.querySelectorAll('.rc-num')) {
    const txt = num.firstChild;
    const to = Number(txt.data);
    if (!to) continue;
    const t0 = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / 300);
      txt.data = String(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
    };
    txt.data = '0';
    requestAnimationFrame(step);
  }
}

// ---------- margin cards ----------

function cardFor(c, claim) {
  const st = statusOf(c);
  const src = sourceFor(c.path);
  const body = h('div', { class: 'mc-body' });
  if (c.quote) body.append(h('blockquote', { class: 'mc-quote' }, '“', c.quote.replace(/`/g, ''), '”'));
  const card = h('article', { class: `mcard st-${st}`, tabindex: -1, dataset: { n: c.n, claim: claim?.id || '' }, ...layerAttrs(src) },
    h('div', { class: 'mc-row' }, h('span', { class: `chip ${c.status} static`, 'aria-hidden': 'true', ...layerAttrs(src) }, c.n), glyph(st), h('span', { class: 'mc-st t-kicker' }, STATUS_WORD[st])),
    body,
    h('div', { class: 'mc-path', title: c.path }, midPath(shortPath(c.path, 2), c.line ? ':' + c.line : '')));
  if (st === 'moved' && c.citedLine) card.append(h('div', { class: 'mc-moved' }, `Cited L${c.citedLine}, found at L${c.line}. Same text.`));
  if (c.status === 'missing') card.append(h('div', { class: 'mc-bad' }, 'File no longer exists at this path.'));
  else if (st === 'unverified') card.append(h('div', { class: 'mc-bad' }, `Quote not found in ${shortPath(c.path, 1)}.`));
  card.addEventListener('click', () => { if (claim) setCursor(claim); const chip = claim?.chips.find((x) => x.dataset.n === String(c.n)) || claim?.chips[0]; if (chip) showCard(chip, { pinned: true }); });
  card.addEventListener('pointerenter', () => claim?.spans.forEach((s) => s.classList.add('hot')));
  card.addEventListener('pointerleave', () => claim?.spans.forEach((s) => s.classList.remove('hot')));
  return { card, body, c, st };
}

// code citations (and doc citations without a quote) show the cited line itself
async function fillLine(item, relayout) {
  const { c, body } = item;
  if (c.quote || !c.line || c.status === 'missing') return;
  try {
    const f = await getFile(c.path);
    const lines = f.text.split('\n').slice(c.line - 1, Math.min(c.endLine || c.line, c.line + 1));
    if (!lines.length) return;
    if (isDoc(c.path)) body.append(h('blockquote', { class: 'mc-quote' }, '“', lines.join(' ').replace(/[#*`>_]/g, '').trim(), '”'));
    else body.append(h('pre', { class: 'mc-code', html: highlightLines(lines.map((l) => l.trim()).join('\n'), f.lang || c.path.split('.').pop()).join('\n') }));
    relayout();
  } catch {}
}

// ---------- decorate a finished (or streaming) turn ----------

// the label on a moved mark; on a replay it rolls from the line it was cited at to the line it is at now
const movedLabel = (c, roll) => (roll && c.line0 != null && c.line0 !== c.line
  ? h('span', { class: 'gm-line roll' }, h('span', { class: 'gm-roll' }, h('span', null, 'L' + c.line0), h('span', null, 'L' + c.line)))
  : h('span', { class: 'gm-line' }, 'L' + c.line));

// turnEl holds .gutter, .answer and .margin .cards. Returns the counts for the receipt.
export function decorate(turnEl, turn, { live = false, replay = false } = {}) {
  const answer = turnEl.querySelector('.answer');
  const claims = buildClaims(answer);
  turnEl._claims = claims;
  turnEl._turn = turn;
  for (const cl of claims) cl.turnEl = turnEl;
  const k = counts(turn, answer, claims);

  const gutter = clear(turnEl.querySelector('.gutter'));
  for (const cl of claims) {
    const stamp = !reduced() && (live || (replay && cl.cites.some(changedCite)));
    const mark = h('span', { class: `gmark st-${cl.status}${stamp ? ' stamp' : ''}`, 'aria-hidden': 'true', dataset: { claim: cl.id } }, glyph(cl.status));
    const mv = cl.cites.find((c) => statusOf(c) === 'moved');
    if (mv) mark.append(movedLabel(mv, replay && !reduced() && changedCite(mv)));
    cl.mark = mark;
    gutter.append(mark);
    // narrow pages drop the gutter, so the mark also sits inline before the claim
    const first = cl.spans[0] || cl.anchor;
    first?.before(h('span', { class: `imark st-${cl.status}`, 'aria-hidden': 'true' }, glyph(cl.status)));
  }

  const cardsEl = turnEl.querySelector('.cards');
  if (cardsEl) {
    clear(cardsEl);
    const seen = new Set();
    const items = [];
    for (const cl of claims) for (const c of cl.cites) {
      if (seen.has(c.n)) continue;
      seen.add(c.n);
      const it = cardFor(c, cl);
      it.claim = cl;
      cl.cards = cl.cards || [];
      cl.cards.push(it.card);
      items.push(it);
    }
    for (const c of turn.citations || []) if (!seen.has(c.n)) { seen.add(c.n); items.push(cardFor(c, null)); }
    turnEl._cards = items;
    for (const it of items) cardsEl.append(it.card);
    const relayout = () => scheduleLayout(turnEl);
    for (const it of items) fillLine(it, relayout);
  }
  const rc = turnEl.querySelector('.receipt-slot');
  if (rc) {
    const el = receipt(turn, k);
    rc.replaceChildren(el);
    if (live) { countUp(el); if (el.classList.contains('all-ok') && !reduced()) el.classList.add('draw'); }
  }
  watch(turnEl);
  scheduleLayout(turnEl);
  turnEl._counts = k;
  return k;
}

const pending = new Set();
let raf = 0;
export function scheduleLayout(turnEl) {
  pending.add(turnEl);
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; for (const t of pending) layout(t); pending.clear(); });
}

const ro = new ResizeObserver((entries) => {
  clearTimeout(ro.t);
  ro.t = setTimeout(() => { for (const e of entries) { const t = e.target.closest('.turn'); if (t) scheduleLayout(t); } }, 50);
});
function watch(turnEl) {
  if (turnEl._watched) return;
  turnEl._watched = true;
  ro.observe(turnEl.querySelector('.answer'));
}

// Gutter marks sit on the claim's first line; margin cards line up with their claims and push down.
function layout(turnEl) {
  if (!turnEl.isConnected) return;
  const base = turnEl.getBoundingClientRect().top;
  // two claims on one line: marks sit side by side, 2px apart, inside the 40px gutter
  const lines = new Map();
  for (const cl of turnEl._claims || []) {
    const el = cl.spans[0] || cl.anchor;
    const r = el?.getClientRects()[0];
    if (!r || !cl.mark) continue;
    cl.top = r.top - base;
    cl.markTop = Math.round(r.top + r.height / 2 - 8 - base);
    if (!lines.has(cl.markTop)) lines.set(cl.markTop, []);
    lines.get(cl.markTop).push(cl);
  }
  for (const [top, row] of lines) row.forEach((cl, i) => {
    cl.mark.style.top = top + 'px';
    // a moved label sits right of the glyph, so that mark starts further left and runs into the page margin rather than the text
    const wide = cl.mark.querySelector('.gm-line') ? cl.mark.offsetWidth : 16;
    cl.mark.style.left = (row.length > 1 ? 4 + i * 18 : Math.min(12, 38 - wide)) + 'px';
  });
  const cardsEl = turnEl.querySelector('.cards');
  if (!cardsEl || !cardsEl.offsetParent) return;
  const off = cardsEl.getBoundingClientRect().top - base;
  let bottom = 0;
  for (const it of turnEl._cards || []) {
    const want = it.claim?.top != null ? Math.round(it.claim.top - off - 6) : bottom;
    const top = Math.max(want, bottom ? bottom + 12 : 0, 0);
    it.card.style.top = top + 'px';
    it.card.querySelector('.leader')?.remove();
    if (it.claim && top - want > 8) {
      it.card.append(h('span', { class: 'leader', 'aria-hidden': 'true', style: { height: `${top - want}px`, top: `${want - top + 10}px` } }));
    }
    bottom = top + it.card.offsetHeight;
  }
  cardsEl.style.height = bottom + 'px';
}

// ---------- hover card ----------

let card = null, cardChip = null, pinned = false, showT = 0, hideT = 0;

function hideCard(force) {
  clearTimeout(showT);
  clearTimeout(hideT);
  if (pinned && !force) return;
  const go = () => {
    cardChip?.classList.remove('active');
    cardChip?.removeAttribute('aria-describedby');
    claimOf(cardChip)?.spans.forEach((s) => s.classList.remove('hot'));
    card?.remove();
    card = cardChip = null;
    pinned = false;
  };
  if (force) go(); else hideT = setTimeout(go, 160);
}

function claimOf(chip) {
  if (!chip) return null;
  const t = chip.closest('.turn');
  return t?._claims?.find((cl) => cl.chips.includes(chip)) || null;
}

function totalIn(chip) {
  const host = chip.closest('.has-cites');
  return host?.cites?.size || 0;
}

export function showCard(chip, { pinned: pin = false } = {}) {
  const c = citeFor(chip);
  if (!c) return;
  if (cardChip === chip && card) { if (pin) { pinned = true; chip.classList.add('active'); card.classList.add('pinned'); } return; }
  hideCard(true);
  const st = statusOf(c);
  const src = sourceFor(c.path);
  const excerpt = h('div', { class: 'hc-ex' });
  const acts = h('div', { class: 'hc-acts' },
    h('button', { class: 'btn quiet', onclick: () => { hideCard(true); openAt(c); } }, 'Open at line', kbd('O')),
    h('button', { class: 'btn quiet', onclick: () => copyText(refOf(c), `Copied ${refOf(c)}`) }, 'Copy ref'),
    claimOf(chip) ? h('button', { class: 'btn quiet', onclick: () => { hideCard(true); challenge(claimOf(chip)); } }, 'Challenge', kbd('X')) : null);
  card = h('div', { class: `hovercard st-${st}${pin ? ' pinned' : ''}`, role: 'dialog', 'aria-label': `Citation ${c.n}`, id: 'cite-card', ...layerAttrs(src) },
    h('div', { class: 'hc-head' }, glyph(st), h('span', { class: 'hc-st t-kicker' }, STATUS_WORD[st]), h('span', { class: 'grow' }),
      pin ? h('span', { class: 'hc-pin', title: 'Pinned. Esc closes.' }, icon('bookmark', 12)) : null,
      h('span', { class: `chip ${c.status} static`, ...layerAttrs(src) }, c.n), h('span', { class: 't-mono-sm' }, `of ${totalIn(chip)}`)),
    excerpt,
    h('div', { class: 'hc-loc' }, swatch(src, true), h('span', { class: 'hc-path' }, midPath(shortPath(c.path, 4))), c.line ? h('span', { class: 'hc-line' }, ':' + range(c)) : null),
    st === 'moved' && c.citedLine ? h('div', { class: 'hc-note moved' }, `Cited L${c.citedLine}, found at L${c.line}. Same text.`) : null,
    c.status === 'missing' ? h('div', { class: 'hc-note bad' }, 'File no longer exists at this path.') : null,
    c.status === 'unverified' ? h('div', { class: 'hc-note bad' }, `Quote not found in ${shortPath(c.path, 1)}.`,
      c.quote ? h('button', { class: 'btn quiet', onclick: () => { hideCard(true); ctx.openSearch(c.quote.slice(0, 60)); } }, 'Search all sources') : null) : null,
    acts);
  if (c.quote) excerpt.append(h('blockquote', { class: 'hc-quote' }, '“', c.quote.replace(/`/g, ''), '”'));
  const hist = historyRow(c);
  if (hist) acts.before(hist);
  card.addEventListener('pointerenter', () => clearTimeout(hideT));
  card.addEventListener('pointerleave', () => hideCard());
  cardChip = chip;
  pinned = pin;
  chip.setAttribute('aria-describedby', 'cite-card');
  if (pin) chip.classList.add('active');
  claimOf(chip)?.spans.forEach((s) => s.classList.add('hot'));
  document.body.append(card);
  place(card, chip);
  if (c.line && c.status !== 'missing' && !(c.quote && isDoc(c.path))) {
    // reserve the space, fill in place when the file arrives (prefetched by the margin cards)
    getFile(c.path).then((f) => {
      if (cardChip !== chip || !card) return;
      const a = Math.max(1, c.line - 2);
      const b = Math.min(a + 6, (c.endLine || c.line) + 2);
      const lines = highlightLines(f.text.split('\n').slice(a - 1, b).join('\n'), f.lang || c.path.split('.').pop());
      excerpt.append(h('div', { class: 'hc-code' }, lines.map((html, i) => {
        const n = a + i;
        const hit = n >= c.line && n <= (c.endLine || c.line);
        return h('div', { class: `row${hit ? ' hit' : ''}` }, h('span', { class: 'n' }, n), h('span', { class: 'c', html: html || ' ' }));
      })));
      place(card, chip);
    }).catch(() => {});
  }
}

// dated glyphs, as written first, for a citation that has changed since
function historyRow(c) {
  const s = series(c);
  if (!s.length) return null;
  const word = (e) => `${dayWord(e.at)} ${STATUS_WORD[shown(e.status)]}${e.line ? ' L' + e.line : ''}`.trim();
  return h('div', { class: 'hc-hist', role: 'img', 'aria-label': 'History: ' + s.map(word).join(', ') },
    h('span', { class: 't-kicker' }, 'History'),
    s.map((e) => h('span', { class: `hd st-${shown(e.status)}`, title: word(e) }, glyph(shown(e.status), 'glyph sm'), h('span', { class: 't-mono-sm' }, dayWord(e.at)))));
}

// below the chip, flipped above when there is no room
function place(el, chip) {
  const r = chip.getBoundingClientRect();
  const w = el.offsetWidth, ht = el.offsetHeight;
  const left = Math.min(Math.max(16, r.left - 24), window.innerWidth - w - 16);
  let top = r.bottom + 8;
  if (top + ht > window.innerHeight - 36) top = Math.max(56, r.top - ht - 8);
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}

export const cardOpen = () => !!card;

// ---------- claim cursor ----------

let cursor = null;

function allClaims() {
  return [...document.querySelectorAll('#chat .turn')].flatMap((t) => t._claims || []);
}

export function activeTurn() {
  return cursor?.turnEl?.isConnected ? cursor.turnEl : [...document.querySelectorAll('#chat .turn')].at(-1) || null;
}

export function clearCursor() {
  if (!cursor) return false;
  cursor.spans.forEach((s) => s.classList.remove('cur'));
  cursor.mark?.classList.remove('cur');
  cursor.cards?.forEach((c) => c.classList.remove('cur'));
  cursor = null;
  return true;
}

export function setCursor(cl, { scroll = false } = {}) {
  clearCursor();
  cursor = cl;
  cl.spans.forEach((s) => s.classList.add('cur'));
  cl.mark?.classList.add('cur');
  cl.cards?.forEach((c) => c.classList.add('cur'));
  if (scroll) {
    const el = cl.spans[0] || cl.anchor;
    const sc = el.closest('.page-scroll');
    if (sc) {
      const r = el.getBoundingClientRect(), b = sc.getBoundingClientRect();
      if (r.top < b.top + 24 || r.bottom > b.bottom - 24) sc.scrollTop += r.top - b.top - sc.clientHeight / 3;
    }
    cl.cards?.[0]?.scrollIntoView({ block: 'nearest' });
  }
  const list = cl.turnEl._claims;
  const text = cl.spans.map((s) => s.textContent).join('').trim();
  ctx.say?.(`Claim ${list.indexOf(cl) + 1} of ${list.length}. ${STATUS_WORD[cl.status].replace(/^./, (x) => x.toUpperCase())}. ${text}`);
}

export function moveCursor(dir) {
  const list = allClaims();
  if (!list.length) return;
  const i = cursor ? list.indexOf(cursor) : -1;
  const next = i < 0 ? (dir > 0 ? list[0] : list.at(-1)) : list[Math.max(0, Math.min(list.length - 1, i + dir))];
  setCursor(next, { scroll: true });
}

export const cursorClaim = () => cursor;

export function openCursor() {
  const cl = cursor || (cardChip && claimOf(cardChip));
  const c = cardChip ? citeFor(cardChip) : cl?.cites[0];
  if (c) { hideCard(true); openAt(c); }
}

// 1-9 opens citation n of the active answer: pins its card and brings its margin card into view
export function pinCitation(n) {
  const t = activeTurn();
  const chip = t?.querySelector(`.answer .chip[data-n="${n}"]`);
  if (!chip) return false;
  const cl = claimOf(chip);
  if (cl) setCursor(cl, { scroll: true });
  showCard(chip, { pinned: true });
  t.querySelector(`.mcard[data-n="${n}"]`)?.scrollIntoView({ block: 'nearest' });
  return true;
}

// jump to citation n of the turn at index `turn`: scroll its chip to the middle, set the claim cursor, pin its card
export function revealCite(turn, n) {
  const t = document.querySelector(`#chat .turn[data-index='${turn}']`);
  const chip = t?.querySelector(`.answer .chip[data-n='${n}']`);
  if (!chip) return false;
  chip.scrollIntoView({ block: 'center', behavior: 'instant' });
  const cl = claimOf(chip);
  if (cl) setCursor(cl);
  showCard(chip, { pinned: true });
  return true;
}

export function stepCitation(dir) {
  const t = activeTurn();
  if (!t) return;
  const ns = [...new Set([...t.querySelectorAll('.answer .chip')].map((c) => Number(c.dataset.n)))].sort((a, b) => a - b);
  if (!ns.length) return;
  const cur = cardChip && t.contains(cardChip) ? Number(cardChip.dataset.n) : cursor?.n ?? (dir > 0 ? 0 : ns.at(-1) + 1);
  const i = ns.findIndex((n) => (dir > 0 ? n > cur : n >= cur));
  const n = dir > 0 ? ns[i < 0 ? 0 : i] : ns[(i < 0 ? ns.length : i) - 1] ?? ns.at(-1);
  pinCitation(n);
}

export function pinCursor() {
  if (!cursor) return false;
  showCard(cursor.chips[0], { pinned: true });
  return true;
}

export function challenge(cl = cursor) {
  if (!cl) return false;
  const text = cl.spans.map((s) => s.textContent).join('').trim();
  const refs = cl.cites.map(refOf).join(', ');
  ctx.ask?.(`Challenge this claim against the sources and say plainly if it is wrong: "${text}"${refs ? ` (cited: ${refs})` : ''}`);
  return true;
}

// filter the margin to one state when a receipt numeral is clicked, and step the cursor through them
function filterState(turnEl, st) {
  const cards = turnEl.querySelector('.cards');
  const on = cards.dataset.filter === st ? '' : st;
  cards.dataset.filter = on;
  for (const it of turnEl._cards || []) it.card.classList.toggle('dim', !!on && it.st !== on);
  if (on) {
    const list = (turnEl._claims || []).filter((cl) => cl.status === on);
    const i = cursor && list.includes(cursor) ? list.indexOf(cursor) + 1 : 0;
    if (list.length) setCursor(list[i % list.length], { scroll: true });
  }
}

export function initCites() {
  document.documentElement.setAttribute('data-cite-cards', '');
  document.addEventListener('pointerover', (e) => {
    const chip = e.target.closest?.('.chip:not(.static)');
    if (!chip || !chip.closest('.has-cites')) return;
    clearTimeout(hideT);
    clearTimeout(showT);
    if (cardChip === chip) return;
    if (pinned) return;
    showT = setTimeout(() => showCard(chip), 120);
  });
  document.addEventListener('pointerout', (e) => {
    const chip = e.target.closest?.('.chip:not(.static)');
    if (chip && !chip.contains(e.relatedTarget)) { clearTimeout(showT); hideCard(); }
  });
  document.addEventListener('focusin', (e) => {
    const chip = e.target.closest?.('.chip:not(.static)');
    if (chip && chip.closest('.has-cites') && !pinned) showCard(chip);
  });
  document.addEventListener('focusout', (e) => { if (e.target.closest?.('.chip') && !card?.contains(e.relatedTarget)) hideCard(); });
  // first click pins the card, a click on the pinned chip opens the file
  document.addEventListener('click', (e) => {
    const chip = e.target.closest?.('.chip:not(.static)');
    if (chip && chip.closest('.has-cites')) {
      e.preventDefault();
      if (pinned && cardChip === chip) openCitation(chip);
      else { const cl = claimOf(chip); if (cl) setCursor(cl); showCard(chip, { pinned: true }); }
      return;
    }
    const col = e.target.closest?.('.rc-col');
    if (col) { filterState(col.closest('.turn'), col.dataset.st); return; }
    if (card && pinned && !card.contains(e.target)) hideCard(true);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.closest?.('.rc-col')) { e.preventDefault(); e.target.click(); }
  });
  // Esc closes the card first; the global handler must not also act
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && card) { hideCard(true); e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener('scroll', (e) => { if (card && !pinned && !card.contains(e.target)) hideCard(true); else if (card && cardChip) place(card, cardChip); }, true);
  window.addEventListener('resize', () => { for (const t of document.querySelectorAll('#chat .turn')) scheduleLayout(t); });
}
