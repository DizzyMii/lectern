# Contributing

Issues and pull requests are welcome. For anything bigger than a fix, open an issue first so we can agree on the shape before you write it.

## Running it

```
npm install
npm start          # the web app on http://127.0.0.1:4317
node test/all.mjs  # the whole suite, about 400 tests in under a minute
```

The tests never call a model and need no API key. They run against fake engines (`LECTERN_FAKE_ENGINE=1`) and recorded API streams in `test/fixtures/api`, with a temp Lectern home each, so they won't touch your notebooks. CI runs them on Ubuntu, macOS and Windows with Node 20 and 22. If your change depends on an API key or a `claude` binary being around, the test is wrong (unset `ANTHROPIC_API_KEY` and run it again to check).

`scripts/live-api-check.mjs` makes a few real Haiku calls to check prompt caching against the live API. It costs a little money, so it isn't part of the suite.

## Changes

- Keep a change to one thing, with a test that fails without it.
- Match the code around it. The style is dense on purpose, small helpers and a comment only where the why isn't obvious.
- Anything that writes files, runs git or other programs, or changes settings has to stay on the machine Lectern runs on (`isLocal` in `lib/server.mjs`) and check its input. `SECURITY.md` has the scope.
- UI work follows `docs/design/DESIGN.md`.
- Commit messages say what changed and, when it isn't obvious, why. No prefixes like `feat:`.

## License

Lectern is Apache-2.0. By sending a pull request you agree your change goes out under the same license, and you sign off each commit to say you have the right to send it ([Developer Certificate of Origin](https://developercertificate.org/)):

```
git commit -s
```
