// What a citation saw and what it sees now (DESIGN 11.7). Pure functions with no DOM and no imports,
// so node tests can load this file.

const TOKEN = /\s+|[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g;
const CAP = 250_000;

// Each side as lines of runs { t, x }. x marks a word the other side lacks, and whitespace is never marked.
// Lines that match at the top and bottom are set aside first, so the word diff only sees the changed middle.
export function wordDiff(a, b) {
  const la = String(a ?? '').split('\n'), lb = String(b ?? '').split('\n');
  const same = (x, y) => x.trim() === y.trim();
  let p = 0, s = 0;
  while (p < la.length && p < lb.length && same(la[p], lb[p])) p++;
  while (s < la.length - p && s < lb.length - p && same(la.at(-1 - s), lb.at(-1 - s))) s++;
  const plain = (l) => { const t = l.replace(/\r$/, ''); return t ? [{ t, x: false }] : []; };
  const mid = (ls) => ls.slice(p, ls.length - s);
  const ma = mid(la), mb = mid(lb);
  const d = diffWords(ma.join('\n'), mb.join('\n'));
  return {
    a: [...la.slice(0, p).map(plain), ...(ma.length ? d.a : []), ...la.slice(la.length - s).map(plain)],
    b: [...lb.slice(0, p).map(plain), ...(mb.length ? d.b : []), ...lb.slice(lb.length - s).map(plain)],
  };
}

function diffWords(a, b) {
  const split = (s) => String(s ?? '').match(TOKEN) ?? [];
  const ta = split(a), tb = split(b);
  const words = (ts) => ts.flatMap((t, i) => (/^\s/.test(t) ? [] : [i]));
  const wa = words(ta), wb = words(tb);
  const mark = (ts, ws) => { const x = new Set(ws); return ts.map((_, i) => x.has(i)); };
  let xa = mark(ta, wa), xb = mark(tb, wb);
  if (wa.length * wb.length <= CAP) {
    // LCS over the words only, so indentation never moves the alignment
    const n = wa.length, m = wb.length, w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = ta[wa[i]] === tb[wb[j]] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
    xa = ta.map(() => false);
    xb = tb.map(() => false);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (ta[wa[i]] === tb[wb[j]]) { i++; j++; }
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) xa[wa[i++]] = true;
      else xb[wb[j++]] = true;
    }
    while (i < n) xa[wa[i++]] = true;
    while (j < m) xb[wb[j++]] = true;
  }
  const lines = (ts, xs) => {
    const out = [[]];
    const add = (t, x) => { if (!t) return; const row = out.at(-1), last = row.at(-1); if (last && !x && !last.x) last.t += t; else row.push({ t, x }); };
    ts.forEach((t, i) => {
      if (!/^\s/.test(t)) return add(t, xs[i]);
      const parts = t.replace(/\r/g, '').split('\n');
      parts.forEach((p, k) => { if (k) out.push([]); add(p, false); });
    });
    return out;
  };
  return { a: lines(ta, xa), b: lines(tb, xb) };
}

const label = ([from, to]) => (from === to ? `L${from}` : `L${from}-${to}`);

// Whether the trail read the cited lines: { ok, text }, or null when there is nothing to say
export function readNote(c, isDocPath) {
  const read = c?.saw?.read;
  if (isDocPath || !Array.isArray(read) || c.line == null) return null;
  const a = c.line0 ?? c.line, b = c.endLine0 ?? c.endLine ?? a;
  if (!read.length) return { ok: false, text: 'The trail never opened this file. The line numbers may come from a search, or be guessed.' };
  const whole = read.find(([from, to]) => from <= a && to >= b);
  if (whole) return { ok: true, text: `The trail read ${label(whole)}, which covers these lines.` };
  const list = (rs) => rs.slice(0, 2).map(label).join(' and ');
  const part = read.filter(([from, to]) => from <= b && to >= a);
  if (part.length) return { ok: false, text: `The trail read ${list(part)}. The rest of these lines was not read.` };
  return { ok: false, text: `The trail read ${list(read)} of this file. It never read these lines.` };
}

export const when = (iso) => new Date(iso).toLocaleDateString('en', { day: 'numeric', month: 'short' });

// Why a citation is not plainly verified. { cls, text, short }, or null for verified.
export function citeWhy(c, name) {
  if (!c) return null;
  if (c.status === 'missing') return { cls: 'bad', text: 'File no longer exists at this path.', short: 'file not found' };
  if (c.status === 'moved' && c.citedLine != null) return { cls: 'moved', text: `Cited L${c.citedLine}, found at L${c.line}. Same text.`, short: `cited L${c.citedLine}, found at L${c.line}` };
  if (c.status !== 'unverified') return null;
  if (c.quote) return { cls: 'bad', text: `Quote not found in ${name}.`, short: 'quote not found in this file' };
  if (c.saw?.base) return { cls: 'bad', text: `These lines changed after Lectern first saved them on ${when(c.saw.at)}. Edits before that are not visible.`, short: 'lines changed since first saved' };
  if (c.saw) return { cls: 'bad', text: 'These lines were rewritten after the answer was written.', short: 'lines rewritten since the answer' };
  return { cls: 'bad', text: `${name} no longer has these lines.`, short: 'lines past the end of the file' };
}

// how many rows the shorter side has to move down so the two sides line up
export const align = (oldRow, newRow) => ({ old: Math.max(0, newRow - oldRow), new: Math.max(0, oldRow - newRow) });
