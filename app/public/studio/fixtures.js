// Fixture artifacts for the Studio harness: one of every kind, a 100-node
// graph, a radial concept map, an invalid artifact and an empty one.

const citations = [
  { n: 1, path: 'docs/architecture.md', line: 12, endLine: 18, quote: 'Every request passes through the router first', status: 'verified' },
  { n: 2, path: 'src/server/router.js', line: 40, endLine: 62, quote: null, status: 'verified' },
  { n: 3, path: 'docs/storage.md', line: 88, endLine: 88, quote: 'writes are atomic per document', status: 'moved' },
  { n: 4, path: 'src/store/cache.js', line: 9, endLine: 14, quote: null, status: 'unverified' },
  { n: 5, path: 'docs/old-api.md', line: 3, endLine: 3, quote: 'legacy handlers', status: 'missing' },
];
const base = (o) => ({ status: 'ok', model: 'haiku', costUsd: 0.0123, createdAt: '2026-10-24T10:12:00Z', citations, usage: { input_tokens: 4200, output_tokens: 1800 }, ...o });

// deterministic pseudo random
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }

function bigGraph() {
  const r = rng(7);
  const pkgs = ['server', 'router', 'store', 'cache', 'auth', 'jobs', 'events', 'ui', 'cli', 'config'];
  const nodes = [], edges = [];
  const classNames = ['Handler', 'Service', 'Registry', 'Client', 'Factory', 'Manager', 'Codec', 'Queue', 'Worker', 'Policy', 'Loader', 'View'];
  pkgs.forEach((p) => nodes.push({ id: `pkg.${p}`, label: p, kind: 'package', group: p, detail: `The \`${p}\` package. Entry point for everything ${p}-related [^1].` }));
  let n = 0;
  while (nodes.length < 100) {
    const p = pkgs[Math.floor(r() * pkgs.length)];
    const roll = r();
    const kind = roll < 0.55 ? 'class' : roll < 0.75 ? 'interface' : roll < 0.9 ? 'event' : 'external';
    const name = kind === 'event' ? `${p[0].toUpperCase() + p.slice(1)}${['Started', 'Changed', 'Failed', 'Flushed'][n % 4]}Event`
      : kind === 'external' ? ['node:http', 'node:fs', 'sqlite', 'redis', 'node:crypto', 'ws'][n % 6]
      : `${p[0].toUpperCase() + p.slice(1)}${classNames[n % classNames.length]}${kind === 'interface' ? 'Api' : ''}`;
    const id = `${p}.${name}.${n++}`;
    if (nodes.some((x) => x.label === name)) continue;
    nodes.push({ id, label: name, kind, group: p, detail: `${name} lives in \`${p}\`. It is used by the request path [^2].`, ref: kind === 'external' ? undefined : `src/${p}/${name}.js#L${10 + n}` });
    edges.push({ from: `pkg.${p}`, to: id, label: n % 7 === 0 ? 'exports' : undefined });
  }
  const leaves = nodes.filter((x) => x.kind !== 'package');
  for (let i = 0; i < 46; i++) {
    const a = leaves[Math.floor(r() * leaves.length)], b = leaves[Math.floor(r() * leaves.length)];
    if (a === b || a.kind === 'external') continue;
    edges.push({ from: a.id, to: b.id, label: i % 5 === 0 ? ['calls', 'emits', 'reads', 'wraps'][i % 4] : undefined, kind: i % 9 === 0 ? 'cycle' : undefined });
  }
  edges.push({ from: 'pkg.server', to: 'pkg.router', label: 'mounts' }, { from: 'pkg.router', to: 'pkg.auth' }, { from: 'pkg.cli', to: 'pkg.server', label: 'starts' }, { from: 'pkg.jobs', to: 'pkg.store' }, { from: 'pkg.ui', to: 'pkg.events' });
  return { title: 'Code map: whole repo', layout: 'layered', nodes, edges };
}

