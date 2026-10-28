// What a code root looked like when an answer was written: HEAD per root, a file at that commit, and the
// commits since that touched the cited lines. Read only. Every git call goes through git() and rootDir().
import fs from 'node:fs';
import path from 'node:path';
import { git, rootDir } from './studio/inputs.mjs';
import { httpError, toPosix } from './store.mjs';
import { within, realInside } from './paths.mjs';

export const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MAX_FILE = 2 * 1024 * 1024, MAX_TOUCHED = 40, LIMIT = 20;
const QUICK = { timeoutMs: 5_000, cap: 64 * 1024 };
const LOG = { timeoutMs: 15_000, cap: 256 * 1024 };
// every path goes in as ./rel after these, so pathspec magic and leading dashes do nothing
const SAFE = ['--literal-pathspecs', '--no-optional-locks'];
const DIFF = ['diff', '--no-ext-diff', '--no-textconv'];

// The root a path belongs to, for a notebook-relative path, an absolute path or <rootName>/rel. The file
// need not exist. Returns { root, dir, rel } or null.
export function locate(nb, p) {
  let s = String(p ?? '').trim().replace(/\\/g, '/');
  while (s.startsWith('./')) s = s.slice(2);
  if (!s || s.split('/').includes('..')) return null;
  const roots = Object.entries(nb.config?.roots ?? {}).filter(([, v]) => typeof v === 'string').map(([name, v]) => ({ name, dir: path.resolve(nb.dir, v) }));
  const isAbs = path.isAbsolute(s) || /^[A-Za-z]:/.test(s);
  const abs = isAbs ? path.resolve(s) : path.resolve(nb.dir, s);
  let hit = null, target = abs;
  for (const r of roots) if (within(r.dir, abs) && (!hit || r.dir.length > hit.dir.length)) hit = r;
  // like resolveInNotebook: the notebook-relative path wins only when that file is there
  if (!hit || (!isAbs && !fs.existsSync(abs))) {
    const [first, ...rest] = s.split('/');
    const named = roots.find((r) => r.name === first);
    if (named && rest.length) { hit = named; target = path.resolve(named.dir, ...rest); }
    else if (!hit) return null;
  }
  if (!within(hit.dir, target) || !realInside(hit.dir, target)) return null;
  const rel = toPosix(path.relative(hit.dir, target));
  if (!rel || rel.startsWith('..')) return null;
  return { root: hit.name, dir: hit.dir, rel };
}

// HEAD of each root that holds one of the files, and which of those files differ from it. Never throws.
export async function snapshotRoots(nb, files) {
  const by = new Map();
  for (const f of files) {
    const l = locate(nb, f);
    if (l) { if (!by.has(l.root)) by.set(l.root, new Set()); by.get(l.root).add(l.rel); }
  }
  const done = await Promise.all([...by].map(async ([name, rels]) => {
    try {
      const r = rootDir(nb, name); // refuses a missing root and a repo config that runs programs
      const sha = (await git(r.abs, ['rev-parse', 'HEAD'], QUICK)).text.trim();
      if (!SHA_RE.test(sha)) return null;
      // no pathspec, so a long list of reads cannot push a cited file out; a huge diff falls back to the first few
      let d = await git(r.abs, [...SAFE, ...DIFF, '--name-only', '--relative', '-z', 'HEAD'], QUICK);
      if (d.truncated) d = await git(r.abs, [...SAFE, ...DIFF, '--name-only', '--relative', '-z', 'HEAD', '--', ...[...rels].slice(0, MAX_TOUCHED).map((x) => `./${x}`)], QUICK);
      return [name, { sha, dirty: d.text.split('\0').filter((x) => rels.has(x)) }];
    } catch { return null; }
  }));
  const out = Object.fromEntries(done.filter(Boolean));
  return Object.keys(out).length ? out : null;
}

// copies the recorded sha, and dirty when the file had edits, onto each citation inside a recorded root
export function stampCitations(nb, citations, commits) {
  if (!commits) return;
  for (const c of citations ?? []) {
    const l = c?.path ? locate(nb, c.path) : null;
    const at = l && commits[l.root];
    if (!at) continue;
    c.sha = at.sha;
    if (at.dirty.includes(l.rel)) c.dirty = true;
  }
}

