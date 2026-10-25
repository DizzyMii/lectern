# Changelog

## 1.0.0-rc.1 (2026-10-25)

First public build, moved out of the spike folder it grew up in.

- `npx @dizzymii/lectern serve` runs it, `lectern` is the one command for everything (serve, ask, mcp, list, show, new, add, migrate)
- state moved out of the app folder into a home folder: `LECTERN_HOME`, else `"home"` in `~/.lectern.json`, else `~/.lectern`
- notebooks are plain folders anywhere on disk, registered by absolute path
- `lectern migrate <old app folder>` brings over an old registry and base sessions
- `lectern add` takes a URL, a git URL, a folder or a file and works out which one it is
- the MCP server (`lectern mcp`) ships in the package, setup for Claude Code and Cursor is in the README
- every ask has a round cap now (4 on fast, 12 otherwise), hitting it gives an error with the cap in it
- citations get re-checked against the files every time you open a conversation or artifact, so drift shows up as it happens
- 24 Studio recipes, all with checked citations
- licensed under PolyForm Shield 1.0.0
- the page sends a CSP that blocks loads from other hosts, and the sanitizer drops media tags, srcset, poster and background, so an answer can't leak notebook text through an image
- file reads, tree listings, the model's tools and Studio write-to check real paths, so a symlink or junction in a root can't reach outside it
- git never runs a repo's own fsmonitor, hooks, textconv or filters, and roots whose config sets them are refused for diff and log inputs
- claude -p runs with a hook that keeps Read, Grep and Glob inside the notebook and its roots, and without `ANTHROPIC_API_KEY` in its env
- API GETs from other sites are refused, and regex search runs in a child process with a 5 s limit
- URL sources refuse loopback and private addresses, clones are https or git@ only with a 1 GB cap
- `lectern ask` follows the same engine default as the server, `--engine` is checked and documented

Known rough edges are listed in the README. All the measured numbers come from one NeoForge notebook, I'll add more as I test other stacks.
