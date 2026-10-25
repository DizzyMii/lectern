// Mock Studio backend for ?mock=1. Used only when dev-mock.js does not answer a studio route.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

const C1 = 'corpus/fastify-docs/docs/Reference/Validation-and-Serialization.md';
const C2 = 'fastify/lib/error-handler.js';
const C3 = 'corpus/fastify-docs/docs/Guides/Migration-Guide-V5.md';
const C5 = 'docs/architecture/realtime.md';

const T = (name, label, type, required = false, extra = {}) => ({ name, label, type, required, ...extra });

export const RECIPES = [
  { id: 'prd', group: 'plan', kind: 'doc', title: 'PRD', blurb: 'Turn a rough idea into a product requirements doc', inputs: [T('idea', 'Idea', 'longtext', true, { placeholder: 'What should exist, and for whom?' })] },
  { id: 'tech-spec', group: 'plan', kind: 'doc', title: 'Tech spec', blurb: 'Design the build, grounded in the codebase', inputs: [T('from', 'From PRD', 'artifact', false, { from: ['prd'] }), T('idea', 'Or describe it', 'longtext', false, { placeholder: 'Skip if you picked a PRD' })] },
  { id: 'impl-plan', group: 'plan', kind: 'plan', title: 'Implementation plan', blurb: 'Phased tasks with files, deps and checks', inputs: [T('from', 'From spec', 'artifact', false, { from: ['tech-spec', 'prd'] }), T('idea', 'Or describe it', 'longtext')] },
  { id: 'adr', group: 'plan', kind: 'doc', title: 'Decision record', blurb: 'Weigh the options and record the call', inputs: [T('decision', 'Decision', 'text', true, { placeholder: 'Which queue to use for order events' }), T('options', 'Options', 'longtext', false, { placeholder: 'One per line' })] },
  { id: 'test-plan', group: 'plan', kind: 'doc', title: 'Test plan', blurb: 'What to test, how, and what proves it', inputs: [T('from', 'From spec', 'artifact', false, { from: ['tech-spec', 'prd'] }), T('feature', 'Or describe the feature', 'longtext')] },

  { id: 'code-map', group: 'visual', kind: 'graph', title: 'Code map', blurb: 'The important packages and classes of a root', inputs: [T('root', 'Root', 'root', true), T('focus', 'Focus', 'text', false, { placeholder: 'Optional, like networking' })] },
  { id: 'concept-map', group: 'visual', kind: 'graph', title: 'Concept map', blurb: 'How the ideas in the docs connect', inputs: [T('topic', 'Topic', 'text', false, { placeholder: 'Optional' })] },
  { id: 'flow-diagram', group: 'visual', kind: 'graph', title: 'Flow diagram', blurb: 'Trace how something happens, step by step', inputs: [T('flow', 'Trace how', 'text', true, { placeholder: 'an order gets from checkout to the database' })] },
  { id: 'sequence-diagram', group: 'visual', kind: 'sequence', title: 'Sequence diagram', blurb: 'Who calls whom, in order', inputs: [T('feature', 'Feature', 'text', true, { placeholder: 'Signing in' })] },
  { id: 'dependency-graph', group: 'visual', kind: 'graph', title: 'Dependency graph', blurb: 'Imports between packages, cycles marked', inputs: [T('root', 'Root', 'root', true)] },

  { id: 'claude-md', group: 'agent', kind: 'file', title: 'CLAUDE.md', blurb: 'House rules an agent reads before it codes', inputs: [T('root', 'Root', 'root'), T('audience', 'Audience', 'text', false, { placeholder: 'Optional' })] },
  { id: 'agents-md', group: 'agent', kind: 'file', title: 'AGENTS.md', blurb: 'The same, for any coding agent', inputs: [T('root', 'Root', 'root')] },
  { id: 'skill', group: 'agent', kind: 'file', title: 'Skill', blurb: 'A SKILL.md with frontmatter, ready to drop in', inputs: [T('topic', 'Topic', 'text', true, { placeholder: 'Adding a route' })] },
  { id: 'agent-quiz', group: 'agent', kind: 'quiz', title: 'Agent quiz', blurb: 'Questions to check an agent knows the sources', inputs: [T('topic', 'Topic', 'text')] },

  { id: 'onboarding', group: 'learn', kind: 'doc', title: 'Onboarding guide', blurb: 'Day one through week one, in order', inputs: [] },
  { id: 'cheat-sheet', group: 'learn', kind: 'doc', title: 'Cheat sheet', blurb: 'One page of what you reach for', inputs: [] },
  { id: 'porting-guide', group: 'learn', kind: 'doc', title: 'Porting guide', blurb: 'From one version or API to another', inputs: [T('from', 'From', 'text', true), T('to', 'To', 'text', true)] },
  { id: 'gotchas', group: 'learn', kind: 'doc', title: 'Gotchas', blurb: 'Traps, crashes and silent failures', inputs: [] },
  { id: 'glossary', group: 'learn', kind: 'doc', title: 'Glossary', blurb: 'Every term, defined against the sources', inputs: [] },
  { id: 'flashcards', group: 'learn', kind: 'quiz', title: 'Flashcards', blurb: 'Flip cards with got-it and again piles', inputs: [T('topic', 'Topic', 'text')] },

  { id: 'gap-report', group: 'code', kind: 'doc', title: 'Gap report', blurb: 'Where the code and the docs disagree', inputs: [T('root', 'Root', 'root', true)] },
  { id: 'diff-review', group: 'code', kind: 'doc', title: 'Diff review', blurb: 'Findings ranked, each with the right way', inputs: [T('diff', 'Diff', 'diff', true)] },
  { id: 'build-x', group: 'code', kind: 'doc', title: 'How would I build', blurb: 'A plan that reuses patterns already here', inputs: [T('what', 'Build what', 'text', true, { placeholder: 'a settings page' })] },
  { id: 'release-notes', group: 'code', kind: 'doc', title: 'Release notes', blurb: 'From a git range to notes people read', inputs: [T('log', 'Commits', 'gitlog', true)] },
];

