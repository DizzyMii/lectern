# Setting up Lectern from the repo

This is for running Lectern straight from a clone of this repo, on a new machine or after a wipe. The README covers what it is and the npm route, this is the step by step.

## 1. Clone and install

Needs Node 20+ (tested on 22) and git.

```
git clone https://github.com/DizzyMii/lectern.git
cd lectern
npm install
npm link
```

`npm link` puts the `lectern` command on your PATH, pointing at this folder, so `git pull` updates it. Check it worked with `lectern --version`.

If you'd rather not link, every `lectern ...` below works as `node bin/lectern.mjs ...` from the repo folder.

## 2. Pick where your data lives

Notebooks, conversations and the registry go in the Lectern home folder (default `~/.lectern`). If your home drive is tight, point it somewhere else once with `~/.lectern.json`:

```json
{ "home": "D:/lectern-home" }
```

`LECTERN_HOME` as an env var does the same thing and wins over the file.

Moving machines? Copy the home folder over and every notebook folder it lists (`registry.json` stores absolute paths, so either keep the same paths or fix them in that file).

## 3. Pick an engine

You need one of these, both is fine.

**Claude Code login (what I use day to day).** Install Claude Code, run `claude` once and log in, make sure `claude` is on your PATH. Nothing else to set. Personal use on your own machine only.

**API key.** Make a key in the Anthropic Console, then paste it into Settings (the cog in the top bar). That's it, it applies straight away and sticks in `settings.json` in the home folder. Setting it in the environment works too:

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
```

If the key was made outside a workspace you also need the workspace id (Console, Settings, Workspaces, starts with `wrkspc_`), otherwise every request comes back 400. It has its own field in Settings, or:

```powershell
$env:ANTHROPIC_WORKSPACE_ID = "wrkspc_..."
```

Easier fix: make the key inside a workspace and skip that. When a key is set it beats the Claude Code login, pass `--engine claude-code` to force the other one.

To check the API engine for real (costs well under a dollar on Haiku, add `--with-opus` for one Opus question, about $2 more):

```
node scripts/live-api-check.mjs
```

It writes `live-api-check.json` into the home folder and never prints the key.

## 4. Make a notebook

```
lectern new my-notes --title "My notes"
lectern add my-notes https://some.docs/page
lectern add my-notes C:/path/to/a/repo
```

or `lectern example node-docs` for a small ready-made one. Then:

```
lectern serve --open
```

and it's on http://127.0.0.1:4317.

## 5. Build the desktop app (optional)

```
npm run build:exe
```

`dist/Lectern Setup.exe` installs it for your user, `dist/Lectern.exe` is the portable one (slow to open, it unpacks every launch). `npm run app` opens the window straight from the clone without building. It uses the same home folder and settings as the CLI, and if `lectern serve` already has the port it just shows that server.

Closing the window sends Lectern to the system tray, where it keeps watching the code roots of every notebook (pinned docs aren't watched). A git pull, a checkout or a save is folded into one re-check about 3 seconds after the last change, and if citations in a saved answer or sheet moved you get a Windows notification like `Moved 3 citations in Question 047`. Click it and the window opens on that question. The tray menu has Open, the answers that drifted since you last opened them, and Quit. Turn on Quit when the window closes in Settings (or set `LECTERN_QUIT_ON_CLOSE=1`) to get the old behaviour back, which you want when you run `npm run app` over and over while editing code, otherwise the new launch just reaches the hidden old one. Quit in the tray menu stops the hidden one.

Quick ask is a global hotkey, so it starts off. Switch on Quick ask hotkey in Settings (or set `LECTERN_QUICK_ASK=1`) and it works right away, no restart. Ctrl+Alt+Space then opens a small always-on-top window from any app, with whatever text you last copied (up to 8,000 characters) already in the palette. File and question matches show at once and cost nothing. Enter asks your last-used notebook on the fast preset (Haiku, low effort), Alt+Enter opens the question in the main window, and Esc or a click elsewhere hides the popup. If another app already owns Ctrl+Alt+Space (the Claude desktop app does on Windows), Lectern shows a "Quick ask is off" notification once and carries on without it. Free the shortcut, then switch the setting off and on again.

## 6. Let Claude Code use it (MCP)

```
claude mcp add lectern --scope user -- lectern mcp
```

Not linked? Use the full path: `claude mcp add lectern --scope user -- node D:/projects/lectern/bin/lectern.mjs mcp`. `search`, `read_source` and `verify` are free, `ask` and `generate` cost tokens. More in [mcp.md](mcp.md).

## 7. Phone and away from home (Tailscale)

This keeps it private to your own tailnet, nothing is on the public internet.

1. Install Tailscale on the PC and the phone, same account.
2. Turn on Serve for the tailnet (the admin console prompts you the first time you run the next line).
3. Run once, it sticks across reboots:
   ```
   tailscale serve --bg --https=443 http://127.0.0.1:4317
   ```
4. Tell Lectern the address and who's allowed in. Tailscale signs every request with your login, Lectern refuses anyone not on the list:
   ```powershell
   $env:LECTERN_PUBLIC_ORIGINS = "https://<machine>.<tailnet>.ts.net"
   $env:LECTERN_ALLOW_USERS = "you@example.com"
   lectern serve --port 4317
   ```
5. On the phone, open `https://<machine>.<tailnet>.ts.net` with Tailscale connected. Chrome menu, Add to home screen, and it opens like an app.

`tailscale status` shows your machine name and tailnet.

The PC has to be on and awake for this to work (set sleep to Never while plugged in, or accept it's only reachable while it's awake).

## 8. Start it at logon (Windows)

Make a launcher, for example `D:\lectern-home\start-lectern.cmd`:

```bat
@echo off
set LECTERN_HOME=D:\lectern-home
set LECTERN_PUBLIC_ORIGINS=https://<machine>.<tailnet>.ts.net
set LECTERN_ALLOW_USERS=you@example.com
cd /d D:\projects\lectern
node bin\lectern.mjs serve --port 4317 >> D:\lectern-home\server.log 2>&1
```

a hidden wrapper next to it, `start-lectern-hidden.vbs`:

```vb
CreateObject("WScript.Shell").Run """D:\lectern-home\start-lectern.cmd""", 0, False
```

and register it once in PowerShell:

```powershell
schtasks /Create /TN "Lectern" /SC ONLOGON /TR "wscript.exe \"D:\lectern-home\start-lectern-hidden.vbs\"" /RL LIMITED /F
```

`schtasks /Run /TN Lectern` starts it right now, `schtasks /Delete /TN Lectern /F` removes it. Logs go to `server.log` in the home folder. Don't put the API key in the launcher, it's a script you might copy around. Use the Claude Code login for the always-on server, or save the key in Settings (that's plain text on disk too, in `settings.json`, so keep the home folder private).

## When something's off

- `host not allowed` on the phone: `LECTERN_PUBLIC_ORIGINS` doesn't match the ts.net address exactly (https, no trailing slash).
- `remote user not allowed`: your tailnet login isn't in `LECTERN_ALLOW_USERS`.
- `This API key is not tied to a workspace`: fill in Workspace id in Settings (step 3).
- Port 4317 taken: Lectern is probably already running, `lectern serve` says so and exits.
- Tests: `npm test`.
