# Security

If you find a security problem, please report it privately through GitHub's private vulnerability reporting on this repo (Security tab, then "Report a vulnerability"). Don't open a public issue for it.

Put in what you did, what happened and the Lectern version (`lectern --version`). I'll answer as soon as I can, it's a one person project so give it a few days.

## What counts

Lectern runs on your own machine, so the things I care most about are:

- anything that lets a web page you visit talk to the local server (it binds to 127.0.0.1 and refuses cross-origin requests, so a way around that is a bug)
- reading or writing files outside a notebook's pinned docs and code roots, through the API, the MCP tools or a crafted citation
- a fetched page, cloned repo or notebook file getting code to run in the app
- anything that sends notebook content somewhere other than Anthropic (see "What leaves your machine" in the README)

Prompt injection from content you pinned yourself is a known limit of any tool like this. If you find a way it can escape the tool sandbox (read a file it shouldn't, write anything), that counts.

## Supported versions

Only the latest release gets fixes.
