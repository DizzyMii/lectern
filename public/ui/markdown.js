// Markdown, sanitising, syntax highlighting and citation chips.

import { Marked } from '/vendor/marked/lib/marked.esm.js';
import DOMPurify from '/vendor/dompurify/dist/purify.es.mjs';
import java from '/vendor/highlight.js/es/languages/java.js';
import json from '/vendor/highlight.js/es/languages/json.js';
import javascript from '/vendor/highlight.js/es/languages/javascript.js';
import xml from '/vendor/highlight.js/es/languages/xml.js';
import bash from '/vendor/highlight.js/es/languages/bash.js';
import markdown from '/vendor/highlight.js/es/languages/markdown.js';
import properties from '/vendor/highlight.js/es/languages/properties.js';
import ini from '/vendor/highlight.js/es/languages/ini.js';
import { esc } from './dom.js';
import { sourceFor, statusOf } from './layers.js';

// highlight.js ships es/core.js as a wrapper around the CommonJS lib/core.js, which a
// browser cannot import. lib/core.js has no requires, so evaluate it with a module shim.
async function loadHljs() {
  const src = await (await fetch('/vendor/highlight.js/lib/core.js')).text();
  const module = { exports: {} };
  new Function('module', 'exports', src)(module, module.exports);
  return module.exports;
}
const hljs = await loadHljs();

for (const [n, l] of Object.entries({ java, json, javascript, xml, bash, markdown, properties, ini })) hljs.registerLanguage(n, l);

const ALIAS = {
  java: 'java', kt: 'java', kotlin: 'java', groovy: 'java', gradle: 'java',
  json: 'json', json5: 'json', mcmeta: 'json', jsonc: 'json',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'javascript', javascript: 'javascript', typescript: 'javascript', jsx: 'javascript', tsx: 'javascript',
  xml: 'xml', html: 'xml', svg: 'xml',
  sh: 'bash', bash: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
  md: 'markdown', mdx: 'markdown', markdown: 'markdown',
  properties: 'properties', cfg: 'properties', lang: 'properties',
  toml: 'ini', ini: 'ini',
};

export function langFor(lang, path = '') {
  const l = String(lang || '').toLowerCase();
  if (ALIAS[l]) return ALIAS[l];
  const ext = String(path).split('.').pop().toLowerCase();
  return ALIAS[ext] || null;
}

export function highlight(code, lang) {
  const l = langFor(lang);
  if (l && code.length < 400_000) {
    try { return hljs.highlight(code, { language: l, ignoreIllegals: true }).value; } catch {}
  }
  return esc(code);
}

// Highlight a whole file, then split into per-line HTML with spans reopened.
export function highlightLines(text, lang) {
  const html = highlight(text, lang);
  const lines = [];
  const stack = [];
  let cur = '';
  const re = /<span[^>]*>|<\/span>|\n/g;
  let last = 0, m;
  while ((m = re.exec(html))) {
    cur += html.slice(last, m.index);
    last = re.lastIndex;
    if (m[0] === '\n') {
      lines.push(cur + '</span>'.repeat(stack.length));
      cur = stack.join('');
    } else if (m[0] === '</span>') { stack.pop(); cur += m[0]; }
    else { stack.push(m[0]); cur += m[0]; }
  }
  cur += html.slice(last);
  lines.push(cur);
  return lines;
}

const L = '⟦', R = '⟧';
const MARKER = /⟦p?\d+⟧/g;

