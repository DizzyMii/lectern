# Lectern (MCP server)

`lectern mcp` puts Lectern behind the Model Context Protocol, so Claude Code, Cursor or any MCP client can ask a notebook questions and get answers with citations checked against the files. It speaks JSON-RPC over stdio and calls the engine and store directly, so the web server doesn't need to be running (it's fine if it is, they share the same files on disk).

Asks use the same engine as the app and the CLI (see Engines in the README).

## Register it

In the desktop app installed with Lectern Setup.exe, Settings has Connect buttons for Claude Code and Cursor that do the below for you and point at the installed exe.

Claude Code:

```sh
claude mcp add lectern -- lectern mcp
```

Add `--scope user` to get it in every project, the default only registers it for the folder you ran it in. `claude mcp list` should show it connected.

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

Anything else: launch `lectern mcp` as a stdio server. Newline-delimited JSON-RPC 2.0, protocol versions 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05 (it answers with yours if it knows it, otherwise 2025-11-25). It supports `initialize`, `ping`, `tools/list`, `tools/call`, `prompts/list`, `prompts/get`, `notifications/cancelled` and progress notifications when you send a `progressToken`. Logs go to stderr, stdout is protocol only. Closing stdin shuts it down, any running ask gets cancelled first.

Clients start the server from wherever they like. The registry is found through the Lectern home folder (see the README), so the cwd doesn't matter for that. It only picks the default notebook for the recipe prompts below. If `lectern` isn't on the client's PATH, put the absolute path to it in `command`.

## Tools

Free ones, no model call, they come back in well under a second:

- `list_notebooks` ids, titles, pinned doc and file counts, code root names with how many files each holds (`rootFiles`), shelf size in tokens. Call it first, everything else takes a notebook id.
- `search {notebook, query, regex?}` the same full-text search as the app's search box, over pinned docs and every text file under the roots. Up to 100 hits as `path:line: text`.
- `read_source {notebook, path, start?, end?}` numbered lines from a pinned doc or a root file. 400 lines by default, 2000 max per call. Absolute paths, `..` escapes and files outside the shelf and roots (notebook.json, conversations) are refused.
- `verify {notebook, citations: [...]}` re-checks citation strings against the files as they are now. Takes `[[path#L12]]`, `[[path#L12-L20]]`, `[[path|"quote"]]` and `[[path#L12|"quote"]]`, brackets optional. Each one comes back verified, moved (with the new line), unverified, missing or unparsed.
- `recall {query, notebook?, kinds?, limit?}` looks through what the user already has: saved questions and answers, notes and Studio sheets in every notebook (or the one you name) that share words with the query. Each hit says where it lives (notebook, conversation id, note slug or artifact id) and gives the saved text and its citations, checked again against the files as they are now. Local word matching over the saved files, no model call, nothing written. At most 8 hits, 3 by default. Example: `{"query": "where do payload handlers go", "kinds": ["answer"]}`. Try it before `ask`.
- `list_artifacts {notebook}` and `get_artifact {notebook, id}` Studio artifacts, markdown or JSON data plus citations. get_artifact re-checks every citation and data ref first, so a doc that drifted since the artifact was made shows it.
- `check_notebook {notebook, files?}` re-checks every saved conversation, Studio sheet and note in the notebook against the files as they are now, plus the footnotes in any pinned markdown files you name in `files`. It returns what got worse, grouped by the cited file.
- `submit_artifact {notebook, recipe, draft, inputs?, replaces?}` checks a Studio sheet you wrote yourself and saves it. See Recipes as slash commands below.

The two that cost money:

- `ask {notebook, question, mode?, conversationId?}` the normal ask, same path as the web app and the CLI (forks the cached base session, citations verified). You get the answer with `[n]` markers, a `[n] status path:line "quote"` block, then conversationId, model, seconds and cost, and the same fields again in `structuredContent`. The conversation is saved in the notebook, so it shows up in the web app, and passing `conversationId` back continues it.
- `generate {notebook, recipe, inputs?, mode?}` runs a Studio recipe and saves the artifact. The tool description lists all 24 recipes and their inputs, e.g. `{"recipe": "code-map", "inputs": {"root": "neoforge"}}`.

