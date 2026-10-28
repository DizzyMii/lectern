// Drift watch for the desktop app: when a code root changes it re-checks the notebook's saved
// answers and sheets, remembers which ones got worse, and tells the caller. Nothing is saved here
// beyond what a normal re-check already writes.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import * as store from './store.mjs';
import * as studio from './studio/engine.mjs';
import { fileCache, changedSince } from './cite.mjs';
import { SKIP_DIRS } from './sources.mjs';

export const watchEvents = new EventEmitter();   // 'unseen' after the list below changed
const unseen = new Map();                         // "<nb>/<kind>/<id>" -> item
export const unseenList = () => [...unseen.values()];
export function markSeen(nb, kind, id) { if (unseen.delete(`${nb}/${kind}/${id}`)) watchEvents.emit('unseen'); }

// The hash public/app.js reads (#/<nb>/<conv> or #/<nb>/artifact/<id>), or null when an id would not pass ID_RE.
// A sheet is the artifact form.
export function hashFor(nb, kind, id) {
  if (![nb, id].every((s) => store.ID_RE.test(s ?? ''))) return null;
  return kind === 'sheet' ? `#/${nb}/artifact/${id}` : `#/${nb}/${id}`;
}

const clip = (s, n = 60) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const tick = () => new Promise((r) => setImmediate(r));

// Re-checks every saved answer and sheet of one notebook and returns the ones in which a citation
// changed during this pass: [{ nb, kind, id, label, n, moved, worse, hash }].
export async function recheckNotebook(nb) {
  const cache = fileCache();
  const visited = new Set();
  const found = [];

  const take = (kind, doc, label, check, worse, scope) => {
    const key = `${nb.id}/${kind}/${doc.id}`;
    visited.add(key);
    if (!check?.changed) { unseen.delete(key); return; }   // a mended answer leaves the list
    const hits = changedSince(scope, check.checkedAt);   // this check's own stamp, so a page opened mid-pass does not count
    const hash = hashFor(nb.id, kind, doc.id);
    if (!hits.length || !hash) return;                     // still off from an earlier pass: keep the old entry
    const item = { nb: nb.id, kind, id: doc.id, label, n: hits.length, moved: hits.every((x) => (x.refStatus ?? x.status) === 'moved'), worse, hash };
    unseen.set(key, item);
    found.push(item);
  };

  const convs = store.listConversations(nb);
  // the same numbering the rail shows (qnum in public/ui/layers.js)
  const order = [...convs].sort((a, b) => String(a.created || a.updated).localeCompare(String(b.created || b.updated)) || String(a.id).localeCompare(String(b.id)));
  for (const c of convs) {
    if (!(c.citations > 0)) continue;
    try {
      const conv = store.getConversation(nb, c.id, { recheck: true, cache });
      if (conv) take('answer', conv, `Question ${String(order.findIndex((o) => o.id === c.id) + 1).padStart(3, '0')}`, conv.citeCheck, conv.citeCheck.worse, (conv.turns ?? []).map((t) => t.citations));
    } catch (e) { console.error('drift watch:', c.id, e?.message ?? e); }   // one odd file must not stop the pass
    await tick();
  }
  for (const s of studio.listArtifacts(nb)) {
    if (s.status !== 'ok') continue;
    try {
      const a = studio.getArtifact(nb, s.id, { recheck: true, cache });
      if (a?.citeCheck) take('sheet', a, clip(a.title) || 'Sheet', a.citeCheck, (a.citeCheck.worse ?? 0) + (a.citeCheck.refs?.worse ?? 0), [a.citations, a.data]);
    } catch (e) { console.error('drift watch:', s.id, e?.message ?? e); }
    await tick();
  }
  // answers and sheets that were deleted since the last pass
  for (const key of [...unseen.keys()]) if (key.startsWith(`${nb.id}/`) && !visited.has(key)) unseen.delete(key);
  watchEvents.emit('unseen');
  return found;
}