const md = new Marked({
  gfm: true,
  breaks: false,
  // chip markers never belong inside code or link attributes
  walkTokens(t) {
    if ((t.type === 'codespan' || t.type === 'code') && t.text) t.text = t.text.replace(MARKER, '');
    if (t.type === 'link' || t.type === 'image') {
      if (t.href) t.href = t.href.replace(MARKER, '');
      if (t.title) t.title = t.title.replace(MARKER, '');
    }
  },
  renderer: {
    // a header with the language and a Copy button, and one span per line for the numbers
    code({ text, lang }) {
      // "ts orders.ts", "ts title=orders.ts" or just "orders.ts" name the file
      const words = String(lang || '').split(/\s+/).filter(Boolean);
      const named = words.map((w) => w.replace(/^(title|file|filename)=/, '').replace(/^["']|["']$/g, '')).find((w) => /^[\w./-]+\.[A-Za-z0-9]{1,8}$/.test(w));
      let raw = words[0] || '';
      if (named && raw.replace(/^(title|file|filename)=/, '').replace(/^["']|["']$/g, '') === named) raw = named.split('.').pop();
      const l = langFor(raw);
      const lines = highlightLines(text.replace(/\n$/, ''), l).map((x) => `<span class="cl">${x || ' '}</span>`).join('\n');
      return `<div class="codeblock"><div class="code-head">${named ? `<span class="code-file">${esc(named.split('/').pop())}</span><span class="code-lang">· sketch</span>` : `<span class="code-lang">${esc(raw)}</span>`}<button type="button" class="copy-code">Copy</button></div>`
        + `<pre><code class="hljs${l ? ' language-' + l : ''}">${lines}</code></pre></div>\n`;
    },
  },
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    const href = node.getAttribute('href');
    if (/^https?:/i.test(href)) { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
  }
  // model text must not phone home: only same-origin and inline images load
  if (node.tagName === 'IMG') {
    const s = node.getAttribute('src') || '';
    if (!/^(\/(?!\/)|data:image\/)/i.test(s)) node.removeAttribute('src');
  }
});

// No styles or forms from model or source text: they could restyle the app or overlay a fake UI.
// Buttons stay because citation chips are buttons.
const clean = (html) => DOMPurify.sanitize(html, {
  USE_PROFILES: { html: true }, ADD_ATTR: ['data-n', 'data-layer', 'data-dense'],
  FORBID_TAGS: ['style', 'form', 'input', 'textarea', 'select', 'option'], FORBID_ATTR: ['style'],
});

const CHIP_PUNCT = /((?:<button type="button" class="chip [^"]*"[^>]*>\d+<\/button>)+)([.,;:!?)\]]+)/g;

// Same grammar and dedupe key as cite.mjs on the server, so pending numbers match the final ones.
const CITE_RE = /\[\[([^\[\]\n|#]+?)(?:#L(\d+)(?:-L?(\d+))?)?(?:\s*\|\s*(?:"([^"\n]*)"|“([^”\n]*)”|'([^'\n]*)'))?\s*\]\]/g;

function citeFrom(m) {
  const quote = m[4] ?? m[5] ?? m[6] ?? null;
  return {
    path: m[1].trim().replace(/^`|`$/g, ''),
    line: m[2] ? +m[2] : null,
    endLine: m[3] ? +m[3] : m[2] ? +m[2] : null,
    quote: quote && quote.trim() ? quote.trim() : null,
  };
}
const citeKey = (c) => `${c.path}#${c.line}-${c.endLine}|${c.quote}`;

export function parseRawCites(text) {
  return [...String(text || '').matchAll(CITE_RE)].map((m) => ({ raw: m[0], ...citeFrom(m) }));
}

// Notes keep citations as a footnote list: "[^1]: path:12-20 "quote" (verified)" or "path#L12-L20".
const FOOTNOTE_RE = /^\[\^(\d+)\]:[ \t]*(\S+?)(?::(\d+)(?:-(\d+))?|#L(\d+)(?:-L(\d+))?)?(?:[ \t]+"(.*)")?[ \t]*\((\w+)\)[ \t\r]*$/gm;

export function splitFootnotes(text) {
  const cites = [];
  const body = String(text || '').replace(FOOTNOTE_RE, (_, n, p, a, b, c, d, q, s) => {
    const line = +(a || c) || null;
    cites.push({ n: +n, path: p, line, endLine: +(b || d) || line, quote: q || null, status: s });
    return '';
  });
  return { body: body.replace(/\n{3,}$/, '\n'), cites };
}

// Chips carry their source layer so the tint matches the legend.
function chipHtml(n, c) {
  const s = statusOf(c);
  const src = sourceFor(c?.path);
  const where = c?.path ? `, ${c.path}${c.line ? ' line ' + c.line : ''}` : '';
  const label = `Citation ${n}, ${s === 'pending' ? 'checking' : s}${where}`;
  const layer = src ? ` data-layer="${src.layer}"${src.dense ? ' data-dense=""' : ''}` : '';
  return `<button type="button" class="chip ${esc(c?.status || 'pending')}" data-n="${esc(n)}"${layer} aria-label="${esc(label)}">${esc(n)}</button>`;
}

// Final answers carry [^n]. Streaming text still has raw [[...]], numbered in order of first use.
// Pass the same `seen` map across calls when a streaming answer is rendered in pieces.
export function renderAnswer(text, citations = [], { streaming = false, seen = new Map() } = {}) {
  const byN = new Map(citations.map((c) => [String(c.n), c]));
  let src = String(text || '').replace(/[⟦⟧]/g, '');
  if (streaming) {
    src = src.replace(/\[\[[^\]\n]*$/, '');
    src = src.replace(CITE_RE, (...m) => {
      const c = citeFrom(m);
      const key = citeKey(c);
      if (!seen.has(key)) seen.set(key, { n: seen.size + 1, ...c, status: 'pending' });
      return `${L}p${seen.get(key).n}${R}`;
    });
  } else {
    src = src.replace(CITE_RE, '');
  }
  src = src.replace(/\[\^(\d+)\]/g, (_, n) => `${L}${n}${R}`);
  const pending = [...seen.values()];
  const byPending = new Map(pending.map((c) => [String(c.n), c]));
  const raw = md.parse(src).replace(new RegExp(`${L}(p?)(\\d+)${R}`, 'g'), (_, p, n) => {
    if (p) return chipHtml(n, { ...byPending.get(n), status: 'pending' });
    return chipHtml(n, byN.get(n) || { status: 'missing' });
  }).replace(CHIP_PUNCT, '<span class="chip-wrap">$1$2</span>');
  return { html: clean(raw), pending };
}

export function renderMarkdown(text) {
  return clean(md.parse(String(text || '')));
}

// Docusaurus-ish source to plain markdown, keeping the line count unchanged.
function tidyDoc(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) for (let i = 0; i <= end; i++) lines[i] = '';
  }
  let inAdm = false, inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) inFence = !inFence;
    if (inFence && !inAdm) continue;
    const open = !inAdm && l.match(/^:::(\w+)\s*(.*)$/);
    if (open) { inAdm = true; lines[i] = `> **${open[2] || open[1][0].toUpperCase() + open[1].slice(1)}**`; continue; }
    if (inAdm && /^:::\s*$/.test(l)) { inAdm = false; lines[i] = ''; continue; }
    if (inAdm) lines[i] = '> ' + l;
    else if (/^(import|export) .+ from ['"]/.test(l)) lines[i] = '';
  }
  return lines.join('\n');
}

// Render a doc as blocks tagged with the source lines they came from.
export function renderDocBlocks(text) {
  const tokens = md.lexer(tidyDoc(String(text || '')));
  let line = 1;
  let out = '';
  for (const t of tokens) {
    const nl = (t.raw.match(/\n/g) || []).length;
    const start = line;
    const end = line + Math.max(0, nl - (t.raw.endsWith('\n') ? 1 : 0));
    line += nl;
    if (t.type === 'space') continue;
    const one = [t];
    one.links = tokens.links;
    out += `<div class="blk" data-l1="${start}" data-l2="${end}">${md.parser(one)}</div>`;
  }
  return clean(out);
}
