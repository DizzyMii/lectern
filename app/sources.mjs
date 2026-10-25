// Shelf summary, file reads, directory trees, search, and adding or removing sources.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { loadShelf, globFiles } from '../nb.mjs';
import { resolveInNotebook, displayPath } from './cite.mjs';
import { readConfig, writeConfig, httpError, ID_RE, slugify, toPosix } from './store.mjs';

const MAX_FILE = 2 * 1024 * 1024;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'build', '.gradle', 'out', 'run', '.idea']);
const TEXT_EXT = new Set(['md', 'txt', 'java', 'kt', 'json', 'json5', 'js', 'mjs', 'ts', 'toml', 'gradle', 'kts', 'properties', 'xml', 'yml', 'yaml', 'cfg', 'mcmeta', 'fsh', 'vsh', 'glsl', 'html', 'css', 'py', 'sh', 'bat', 'accesswidener', 'cfg', 'lang', 'csv', 'mdx', 'groovy']);

const LANGS = {
  md: 'markdown', mdx: 'markdown', java: 'java', kt: 'kotlin', kts: 'kotlin', json: 'json', json5: 'json', mcmeta: 'json',
  js: 'javascript', mjs: 'javascript', ts: 'typescript', toml: 'ini', gradle: 'groovy', groovy: 'groovy', properties: 'properties',
  cfg: 'ini', xml: 'xml', html: 'xml', yml: 'yaml', yaml: 'yaml', fsh: 'glsl', vsh: 'glsl', glsl: 'glsl', css: 'css', py: 'python',
  sh: 'bash', bat: 'dos', txt: 'plaintext', csv: 'plaintext', pdf: 'pdf',
};

export const extOf = (p) => path.extname(p).slice(1).toLowerCase();
export const langOf = (p) => LANGS[extOf(p)] ?? 'plaintext';

const rootAbs = (nb, name) => path.resolve(nb.dir, nb.config.roots[name]);

// ---------- shelf ----------

const shelfCache = new Map();

export function invalidate(nb) {
  shelfCache.delete(nb.dir);
  fileCache.delete(nb.dir);
}

export async function getShelf(nb) {
  const key = JSON.stringify(nb.config.pinned);
  const hit = shelfCache.get(nb.dir);
  if (hit && hit.key === key && Date.now() - hit.at < 30_000) return hit.shelf;
  const docs = await loadShelf(nb.dir, nb.config.pinned);
  let words = 0;
  for (const d of docs) words += d.data.split(/\s+/).filter(Boolean).length;
  // docs with java snippets came to about 2.9 chars per token on claude-opus-5-5 (1.04M chars, 357k tokens)
  const shelf = {
    docs,
    summary: docs.map((d) => ({ title: d.title, files: d.starts.map((s) => s.file) })),
    stats: { docs: docs.length, files: docs.reduce((n, d) => n + d.starts.length, 0), words, tokens: Math.round(docs.reduce((n, d) => n + d.data.length, 0) / 2.9) },
  };
  shelfCache.set(nb.dir, { key, at: Date.now(), shelf });
  return shelf;
}

export function shelfStdin(docs) {
  return docs.map((d) => `<document title="${d.title.replace(/"/g, '&quot;')}">\n${d.data}</document>`).join('\n\n');
}

export function rootsInfo(nb) {
  return Object.entries(nb.config.roots).map(([name, rel]) => {
    const abs = rootAbs(nb, name);
    const exists = fs.existsSync(abs);
    return { name, path: toPosix(rel), exists, ...(exists ? rootMeta(abs) : {}) };
  });
}

