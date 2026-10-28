# Changelog

## Unreleased

- there's a desktop app now. `npm run build:exe` makes an installer and a portable exe (Electron, Windows), and `npm run app` runs it from a clone
- the window has no title bar of its own, the top bar drags it and the minimize, maximize and close buttons sit at its right end in the theme's colours
- Settings page behind the cog in the top bar: API key, workspace id, Claude Code path, projects folder, clone cap, private URLs and port. They save to `settings.json` in the home folder, apply straight away and win over env vars
- the API key only ever comes back to the page as its last four characters
- over Tailscale you can look at settings but only the machine Lectern runs on can change them
- the no-engine message points at Settings now instead of telling you to restart with an env var
- CI skips the Electron download, the tests never start it
- API engine caching is one-hour now (shelf, the earlier turns and the growing end), so a follow-up asked 20 minutes later still reads the shelf from cache instead of paying for it again
- follow-ups on the API engine send the earlier turns back whole, tool rounds and thinking included, so the model remembers the files it already read. When the docs, roots or system prompt changed in between it falls back to plain text, since the API refuses old thinking blocks against a changed prefix
- one-hour cache writes are priced at 2x in the spend meter and budgets
- a conversation whose last answer can't be sent back as is, or that got near the context window, drops to plain text for the next follow-up, and a resend the API rejects is asked again in plain text, so neither one gets stuck
- after a mid-answer model fallback, the declined model's tool calls are no longer run or sent back
- `lectern check <notebook> [files...]` and the `check_notebook` MCP tool re-check every saved conversation, sheet and note, plus the footnotes in named markdown files, and list what got worse. `--fail-on moved|unverified` makes it exit 1 for CI or a pre-commit hook. It never writes
- lines in the file drawer that a saved answer, sheet or note cites get a status mark in the gutter, with a stem down a cited range. Page mode marks the block. Hover or click a mark to see what cites it and jump there, and a `Cited by n` button in the drawer header lists the whole file. Statuses are re-checked when the file opens and nothing is written
- reopening an answer or a sheet shows what the re-check changed: the receipt gets a `Written Oct 24` and a `Today` line, only the marks that changed stamp in again, a moved mark rolls from the old line to the new one, hover cards get a History row, and a warn banner says how many citations got worse. On an answer the banner has Re-ask, which opens a new conversation with the same question. Sheets get `generatedAt` so ticking a plan box doesn't change the printed date

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
