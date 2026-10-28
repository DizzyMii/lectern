// The page (DESIGN 11.3, 11.10, 11.11): question headline, trail, streaming answer with
// citations, actions, the margin, and the composer pinned under it.

import { h, clear, icon, toast, store } from './dom.js';
import { api, nbPath, stream } from './api.js';
import { state, ctx, on, emit, GENERATORS, MODELS, normTurn, apiEngineAvailable } from './state.js';
import { renderAnswer } from './markdown.js';
import { isDoc } from './viewer.js';
import { decorate, receipt, counts, miniReceipt, scheduleLayout } from './cites.js';
import { sourcesOf, swatch, qnum, nextQnum, kbd, glyph, shortPath, inScope, scopeForAsk } from './layers.js';
import { toolRead, buildTraverse, drawTraverse, trailSummary } from './traverse.js';
export { trailSummary };
import { compare, words } from './status.js';
import { renderOnboarding, onboardingActive, endOnboarding } from './onboard.js';
import { recallParts } from './recall.js';

let center, scroller, inner, textarea, askBtn, modelBtn, numEl, chipsEl, quoteEl, recallEl, errEl, belowBtn, sr, composerEl, menuEl = null;
let quote = null; // { text, path, line, endLine } from "Ask about this"

// follow the stream only while the reader is near the bottom
let stick = true;
const toBottom = () => { stick = true; scroller.scrollTop = scroller.scrollHeight; drawBelow(); };
function drawBelow() { if (belowBtn) belowBtn.hidden = stick || !state.streaming; }

let lastSay = 0;
function say(msg, force = false) {
  const now = Date.now();
  if (!sr || (!force && now - lastSay < 1500)) return;
  lastSay = now;
  sr.textContent = msg;
}
ctx.say = (m) => say(m, true);

const GENERIC_SUGGESTIONS = [
  'Give me a map of this notebook: what is covered, and where should I start?',
  'What changed in the most recent version, and what breaks when I upgrade?',
  'What are the most common mistakes people make with these APIs?',
];

export function initChat(el) {
  center = el;
  inner = h('div', { class: 'page-inner' });
  scroller = h('div', { class: 'page-scroll', id: 'page-scroll', tabindex: -1, 'aria-label': 'Answer' }, inner);
  scroller.addEventListener('scroll', () => {
    stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
    drawBelow();
  }, { passive: true });
  sr = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  center.append(scroller, composer(), sr);
  // Copy buttons on code blocks anywhere, including Studio renderers
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('.copy-code');
    if (!b) return;
    const code = b.closest('.codeblock')?.querySelector('code');
    if (code) copyInline(b, code.innerText, 'Copied');
  });
  on('notebook', () => { quote = null; drawQuote(); hideRecall(); recallOff = null; if (!ctx.creatingNotebook) endOnboarding(); renderThread(); });
  on('refresh', () => { if (!state.streaming && !state.conv?.turns.length) renderThread(); drawComposer(); });
  on('scope', () => drawComposer());
  on('status', () => drawModel());
  on('fileindex', () => drawComposer());
}

// ---------- thread ----------

export function renderThread() {
  clear(inner);
  if (recallEl) { hideRecall(); recallOff = null; }
  setReceipt(null);
  drawComposer();
  const setup = onboardingActive();
  center.classList.toggle('onboarding', setup);
  if (setup) { inner.append(renderOnboarding()); return; }
  if (!state.nb) return;
  const conv = state.conv;
  if (!conv || !conv.turns.length) { inner.append(emptyQuestion()); return; }
  const num = qnum(state.convId);
  conv.turns.forEach((t, i) => inner.append(new TurnView(t, { num, index: i }).el));
  requestAnimationFrame(() => { scroller.scrollTop = conv.turns.length > 1 ? scroller.scrollHeight : 0; });
}

function emptyQuestion() {
  const nb = state.nb;
  const first = !nb.conversations.length;
  const sugg = (nb.suggestions?.length ? nb.suggestions : GENERIC_SUGGESTIONS).slice(0, 3);
  return h('article', { class: 'turn empty-q' },
    h('div', { class: 'gutter' }),
    h('div', { class: 'turn-main' },
      h('div', { class: 'q-kicker' }, h('span', { class: 't-kicker accent' }, `Question ${nextQnum()}`)),
      h('h1', { class: 'headline muted' }, first ? 'Nothing asked yet.' : 'A new question.'),
      h('div', { class: 'suggest-head t-kicker' }, 'Try asking'),
      h('ul', { class: 'suggest' }, sugg.map((q) => h('li', null, h('button', { class: 'suggest-row', onclick: () => ctx.ask(q) }, h('span', { class: 'q' }, q), icon('arrow', 14)))))));
}

// "How do I X? I only know Y." -> first sentence upright, the rest italic
function headline(text) {
  const t = String(text || '').trim();
  const m = t.match(/^(.+?[.?!])\s+(\S[\s\S]*)$/);
  const el = h('h1', { class: `headline${t.length > 150 ? ' long' : ''}` });
  if (m) el.append(m[1], ' ', h('em', null, m[2]));
  else el.append(t);
  return el;
}