function need(nb, p, sha) {
  if (!SHA_RE.test(String(sha ?? ''))) throw httpError(400, 'sha must be a full commit hash');
  const l = locate(nb, p);
  if (!l) throw httpError(404, 'that path is not inside a code root');
  return { ...l, r: rootDir(nb, l.root) };
}

// Names what went wrong after a failed git call: the commit is gone, or the file is not in it.
async function why(r, sha, what) {
  try { await git(r.abs, ['cat-file', '-e', `${sha}^{commit}`], QUICK); }
  catch { return httpError(404, `commit ${sha.slice(0, 7)} is not in this repo any more`); }
  return httpError(404, what);
}

export async function fileAt(nb, p, sha) {
  const { root, rel, r } = need(nb, p, sha);
  let text, truncated;
  try {
    // cat-file blob refuses a directory, and no textconv or filter runs
    ({ text, truncated } = await git(r.abs, [...SAFE, 'cat-file', 'blob', `${sha}:./${rel}`], { cap: MAX_FILE }));
  } catch (e) {
    if (e.status === 500) throw e;
    throw await why(r, sha, `that file is not in commit ${sha.slice(0, 7)}`);
  }
  const binary = text.slice(0, 1024).includes('\0');
  return { path: p, root, rel, sha, text: binary ? '' : text, truncated, binary };
}

const parseLog = (out, byPath) => out.split('\x1e').filter((x) => x.trim()).map((chunk) => {
  const [head, ...rest] = chunk.split('\n');
  const [sha, date, author, ...subject] = head.split('\x1f');
  const c = { sha, short: sha.slice(0, 7), date, author, subject: subject.join('\x1f') };
  if (byPath) {
    const s = rest.find((x) => x.trim())?.split('\t')[0] ?? '';
    c.change = ['A', 'D', 'R'].includes(s[0]) ? s[0] : 'M';
  }
  return c;
});

const dirtyNowOf = async (r, rel) => {
  try { return Boolean((await git(r.abs, [...SAFE, ...DIFF, '--name-only', '--relative', 'HEAD', '--', `./${rel}`], QUICK)).text.trim()); }
  catch { return false; }
};

// Commits after sha, up to HEAD, that touched the lines (or, when that cannot be asked, the path).
export async function changesSince(nb, p, sha, line, endLine) {
  const { root, rel, r } = need(nb, p, sha);
  let head;
  try { head = (await git(r.abs, ['rev-parse', 'HEAD'], QUICK)).text.trim(); }
  catch (e) { if (e.status === 500) throw e; throw httpError(404, `commit ${sha.slice(0, 7)} is not in this repo any more`); }
  const dirtyNow = await dirtyNowOf(r, rel);
  // git log fails on an empty range, so nothing has happened since
  if (head === sha) return { path: p, root, sha, by: 'lines', commits: [], truncated: false, dirtyNow };
  const common = [...SAFE, 'log', '--no-color', '--no-ext-diff', '--no-textconv', '--date=short', `--max-count=${LIMIT}`, '--format=%x1e%H%x1f%ad%x1f%an%x1f%s'];
  let by = 'path', out = null;
  if (Number.isInteger(line) && line > 0) {
    const b = Number.isInteger(endLine) && endLine >= line ? endLine : line;
    try { out = (await git(r.abs, [...common, '--no-patch', `-L${line},${b}:./${rel}`, `${sha}..HEAD`], LOG)).text; by = 'lines'; }
    catch (e) { if (e.status === 500) throw e; }
  }
  if (out == null) {
    try { out = (await git(r.abs, [...common, '--name-status', '-M', `${sha}..HEAD`, '--', `./${rel}`], LOG)).text; }
    catch (e) { if (e.status === 500) throw e; throw await why(r, sha, `could not read the history of ${rel}`); }
  }
  const commits = parseLog(out, by === 'path');
  // a path log limited to the old name only sees a delete; the same commit says where it went
  if (by === 'path') await Promise.all(commits.filter((c) => c.change === 'D').map(async (c) => {
    try {
      const o = (await git(r.abs, [...SAFE, 'show', '--format=', '--name-status', '-M', '--no-ext-diff', '--no-textconv', '--relative', c.sha], QUICK)).text;
      for (const l of o.split('\n')) { const [st, from, to] = l.split('\t'); if (st?.startsWith('R') && from === rel && to) { c.change = 'R'; c.to = to.trim(); } }
    } catch {}
  }));
  return { path: p, root, sha, by, commits, truncated: commits.length === LIMIT, dirtyNow };
}