// The rail's second line: the branch from the nearest .git/HEAD and a version from the nearest
// gradle.properties or package.json, walking up a few folders from the root. Missing means absent.
function rootMeta(abs) {
  const out = {};
  let dir = abs;
  for (let i = 0; i < 6; i++) {
    if (!out.version) out.version = versionIn(dir);
    if (!out.version) delete out.version;
    try {
      const m = fs.readFileSync(path.join(dir, '.git', 'HEAD'), 'utf8').match(/^ref: refs\/heads\/(.+)$/m);
      if (m) out.branch = m[1].trim();
      break;
    } catch {}
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return out;
}

function versionIn(dir) {
  try {
    const props = fs.readFileSync(path.join(dir, 'gradle.properties'), 'utf8');
    for (const k of ['mod_version', 'version', 'neo_version', 'minecraft_version']) {
      const m = props.match(new RegExp(String.raw`^${k}\s*=\s*(\S+)`, 'm'));
      if (m) return m[1];
    }
  } catch {}
  try { const v = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version; if (typeof v === 'string') return v; } catch {}
  return undefined;
}

// First-run suggestions (SCREENS 9): project folders in the given dirs that no notebook
// uses yet. Read only, one level deep, nothing is indexed. A NeoForge project also
// suggests the docs for its Minecraft version.
export function candidates(dirs, taken = [], limit = 8) {
  const norm = (p) => toPosix(path.resolve(p)).toLowerCase();
  const used = new Set(taken.map(norm));
  const seen = new Set();
  const found = [];
  for (const dir of dirs) {
    let names = [];
    try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules').map((d) => d.name); } catch { continue; }
    for (const name of names) {
      const abs = path.join(dir, name);
      const key = norm(abs);
      if (used.has(key) || seen.has(key)) continue;
      seen.add(key);
      const has = (f) => fs.existsSync(path.join(abs, f));
      const git = has('.git');
      if (!git && !['gradle.properties', 'build.gradle', 'settings.gradle', 'package.json', 'pom.xml'].some(has)) continue;
      let mtime = 0;
      try { mtime = fs.statSync(abs).mtimeMs; } catch {}
      let mc = null;
      try { const props = fs.readFileSync(path.join(abs, 'gradle.properties'), 'utf8'); if (/^neo_version\s*=/m.test(props)) mc = props.match(/^minecraft_version\s*=\s*(\S+)/m)?.[1] || null; } catch {}
      found.push({ path: toPosix(abs), name, kind: git ? 'repo' : 'root', ...rootMeta(abs), mc, mtime });
    }
  }
  found.sort((a, b) => b.mtime - a.mtime);
  const roots = found.slice(0, limit);
  const docs = [...new Set(roots.map((r) => r.mc).filter(Boolean))].map((v) => ({ url: `https://docs.neoforged.net/docs/${v}/`, label: `docs.neoforged.net/docs/${v}` }));
  return { roots: roots.map(({ mtime, mc, ...r }) => r), docs };
}

// ---------- files ----------

// Only notebook-relative or "<rootName>/..." paths; absolute paths are refused even inside a root.
export function readFile(nb, p) {
  if (!p) throw httpError(400, 'path is required');
  const abs = resolveInNotebook(nb.dir, p, nb.config.roots, { absolute: false });
  if (!abs) throw httpError(403, `path escapes the notebook: ${p}`);
  if (!fs.existsSync(abs)) throw httpError(404, `not found: ${p}`);
  const st = fs.statSync(abs);
  if (!st.isFile()) throw httpError(400, `not a file: ${p}`);
  const rel = displayPath(nb.dir, abs, nb.config.roots);
  const lang = langOf(abs);
  if (lang === 'pdf') return { path: rel, text: '', lang, lines: 0, size: st.size, binary: true };
  if (st.size > MAX_FILE) throw httpError(413, `file is larger than 2 MB: ${p}`);
  const text = fs.readFileSync(abs, 'utf8');
  return { path: rel, text, lang, lines: text.split('\n').length, size: st.size };
}

export function tree(nb, root, dir = '') {
  if (!root) throw httpError(400, 'root is required');
  if (!Object.hasOwn(nb.config.roots, root)) throw httpError(404, `unknown root: ${root}`);
  const base = rootAbs(nb, root);
  const target = path.resolve(base, dir || '.');
  const rel = path.relative(base, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw httpError(403, `dir escapes the root: ${dir}`);
  if (!fs.existsSync(target)) throw httpError(404, `not found: ${dir}`);
  const entries = fs.readdirSync(target, { withFileTypes: true })
    .filter((e) => !(e.isDirectory() && SKIP_DIRS.has(e.name)))
    .map((e) => {
      const d = toPosix(path.join(rel, e.name));
      return e.isDirectory()
        ? { name: e.name, type: 'dir', dir: d }
        : { name: e.name, type: 'file', path: displayPath(nb.dir, path.join(target, e.name), nb.config.roots) };
    })
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  return { root, dir: toPosix(rel), entries: entries.slice(0, 5000), truncated: entries.length > 5000 };
}

function walk(dir, out = []) {
  let list;
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of list) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full, out); }
    else out.push(full);
  }
  return out;
}

const fileCache = new Map();