function conceptMap() {
  const hub = { id: 'core', label: 'Request lifecycle', kind: 'concept', detail: 'How one request travels through the system [^1].' };
  const topics = {
    Routing: ['Path params', 'Middleware order', 'Not-found fallback', 'Method guards'],
    Auth: ['Session cookie', 'Token refresh', 'Origin check'],
    Storage: ['Atomic writes', 'Cache invalidation', 'Migrations', 'Backups', 'Locks'],
    Streaming: ['Server-sent events', 'Backpressure', 'Cancel on disconnect'],
    Errors: ['Error envelope', 'Retries', 'Logging'],
    Config: ['Env vars', 'Defaults', 'Per-notebook overrides'],
  };
  const nodes = [hub], edges = [];
  for (const [t, kids] of Object.entries(topics)) {
    const id = 't-' + t;
    nodes.push({ id, label: t, kind: 'topic', detail: `${t} in brief [^2].` });
    edges.push({ from: 'core', to: id });
    for (const k of kids) { const kid = id + '-' + k; nodes.push({ id: kid, label: k, kind: 'term', detail: `${k}: see [^3].`, ref: 'docs/storage.md#L88' }); edges.push({ from: id, to: kid }); }
  }
  edges.push({ from: 't-Streaming-Cancel on disconnect', to: 't-Errors-Logging', label: 'logs' }, { from: 't-Auth-Session cookie', to: 't-Storage-Locks' });
  return { title: 'Concepts', layout: 'radial', nodes, edges };
}

function flow() {
  const nodes = [
    { id: 'start', label: 'Request arrives', kind: 'start' },
    { id: 'parse', label: 'Parse URL and body', kind: 'step', ref: 'src/server/router.js#L40' },
    { id: 'auth', label: 'Signed in?', kind: 'decision', detail: 'Checks the session cookie [^1].' },
    { id: 'login', label: 'Redirect to login', kind: 'step' },
    { id: 'route', label: 'Match route', kind: 'step' },
    { id: 'found', label: 'Route found?', kind: 'decision' },
    { id: 'nf', label: 'Serve 404 page', kind: 'step' },
    { id: 'cache', label: 'Cached?', kind: 'decision' },
    { id: 'hit', label: 'Send cached body', kind: 'step' },
    { id: 'handler', label: 'Run handler', kind: 'step', detail: 'The handler reads from the store [^3].' },
    { id: 'store', label: 'Write to store', kind: 'step' },
    { id: 'respond', label: 'Send response', kind: 'end' },
  ];
  const edges = [
    { from: 'start', to: 'parse' }, { from: 'parse', to: 'auth' },
    { from: 'auth', to: 'login', label: 'no' }, { from: 'auth', to: 'route', label: 'yes' },
    { from: 'route', to: 'found' }, { from: 'found', to: 'nf', label: 'no' }, { from: 'found', to: 'cache', label: 'yes' },
    { from: 'cache', to: 'hit', label: 'yes' }, { from: 'cache', to: 'handler', label: 'no' },
    { from: 'handler', to: 'store' }, { from: 'store', to: 'respond' }, { from: 'hit', to: 'respond' }, { from: 'nf', to: 'respond' },
    { from: 'handler', to: 'route', label: 'retry', kind: 'cycle' },
  ];
  return { title: 'How a request is served', layout: 'layered', nodes, edges };
}

const doc = base({
  id: 'a-doc', recipe: 'onboarding', kind: 'doc', title: 'Onboarding guide',
  markdown: `# Onboarding guide

Welcome. This guide walks a new contributor from a clean checkout to a first merged change. It assumes you can read JavaScript and have used a terminal before.

## How the pieces fit

Every request passes through the router first [^1], which picks a handler by path and method [^2]. Handlers talk to the store, and writes are atomic per document [^3].

| Layer | Lives in | Owns |
| --- | --- | --- |
| Router | \`src/server/router.js\` | matching, middleware order |
| Store | \`src/store/\` | documents, locks, cache [^4] |
| UI | \`public/\` | everything the browser sees |

### A tiny handler

\`\`\`js
export async function getNote(req, res, { store }) {
  const note = await store.read('notes', req.params.id);
  if (!note) return res.status(404).json({ error: 'not found' });
  res.json(note);
}
\`\`\`

## Your first change

1. Run the test suite once so you know it is green.
2. Pick an issue labelled *good first issue*.
3. Write the failing test first, then the fix.

> **Tip.** The old handler style is gone; anything mentioning legacy handlers is out of date [^5].

## Where to ask

Open a discussion, or ping the maintainers in the project channel. Expect an answer within a day.

### Glossary pointers

- **Root**: a folder of code the notebook can read.
- **Artifact**: anything the Studio made for you.
`,
});

