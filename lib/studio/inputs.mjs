// Resolves recipe inputs on the server: roots, earlier artifacts, git diffs and logs.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { httpError, toPosix } from '../store.mjs';
import { gitConfigArgs, childEnv, riskyConfig } from '../gitsafe.mjs';

export const INPUT_TYPES = ['text', 'longtext', 'root', 'artifact', 'diff', 'gitlog', 'path'];

export const DIFF_CAP = 400 * 1024;
export const LOG_COMMITS = 2000;
const TEXT_CAP = 40_000;
const ARTIFACT_CAP = 120_000;
// a revision range, never an option: no leading dash, no spaces
const RANGE_RE = /^(?!-)[A-Za-z0-9._\/~^@{}:+-]{1,200}$/;

// Runs git with plain args (no shell). Stops reading at cap bytes and reports truncation.
export function git(cwd, args, { cap = DIFF_CAP, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    let c;
    try { c = spawn('git', [...gitConfigArgs(), '-C', cwd, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: childEnv() }); }
    catch (e) { return reject(httpError(500, `could not run git: ${e.message}`)); }
    const chunks = [];
    let size = 0, truncated = false, err = '';
    const timer = setTimeout(() => { c.kill(); }, timeoutMs);
    c.stdout.on('data', (d) => {
      if (truncated) return;
      if (size + d.length > cap) { chunks.push(d.subarray(0, cap - size)); size = cap; truncated = true; c.kill(); return; }
      chunks.push(d); size += d.length;
    });
    c.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    c.on('error', (e) => { clearTimeout(timer); reject(httpError(500, e.code === 'ENOENT' ? 'git is not on PATH' : e.message)); });
    c.on('close', (code) => {
      clearTimeout(timer);
      if (!truncated && code !== 0) return reject(httpError(400, `git ${args[0]} failed: ${err.trim().split('\n').slice(-2).join(' ') || `exit ${code}`}`));
      resolve({ text: Buffer.concat(chunks).toString('utf8'), truncated });
    });
  });
}

function rootInfo(nb, name) {
  const roots = nb.config.roots ?? {};
  if (!name || !Object.hasOwn(roots, name)) {
    throw httpError(400, `unknown root ${JSON.stringify(name ?? '')}; roots are: ${Object.keys(roots).join(', ') || '(none)'}`);
  }
  const abs = path.resolve(nb.dir, roots[name]);
  return { name, path: toPosix(roots[name]), abs: toPosix(abs) };
}

// for git inputs: the root must exist, and its repo config must not name programs for git to run
export function rootDir(nb, name) {
  const r = rootInfo(nb, name);
  if (!fs.existsSync(r.abs)) throw httpError(400, `root ${name} does not exist on disk`);
  const risky = riskyConfig(r.abs);
  if (risky.length) throw httpError(400, `root ${name} has git config that runs programs (${risky.join(', ')}); Lectern will not run git there`);
  return r;
}

function checkRange(range) {
  const r = String(range ?? '').trim();
  if (!RANGE_RE.test(r)) throw httpError(400, `bad git range ${JSON.stringify(range ?? '')}: use something like main..HEAD or v1.2.0..v1.3.0`);
  return r;
}

