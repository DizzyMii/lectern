// Notebook registry, conversations and notes on disk.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { lecternHome, homeFile } from './home.mjs';
import { reverify, reverifyRefs, fileCache, checkSummary } from './cite.mjs';

export { reverify, reverifyRefs, fileCache, checkSummary };
export { lecternHome };

// the package root, which holds public/ and node_modules/
export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = () => homeFile('registry.json');
// relative registry dirs (older registries) resolve against the home folder
const registryBase = () => lecternHome();

export const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export function loadRegistry() {
  return readJson(registryPath(), { notebooks: {} });
}

export function saveRegistry(reg) {
  writeJson(registryPath(), reg);
}

export function listNotebooks() {
  return Object.keys(loadRegistry().notebooks).map((id) => getNotebook(id)).filter(Boolean);
}

export function getNotebook(id) {
  const entry = loadRegistry().notebooks[id];
  if (!entry) return null;
  const dir = path.resolve(registryBase(), entry.dir);
  const config = readConfig(dir);
  return {
    id,
    dir,
    title: config.title ?? entry.title ?? id,
    color: config.color ?? entry.color ?? 'amber',
    description: config.description ?? entry.description ?? '',
    config,
  };
}

export function readConfig(dir) {
  const c = readJson(path.join(dir, 'notebook.json'), {});
  c.pinned ??= [];
  c.roots ??= {};
  return c;
}

export function writeConfig(dir, config) {
  writeJson(path.join(dir, 'notebook.json'), config);
}

