// Mock Studio backend for ?mock=1. Used only when dev-mock.js does not answer a studio route.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

const C1 = 'corpus/neoforge-docs/versioned_docs/version-1.21.1/items/datacomponents.md';
const C2 = 'corpus/neoforge/src/main/java/net/neoforged/neoforge/registries/DeferredRegister.java';
const C3 = 'corpus/neoforge-github/primers/1.20.5/index.md';
const C5 = 'corpus/neoforge-docs/versioned_docs/version-1.21.1/networking/payload.md';

const T = (name, label, type, required = false, extra = {}) => ({ name, label, type, required, ...extra });

export const RECIPES = [
  { id: 'prd', group: 'plan', kind: 'doc', title: 'PRD', blurb: 'Turn a rough idea into a product requirements doc', inputs: [T('idea', 'Idea', 'longtext', true, { placeholder: 'What should exist, and for whom?' })] },
  { id: 'tech-spec', group: 'plan', kind: 'doc', title: 'Tech spec', blurb: 'Design the build, grounded in the codebase', inputs: [T('from', 'From PRD', 'artifact', false, { from: ['prd'] }), T('idea', 'Or describe it', 'longtext', false, { placeholder: 'Skip if you picked a PRD' })] },
  { id: 'impl-plan', group: 'plan', kind: 'plan', title: 'Implementation plan', blurb: 'Phased tasks with files, deps and checks', inputs: [T('from', 'From spec', 'artifact', false, { from: ['tech-spec', 'prd'] }), T('idea', 'Or describe it', 'longtext')] },
  { id: 'adr', group: 'plan', kind: 'doc', title: 'Decision record', blurb: 'Weigh the options and record the call', inputs: [T('decision', 'Decision', 'text', true, { placeholder: 'Which storage to use for per-player data' }), T('options', 'Options', 'longtext', false, { placeholder: 'One per line' })] },
  { id: 'test-plan', group: 'plan', kind: 'doc', title: 'Test plan', blurb: 'What to test, how, and what proves it', inputs: [T('from', 'From spec', 'artifact', false, { from: ['tech-spec', 'prd'] }), T('feature', 'Or describe the feature', 'longtext')] },

  { id: 'code-map', group: 'visual', kind: 'graph', title: 'Code map', blurb: 'The important packages and classes of a root', inputs: [T('root', 'Root', 'root', true), T('focus', 'Focus', 'text', false, { placeholder: 'Optional, like networking' })] },
  { id: 'concept-map', group: 'visual', kind: 'graph', title: 'Concept map', blurb: 'How the ideas in the docs connect', inputs: [T('topic', 'Topic', 'text', false, { placeholder: 'Optional' })] },
  { id: 'flow-diagram', group: 'visual', kind: 'graph', title: 'Flow diagram', blurb: 'Trace how something happens, step by step', inputs: [T('flow', 'Trace how', 'text', true, { placeholder: 'a packet gets from client to server' })] },
  { id: 'sequence-diagram', group: 'visual', kind: 'sequence', title: 'Sequence diagram', blurb: 'Who calls whom, in order', inputs: [T('feature', 'Feature', 'text', true, { placeholder: 'Opening a menu' })] },
  { id: 'dependency-graph', group: 'visual', kind: 'graph', title: 'Dependency graph', blurb: 'Imports between packages, cycles marked', inputs: [T('root', 'Root', 'root', true)] },

  { id: 'claude-md', group: 'agent', kind: 'file', title: 'CLAUDE.md', blurb: 'House rules an agent reads before it codes', inputs: [T('root', 'Root', 'root'), T('audience', 'Audience', 'text', false, { placeholder: 'Optional' })] },
  { id: 'agents-md', group: 'agent', kind: 'file', title: 'AGENTS.md', blurb: 'The same, for any coding agent', inputs: [T('root', 'Root', 'root')] },
  { id: 'skill', group: 'agent', kind: 'file', title: 'Skill', blurb: 'A SKILL.md with frontmatter, ready to drop in', inputs: [T('topic', 'Topic', 'text', true, { placeholder: 'Registering things' })] },
  { id: 'agent-quiz', group: 'agent', kind: 'quiz', title: 'Agent quiz', blurb: 'Questions to check an agent knows the sources', inputs: [T('topic', 'Topic', 'text')] },

  { id: 'onboarding', group: 'learn', kind: 'doc', title: 'Onboarding guide', blurb: 'Day one through week one, in order', inputs: [] },
  { id: 'cheat-sheet', group: 'learn', kind: 'doc', title: 'Cheat sheet', blurb: 'One page of what you reach for', inputs: [] },
  { id: 'porting-guide', group: 'learn', kind: 'doc', title: 'Porting guide', blurb: 'From one version or API to another', inputs: [T('from', 'From', 'text', true), T('to', 'To', 'text', true)] },
  { id: 'gotchas', group: 'learn', kind: 'doc', title: 'Gotchas', blurb: 'Traps, crashes and silent failures', inputs: [] },
  { id: 'glossary', group: 'learn', kind: 'doc', title: 'Glossary', blurb: 'Every term, defined against the sources', inputs: [] },
  { id: 'flashcards', group: 'learn', kind: 'quiz', title: 'Flashcards', blurb: 'Flip cards with got-it and again piles', inputs: [T('topic', 'Topic', 'text')] },

  { id: 'gap-report', group: 'code', kind: 'doc', title: 'Gap report', blurb: 'Where the code and the docs disagree', inputs: [T('root', 'Root', 'root', true)] },
  { id: 'diff-review', group: 'code', kind: 'doc', title: 'Diff review', blurb: 'Findings ranked, each with the right way', inputs: [T('diff', 'Diff', 'diff', true)] },
  { id: 'build-x', group: 'code', kind: 'doc', title: 'How would I build', blurb: 'A plan that reuses patterns already here', inputs: [T('what', 'Build what', 'text', true, { placeholder: 'a config screen' })] },
  { id: 'release-notes', group: 'code', kind: 'doc', title: 'Release notes', blurb: 'From a git range to notes people read', inputs: [T('log', 'Commits', 'gitlog', true)] },
];