export async function resolveDiff(nb, value) {
  if (typeof value === 'string') {
    if (!value.trim()) throw httpError(400, 'the diff is empty');
    const truncated = Buffer.byteLength(value) > DIFF_CAP;
    return { source: 'paste', text: truncated ? Buffer.from(value).subarray(0, DIFF_CAP).toString('utf8') : value, truncated };
  }
  if (!value || typeof value !== 'object') throw httpError(400, 'diff must be pasted text or {root, range}');
  const r = rootDir(nb, value.root);
  const range = checkRange(value.range);
  const out = await git(r.abs, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', range, '--', '.']);
  if (!out.text.trim()) throw httpError(400, `git diff ${range} in ${r.name} is empty`);
  return { source: 'git', root: r.name, range, text: out.text, truncated: out.truncated };
}

export async function resolveGitlog(nb, value) {
  if (!value || typeof value !== 'object') throw httpError(400, 'gitlog needs {root, range}');
  const r = rootDir(nb, value.root);
  const range = checkRange(value.range);
  // fields split by 0x1f, records by 0x1e
  const out = await git(r.abs, ['log', '--no-merges', '--no-color', `--max-count=${LOG_COMMITS}`, '--date=short', '--format=%x1e%h%x1f%ad%x1f%an%x1f%s%x1f%b', range, '--', '.']);
  const commits = out.text.split('\x1e').filter((s) => s.trim()).map((rec) => {
    const [hash, date, author, subject, body = ''] = rec.split('\x1f');
    return { hash: hash.trim(), date, author, subject, body: body.trim() };
  });
  if (!commits.length) throw httpError(400, `git log ${range} in ${r.name} has no commits`);
  const text = commits.map((c) => {
    const body = c.body ? '\n' + c.body.split('\n').filter((l) => l.trim()).slice(0, 6).map((l) => '    ' + l.trim()).join('\n') : '';
    return `${c.hash} ${c.date} ${c.author}: ${c.subject}${body}`;
  }).join('\n');
  return { source: 'git', root: r.name, range, count: commits.length, text, truncated: out.truncated };
}

// Text form of an earlier artifact, used when it feeds another recipe.
export function artifactText(a) {
  const foot = (a.citations ?? []).map((c) => `[^${c.n}]: ${c.path}${c.line ? `#L${c.line}${c.endLine && c.endLine !== c.line ? `-L${c.endLine}` : ''}` : ''}${c.quote ? ` "${c.quote}"` : ''}`).join('\n');
  let body;
  if (a.kind === 'doc' || a.markdown) body = a.markdown ?? '';
  else body = `${a.summary ? a.summary + '\n\n' : ''}\`\`\`json\n${JSON.stringify(a.data ?? null, null, 2)}\n\`\`\``;
  const text = `${body}${foot ? `\n\nSources behind the [^n] markers above:\n${foot}` : ''}`;
  return text.length > ARTIFACT_CAP ? text.slice(0, ARTIFACT_CAP) + '\n\n[artifact truncated]' : text;
}

function checkPath(p) {
  const s = String(p ?? '').trim().replace(/\\/g, '/');
  if (!s) return '';
  if (path.isAbsolute(s) || /^[A-Za-z]:/.test(s) || s.split('/').includes('..')) throw httpError(400, 'path must be relative to the notebook or a root, without ".."');
  return s;
}

const present = (v) => v != null && !(typeof v === 'string' && !v.trim()) && !(typeof v === 'object' && !Array.isArray(v) && !Object.values(v).some((x) => x != null && String(x).trim()));

// Returns { values, parent }. values maps input name -> resolved value (absent when not given).
export async function resolveInputs(nb, recipe, raw = {}, { getArtifact } = {}) {
  const values = {};
  let parent = null;
  raw = raw && typeof raw === 'object' ? raw : {};
  for (const spec of recipe.inputs) {
    const v = raw[spec.name];
    if (!present(v)) {
      if (spec.required) throw httpError(400, `${recipe.id}: "${spec.label}" is required`);
      continue;
    }
    switch (spec.type) {
      case 'text':
      case 'longtext': {
        const s = String(v).trim();
        values[spec.name] = s.length > TEXT_CAP ? s.slice(0, TEXT_CAP) : s;
        break;
      }
      case 'root':
        values[spec.name] = rootInfo(nb, String(v));
        break;
      case 'artifact': {
        const a = getArtifact?.(nb, String(v));
        if (!a) throw httpError(400, `${recipe.id}: no artifact ${v}`);
        if (spec.from && !spec.from.includes(a.recipe) && !spec.from.includes('*')) {
          throw httpError(400, `${recipe.id}: "${spec.label}" takes an artifact from ${spec.from.join(' or ')}, got ${a.recipe}`);
        }
        if (a.status !== 'ok') throw httpError(400, `${recipe.id}: artifact ${a.id} is ${a.status}; regenerate it first`);
        values[spec.name] = { id: a.id, recipe: a.recipe, title: a.title, kind: a.kind, text: artifactText(a) };
        parent ??= a.id;
        break;
      }
      case 'diff':
        values[spec.name] = await resolveDiff(nb, v);
        break;
      case 'gitlog':
        values[spec.name] = await resolveGitlog(nb, v);
        break;
      case 'path':
        values[spec.name] = checkPath(v);
        break;
      default:
        throw httpError(500, `unknown input type ${spec.type}`);
    }
  }
  if (recipe.needsOne && !recipe.needsOne.some((n) => values[n] != null)) {
    const labels = recipe.needsOne.map((n) => recipe.inputs.find((i) => i.name === n)?.label ?? n);
    throw httpError(400, `${recipe.id}: give one of ${labels.join(' or ')}`);
  }
  return { values, parent };
}
