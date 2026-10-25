# Lectern (MCP server)

`lectern mcp` puts Lectern behind the Model Context Protocol, so Claude Code, Cursor or any MCP client can ask a notebook questions and get answers with citations checked against the files. It speaks JSON-RPC over stdio and calls the engine and store directly, so the web server doesn't need to be running (it's fine if it is, they share the same files on disk).

Asks use the same engine as the app and the CLI (see Engines in the README).

## Register it

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

Anything else: launch `lectern mcp` as a stdio server. Newline-delimited JSON-RPC 2.0, protocol versions 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05 (it answers with yours if it knows it, otherwise 2025-11-25). It supports `initialize`, `ping`, `tools/list`, `tools/call`, `notifications/cancelled` and progress notifications when you send a `progressToken`. Logs go to stderr, stdout is protocol only. Closing stdin shuts it down, any running ask gets cancelled first.

Clients start the server from wherever they like. The registry is found through the Lectern home folder (see the README), so the cwd doesn't matter. If `lectern` isn't on the client's PATH, put the absolute path to it in `command`.

## Tools

Free ones, no model call, they come back in well under a second:

- `list_notebooks` ids, titles, pinned doc and file counts, code root names with how many files each holds (`rootFiles`), shelf size in tokens. Call it first, everything else takes a notebook id.
- `search {notebook, query, regex?}` the same full-text search as the app's search box, over pinned docs and every text file under the roots. Up to 100 hits as `path:line: text`.
- `read_source {notebook, path, start?, end?}` numbered lines from a pinned doc or a root file. 400 lines by default, 2000 max per call. Absolute paths, `..` escapes and files outside the shelf and roots (notebook.json, conversations) are refused.
- `verify {notebook, citations: [...]}` re-checks citation strings against the files as they are now. Takes `[[path#L12]]`, `[[path#L12-L20]]`, `[[path|"quote"]]` and `[[path#L12|"quote"]]`, brackets optional. Each one comes back verified, moved (with the new line), unverified, missing or unparsed.
- `list_artifacts {notebook}` and `get_artifact {notebook, id}` Studio artifacts, markdown or JSON data plus citations. get_artifact re-checks every citation and data ref first, so a doc that drifted since the artifact was made shows it.

The two that cost money:

- `ask {notebook, question, mode?, conversationId?}` the normal ask, same path as the web app and the CLI (forks the cached base session, citations verified). You get the answer with `[n]` markers, a `[n] status path:line "quote"` block, then conversationId, model, seconds and cost, and the same fields again in `structuredContent`. The conversation is saved in the notebook, so it shows up in the web app, and passing `conversationId` back continues it.
- `generate {notebook, recipe, inputs?, mode?}` runs a Studio recipe and saves the artifact. The tool description lists all 24 recipes and their inputs, e.g. `{"recipe": "code-map", "inputs": {"root": "neoforge"}}`.

Tool errors (bad arguments, unknown notebook, an escaping path, a capped run) come back as `isError` results with a sentence saying what to fix, so the calling model can retry. An unknown tool name is a JSON-RPC `-32602`.

## fast vs deep

| mode | model | effort | max rounds |
|---|---|---|---|
| `fast` (default) | haiku | low | 4 |
| `deep` | opus | high | 12 |

A round is one model request, and each batch of tool calls costs another one. Every ask in the app has a cap now: 12 unless something sets it, 4 with `--fast` in the CLI. If a run hits it, you get an error saying so (`stopped at the 4-round cap...`), never a half answer.

What it costs, measured on the NeoForge notebook (~360K tokens of pinned shelf):

- **fast ask:** $0.02 to $0.05 and about 10 to 30 seconds once the haiku base session is warm. Measured today through the MCP server, $0.024 in 10.4s with 3 of 3 citations verified.
- **deep ask:** about $0.30 for an opus answer that used 2 tool calls (that one ran at default effort). High effort and 12 rounds push it higher, plan on up to a dollar or so for a question that keeps searching.
- **the base session:** the first ask per notebook and model in an hour loads the whole shelf into a cached session, and that first ask pays for it. About $0.38 on haiku and about $3.00 on opus. After that it stays warm as long as it's used within the hour. This is the big one, a cold deep ask is $3+.
- **generate fast:** cheat-sheet came out at $0.11 in 31s (8 tool calls, 31 of 31 citations verified). Past haiku runs without a cap cost $0.07 to $0.77.

Heads up on generate: the bigger recipes went through a lot of tool calls before the cap existed (code-map 25 and 59, claude-md 21 and 36, glossary 28, prd 23 to 26). Tool calls in parallel share a round, so that's fewer rounds than calls, but those are the ones most likely to hit 4 in fast mode, and possibly 12. Run them in deep, or from the CLI with a bigger `--max-turns`.

So: search and read_source for lookups (free), fast for "where is X / what does Y take", deep when fast came back thin or capped.

## CLI

The same caps are on the CLI:

```sh
lectern ask neoforge-1.21.1 "Which event registers payload handlers?" --fast
lectern ask neoforge-1.21.1 "How do attachments sync to the client?" --max-turns 20
```

## Tests

`node --test test/mcp.test.mjs` spawns the server with `LECTERN_FAKE_ENGINE=1` on a throwaway notebook and talks to it over stdio: initialize and version negotiation, JSON-RPC errors, tools/list schemas, search, read_source with escaping paths, verify, ask with a saved conversation, artifacts and the round-cap error. No model calls, about a second.
