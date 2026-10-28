// The command line: ask, list, show, new and add. bin/lectern.mjs routes here.
import fs from 'node:fs';
import path from 'node:path';
import { ask, MODES, apiEngineAvailable, findClaude } from './engine.mjs';
import { listNotebooks, listConversations, getNotebook, getConversation, createNotebook } from './store.mjs';
import { getArtifact } from './studio/engine.mjs';
import { getShelf, addSource, allFiles } from './sources.mjs';

export function parse(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--fast') opts.fast = true;
    else if (a === '--deep') opts.deep = true;
    else if (['--model', '--effort', '--continue', '--engine', '--max-turns', '--title', '--color', '--dir', '--name', '--branch', '--subdir'].includes(a)) opts[a.slice(2)] = argv[++i];
    else pos.push(a);
  }
  return { args: pos, opts };
}

// Prints a saved conversation or artifact with every citation checked again against the files now.
export function showCmd([notebook, id], opts) {
  if (!notebook || !id) throw usageError('show needs a notebook and an id');
  const nb = getNotebook(notebook);
  if (!nb) { console.error(`no notebook ${notebook}`); return 1; }
  const conv = getConversation(nb, id, { recheck: true });
  const item = conv ?? getArtifact(nb, id, { recheck: true });
  if (!item) { console.error(`no conversation or artifact ${id}`); return 1; }
  if (opts.json) { const { api, ...shown } = item; console.log(JSON.stringify(shown, null, 2)); return 0; }
  const parts = conv ? conv.turns.map((t) => ({ title: t.question, cites: t.citations, check: t.citeCheck })) : [{ title: item.title, cites: item.citations ?? [], check: item.citeCheck }];
  for (const p of parts) {
    const k = p.check.counts;
    console.log(`\n${p.title}\n  ${k.verified} verified, ${k.moved} moved, ${k.unverified} unverified, ${k.missing} missing${p.check.changed ? ', drifted since written' : ''}`);
    for (const c of p.cites) console.log(`  [^${c.n}] ${c.status.padEnd(10)} ${c.path}${c.line ? `:${c.line}` : ''}${c.status !== c.status0 ? `  (was ${c.status0})` : ''}`);
  }
  console.log(`\nre-read ${item.citeCheck.checkedAt}`);
  return 0;
}

// pinned docs and their files, plus how many files each code root holds
export async function notebookCounts(nb) {
  const shelf = await getShelf(nb);
  const rootFiles = Object.fromEntries(Object.keys(nb.config.roots).map((r) => [r, 0]));
  for (const f of await allFiles(nb)) if (f.root != null) rootFiles[f.root] = (rootFiles[f.root] ?? 0) + 1;
  return { docs: shelf.stats.docs, pinnedFiles: shelf.stats.files, rootFiles, tokens: shelf.stats.tokens };
}

export const countsLine = (c) => {
  const roots = Object.entries(c.rootFiles).map(([r, n]) => `${r} (${n} ${n === 1 ? 'file' : 'files'})`).join(', ') || 'none';
  return `${c.docs} pinned ${c.docs === 1 ? 'doc' : 'docs'} in ${c.pinnedFiles} ${c.pinnedFiles === 1 ? 'file' : 'files'}, ~${c.tokens} tokens; roots: ${roots}`;
};

export async function listCmd(opts) {
  const out = [];
  for (const nb of listNotebooks()) {
    const c = await notebookCounts(nb);
    out.push({ id: nb.id, title: nb.title, dir: nb.dir, docs: c.docs, files: c.pinnedFiles, roots: Object.keys(nb.config.roots), rootFiles: c.rootFiles, tokens: c.tokens, conversations: listConversations(nb).length, counts: c });
  }
  if (opts.json) console.log(JSON.stringify(out.map(({ counts, ...n }) => n), null, 2));
  else if (!out.length) console.log('No notebooks yet. Try `lectern example node-docs`, or `lectern new <id>` and then `lectern add <id> <folder or url>`.');
  else for (const n of out) console.log(`${n.id}  ${n.title}  (${countsLine(n.counts)})`);
  return 0;
}

// Engine names the CLI takes. None given means the same default as the server and a
// follow-up stays on its conversation's engine.
const ENGINES = ['api', 'claude-code'];
export function cliEngine(name) {
  if (name == null) return undefined;
  if (!ENGINES.includes(name)) throw usageError(`unknown engine "${name}": use api or claude-code`, { brief: true });
  if (name === 'api' && !apiEngineAvailable()) throw usageError('--engine api needs ANTHROPIC_API_KEY set (and the @anthropic-ai/sdk package installed)', { brief: true });
  if (name === 'claude-code' && !findClaude() && process.env.LECTERN_FAKE_ENGINE !== '1') throw usageError('--engine claude-code needs the claude binary on PATH', { brief: true });
  return name;
}

