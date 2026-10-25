# Lectern

A local notebook for developers. Pin the docs you trust, point it at your source folders, ask questions, and every citation in the answer gets checked against the actual file before you see it.

```
npx @dizzymii/lectern serve
```

Then open http://127.0.0.1:4317.

## What it does that NotebookLM doesn't

- **Code roots.** A notebook holds pinned docs (the shelf) plus code roots, which are folders or git repos on your disk. The model can search and read any text file under a root while it answers, so it can quote the real source of the library you're using.
- **Checked citations.** Every `[n]` in an answer points at a file and a line range, and Lectern checks the quote is really there. Each one comes back verified, moved (found somewhere else in the file, with the new line), unverified or missing. They get re-checked every time you open an old conversation too, so if the docs changed under you, it shows.
- **Studio.** 24 recipes that turn the notebook into a saved artifact (specs, code maps, a CLAUDE.md, flashcards, a diff review and so on), with the same citation checks. Full list below.
- **MCP.** `lectern mcp` is a stdio MCP server, so Claude Code or Cursor can search your notebook for free and ask it questions while they work.

It all runs on your machine. The web server only listens on 127.0.0.1 and refuses cross-origin requests.

## How well it works

Measured on one notebook (NeoForge 1.21.1: 18 docs, 68 files, 3 code roots, about 350k tokens of pinned shelf). A different notebook will give different numbers.

- 5 graded questions: 53 of 53 citations verified, 17.5 of 21 key facts.
- Fast ask through MCP: about 2 cents and 8 seconds.
- Deep ask: about 43 cents and 30 seconds.
- A new conversation on Opus: about 30 cents once the shelf is cached.
- Cold shelf load: about $3. The first ask per notebook and model loads the whole shelf into a cached session and pays for it, after that it stays warm as long as you use it within the hour.

That $3 is the one to watch. A big shelf on Opus costs real money to load, so use fast mode (Haiku) for the "where is X" kind of lookups.

## Install

Needs Node 20 or newer (I've only tested on 22). Running from a clone of the repo, phone access over Tailscale and starting at logon are in [docs/SETUP.md](docs/SETUP.md).

```
npx @dizzymii/lectern serve
```

or install it so `lectern` is on your PATH, which the MCP setup below wants:

```
npm install -g @dizzymii/lectern
lectern serve --open
```

`--port` picks another port, `--open` opens the browser for you.

First thing to try if you just want to see it work:

```
lectern example node-docs
lectern serve --open
```

That fetches three pages of the Node.js 22 API docs from raw.githubusercontent.com into a new notebook (under the home folder, or `--dir` somewhere else). `lectern example` with no name lists what's there. The `neoforge` one clones a few git repos and is a lot bigger, add `--code` to also pull the NeoForge and GeckoLib sources.

## Engines

**API key (default).** Set `ANTHROPIC_API_KEY` and Lectern calls the Anthropic API directly. You pay per token on your own key.

**Your Claude Code login.** If you already use Claude Code, Lectern can drive `claude -p` headless on whatever account `claude` is logged into. Install Claude Code, run `claude` once to log in, and make sure it's on your PATH. This one is for your own personal use on your own machine (check Anthropic's terms for your plan before you point anything shared at it). Lectern strips `ANTHROPIC_API_KEY` from that process so it really does bill the login, and a hook keeps its Read, Grep and Glob inside the notebook folder and its code roots.

With both set up the API key wins. On the CLI, `--engine api` or `--engine claude-code` picks one, and it errors out if that engine isn't set up (it won't quietly switch to the other one). A follow-up stays on whatever engine its conversation started on.

## What leaves your machine

- **Your question, the pinned docs and whatever files the model reads** go to Anthropic, through the API or through Claude Code. The first ask in a conversation sends the whole shelf. Follow-ups send the conversation so far. Tool calls send back the file contents the model asked for (search hits, line ranges from your code roots).
- **Adding a URL** fetches that page (user-agent `lectern/1.0`) and saves it as markdown in the notebook. Loopback, private and link-local addresses are refused, redirects included (set `LECTERN_ALLOW_PRIVATE_URLS=1` if you really want an intranet page).
- **Adding a git URL** runs `git clone --depth 1` (sparse when you give a subfolder) into the notebook. https:// or git@ only, symlinks are checked out as plain files, hooks and LFS downloads are off, and a checkout over 1 GB gets deleted again (`LECTERN_CLONE_MAX_MB` changes the cap).
- **`lectern example`** downloads that example's sources from GitHub.
- On the Claude Code engine, Claude Code's own telemetry settings apply to that process. Lectern leaves them alone.

That's the whole list. There's no telemetry and no update check, and the fonts and scripts are bundled so nothing loads from a CDN. Search, file reads, citation checks and the free MCP tools never touch the network. The page also sends a Content-Security-Policy that blocks loads from any other host, so an answer or a saved page can't smuggle an image tag that phones home.

Everything under a code root can end up in front of the model, and from there at Anthropic. In a git repo Lectern indexes what `git ls-files` lists (so `.gitignore` applies), outside one it skips the usual build and dependency folders. Don't add a folder with secrets in it.

## Where your stuff lives

A notebook is a folder with a `notebook.json` in it, anywhere on disk. Inside it:

```
notebook.json     title, pinned docs, code roots
sources/          docs you added (fetched pages, copied files)
corpus/           git repos you added
conversations/    every conversation, as JSON
notes/            notes, as markdown
artifacts/        Studio output
```

