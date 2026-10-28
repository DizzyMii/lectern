// HTTP server: JSON API, SSE streams, static UI and vendor files.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as store from './store.mjs';
import { ensureHome, lecternHome } from './home.mjs';
import * as sources from './sources.mjs';
import { ask, findClaude, claudeVersion, apiEngineAvailable, modelError, MODEL_ALIASES, pickEngine, engineStatus } from './engine.mjs';
import { budgetStatus } from './spend.mjs';
import { GENERATORS, listGenerators } from './generators.mjs';
import * as studio from './studio/engine.mjs';
import * as history from './history.mjs';
import { GROUPS, listRecipes } from './studio/recipes.mjs';
import { KINDS } from './studio/schemas.mjs';
import * as backlinks from './backlinks.mjs';
import { quietGlobWarning } from './warnings.mjs';
import { listSettings, saveSettings } from './settings.mjs';
import { recall } from './recall.mjs';

quietGlobWarning();

const { APP_DIR, httpError } = store;
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const requireHere = createRequire(import.meta.url);
// /vendor serves only lectern's own dependencies, and not the API SDK, which the browser never loads
const VENDOR = new Set(Object.keys(store.readJson(path.join(APP_DIR, 'package.json'), {}).dependencies ?? {}).filter((n) => n !== '@anthropic-ai/sdk'));
const PORT = Number(process.env.PORT ?? 4317);
const HOST = '127.0.0.1';
const MAX_BODY = 80 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.pdf': 'application/pdf',
};

// Model answers and fetched pages are rendered as HTML, so the page may load nothing from
// other hosts: a tag that slipped past the sanitizer still cannot send notebook text anywhere.
// The one inline script (the theme picker in index.html) is allowed by its hash.
let cspCache;
function csp() {
  if (cspCache) return cspCache;
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
  cspCache = [
    "default-src 'self'", `script-src 'self' ${hashes.join(' ')}`.trim(), "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "font-src 'self' data:", "media-src 'self'", "connect-src 'self'", "frame-src 'none'",
    "worker-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  ].join('; ');
  return cspCache;
}

// ---------- helpers ----------

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(httpError(413, 'body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(httpError(400, 'body is not valid JSON')); }
    });
    req.on('error', reject);
  });
}