const cites = [
  { n: 1, path: C1, line: 9, endLine: 9, quote: 'Data components are key-value pairs within a map used to store data on an `ItemStack`', status: 'verified' },
  { n: 2, path: C2, line: 612, endLine: 618, quote: null, status: 'verified' },
  { n: 3, path: C3, line: 4, endLine: 4, quote: 'The tag on an ItemStack has been replaced by data components', status: 'moved' },
  { n: 4, path: C5, line: 20, endLine: 26, quote: null, status: 'unverified' },
];

const DOC_MD = `## Who this is for

New contributors who can read Java and want to ship a first change inside a week. Read it top to bottom once, then keep it open as a map.

## Day one: the shape of things

Everything registered goes through a deferred register, which collects entries and hands them to the registry event at the right moment [^2]. Item data lives in typed components, not in a free-form tag [^1].

| Area | Start here | Why |
| --- | --- | --- |
| Registration | \`DeferredRegister\` | Every block, item and component starts here |
| Item data | Data components | Replaces the old tag API [^3] |
| Networking | Payloads | Typed packets with stream codecs [^4] |

## Day two: make one change end to end

1. Register a component type.
2. Read it with \`getOrDefault\`, write it with \`set\`.
3. Sync it by giving it a network codec.

\`\`\`java
public static final DeferredHolder<DataComponentType<?>, DataComponentType<Integer>> CHARGE =
    COMPONENTS.registerComponentType("charge", b -> b.persistent(Codec.INT).networkSynchronized(ByteBufCodecs.VAR_INT));
\`\`\`

## Week one: the traps

> Component values must be immutable. Mutating one in place changes every stack that shares it.

### Things that fail silently

- Registering after the registry event has fired.
- Sending a payload that was never registered on both sides.
- Forgetting the codec, so the value never reaches the client.

## Where to look next

The primers explain each breaking change in the order it happened [^3]. The payload page covers networking end to end [^4].`;