// every searchable file: pinned docs plus files under each root
export async function allFiles(nb) {
  const key = JSON.stringify([nb.config.pinned, nb.config.roots]);
  const hit = fileCache.get(nb.dir);
  if (hit && hit.key === key && Date.now() - hit.at < 60_000) return hit.files;
  const seen = new Set();
  const files = [];
  for (const pattern of nb.config.pinned) {
    for (const rel of await globFiles(pattern, nb.dir)) {
      const abs = path.resolve(nb.dir, rel);
      if (!seen.has(abs)) { seen.add(abs); files.push({ abs, path: toPosix(rel), kind: 'pinned' }); }
    }
  }
  for (const name of Object.keys(nb.config.roots)) {
    for (const abs of walk(rootAbs(nb, name))) {
      if (seen.has(abs) || !TEXT_EXT.has(extOf(abs))) continue;
      seen.add(abs);
      files.push({ abs, path: displayPath(nb.dir, abs, nb.config.roots), kind: 'root', root: name });
    }
  }
  fileCache.set(nb.dir, { key, at: Date.now(), files });
  return files;
}

// ---------- search ----------

const textCache = new Map();
function cachedText(abs) {
  let st;
  try { st = fs.statSync(abs); } catch { return null; }
  if (st.size > MAX_FILE) return null;
  const hit = textCache.get(abs);
  if (hit && hit.mtime === st.mtimeMs) return hit.text;
  const text = fs.readFileSync(abs, 'utf8');
  if (text.slice(0, 1024).includes('\0')) return null;
  textCache.set(abs, { mtime: st.mtimeMs, text });
  return text;
}

let rgPath;
function findRg() {
  if (rgPath !== undefined) return rgPath;
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['rg'], { encoding: 'utf8' });
  rgPath = r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() || null : null;
  return rgPath;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clip = (s) => (s.length > 400 ? s.slice(0, 400) : s);

export async function search(nb, q, { regex = false, limit = 200 } = {}) {
  const t0 = Date.now();
  q = String(q ?? '');
  if (!q.trim()) return { query: q, hits: [], truncated: false, ms: 0 };
  const flags = /[A-Z]/.test(q) ? '' : 'i';
  let re;
  try { re = new RegExp(regex ? q : escapeRe(q), flags); } catch (e) { throw httpError(400, `bad regex: ${e.message.replace(/^Invalid regular expression: \/.*\/\w*: /, '')}`); }
  const files = await allFiles(nb);
  const hits = [];
  let truncated = false;
  const rg = findRg();
  if (rg) {
    const known = new Map(files.map((f) => [path.resolve(f.abs), f]));
    const dirs = [...new Set(files.map((f) => path.dirname(f.abs)))];
    const args = ['-n', '--no-heading', '--with-filename', '--max-count', '50', ...(flags ? ['-i'] : ['-s']), ...(regex ? [] : ['-F']), '-e', q, ...dirs.slice(0, 400)];
    const r = spawnSync(rg, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 10_000 });
    for (const line of (r.stdout || '').split(/\r?\n/)) {
      const m = line.match(/^(.*?):(\d+):(.*)$/);
      if (!m) continue;
      const f = known.get(path.resolve(m[1]));
      if (!f) continue;
      if (hits.length >= limit) { truncated = true; break; }
      const col = m[3].search(re);
      hits.push({ path: f.path, line: Number(m[2]), text: clip(m[3]), col: Math.max(0, col) });
    }
    if (!r.error && dirs.length <= 400) return { query: q, hits, truncated, ms: Date.now() - t0, engine: 'rg' };
    hits.length = 0;
  }
  outer: for (const f of files) {
    const text = cachedText(f.abs);
    if (text == null) continue;
    if (!re.test(text)) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const col = lines[i].search(re);
      if (col < 0) continue;
      if (hits.length >= limit) { truncated = true; break outer; }
      hits.push({ path: f.path, line: i + 1, text: clip(lines[i].replace(/\r$/, '')), col });
    }
  }
  return { query: q, hits, truncated, ms: Date.now() - t0, engine: 'node' };
}

// ---------- adding and removing sources ----------

function ensurePinned(nb, pattern) {
  const cfg = readConfig(nb.dir);
  if (!cfg.pinned.includes(pattern)) { cfg.pinned.push(pattern); writeConfig(nb.dir, cfg); }
  nb.config = cfg;
}

function setRoot(nb, name, value) {
  const cfg = readConfig(nb.dir);
  cfg.roots[name] = value;
  writeConfig(nb.dir, cfg);
  nb.config = cfg;
}

