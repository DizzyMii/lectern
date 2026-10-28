// Which saved answers, sheets and notes cite a file, for the line markers in the drawer. Read-only: nothing here is saved.
import fs from 'node:fs';
import path from 'node:path';
import { httpError } from './store.mjs';
import { reverify, fileCache, resolveInNotebook, displayPath } from './cite.mjs';
import { savedCitations } from './check.mjs';

const DIRS = ['conversations', 'artifacts', 'notes'];
const MAX_REFS = 500;
const win = process.platform === 'win32';
const key = (p) => (win ? p.toLowerCase() : p);

// The CLI and the MCP server write these folders from other processes, so the index follows what is on disk.
function signature(nb) {
  const parts = [];
  for (const d of DIRS) {
    let names = [];
    try { names = fs.readdirSync(path.join(nb.dir, d)).sort(); } catch {}
    for (const f of names) {
      try { const st = fs.statSync(path.join(nb.dir, d, f)); parts.push(`${d}/${f}:${st.mtimeMs}:${st.size}`); } catch {}
    }
  }
  // roots change what a raw path resolves to
  try { parts.push(`config:${fs.statSync(path.join(nb.dir, 'notebook.json')).mtimeMs}`); } catch {}
  return parts.join('|');
}

const cache = new Map(); // nb.dir -> { sig, byPath }

function canonical(nb, raw) {
  try {
    const abs = resolveInNotebook(nb.dir, raw, nb.config.roots);
    if (abs && fs.existsSync(abs)) return displayPath(nb.dir, abs, nb.config.roots);
    // a missing file must file under the same key it gets once it exists, so map "<rootName>/rel" without it
    const rel = String(raw).trim().replace(/\\/g, '/').replace(/^\.\//, '');
    const name = rel.split('/')[0];
    const r = nb.config.roots;
    if (rel.includes('/') && r && Object.hasOwn(r, name) && typeof r[name] === 'string') {
      const base = path.resolve(nb.dir, r[name]), lex = path.resolve(base, rel.slice(name.length + 1));
      const up = path.relative(base, lex);
      if (!up.startsWith('..') && !path.isAbsolute(up)) return displayPath(nb.dir, lex, r);
    }
    if (abs) return displayPath(nb.dir, abs, nb.config.roots);
  } catch {}
  return String(raw).trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function index(nb) {
  const sig = signature(nb);
  const hit = cache.get(nb.dir);
  if (hit?.sig === sig) return hit.byPath;
  const memo = new Map(), byPath = new Map();
  for (const s of savedCitations(nb)) {
    const raw = s.cite?.path;
    if (typeof raw !== 'string' || !raw) continue;
    if (!memo.has(raw)) memo.set(raw, key(canonical(nb, raw)));
    const k = memo.get(raw);
    if (!byPath.has(k)) byPath.set(k, []);
    byPath.get(k).push(s);
  }
  cache.set(nb.dir, { sig, byPath });
  return byPath;
}

const KINDS = { answer: 0, sheet: 1, note: 2 };
const byLine = (a, b) => (a.line ?? Infinity) - (b.line ?? Infinity) || KINDS[a.kind] - KINDS[b.kind] || String(a.id).localeCompare(String(b.id)) || (a.turn ?? 0) - (b.turn ?? 0) || (a.n ?? 0) - (b.n ?? 0);

// Everything saved that cites this file, with the status each citation has right now.
export function citedBy(nb, p) {
  if (!p) throw httpError(400, 'path is required');
  const abs = resolveInNotebook(nb.dir, p, nb.config.roots, { absolute: false });
  if (!abs) throw httpError(403, `path escapes the notebook: ${p}`);
  const file = displayPath(nb.dir, abs, nb.config.roots);
  const hits = index(nb).get(key(file)) ?? [];
  const fresh = reverify(nb.dir, hits.map((x) => x.cite), nb.config.roots, { cache: fileCache() }).citations;
  const refs = hits.map((x, i) => {
    const c = fresh[i];
    return {
      kind: x.kind, id: x.id, title: x.title ?? null,
      ...(x.turn != null && { turn: x.turn, question: x.question }),
      ...(x.recipe && { recipe: x.recipe }),
      n: x.n ?? null, ...(x.ref && { node: x.node ?? '' }),
      line: c.line ?? null, endLine: c.endLine ?? c.line ?? null, status: c.status, citedLine: c.citedLine ?? null,
    };
  }).sort(byLine);
  return { path: file, refs: refs.slice(0, MAX_REFS), truncated: refs.length > MAX_REFS };
}
