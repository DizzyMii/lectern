// Path containment that follows symlinks and junctions, so a link inside a root cannot reach outside it.
import fs from 'node:fs';
import path from 'node:path';

export function within(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

// The real path of p, or for a path that does not exist yet, the real path of its nearest
// existing parent with the missing part put back on.
export function realOf(p) {
  let cur = path.resolve(p);
  const tail = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(cur), ...tail); } catch {}
    const up = path.dirname(cur);
    if (up === cur) return path.resolve(p);
    tail.unshift(path.basename(cur));
    cur = up;
  }
}

export const realInside = (base, target) => within(realOf(base), realOf(target));

export function isLink(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
}