const safeName = (n) => path.basename(String(n ?? '')).replace(/[^\w.\- ]+/g, '_').replace(/^\.+/, '').slice(0, 120);

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>';
    if (k === 'quot') return '"'; if (k === 'apos') return "'"; if (k === 'nbsp') return ' ';
    const n = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  });
}

// crude HTML to markdown for when defuddle is not around
export function htmlToMarkdown(html) {
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim());
  let body = html.match(/<(article|main)[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ?? html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  body = body
    .replace(/<(script|style|nav|footer|header|noscript|svg|aside)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => '\n```\n' + c.replace(/<[^>]+>/g, '') + '\n```\n')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => `\n\n${'#'.repeat(Number(n))} ${t.replace(/<[^>]+>/g, '').trim()}\n\n`)
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => '`' + c.replace(/<[^>]+>/g, '') + '`')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, h, t) => `[${t.replace(/<[^>]+>/g, '').trim()}](${h})`)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<(br|\/p|\/div|\/tr|\/ul|\/ol|\/table|\/blockquote)[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  body = decodeEntities(body).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, markdown: body };
}

function defuddleCli() {
  const appdata = process.env.APPDATA;
  const candidates = [appdata && path.join(appdata, 'npm', 'node_modules', 'defuddle', 'dist', 'cli.js')].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

function run(cmd, args, { cwd, onLine, timeout = 600_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill(), timeout);
    const feed = (buf, isErr) => {
      const s = buf.toString('utf8');
      if (isErr) err += s; else out += s;
      if (onLine) for (const l of s.split(/[\r\n]+/)) if (l.trim()) onLine(l.trim());
    };
    child.stdout.on('data', (b) => feed(b, false));
    child.stderr.on('data', (b) => feed(b, true));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve({ out, err }) : reject(new Error(err.trim().split('\n').pop() || `${cmd} exited ${code}`)); });
  });
}

async function addUrl(nb, { url }, progress) {
  let u;
  try { u = new URL(url); } catch { throw httpError(400, 'bad url'); }
  if (!/^https?:$/.test(u.protocol)) throw httpError(400, 'only http and https urls');
  let title = '', markdown = '';
  const cli = defuddleCli();
  if (cli) {
    progress(`defuddle ${u.href}`);
    try {
      const r = await run(process.execPath, [cli, 'parse', u.href, '--markdown', '--json'], { timeout: 60_000 });
      const j = JSON.parse(r.out);
      title = j.title ?? '';
      markdown = j.content ?? '';
    } catch (e) { progress(`defuddle failed (${e.message}), falling back`); }
  }
  if (!markdown) {
    progress(`fetching ${u.href}`);
    const res = await fetch(u.href, { headers: { 'user-agent': 'notebook-app/1.0' }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw httpError(502, `fetch failed: ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    const body = await res.text();
    if (/html/i.test(type) || /<html/i.test(body.slice(0, 2000))) ({ title, markdown } = htmlToMarkdown(body));
    else markdown = body;
  }
  title ||= u.hostname + u.pathname;
  const dir = path.join(nb.dir, 'sources');
  fs.mkdirSync(dir, { recursive: true });
  // the same URL again refreshes its existing file instead of adding a copy
  let slug = existingUrlSource(dir, u.href);
  const existing = Boolean(slug);
  if (!slug) {
    slug = slugify(title);
    const base = slug;
    let n = 2;
    while (fs.existsSync(path.join(dir, `${slug}.md`))) slug = `${base}-${n++}`;
  }
  const file = path.join(dir, `${slug}.md`);
  fs.writeFileSync(file, `# ${title}\n\nSource: ${u.href}\n\n${markdown.trim()}\n`);
  ensurePinned(nb, 'sources/**/*.md');
  progress(`${existing ? 'refreshed' : 'saved'} sources/${slug}.md`);
  return { kind: 'url', path: `sources/${slug}.md`, title, existing };
}

function existingUrlSource(dir, href) {
  let names;
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.md')); } catch { return null; }
  for (const name of names) {
    let head = '';
    try {
      const fd = fs.openSync(path.join(dir, name), 'r');
      const buf = Buffer.alloc(2048);
      head = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)).toString('utf8');
      fs.closeSync(fd);
    } catch { continue; }
    if (head.split('\n').slice(0, 6).some((l) => l.trim() === `Source: ${href}`)) return name.slice(0, -3);
  }
  return null;
}

function addFile(nb, { name, base64 }) {
  const clean = safeName(name);
  if (!clean || base64 == null) throw httpError(400, 'file needs name and base64');
  const buf = Buffer.from(String(base64), 'base64');
  if (buf.length > 50 * 1024 * 1024) throw httpError(413, 'file larger than 50 MB');
  const ext = extOf(clean);
  if (ext === 'md' || ext === 'txt') {
    const dir = path.join(nb.dir, 'sources');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, clean), buf);
    ensurePinned(nb, `sources/**/*.${ext}`);
    return { kind: 'file', path: `sources/${clean}`, pinned: true };
  }
  const dir = path.join(nb.dir, 'sources', 'files');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, clean), buf);
  if (!nb.config.roots.files) setRoot(nb, 'files', 'sources/files');
  return { kind: 'file', path: `sources/files/${clean}`, root: 'files' };
}

