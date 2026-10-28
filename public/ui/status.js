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

export const refsIn = (refs, from, to) => (refs || []).filter((r) => r.line && r.line <= to && (r.endLine || r.line) >= from);
