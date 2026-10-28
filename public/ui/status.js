// Citation status helpers shared by the drawer, the margin and the sheets. Pure, no imports.

export const RANK = { unverified: 4, moved: 3, pending: 2, verified: 1 };

// the status a citation shows as: missing reads as unverified, no status yet as pending
export const shown = (st) => (st === 'missing' ? 'unverified' : st || 'pending');

// the worst status in a list, shown; an empty list is verified
export const worst = (list) => (list || []).reduce((w, st) => (RANK[shown(st)] > RANK[w] ? shown(st) : w), 'verified');

// line -> { refs, status, start }: the refs covering the line, the worst of their statuses, and whether a range starts there.
// Ranges are clamped to the file and to 400 lines. A ref without a line (or past the end of the file) is skipped; it only shows in the header list.
export function lineMap(refs, lineCount = Infinity) {
  const out = new Map();
  for (const r of refs || []) {
    if (!r?.line || r.line > lineCount) continue;
    const to = Math.min(r.endLine || r.line, lineCount, r.line + 399);
    for (let n = r.line; n <= to; n++) {
      const e = out.get(n) ?? { refs: [], status: 'verified', start: false };
      e.refs.push(r);
      if (RANK[shown(r.status)] > RANK[e.status]) e.status = shown(r.status);
      if (n === r.line) e.start = true;
      out.set(n, e);
    }
  }
  return out;
}

// the line under the receipt numbers. Code citations have no quote, so a caption about quotes is only for answers with quotes.
export function receiptCaption(citations, k, checking = false) {
  const cites = citations || [];
  if (checking) return k.total ? `Checking ${k.total} citation${k.total === 1 ? '' : 's'}...` : 'Checking citations...';
  if (!k.total) return 'This answer has no citations. Treat it as a sketch.';
  if (k.unverified && cites.every((c) => shown(c.status) !== 'unverified' || c.quote)) return `${k.unverified} quote${k.unverified === 1 ? ' was' : 's were'} not found. ${k.unverified === 1 ? 'It is' : 'They are'} marked in red.`;
  if (k.unverified) return `${k.unverified} citation${k.unverified === 1 ? '' : 's'} did not check out. ${k.unverified === 1 ? 'It is' : 'They are'} marked in red.`;
  if (k.thin) return `Quotes were found again in their files. ${k.thin} code citation${k.thin === 1 ? '' : 's'} only checked that the lines still exist.`;
  if (cites.some((c) => !c.quote && c.line)) return 'Every citation here was found again in its file, or where it moved to. Sentences with no mark are uncited.';
  return 'Every quote here was found again in its file, or where it moved to. Sentences with no mark are uncited.';
}

// the drawer button for a file's saved citations: answers and sheets citing it, and how many citations that is.
// The list the button opens has one row per citation, so the two numbers have to be told apart.
export function citedByLabel(refs, trunc = false) {
  const sources = new Set((refs || []).map((r) => `${r.kind}:${r.id}:${r.turn ?? ''}`)).size, plus = trunc ? '+' : '';
  return `Cited by ${sources}${plus}${refs.length === sources ? '' : ` (${refs.length}${plus} citations)`}`;
}

export const refsIn = (refs, from, to) => (refs || []).filter((r) => r.line && r.line <= to && (r.endLine || r.line) >= from);

export const changedCite = (c) => c?.status0 != null && shown(c.status) !== shown(c.status0);
export const worseCite = (c) => changedCite(c) && RANK[shown(c.status)] > RANK[shown(c.status0)];

export function tally(list, key = 'status') {
  const out = { verified: 0, moved: 0, unverified: 0 };
  for (const c of list || []) { const s = shown(c?.[key]); if (s in out) out[s]++; }
  return out;
}

export const words = (t) => ['verified', 'moved', 'unverified'].filter((k) => t?.[k]).map((k) => `${t[k]} ${k}`).join(', ');

// 14:02 today, else Oct 24 (with the year when it is not this year)
export function dayWord(iso, now = new Date()) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return '';
  if (d.toDateString() === now.toDateString()) return d.toTimeString().slice(0, 5);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
}

// null unless some citation changed status since it was written
export function compare(cites, { at0 = null, word = 'Written', now = new Date() } = {}) {
  const list = (cites || []).filter((c) => c?.status0 != null);
  if (!list.some(changedCite)) return null;
  const bad = list.filter(worseCite);
  const since = dayWord(at0 ?? list[0].checkedAt0, now);
  return { total: list.length, changed: list.filter(changedCite).length, worse: bad.length, bad: tally(bad), since,
    then: `${word}${since ? ' ' + since : ''}: ${words(tally(list, 'status0'))}.`, now: `Today: ${words(tally(list))}.` };
}

// the dots on a hover card: as written first, then each stored change; capped at 7 keeping the first
export function series(c) {
  if (!c?.drift?.length) return [];
  const all = [{ at: c.checkedAt0, status: c.status0, line: c.line0 }, ...c.drift.map((d) => ({ at: d.at, status: d.status, line: d.line }))].filter((e) => e.status);
  return all.length > 7 ? [all[0], ...all.slice(-6)] : all;
}