function addFolder(nb, { path: p, name }) {
  if (!p) throw httpError(400, 'folder needs a path');
  const abs = path.resolve(nb.dir, p);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw httpError(400, `not a directory: ${p}`);
  name ||= path.basename(abs);
  if (!ID_RE.test(name)) throw httpError(400, 'bad root name');
  if (nb.config.roots[name]) throw httpError(409, `root ${name} already exists`);
  const rel = path.relative(nb.dir, abs);
  setRoot(nb, name, toPosix(!rel.startsWith('..') && !path.isAbsolute(rel) ? rel : abs));
  return { kind: 'folder', root: name, path: nb.config.roots[name] };
}

async function addGit(nb, { url, branch, subdir, name }, progress) {
  if (!url || !/^(https?:\/\/|git@)[^\s]+$/.test(url)) throw httpError(400, 'bad git url');
  name ||= path.basename(url).replace(/\.git$/, '');
  if (!ID_RE.test(name)) throw httpError(400, 'bad name');
  if (nb.config.roots[name]) throw httpError(409, `root ${name} already exists`);
  const dest = path.join(nb.dir, 'corpus', name);
  if (fs.existsSync(dest)) throw httpError(409, `corpus/${name} already exists`);
  const sub = subdir ? String(subdir).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : '';
  if (sub.split('/').includes('..')) throw httpError(400, 'bad subdir');
  const args = ['clone', '--depth', '1', '--filter=blob:none', '--progress', ...(sub ? ['--sparse'] : []), ...(branch ? ['-b', branch] : []), url, dest];
  progress(`git ${args.join(' ')}`);
  await run('git', args, { onLine: progress });
  if (sub) {
    progress(`sparse-checkout ${sub}`);
    await run('git', ['-C', dest, 'sparse-checkout', 'set', sub], { onLine: progress });
  }
  const rootRel = toPosix(path.join('corpus', name, sub));
  setRoot(nb, name, rootRel);
  return { kind: 'git', root: name, path: rootRel };
}

export async function addSource(nb, body, progress = () => {}) {
  let r;
  switch (body?.kind) {
    case 'url': r = await addUrl(nb, body, progress); break;
    case 'file': r = addFile(nb, body); break;
    case 'folder': r = addFolder(nb, body); break;
    case 'git': r = await addGit(nb, body, progress); break;
    default: throw httpError(400, 'kind must be url, file, folder or git');
  }
  invalidate(nb);
  return { ...r, config: nb.config };
}

export function removeSource(nb, { kind, value }) {
  const cfg = readConfig(nb.dir);
  if (kind === 'pinned') {
    if (!cfg.pinned.includes(value)) throw httpError(404, `not pinned: ${value}`);
    cfg.pinned = cfg.pinned.filter((p) => p !== value);
  } else if (kind === 'root') {
    if (cfg.roots[value] == null) throw httpError(404, `no root ${value}`);
    delete cfg.roots[value];
  } else if (kind === 'file') {
    // one file added through the UI, so only paths under sources/
    const base = path.join(nb.dir, 'sources');
    const abs = path.resolve(nb.dir, String(value ?? '').replace(/\\/g, '/'));
    const rel = path.relative(base, abs);
    if (!value || path.isAbsolute(String(value)) || !rel || rel.startsWith('..') || path.isAbsolute(rel)) throw httpError(400, 'file must be a path under sources/');
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw httpError(404, `not found: ${value}`);
    fs.unlinkSync(abs);
    invalidate(nb);
    return { config: cfg, removed: toPosix(path.relative(nb.dir, abs)) };
  } else throw httpError(400, 'kind must be pinned, root or file');
  writeConfig(nb.dir, cfg);
  nb.config = cfg;
  invalidate(nb);
  return { config: cfg };
}