// The notification text: the notebook title and counts. Never file text or the question.
export function describe(nb, items) {
  const n = items.reduce((t, i) => t + i.n, 0);
  const verb = items.every((i) => i.moved) ? 'Moved' : 'Changed';
  const what = `${n} citation${n === 1 ? '' : 's'}`;
  return { title: nb.title, body: items.length === 1 ? `${verb} ${what} in ${items[0].label}` : `${verb} ${what} across ${items.length} answers` };
}

// Watches every notebook's code roots. A burst of changes becomes one re-check of the notebooks
// that own the root. recheck and watch are injection points for tests.
export function startWatch({ onDrift, recheck = recheckNotebook, watch = fs.watch, wait = 3000, maxWait = 30_000, every = 30_000 }) {
  const roots = new Map();   // absolute root -> { watcher, ids }
  const pending = new Set();
  let timer = null;
  let first = 0;
  let queue = Promise.resolve();
  let stopped = false;

  const flush = () => {
    timer = null;
    const ids = [...pending];
    pending.clear();
    queue = queue.then(async () => {
      for (const id of ids) {
        if (stopped) return;
        try {
          const nb = store.getNotebook(id);
          if (!nb) continue;
          const found = await recheck(nb);
          if (found.length) onDrift(nb, found);
        } catch (e) { console.error('drift watch:', e?.message ?? e); }
      }
    });
  };
  // 3 s after the last event, but never later than maxWait after the first, so a log file that changes every second cannot starve the pass
  const poke = (ids) => {
    if (stopped) return;
    for (const id of ids) pending.add(id);
    if (!timer) first = Date.now();
    clearTimeout(timer);
    timer = setTimeout(flush, Math.max(0, Math.min(wait, first + maxWait - Date.now())));
  };

  const drop = (abs, watcher) => {
    try { watcher.close(); } catch {}
    if (roots.get(abs)?.watcher === watcher) roots.delete(abs);
  };

  const sync = () => {
    if (stopped) return;
    const want = new Map();
    try {
      for (const nb of store.listNotebooks()) {
        for (const rel of Object.values(nb.config.roots ?? {})) {
          if (typeof rel !== 'string') continue;
          const abs = path.resolve(nb.dir, rel);
          if (!want.has(abs)) want.set(abs, new Set());
          want.get(abs).add(nb.id);
        }
      }
    } catch (e) { console.error('drift watch:', e?.message ?? e); return; }
    for (const [abs, r] of roots) if (!want.has(abs)) { try { r.watcher.close(); } catch {} roots.delete(abs); }
    for (const [abs, ids] of want) {
      const known = roots.get(abs);
      if (known) {
        if (fs.existsSync(abs)) { known.ids = ids; continue; }
        drop(abs, known.watcher);   // the folder went away and no event said so
      }
      try {
        if (!fs.statSync(abs).isDirectory()) continue;
        const watcher = watch(abs, { recursive: true, persistent: false }, (_type, file) => {
          // A watched folder that gets deleted never raises 'error' on Windows. The handle keeps firing 'rename'
          // with the root's own absolute path as the name, hundreds of thousands of times a second.
          if ((file && path.isAbsolute(String(file))) || !fs.existsSync(abs)) {
            const dead = roots.get(abs);
            if (dead?.watcher === watcher) { drop(abs, watcher); poke(dead.ids); }
            return;
          }
          if (file && String(file).split(/[\\/]/).some((s) => SKIP_DIRS.has(s))) return;
          poke(roots.get(abs)?.ids ?? []);
        });
        // without a listener an error would throw in the main process
        watcher.on('error', () => drop(abs, watcher));
        roots.set(abs, { watcher, ids });
      } catch { /* missing, or on a drive that cannot be watched: try again next sync */ }
    }
  };

  sync();
  const poll = setInterval(sync, every);
  poll.unref?.();
  const stop = () => {
    stopped = true;
    clearInterval(poll);
    clearTimeout(timer);
    for (const r of roots.values()) { try { r.watcher.close(); } catch {} }
    roots.clear();
  };
  return { sync, stop };
}
