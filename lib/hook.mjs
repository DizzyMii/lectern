// Claude Code hooks: `lectern hook stop` checks the [[path#L12]] citations in Claude Code's last message against the
// notebook that holds the working directory; `lectern hook install` wires it into a repo.
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR, notebookFor, readJson, writeJson } from './store.mjs';
import { parseCitations, verify, whyNot, fileCache } from './cite.mjs';
import { isLink, within, realOf } from './paths.mjs';

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
// fenced blocks (any fence length, indented in a list item, an unclosed one runs to the end) and inline code: a citation in there is an example
const stripCode = (t) => t.replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\1[`~]*[ \t]*$|(?![\s\S]))/gm, '').replace(/(`+)[^`\n]*?\1/g, '');

// where a path as Claude Code wrote it points: beside the working directory, inside a code root, or as the notebook knows it.
// Containment is verify()'s job, so a ../ that leaves the notebook just comes back missing.
function locate(nb, cwd, p) {
  const s = p.replace(/\\/g, '/');
  if (path.isAbsolute(s) || /^[A-Za-z]:/.test(s)) return p;
  const roots = Object.values(nb.config.roots).map((r) => path.resolve(nb.dir, r));
  const abs = [cwd, ...roots].map((b) => path.resolve(b, s)).find((a) => fs.existsSync(a));
  if (!abs) return p;
  // verify() checks containment by spelling, so a cwd reached through a junction is put back in the notebook's own spelling
  const at = realOf(abs);
  for (const b of [nb.dir, ...roots]) if (within(realOf(b), at)) return path.join(b, path.relative(realOf(b), at));
  return p;
}

// null lets Claude stop. Otherwise the JSON to print: { decision, reason } to block, or { systemMessage } once stop_hook_active is set.
export function stopVerdict(data, { max = 10 } = {}) {
  if (process.env.LECTERN_OWN_RUN === '1') return null;
  const text = typeof data?.last_assistant_message === 'string' ? data.last_assistant_message : '';
  if (!text.includes('[[')) return null; // the common case costs nothing
  const cites = parseCitations(stripCode(text)).filter((c) => c.line != null || c.quote);
  if (!cites.length) return null;
  const cwd = typeof data.cwd === 'string' && data.cwd ? data.cwd : process.cwd();
  const nb = notebookFor(cwd);
  if (!nb) return null;
  const roots = nb.config.roots, cache = fileCache(), fails = [];
  for (const c of new Map(cites.map((x) => [x.raw, x])).values()) {
    const at = { ...c, path: locate(nb, cwd, c.path) };
    const v = verify(nb.dir, at, roots, cache);
    // moved and verified pass: a moved quote is still in the file
    if (v.status === 'unverified' || v.status === 'missing') fails.push(`- ${clip(c.raw, 120)} ${whyNot(nb.dir, at, v, roots, cache)}`);
  }
  if (!fails.length) return null;
  const list = [...fails.slice(0, max), ...(fails.length > max ? [`- and ${fails.length - max} more`] : [])].join('\n');
  const head = `Lectern could not verify ${fails.length} ${fails.length === 1 ? 'citation' : 'citations'} in your last message against the "${nb.title}" notebook:\n${list}`;
  if (data.stop_hook_active) return { systemMessage: `${head}\nThey are still in the final message.` };
  return { decision: 'block', reason: `${head}\nRead the file and fix each one, or remove it. Cite only lines you read, as [[path#L12]], [[path#L12-L20]] or [[path|"exact quote"]].` };
}

// same quoting as sandboxArgs in engine.mjs: forward slashes, both paths quoted
const fwd = (p) => p.split(path.sep).join('/');
export const hookCommand = () => `"${fwd(process.execPath)}" "${fwd(path.join(APP_DIR, 'bin', 'lectern.mjs'))}" hook stop`;
// exec form (command = node, args = [script, 'hook', 'stop']) is what the README gives Windows users without Git Bash
const isExec = (h) => Array.isArray(h?.args) && h.args.slice(-2).join(' ') === 'hook stop' && /lectern\.mjs$/.test(h.args.at(-3) ?? '');
const entry = (exec) => ({ hooks: [exec ? { type: 'command', command: process.execPath, args: [path.join(APP_DIR, 'bin', 'lectern.mjs'), 'hook', 'stop'], timeout: 30 } : { type: 'command', command: hookCommand(), timeout: 30 }] });
const ours = (e) => Array.isArray(e?.hooks) && e.hooks.some((h) => isExec(h) || /lectern\.mjs"? hook stop$/.test(h?.command ?? ''));
const bad = (m) => Object.assign(new Error(m), { usage: true });

// Returns { file, snippet, wrote, notebook }. With write, merges one Stop entry into <dir>/.claude/settings.local.json
// (replacing an earlier Lectern entry, keeping everything else) and refuses a file it cannot merge into.
export function installHook({ dir, write = false }) {
  const file = path.join(dir, '.claude', 'settings.local.json');
  const snippet = { hooks: { Stop: [entry()] } };
  if (write) {
    if (isLink(file) || isLink(path.dirname(file))) throw bad(`${file} is a link; Lectern does not write through links`);
    const cur = fs.existsSync(file) ? readJson(file, undefined) : {};
    const hooks = cur?.hooks;
    if (!cur || typeof cur !== 'object' || Array.isArray(cur) || (hooks != null && (typeof hooks !== 'object' || Array.isArray(hooks) || (hooks.Stop != null && !Array.isArray(hooks.Stop))))) {
      throw bad(`${file} is not a settings object Lectern can merge into; add the snippet by hand`);
    }
    const stop = hooks?.Stop ?? [];
    writeJson(file, { ...cur, hooks: { ...hooks, Stop: [...stop.filter((e) => !ours(e)), entry(stop.some((e) => ours(e) && e.hooks.some(isExec)))] } });
  }
  return { file, snippet, wrote: write, notebook: notebookFor(dir) };
}

// The one entry the CLI calls. argv is everything after `hook`.
export async function hookCmd(argv) {
  const [sub] = argv;
  if (sub === 'stop') {
    let out = null;
    try { out = stopVerdict(JSON.parse(fs.readFileSync(0, 'utf8'))); } catch (e) { process.stderr.write(`lectern hook: ${e.message}\n`); }
    if (out) await new Promise((r) => process.stdout.write(JSON.stringify(out) + '\n', r)); // flushed before bin calls process.exit
    return 0;
  }
  if (sub === 'install') {
    try {
      const i = argv.indexOf('--dir');
      if (i >= 0 && (!argv[i + 1] || argv[i + 1].startsWith('--'))) throw bad('--dir needs a folder');
      const dir = path.resolve(i >= 0 ? argv[i + 1] : '.');
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw bad(`not a folder: ${dir}`);
      const r = installHook({ dir, write: argv.includes('--write') });
      console.log(r.wrote ? `merged into ${r.file}` : `Add this to ${r.file} (the personal, uncommitted settings file), or run again with --write to merge it:`);
      console.log(JSON.stringify(r.snippet, null, 2));
      console.log(r.notebook ? `This folder is inside notebook "${r.notebook.id}", so the check will run here.` : 'This folder is not inside any notebook folder or code root yet, so the check will do nothing until you add it: lectern add <notebook> <this folder>');
      console.log('Claude only writes [[path#L12]] citations when it is asked to; add a line about them to CLAUDE.md.');
      return 0;
    } catch (e) { if (!e.usage) throw e; console.error(`${e.message}\nsee lectern --help`); return 2; }
  }
  console.error('hook needs stop or install\nsee lectern --help');
  return 2;
}
