// Runs a user or model regex over files in a child process with a time limit, so a pattern
// with catastrophic backtracking cannot stall the server. Also the child's own entry point.
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RUN_AS_NODE } from './gitsafe.mjs';

const SELF = fileURLToPath(import.meta.url);
export const MAX_PATTERN = 1000;
const TIMEOUT_MS = Number(process.env.LECTERN_REGEX_TIMEOUT_MS) || 5000;

const tooSlow = () => Object.assign(new Error('the regex took too long; simplify it'), { status: 400 });

// job: { files: [{abs, path}], pattern, flags, perFile, limit, maxFile }
function scan({ files, pattern, flags = '', perFile = Infinity, limit = Infinity, maxFile = 2 * 1024 * 1024 }) {
  const re = new RegExp(pattern, flags);
  const hits = [];
  let truncated = false;
  outer: for (const f of files) {
    let text;
    try {
      if (fs.statSync(f.abs).size > maxFile) continue;
      text = fs.readFileSync(f.abs, 'utf8');
    } catch { continue; }
    if (text.slice(0, 1024).includes('\0') || !re.test(text)) continue;
    const lines = text.split('\n');
    let n = 0;
    for (let i = 0; i < lines.length && n < perFile; i++) {
      const col = lines[i].search(re);
      if (col < 0) continue;
      if (hits.length >= limit) { truncated = true; break outer; }
      n++;
      hits.push({ path: f.path, line: i + 1, text: lines[i].replace(/\r$/, ''), col });
    }
  }
  return { hits, truncated };
}

const childEnv = () => ({ PATH: process.env.PATH ?? process.env.Path ?? '', SystemRoot: process.env.SystemRoot ?? '', ...RUN_AS_NODE });

function parse(stdout) {
  const r = JSON.parse(stdout);
  if (r.error) throw Object.assign(new Error(r.error), { status: 400 });
  return r;
}

export function scanSync(job, { timeoutMs = TIMEOUT_MS } = {}) {
  const r = spawnSync(process.execPath, [SELF], { input: JSON.stringify(job), encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: childEnv() });
  if (r.error?.code === 'ETIMEDOUT' || r.signal) throw tooSlow();
  if (r.error) throw r.error;
  return parse(r.stdout);
}

export function scanAsync(job, { timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [SELF], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, env: childEnv() });
    let out = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; c.kill(); }, timeoutMs);
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', (d) => { out += d; });
    c.on('error', (e) => { clearTimeout(timer); reject(e); });
    c.on('close', () => {
      clearTimeout(timer);
      if (timedOut) return reject(tooSlow());
      try { resolve(parse(out)); } catch (e) { reject(e); }
    });
    c.stdin.on('error', () => {});
    c.stdin.end(JSON.stringify(job));
  });
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(SELF)) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', () => {
    let out;
    try { out = scan(JSON.parse(input)); } catch (e) { out = { error: e.message }; }
    process.stdout.write(JSON.stringify(out));
  });
}