// A notebook is a folder anywhere on disk, registered by absolute path. Without a dir it goes under the home folder.
export function createNotebook({ id, title, color, dir }) {
  if (!ID_RE.test(id ?? '')) throw httpError(400, 'id must be letters, digits, dot, dash or underscore');
  const reg = loadRegistry();
  if (reg.notebooks[id]) throw httpError(409, `notebook ${id} already exists`);
  const abs = dir ? path.resolve(dir) : path.join(lecternHome(), 'notebooks', id);
  if (!fs.existsSync(path.join(abs, 'notebook.json'))) {
    writeConfig(abs, { name: id, title: title || id, color: color || 'amber', pinned: [], roots: {} });
  }
  reg.notebooks[id] = { dir: toPosix(abs), title: title || id, color: color || 'amber' };
  saveRegistry(reg);
  return getNotebook(id);
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

export const toPosix = (p) => p.split(path.sep).join('/');

export const newId = () => `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

// ---------- conversations ----------

const convDir = (nb) => path.join(nb.dir, 'conversations');
const convFile = (nb, id) => {
  if (!ID_RE.test(id ?? '')) throw httpError(400, 'bad conversation id');
  return path.join(convDir(nb), `${id}.json`);
};

export function listConversations(nb) {
  let names = [];
  try { names = fs.readdirSync(convDir(nb)).filter((f) => f.endsWith('.json')); } catch { return []; }
  return names
    .map((f) => readJson(path.join(convDir(nb), f), null))
    .filter(Boolean)
    .map((c) => ({ id: c.id, title: c.title, updated: c.updated, created: c.created, turns: c.turns?.length ?? 0, ...citeTally(c) }))
    .sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
}

// History rows show how many citations a conversation has and its worst status (moved or unverified).
function citeTally(c) {
  const all = (c.turns ?? []).flatMap((t) => t.citations ?? []);
  const bad = all.some((x) => x.status === 'unverified' || x.status === 'missing');
  return { citations: all.length, flag: bad ? 'unverified' : all.some((x) => x.status === 'moved') ? 'moved' : null };
}

// With recheck, every turn's citations are verified again against the files as they are now.
export function getConversation(nb, id, { recheck = false } = {}) {
  const conv = readJson(convFile(nb, id), null);
  if (!conv || !recheck) return conv;
  const at = new Date().toISOString();
  const opts = { cache: fileCache(), at };
  let dirty = false;
  const all = [];
  for (const t of conv.turns ?? []) {
    const r = reverify(nb.dir, t.citations, nb.config.roots, { ...opts, since: t.endedAt ?? t.startedAt ?? conv.created ?? null });
    t.citations = r.citations;
    t.citeCheck = r.summary;
    dirty ||= r.dirty;
    all.push(...r.citations);
  }
  conv.citeCheck = { ...checkSummary(all, at), turnsChanged: (conv.turns ?? []).filter((t) => t.citeCheck.changed).length };
  // only write when a status or line drifted, and leave updated alone so the list order holds.
  // Another process (web server, MCP server, CLI) may have saved a turn since the read; then skip the write.
  if (dirty) {
    const now = readJson(convFile(nb, id), null);
    if (now && now.updated === conv.updated && (now.turns?.length ?? 0) === (conv.turns?.length ?? 0)) writeJson(convFile(nb, id), conv);
  }
  return conv;
}

export function saveConversation(nb, conv) {
  conv.updated = new Date().toISOString();
  writeJson(convFile(nb, conv.id), conv);
  return conv;
}

export function newConversation(nb, question) {
  const now = new Date().toISOString();
  return { id: newId(), notebook: nb.id, title: titleFrom(question), titleSet: false, sessionId: null, created: now, updated: now, turns: [] };
}

export function titleFrom(q) {
  const t = String(q ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 60 ? t.slice(0, 59).trimEnd() + '…' : t || 'Untitled';
}

export function deleteConversation(nb, id) {
  const f = convFile(nb, id);
  if (!fs.existsSync(f)) return false;
  fs.unlinkSync(f);
  return true;
}

export function renameConversation(nb, id, title) {
  const c = getConversation(nb, id);
  if (!c) return null;
  c.title = String(title ?? '').trim().slice(0, 200) || c.title;
  c.titleSet = true;
  return saveConversation(nb, c);
}

// ---------- notes ----------

const notesDir = (nb) => path.join(nb.dir, 'notes');

export function slugify(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'note';
}

// notes are markdown with a small front matter block
function parseNote(slug, raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const meta = {};
  if (m) for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  let title = meta.title;
  try { if (title) title = JSON.parse(title); } catch {}
  return {
    slug, title: title || slug, created: meta.created, updated: meta.updated,
    fromConversation: meta.fromConversation || null, kind: meta.kind || null,
    body: m ? raw.slice(m[0].length) : raw,
  };
}

export function listNotes(nb) {
  let names = [];
  try { names = fs.readdirSync(notesDir(nb)).filter((f) => f.endsWith('.md')); } catch { return []; }
  return names.map((f) => {
    const n = parseNote(f.slice(0, -3), fs.readFileSync(path.join(notesDir(nb), f), 'utf8'));
    return { slug: n.slug, title: n.title, created: n.created, updated: n.updated, kind: n.kind, fromConversation: n.fromConversation, chars: n.body.length };
  }).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
}

export function getNote(nb, slug) {
  if (!ID_RE.test(slug ?? '')) return null;
  const f = path.join(notesDir(nb), `${slug}.md`);
  return fs.existsSync(f) ? parseNote(slug, fs.readFileSync(f, 'utf8')) : null;
}

export function saveNote(nb, { title, body, fromConversation, kind, slug }) {
  const now = new Date().toISOString();
  const existing = slug ? getNote(nb, slug) : null;
  let s = existing ? slug : slugify(title);
  if (!existing) {
    const base = s;
    let n = 2;
    while (fs.existsSync(path.join(notesDir(nb), `${s}.md`))) s = `${base}-${n++}`;
  }
  const meta = [`title: ${JSON.stringify(title || existing?.title || s)}`, `created: ${existing?.created ?? now}`, `updated: ${now}`];
  if (fromConversation) meta.push(`fromConversation: ${fromConversation}`);
  if (kind) meta.push(`kind: ${kind}`);
  fs.mkdirSync(notesDir(nb), { recursive: true });
  fs.writeFileSync(path.join(notesDir(nb), `${s}.md`), `---\n${meta.join('\n')}\n---\n${body ?? ''}`);
  return getNote(nb, s);
}

export function deleteNote(nb, slug) {
  if (!ID_RE.test(slug ?? '')) return false;
  const f = path.join(notesDir(nb), `${slug}.md`);
  if (!fs.existsSync(f)) return false;
  fs.unlinkSync(f);
  return true;
}
