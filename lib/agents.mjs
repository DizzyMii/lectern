// Registers `lectern mcp` with Claude Code and Cursor for the desktop app. The app runs it as
// <Lectern.exe> <app>/bin/lectern.mjs mcp with ELECTRON_RUN_AS_NODE=1; the build has asar off, so that file is real.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findClaude, claudeEnv } from './engine.mjs';

export const SERVER = 'lectern';
const PORTABLE = 'The portable Lectern.exe unpacks to a new temporary folder every time it starts, so an agent could not find it again. Install with Lectern Setup.exe, or use the command below.';
const NO_CLAUDE = 'Lectern could not find the claude program. Install Claude Code, or set Claude Code binary above to the full path of claude.exe and open Settings again.';
const pexec = promisify(execFile);
const run = (bin, args, env) => pexec(bin, args, { env, windowsHide: true, timeout: 30_000, maxBuffer: 1 << 20 });
// claude and the fs errors are short and plain; keep the first line, never a dump
const oneLine = (e) => String(e?.stderr || e?.stdout || e?.message || e).trim().split('\n')[0].trim().slice(0, 300) || 'it failed';

export const cursorFile = (home = os.homedir()) => path.join(home, '.cursor', 'mcp.json');

// t = { exe, script, home }: process.execPath, <app>/bin/lectern.mjs, and the resolved LECTERN_HOME when the app was started with one
export const mcpEntry = ({ exe, script, home }) => ({ command: exe, args: [script, 'mcp'], env: { ELECTRON_RUN_AS_NODE: '1', ...(home ? { LECTERN_HOME: home } : {}) } });

export const claudeAddArgs = (t) => ['mcp', 'add', SERVER, '--scope', 'user',
  ...Object.entries(mcpEntry(t).env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), '--', t.exe, t.script, 'mcp'];

// the portable build, or anything unpacked under the temp folder, is gone after the app quits
export function transientReason(exe, { env = process.env, tmp = os.tmpdir() } = {}) {
  const rel = path.relative(path.resolve(tmp), path.resolve(exe));
  return env.PORTABLE_EXECUTABLE_DIR || (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) ? PORTABLE : null;
}

function check(t, deps) {
  const gone = transientReason(t.exe, deps);
  if (gone) return gone;
  return fs.existsSync(t.exe) && fs.existsSync(t.script) ? null : 'Lectern could not find its own files to register. Reinstall the app and try again.';
}

export function status(t, deps = {}) {
  return { reason: check(t, deps), claude: Boolean('claude' in deps ? deps.claude : findClaude({})) };
}

const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };

// text is the current mcp.json (or null). Never rewrites a file it cannot parse; keeps every other key and server.
export function planCursor(text, entry) {
  const bad = (why) => ({ ok: false, error: `${why} Add the lectern server by hand, the README shows how.` });
  let doc = {};
  if (text != null && text.trim()) {
    try { doc = JSON.parse(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text); } catch { return bad('mcp.json is not plain JSON, so Lectern will not rewrite it.'); }
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return bad('mcp.json is not a JSON object.');
  const servers = doc.mcpServers ?? {};
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return bad('mcpServers in mcp.json is not an object.');
  const old = servers[SERVER];
  return {
    ok: true,
    text: JSON.stringify({ ...doc, mcpServers: { ...servers, [SERVER]: entry } }, null, 2) + '\n',
    replaces: old && typeof old === 'object' ? { command: String(old.command ?? ''), args: Array.isArray(old.args) ? old.args.map(String) : [] } : null,
    others: Object.keys(servers).filter((k) => k !== SERVER).length,
  };
}

export function writeCursor(entry, file = cursorFile()) {
  const text = readText(file);
  const plan = planCursor(text, entry);
  if (!plan.ok) return plan;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  // keep a 0600 file 0600; the tmp copy holds every server in it, so it never outlives a failed rename
  const mode = text != null ? fs.statSync(file).mode & 0o777 : 0o600;
  try {
    fs.writeFileSync(tmp, plan.text, { mode });
    if (text != null) fs.copyFileSync(file, `${file}.bak`);
    fs.renameSync(tmp, file);
  } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  return { ok: true, file, backup: text != null };
}

// What the confirm dialog shows. Never the file's own text: other servers in it can carry keys.
export function preview(id, t, deps = {}) {
  if (id !== 'cursor') return { ok: false, error: 'unknown agent' };
  const bad = check(t, deps);
  if (bad) return { ok: false, error: bad };
  const file = deps.file ?? cursorFile();
  let plan;
  try { plan = planCursor(readText(file), mcpEntry(t)); } catch (e) { return { ok: false, error: oneLine(e), file }; }
  return plan.ok ? { ok: true, file, entry: mcpEntry(t), replaces: plan.replaces, others: plan.others } : { ...plan, file };
}

export async function connect(id, t, deps = {}) {
  if (id !== 'claude-code' && id !== 'cursor') return { ok: false, error: 'unknown agent' };
  const bad = check(t, deps);
  if (bad) return { ok: false, error: bad };
  if (id === 'cursor') {
    try {
      const r = writeCursor(mcpEntry(t), deps.file);
      return r.ok ? { ok: true, message: `Written to ${r.file}${r.backup ? ', the old file is next to it as mcp.json.bak' : ''}. Reload Cursor if the lectern server does not show up.` } : r;
    } catch (e) { return { ok: false, error: oneLine(e) }; }
  }
  const claude = 'claude' in deps ? deps.claude : findClaude({});
  if (!claude) return { ok: false, error: NO_CLAUDE };
  const exec = deps.run ?? run, env = deps.env ?? claudeEnv();
  // an entry from an older install folder would make add fail, and it may not exist at all, so the remove result is ignored
  try { await exec(claude, ['mcp', 'remove', SERVER, '--scope', 'user'], env); } catch {}
  try { await exec(claude, claudeAddArgs(t), env); } catch (e) { return { ok: false, error: oneLine(e) }; }
  return { ok: true, message: 'Connected. Start a new Claude Code session to use it. To undo: claude mcp remove lectern --scope user' };
}