// a small code map shaped like the CodeMap board: refs on three sources, one moved
const mapCites = [
  { n: 1, path: 'neoforge/network/registration/PayloadRegistrar.java', line: 58, endLine: 64, status: 'verified', quote: null },
  { n: 2, path: 'neoforge/network/event/RegisterPayloadHandlersEvent.java', line: 31, endLine: 31, status: 'verified', quote: 'public PayloadRegistrar registrar(String version) {' },
  { n: 3, path: 'docs/networking/payload.md', line: 96, endLine: 96, citedLine: 92, status: 'moved', quote: 'By default, handlers are executed on the main thread.' },
];
const graphMap = base({
  id: 'a-graph-map', recipe: 'code-map', kind: 'graph', title: 'Networking map', citations: mapCites,
  data: {
    title: 'Networking map', layout: 'layered', direction: 'TB',
    nodes: [
      { id: 'bus', label: 'Mod event bus', kind: 'external' },
      { id: 'evt', label: 'RegisterPayloadHandlersEvent', kind: 'event', ref: 'neoforge/network/event/RegisterPayloadHandlersEvent.java#L31' },
      { id: 'reg', label: 'PayloadRegistrar', kind: 'class', ref: 'neoforge/network/registration/PayloadRegistrar.java#L58', detail: 'Builder handed out by RegisterPayloadHandlersEvent. Each `play*` / `configuration*` call registers one payload type with its codec and handler [^1][^2]. Handlers run on the main thread unless `executesOn` says otherwise [^3].' },
      { id: 'cpp', label: 'CustomPacketPayload', kind: 'interface', ref: 'neoforge/network/CustomPacketPayload.java#L12' },
      { id: 'type', label: 'CustomPacketPayload.Type', kind: 'class', ref: 'neoforge/network/CustomPacketPayload.java#L20' },
      { id: 'codec', label: 'StreamCodec', kind: 'interface', ref: 'neoforge/network/codec/StreamCodec.java#L9' },
      { id: 'handler', label: 'IPayloadHandler', kind: 'interface', ref: 'neoforge/network/handling/IPayloadHandler.java#L7' },
      { id: 'ctx', label: 'IPayloadContext', kind: 'interface', ref: 'neoforge/network/handling/IPayloadContext.java#L15' },
      { id: 'thread', label: 'HandlerThread', kind: 'class', ref: 'docs/networking/payload.md#L92' },
      { id: 'nr', label: 'NetworkRegistry', kind: 'class', ref: 'neoforge/network/registration/NetworkRegistry.java#L388' },
      { id: 'listener', label: 'ClientPacketListener', kind: 'external' },
      { id: 'dist', label: 'PacketDistributor', kind: 'class', ref: 'neoforge/network/PacketDistributor.java#L41' },
      { id: 'ping', label: 'PingPayload', kind: 'class', ref: 'wtg/net/PingPayload.java#L11' },
      { id: 'sping', label: 'ServerPing', kind: 'class', ref: 'wtg/net/ServerPing.java#L14' },
    ],
    edges: [
      { from: 'bus', to: 'evt', label: 'posts' }, { from: 'evt', to: 'reg', label: 'registrar(version)' },
      { from: 'reg', to: 'type', label: 'keyed by' }, { from: 'reg', to: 'codec', label: 'encodes with' }, { from: 'reg', to: 'handler', label: 'routes to' },
      { from: 'reg', to: 'nr', label: 'registers in' }, { from: 'handler', to: 'ctx', label: 'receives' }, { from: 'nr', to: 'thread', label: 'dispatches on' },
      { from: 'dist', to: 'nr', label: 'looks up' }, { from: 'listener', to: 'dist', label: 'sends via', kind: 'async' },
      { from: 'ping', to: 'cpp', label: 'implements' }, { from: 'sping', to: 'handler', label: 'implements' },
    ],
  },
});

const graphBig = base({ id: 'a-graph-big', recipe: 'code-map', kind: 'graph', title: 'Code map (100 nodes)', data: bigGraph(), summary: 'Built from a Glob of `src/` and the import lines in each file [^2].' });
const graphRadial = base({ id: 'a-graph-radial', recipe: 'concept-map', kind: 'graph', title: 'Concept map', data: conceptMap() });
const graphFlow = base({ id: 'a-graph-flow', recipe: 'flow-diagram', kind: 'graph', title: 'Request flow', data: flow() });

