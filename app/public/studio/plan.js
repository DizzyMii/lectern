// Plan artifacts: phases as columns or a list, task cards, acceptance
// checklists persisted on the artifact, segment bars, Markdown and GitHub exports.
// Keys: J/K move between tasks, X ticks the next item, Enter expands, O opens, V switches view.

import { store } from '../ui/dom.js';
import {
  h, s, slug, download, copy, btn, iconButton, segmented, menuButton,
  citeHost, md, mdInline, stateView, emptyView, summaryBlock, refChip, markShapes, regenButton,
} from './common.js';

const plain = (t) => String(t ?? '').replace(/\s*\[\^\d+\]/g, '').replace(/\s+$/g, '');
// last two path segments, so chips stay short but still say where
const shortPath = (f) => { const parts = String(f).replace(/#.*$/, '').split('/'); return parts.slice(-2).join('/'); };

function segbar(states, fill = true) {
  return h('span', { class: `segbar${fill ? ' fill' : ''}`, 'aria-hidden': 'true' }, states.map((st) => h('i', { class: st || null })));
}

export function render(container, artifact, ctx = {}) {
  container.classList.add('artifact-canvas');
  const root = h('div', { class: 'sa sa-plan' });
  container.append(root);
  const cleanup = [];
  const done = { destroy() { cleanup.forEach((f) => f()); root.remove(); } };
  const data = artifact.data;
  const ok = data && Array.isArray(data.phases);
  if (artifact.status === 'invalid' || artifact.status === 'error' || (data && !ok)) {
    root.append(stateView(container, artifact, ctx, artifact.status === 'error' ? { message: artifact.error || 'The run ended with an error.' } : {}));
    return done;
  }
  const phases = (data?.phases || []).map((p, pi) => ({ ...p, name: p.name || `Phase ${pi + 1}`, tasks: (p.tasks || []).map((t, ti) => ({ ...t, id: String(t.id ?? `P${pi + 1}.${ti + 1}`) })) }));
  if (!phases.some((p) => p.tasks.length)) { root.append(emptyView('No tasks.', null, regenButton(container, artifact, ctx))); return done; }

  const tasks = new Map();
  phases.forEach((p) => p.tasks.forEach((t) => tasks.set(t.id, { t, phase: p })));
  const checks = { ...(artifact.checked || artifact.checks || {}) };
  const keysOf = (t) => (t.acceptance?.length ? t.acceptance.map((_, i) => `${t.id}#${i}`) : [`${t.id}#done`]);
  const isDone = (t) => keysOf(t).every((k) => checks[k]);
  const isStarted = (t) => keysOf(t).some((k) => checks[k]);
  const unmet = (t) => (t.dependsOn || []).map(String).filter((d) => tasks.has(d) && !isDone(tasks.get(d).t));
  const stateOf = (t) => (isDone(t) ? 'done' : unmet(t).length ? 'blocked' : isStarted(t) ? 'doing' : 'todo');
  const segOf = (t) => ({ done: 'on', doing: 'cur' })[stateOf(t)] || '';

  // ---------- persistence ----------
  let saveT = 0, dirty = false;
  const flush = async () => {
    clearTimeout(saveT);
    if (!dirty) return;
    dirty = false;
    const snapshot = { ...checks };
    artifact.checked = snapshot;
    // the server merges, so unticked keys go as false
    const all = Object.fromEntries([...tasks.values()].flatMap(({ t }) => keysOf(t)).map((k) => [k, Boolean(snapshot[k])]));
    try { await ctx.patchArtifact?.({ checked: all }); }
    catch (e) { ctx.toast?.('Could not save progress: ' + (e.message || e)); }
  };
  const save = () => { dirty = true; clearTimeout(saveT); saveT = setTimeout(flush, 350); };
  cleanup.push(flush);

  // ---------- header ----------
  // DESIGN 12.4: List under 1280 wide, Columns from 1280, unless the reader picked one
  // six or more phases do not fit as columns, so they start as a list
  let view = store.get('studio.planView', null) || ((window.innerWidth || 0) >= 1280 && phases.length < 6 ? 'columns' : 'list');
  const total = h('span', { class: 'sp-total' });
  const totalBar = h('span', { class: 'sp-totalbar' });
  const head = h('div', { class: 'sp-head' },
    data.goal ? h('div', { class: 'sp-goal' }, h('span', { class: 't-kicker' }, 'Goal'), md(data.goal, artifact, 'sp-goal-text')) : null,
    h('div', { class: 'sp-progress' }, totalBar, total));
  citeHost(head, artifact, ctx);
  const viewSeg = segmented([['list', 'List'], ['columns', 'Columns']], view, (v) => setView(v), 'Plan view');
  const toolbar = h('div', { class: 'sa-toolbar' },
    h('div', { class: 'sa-group' }, viewSeg, h('kbd', null, 'V')),
    h('div', { class: 'sa-meta' }, `${phases.length} phases · ${tasks.size} tasks`),
    h('div', { class: 'sa-spacer' }),
    btn('Reset', () => { for (const k of Object.keys(checks)) delete checks[k]; save(); drawBoard(); }, { cls: 'quiet', title: 'Clear all checkboxes' }),
    menuButton('Export', [
      { label: 'Markdown checklist', hint: 'copy', run: () => copy(checklist(), ctx, 'Checklist copied') },
      { label: 'Markdown checklist', hint: '.md', run: () => download(checklist(), slug(artifact.title || data.title) + '-checklist.md') },
      { label: 'GitHub issues', hint: 'bundle + script', run: () => openIssues() },
    ]));
  const board = h('div', { class: 'sp-board' });
  citeHost(board, artifact, ctx);
  const sheet = h('div', { class: 'sp-sheet', hidden: true });
  root.append(toolbar, head, board, sheet);
  const sum = summaryBlock(artifact);
  if (sum) { citeHost(sum, artifact, ctx); root.append(sum); }

  function setView(v) { view = v; viewSeg.set(v); store.set('studio.planView', v); drawBoard(); }

  function refreshProgress() {
    const all = [...tasks.values()].map((x) => x.t);
    const n = all.filter(isDone).length;
    totalBar.replaceChildren(segbar(all.map(segOf), false));
    total.textContent = `${n} of ${all.length} tasks`;
    board.querySelectorAll('[data-phase]').forEach((el) => {
      const p = phases[Number(el.dataset.phase)];
      el.querySelector('.sp-pbar')?.replaceChildren(segbar(p.tasks.map(segOf)));
      const c = el.querySelector('.sp-pcount');
      if (c) c.textContent = `${p.tasks.filter(isDone).length} of ${p.tasks.length} ${p.tasks.length === 1 ? 'task' : 'tasks'}`;
    });
    board.querySelectorAll('[data-task]').forEach((el) => {
      const t = tasks.get(el.dataset.task).t;
      const st = stateOf(t);
      el.classList.toggle('done', st === 'done');
      el.classList.toggle('doing', st === 'doing');
      el.classList.toggle('blocked', st === 'blocked');
      const word = el.querySelector('.sp-state');
      const um = unmet(t);
      if (word) word.textContent = st === 'done' ? 'done' : st === 'blocked' ? `blocked by ${um.join(', ')}` : st === 'doing' ? 'in progress' : 'todo';
      el.querySelectorAll('.sp-dep').forEach((d) => {
        const dep = tasks.get(d.dataset.dep);
        d.classList.toggle('met', Boolean(dep && isDone(dep.t)));
      });
      const bl = el.querySelector('.sp-blocked');
      if (bl) { bl.hidden = st !== 'blocked'; bl.textContent = `Blocked by ${um.join(', ')}`; }
    });
  }

  function flash(id) {
    const el = board.querySelector(`[data-task="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    el.focus({ preventScroll: true });
  }

  function taskCard(t) {
    const deps = (t.dependsOn || []).map(String);
    const accept = t.acceptance?.length ? t.acceptance : null;
    const checkbox = (key, label) => {
      const input = h('input', { type: 'checkbox', class: 'checkbox', checked: Boolean(checks[key]) });
      input.addEventListener('change', () => { if (input.checked) checks[key] = true; else delete checks[key]; save(); refreshProgress(); });
      return h('label', { class: 'sp-check' }, input, label != null ? h('span', { class: 'txt' }, label) : null);
    };
    const est = t.estimate ? String(t.estimate).toUpperCase() : '';
    const detail = t.detail ? md(t.detail, artifact, 'sp-detail') : null;
    const card = h('article', { class: 'sp-task', 'data-task': t.id, tabindex: '0', 'aria-label': `${t.id}: ${plain(t.title)}` },
      h('div', { class: 'sp-task-top' },
        accept ? null : checkbox(`${t.id}#done`, null),
        h('span', { class: 'sp-done-mark', 'aria-hidden': 'true' }, s('svg', { class: 'sa-glyph st-verified', viewBox: '0 0 16 16', width: 12, height: 12 }, markShapes('verified'))),
        h('span', { class: 'sp-id' }, t.id),
        h('span', { class: 'sp-dot' }, '·'),
        h('span', { class: 'sp-state' }),
        h('div', { class: 'sa-spacer' }),
        est ? h('span', { class: 'sp-est', title: { S: 'Small', M: 'Medium', L: 'Large' }[est] || 'Estimate' }, `size ${est}`) : null),
      h('h4', null, mdInline(t.title || t.id, artifact)),
      detail,
      t.files?.length ? h('div', { class: 'sp-files' }, t.files.map((f) => h('button', { type: 'button', class: 'sp-file', title: `Open ${f}`, onclick: () => ctx.openRef?.(f) }, ...midParts(shortPath(f))))) : null,
      deps.length ? h('div', { class: 'sp-deps' }, deps.map((d) => h('button', { type: 'button', class: 'sp-dep', 'data-dep': d, title: tasks.has(d) ? `Go to ${d}: ${plain(tasks.get(d).t.title)}` : `${d} is not in this plan`, onclick: () => flash(d) }, `after ${d}`))) : null,
      h('div', { class: 'sp-blocked', hidden: true }),
      accept ? h('div', { class: 'sp-accept', role: 'group', 'aria-label': `Acceptance for ${t.id}` }, accept.map((a, i) => checkbox(`${t.id}#${i}`, mdInline(a, artifact)))) : null,
      t.ref ? h('div', { class: 'sa-row' }, refChip(t.ref, ctx, artifact)) : null);
    if (detail) detail.addEventListener('click', (e) => { if (!e.target.closest('a, .chip')) card.classList.toggle('open'); });
    return card;
  }

  // a file chip loses the middle of its path, never the file name
  function midParts(p) {
    const i = p.lastIndexOf('/');
    return [h('span', { class: 'dir' }, i >= 0 ? p.slice(0, i + 1) : ''), h('span', { class: 'file' }, p.slice(i + 1))];
  }

  function drawBoard() {
    board.className = `sp-board ${view}`;
    board.style.setProperty('--phases', phases.length);
    board.replaceChildren(...phases.map((p, pi) => h('section', { class: 'sp-phase', 'data-phase': pi, 'aria-label': p.name },
      h('header', null,
        h('div', { class: 'sp-phead' }, h('span', { class: 't-kicker' }, `Phase ${pi + 1}`), h('span', { class: 'sp-pcount' })),
        h('h3', null, p.name),
        h('div', { class: 'sp-pbar' })),
      h('div', { class: 'sp-tasks' }, p.tasks.length ? p.tasks.map(taskCard) : h('p', { class: 'sa-muted' }, 'No tasks in this phase.')))));
    refreshProgress();
    requestAnimationFrame(edgeCue);
  }
  // columns that run past the right edge fade out there, a cue to scroll sideways
  const edgeCue = () => board.classList.toggle('more-right', board.classList.contains('columns') && board.scrollLeft + board.clientWidth < board.scrollWidth - 2);
  board.addEventListener('scroll', edgeCue, { passive: true });
  window.addEventListener('resize', edgeCue);
  cleanup.push(() => window.removeEventListener('resize', edgeCue));
  drawBoard();

  // ---------- keys ----------
  root.addEventListener('keydown', (e) => {
    if (e.target.closest('input[type="text"], textarea, .sp-sheet') || e.ctrlKey || e.metaKey || e.altKey) return;
    const cards = [...board.querySelectorAll('.sp-task')];
    const curCard = e.target.closest?.('.sp-task');
    const i = cards.indexOf(curCard);
    const k = e.key.toLowerCase();
    if (k === 'j') cards[Math.min(cards.length - 1, i + 1)]?.focus();
    else if (k === 'k') cards[Math.max(0, i - 1)]?.focus();
    else if (k === 'v') setView(view === 'list' ? 'columns' : 'list');
    else if (k === 'x' && curCard) { const box = curCard.querySelector('.sp-check input:not(:checked)'); box?.click(); }
    else if (k === 'enter' && e.target === curCard) curCard.classList.toggle('open');
    else if (k === 'o' && curCard) { const t = tasks.get(curCard.dataset.task).t; const r = t.ref || t.files?.[0]; if (r) ctx.openRef?.(r); }
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  // ---------- exports ----------
  function checklist() {
    const out = [`# ${plain(data.title || artifact.title || 'Plan')}`, ''];
    if (data.goal) out.push(`**Goal:** ${plain(data.goal)}`, '');
    phases.forEach((p, pi) => {
      out.push(`## Phase ${pi + 1}: ${plain(p.name)}`, '');
      for (const t of p.tasks) {
        out.push(`- [${isDone(t) ? 'x' : ' '}] **${t.id}** ${plain(t.title)}${t.estimate ? ` (${t.estimate})` : ''}`);
        if (t.files?.length) out.push(`  - Files: ${t.files.map((f) => '`' + f + '`').join(', ')}`);
        if (t.dependsOn?.length) out.push(`  - After: ${t.dependsOn.join(', ')}`);
        (t.acceptance || []).forEach((a, i) => out.push(`  - [${checks[`${t.id}#${i}`] ? 'x' : ' '}] ${plain(a)}`));
      }
      out.push('');
    });
    return out.join('\n');
  }
  function issueBody(t, p) {
    const out = [`**Phase:** ${plain(p.name)}${t.estimate ? ` · **Estimate:** ${t.estimate}` : ''}`, ''];
    if (t.detail) out.push(plain(t.detail), '');
    if (t.files?.length) out.push('### Files', ...t.files.map((f) => `- \`${f}\``), '');
    if (t.dependsOn?.length) out.push('### Depends on', ...t.dependsOn.map((d) => `- ${d}${tasks.has(String(d)) ? ': ' + plain(tasks.get(String(d)).t.title) : ''}`), '');
    if (t.acceptance?.length) out.push('### Acceptance', ...t.acceptance.map((a) => `- [ ] ${plain(a)}`), '');
    if (t.ref) out.push(`Source: \`${t.ref}\``, '');
    return out.join('\n');
  }
  function issuesMarkdown() {
    const out = [`# ${plain(data.title || artifact.title || 'Plan')}: issues`, ''];
    for (const p of phases) for (const t of p.tasks) out.push(`<!-- issue ${t.id} -->`, `## ${t.id}: ${plain(t.title)}`, '', issueBody(t, p), '---', '');
    return out.join('\n');
  }
  function issuesScript() {
    const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
    const out = ['#!/usr/bin/env bash', '# Creates one GitHub issue per task with the gh CLI. Read it before running it.', 'set -euo pipefail', ''];
    const labels = [...new Set(phases.map((p) => `phase: ${plain(p.name)}`.slice(0, 50)))];
    for (const l of labels) out.push(`gh label create ${q(l)} --color C8F0DC --force >/dev/null`);
    out.push('');
    let n = 0;
    for (const p of phases) for (const t of p.tasks) {
      const tag = `NB_ISSUE_${++n}`;
      out.push(`gh issue create --title ${q(`${t.id}: ${plain(t.title)}`)} --label ${q(`phase: ${plain(p.name)}`.slice(0, 50))} --body-file - <<'${tag}'`, issueBody(t, p), tag, '');
    }
    return out.join('\n');
  }
  function openIssues() {
    const tabs = { md: ['issues.md', issuesMarkdown()], sh: ['create-issues.sh', issuesScript()] };
    let cur = 'md';
    const pre = h('pre', { class: 'sp-sheet-pre' });
    const drawTab = () => { pre.textContent = tabs[cur][1]; };
    sheet.replaceChildren(h('div', { class: 'sp-sheet-card neatline', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'GitHub issues export' },
      h('div', { class: 'sp-sheet-head' },
        h('h3', null, 'GitHub issues'),
        segmented([['md', 'Issue bundle'], ['sh', 'gh script']], cur, (v) => { cur = v; drawTab(); }, 'Export file'),
        h('div', { class: 'sa-spacer' }),
        iconButton('x', 'Close', () => { sheet.hidden = true; })),
      h('p', { class: 'sa-muted' }, 'The script is text for you to read and run yourself. Nothing here runs it.'),
      pre,
      h('div', { class: 'sa-row sp-sheet-acts' },
        h('div', { class: 'sa-spacer' }),
        btn('Download', () => download(tabs[cur][1], tabs[cur][0])),
        btn('Copy', () => copy(tabs[cur][1], ctx, 'Copied ' + tabs[cur][0]), { cls: 'primary' }))));
    drawTab();
    sheet.hidden = false;
    sheet.querySelector('button')?.focus();
  }
  sheet.addEventListener('keydown', (e) => { if (e.key === 'Escape') { sheet.hidden = true; e.stopPropagation(); } });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.hidden = true; });

  return done;
}
