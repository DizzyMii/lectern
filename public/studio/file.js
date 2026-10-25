// File artifacts (CLAUDE.md, AGENTS.md, SKILL.md and code): Preview, Source and
// Edit tabs, and a write bar pinned at the bottom with Write, Copy and Download.

import { highlightLines, langFor, renderMarkdown } from '../ui/markdown.js';
import {
  h, icon, download, copy, btn, segmented, citeHost, md, stateView, emptyView, summaryBlock, glyph, regenButton,
} from './common.js';

const MAX_HL_LINES = 6000;

function rootName(inputs) {
  const r = inputs?.root;
  if (!r) return '';
  if (typeof r === 'string') return r;
  return r.root || r.name || '';
}

// SKILL.md needs a name and a description in its frontmatter
function frontmatterIssue(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return 'Missing frontmatter';
  const has = (k) => new RegExp(`^${k}\\s*:\\s*\\S`, 'm').test(m[1]);
  if (!has('name')) return 'Missing name';
  if (!has('description')) return 'Missing description';
  return null;
}

const hhmm = () => new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

export function render(container, artifact, ctx = {}) {
  container.classList.add('artifact-canvas');
  const root = h('div', { class: 'sa sa-file' });
  container.append(root);
  const cleanup = [];
  const done = { destroy() { cleanup.forEach((f) => f()); root.remove(); } };
  const data = artifact.data;
  const ok = data && typeof data.content === 'string';
  if (artifact.status === 'invalid' || artifact.status === 'error' || (data && !ok)) {
    root.append(stateView(container, artifact, ctx, artifact.status === 'error' ? { message: artifact.error || 'The run ended with an error.' } : {}));
    return done;
  }
  if (!ok) { root.append(emptyView('This file is empty.', null, regenButton(container, artifact, ctx))); return done; }

  const filename = String(data.filename || 'untitled.txt');
  const base = filename.split('/').pop();
  const isMd = /\.(md|mdx|markdown)$/i.test(filename) || /^markdown$/i.test(data.language || '');
  const isSkill = /^skill\.md$/i.test(base);
  let content = data.content;
  let saved = content;
  let mode = isMd ? 'preview' : 'code';

  const linesInfo = h('span', { class: 'sa-meta' });
  const dirty = h('span', { class: 'sf-dirty', hidden: true }, 'Edited');
  const saveBtn = btn('Save edits', () => saveEdits(), { cls: 'small', kbd: 'Ctrl S' });
  saveBtn.hidden = true;
  const tabs = isMd ? [['preview', 'Preview'], ['code', 'Source'], ['edit', 'Edit']] : [['code', 'Preview'], ['edit', 'Edit']];
  const seg = segmented(tabs, mode, (v) => { leaveEdit(); mode = v; drawBody(); }, 'View');
  const fm = isSkill ? h('div', { class: 'sf-fm' }) : null;
  const toolbar = h('div', { class: 'sa-toolbar' },
    h('div', { class: 'sf-name' }, icon('file', 14), h('bdi', null, filename)),
    data.language ? h('span', { class: 'sf-lang' }, data.language) : null,
    linesInfo, dirty, saveBtn,
    h('div', { class: 'sa-spacer' }),
    seg);

  // ---------- write bar ----------
  const rn = rootName(artifact.inputs);
  const defaultPath = data.path || artifact.inputs?.path || (rn ? `${rn}/${filename}` : filename);
  const pathInput = h('input', { class: 'sa-input mono', value: defaultPath, 'aria-label': 'Target path', spellcheck: 'false' });
  const status = h('div', { class: 'sf-status', role: 'status', 'aria-live': 'polite' });
  const writeBtn = btn('Write to file', () => write(false), { cls: 'primary' });
  const writeBox = h('form', { class: 'sf-write', onsubmit: (e) => { e.preventDefault(); write(false); } },
    h('label', { class: 'sf-path' }, h('span', { class: 't-kicker' }, 'Write to'), pathInput),
    writeBtn,
    btn('Copy', () => copy(content, ctx, `Copied ${base}`), { iconName: 'copy' }),
    btn('Download', () => download(content, base), { iconName: 'download' }));
  const writeWrap = h('div', { class: 'sf-writebar' }, writeBox, status);

  async function send(path, overwrite) {
    if (typeof ctx.writeFile === 'function') return ctx.writeFile(path, { overwrite, content });
    const nb = ctx.notebookId ?? ctx.nbId ?? artifact.notebook;
    if (!ctx.api?.post || !nb || !artifact.id) throw new Error('Writing files is not available here');
    return ctx.api.post(`/api/notebooks/${encodeURIComponent(nb)}/artifacts/${encodeURIComponent(artifact.id)}/write`, { path, overwrite, content });
  }
  const setStatus = (cls, ...kids) => { status.className = `sf-status ${cls}`; status.replaceChildren(...kids.filter(Boolean)); };
  async function write(overwrite) {
    const path = pathInput.value.trim();
    if (!path) { pathInput.focus(); return; }
    if (content !== saved) await saveEdits();
    writeBtn.disabled = true;
    setStatus('', h('span', null, 'Writing ', h('code', null, path)));
    try {
      const res = await send(path, overwrite);
      const abs = res?.path || res?.absolute || res?.file || path;
      setStatus('ok', glyph('verified', 14), h('span', null, `Written ${hhmm()} · `, h('code', null, abs)));
      writeBtn.querySelector('span').textContent = 'Write to file';
      ctx.toast?.(`Wrote ${abs}`, 'ok');
    } catch (e) {
      const exists = e.status === 409 || /exist|overwrite/i.test(e.message || '');
      const refused = e.status === 403 || /outside|root|not allowed|refus/i.test(e.message || '');
      if (exists && !overwrite) {
        writeBtn.querySelector('span').textContent = 'Overwrite…';
        // the server's resolved absolute path, so it is clear which file would be replaced
        setStatus('warn', glyph('moved', 14), h('span', null, h('code', null, e.body?.path || path), ' already exists. Replace it?'),
          btn('Overwrite', () => write(true), { cls: 'danger small' }),
          btn('Keep it', () => { status.replaceChildren(); status.className = 'sf-status'; writeBtn.querySelector('span').textContent = 'Write to file'; }, { cls: 'quiet small' }));
        status.querySelector('.danger')?.focus();
      } else if (refused) {
        const dir = path.replace(/[\\/][^\\/]*$/, '') || path;
        setStatus('bad', glyph('unverified', 14), h('span', null, e.message && /root/i.test(e.message) ? e.message : `Lectern only writes inside a notebook root. ${dir} is not one.`));
      } else setStatus('bad', glyph('unverified', 14), h('span', null, e.message || 'Write failed'));
    } finally { writeBtn.disabled = false; }
  }

  // ---------- body ----------
  const body = h('div', { class: 'sf-body' });
  citeHost(body, artifact, ctx);
  let ta = null;
  function drawBody() {
    seg.set(mode);
    const n = content.split('\n').length;
    linesInfo.textContent = `${n} ${n === 1 ? 'line' : 'lines'} · ${(new Blob([content]).size / 1024).toFixed(1)} KB`;
    if (fm) {
      const issue = frontmatterIssue(content);
      fm.className = `sf-fm ${issue ? 'st-unverified' : 'st-verified'}`;
      fm.replaceChildren(glyph(issue ? 'unverified' : 'verified', 14), h('span', null, issue || 'Frontmatter valid'));
    }
    if (mode === 'edit') {
      const gutter = h('pre', { class: 'sf-gutter', 'aria-hidden': 'true' });
      ta = h('textarea', { class: 'sf-edit', spellcheck: 'false', wrap: 'off', 'aria-label': `Edit ${filename}` });
      ta.value = content;
      const numbers = () => { gutter.textContent = Array.from({ length: ta.value.split('\n').length }, (_, i) => i + 1).join('\n'); };
      numbers();
      ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });
      ta.addEventListener('input', () => { content = ta.value; numbers(); markDirty(); });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); content = ta.value; markDirty(); }
        if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdits(); }
      });
      body.replaceChildren(h('div', { class: 'sf-editor' }, gutter, ta));
      ta.focus();
      return;
    }
    ta = null;
    if (mode === 'preview') { body.replaceChildren(h('div', { class: 'sf-preview sa-prose', html: renderMarkdown(content) })); return; }
    const lang = langFor(data.language, filename) || (isMd ? 'markdown' : null);
    const raw = content.split('\n');
    const lines = raw.length <= MAX_HL_LINES ? highlightLines(content, lang) : raw.map((l) => l.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]));
    // prose files wrap so long lines read without a sideways scroll; code keeps its columns
    const pre = h('pre', { class: `sf-code hljs${isMd ? ' wrap' : ''}`, tabindex: '0', 'aria-label': `${filename} source` });
    pre.innerHTML = lines.map((l, i) => `<span class="ln" data-n="${i + 1}"></span><span class="lc">${l || ' '}</span>\n`).join('');
    body.replaceChildren(pre);
  }
  function markDirty() { const d = content !== saved; dirty.hidden = !d; saveBtn.hidden = !d; }
  function leaveEdit() { if (ta) content = ta.value; }
  async function saveEdits() {
    if (content === saved) return;
    try {
      await ctx.patchArtifact?.({ content });
      saved = content;
      data.content = content;
      markDirty();
      ctx.toast?.('Saved edits to the artifact', 'ok');
    } catch (e) { ctx.toast?.('Could not save edits: ' + (e.message || e)); }
  }

  // notes sit under the file, folded, so the preview is what you see first
  const notes = data.notes ? h('details', { class: 'sa-summary sf-notes' }, h('summary', null, h('span', { class: 't-kicker' }, 'Notes and sources')), md(data.notes, artifact)) : null;
  if (notes) citeHost(notes, artifact, ctx);
  root.append(...[toolbar, fm, body, notes].filter(Boolean));
  const sum = summaryBlock(artifact);
  if (sum) { citeHost(sum, artifact, ctx); root.append(sum); }
  root.append(writeWrap);
  drawBody();
  return done;
}