Tool errors (bad arguments, unknown notebook, an escaping path, a capped run) come back as `isError` results with a sentence saying what to fix, so the calling model can retry. An unknown tool name is a JSON-RPC `-32602`.

## Recipes as slash commands

The 24 Studio recipes are MCP prompts. Claude Code lists them as `/mcp__lectern__<recipe id>`, for example `/mcp__lectern__diff-review`, `/mcp__lectern__prd` and `/mcp__lectern__claude-md`. Running one gives the agent the recipe's own prompt plus a short block of instructions. The agent reads the notebook with `search` and `read_source` (and its own Read, Grep and Glob on the code roots), writes the sheet, and hands the draft to `submit_artifact`. Lectern calls no model here, so it costs nothing.

Arguments are the recipe's inputs in the order the recipe declares them, then `notebook` last and optional. Diff and git log inputs take `<root>:<range>`, like `code:main..HEAD`, or just the range when the notebook has one code root. A diff with a newline in it is taken as pasted diff text.

The notebook is the one you name. Without one it is the only notebook you have, else the notebook whose folder or code root holds the directory Claude Code was started in, else an error that lists the ids.

`submit_artifact` runs the same output contract check as `generate` and then checks every citation and data ref against the files. A draft that breaks the contract is not saved and the problems come back, so the agent can fix them and send the whole draft again. A saved draft comes back with a count per status and one line for each unverified or missing citation and data ref. The agent fixes those and submits again with `replaces` set to the id it got back. `replaces` only takes an artifact an earlier `submit_artifact` made for the same recipe, so an agent can't overwrite a sheet you generated. It never writes files: a CLAUDE.md or AGENTS.md sheet is saved as an artifact and written from the Lectern app.

The sheet shows up in Studio the next time it loads the list, with `via claude-code` (the client's name) where the model usually goes. Citations are checked again when you open it, and Regenerate runs it on Lectern's own model.

## fast vs deep

| mode | model | effort | max rounds |
|---|---|---|---|
| `fast` (default) | haiku | low | 4 |
| `deep` | opus | high | 12 |

A round is one model request, and each batch of tool calls costs another one. Every ask has a round cap: 12 unless something sets it, 4 with `--fast` in the CLI. If a run hits it, you get an error saying so (`stopped at the 4-round cap...`) and no half answer.

What it costs, measured on the NeoForge notebook (~350K tokens of pinned shelf):

- **fast ask:** $0.02 to $0.05 and about 10 to 30 seconds once the haiku base session is warm. One run through the MCP server cost $0.024 in 10.4s with 3 of 3 citations verified.
- **deep ask:** about $0.30 for an opus answer that used 2 tool calls (that one ran at default effort). High effort and 12 rounds push it higher, plan on up to a dollar or so for a question that keeps searching.
- **the base session:** the first ask per notebook and model in an hour loads the whole shelf into a cached session, and that first ask pays for it. About $0.38 on haiku and about $3.00 on opus. After that it stays warm as long as it's used within the hour. This is the big one, a cold deep ask is $3+.
- **generate fast:** cheat-sheet came out at $0.11 in 31s (8 tool calls, 31 of 31 citations verified). Haiku runs without a cap cost $0.07 to $0.77.

The bigger recipes make a lot of tool calls. Uncapped runs of code-map used 25 and 59, claude-md 21 and 36, glossary 28 and prd 23 to 26. Calls made in parallel share a round, so that's fewer rounds than calls, but these are the recipes most likely to hit 4 in fast mode, and possibly 12. Run them in deep, or from the CLI with a bigger `--max-turns`.

So: recall first, to see whether the question was already answered and saved (free), then search and read_source for lookups (free), then fast for "where is X / what does Y take", deep when fast came back thin or capped.

## CLI

The same caps are on the CLI:

```sh
lectern ask neoforge-1.21.1 "Which event registers payload handlers?" --fast
lectern ask neoforge-1.21.1 "How do attachments sync to the client?" --max-turns 20
```

## Tests

`node --test test/mcp.test.mjs` spawns the server with `LECTERN_FAKE_ENGINE=1` on a throwaway notebook and talks to it over stdio: initialize and version negotiation, JSON-RPC errors, tools/list schemas, search, read_source with escaping paths, verify, recall, ask with a saved conversation, artifacts, the round-cap error, prompts/list, prompts/get and submit_artifact. No model calls, about a second.