function openSse(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write(': open\n\n');
  const beat = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15_000);
  res.on('close', () => clearInterval(beat));
  return {
    send(type, data) { if (!res.writableEnded) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`); },
    end() { clearInterval(beat); if (!res.writableEnded) res.end(); },
  };
}

// Only this app's own pages may talk to it. The Host check stops DNS rebinding. For the API,
// Sec-Fetch-Site, Origin and Referer stop other sites from reading or firing requests, even
// a plain <img> GET, and the content-type check stops simple cross-origin writes.
// LECTERN_PUBLIC_ORIGINS adds addresses a proxy serves the app on (Tailscale Serve, say). Requests
// for those must carry a Tailscale-User-Login listed in LECTERN_ALLOW_USERS: the proxy sets that
// header from the tailnet identity, and nothing off this machine can reach 127.0.0.1 to fake it.
export function remoteAccess(env = process.env) {
  const origins = String(env.LECTERN_PUBLIC_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean);
  const users = new Set(String(env.LECTERN_ALLOW_USERS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  const hosts = new Set();
  for (const o of origins) { try { hosts.add(new URL(o).host); } catch {} }
  return { origins, users, hosts };
}

function isLocal(req) {
  const host = String(req.headers.host ?? '').toLowerCase();
  return host === `127.0.0.1:${req.socket.localPort}` || host === `localhost:${req.socket.localPort}`;
}

function gate(req, pathname) {
  const port = req.socket.localPort;
  const remote = remoteAccess();
  const host = String(req.headers.host ?? '').toLowerCase();
  if (!isLocal(req)) {
    if (!remote.hosts.has(host)) return 'host not allowed';
    const who = String(req.headers['tailscale-user-login'] ?? '').toLowerCase();
    if (!remote.users.size || !remote.users.has(who)) return 'remote user not allowed';
  }
  const own = (u) => ['http://127.0.0.1', 'http://localhost'].some((o) => String(u).toLowerCase() === `${o}:${port}`) || remote.origins.includes(String(u).toLowerCase());
  const isApi = pathname.startsWith('/api/');
  const site = req.headers['sec-fetch-site'];
  if (isApi && (site === 'cross-site' || site === 'same-site')) return 'cross-origin request refused';
  const origin = req.headers.origin;
  if (origin != null && origin !== 'null' && !own(origin) && (isApi || (req.method !== 'GET' && req.method !== 'HEAD'))) return 'cross-origin request refused';
  if (isApi && origin === 'null') return 'cross-origin request refused';
  if (isApi && req.headers.referer) {
    let from = null;
    try { from = new URL(req.headers.referer).origin; } catch {}
    if (!own(from)) return 'cross-origin request refused';
  }
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] != null;
  if (hasBody && !/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) return 'content-type must be application/json';
  return null;
}

function needNotebook(id) {
  const nb = store.getNotebook(decodeURIComponent(id));
  if (!nb) throw httpError(404, `no notebook ${id}`);
  return nb;
}

async function notebookSummary(nb) {
  const shelf = await sources.getShelf(nb);
  return {
    id: nb.id, title: nb.title, color: nb.color, description: nb.description,
    counts: {
      docs: shelf.stats.docs, files: shelf.stats.files, roots: Object.keys(nb.config.roots).length,
      conversations: store.listConversations(nb).length, notes: store.listNotes(nb).length,
    },
    tokens: shelf.stats.tokens,
    spend: budgetStatus(nb),
  };
}

function suggestions(nb) {
  if (Array.isArray(nb.config.suggestions)) return nb.config.suggestions.slice(0, 4);
  const q = store.readJson(path.join(nb.dir, 'questions.json'), null);
  const list = (q?.questions ?? []).map((x) => x.q).filter(Boolean);
  return list.slice(0, 4);
}

function footnotes(citations) {
  return citations.map((c) => `[^${c.n}]: ${c.path}${c.line ? `:${c.line}${c.endLine && c.endLine !== c.line ? `-${c.endLine}` : ''}` : ''}${c.quote ? ` "${c.quote}"` : ''} (${c.status})`).join('\n');
}

function checkAsk(body, needQuestion = true) {
  if (needQuestion && !String(body.question ?? '').trim()) throw httpError(400, 'question is required');
  const bad = modelError(body.model);
  if (bad) throw httpError(400, bad);
  if (body.scope != null && (!Array.isArray(body.scope) || body.scope.length > 50 || body.scope.some((s) => typeof s !== 'string' || s.length > 200))) throw httpError(400, 'scope must be a list of source names');
}

function runAskSse(req, res, nb, opts, onDone) {
  const sse = openSse(res);
  let finished = false;
  let job;
  try {
    job = ask({
      notebook: nb, ...opts,
      onEvent: (e) => {
        if (e.type === 'done') return; // sent below once side effects are done
        sse.send(e.type, e);
      },
    });
  } catch (e) {
    sse.send('error', { message: e.message });
    return sse.end();
  }
  res.on('close', () => { if (!finished) job.cancel(); });
  job.done.then(
    async (out) => {
      finished = true;
      const extra = onDone ? await onDone(out) : {};
      sse.send('done', { ...out, ...extra });
      sse.end();
    },
    () => { finished = true; sse.end(); }, // the error event already went out
  );
}

// Studio runs: same SSE framing as ask, ending in done{artifact} or error{message, artifact?}.
function runStudioSse(req, res, nb, prepared, opts) {
  const sse = openSse(res);
  let finished = false;
  const job = studio.run(nb, prepared, { ...opts, onEvent: (e) => sse.send(e.type, e) });
  res.on('close', () => { if (!finished) job.cancel(); });
  job.done.then(() => {}, () => {}).finally(() => { finished = true; sse.end(); });
}

function studioOpts(body) {
  checkAsk(body, false);
  return {
    model: body.model || 'opus', effort: body.effort || undefined,
    engine: pickEngine(body.engine),
  };
}

async function studioRoute(req, res, nb, aid, action, m) {
  if (!aid) {
    if (m === 'GET') return sendJson(res, 200, studio.listArtifacts(nb));
    if (m === 'POST') {
      const body = await readBody(req);
      const opts = studioOpts(body);
      const prepared = await studio.prepare(nb, body.recipe, body.inputs ?? {});
      if (!body.model && prepared.recipe.model) opts.model = prepared.recipe.model;
      return runStudioSse(req, res, nb, prepared, opts);
    }
    return null;
  }
  const a = studio.getArtifact(nb, aid, { recheck: m === 'GET' && !action });
  if (!a) return sendJson(res, 404, { error: 'no such artifact' });
  if (!action) {
    if (m === 'GET') return sendJson(res, 200, a);
    if (m === 'DELETE') return sendJson(res, 200, { ok: studio.deleteArtifact(nb, aid) });
    if (m === 'PATCH') return sendJson(res, 200, studio.patchArtifact(nb, aid, await readBody(req)));
    return null;
  }
  if (m !== 'POST') return null;
  const body = await readBody(req);
  if (action === 'regenerate') {
    const opts = studioOpts({ ...body, model: body.model || a.model });
    const prepared = await studio.prepare(nb, a.recipe, a.inputs ?? {});
    return runStudioSse(req, res, nb, prepared, { ...opts, artifactId: a.id });
  }
  if (action === 'export') return sendJson(res, 200, studio.exportArtifact(a, body.format));
  if (action === 'write') {
    try {
      return sendJson(res, 200, studio.writeArtifactFile(nb, a, body));
    } catch (e) {
      if (e.exists) return sendJson(res, 409, { error: e.message, exists: true, path: e.path });
      throw e;
    }
  }
  return null;
}

// ---------- static ----------

function serveFile(res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return sendJson(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': st.size, 'cache-control': cache });
    fs.createReadStream(file).pipe(res);
  });
}

function underDir(base, rel) {
  const target = path.resolve(base, '.' + path.posix.normalize('/' + rel));
  const r = path.relative(base, target);
  return r.startsWith('..') || path.isAbsolute(r) ? null : target;
}

// The folder of an installed package wherever npm put it, hoisted or nested.
const pkgDirs = new Map();
function packageDir(name) {
  if (pkgDirs.has(name)) return pkgDirs.get(name);
  let dir = null;
  try { dir = path.dirname(requireHere.resolve(`${name}/package.json`)); } catch {
    // exports can hide package.json, so walk up from the entry point instead
    try {
      for (let d = path.dirname(requireHere.resolve(name)); d !== path.dirname(d); d = path.dirname(d)) {
        if (store.readJson(path.join(d, 'package.json'), {}).name === name) { dir = d; break; }
      }
    } catch {}
  }
  pkgDirs.set(name, dir);
  return dir;
}

function vendorFile(rel) {
  const parts = rel.split('/');
  const n = parts[0].startsWith('@') ? 2 : 1;
  const name = parts.slice(0, n).join('/');
  if (!VENDOR.has(name)) return null;
  const dir = packageDir(name);
  return dir && underDir(dir, parts.slice(n).join('/'));
}

// highlight.js's lib/core.js is CommonJS; this wraps it as a module so the page needs no eval
function serveHljsCore(res) {
  const dir = packageDir('highlight.js');
  let src;
  try { src = fs.readFileSync(path.join(dir, 'lib', 'core.js'), 'utf8'); } catch { return sendJson(res, 404, { error: 'not found' }); }
  const body = `const module = { exports: {} }; const exports = module.exports;\n${src}\nexport default module.exports;\n`;
  res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'public, max-age=86400' });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  if (pathname === '/vendor/highlight.js/lib/core.esm.js') return serveHljsCore(res);
  if (pathname.startsWith('/vendor/')) {
    const file = vendorFile(decodeURIComponent(pathname.slice('/vendor/'.length)));
    if (!file) return sendJson(res, 403, { error: 'forbidden' });
    return serveFile(res, file, 'public, max-age=86400');
  }
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = underDir(PUBLIC_DIR, rel);
  if (!file) return sendJson(res, 403, { error: 'forbidden' });
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return serveFile(res, file, 'no-cache');
  // unknown paths without an extension fall back to the app shell
  if (!path.extname(rel)) return serveFile(res, path.join(PUBLIC_DIR, 'index.html'), 'no-cache');
  return sendJson(res, 404, { error: 'not found' });
}

// ---------- routes ----------

async function route(req, res) {
  const url = new URL(req.url, `http://${HOST}`);
  const p = url.pathname;
  const m = req.method;
  const q = (k) => url.searchParams.get(k);
  let mm;

  const refused = gate(req, p);
  if (refused) return sendJson(res, 403, { error: refused });

  if (!p.startsWith('/api/')) {
    if (m !== 'GET' && m !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' });
    return serveStatic(req, res, p);
  }

  if (p === '/api/status' && m === 'GET') {
    const bin = findClaude();
    return sendJson(res, 200, {
      ok: true,
      claude: { found: Boolean(bin), path: bin, version: claudeVersion() },
      apiEngine: apiEngineAvailable(),
      engine: engineStatus(),
      fakeEngine: process.env.LECTERN_FAKE_ENGINE === '1',
      models: MODEL_ALIASES,
      generators: listGenerators(),
    });
  }

  // earlier answers, notes and sheets in every notebook that read like the typed text; read-only
  if (p === '/api/recall' && m === 'GET') {
    const text = String(q('q') ?? '').trim();
    if (!text) throw httpError(400, 'q is required');
    const hits = recall(store.listNotebooks(), text.slice(0, 500), {
      mode: q('mode') === 'hint' ? 'hint' : 'search',
      kinds: q('kinds') ? q('kinds').split(',') : undefined,
      limit: Number(q('limit')) || 5,
      skip: q('nb') && q('skip') ? { notebook: q('nb'), id: q('skip') } : null,
    });
    return sendJson(res, 200, { hits: hits.map(({ text, citations, ...h }) => h) });
  }

  // a phone on the tailnet can look at settings, only this machine can change them
  if (p === '/api/settings') {
    if (m === 'GET') return sendJson(res, 200, { settings: listSettings(), editable: isLocal(req) });
    if (m === 'PUT') {
      if (!isLocal(req)) return sendJson(res, 403, { error: 'settings can only be changed on this machine' });
      return sendJson(res, 200, { settings: saveSettings(await readBody(req)), editable: true });
    }
  }

  // first-run suggestions: folders in LECTERN_PROJECTS_DIR (or the user's home) and beside roots and notebooks already added
  if (p === '/api/candidates' && m === 'GET') {
    const nbs = store.listNotebooks();
    const taken = nbs.flatMap((nb) => Object.values(nb.config.roots ?? {}).map((rel) => path.resolve(nb.dir, rel)));
    const scanned = process.env.LECTERN_PROJECTS_DIR || os.homedir();
    const dirs = [scanned, ...taken.map((t) => path.dirname(t)), ...nbs.map((nb) => path.dirname(nb.dir))];
    return sendJson(res, 200, { ...sources.candidates([...new Set(dirs)], [...taken, ...nbs.map((nb) => nb.dir), store.lecternHome()]), scanned: store.toPosix(scanned) });
  }

  if (p === '/api/notebooks') {
    if (m === 'GET') return sendJson(res, 200, await Promise.all(store.listNotebooks().map(notebookSummary)));
    if (m === 'POST') {
      const body = await readBody(req);
      const nb = store.createNotebook({ id: body.id, title: body.title, color: body.color });
      return sendJson(res, 201, await notebookSummary(nb));
    }
  }

  if ((mm = p.match(/^\/api\/notebooks\/([^/]+)$/)) && m === 'GET') {
    const nb = needNotebook(mm[1]);
    const shelf = await sources.getShelf(nb);
    return sendJson(res, 200, {
      id: nb.id, title: nb.title, color: nb.color, description: nb.description, dir: store.toPosix(nb.dir),
      config: nb.config,
      shelf: shelf.summary,
      stats: { ...shelf.stats, roots: Object.keys(nb.config.roots).length },
      tokens: shelf.stats.tokens,
      spend: budgetStatus(nb),
      pinned: nb.config.pinned,
      roots: sources.rootsInfo(nb),
      conversations: store.listConversations(nb),
      notes: store.listNotes(nb),
      suggestions: suggestions(nb),
      generators: listGenerators(),
    });
  }

  if ((mm = p.match(/^\/api\/notebooks\/([^/]+)\/studio$/)) && m === 'GET') {
    const nb = needNotebook(mm[1]);
    return sendJson(res, 200, {
      groups: GROUPS, kinds: KINDS, exports: studio.EXPORTS, models: MODEL_ALIASES,
      recipes: listRecipes(), roots: Object.keys(nb.config.roots ?? {}),
    });
  }

  if ((mm = p.match(/^\/api\/notebooks\/([^/]+)\/cited$/)) && m === 'GET') return sendJson(res, 200, backlinks.citedBy(needNotebook(mm[1]), q('path')));

  if ((mm = p.match(/^\/api\/notebooks\/([^/]+)\/artifacts(?:\/([^/]+)(?:\/(regenerate|export|write))?)?$/))) {
    const nb = needNotebook(mm[1]);
    const handled = await studioRoute(req, res, nb, mm[2] ? decodeURIComponent(mm[2]) : null, mm[3] ?? null, m);
    if (handled !== null) return handled;
    return sendJson(res, 405, { error: `method not allowed: ${m} ${p}` });
  }

  if ((mm = p.match(/^\/api\/notebooks\/([^/]+)\/history\/(was|changes)$/)) && m === 'GET') {
    const nb = needNotebook(mm[1]);
    // spawns git, so only the machine Lectern runs on may ask
    if (!isLocal(req)) return sendJson(res, 403, { error: 'history can only be read on this machine' });
    if (mm[2] === 'was') return sendJson(res, 200, await history.fileAt(nb, q('path'), q('sha')));
    return sendJson(res, 200, await history.changesSince(nb, q('path'), q('sha'), Number.parseInt(q('line'), 10) || null, Number.parseInt(q('endLine'), 10) || null));
  }

  if ((mm = p.match(/^\/api\/notebooks\/([^/]+)\/(file|files|tree|search|ask|sources|notes|generate)(?:\/([^/]+))?$/))) {
    const nb = needNotebook(mm[1]);
    const what = mm[2];
    const sub = mm[3] ? decodeURIComponent(mm[3]) : null;

    if (what === 'file' && m === 'GET') return sendJson(res, 200, sources.readFile(nb, q('path')));
    if (what === 'files' && m === 'GET') {
      const all = await sources.allFiles(nb);
      return sendJson(res, 200, { files: all.slice(0, 50_000).map((f) => ({ path: f.path, root: f.root ?? null })), truncated: all.length > 50_000 });
    }
    if (what === 'tree' && m === 'GET') return sendJson(res, 200, sources.tree(nb, q('root'), q('dir') ?? ''));
    if (what === 'search' && m === 'GET') {
      const r = await sources.search(nb, q('q'), { regex: q('regex') === '1' });
      return sendJson(res, 200, { hits: r.hits, truncated: r.truncated, ms: r.ms, engine: r.engine ?? null });
    }

    if (what === 'ask' && m === 'POST') {
      const body = await readBody(req);
      checkAsk(body);
      const engine = body.engine ? pickEngine(body.engine) : undefined;
      return runAskSse(req, res, nb, {
        question: body.question, conversationId: body.conversationId || undefined,
        model: body.model || 'opus', effort: body.effort || undefined, engine, scope: body.scope || undefined, override: body.override === true,
      });
    }

    if (what === 'generate' && m === 'POST') {
      const body = await readBody(req);
      const g = GENERATORS[body.kind];
      if (!g) throw httpError(400, `unknown generator ${body.kind}`);
      checkAsk(body, false);
      const engine = body.engine ? pickEngine(body.engine) : undefined;
      return runAskSse(req, res, nb, { question: g.prompt, model: body.model || 'opus', effort: body.effort || undefined, engine, persist: false, kind: body.kind, override: body.override === true },
        (out) => {
          const note = store.saveNote(nb, {
            title: `${g.title} (${new Date().toISOString().slice(0, 10)})`,
            body: `${out.answer.trim()}\n\n${footnotes(out.citations)}\n`,
            kind: body.kind,
          });
          return { note: { slug: note.slug, title: note.title } };
        });
    }

    if (what === 'sources') {
      if (m === 'POST') {
        const body = await readBody(req);
        if ((req.headers.accept ?? '').includes('text/event-stream')) {
          const sse = openSse(res);
          try {
            const r = await sources.addSource(nb, body, (message) => sse.send('progress', { message }));
            sse.send('done', r);
          } catch (e) { sse.send('error', { message: e.message }); }
          return sse.end();
        }
        return sendJson(res, 201, await sources.addSource(nb, body));
      }
      if (m === 'DELETE') return sendJson(res, 200, sources.removeSource(nb, await readBody(req)));
    }

    if (what === 'notes') {
      if (m === 'GET' && sub) {
        const n = store.getNote(nb, sub);
        return n ? sendJson(res, 200, n) : sendJson(res, 404, { error: 'no such note' });
      }
      if (m === 'GET') return sendJson(res, 200, store.listNotes(nb));
      if (m === 'POST' || m === 'PUT') {
        const body = await readBody(req);
        if (!body.title && !body.body) throw httpError(400, 'note needs a title or body');
        return sendJson(res, 201, store.saveNote(nb, { ...body, slug: sub ?? body.slug }));
      }
      if (m === 'DELETE') {
        const slug = sub ?? q('slug') ?? (await readBody(req)).slug;
        return store.deleteNote(nb, slug) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'no such note' });
      }
    }
  }

  if ((mm = p.match(/^\/api\/conversations\/([^/]+)\/([^/]+)$/))) {
    const nb = needNotebook(mm[1]);
    const id = decodeURIComponent(mm[2]);
    // the saved API transcript (conv.api) holds every file the model read, so it stays on disk
    const shown = ({ api, ...c }) => c;
    if (m === 'GET') {
      const c = store.getConversation(nb, id, { recheck: true });
      return c ? sendJson(res, 200, shown(c)) : sendJson(res, 404, { error: 'no such conversation' });
    }
    if (m === 'DELETE') return store.deleteConversation(nb, id) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'no such conversation' });
    if (m === 'PATCH') {
      const body = await readBody(req);
      const c = store.renameConversation(nb, id, body.title);
      return c ? sendJson(res, 200, shown(c)) : sendJson(res, 404, { error: 'no such conversation' });
    }
  }

  return sendJson(res, 404, { error: `no route ${m} ${p}` });
}

export function createServer() {
  return http.createServer((req, res) => {
    res.setHeader('content-security-policy', csp());
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    route(req, res).catch((e) => {
      if (res.headersSent) { try { res.end(); } catch {} return; }
      sendJson(res, e.status ?? 500, { error: e.message });
    });
  });
}

// Resolves with the listening server, or null when the port is already taken.
export function startServer({ port = PORT, host = HOST } = {}) {
  ensureHome();
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', (e) => {
      if (e.code !== 'EADDRINUSE') return reject(e);
      console.log(`port ${port} is taken, Lectern is probably already running: http://${host}:${port}`);
      resolve(null);
    });
    srv.listen(port, host, () => {
      console.log(`Lectern on http://${host}:${srv.address().port} (home ${lecternHome()})`);
      resolve(srv);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().then((srv) => { if (!srv) process.exit(0); });
}