const sequence = base({
  id: 'a-seq', recipe: 'sequence-diagram', kind: 'sequence', title: 'Saving a note',
  data: {
    title: 'Saving a note',
    actors: [
      { id: 'user', label: 'User', kind: 'user' },
      { id: 'ui', label: 'Browser UI', kind: 'component' },
      { id: 'api', label: 'HTTP server', kind: 'service' },
      { id: 'store', label: 'Note store', kind: 'store' },
      { id: 'disk', label: 'File system', kind: 'external' },
    ],
    steps: [
      { from: 'user', to: 'ui', label: 'Clicks Save as note' },
      { from: 'ui', to: 'api', label: 'POST /notes with title and body [^2]', ref: 'src/server/router.js#L40-L62' },
      { from: 'api', to: 'api', label: 'Validate and slug the title', note: 'Slugs are lowercased and deduped with a counter.' },
      { from: 'api', to: 'store', label: 'save(note)' },
      { from: 'store', to: 'disk', label: 'write temp file, then rename', note: 'Writes are atomic per document [^3].', ref: 'docs/storage.md#L88' },
      { from: 'disk', to: 'store', label: 'ok' },
      { from: 'store', to: 'api', label: 'note with id' },
      { from: 'api', to: 'ui', label: '201 Created' },
      { from: 'api', to: 'ui', label: 'SSE: notes changed', async: true },
      { from: 'ui', to: 'user', label: 'Toast: Saved' },
    ],
  },
});

const plan = base({
  id: 'a-plan', recipe: 'impl-plan', kind: 'plan', title: 'Implementation plan: note sharing',
  checks: { 'T1#0': true, 'T1#1': true, 'T2#0': true },
  data: {
    title: 'Note sharing',
    goal: 'Let a user share a read-only link to a note, revocable at any time, without adding accounts [^1].',
    phases: [
      { name: 'Foundations', tasks: [
        { id: 'T1', title: 'Add a share token to the note schema', detail: 'Tokens are random 128-bit values stored next to the note [^3].', files: ['src/store/notes.js', 'src/store/schema.js'], dependsOn: [], estimate: 'S', ref: 'src/store/cache.js#L9', acceptance: ['Token survives a restart', 'Old notes load without a token'] },
        { id: 'T2', title: 'Route for GET /s/:token', detail: 'Serves the note read-only. Unknown tokens get the normal 404 page.', files: ['src/server/router.js'], dependsOn: ['T1'], estimate: 'M', acceptance: ['Valid token renders the note', 'Revoked token returns 404'] },
      ] },
      { name: 'UI', tasks: [
        { id: 'T3', title: 'Share button and copy-link popover', detail: 'Lives in the note header.', files: ['public/ui/notes.js', 'public/styles.css'], dependsOn: ['T2'], estimate: 'M', acceptance: ['Link copies on click', 'Keyboard reachable', 'Works in both themes'] },
        { id: 'T4', title: 'Revoke link', detail: 'Clears the token and shows a toast.', files: ['public/ui/notes.js'], dependsOn: ['T1', 'T3'], estimate: 'S', acceptance: [] },
      ] },
      { name: 'Hardening', tasks: [
        { id: 'T5', title: 'Rate limit token lookups', detail: 'A small in-memory bucket per IP.', files: ['src/server/limits.js'], dependsOn: ['T2'], estimate: 'L', acceptance: ['100 bad tokens a minute get 429'] },
        { id: 'T6', title: 'Tests for the share flow', detail: 'End to end with the fake engine.', files: ['test/share.test.mjs'], dependsOn: ['T2', 'T4', 'T9'], estimate: 'M', acceptance: ['Green on CI'] },
      ] },
    ],
  },
});

const quiz = base({
  id: 'a-quiz', recipe: 'agent-quiz', kind: 'quiz', title: 'Agent quiz: storage',
  data: {
    title: 'Storage quiz',
    questions: [
      { id: 'q1', q: 'What guarantees does the store give on a single write?', kind: 'single', options: ['None', 'Writes are atomic per document', 'Writes are atomic across documents', 'Writes are queued and eventually applied'], answer: 'Writes are atomic per document', explain: 'The storage doc says so directly [^3].', ref: 'docs/storage.md#L88' },
      { id: 'q2', q: 'Which of these pass through the router? Choose all.', kind: 'multi', options: ['API requests', 'Static files', 'SSE streams', 'Background jobs'], answer: ['API requests', 'Static files', 'SSE streams'], explain: 'Every request passes through the router first [^1]; jobs never arrive over HTTP.' },
      { id: 'q3', q: 'Name the file that matches routes to handlers.', kind: 'short', answer: 'src/server/router.js', explain: 'See the routing table [^2].', ref: 'src/server/router.js#L40' },
      { id: 'q4', q: 'Legacy handlers are still the recommended style.', kind: 'single', options: ['True', 'False'], answer: 'B', explain: 'They were removed [^5].' },
      { id: 'q5', q: 'What does the cache key include?', kind: 'short', answer: 'the document id and its version', explain: 'From the cache module [^4].' },
    ],
  },
});