const GRAPH = {
  title: 'Registries and item data',
  layout: 'layered',
  nodes: [
    { id: 'mod', label: 'Mod entry', kind: 'class', group: 'core', detail: 'Constructs the deferred registers and binds them to the mod bus.' },
    { id: 'bus', label: 'Mod event bus', kind: 'event', group: 'core', detail: 'Fires registration and setup events in a fixed order.' },
    { id: 'dr', label: 'DeferredRegister', kind: 'class', group: 'registries', detail: 'Collects entries and registers them on RegisterEvent.', ref: `${C2}#L612-L618` },
    { id: 'dh', label: 'DeferredHolder', kind: 'class', group: 'registries', detail: 'A lazy handle to a registered value.' },
    { id: 'reg', label: 'RegisterEvent', kind: 'event', group: 'registries' },
    { id: 'items', label: 'Items', kind: 'package', group: 'content' },
    { id: 'blocks', label: 'Blocks', kind: 'package', group: 'content' },
    { id: 'dct', label: 'DataComponentType', kind: 'interface', group: 'data', detail: 'Typed key for one piece of item data.', ref: `${C1}#L9` },
    { id: 'codec', label: 'Codec', kind: 'external', group: 'data', detail: 'Serialises values to disk.' },
    { id: 'stream', label: 'StreamCodec', kind: 'external', group: 'data', detail: 'Serialises values over the network.' },
    { id: 'stack', label: 'ItemStack', kind: 'class', group: 'data' },
    { id: 'payload', label: 'Payloads', kind: 'concept', group: 'network', ref: `${C5}#L20` },
    { id: 'sync', label: 'Client sync', kind: 'step', group: 'network' },
    { id: 'save', label: 'World save', kind: 'step', group: 'data' },
  ],
  edges: [
    { from: 'mod', to: 'bus', label: 'listens' }, { from: 'mod', to: 'dr', label: 'creates' }, { from: 'bus', to: 'reg', label: 'fires' },
    { from: 'reg', to: 'dr' }, { from: 'dr', to: 'dh', label: 'returns' }, { from: 'dr', to: 'items' }, { from: 'dr', to: 'blocks' },
    { from: 'dr', to: 'dct' }, { from: 'dct', to: 'codec', label: 'persistent' }, { from: 'dct', to: 'stream', label: 'synced' },
    { from: 'stack', to: 'dct', label: 'get / set' }, { from: 'items', to: 'stack' }, { from: 'codec', to: 'save' },
    { from: 'stream', to: 'sync' }, { from: 'payload', to: 'stream', label: 'uses' }, { from: 'sync', to: 'payload', kind: 'cycle' },
  ],
};

const SEQ = {
  title: 'Sending a payload to the server',
  actors: [{ id: 'player', label: 'Player', kind: 'external' }, { id: 'client', label: 'Client' }, { id: 'net', label: 'Network' }, { id: 'server', label: 'Server' }],
  steps: [
    { from: 'player', to: 'client', label: 'Presses the key' },
    { from: 'client', to: 'client', label: 'Builds the payload record', note: 'Fields are immutable' },
    { from: 'client', to: 'net', label: 'sendToServer(payload)', ref: `${C5}#L20` },
    { from: 'net', to: 'server', label: 'Encodes with the stream codec', async: true },
    { from: 'server', to: 'server', label: 'Handler runs on the network thread' },
    { from: 'server', to: 'server', label: 'enqueueWork to touch the world', note: 'Never touch the level off-thread' },
    { from: 'server', to: 'net', label: 'Reply payload', async: true },
    { from: 'net', to: 'client', label: 'Client handler updates the screen' },
  ],
};

const PLAN = {
  title: 'Charge meter on tools',
  goal: 'Tools carry a charge value that saves with the world, syncs to the client and shows in the tooltip.',
  phases: [
    { name: 'Data', tasks: [
      { id: 't1', title: 'Register the charge component', detail: 'A persistent, synced integer component.', files: ['registry/ModComponents.java'], dependsOn: [], ref: `${C2}#L612-L618`, estimate: 'S', acceptance: ['Registered on the mod bus', 'Has both codecs'] },
      { id: 't2', title: 'Read and write helpers', detail: 'getOrDefault and update wrappers on the tool item.', files: ['item/ChargedTool.java'], dependsOn: ['t1'], estimate: 'S', acceptance: ['No mutation in place'] },
    ] },
    { name: 'Behaviour', tasks: [
      { id: 't3', title: 'Charge on use', detail: 'Each use adds one charge up to a cap.', files: ['item/ChargedTool.java'], dependsOn: ['t2'], estimate: 'M', acceptance: ['Caps at 100', 'Survives reload'] },
      { id: 't4', title: 'Spend charge for the ability', detail: 'Sneak-use spends 10 charge.', files: ['item/ChargedTool.java', 'net/AbilityPayload.java'], dependsOn: ['t3'], estimate: 'L', acceptance: ['Server validates the cost', 'Client cannot cheat the value'] },
    ] },
    { name: 'Polish', tasks: [
      { id: 't5', title: 'Tooltip and bar', detail: 'Show the charge as a bar like durability.', files: ['client/ChargeBar.java'], dependsOn: ['t2'], estimate: 'M', acceptance: ['Matches the item color'] },
      { id: 't6', title: 'Game tests', detail: 'Save, reload and sync round trips.', files: ['test/ChargeTests.java'], dependsOn: ['t3', 't5'], estimate: 'M', acceptance: ['Runs in CI'] },
    ] },
  ],
};

