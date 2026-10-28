// Geometry for proof ribbons; cites.js draws them. No imports so tests can load it.

// The range the model cited when its quote turned up somewhere else, else null.
export function ghostOf(c) {
  if (c?.status !== 'moved') return null;
  const from = c.citedLine ?? c.line0 ?? null;
  if (!from || from === c.line) return null;
  return { from, to: Math.max(from, c.endLine0 ?? from) };
}

// Line windows a pane shows, 1-based inclusive, sorted, merged when within 2 lines.
// The found range (capped at 8 lines) plus, for a moved citation, the first 4 lines of the cited range.
export function windows(c, total, pad = 1) {
  if (!c?.line || c.line > total) return [];
  const g = ghostOf(c);
  const raw = [[c.line, Math.min(Math.max(c.endLine || c.line, c.line), c.line + 7)]];
  if (g) raw.push([g.from, Math.min(g.to, g.from + 3)]);
  const out = [];
  for (const [x, y] of raw.sort((p, q) => p[0] - q[0])) {
    const a = Math.max(1, x - pad), b = Math.min(total, y + pad);
    if (a > total) continue;
    const last = out.at(-1);
    if (last && a <= last.b + 2) last.b = Math.max(last.b, b); else out.push({ a, b });
  }
  return out;
}

const f = (n) => Math.round(n * 10) / 10;
// a span thinner than 3px is padded to 3px so a one-line ribbon still shows
const span = ([p, q]) => (q - p < 3 ? [(p + q) / 2 - 1.5, (p + q) / 2 + 1.5] : [p, q]);

// Filled band from a vertical span at x=0 to a vertical span at x=w, S-curved. a and b are [top, bottom].
export function ribbonPath(w, a, b) {
  const [a0, a1] = span(a), [b0, b1] = span(b), m = w / 2;
  return `M0 ${f(a0)}C${m} ${f(a0)} ${m} ${f(b0)} ${w} ${f(b0)}V${f(b1)}C${m} ${f(b1)} ${m} ${f(a1)} 0 ${f(a1)}Z`;
}

// Centre line for the dashed ghost.
export const hairPath = (w, ay, by) => `M0 ${f(ay)}C${w / 2} ${f(ay)} ${w / 2} ${f(by)} ${w} ${f(by)}`;