const flashcards = base({
  id: 'a-cards', recipe: 'flashcards', kind: 'quiz', title: 'Flashcards: core terms',
  data: {
    title: 'Core terms',
    questions: [
      { id: 'f1', q: 'What is a **root**?', kind: 'short', answer: 'A folder of code the notebook may read.', explain: 'Roots are listed in notebook.json [^1].' },
      { id: 'f2', q: 'What makes a write atomic here?', kind: 'short', answer: 'Write to a temp file, then rename over the original.', explain: 'Per document only [^3].', ref: 'docs/storage.md#L88' },
      { id: 'f3', q: 'Where does every request go first?', kind: 'short', answer: 'The router.', explain: '[^1]' },
      { id: 'f4', q: 'What does SSE stand for?', kind: 'short', answer: 'Server-sent events.' },
      { id: 'f5', q: 'What happens to a stream when the client disconnects?', kind: 'short', answer: 'The child process is cancelled.', explain: 'The ask route listens for the close event [^2].' },
    ],
  },
});

const file = base({
  id: 'a-file', recipe: 'claude-md', kind: 'file', title: 'CLAUDE.md', inputs: { root: 'app' },
  data: {
    filename: 'CLAUDE.md', language: 'markdown',
    notes: 'Kept under 120 lines so it stays in context. Conventions come from the router and store code [^2].',
    content: `# Project notes for agents

## Build and test
- \`npm test\` runs the offline suite. It must stay green.
- No build step. Edit files under \`public/\` and reload.

## Conventions
- Node 22 ESM, no framework.
- Never spawn through a shell.
- Code comments are sparse and plain.

## Layout
\`\`\`
src/server/   http routes, SSE
src/store/    documents and locks
public/       the browser app
\`\`\`

## Gotchas
1. Writes are atomic per document only.
2. The router runs middleware in registration order.
`,
  },
});

const fileJs = base({
  id: 'a-file-js', recipe: 'skill', kind: 'file', title: 'limits.js',
  data: {
    filename: 'src/server/limits.js', language: 'javascript',
    content: `// Token bucket per client address.\nconst buckets = new Map();\n\nexport function allow(ip, { rate = 100, per = 60_000 } = {}) {\n  const now = Date.now();\n  const b = buckets.get(ip) ?? { tokens: rate, at: now };\n  b.tokens = Math.min(rate, b.tokens + ((now - b.at) / per) * rate);\n  b.at = now;\n  if (b.tokens < 1) { buckets.set(ip, b); return false; }\n  b.tokens -= 1;\n  buckets.set(ip, b);\n  return true;\n}\n`,
  },
});

const invalid = base({
  id: 'a-invalid', recipe: 'code-map', kind: 'graph', title: 'Broken code map', status: 'invalid', data: undefined,
  errors: ['nodes[3].id is missing', 'edges[7].to references unknown node "Cache"', 'expected 3 to 120 nodes, got 2'],
  raw: 'Here is the code map.\n\n```json\n{ "title": "Code map", "nodes": [{"id":"a"},{"label":"no id"}], "edges": [{"from":"a","to":"Cache"}] }\n```',
});

const empty = base({ id: 'a-empty', recipe: 'onboarding', kind: 'doc', title: 'Empty doc', markdown: '' });

export const FIXTURES = [
  { key: 'doc', label: 'Doc', artifact: doc },
  { key: 'graph-map', label: 'Graph, map', artifact: graphMap },
  { key: 'graph-big', label: 'Graph, 100 nodes', artifact: graphBig },
  { key: 'graph-radial', label: 'Graph, radial', artifact: graphRadial },
  { key: 'graph-flow', label: 'Graph, flow', artifact: graphFlow },
  { key: 'sequence', label: 'Sequence', artifact: sequence },
  { key: 'plan', label: 'Plan', artifact: plan },
  { key: 'quiz', label: 'Quiz', artifact: quiz },
  { key: 'cards', label: 'Flashcards', artifact: flashcards },
  { key: 'file', label: 'File', artifact: file },
  { key: 'file-js', label: 'File, JS', artifact: fileJs },
  { key: 'invalid', label: 'Invalid', artifact: invalid },
  { key: 'empty', label: 'Empty', artifact: empty },
];