const QUIZ = {
  title: 'Item data and registration',
  questions: [
    { id: 'q1', q: 'Where does arbitrary custom data live on an item stack now?', kind: 'single', options: ['In getOrCreateTag()', 'In a typed data component', 'In a capability', 'In the item class'], answer: 'In a typed data component', explain: 'Free-form tags were replaced by typed components [^1].', ref: `${C1}#L9` },
    { id: 'q2', q: 'Which settings can a component type builder have?', kind: 'multi', options: ['persistent', 'networkSynchronized', 'cacheEncoding', 'mutable'], answer: ['persistent', 'networkSynchronized', 'cacheEncoding'], explain: 'Three settings, none of them make values mutable.' },
    { id: 'q3', q: 'What class collects registrations and fires them at the right time?', kind: 'short', answer: 'DeferredRegister', explain: 'It listens for the registry event [^2].', ref: `${C2}#L612` },
    { id: 'q4', q: 'Why must component values be immutable?', kind: 'short', answer: 'Stacks can share one value instance', explain: 'Mutating one changes every stack holding it.' },
    { id: 'q5', q: 'What serialises a value over the network?', kind: 'single', options: ['Codec', 'StreamCodec', 'NbtOps', 'JsonOps'], answer: 'StreamCodec', explain: 'Codecs go to disk, stream codecs go over the wire.' },
  ],
};

const FILE = {
  filename: 'CLAUDE.md',
  language: 'markdown',
  content: `# Working in this codebase

Read this before you change anything.

## Ground rules
- Register everything through a deferred register. Never call the registry directly.
- Item data is a typed component. Do not reach for tags.
- Component values are immutable records.

## Where things are
- \`registry/\` holds every deferred register.
- \`net/\` holds payload records and their handlers.
- \`client/\` is client only. Never import it from common code.

## Before you finish
- Run the game tests.
- Check both sides start without errors.
`,
  notes: 'Written for an agent that has never seen the codebase. Keep it under 80 lines.',
};

const base = (id, recipe, kind, title, extra, min) => ({ id, recipe, kind, title, inputs: {}, status: 'ok', summary: '', citations: cites, usage: { input_tokens: 41200, output_tokens: 2210 }, costUsd: 0.0412, model: 'haiku', createdAt: ago(min), ...extra });

const db = {
  artifacts: [
    base('a-onb', 'onboarding', 'doc', 'Onboarding guide', { markdown: DOC_MD, summary: 'A week-one path through registration, item data and networking.' }, 12),
    base('a-map', 'code-map', 'graph', 'Code map: registries', { data: GRAPH, inputs: { root: 'neoforge' }, summary: 'The 14 pieces you touch first, from the mod entry to the client sync [^2].' }, 34),
    base('a-seq', 'sequence-diagram', 'sequence', 'Sending a payload', { data: SEQ, inputs: { feature: 'Sending a payload' }, model: 'sonnet' }, 60 * 3),
    base('a-plan', 'impl-plan', 'plan', 'Plan: charge meter', { data: PLAN, parent: 'a-onb', model: 'opus', costUsd: 0.31 }, 60 * 26),
    base('a-quiz', 'agent-quiz', 'quiz', 'Agent quiz: item data', { data: QUIZ }, 60 * 30),
    base('a-cards', 'flashcards', 'quiz', 'Flashcards: registration', { data: { ...QUIZ, title: 'Registration flashcards', questions: QUIZ.questions.map((q) => ({ ...q, kind: 'short', answer: Array.isArray(q.answer) ? q.answer.join(', ') : q.answer, options: undefined })) } }, 60 * 50),
    base('a-claude', 'claude-md', 'file', 'CLAUDE.md', { data: FILE, inputs: { root: 'neoforge' } }, 60 * 72),
    base('a-dep', 'dependency-graph', 'graph', 'Dependency graph', { status: 'invalid', data: null, raw: '```json\n{ "title": "deps", "nodes": [ { "id": "a" } ], "edges": [ { "from": "a", "to": "zz" } ] }\n```', errors: ['nodes: need at least 3', 'edges[0].to: unknown node "zz"'], inputs: { root: 'geckolib' } }, 60 * 80),
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
  return [`# ${r.title}\n\nA short summary of what this sheet covers [[${C1}|"Data components are key-value pairs"]].\n\n`,
    ...names.map((n, i) => `## ${n}\n\nWhat the sources say about ${n.toLowerCase()} [[${C2}#L612]]${i % 2 ? ` and the primer [[${C3}|"replaced by data components"]]` : ''}.\n\n`)];
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
    ['Glob', '**/*.java in neoforge', 4100], ['Grep', '"DeferredRegister" in neoforge', 2300], ['Read', `${C2.split('/').slice(-1)[0]} 600-640`, 3800], ['Read', 'items/datacomponents.md', 9100],
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
    return json({ path: 'D:/projects/notebook-spike/' + body.path });
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
