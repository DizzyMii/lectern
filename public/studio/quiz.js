// Quiz artifacts: quiz mode (answer, check, explain) and flashcards (flip,
// got-it / again piles, shuffle, keyboard), score strip, JSON eval export.
// Cards keys: Space flip, Right got it, Left again, S shuffle. Quiz keys: 1-9 pick, Enter checks.

import {
  h, icon, s, slug, download, btn, segmented, menuButton, citeHost, md, stateView, emptyView, summaryBlock, refChip,
  statusOf, statusLine, citesIn, citeCard, midPath, swatch, layerOf, markShapes, normStatus, regenButton,
} from './common.js';

const LETTERS = 'ABCDEFGHIJ';
const norm = (t) => String(t ?? '').replace(/\[\^\d+\]/g, '').toLowerCase().replace(/[`*_"'“”‘’.,;:!?()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();
const plain = (t) => String(t ?? '').replace(/\s*\[\^\d+\]/g, '').replace(/[*_`]/g, '').trim();
const pad2 = (n) => String(n).padStart(2, '0');
// exports keep the markdown, only citation markers go
const bare = (t) => String(t ?? '').replace(/\[\^\d+\]/g, '').trim();

// Map an answer string onto an option index: exact text, a bare letter, or "B) text".
function optionIndex(ans, options) {
  const a = norm(ans);
  let i = options.findIndex((o) => norm(o) === a);
  if (i >= 0) return i;
  const m = String(ans ?? '').trim().match(/^([A-Ja-j])(?:[).:\s]|$)/);
  if (m) { const j = LETTERS.indexOf(m[1].toUpperCase()); if (j < options.length) return j; }
  const stripped = norm(String(ans ?? '').replace(/^\s*[A-Ja-j][).:]\s*/, ''));
  i = options.findIndex((o) => norm(o) === stripped);
  return i;
}

function gradeShort(given, expected) {
  const g = norm(given), e = norm(Array.isArray(expected) ? expected.join(' ') : expected);
  if (!g) return false;
  if (g === e || (e.length > 3 && g.includes(e))) return true;
  const et = e.split(' ').filter((w) => w.length > 2);
  if (!et.length) return false;
  const gs = new Set(g.split(' '));
  return et.filter((w) => gs.has(w)).length / et.length >= 0.6;
}

