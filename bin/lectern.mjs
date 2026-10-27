#!/usr/bin/env node
import { quietGlobWarning } from '../lib/warnings.mjs';
import { applySettings } from '../lib/settings.mjs';

quietGlobWarning();
applySettings();

const HELP = `lectern: ask your docs and code, get answers with checked citations

usage:
  lectern serve [--port n] [--open]          web app on http://127.0.0.1:4317
  lectern ask <notebook> "<question>" [--json] [--fast | --deep] [--continue <conversationId>]
              [--model opus|sonnet|haiku] [--effort e] [--max-turns n] [--engine api|claude-code]
  lectern mcp                                MCP server over stdio
  lectern list [--json]                      registered notebooks
  lectern show <notebook> <conversationId|artifactId> [--json]
  lectern new <id> [--title t] [--dir folder]
  lectern add <notebook> <url|path|git-url> [--name n] [--branch b] [--subdir d]
  lectern example [name] [--dir folder] [--code]
                                             set up a ready-made notebook (no name lists them)
  lectern migrate <old app folder>           copy an old data/registry.json into the home folder
  lectern --version | --help

--fast is haiku at low effort with at most 4 rounds; --deep is opus at high effort with at most 12.
Without either, opus with at most 12 rounds.
--engine picks who answers: api uses ANTHROPIC_API_KEY, claude-code uses your Claude Code login.
Left out, the API key wins when it is set, and a follow-up stays on the engine it started on.

State (registry, base sessions, settings) lives in LECTERN_HOME, else the "home" in ~/.lectern.json,
else ~/.lectern. Notebooks are folders anywhere, registered by absolute path.`;

function openBrowser(url) {
  return import('node:child_process').then(({ spawn }) => {
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
    spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref();
  });
}

async function main(argv) {
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') { console.log(HELP); return 0; }
  if (cmd === '--version' || cmd === '-v') {
    const { VERSION } = await import('../lib/version.mjs');
    console.log(VERSION);
    return 0;
  }
  if (cmd === 'mcp') {
    await import('../lib/mcp.mjs');
    return null;
  }

  const cli = await import('../lib/cli.mjs');
  const { args, opts } = cli.parse(argv.slice(1));
  try {
    if (cmd === 'serve') {
      const port = Number(argValue(argv, '--port') ?? process.env.PORT ?? 4317);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw cli.usageError(`bad port: ${argValue(argv, '--port')}`, { brief: true });
      const { startServer } = await import('../lib/server.mjs');
      const srv = await startServer({ port });
      // with --port 0 the system picks the port, so read back the one it bound
      const url = `http://127.0.0.1:${srv?.address().port ?? port}`;
      if (argv.includes('--open')) await openBrowser(url);
      return srv ? null : 0;
    }
    if (cmd === 'ask') return await cli.askCmd(args, opts);
    if (cmd === 'list') return await cli.listCmd(opts);
    if (cmd === 'show') return cli.showCmd(args, opts);
    if (cmd === 'new') return cli.newCmd(args, opts);
    if (cmd === 'add') return await cli.addCmd(args, opts);
    if (cmd === 'example') {
      const ex = await import('../lib/examples.mjs');
      const name = args.find((a) => a !== '--code');
      if (!name) {
        for (const n of ex.listExamples()) console.log(`${n.padEnd(14)} ${ex.readExample(n).description ?? ''}`);
        return 0;
      }
      if (!ex.readExample(name)) { console.error(`no example named ${name}. Try one of: ${ex.listExamples().join(', ')}`); return 1; }
      const r = await ex.runExample(name, { dir: opts.dir, code: argv.includes('--code'), progress: (l) => process.stderr.write(`  ${l}\n`) });
      console.log(`notebook ${r.id} at ${r.dir}: ${r.pinned.length} pinned globs, ${Object.keys(r.roots).length} code roots`);
      if (r.skipped.length) console.log(`skipped code sources ${r.skipped.join(', ')}; run it again with --code to add them`);
      return 0;
    }
    if (cmd === 'migrate') {
      if (!args[0]) throw cli.usageError('migrate needs the old app folder');
      const { migrateFrom } = await import('../lib/migrate.mjs');
      const r = migrateFrom(args[0]);
      if (!r.migrated) { console.error(r.reason); return 1; }
      console.log(`home ${r.home}: added ${r.added.join(', ') || 'no new notebooks'}, ${r.bases} base sessions`);
      return 0;
    }
    throw cli.usageError(`unknown command: ${cmd}`);
  } catch (e) {
    if (!e.usage) throw e;
    console.error(e.brief ? `${e.message}\nsee lectern --help` : `${e.message}\n\n${HELP}`);
    return 2;
  }
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

// null means a long-running command (serve, mcp) owns the process from here
main(process.argv.slice(2)).then(
  (code) => { if (code !== null) process.exit(code); },
  (e) => { console.error(e.message ?? String(e)); process.exit(1); },
);