const modelLabel = (id) => MODELS.find((m) => m.id === id)?.label ?? (id ? id[0].toUpperCase() + id.slice(1) : '');
const hhmm = (iso) => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toTimeString().slice(0, 5) : ''; };

// ---------- trail ----------

function stepCmd(s) {
  const sum = String(s.summary || `${s.name} ${s.input ? JSON.stringify(s.input).slice(0, 100) : ''}`).trim();
  const m = sum.match(/^(\S+)\s+([\s\S]*)$/);
  const verb = (m ? m[1] : sum).toLowerCase();
  let rest = m ? m[2] : '';
  rest = rest.replace(/\s+in\s+(\S+)$/, ' · $1');
  return { verb, rest };
}

const stepPath = (s) => toolRead(s)?.path ?? null;

function doneSummary(steps, turn) {
  const s = trailSummary(steps);
  const parts = s === 'No tool calls' ? ['No tool calls'] : s.split(', ');
  const n = (turn.citations || []).length;
  if (n) parts.push(`checked ${n} citation${n === 1 ? '' : 's'}`);
  if (turn.seconds != null) parts.push(`${Number(turn.seconds).toFixed(1)} s`);
  return parts.join(' · ');
}

// the step's own result line ("4 matches in 3 files") when the stream gives one, else its size
const resText = (s) => (s.ok === false ? 'failed' : s.result || (s.chars != null ? `${Number(s.chars).toLocaleString()} chars` : ''));
const msText = (s) => (s.ms != null ? (s.ms >= 1000 ? `${(s.ms / 1000).toFixed(1)} s` : `${Math.round(s.ms)} ms`) : '');

class Trail {
  constructor(live) {
    this.steps = [];
    this.cites = [];
    this.text = h('span', { class: 'trail-text' });
    this.btn = h('button', { class: 'trail-sum', 'aria-expanded': 'false', onclick: () => this.toggle() },
      h('span', { class: 't-kicker' }, 'Trail'), this.text, h('span', { class: 'grow' }), h('span', { class: 'chev' }, icon('down', 12)), kbd('L'));
    this.log = h('ol', { class: 'trail-log', hidden: true });
    this.map = h('div', { class: 'tmap', hidden: true });
    this.el = h('div', { class: `trail${live ? ' live' : ''}` }, this.btn, this.map, this.log);
    if (live) this.text.append(h('span', { class: 'cur' }, 'reading the question'));
  }
  toggle(force) {
    const open = force ?? this.log.hidden;
    this.log.hidden = !open;
    this.btn.setAttribute('aria-expanded', String(open));
    this.el.classList.toggle('open', open);
    if (open) this.drawMap(); else this.map.hidden = true;
    scheduleLayout(this.el.closest('.turn'));
  }
  drawMap() {
    const m = buildTraverse(this.steps, this.cites, state.nb, isDoc);
    this.map.replaceChildren(m.stations.length > 1 ? drawTraverse(m) : '');
    this.map.hidden = m.stations.length < 2;
  }
  add(ev) {
    const s = { ...ev, id: ev.id || 's' + this.steps.length, done: !!ev.done };
    this.steps.push(s);
    this.row(s);
    this.drawLive();
    return s;
  }
  result(ev) {
    const s = this.steps.find((x) => x.id === ev.id) || [...this.steps].reverse().find((x) => !x.done);
    if (!s) return;
    s.done = true; s.ok = ev.ok !== false; s.chars = ev.chars; s.result = ev.result; s.ms = ev.ms;
    s.res.textContent = resText(s);
    s.msEl.textContent = msText(s);
    s.li.classList.toggle('err', !s.ok);
    this.drawLive();
  }
  row(s) {
    const { verb, rest } = stepCmd(s);
    const rd = toolRead(s), path = rd?.path;
    const cmd = path
      ? h('button', { class: 'tl-cmd link', title: path, onclick: () => ctx.openFile(path, { line: rd.from > 1 ? rd.from : null }) }, verb + ' ', h('bdi', null, rest))
      : h('span', { class: 'tl-cmd' }, verb + ' ', h('bdi', null, rest));
    s.res = h('span', { class: 'tl-res' }, resText(s));
    s.msEl = h('span', { class: 'tl-ms' }, msText(s));
    s.li = h('li', { class: `tl-row${s.ok === false ? ' err' : ''}` }, h('span', { class: 'tl-g' }, icon(rd ? 'file' : 'search', 14)), cmd, s.res, s.msEl);
    this.log.append(s.li);
  }
  // live: steps joined with ">", older ones fold into "n steps >"
  drawLive() {
    if (!this.el.classList.contains('live')) return;
    const shown = this.steps.slice(-3);
    const kids = [];
    if (this.steps.length > 3) kids.push(h('span', { class: 'fold' }, `${this.steps.length - 3} step${this.steps.length === 4 ? '' : 's'}`), h('span', { class: 'sep' }, ' > '));
    shown.forEach((s, i) => {
      const { verb, rest } = stepCmd(s);
      if (i) kids.push(h('span', { class: 'sep' }, ' > '));
      kids.push(h('span', { class: i === shown.length - 1 && !s.done ? 'cur' : 'done' }, `${verb} ${rest}`));
    });
    this.text.replaceChildren(...kids);
  }
  checking(n) {
    if (!this.el.classList.contains('live')) return;
    const kids = [...this.text.childNodes].map((x) => { x.className = x.className === 'cur' ? 'done' : x.className; return x; });
    this.text.replaceChildren(...kids, h('span', { class: 'sep' }, ' > '), h('span', { class: 'cur' }, `checking ${n} citation${n === 1 ? '' : 's'}`));
  }
  finish(turn) {
    this.cites = turn.citations || [];
    this.el.classList.remove('live');
    // the shelf warm-up is not stored with the turn, so drop it here too; the log then reads the same after a reload
    for (const s of this.steps.filter((x) => x.name === 'Shelf')) s.li?.remove();
    this.steps = this.steps.filter((x) => x.name !== 'Shelf');
    for (const s of this.steps) s.done = true;
    this.text.textContent = doneSummary(this.steps, turn);
    // pinned docs arrive with the session, not through a tool, so list the ones the answer cites
    const read = new Set(this.steps.map(stepPath).filter(Boolean));
    const pinned = [...new Set((turn.citations || []).map((c) => c.path).filter((p) => p && isDoc(p) && !read.has(p)))];
    for (const p of pinned) {
      this.log.append(h('li', { class: 'tl-row pinned' }, h('span', { class: 'tl-g' }, icon('file', 14)),
        h('button', { class: 'tl-cmd link', title: p, onclick: () => ctx.openFile(p) }, 'pinned ', h('bdi', null, shortPath(p, 2))),
        h('span', { class: 'tl-res' }, 'from the pinned docs')));
    }
    if (!this.log.hidden) this.drawMap();
  }
}