const cites = [
  { n: 1, path: C1, line: 9, endLine: 9, quote: 'Fastify uses a schema-based approach', status: 'verified' },
  { n: 2, path: C2, line: 48, endLine: 61, quote: null, status: 'verified' },
  { n: 3, path: C3, line: 4, endLine: 4, quote: 'The jsonShortHand option has been removed', status: 'moved' },
  { n: 4, path: C5, line: 20, endLine: 26, quote: null, status: 'unverified' },
];

const DOC_MD = `## Who this is for

New contributors who can read TypeScript and want to ship a first change to the orders service inside a week. Read it top to bottom once, then keep it open as a map.

## Day one: the shape of things

Every route is a plugin registered on the app, and errors from any of them land in one error handler per scope [^2]. Request bodies are checked by a JSON Schema on the route, never by hand [^1].

| Area | Start here | Why |
| --- | --- | --- |
| Routes | \`src/api/router.ts\` | Every route is registered here |
| Input | Route schemas | Replaces the old hand-written checks [^3] |
| Realtime | The list channel | Pushes item changes to open clients [^4] |

## Day two: make one change end to end

1. Add a route with a body schema.
2. Call the domain service from the handler, never the store.
3. Return the shape the API docs promise.

\`\`\`ts
app.post('/lists/:id/items', { schema: { body: AddItemBody } }, async (req) => {
  return lists.addItem(req.params.id, req.body, req.user);
});
\`\`\`

## Week one: the traps

> A decorator added inside a plugin is invisible to its siblings. Wrap shared ones with \`fastify-plugin\`.

### Things that fail silently

- Registering a route after the server started listening.
- A schema without \`type: 'object'\`, which v5 rejects.
- Sending a reply twice from an async handler.

## Where to look next

The migration guide explains each breaking change in v5 [^3]. The realtime doc covers the list channel end to end [^4].`;

