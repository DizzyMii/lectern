#!/usr/bin/env node
// node app/cli.mjs ask <notebook> "<question>" [--json] [--fast] [--model m] [--effort e] [--max-turns n] [--continue <convId>]
// node app/cli.mjs list
// node app/cli.mjs show <notebook> <conversationId|artifactId> [--json]   (re-checks every citation)
// node 22 flags fs.glob as experimental; the warning is noise here
process.removeAllListeners('warning');
import { ask } from './engine.mjs';
import { listNotebooks, listConversations, getNotebook, getConversation } from './store.mjs';
import { getArtifact } from './studio/engine.mjs';
import { getShelf } from './sources.mjs';

const USAGE = 'usage: node app/cli.mjs ask <notebook> "<question>" [--json] [--fast] [--model opus|sonnet|haiku] [--effort e] [--max-turns n] [--continue <conversationId>]\n       node app/cli.mjs list [--json]\n       node app/cli.mjs show <notebook> <conversationId|artifactId> [--json]\n--fast is haiku at low effort with at most 4 rounds; without it, opus with at most 12.';

function parse(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--fast') opts.fast = true;
    else if (a === '--model' || a === '--effort' || a === '--continue' || a === '--engine' || a === '--max-turns') opts[a.slice(2)] = argv[++i];
    else pos.push(a);
  }
  return { cmd: pos[0], args: pos.slice(1), opts };
}

// Prints a saved conversation or artifact with every citation checked again against the files now.
function show(notebook, id, opts) {
  const nb = getNotebook(notebook);
  if (!nb) { console.error(`no notebook ${notebook}`); return 1; }
  const conv = getConversation(nb, id, { recheck: true });
  const item = conv ?? getArtifact(nb, id, { recheck: true });
  if (!item) { console.error(`no conversation or artifact ${id}`); return 1; }
  if (opts.json) { console.log(JSON.stringify(item, null, 2)); return 0; }
  const parts = conv ? conv.turns.map((t) => ({ title: t.question, cites: t.citations, check: t.citeCheck })) : [{ title: item.title, cites: item.citations ?? [], check: item.citeCheck }];
  for (const p of parts) {
    const k = p.check.counts;
    console.log(`\n${p.title}\n  ${k.verified} verified, ${k.moved} moved, ${k.unverified} unverified, ${k.missing} missing${p.check.changed ? ', drifted since written' : ''}`);
    for (const c of p.cites) console.log(`  [^${c.n}] ${c.status.padEnd(10)} ${c.path}${c.line ? `:${c.line}` : ''}${c.status !== c.status0 ? `  (was ${c.status0})` : ''}`);
  }
  console.log(`\nre-read ${item.citeCheck.checkedAt}`);
  return 0;
}

async function main() {
  const { cmd, args, opts } = parse(process.argv.slice(2));
  if (cmd === 'list') {
    const out = [];
    for (const nb of listNotebooks()) {
      const shelf = await getShelf(nb);
      out.push({ id: nb.id, title: nb.title, dir: nb.dir, docs: shelf.stats.docs, files: shelf.stats.files, roots: Object.keys(nb.config.roots), tokens: shelf.stats.tokens, conversations: listConversations(nb).length });
    }
    if (opts.json) console.log(JSON.stringify(out, null, 2));
    else for (const n of out) console.log(`${n.id}  ${n.title}  (${n.docs} docs, ${n.files} files, roots: ${n.roots.join(', ') || 'none'}, ~${n.tokens} tokens)`);
    return 0;
  }
  if (cmd === 'show' && args.length >= 2) return show(args[0], args[1], opts);
  if (cmd !== 'ask' || args.length < 2) { console.error(USAGE); return 2; }
  const [notebook, question] = args;
  const job = ask({
    notebook, question, conversationId: opts.continue, model: opts.model, effort: opts.effort, fast: opts.fast, maxTurns: opts['max-turns'], engine: opts.engine === 'api' ? 'api' : 'claude-code',
    onEvent: (e) => {
      if (opts.json) return;
      if (e.type === 'delta') process.stdout.write(e.text);
      else if (e.type === 'tool') process.stderr.write(`\n  > ${e.summary}\n`);
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
    console.log('\n');
    for (const c of out.citations) console.log(`[^${c.n}] ${c.status.padEnd(10)} ${c.path}${c.line ? `:${c.line}` : ''}${c.quote ? `  "${c.quote.slice(0, 80)}"` : ''}`);
    console.log(`\n${out.model}, ${out.seconds}s, $${out.costUsd ?? '?'}, conversation ${out.conversationId}`);
  }
  return 0;
}

main().then((code) => process.exit(code), (e) => { console.error(e.message ?? String(e)); process.exit(1); });