Everything per user goes in the Lectern home folder: the list of registered notebooks (`registry.json`), cached base sessions (`bases.json`) and settings. It's picked in this order:

1. the `LECTERN_HOME` environment variable
2. `"home"` in `~/.lectern.json`, like `{"home": "D:/lectern-home"}`
3. `~/.lectern`

It gets created on first run. The first-run screen also lists project folders it finds one level deep in your home folder (or in `LECTERN_PROJECTS_DIR` if you set it), it only reads folder names and a couple of manifest files, nothing is indexed until you add one. The config file is handy when your home drive is full and you want the state somewhere else without setting an env var in every shell. If you ran the old spike app, `lectern migrate <old app folder>` copies its registry and base sessions over.

## CLI

```
lectern serve [--port n] [--open]
lectern ask <notebook> "<question>" [--json] [--fast | --deep] [--continue <conversationId>]
            [--model opus|sonnet|haiku] [--effort e] [--max-turns n] [--engine api|claude-code]
lectern mcp
lectern list [--json]
lectern show <notebook> <conversationId|artifactId> [--json]
lectern new <id> [--title t] [--dir folder]
lectern add <notebook> <url|path|git-url> [--name n] [--branch b] [--subdir d]
lectern example [name] [--dir folder] [--code]
lectern migrate <old app folder>
lectern --version | --help
```

`--fast` is Haiku at low effort with at most 4 rounds, `--deep` is Opus at high effort with at most 12. Without either it's Opus with at most 12. A round is one model request and every batch of tool calls costs another one. If a run hits the cap you get an error that says so.

`add` works out what you gave it. A git URL (or a plain github, gitlab or codeberg repo link) gets cloned as a code root, any other http URL is fetched as a doc, a folder becomes a code root and a file gets copied in.

`show` re-checks the saved citations against the files as they are now.

`example` sets up a ready-made notebook, no name lists them.

The web app's HTTP API is internal and can change between versions, script against the CLI or the MCP server.

## MCP setup

Install globally first so `lectern` is on your PATH.

Claude Code:

```sh
claude mcp add lectern -- lectern mcp
```

Add `--scope user` to get it in every project. `claude mcp list` should show it connected.

Cursor, in `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "lectern": {
      "command": "lectern",
      "args": ["mcp"]
    }
  }
}
```

`list_notebooks`, `search`, `read_source`, `verify`, `list_artifacts` and `get_artifact` never call a model and come back in well under a second. `ask` and `generate` do call one and cost money. The web server doesn't have to be running, they share the same files on disk. Tool arguments and protocol details are in [docs/mcp.md](docs/mcp.md).

## Studio recipes

Open Studio with `P`. Each recipe asks for a couple of inputs and saves an artifact into the notebook.

- **Plan:** Product requirements, Tech spec, Implementation plan, Decision record, Test plan
- **Visual:** Code map, Concept map, Flow diagram, Sequence diagram, Dependency graph
- **Agent:** CLAUDE.md, AGENTS.md, Agent skill, Agent quiz
- **Learn:** Onboarding guide, Cheat sheet, Porting guide, Gotchas, Glossary, Flashcards
- **Code:** Gap report, Diff review, How would I build..., Release notes

Code map, CLAUDE.md, Glossary and Product requirements make a LOT of tool calls and are the ones most likely to hit the 4-round cap in fast mode. Run those in deep.

## Keyboard shortcuts

`?` opens the full sheet in the app. The ones you'll use most:

| Key | Does |
|---|---|
| `Ctrl+K` | command palette |
| `/` | focus the composer |
| `N` or `Alt+N` | new conversation |
| `J` / `K` | next / previous claim |
| `1` to `9` | open citation n |
| `[` / `]` | previous / next citation |
| `O` | open the current citation in the source drawer at the line |
| `C` | copy the answer with citations |
| `X` | challenge the claim under the cursor |
| `W` | ask "what could make this wrong?" |
| `H` | focus history |
| `Shift+H` | toggle claim bands |
| `L` | toggle the trail log |
| `P` | Studio |
| `A` | add a source |
| `Ctrl+B` | toggle the rail |
| `Ctrl+1` / `2` / `3` | focus rail / page / margin |
| `Ctrl+Shift+F` | search the notebook |
| `Ctrl+Shift+L` | toggle theme |
| `Esc` | close the top layer, then clear the claim cursor |

Inside Studio artifacts, flashcards flip with `Space` and rate with the arrow keys, graphs zoom with `+` `-` `0`, sequence diagrams step with `J` / `K` and `Ctrl+S` saves an edited file.

## Limits and rough edges

- Every number above comes from one NeoForge notebook. I haven't measured anything else yet.
- I've only run it on Windows. macOS and Linux should work, nobody has checked.
- The text file list leans toward what I use (Java, Kotlin, Gradle, JSON, JS, TS, Python, shaders, markdown). No Go, Rust or C yet, files with those extensions under a root get skipped.
- Files over 2 MB count as missing for search, reads and citations.
- The first re-check of a big artifact on a freshly started server can take a second or so while files are read cold. After that it's milliseconds.
- On the API engine, follow-up questions replay the earlier turns as plain text, so long conversations get more expensive per turn.
- This is a release candidate, things will still move before 1.0.0.

## License

[PolyForm Shield 1.0.0](LICENSE). In plain words: use it, change it, run it at work, share it, all fine. You can't use it to build or sell a product that competes with Lectern. The full text in LICENSE is what actually counts.

Copyright 2026 Kade Heglin.