// ---------- a turn ----------

// End of the last blank line outside a code fence; text before it is final.
function lastSafeBreak(s) {
  const i = s.lastIndexOf('\n\n');
  if (i < 0) return -1;
  const fences = (s.slice(0, i).match(/^\s*(```|~~~)/gm) || []).length;
  return fences % 2 ? s.lastIndexOf('\n```', i) : i;
}

class TurnView {
  constructor(turn, { live = false, num = null, index = 0 } = {}) {
    this.turn = turn;
    this.live = live;
    this.text = live ? '' : turn.answer || '';
    this.shown = 0;
    this.trail = new Trail(live);
    this.answer = h('div', { class: 'answer prose has-cites', 'aria-busy': live ? 'true' : null });
    this.answer.cites = new Map();
    this.actions = h('div', { class: 'actions' });
    this.foldRc = h('div', { class: 'fold-receipt' });
    const label = num ? `Question ${num}${index ? '.' + (index + 1) : ''}` : `Question ${nextQnum()}`;
    const gen = turn.kind ? GENERATORS.find((g) => g.kind === turn.kind)?.label || turn.kind : null;
    const meta = [turn.startedAt ? 'asked ' + hhmm(turn.startedAt) : null, modelLabel(turn.model)].filter(Boolean).join(' · ');
    this.receiptSlot = h('div', { class: 'receipt-slot' });
    this.cards = h('div', { class: 'cards' });
    this.el = h('article', { class: 'turn', dataset: { index } },
      h('div', { class: 'gutter', 'aria-hidden': 'true' }),
      h('div', { class: 'turn-main' },
        h('div', { class: 'q-kicker' }, h('span', { class: 't-kicker accent' }, gen ? 'Note' : label), meta ? h('span', { class: 't-mono-sm' }, meta) : null),
        gen ? headline(`${gen}. ${turn.question || ''}`.trim()) : headline(turn.question),
        this.trail.el, this.foldRc, this.answer, this.actions),
      h('aside', { class: 'margin', 'aria-label': 'Citations' },
        this.receiptSlot,
        h('div', { class: 'cites-head' }, h('span', { class: 't-kicker' }, 'Citations'), h('span', { class: 'keys' }, kbd('1-9'), kbd('['), kbd(']'))),
        this.cards,
        printPanel(turn)));
    for (const tc of turn.toolCalls || []) this.trail.add({ ...tc, ok: tc.ok ?? true, done: true });
    if (live) {
      this.receiptSlot.append(receipt(turn, { total: 0 }, { checking: true }));
    } else {
      this.trail.finish(turn);
      if (!this.trail.steps.length) this.trail.el.hidden = true;
      const d = driftBanner(turn, index);
      if (d) this.answer.before(d);
      this.draw(false);
      this.drawActions();
    }
  }

  delta(text) {
    this.text += text;
    if (this.timer) return;
    this.carry = 0;
    this.timer = setInterval(() => this.tick(), 50);
  }

  // reveal at a steady word cadence (28 words/s, 60 when far behind), decoupled from network bursts
  tick() {
    const rest = this.text.slice(this.shown);
    if (!rest) { clearInterval(this.timer); this.timer = 0; return; }
    const backlog = (rest.match(/\S+/g) || []).length;
    this.carry += (backlog > 80 ? 60 : 28) * 0.05;
    let words = Math.floor(this.carry);
    if (!words) return;
    this.carry -= words;
    const re = /\s*\S+/y;
    re.lastIndex = this.shown;
    while (words-- > 0 && re.lastIndex < this.text.length) { if (!re.exec(this.text)) { re.lastIndex = this.text.length; break; } }
    this.shown = re.lastIndex;
    this.draw(true);
  }

  stopTicking() { clearInterval(this.timer); this.timer = 0; }

  drawStreaming() {
    const text = this.text.slice(0, this.shown);
    if (!this.frozenEl) {
      this.seen = new Map();
      this.frozenLen = 0;
      this.frozenEl = h('div', { class: 'live-part' });
      this.tailEl = h('div', { class: 'live-part' });
      this.answer.replaceChildren(this.frozenEl, this.tailEl);
    }
    const cut = lastSafeBreak(text);
    if (cut > this.frozenLen) {
      this.frozenEl.insertAdjacentHTML('beforeend', renderAnswer(text.slice(this.frozenLen, cut), [], { streaming: true, seen: this.seen }).html);
      this.frozenLen = cut;
      say('New paragraph');
    }
    this.tailEl.innerHTML = renderAnswer(text.slice(this.frozenLen), [], { streaming: true, seen: this.seen }).html;
    this.answer.cites = new Map([...this.seen.values()].map((c) => [String(c.n), c]));
    const n = this.seen.size;
    if (n !== this.pendingN) {
      this.pendingN = n;
      this.receiptSlot.replaceChildren(receipt(this.turn, { total: n, verified: 0, moved: 0, unverified: 0, uncited: 0 }, { checking: true }));
    }
  }

  draw(streaming) {
    if (streaming) this.drawStreaming();
    else {
      this.frozenEl = this.tailEl = null;
      this.answer.innerHTML = renderAnswer(this.text, this.turn.citations).html;
      this.answer.cites = new Map(this.turn.citations.map((c) => [String(c.n), c]));
      this.decorate(false);
    }
    if (stick && this.el.isConnected) scroller.scrollTop = scroller.scrollHeight;
    drawBelow();
  }

  decorate(live) {
    const k = decorate(this.el, this.turn, { live, replay: !live && !!this.turn.citeCheck });
    this.foldRc.replaceChildren(...miniReceipt(k));
    if (this.el.isConnected || live) setReceipt(k);
    else requestAnimationFrame(() => { if (this.el === inner.lastElementChild) setReceipt(k); });
  }

  finish(final) {
    this.stopTicking();
    Object.assign(this.turn, normTurn({ ...this.turn, ...final, question: this.turn.question, kind: this.turn.kind, answer: final.answer ?? this.text, startedAt: this.turn.startedAt }));
    if (!final.toolCalls) this.turn.toolCalls = this.trail.steps.map(({ id, name, input, summary, ok }) => ({ id, name, input, summary, ok }));
    this.text = this.turn.answer;
    this.answer.removeAttribute('aria-busy');
    this.trail.finish(this.turn);
    this.frozenEl = this.tailEl = null;
    this.answer.innerHTML = renderAnswer(this.text, this.turn.citations).html;
    this.answer.cites = new Map(this.turn.citations.map((c) => [String(c.n), c]));
    this.decorate(true);
    this.drawActions();
    const k = counts(this.turn);
    say(`Answer ready. ${k.verified} verified, ${k.moved} moved, ${k.unverified} unverified.`, true);
  }

  stop() {
    this.stopTicking();
    this.answer.removeAttribute('aria-busy');
    this.trail.finish(this.turn);
    this.turn.answer = this.text;
    const words = (this.text.match(/\S+/g) || []).length;
    this.frozenEl = this.tailEl = null;
    this.answer.innerHTML = renderAnswer(this.text, [], { streaming: true }).html;
    this.answer.append(h('div', { class: 'stopped' }, h('span', null, `Stopped after ${words} word${words === 1 ? '' : 's'}.`),
      h('button', { class: 'btn', onclick: () => ctx.ask('Continue.') }, 'Continue')));
    this.receiptSlot.replaceChildren(receipt(this.turn, { total: 0, verified: 0, moved: 0, unverified: 0, uncited: 0 }));
    say(`Stopped after ${words} words.`, true);
  }

  fail(message) {
    this.stopTicking();
    this.answer.removeAttribute('aria-busy');
    this.trail.finish(this.turn);
    if (!this.text) clear(this.answer);
    this.answer.append(banner('error', 'The model returned an error.', message || 'Unknown error', h('button', { class: 'btn', onclick: () => ctx.ask(this.turn.question) }, 'Retry')));
    this.receiptSlot.replaceChildren();
  }

  drawActions() {
    const t = this.turn;
    const cites = t.citations || [];
    const withSources = () => t.answer + (cites.length ? '\n\n' + cites.map((c) => `[^${c.n}]: ${c.path}${c.line ? `#L${c.line}${c.endLine && c.endLine !== c.line ? '-L' + c.endLine : ''}` : ''}${c.quote ? ` "${c.quote}"` : ''} (${c.status})`).join('\n') : '');
    const copy = h('button', { class: 'btn act-copy', onclick: (e) => copyInline(e.currentTarget, withSources(), `Copied with ${cites.length} citation${cites.length === 1 ? '' : 's'}`) }, 'Copy with citations', kbd('C'));
    this.copyBtn = copy;
    if (t.kind) {
      this.actions.replaceChildren(h('div', { class: 'act-row' },
        this.note ? h('button', { class: 'btn', onclick: () => ctx.openNote(this.note) }, 'Open the saved note') : null, copy));
      return;
    }
    const ver = (state.nb?.title || '').match(/\d+\.\d+(?:\.\d+)?/)?.[0];
    this.actions.replaceChildren(
      h('div', { class: 'act-row' }, copy,
        h('button', { class: 'btn', onclick: () => ctx.challengeCursor?.() || ctx.ask('Challenge this answer against the sources. Which claims could be wrong, and why?') }, 'Challenge a claim', kbd('X')),
        h('button', { class: 'btn', onclick: () => ctx.ask('Show the code path for this answer, file by file, citing each step.') }, 'Show the code path'),
        h('button', { class: 'btn quiet', onclick: () => saveNote(t, withSources()) }, 'Save as note')),
      h('button', { class: 'btn scrutiny', onclick: () => ctx.ask(`What could make this wrong${ver ? ' for ' + ver : ''}?`) }, `What could make this wrong${ver ? ' for ' + ver : ''}?`, kbd('W')));
  }
}

// Studio "Print this as..." panel: four recipes picked by what the question is about.
function printPanel(turn) {
  if (!state.recipes.length || turn.kind) return null;
  const q = String(turn.question || '').toLowerCase();
  const want = [];
  if (/flow|packet|send|event|sequence|order|lifecycle/.test(q)) want.push('sequence-diagram', 'flow-diagram');
  if (/port|upgrade|migrat|old|used to|replace/.test(q)) want.push('porting-guide');
  if (/register|structure|class|where/.test(q)) want.push('code-map', 'dependency-graph');
  want.push('gotchas', 'cheat-sheet', 'build-x');
  const list = [...new Set(want)].map((id) => state.recipes.find((r) => r.id === id)).filter(Boolean).slice(0, 4);
  if (!list.length) return null;
  const numOf = (r) => String(state.recipes.indexOf(r) + 1).padStart(2, '0');
  return h('section', { class: 'print-panel' },
    h('div', { class: 'pp-head' }, h('span', { class: 't-kicker' }, 'Studio'), h('span', { class: 't-ui-sm' }, 'Print this as')),
    list.map((r) => h('button', { class: 'pp-row', onclick: () => ctx.openRecipe(r.id) },
      h('span', { class: 'pp-num' }, numOf(r)), h('span', { class: 'pp-t' }, r.title), h('span', { class: 'leaders', 'aria-hidden': 'true' }), h('span', { class: 'pp-k' }, r.kind || ''))),
    h('button', { class: 'btn link', onclick: () => ctx.toggleStudio() }, `All ${state.recipes.length} recipes`, kbd('P')));
}

export function banner(kind, title, body, action) {
  return h('div', { class: `banner ${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    glyph(kind === 'error' ? 'unverified' : kind === 'warn' ? 'moved' : 'pending'),
    h('div', { class: 'bn-body' }, h('strong', null, title), body ? h('span', null, ' ', body) : null), action || null);
}

// A reopened turn whose citations got worse: say so above the answer. Re-ask only on the first turn, a follow-up leans on the turns before it.
function driftBanner(turn, index) {
  const r = !turn.kind && compare(turn.citations, { at0: turn.citeCheck?.checkedAt0 });
  if (!r?.worse) return null;
  const ask = index === 0 && turn.question ? h('button', { class: 'btn', title: 'Ask the same question in a new conversation, against the files as they are now', onclick: () => reAsk(turn) }, 'Re-ask') : null;
  return banner('warn', `${r.worse} of ${r.total} citation${r.total === 1 ? '' : 's'} got worse since ${r.since}.`, `${words(r.bad)}.`, ask);
}

function reAsk(turn) {
  if (state.streaming) { toast('Stop the current answer first.', 'info'); return; }
  quote = null; drawQuote(); // a pending 'Ask about this' chip would be prefixed to the question
  ctx.newConversation(); // a fresh session, so the model reads the files as they are today
  ctx.ask(turn.question);
}

async function copyInline(btn, text, done) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }, text);
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } catch {}
    ta.remove();
  }
  const kids = [...btn.childNodes];
  btn.replaceChildren(icon('check', 14), done);
  clearTimeout(btn._t);
  btn._t = setTimeout(() => btn.replaceChildren(...kids), 1600);
}

export function copyAnswer() {
  const last = [...inner.querySelectorAll('.turn .act-copy')].at(-1);
  last?.click();
  return !!last;
}

async function saveNote(turn, body) {
  try {
    const title = (turn.kind ? GENERATORS.find((g) => g.kind === turn.kind)?.label + ': ' : '') + (turn.question || 'Answer').replace(/\s+/g, ' ').slice(0, 80);
    await api.post(nbPath(state.nbId, '/notes'), { title, body: `> ${turn.question}\n\n${body}`, fromConversation: state.convId || undefined });
    toast('Saved to notes', 'ok', 2200);
    ctx.refreshNotebook();
  } catch (e) { toast(e.message); }
}

// the top-bar mini receipt follows the latest answer on the page
function setReceipt(k) {
  const el = document.getElementById('tb-receipt');
  if (el) el.replaceChildren(...miniReceipt(k));
}

// ---------- asking ----------

function beginTurn(turn) {
  if (turn.kind) {
    if (!state.conv?.turns.length) clear(inner);
  } else {
    if (!state.conv) state.conv = { id: null, title: turn.question.slice(0, 60) || 'New question', turns: [] };
    if (!state.conv.turns.length) clear(inner);
    state.conv.turns.push(turn);
    emit('conversation');
  }
  const num = state.convId ? qnum(state.convId) : null;
  const view = new TurnView(turn, { live: true, num, index: turn.kind ? 0 : state.conv.turns.length - 1 });
  inner.append(view.el);
  toBottom();
  return view;
}

async function run(path, body, turn, after) {
  if (state.streaming) { toast('An answer is still streaming. Stop it first.', 'info'); return; }
  errEl.hidden = true;
  const view = beginTurn(turn);
  const controller = new AbortController();
  state.streaming = { controller };
  drawComposer();
  let final = null, failed = false;
  const onEvent = (ev) => {
    if (ev.conversationId && !turn.kind) state.convId = ev.conversationId;
    switch (ev.type) {
      case 'delta': case 'text': view.delta(ev.text ?? ''); break;
      case 'tool': view.trail.add(ev); say('Working: ' + (ev.summary || ev.name)); break;
      case 'tool_result': view.trail.result(ev); break;
      case 'done': final = ev; view.trail.checking((ev.citations || []).length); view.finish(ev); break;
      case 'error': failed = true; view.fail(ev.message || ev.error); break;
      case 'conversation': case 'start': case 'meta':
        if (!turn.kind && (ev.id || ev.conversationId)) state.convId = ev.conversationId || ev.id;
        break;
      default: break;
    }
  };
  try {
    await stream(path, body, onEvent, controller.signal);
    if (!final && !failed) view.finish({});
  } catch (e) {
    if (e.name === 'AbortError') view.stop();
    else {
      failed = true;
      view.fail(e.message);
      errEl.hidden = false;
      errEl.replaceChildren(glyph('unverified', 'glyph sm'), /fetch|network/i.test(e.message) ? 'Cannot reach the model. Check your connection or API key in Settings.' : 'The model did not answer.',
        h('button', { class: 'btn', onclick: () => ctx.ask(turn.question) }, 'Retry', kbd('R')));
    }
  } finally {
    state.streaming = null;
    textarea.value = '';
    hideRecall(); recallOff = null;
    autosize();
    drawComposer();
    drawBelow();
    textarea.focus();
  }
  if (state.conv && !turn.kind) state.conv.id = state.convId;
  await after?.(final, failed, view);
}

ctx.ask = async (question) => {
  question = String(question || '').trim();
  if (!question || !state.nbId) return;
  hideRecall(); recallOff = null;
  const asked = question;
  if (quote) {
    question = `About this passage from ${quote.path}${quote.line ? ':' + quote.line + (quote.endLine && quote.endLine !== quote.line ? '-' + quote.endLine : '') : ''}:\n\n> ${quote.text.split('\n').join('\n> ')}\n\n${question}`;
    quote = null;
    drawQuote();
  }
  // the composer stays locked on the question while it streams (DESIGN 11.3)
  textarea.value = asked;
  autosize();
  const turn = normTurn({ question, model: state.model, startedAt: new Date().toISOString() });
  const isNew = !state.convId;
  await run(nbPath(state.nbId, '/ask'), { question, conversationId: state.convId || undefined, scope: scopeForAsk(), ...modelBody() }, turn, async () => {
    await ctx.refreshNotebook();
    if (isNew && !state.convId && state.nb?.conversations[0]) state.convId = state.nb.conversations[0].id;
    if (state.conv) state.conv.id = state.convId;
    const found = state.nb?.conversations.find((c) => c.id === state.convId);
    if (found && state.conv) state.conv.title = found.title;
    if (isNew && state.convId) {
      const k = inner.querySelector('.turn:last-child .q-kicker .t-kicker');
      if (k) k.textContent = `Question ${qnum(state.convId)}`;
    }
    ctx.syncHash?.();
    emit('conversation');
  });
};

ctx.generate = async (kind) => {
  if (!state.nbId) return;
  const g = GENERATORS.find((x) => x.kind === kind);
  const turn = normTurn({ question: g?.desc || '', kind, model: state.model, startedAt: new Date().toISOString() });
  const before = new Set((state.nb?.notes || []).map((n) => n.slug));
  await run(nbPath(state.nbId, '/generate'), { kind, ...modelBody() }, turn, async (final, failed, view) => {
    if (failed || !final) return;
    await ctx.refreshNotebook();
    const note = (final.note && state.nb.notes.find((n) => n.slug === final.note.slug)) || state.nb.notes.find((n) => !before.has(n.slug));
    toast(`${g?.label || 'Note'} saved to notes`, 'ok', 2600);
    if (note) { view.note = note; view.drawActions(); ctx.openNote(note); }
  });
};

const modelBody = () => (state.model === 'api' ? { model: 'opus', engine: 'api' } : { model: state.model });

export function stopStreaming() { state.streaming?.controller.abort(); }
export const isStreaming = () => !!state.streaming;

// ---------- composer ----------

function autosize() {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 132) + 'px';
}

function models() { return [...MODELS, ...(apiEngineAvailable() ? [{ id: 'api', label: 'API' }] : [])]; }

const MODEL_HINT = { opus: 'most careful', sonnet: 'balanced', haiku: 'fastest', api: 'Anthropic API engine' };

function drawModel() {
  if (!models().find((m) => m.id === state.model)) state.model = 'opus';
  modelBtn.replaceChildren(models().find((m) => m.id === state.model)?.label || 'Opus', icon('down', 12));
}

function openModelMenu() {
  if (menuEl) return closeMenu();
  const r = modelBtn.getBoundingClientRect();
  menuEl = h('div', { class: 'menu', role: 'menu', style: { position: 'fixed', left: `${Math.max(8, r.right - 220)}px`, bottom: `${window.innerHeight - r.top + 6}px`, width: '220px' } },
    models().map((m) => h('button', { class: `menu-item${m.id === state.model ? ' sel' : ''}`, role: 'menuitemradio', 'aria-checked': String(m.id === state.model),
      onclick: () => { state.model = m.id; store.set('model', m.id); drawModel(); closeMenu(); textarea.focus(); } },
    h('span', null, m.label), h('span', { class: 'hint' }, MODEL_HINT[m.id] || ''))));
  document.body.append(menuEl);
  modelBtn.setAttribute('aria-expanded', 'true');
  menuEl.querySelector('.menu-item.sel, .menu-item')?.focus();
  menuEl.addEventListener('keydown', (e) => {
    const items = [...menuEl.querySelectorAll('.menu-item')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); modelBtn.focus(); }
  });
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
}
function outside(e) { if (menuEl && !menuEl.contains(e.target) && !modelBtn.contains(e.target)) closeMenu(); }
function closeMenu() { menuEl?.remove(); menuEl = null; modelBtn?.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside, true); }

function drawQuote() {
  if (!quoteEl) return;
  quoteEl.hidden = !quote;
  if (!quote) return clear(quoteEl);
  quoteEl.replaceChildren(h('div', { class: 'cq-text' }, quote.text),
    h('span', { class: 'cq-path' }, `${shortPath(quote.path)}${quote.line ? ':' + quote.line + (quote.endLine && quote.endLine !== quote.line ? '-' + quote.endLine : '') : ''}`),
    h('button', { class: 'icon-btn', 'aria-label': 'Remove quote', onclick: () => { quote = null; drawQuote(); textarea.focus(); } }, icon('x', 14)));
  const src = sourcesOf().find((s) => quote.path.startsWith(s.prefix));
  if (src) quoteEl.dataset.layer = src.layer; else delete quoteEl.dataset.layer;
}

// ---------- asked before (DESIGN 11.3): one earlier answer that reads like the question being typed ----------

let recallTimer, recallCtl, recallSeq = 0, recallShown = null, recallOff = null;
const recallKey = (hit) => `${hit.notebook}/${hit.id}`;

function queueRecall() {
  clearTimeout(recallTimer);
  recallCtl?.abort();
  recallSeq++;
  const q = textarea.value.trim();
  if (!q) recallOff = null;
  if (state.streaming || !state.nbId || q.split(/\s+/).filter(Boolean).length < 3) return hideRecall();
  recallTimer = setTimeout(() => askRecall(q), 350);
}

async function askRecall(q) {
  recallCtl = new AbortController();
  const seq = ++recallSeq;
  let hit;
  try {
    const r = await api.get(`/api/recall?mode=hint&kinds=answer&limit=1&q=${encodeURIComponent(q.slice(0, 500))}&nb=${encodeURIComponent(state.nbId)}${state.convId ? `&skip=${encodeURIComponent(state.convId)}` : ''}`, recallCtl.signal);
    hit = r?.hits?.[0];
  } catch { return; } // no hint is the right answer when the server is away or mocked
  if (seq !== recallSeq) return;
  if (!hit || recallKey(hit) === recallOff) return hideRecall();
  showRecall(hit);
}

function showRecall(hit) {
  const { status, text } = recallParts(hit, state.nbId);
  const key = recallKey(hit);
  const st = status ? h('span', { class: `rc-st st-${status}` }, glyph(status, 'glyph sm')) : null, tx = h('span', { class: 'rc-text' }, text);
  if (key === recallShown && !recallEl.hidden) { // same answer again: leave the buttons, so a focused Open keeps its focus
    recallEl.querySelector('.rc-st')?.remove();
    recallEl.querySelector('.rc-text').replaceWith(tx);
    if (st) recallEl.prepend(st);
  } else recallEl.replaceChildren(st ?? '', tx,
    h('button', { class: 'btn link', type: 'button', onclick: () => { recallOff = recallKey(hit); hideRecall(); ctx.openRecall(hit); } }, 'Open', kbd('Tab')),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Dismiss', onclick: dismissRecall }, icon('x', 14)));
  recallEl.hidden = false;
  if (key !== recallShown) say(text, true);
  recallShown = key;
}

function hideRecall() {
  clearTimeout(recallTimer);
  recallCtl?.abort();
  recallSeq++;
  recallShown = null;
  if (recallEl) { recallEl.hidden = true; clear(recallEl); }
}

function dismissRecall() {
  recallOff = recallShown;
  hideRecall();
  textarea.focus();
}

ctx.askAbout = (q) => askAbout(q);
export function askAbout(q) {
  quote = q;
  drawQuote();
  textarea.focus();
}

function drawComposer() {
  if (!textarea) return;
  const live = !!state.streaming;
  const srcs = sourcesOf();
  const none = !!state.nb && !srcs.length;
  composerEl.classList.toggle('asking', live);
  composerEl.classList.toggle('disabled', none);
  textarea.readOnly = live;
  textarea.placeholder = none ? 'Add a source first' : 'Ask a follow-up, or press / for a new question';
  if (!state.convId && !live) textarea.placeholder = none ? 'Add a source first' : 'Ask a question about your sources';
  numEl.textContent = state.convId ? `Question ${qnum(state.convId) || ''}.${(state.conv?.turns.length || 0) + 1}` : `Question ${nextQnum()}`;
  if (live) {
    askBtn.className = 'btn ask-btn';
    askBtn.replaceChildren('Stop', ...kbd('Esc'));
    askBtn.disabled = false;
  } else {
    askBtn.className = 'btn primary ask-btn';
    askBtn.replaceChildren('Ask', ...kbd('Enter'));
    askBtn.disabled = none || !textarea.value.trim();
  }
  chipsEl.replaceChildren(none
    ? h('button', { class: 'btn link', type: 'button', onclick: () => ctx.openAddSource() }, 'Add a source')
    : !srcs.length ? ''
      : srcs.every(inScope) ? h('span', { class: 'scope-chip', title: srcs.map((s) => s.name).join(', ') }, h('span', { class: 'sw-row' }, srcs.slice(0, 8).map((s) => swatch(s, true))), `All ${srcs.length} source${srcs.length === 1 ? '' : 's'}`)
        : srcs.filter(inScope).map((s) => h('span', { class: 'scope-chip one', title: `${s.name} is in scope. Toggle sources in the rail with Space.`, dataset: { layer: s.layer } }, swatch(s, true), s.name)));
}

function composer() {
  textarea = h('textarea', { rows: 1, 'aria-label': 'Ask a question', spellcheck: 'true' });
  askBtn = h('button', { type: 'submit', class: 'btn primary ask-btn' });
  modelBtn = h('button', { type: 'button', class: 'btn quiet model-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Model' });
  modelBtn.addEventListener('mousedown', (e) => { if (e.button === 0) { e.preventDefault(); openModelMenu(); } });
  modelBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowUp') { e.preventDefault(); openModelMenu(); } });
  numEl = h('span', { class: 't-mono-sm' });
  chipsEl = h('div', { class: 'c-scope' });
  quoteEl = h('div', { class: 'c-quote', hidden: true });
  recallEl = h('div', { class: 'c-recall', role: 'group', 'aria-label': 'Asked before', hidden: true });
  recallEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismissRecall(); } });
  errEl = h('div', { class: 'c-error', role: 'alert', hidden: true });
  composerEl = h('form', { class: 'composer', 'aria-label': 'Ask',
    onsubmit: (e) => { e.preventDefault(); state.streaming ? stopStreaming() : ctx.ask(textarea.value); } },
  h('div', { class: 'c-row1' }, h('label', { class: 't-kicker accent', for: 'ask-input' }, 'Ask'), h('span', { class: 'grow' }), numEl),
  quoteEl, textarea, recallEl,
  h('div', { class: 'c-row3' }, chipsEl, h('span', { class: 'grow' }), modelBtn, askBtn));
  textarea.id = 'ask-input';
  composerEl.addEventListener('pointerdown', (e) => { if (!e.target.closest('button, textarea')) { e.preventDefault(); textarea.focus(); } });
  belowBtn = h('button', { class: 'new-below', hidden: true, onclick: toBottom }, 'New text below', kbd('End'));
  textarea.addEventListener('input', () => { autosize(); drawComposer(); queueRecall(); });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!state.streaming) ctx.ask(textarea.value);
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!state.streaming) ctx.ask(textarea.value); return; }
    if (e.key === 'Escape' && state.streaming) { e.preventDefault(); e.stopPropagation(); stopStreaming(); return; }
    if (e.key === 'Escape' && recallShown) { e.preventDefault(); e.stopPropagation(); dismissRecall(); return; }
    if (e.key === 'Escape' && !textarea.value) { e.preventDefault(); textarea.blur(); return; }
    // "/" in an empty composer starts a new question
    if (e.key === '/' && !textarea.value && state.convId) { e.preventDefault(); ctx.newConversation(); return; }
    // Up in an empty composer edits the last question
    if (e.key === 'ArrowUp' && !textarea.value && state.conv?.turns.length) {
      e.preventDefault();
      textarea.value = state.conv.turns.at(-1).question || '';
      autosize(); drawComposer();
    }
    if ((e.key === 'm' || e.key === 'M') && !textarea.value && !e.ctrlKey && !e.altKey) { e.preventDefault(); openModelMenu(); }
  });
  drawModel();
  setTimeout(drawComposer);
  return h('div', { class: 'composer-wrap' }, belowBtn, composerEl, errEl);
}

export function focusComposer() { textarea?.focus(); }
export function setTitle() { emit('conversation'); }
// kept for callers of the old recipe menu; recipes now live in the palette and Studio
export function openGenerators() { ctx.openPalette?.('', 'studio'); }
export function endScroll() { toBottom(); }
