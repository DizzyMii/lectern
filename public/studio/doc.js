// Doc artifacts: sticky contents on the left, the prose column, and the
// citations as exhibit cards in the right margin. Each H2 carries its own receipt.

import { h, icon, copy, citeHost, stateView, emptyView, regenButton, citeCard, normStatus, STATUS_WORD, glyph } from './common.js';
import { renderAnswer } from '../ui/markdown.js';

const slugify = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
const ORDER = ['verified', 'moved', 'unverified', 'pending'];

// heading text without its chips or receipt
function headText(hd) {
  const c = hd.cloneNode(true);
  c.querySelectorAll('.chip, .chip-wrap, .sd-rcpt').forEach((x) => x.remove());
  return c.textContent.trim();
}

export function render(container, artifact, ctx = {}) {
  container.classList.add('artifact-canvas');
  const root = h('div', { class: 'sa sa-doc' });
  container.append(root);
  const cleanup = [];
  const done = { destroy() { cleanup.forEach((f) => f()); root.remove(); } };
  if (artifact.status === 'invalid' || artifact.status === 'error') {
    root.append(stateView(container, artifact, ctx, artifact.status === 'error' ? { message: artifact.error || 'The run ended with an error.' } : { raw: artifact.raw ?? artifact.markdown }));
    return done;
  }
  const text = artifact.markdown ?? artifact.data?.markdown ?? '';
  if (!String(text).trim()) {
    root.append(emptyView('This doc has no sections.', null, regenButton(container, artifact, ctx)));
    return done;
  }

  const { html } = renderAnswer(text, artifact.citations || []);
  const article = h('article', { class: 'sa-prose sd-article', html });
  // the sheet header already shows the title, so a matching leading h1 would say it twice
  const lead = article.firstElementChild;
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (lead?.tagName === 'H1' && (norm(lead.textContent) === norm(artifact.title) || article.querySelectorAll('h1').length === 1)) lead.remove();
  citeHost(article, artifact, ctx);

  // tables scroll on their own; code blocks get a copy button; "> **Note**" quotes become callouts
  article.querySelectorAll('table').forEach((t) => { const w = h('div', { class: 'sa-table' }); t.replaceWith(w); w.append(t); });
  article.querySelectorAll('pre').forEach((pre) => {
    const b = h('button', { type: 'button', class: 'sd-copy icon-btn', 'aria-label': 'Copy code', title: 'Copy code', onclick: () => copy(pre.querySelector('code')?.textContent ?? pre.textContent, ctx, 'Code copied') }, icon('copy', 13));
    pre.classList.add('sd-pre');
    pre.append(b);
  });
  article.querySelectorAll('blockquote').forEach((q) => { if (/^\s*(note|tip|warning|important|caution)\b/i.test(q.querySelector('strong, b')?.textContent || '')) q.classList.add('sd-callout'); });

  const heads = [...article.querySelectorAll('h1, h2, h3')];
  const used = new Set();
  for (const hd of heads) {
    let id = 'sd-' + slugify(headText(hd));
    for (let i = 2; used.has(id); i++) id = `sd-${slugify(headText(hd))}-${i}`;
    used.add(id);
    hd.id = id;
  }

  // per-section receipt: count the chips between this H2 and the next
  for (const hd of article.querySelectorAll('h2')) {
    const counts = {};
    for (let el = hd.nextElementSibling; el && el.tagName !== 'H2'; el = el.nextElementSibling) {
      for (const c of el.querySelectorAll('.chip')) {
        const st = normStatus(ORDER.find((k) => c.classList.contains(k)) || (c.classList.contains('missing') ? 'unverified' : null));
        if (st) counts[st] = (counts[st] || 0) + 1;
      }
    }
    const parts = ORDER.filter((k) => counts[k]).map((k) => `${counts[k]} ${STATUS_WORD[k]}`);
    if (parts.length) hd.append(h('span', { class: 'sd-rcpt', 'aria-label': `Section citations: ${parts.join(', ')}` }, parts.join(' · ')));
  }

  // a single leading h1 duplicates the sheet header, so it stays out of the contents
  const tocHeads = heads.filter((hd, i) => article.contains(hd) && !(hd.tagName === 'H1' && i === 0 && heads.filter((x) => x.tagName === 'H1').length === 1));
  const many = tocHeads.length > 40;
  let toc = null;
  const links = new Map();
  if (tocHeads.length >= 2) {
    const minLevel = Math.min(...tocHeads.map((hd) => +hd.tagName[1]));
    toc = h('nav', { class: 'sd-toc', 'aria-label': 'Contents' },
      h('div', { class: 't-kicker' }, 'Contents'),
      h('ol', null, tocHeads.filter((hd) => !many || +hd.tagName[1] === minLevel).map((hd) => {
        // jumps are instant: programmatic smooth scrolling is never used
        const a = h('a', { href: '#' + hd.id, class: `lv${+hd.tagName[1] - minLevel}`, onclick: (e) => { e.preventDefault(); hd.scrollIntoView({ block: 'start' }); setActive(hd.id); } }, headText(hd));
        links.set(hd.id, a);
        return h('li', null, a);
      })));
  }

  const words = article.textContent.trim().split(/\s+/).length;
  const cites = artifact.citations || [];
  const verified = cites.filter((c) => c.status === 'verified').length;
  const meta = h('div', { class: 'sd-meta' },
    h('span', null, `${Math.max(1, Math.round(words / 230))} min read`),
    cites.length ? h('span', null, `${verified} of ${cites.length} citations verified`) : h('span', null, 'No citations. Treat it as a sketch.'));
  const margin = cites.length ? h('aside', { class: 'sd-margin', 'aria-label': 'Citations' },
    h('div', { class: 'sd-margin-head' }, h('span', { class: 't-kicker' }, 'Citations'), h('span', { class: 'cnt' }, String(cites.length))),
    h('div', { class: 'sd-cites' }, cites.map((c) => citeCard(c, ctx)))) : null;
  if (margin) citeHost(margin, artifact, ctx);
  root.append(h('div', { class: `sd-layout${toc ? '' : ' no-toc'}${margin ? '' : ' no-margin'}` }, toc || h('div'), h('div', { class: 'sd-main' }, meta, article), margin));

  // gutter marks (DESIGN 11.6): one benchmark per cited line, in the gap left of the column
  const gutter = h('div', { class: 'sd-gutter', 'aria-hidden': 'true' });
  article.prepend(gutter);
  const placeMarks = () => {
    if (!article.isConnected) return;
    const base = article.getBoundingClientRect().top;
    const rows = new Map();
    for (const chip of article.querySelectorAll('.chip')) {
      if (chip.closest('pre, .sd-gutter')) continue;
      const r = chip.getClientRects()[0];
      if (!r) continue;
      const top = Math.round(r.top + r.height / 2 - 8 - base);
      const c = cites.find((x) => String(x.n) === chip.dataset.n);
      const st = normStatus(c?.status) || (chip.classList.contains('pending') ? 'pending' : 'unverified');
      if (!rows.has(top)) rows.set(top, []);
      rows.get(top).push({ st, c });
    }
    gutter.replaceChildren();
    // marks on one line sit side by side, ending 10px left of the column
    for (const [top, row] of rows) {
      let right = 10;
      for (const { st, c } of row.slice(0, 2)) {
        const m = h('span', { class: `sd-gm st-${st}`, style: { top: top + 'px', right: right + 'px' } }, glyph(st, 16));
        const moved = st === 'moved' && c?.line;
        if (moved) m.append(h('span', { class: 'gm-line' }, 'L' + c.line));
        right += moved ? 42 : 18;
        gutter.append(m);
      }
    }
  };
  const ro = new ResizeObserver(() => placeMarks());
  ro.observe(article);
  cleanup.push(() => ro.disconnect());
  requestAnimationFrame(placeMarks);
  document.fonts?.ready.then(placeMarks);

  function setActive(id) {
    for (const [k, a] of links) a.classList.toggle('on', k === id);
  }
  if (toc && 'IntersectionObserver' in window) {
    const visible = new Set();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) e.isIntersecting ? visible.add(e.target) : visible.delete(e.target);
      const first = tocHeads.find((hd) => visible.has(hd));
      if (first && links.has(first.id)) setActive(first.id);
    }, { rootMargin: '0px 0px -65% 0px' });
    tocHeads.forEach((hd) => io.observe(hd));
    cleanup.push(() => io.disconnect());
    setActive(tocHeads[0].id);
  }
  return done;
}