const GRAPH = {
  title: 'Request path through the service',
  layout: 'layered',
  nodes: [
    { id: 'app', label: 'App entry', kind: 'class', group: 'core', detail: 'Builds the server and registers every plugin.' },
    { id: 'hooks', label: 'Lifecycle hooks', kind: 'event', group: 'core', detail: 'onRequest, preHandler and onSend run in a fixed order.' },
    { id: 'router', label: 'Router', kind: 'class', group: 'api', detail: 'Registers the order and list routes.' },
    { id: 'schema', label: 'Route schema', kind: 'interface', group: 'api', detail: 'JSON Schema for body, params and query.', ref: `${C1}#L9` },
    { id: 'err', label: 'Error handler', kind: 'class', group: 'api', detail: 'Turns validation and domain errors into the API error shape.', ref: `${C2}#L48-L61` },
    { id: 'orders', label: 'Orders', kind: 'package', group: 'domain' },
    { id: 'lists', label: 'Lists', kind: 'package', group: 'domain' },
    { id: 'svc', label: 'OrderService', kind: 'class', group: 'domain', detail: 'The only place that changes an order.' },
    { id: 'repo', label: 'OrderRepository', kind: 'interface', group: 'store', detail: 'Storage behind the service.' },
    { id: 'pg', label: 'Postgres', kind: 'external', group: 'store', detail: 'Rows and the outbox table.' },
    { id: 'outbox', label: 'Outbox', kind: 'class', group: 'events' },
    { id: 'channel', label: 'List channel', kind: 'concept', group: 'events', ref: `${C5}#L20` },
    { id: 'push', label: 'Client push', kind: 'step', group: 'events' },
    { id: 'save', label: 'Commit', kind: 'step', group: 'store' },
  ],
  edges: [
    { from: 'app', to: 'hooks', label: 'adds' }, { from: 'app', to: 'router', label: 'registers' }, { from: 'hooks', to: 'router', label: 'wraps' },
    { from: 'router', to: 'schema' }, { from: 'router', to: 'err', label: 'falls back to' }, { from: 'router', to: 'orders' }, { from: 'router', to: 'lists' },
    { from: 'orders', to: 'svc' }, { from: 'svc', to: 'repo', label: 'reads / writes' }, { from: 'repo', to: 'pg' },
    { from: 'svc', to: 'outbox', label: 'same transaction' }, { from: 'lists', to: 'svc' }, { from: 'pg', to: 'save' },
    { from: 'outbox', to: 'channel' }, { from: 'channel', to: 'push', label: 'fans out' }, { from: 'push', to: 'channel', kind: 'cycle' },
  ],
};

const SEQ = {
  title: 'Adding an item to a shared list',
  actors: [{ id: 'user', label: 'User', kind: 'external' }, { id: 'web', label: 'Web app' }, { id: 'api', label: 'API' }, { id: 'db', label: 'Database' }],
  steps: [
    { from: 'user', to: 'web', label: 'Types an item and presses Enter' },
    { from: 'web', to: 'web', label: 'Adds it optimistically', note: 'Marked pending until the API answers' },
    { from: 'web', to: 'api', label: 'POST /lists/:id/items', ref: `${C5}#L20` },
    { from: 'api', to: 'api', label: 'Schema check on the body', note: 'A bad body never reaches the handler' },
    { from: 'api', to: 'db', label: 'Insert item and outbox row', async: true },
    { from: 'db', to: 'api', label: 'Committed' },
    { from: 'api', to: 'web', label: '201 with the stored item', async: true },
    { from: 'api', to: 'web', label: 'Channel push to other members' },
  ],
};