const mini = (status, size = 12) => s('svg', { class: `sa-glyph${status ? ' st-' + status : ''}`, viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': 'true' }, markShapes(status));

// faint static contour relief for the card corner (DESIGN 12.5)
function relief() {
  const paths = [
    'M150 120c-20-40-6-82 30-96s78 4 88 40-10 70-52 78-56 18-66-22z',
    'M170 118c-12-28 0-58 26-66s52 6 58 30-8 48-36 52-38 10-48-16z',
    'M188 114c-6-16 2-34 18-38s30 4 34 18-4 28-20 30-24 6-32-10z',
    'M120 140c-30-60-10-120 50-136',
    'M100 140c-20-40-14-90 10-118',
  ];
  return s('svg', { class: 'sz-relief', viewBox: '0 0 280 140', width: 280, height: 140, 'aria-hidden': 'true' }, paths.map((d) => s('path', { d })));
}

export function render(container, artifact, ctx = {}) {
  container.classList.add('artifact-canvas');
  const root = h('div', { class: 'sa sa-quiz', tabindex: '-1' });
  container.append(root);
  const cleanup = [];
  const done = { destroy() { cleanup.forEach((f) => f()); root.remove(); } };
  const data = artifact.data;
  const ok = data && Array.isArray(data.questions);
  if (artifact.status === 'invalid' || artifact.status === 'error' || (data && !ok)) {
    root.append(stateView(container, artifact, ctx, artifact.status === 'error' ? { message: artifact.error || 'The run ended with an error.' } : {}));
    return done;
  }
  const qs = (data?.questions || []).filter((q) => q && q.q).map((q, i) => ({ ...q, id: String(q.id ?? i + 1), kind: q.kind || (q.options?.length ? 'single' : 'short') }));
  const cardsFirst = artifact.recipe === 'flashcards' || qs.every((q) => q.kind === 'short');
  if (!qs.length) { root.append(emptyView(cardsFirst ? 'No cards.' : 'No questions.', null, regenButton(container, artifact, ctx))); return done; }

  const answerText = (q) => {
    if (q.kind === 'short' || !q.options?.length) return Array.isArray(q.answer) ? q.answer.join(', ') : String(q.answer ?? '');
    const list = Array.isArray(q.answer) ? q.answer : [q.answer];
    return list.map((a) => { const i = optionIndex(a, q.options); return i >= 0 ? q.options[i] : String(a); }).join(', ');
  };
  const correctSet = (q) => new Set((Array.isArray(q.answer) ? q.answer : [q.answer]).map((a) => optionIndex(a, q.options || [])).filter((i) => i >= 0));
  const citesOf = (q) => citesIn(artifact, q.q, q.explain, answerText(q), ...(q.options || []));
  // status of a card: its ref, else the weakest of its citations
  const statusOfQ = (q) => {
    if (q.ref) { const st = statusOf(q.ref, artifact); if (st) return st; }
    const sts = citesOf(q).map((c) => normStatus(c.status)).filter(Boolean);
    return ['unverified', 'moved', 'pending', 'verified'].find((x) => sts.includes(x)) || null;
  };

  let mode = cardsFirst ? 'cards' : 'quiz';
  const stage = h('div', { class: 'sz-stage' });
  citeHost(stage, artifact, ctx);
  const side = h('aside', { class: 'sz-side' });
  citeHost(side, artifact, ctx);
  const modeSeg = segmented([['cards', 'Cards'], ['quiz', 'Quiz']], mode, (v) => { mode = v; draw(); }, 'Mode');
  const toolbar = h('div', { class: 'sa-toolbar' },
    modeSeg,
    h('div', { class: 'sa-meta' }, `${qs.length} ${qs.length === 1 ? 'question' : 'questions'}`),
    h('div', { class: 'sa-spacer' }),
    menuButton('Export', [{ label: 'JSON eval set', hint: '.json', run: () => exportEval() }]));
  root.append(toolbar, h('div', { class: 'sz-layout' }, stage, side));
  const sum = summaryBlock(artifact);
  if (sum) { citeHost(sum, artifact, ctx); root.append(sum); }

  // ---------- quiz mode ----------
  const quiz = { i: 0, picks: new Map(), results: new Map(), finished: false, order: qs.map((_, i) => i) };

  function strip() {
    return h('div', { class: 'sz-strip', 'aria-hidden': 'true' }, quiz.order.map((j, k) => h('i', { class: [quiz.results.has(j) ? (quiz.results.get(j) ? 'ok' : 'bad') : '', k === quiz.i && !quiz.finished ? 'cur' : ''].filter(Boolean).join(' ') || null })));
  }

  function drawQuiz() {
    if (quiz.finished) return drawQuizSummary();
    const qi = quiz.order[quiz.i];
    const q = qs[qi];
    const result = quiz.results.get(qi);
    const checked = result !== undefined;
    const pick = quiz.picks.get(qi);
    const right = correctSet(q);
    let body;
    if (q.kind === 'short' || !q.options?.length) {
      const ta = h('textarea', { class: 'textarea sz-short', rows: 3, placeholder: 'Type your answer', 'aria-label': 'Your answer', disabled: checked }, pick || '');
      ta.addEventListener('input', () => { quiz.picks.set(qi, ta.value); checkBtn.disabled = !ta.value.trim(); });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); check(); } });
      body = ta;
      setTimeout(() => { if (!checked) ta.focus(); });
    } else {
      const multi = q.kind === 'multi';
      const sel = new Set(Array.isArray(pick) ? pick : []);
      body = h('div', { class: 'sz-options', role: multi ? 'group' : 'radiogroup', 'aria-label': 'Options' }, q.options.map((o, oi) => {
        const state = checked ? (right.has(oi) ? ' right' : sel.has(oi) ? ' wrong' : '') : '';
        const b = h('button', { type: 'button', class: `sz-opt${sel.has(oi) ? ' on' : ''}${state}`, role: multi ? 'checkbox' : 'radio', 'aria-checked': String(sel.has(oi)), disabled: checked },
          h('kbd', { class: 'lt' }, oi < 9 ? String(oi + 1) : LETTERS[oi]),
          md(o, artifact, 'tx'),
          checked && right.has(oi) ? h('span', { class: 'mk st-verified' }, mini('verified', 14), h('span', null, 'right')) : null,
          checked && !right.has(oi) && sel.has(oi) ? h('span', { class: 'mk st-unverified' }, mini('unverified', 14), h('span', null, 'your pick')) : null);
        b.addEventListener('click', () => toggle(qi, oi, multi));
        return b;
      }));
    }
    const checkBtn = btn(checked ? 'Next' : 'Check', () => (checked ? next() : check()), { cls: 'primary', kbd: 'Enter' });
    checkBtn.disabled = !checked && (pick == null || (Array.isArray(pick) ? !pick.length : !String(pick).trim()));
    const verdict = checked ? h('div', { class: `sz-verdict ${result ? 'ok st-verified' : 'bad st-unverified'}`, role: 'status' },
      h('div', { class: 'vh' }, mini(result ? 'verified' : 'unverified', 14), h('span', null, result ? 'Correct' : 'Not quite')),
      !result || q.kind === 'short' ? h('div', { class: 'ans' }, h('span', { class: 't-kicker' }, 'Answer'), md(answerText(q), artifact)) : null,
      q.explain ? md(q.explain, artifact, 'ex') : null,
      h('div', { class: 'sa-row' },
        refChip(q.ref, ctx, artifact),
        q.kind === 'short' && !result ? btn('I had it right', () => { quiz.results.set(qi, true); draw(); }, { cls: 'quiet small' }) : null)) : null;
    const got = [...quiz.results.values()].filter(Boolean).length;
    stage.replaceChildren(h('div', { class: 'sz-quiz' },
      strip(),
      h('div', { class: 'sz-top' }, h('span', { class: 'sz-n' }, `Question ${quiz.i + 1} of ${qs.length}`), h('div', { class: 'sa-spacer' }), h('span', { class: 'sz-score' }, `${got} correct`)),
      h('div', { class: 't-kicker sz-kind' }, q.kind === 'multi' ? 'Choose all that apply' : q.kind === 'short' ? 'Short answer' : 'Choose one'),
      md(q.q, artifact, 'sz-q'),
      body,
      verdict,
      h('div', { class: 'sz-nav' },
        btn('Previous', () => { if (quiz.i > 0) { quiz.i--; draw(); } }, { cls: `quiet${quiz.i ? '' : ' invisible'}`, kbd: '←' }),
        h('div', { class: 'sa-spacer' }),
        h('span', { class: 'sa-hint' }, q.kind === 'short' ? 'Ctrl+Enter checks' : '1 to 9 pick'),
        checkBtn)));
    drawQuizSide();
  }
  function drawQuizSide() {
    side.replaceChildren(
      h('div', { class: 'sz-side-head' }, h('span', { class: 't-kicker' }, 'Questions'), h('span', { class: 'cnt' }, `${quiz.results.size} of ${quiz.order.length} answered`)),
      h('ol', { class: 'sz-deck' }, quiz.order.map((j, k) => {
        const r = quiz.results.get(j);
        return h('li', { class: k === quiz.i && !quiz.finished ? 'cur' : null },
          h('button', { type: 'button', onclick: () => { quiz.finished = false; quiz.i = k; draw(); } },
            h('span', { class: 'n' }, pad2(k + 1)), h('span', { class: 't' }, plain(qs[j].q)),
            r === undefined ? null : h('span', { class: `g ${r ? 'st-verified' : 'st-unverified'}` }, mini(r ? 'verified' : 'unverified'), h('span', { class: 'sr-only' }, r ? 'correct' : 'wrong'))));
      })));
  }
  function toggle(qi, oi, multi) {
    if (quiz.results.has(qi)) return;
    if (multi) {
      const sel = new Set(quiz.picks.get(qi) || []);
      sel.has(oi) ? sel.delete(oi) : sel.add(oi);
      quiz.picks.set(qi, [...sel]);
    } else quiz.picks.set(qi, [oi]);
    draw();
  }
  function check() {
    const qi = quiz.order[quiz.i];
    const q = qs[qi];
    const pick = quiz.picks.get(qi);
    if (pick == null) return;
    let res;
    if (q.kind === 'short' || !q.options?.length) res = gradeShort(pick, q.answer);
    else {
      const right = correctSet(q);
      const sel = new Set(pick);
      res = right.size === sel.size && [...right].every((i) => sel.has(i));
    }
    quiz.results.set(qi, res);
    draw();
    stage.querySelector('.sz-nav .primary')?.focus();
  }
  function next() {
    if (quiz.i < quiz.order.length - 1) quiz.i++;
    else quiz.finished = true;
    draw();
  }
  function drawQuizSummary() {
    const total = quiz.order.length;
    const got = quiz.order.filter((j) => quiz.results.get(j)).length;
    const missed = quiz.order.filter((j) => !quiz.results.get(j));
    stage.replaceChildren(h('div', { class: 'sz-summary' },
      strip(),
      h('div', { class: 'sz-score-big' }, h('span', { class: 'num' }, got), h('span', { class: 'of' }, `of ${total} correct`)),
      h('p', { class: 'sz-end' }, missed.length ? `${missed.length} to go over again.` : 'Every answer was right.'),
      h('ol', { class: 'sz-review' }, quiz.order.map((j, k) => h('li', null,
        h('button', { type: 'button', onclick: () => { quiz.finished = false; quiz.i = k; draw(); } },
          h('span', { class: `g ${quiz.results.get(j) ? 'st-verified' : 'st-unverified'}` }, mini(quiz.results.get(j) ? 'verified' : 'unverified', 14)),
          h('span', null, plain(qs[j].q).slice(0, 140)))))),
      h('div', { class: 'sa-row' },
        missed.length && missed.length < total ? btn(`Retry the ${missed.length} missed`, () => restartQuiz(missed), { cls: 'primary' }) : null,
        btn('Start over', () => restartQuiz(qs.map((_, i) => i))))));
    drawQuizSide();
  }
  function restartQuiz(order) {
    quiz.order = order;
    quiz.i = 0;
    quiz.finished = false;
    for (const j of order) { quiz.results.delete(j); quiz.picks.delete(j); }
    draw();
  }

  // ---------- flashcards ----------
  const deck = { order: qs.map((_, i) => i), i: 0, flipped: false, got: new Set(), again: new Set() };
  const allRated = () => deck.order.length && deck.order.every((j) => deck.got.has(j) || deck.again.has(j));
  function drawCards() {
    if (allRated()) return drawCardsSummary();
    const qi = deck.order[deck.i];
    const q = qs[qi];
    const N = deck.order.length;
    const rated = deck.order.filter((j) => deck.got.has(j) || deck.again.has(j)).length;
    const st = statusOfQ(q);
    const L = q.ref ? layerOf(q.ref, ctx) : null;
    const kick = `Card ${deck.i + 1} of ${N}`;
    const card = h('div', { role: 'button', tabindex: '0', class: `sz-flip neatline${deck.flipped ? ' flipped' : ''}`, 'aria-label': deck.flipped ? 'Answer side. Press Space to see the question.' : 'Question side. Press Space to see the answer.', onclick: (e) => { if (e.target.closest('.chip, .sa-ref, a')) return; flip(); } },
      relief(),
      h('div', { class: 'face front', 'aria-hidden': String(deck.flipped) },
        h('div', { class: 'fk' }, h('span', { class: 't-kicker' }, kick)),
        md(q.q, artifact, 'fq'),
        q.options?.length ? h('ul', { class: 'fopts' }, q.options.map((o, oi) => h('li', null, h('b', null, LETTERS[oi]), ' ', plain(o)))) : null,
        h('div', { class: 'hint' }, h('kbd', null, 'Space'), ' flip')),
      h('div', { class: 'face back', 'aria-hidden': String(!deck.flipped) },
        h('div', { class: 'fk' }, h('span', { class: 't-kicker' }, `${kick} · Answer`), h('div', { class: 'sa-spacer' }), st ? statusLine(st) : null),
        h('div', { class: 'fp' }, plain(q.q)),
        h('div', { class: 'fa' }, st ? h('span', { class: `fg st-${st}` }, mini(st, 14)) : null, md(answerText(q), artifact, 'fa-text')),
        q.explain ? md(q.explain, artifact, 'fe') : null,
        q.ref ? h('div', { class: 'fs' }, h('span', { class: 't-kicker' }, 'Source'), h('button', { type: 'button', class: 'fs-path', onclick: (e) => { e.stopPropagation(); ctx.openRef?.(q.ref); } }, swatch(L, true), midPath(String(q.ref).replace(/#L/, ':')))) : null));
    const segs = deck.order.map((j, k) => (deck.got.has(j) ? 'on' : deck.again.has(j) ? 'again' : k === deck.i ? 'cur' : ''));
    stage.replaceChildren(h('div', { class: 'sz-cards' },
      h('div', { class: 'sz-progress' }, h('span', { class: 'segbar fill', 'aria-hidden': 'true' }, segs.map((c) => h('i', { class: c || null }))), h('span', { class: 'cnt' }, `${deck.i + 1} of ${N} · ${N - rated} left`)),
      h('div', { class: 'sz-flip-wrap' }, card),
      h('div', { class: 'sz-nav' },
        btn(`Again ${deck.again.size}`, () => rate(false), { iconName: 'refresh', cls: 'again', kbd: '←', title: 'Again (Left)' }),
        btn('Flip', flip, { kbd: 'Space', title: 'Flip (Space)' }),
        btn(`Got it ${deck.got.size}`, () => rate(true), { iconName: 'check', cls: 'got primary', kbd: '→', title: 'Got it (Right)' }),
        h('span', { class: 'gap' }),
        btn('Shuffle', shuffle, { iconName: 'swap', kbd: 'S', title: 'Shuffle (S)' }))));
    drawCardsSide();
  }
  function drawCardsSide() {
    const q = qs[deck.order[deck.i]];
    const cites = q ? citesOf(q) : [];
    side.replaceChildren(...[
      cites.length ? h('div', { class: 'sz-side-head' }, h('span', { class: 't-kicker' }, 'Citations')) : null,
      cites.length ? h('div', { class: 'sz-cites' }, cites.map((c) => citeCard(c, ctx))) : null,
      h('div', { class: 'sz-side-head' }, h('span', { class: 't-kicker' }, 'Deck'), h('span', { class: 'cnt' }, `${deck.order.length} cards · ${deck.got.size + deck.again.size} done`)),
      h('ol', { class: 'sz-deck' }, deck.order.map((j, k) => h('li', { class: k === deck.i && !allRated() ? 'cur' : null },
        h('button', { type: 'button', onclick: () => { deck.i = k; deck.flipped = false; draw(); } },
          h('span', { class: 'n' }, pad2(k + 1)), h('span', { class: 't' }, plain(qs[j].q)),
          deck.got.has(j) ? h('span', { class: 'g ok' }, icon('check', 13), h('span', { class: 'sr-only' }, 'got it')) : deck.again.has(j) ? h('span', { class: 'g again' }, icon('refresh', 12), ' again') : null))))].filter(Boolean));
  }
  function flip() { deck.flipped = !deck.flipped; stage.querySelector('.sz-flip')?.classList.toggle('flipped', deck.flipped); stage.querySelectorAll('.sz-flip .face').forEach((f) => f.setAttribute('aria-hidden', String(f.classList.contains('front') ? deck.flipped : !deck.flipped))); }
  function go(d) { deck.i = (deck.i + d + deck.order.length) % deck.order.length; deck.flipped = false; draw(); }
  function rate(got) {
    const qi = deck.order[deck.i];
    (got ? deck.got : deck.again).add(qi);
    (got ? deck.again : deck.got).delete(qi);
    const nextI = deck.order.findIndex((j, k) => k > deck.i && !deck.got.has(j) && !deck.again.has(j));
    const anyI = deck.order.findIndex((j) => !deck.got.has(j) && !deck.again.has(j));
    deck.i = nextI >= 0 ? nextI : anyI >= 0 ? anyI : deck.i;
    deck.flipped = false;
    draw();
  }
  function shuffle() {
    const a = deck.order;
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    deck.i = 0; deck.flipped = false;
    draw();
  }
  function drawCardsSummary() {
    const total = deck.order.length;
    const againList = deck.order.filter((j) => deck.again.has(j));
    stage.replaceChildren(h('div', { class: 'sz-summary' },
      h('span', { class: 'segbar fill', 'aria-hidden': 'true' }, deck.order.map((j) => h('i', { class: deck.got.has(j) ? 'on' : 'again' }))),
      h('div', { class: 'sz-score-big' }, h('span', { class: 'num' }, deck.got.size), h('span', { class: 'of' }, `of ${total} got it`)),
      h('p', { class: 'sz-end' }, `${total} of ${total} done. ${deck.got.size} got it, ${againList.length} again.`),
      againList.length ? h('ol', { class: 'sz-review' }, againList.map((j) => h('li', null, h('span', { class: 'plain' }, h('span', { class: 'g again' }, icon('refresh', 12)), h('span', null, plain(qs[j].q).slice(0, 140)))))) : null,
      h('div', { class: 'sa-row' },
        againList.length ? btn(`Review the ${againList.length} again`, () => { deck.order = againList; deck.i = 0; deck.flipped = false; deck.again.clear(); deck.got.clear(); draw(); }, { cls: 'primary' }) : null,
        btn('Restart deck', () => { deck.order = qs.map((_, i) => i); deck.i = 0; deck.flipped = false; deck.got.clear(); deck.again.clear(); draw(); }))));
    drawCardsSide();
  }

  function draw() { modeSeg.set(mode); root.dataset.mode = mode; mode === 'cards' ? drawCards() : drawQuiz(); }
  draw();

  // keys act while focus is inside this view or on the page body
  const onKey = (e) => {
    if (!root.isConnected || !root.offsetParent) return;
    const a = document.activeElement;
    if (a && a !== document.body && !root.contains(a)) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (mode === 'cards') {
      if (allRated()) return;
      if (e.key === ' ' || e.key === 'Enter') { if (a?.closest?.('.sz-nav, .sz-side')) return; flip(); }
      else if (e.key === 'ArrowRight' || e.key === '2') rate(true);
      else if (e.key === 'ArrowLeft' || e.key === '1') rate(false);
      else if (e.key === 'ArrowDown') go(1);
      else if (e.key === 'ArrowUp') go(-1);
      else if (e.key === 's' || e.key === 'S') shuffle();
      else return;
      e.preventDefault();
      stage.querySelector('.sz-flip')?.focus({ preventScroll: true });
    } else if (!quiz.finished) {
      const qi = quiz.order[quiz.i];
      const q = qs[qi];
      const n = Number(e.key);
      if (n >= 1 && n <= (q.options?.length || 0)) toggle(qi, n - 1, q.kind === 'multi');
      else if (e.key === 'Enter' && !a?.closest?.('button')) { quiz.results.has(qi) ? next() : check(); }
      else if (e.key === 'ArrowRight' && quiz.results.has(qi)) next();
      else if (e.key === 'ArrowLeft' && quiz.i > 0) { quiz.i--; draw(); }
      else return;
      e.preventDefault();
    }
  };
  document.addEventListener('keydown', onKey);
  cleanup.push(() => document.removeEventListener('keydown', onKey));

  function exportEval() {
    const out = {
      name: bare(data.title || artifact.title || 'quiz'),
      source: { artifact: artifact.id, recipe: artifact.recipe, model: artifact.model, createdAt: artifact.createdAt },
      items: qs.map((q) => ({
        id: q.id, kind: q.kind, input: bare(q.q),
        options: q.options?.map(bare),
        expected: Array.isArray(q.answer) ? q.answer.map(bare) : bare(q.answer),
        explanation: q.explain ? bare(q.explain) : undefined,
        ref: q.ref || undefined,
        citations: (artifact.citations || []).filter((c) => [q.q, q.explain, ...(q.options || [])].some((t) => String(t || '').includes(`[^${c.n}]`))).map((c) => ({ path: c.path, line: c.line, endLine: c.endLine, quote: c.quote, status: c.status })),
      })),
    };
    download(JSON.stringify(out, null, 2) + '\n', slug(out.name) + '.eval.json', 'application/json');
  }

  return done;
}