// $0.0028731400000000006 -> $0.0029
export const money = (usd) => (usd == null ? '$?' : `$${usd >= 1 ? usd.toFixed(2) : usd.toFixed(4)}`);

// [^3] in the answer reads as [3] in a terminal, matching the source list under it, and the
// markdown escapes put into kept quotes come back out
const plainMarkers = (text) => String(text ?? '').replace(/\[\^(\d+)\]/g, '[$1]').replace(/\\([\\*_~`])/g, '$1');

export async function askCmd([notebook, question], opts) {
  if (!notebook || !question) throw usageError('ask needs a notebook and a question');
  if (opts.fast && opts.deep) throw usageError('pick one of --fast and --deep');
  const preset = opts.deep ? MODES.deep : {};
  const engine = cliEngine(opts.engine);
  // the answer prints once it is done, with its citation markers numbered like the list below it
  const job = ask({
    notebook, question, conversationId: opts.continue, model: opts.model ?? preset.model, effort: opts.effort ?? preset.effort, fast: opts.fast, maxTurns: opts['max-turns'] ?? preset.maxTurns, engine,
    onEvent: (e) => {
      if (opts.json) return;
      if (e.type === 'tool') process.stderr.write(`  > ${e.summary}\n`);
    },
  });
  process.on('SIGINT', () => { job.cancel(); process.exit(130); });
  const out = await job.done;
  if (opts.json) {
    const { answer, citations, toolCalls, usage, costUsd, sessionCostUsd, conversationId, seconds, model, sessionId } = out;
    console.log(JSON.stringify({
      answer,
      citations: citations.map(({ n, path, line, endLine, quote, status }) => ({ n, path, line, endLine, quote, status })),
      toolCalls: toolCalls.map(({ name, input, summary, ok, chars }) => ({ name, input, summary, ok, chars })),
      usage, costUsd, sessionCostUsd, conversationId, seconds, model, sessionId,
    }, null, 2));
  } else {
    console.log(`\n${plainMarkers(out.answer).trim()}\n`);
    for (const c of out.citations) console.log(`[${c.n}] ${c.status.padEnd(10)} ${c.path}${c.line ? `:${c.line}` : ''}${c.quote ? `  "${c.quote.slice(0, 80)}"` : ''}`);
    console.log(`\n${out.model}, ${out.seconds}s, ${money(out.costUsd)}, conversation ${out.conversationId}`);
  }
  return 0;
}

// brief: a bad value rather than a wrong command line, so the full help is not printed
export function usageError(message, { brief = false } = {}) {
  return Object.assign(new Error(message), { usage: true, brief });
}

export function newCmd([id], opts) {
  if (!id) throw usageError('new needs an id');
  const nb = createNotebook({ id, title: opts.title, color: opts.color, dir: opts.dir });
  console.log(`created ${nb.id} at ${nb.dir}`);
  return 0;
}

// A git url clones into the notebook, an http url is fetched as a doc, a folder becomes a code root and a file is copied in.
export function sourceFor(target, opts = {}) {
  if (/^git@/.test(target) || /^https?:\/\/\S+\.git\/?$/.test(target) || /^https?:\/\/(github\.com|gitlab\.com|codeberg\.org)\/[^/\s]+\/[^/\s]+\/?$/.test(target)) {
    return { kind: 'git', url: target.replace(/\/$/, ''), branch: opts.branch, subdir: opts.subdir, name: opts.name };
  }
  if (/^https?:\/\//.test(target)) return { kind: 'url', url: target };
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) throw usageError(`not a url, folder or file: ${target}`, { brief: true });
  if (fs.statSync(abs).isDirectory()) return { kind: 'folder', path: abs, name: opts.name };
  return { kind: 'file', name: path.basename(abs), base64: fs.readFileSync(abs).toString('base64') };
}

export async function addCmd([notebook, target], opts) {
  if (!notebook || !target) throw usageError('add needs a notebook and a url, path or git url');
  const nb = getNotebook(notebook);
  if (!nb) { console.error(`no notebook ${notebook}`); return 1; }
  const r = await addSource(nb, sourceFor(target, opts), (line) => process.stderr.write(`  ${line}\n`));
  if (opts.json) console.log(JSON.stringify(r, null, 2));
  else console.log(`added ${r.kind}${r.root ? ` root ${r.root}` : ''}: ${r.path}`);
  return 0;
}