const PLAN = {
  title: 'Who added each item',
  goal: 'Every list item stores who added it and when, and every member sees it on the row.',
  phases: [
    { name: 'Data', tasks: [
      { id: 't1', title: 'Add addedBy and addedAt', detail: 'A migration with both columns, backfilled from the audit log.', files: ['migrations/0031_item_added_by.sql'], dependsOn: [], ref: `${C2}#L48-L61`, estimate: 'S', acceptance: ['Migration runs twice safely', 'Backfill covers old rows'] },
      { id: 't2', title: 'Write them on insert', detail: 'The list service sets both from the request user.', files: ['src/store/lists.ts'], dependsOn: ['t1'], estimate: 'S', acceptance: ['Never taken from the body'] },
    ] },
    { name: 'API', tasks: [
      { id: 't3', title: 'Return them from the list route', detail: 'Add both fields to the response schema.', files: ['src/api/lists.ts'], dependsOn: ['t2'], estimate: 'M', acceptance: ['Schema updated', 'Old clients still parse it'] },
      { id: 't4', title: 'Push them on the channel', detail: 'The ItemAdded event carries the display name.', files: ['src/events/types.ts', 'src/events/outbox.ts'], dependsOn: ['t3'], estimate: 'L', acceptance: ['No email addresses in the event', 'Other members see it within 1 s'] },
    ] },
    { name: 'Polish', tasks: [
      { id: 't5', title: 'Show it on the row', detail: 'Name and relative time under each item.', files: ['web/src/lists/ItemRow.tsx'], dependsOn: ['t2'], estimate: 'M', acceptance: ['Readable at phone width'] },
      { id: 't6', title: 'End to end test', detail: 'Two browsers, one list, one added item.', files: ['test/lists.e2e.ts'], dependsOn: ['t3', 't5'], estimate: 'M', acceptance: ['Runs in CI'] },
    ] },
  ],
};

const QUIZ = {
  title: 'Routes and validation',
  questions: [
    { id: 'q1', q: 'Where should request body checks live?', kind: 'single', options: ['In the handler', 'In a JSON Schema on the route', 'In the repository', 'In a global hook'], answer: 'In a JSON Schema on the route', explain: 'The framework validates against the route schema before the handler runs [^1].', ref: `${C1}#L9` },
    { id: 'q2', q: 'Which request parts can a route schema check?', kind: 'multi', options: ['body', 'querystring', 'params', 'cookies'], answer: ['body', 'querystring', 'params'], explain: 'Headers too, but cookies are not part of the route schema.' },
    { id: 'q3', q: 'What sets one place to turn errors into the API error shape?', kind: 'short', answer: 'setErrorHandler', explain: 'It applies to the plugin scope it is called in [^2].', ref: `${C2}#L48` },
    { id: 'q4', q: 'Why is a decorator from one plugin missing in another?', kind: 'short', answer: 'Plugins are encapsulated', explain: 'Wrap the plugin with fastify-plugin to share it with the parent.' },
    { id: 'q5', q: 'What did v5 remove from schemas?', kind: 'single', options: ['The shorthand form', '$ref', 'Response schemas', 'Ajv'], answer: 'The shorthand form', explain: 'Every schema now needs a full JSON Schema with a type [^3].' },
  ],
};

const FILE = {
  filename: 'CLAUDE.md',
  language: 'markdown',
  content: `# Working in this codebase

Read this before you change anything.

## Ground rules
- Every route has a JSON Schema for its body and params. Never check input by hand.
- Handlers call a domain service. They never touch the store directly.
- Events go through the outbox in the same transaction as the change.

## Where things are
- \`src/api/\` holds routes and the error handler.
- \`src/domain/\` holds the services and their rules.
- \`src/store/\` is the only code that knows about Postgres.

## Before you finish
- Run \`npm test\`.
- Start the service and hit the changed route once.
`,
  notes: 'Written for an agent that has never seen the codebase. Keep it under 80 lines.',
};

