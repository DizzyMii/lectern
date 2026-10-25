// Ready-made notebooks from examples/<name>.json. Each one creates and registers a notebook
// folder, then downloads its sources into corpus/ inside it. Nothing is bundled.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getNotebook, createNotebook, readConfig, writeConfig } from './store.mjs';
import { gitConfigArgs, childEnv } from './gitsafe.mjs';

export const EXAMPLES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');

export function listExamples() {
  return fs.readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.json') && f !== 'docs-sources.json').map((f) => f.slice(0, -5)).sort();
}

export function readExample(name) {
  if (!/^[\w.-]+$/.test(name) || !listExamples().includes(name)) return null;
  return JSON.parse(fs.readFileSync(path.join(EXAMPLES_DIR, `${name}.json`), 'utf8'));
}

function git(args, progress) {
  progress(`git ${args.join(' ')}`);
  const r = spawnSync('git', [...gitConfigArgs(), ...args], { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true, env: childEnv() });
  if (r.error) throw new Error(`git not found: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git ${args[0]} exited ${r.status}`);
}

async function download(src, dest, progress) {
  fs.mkdirSync(dest, { recursive: true });
  for (const f of src.files) {
    const out = path.join(dest, f);
    if (fs.existsSync(out)) continue;
    const url = new URL(f, src.fetch).href;
    progress(`fetch ${url}`);
    const res = await fetch(url, { headers: { 'user-agent': 'lectern/1.0' }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  }
}

// Running it again picks up where it stopped: present corpus folders and files are kept.
export async function runExample(name, { dir, code = false, progress = () => {} } = {}) {
  const spec = readExample(name);
  if (!spec) throw new Error(`no example named ${name}. Try one of: ${listExamples().join(', ')}`);
  const nb = getNotebook(spec.id) ?? createNotebook({ id: spec.id, title: spec.title, color: spec.color, dir });
  const cfg = readConfig(nb.dir);
  for (const k of ['title', 'color', 'description', 'target', 'system']) if (spec[k] != null) cfg[k] = spec[k];
  const skipped = [];
  for (const src of spec.sources) {
    if (src.code && !code) { skipped.push(src.name); continue; }
    const rel = `corpus/${src.name}`;
    const dest = path.join(nb.dir, rel);
    if (src.git && !fs.existsSync(dest)) {
      try {
        git(['clone', '--depth', '1', '--filter=blob:none', ...(src.sparse ? ['--sparse'] : []), ...(src.branch ? ['-b', src.branch] : []), src.git, dest], progress);
        if (src.sparse) git(['-C', dest, 'sparse-checkout', 'set', ...src.sparse], progress);
      } catch (e) {
        // a half clone would be skipped next time, so drop it
        fs.rmSync(dest, { recursive: true, force: true });
        throw e;
      }
    } else if (src.fetch) await download(src, dest, progress);
    for (const p of src.pin ?? []) if (!cfg.pinned.includes(`${rel}/${p}`)) cfg.pinned.push(`${rel}/${p}`);
    // the name the rail shows for these docs, in place of one made from the folder name
    if (src.label) cfg.labels = { ...cfg.labels, [rel]: src.label };
    for (const [root, sub] of Object.entries(src.roots ?? {})) cfg.roots[root] = `${rel}/${sub}`;
    writeConfig(nb.dir, cfg);
  }
  writeConfig(nb.dir, cfg);
  return { id: spec.id, dir: nb.dir, pinned: cfg.pinned, roots: cfg.roots, skipped };
}
