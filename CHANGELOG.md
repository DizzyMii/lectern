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
- Settings has Connect Claude Code and Connect Cursor buttons in the desktop app. They register `lectern mcp` to run through the installed exe, so no Node or npm is needed. Connect Cursor shows the change first and keeps a `.bak`
- closing the desktop window keeps Lectern in the tray now. It watches every notebook's code roots, and when a git pull or a save moves citations in saved answers or sheets it shows a notification (`Moved 3 citations in Question 047`) that opens that question. The tray menu lists the answers that drifted since you last opened them
- new setting Quit when the window closes (`LECTERN_QUIT_ON_CLOSE`) for the old close-means-quit behaviour
- quick ask in the desktop app. Switch on Quick ask hotkey in Settings and Ctrl+Alt+Space in any app opens a small window with your clipboard in the palette. Enter asks your last notebook on the fast preset, Alt+Enter opens the question in the main window. Off by default, and if another app owns the key you get one notification and nothing else changes
- `POST /api/notebooks/:nb/ask` takes `fast: true` for the fast preset (Haiku, low effort, 4 rounds). A model you name still wins

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