const base = (id, recipe, kind, title, extra, min) => ({ id, recipe, kind, title, inputs: {}, status: 'ok', summary: '', citations: cites, usage: { input_tokens: 41200, output_tokens: 2210 }, costUsd: 0.0412, model: 'haiku', createdAt: ago(min), ...extra });

const db = {
  artifacts: [
    base('a-onb', 'onboarding', 'doc', 'Onboarding guide', { markdown: DOC_MD, summary: 'A week-one path through routes, validation and the realtime channel.' }, 12),
    base('a-map', 'code-map', 'graph', 'Code map: request path', { data: GRAPH, inputs: { root: 'service' }, summary: 'The 14 pieces a request passes through, from the app entry to the client push [^2].' }, 34),
    base('a-seq', 'sequence-diagram', 'sequence', 'Adding a list item', { data: SEQ, inputs: { feature: 'Adding a list item' }, model: 'sonnet' }, 60 * 3),
    base('a-plan', 'impl-plan', 'plan', 'Plan: who added each item', { data: PLAN, parent: 'a-onb', model: 'opus', costUsd: 0.31 }, 60 * 26),
    base('a-quiz', 'agent-quiz', 'quiz', 'Agent quiz: validation', { data: QUIZ }, 60 * 30),
    base('a-cards', 'flashcards', 'quiz', 'Flashcards: routes', { data: { ...QUIZ, title: 'Route flashcards', questions: QUIZ.questions.map((q) => ({ ...q, kind: 'short', answer: Array.isArray(q.answer) ? q.answer.join(', ') : q.answer, options: undefined })) } }, 60 * 50),
    base('a-claude', 'claude-md', 'file', 'CLAUDE.md', { data: FILE, inputs: { root: 'service' } }, 60 * 72),
    base('a-dep', 'dependency-graph', 'graph', 'Dependency graph', { status: 'invalid', data: null, raw: '```json\n{ "title": "deps", "nodes": [ { "id": "a" } ], "edges": [ { "from": "a", "to": "zz" } ] }\n```', errors: ['nodes: need at least 3', 'edges[0].to: unknown node "zz"'], inputs: { root: 'fastify' } }, 60 * 80),
  ],
};

// The renderer agent ships richer generic mock data; prefer it when present.
let ext = null;
try { ext = await import('/studio/mock-data.js'); } catch {}
const STUDIO = structuredClone(ext?.studio || { recipes: RECIPES, groups: ['plan', 'visual', 'agent', 'learn', 'code'] });
if (ext?.artifacts?.length) db.artifacts = structuredClone(ext.artifacts);

// the H2 sections the server reads from each doc prompt (GET /studio `sections`)
const SECTIONS = {
  prd: ['Problem', 'Users and jobs', 'Goals', 'Non-goals', 'User stories', 'Requirements', 'Non-functional requirements', 'What the sources already give us', 'Risks and open questions', 'Success metrics'],
  'tech-spec': ['Scope', 'Architecture', 'Interfaces and data', 'Key flows', 'Edge cases and errors', 'Performance, security and compatibility', 'Testing', 'Alternatives considered', 'Open questions'],
  adr: ['Context', 'Options', 'Decision', 'Consequences', 'Revisit if'],
  'test-plan': ['Risks', 'Approach', 'Test cases', 'Test data and environment', 'Exit criteria'],
  onboarding: ['The mental model', 'Map of the sources', 'Setting up', 'Learning path', 'Your first change', 'Where to get unstuck'],
  'diff-review': ['Findings', 'Looks good', 'Not checked'],
  'build-x': ['What to reuse', 'Steps', 'Files', 'Testing it', 'Pitfalls'],
};
for (const r of STUDIO.recipes) if (r.sections === undefined) r.sections = SECTIONS[r.id] || null;

