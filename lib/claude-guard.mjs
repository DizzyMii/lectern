// PreToolUse hook for claude -p runs. Claude Code passes the tool call as JSON on stdin; a Read,
// Grep or Glob outside the notebook and its roots exits 2, which blocks the call.
// argv[2] is the allowed folders as base64url JSON.
import fs from 'node:fs';
import { realInside } from './paths.mjs';
import path from 'node:path';

const allowed = JSON.parse(Buffer.from(process.argv[2] ?? '', 'base64url').toString('utf8') || '[]');

// Claude Code on Windows can hand over /d/x style paths
const native = (p) => (process.platform === 'win32' ? String(p).replace(/^\/([A-Za-z])(\/|$)/, '$1:/') : String(p));
// the folder part of a glob, before the first wildcard
const staticPart = (g) => native(g).split(/[\\/]/).filter((_, i, a) => !a.slice(0, i + 1).some((s) => /[*?[{]/.test(s))).join('/') || (/^[\\/]/.test(g) ? '/' : '.');

function targets(name, input = {}) {
  if (name === 'Read') return [input.file_path];
  if (name === 'Grep') return [input.path ?? '.'];
  if (name === 'Glob') {
    const out = [input.path ?? '.'];
    const g = input.pattern ? native(input.pattern) : '';
    if (path.isAbsolute(g)) out.push(staticPart(g));
    else if (/(^|[\\/])\.\.([\\/]|$)/.test(g)) out.push(path.join(native(input.path ?? '.'), staticPart(g)));
    return out;
  }
  return [];
}

let data = {};
try { data = JSON.parse(fs.readFileSync(0, 'utf8')); } catch {}
const cwd = data.cwd || process.cwd();
const bad = targets(data.tool_name, data.tool_input).find((t) => {
  if (t == null || t === '') return true;
  const abs = path.resolve(cwd, native(t));
  return !allowed.some((dir) => realInside(dir, abs));
});
if (bad !== undefined) {
  process.stderr.write(`Lectern only lets this notebook read inside its own folder and code roots; ${bad} is outside them.`);
  process.exit(2);
}
process.exit(0);