// same shape as the server's summarizeArtifact
function size(a) {
  const d = a.data || {};
  const len = (x) => (Array.isArray(x) ? x.length : 0);
  switch (a.kind) {
    case 'doc': return [{ n: (String(a.markdown || '').match(/^## /gm) || []).length, unit: 'sections' }];
    case 'graph': return [{ n: len(d.nodes), unit: 'nodes' }, { n: len(d.edges), unit: 'edges' }];
    case 'sequence': return [{ n: len(d.actors), unit: 'actors' }, { n: len(d.steps), unit: 'steps' }];
    case 'plan': return [{ n: len(d.phases), unit: 'phases' }, { n: (d.phases || []).reduce((n, p) => n + len(p?.tasks), 0), unit: 'tasks' }];
    case 'quiz': return [{ n: len(d.questions), unit: a.recipe === 'flashcards' ? 'cards' : 'questions' }];
    case 'file': return [{ n: d.content ? String(d.content).split('\n').length : 0, unit: 'lines' }];
    default: return [];
  }
}
const citeCounts = (list) => {
  const out = { verified: 0, moved: 0, unverified: 0 };
  for (const c of list || []) if (out[c.status] != null) out[c.status]++;
  return out;
};
const summary = (a) => ({
  id: a.id, recipe: a.recipe, kind: a.kind, title: a.title, status: a.status, createdAt: a.createdAt, updatedAt: a.updatedAt || a.createdAt,
  model: a.model, costUsd: a.costUsd ?? null, parent: a.parent ?? null, citations: a.citations?.length ?? 0, cites: citeCounts(a.citations), size: size(a),
});

// a doc streamed section by section, with citations, so Studio can show per-section progress
function docText(r) {
  const names = r.sections || ['Overview', 'Details', 'Open questions'];
  return [`# ${r.title}\n\nA short summary of what this sheet covers [[${C1}|"Fastify uses a schema-based approach"]].\n\n`,
    ...names.map((n, i) => `## ${n}\n\nWhat the sources say about ${n.toLowerCase()} [[${C2}#L48]]${i % 2 ? ` and the migration guide [[${C3}|"jsonShortHand option has been removed"]]` : ''}.\n\n`)];
}

const TEMPLATE = { doc: 'a-onb', graph: 'a-map', sequence: 'a-seq', plan: 'a-plan', quiz: 'a-quiz', file: 'a-claude' };

function sse(script, signal) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(ctrl) {
      const abort = () => { try { ctrl.error(new DOMException('Aborted', 'AbortError')); } catch {} };
      if (signal?.aborted) return abort();
      signal?.addEventListener('abort', abort);
      try {
        for await (const ev of script()) {
          if (signal?.aborted) return;
          ctrl.enqueue(enc.encode(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`));
        }
        ctrl.close();
      } catch (e) { if (!signal?.aborted) ctrl.error(e); }
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

async function* genScript(recipeId, inputs, model, replaceId) {
  const r = STUDIO.recipes.find((x) => x.id === recipeId);
  if (!r) { yield { type: 'error', message: `unknown recipe ${recipeId}` }; return; }
  const steps = [
    ['Glob', '**/*.ts in service', 4100], ['Grep', '"setErrorHandler" in fastify', 2300], ['Read', `${C2.split('/').slice(-1)[0]} 30-90`, 3800], ['Read', 'Reference/Validation-and-Serialization.md', 9100],
  ];
  for (const [i, [name, sum, chars]] of steps.entries()) {
    await wait(380);
    yield { type: 'tool', id: 'st' + i, name, summary: `${name} ${sum}`, input: {} };
    await wait(420);
    yield { type: 'tool_result', id: 'st' + i, ok: true, chars };
  }
  // ?mock=1&slow=N stretches each section to N seconds, for looking at a print in progress
  const slow = Number(new URLSearchParams(location.search).get('slow')) || 0;
  if (r.kind === 'doc') {
    for (const part of docText(r)) {
      for (let i = 0; i < part.length; i += 12) { yield { type: 'delta', text: part.slice(i, i + 12) }; await wait(slow ? (slow * 1000 * 12) / part.length : 18); }
    }
  } else {
    const text = 'Writing the structured output from what was read. '.repeat(5);
    for (let i = 0; i < text.length; i += 5) { yield { type: 'delta', text: text.slice(i, i + 5) }; await wait(slow ? slow * 20 : 25); }
  }
  if (r.kind !== 'doc') { await wait(300); yield { type: 'phase', name: 'repair' }; await wait(slow ? slow * 1000 : 700); }
  yield { type: 'phase', name: 'save' };
  await wait(250);
  const tpl = db.artifacts.find((a) => a.id === TEMPLATE[r.kind]) || db.artifacts.find((a) => a.kind === r.kind && a.status === 'ok');
  const art = { ...structuredClone(tpl), id: replaceId || 'a-' + Math.random().toString(36).slice(2, 8), recipe: r.id, title: r.title + (inputs && Object.values(inputs).find((v) => typeof v === 'string' && v) ? ': ' + String(Object.values(inputs).find((v) => typeof v === 'string' && v)).slice(0, 40) : ''), inputs: inputs || {}, model, createdAt: new Date().toISOString(), status: 'ok' };
  if (replaceId) db.artifacts = db.artifacts.filter((a) => a.id !== replaceId);
  db.artifacts.unshift(art);
  yield { type: 'done', artifact: art };
}

const STUDIO_RE = /^\/api\/notebooks\/([^/]+)\/(studio|artifacts)(\/.*)?$/;
export const handles = (url) => STUDIO_RE.test(new URL(url, location.origin).pathname);

export async function studioFetch(url, opts = {}) {
  const u = new URL(url, location.origin);
  const m = u.pathname.match(STUDIO_RE);
  const method = (opts.method || 'GET').toUpperCase();
  const body = opts.body ? JSON.parse(opts.body) : {};
  if (m[2] === 'studio') return json(STUDIO);
  const rest = (m[3] || '').split('/').filter(Boolean).map(decodeURIComponent);
  if (!rest.length) {
    if (method === 'GET') return json({ artifacts: db.artifacts.map(summary) });
    if (method === 'POST') return sse(() => genScript(body.recipe, body.inputs, body.model), opts.signal);
  }
  const art = db.artifacts.find((a) => a.id === rest[0]);
  if (!art) return json({ error: 'artifact not found' }, 404);
  if (rest[1] === 'regenerate' && method === 'POST') return sse(() => genScript(art.recipe, art.inputs, body.model || art.model, art.id), opts.signal);
  if (rest[1] === 'export') {
    const f = body.format;
    if (art.kind === 'file') return json({ text: art.data.content, filename: art.data.filename });
    if (f === 'markdown' || art.kind === 'doc') return json({ text: art.markdown || `# ${art.title}\n`, filename: `${art.id}.md` });
    return json({ text: JSON.stringify(art.data, null, 2), filename: `${art.id}.${f === 'mermaid' ? 'mmd' : 'json'}` });
  }
  if (rest[1] === 'write') {
    if (!body.overwrite && /CLAUDE\.md$/.test(body.path || '')) return json({ error: 'file exists', exists: true }, 409);
    return json({ path: 'C:/code/orders-service/' + body.path });
  }
  if (method === 'GET') { await wait(80); return json(art); }
  if (method === 'DELETE') { db.artifacts = db.artifacts.filter((a) => a !== art); return json({ ok: true }); }
  if (method === 'PATCH') {
    // same editable fields as the server: title, checked (merged), file content
    if (typeof body.title === 'string' && body.title.trim()) art.title = body.title.trim();
    if (body.checked) { art.checked = { ...(art.checked || {}) }; for (const [k, v] of Object.entries(body.checked)) { if (v) art.checked[k] = true; else delete art.checked[k]; } }
    if (typeof body.content === 'string' && art.kind === 'file' && art.data) art.data.content = body.content;
    return json(art);
  }
  return json({ error: 'not found' }, 404);
}
