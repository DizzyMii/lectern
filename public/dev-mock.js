// Dev-only fake backend, loaded when the page URL has ?mock=1.
// Mirrors the HTTP API and SSE events from SPEC.md with scripted data: a small orders
// service, the docs of the web framework it runs on, and that framework's source.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const now = () => new Date().toISOString();

const DOCS = 'corpus/fastify-docs/docs';
const DOC_GROUPS = {
  Reference: ['Server', 'Routes', 'Hooks', 'Validation-and-Serialization', 'Plugins', 'Decorators', 'Encapsulation', 'Errors', 'Logging', 'Reply', 'Request', 'TypeScript'],
  Guides: ['Getting-Started', 'Testing', 'Database', 'Plugins-Guide', 'Recommendations', 'Migration-Guide-V5'],
};
const shelf = [
  ...Object.entries(DOC_GROUPS).map(([g, fs]) => ({ title: g, files: fs.map((f) => `${DOCS}/${g}/${f}.md`), tokens: 9000 + fs.length * 3100 })),
  { title: 'architecture', files: ['docs/architecture/overview.md', 'docs/architecture/realtime.md'], tokens: 6200 },
  { title: 'api', files: ['docs/api/rate-limits.md', 'docs/api/errors.md'], tokens: 3100 },
];

const ROOTS = [
  { name: 'service', path: '../orders-service', files: 184, own: true, branch: 'main', version: '2.3.0' },
  { name: 'fastify', path: 'corpus/fastify', files: 412, version: '5.2.1' },
];

const C1 = `${DOCS}/Reference/Validation-and-Serialization.md`;
const C2 = 'fastify/lib/error-handler.js';
const C3 = `${DOCS}/Guides/Migration-Guide-V5.md`;
const C4 = 'service/src/api/validate.ts';

const ANSWER_RAW = `Give the route a **JSON Schema** and let the framework validate it, then shape the 400 in one error handler. The schema is compiled once at startup, not per request [[${C1}|"Fastify uses a schema-based approach"]].

### 1. Put the schema on the route

\`\`\`ts
app.post('/orders', {
  schema: {
    body: {
      type: 'object',
      required: ['listId', 'items'],
      properties: {
        listId: { type: 'string', format: 'uuid' },
        items: { type: 'array', minItems: 1, items: { $ref: 'orderItem#' } },
      },
      additionalProperties: false,
    },
  },
}, createOrder);
\`\`\`

A body that fails never reaches \`createOrder\`; the framework replies 400 on its own.

### 2. Shape the 400 once

- \`error.validation\` holds the validator errors when the failure came from a schema.
- \`error.validationContext\` says which part failed: \`body\`, \`querystring\`, \`params\` or \`headers\`.
- Set the handler with \`app.setErrorHandler\`; it runs for every route in that plugin scope [[${C2}#L48-L61]].

The v5 migration guide says the shorthand schemas are gone, so every \`body\`, \`querystring\` and \`params\` schema needs \`type: 'object'\` [[${C3}|"The jsonShortHand option has been removed"]].

> The service still has a hand-written check in \`validate.ts\`; drop it once the schemas are in [[${C4}#L12-L30]].`;

let n = 0;
const CITES = [];
const ANSWER_FINAL = ANSWER_RAW.replace(/\[\[[^\]]+\]\]/g, () => `[^${++n}]`);
CITES.push(
  { n: 1, path: C1, line: 5, endLine: 5, quote: 'Fastify uses a schema-based approach', status: 'verified' },
  { n: 2, path: C2, line: 50, citedLine: 48, endLine: 61, quote: 'setErrorHandler', status: 'moved' },
  { n: 3, path: C3, line: 48, endLine: 48, quote: 'The jsonShortHand option has been removed', status: 'unverified' },
  { n: 4, path: C4, line: 12, endLine: 30, quote: null, status: 'missing' },
);

const TOOLS = [
  { name: 'Grep', input: { pattern: 'setErrorHandler', path: 'corpus/fastify' }, summary: 'Grep "setErrorHandler" in fastify', chars: 2140 },
  { name: 'Read', input: { file_path: 'corpus/fastify/lib/error-handler.js', offset: 30, limit: 60 }, summary: 'Read fastify/lib/error-handler.js 30-90', chars: 3302 },
  { name: 'Glob', input: { pattern: 'src/api/**/*.ts' }, summary: 'Glob "src/api/**/*.ts" in service', chars: 380 },
  { name: 'Read', input: { file_path: '../orders-service/src/api/orders.ts' }, summary: 'Read service/src/api/orders.ts 1-200', chars: 8810 },
  { name: 'Grep', input: { pattern: 'validationContext' }, summary: 'Grep "validationContext" in service', chars: 0, ok: true },
];

const db = {
  notebooks: {
    'orders-service': { id: 'orders-service', title: 'Orders service', color: '#e3a94b', description: 'The Fastify 5 docs and migration guide, our architecture notes, the orders service and the Fastify source.', shelf, roots: ROOTS, pinned: [`${DOCS}/Reference/*.md`, `${DOCS}/Guides/*.md`, 'docs/**/*.md'] },
    'django-5.1': { id: 'django-5.1', title: 'Django 5.1', color: '#4cc9a0', description: '', shelf: [{ title: 'django-docs', files: ['corpus/django-docs/docs/index.txt'] }], roots: [], pinned: ['corpus/django-docs/docs/**/*.txt'] },
  },
  conversations: {
    'orders-service': [
      { id: 'c-demo-1', title: 'Why is my decorator missing in another plugin?', updated: new Date(Date.now() - 3600e3 * 5).toISOString(), turns: [
        { question: 'I decorate the app with `db` in one plugin but another plugin says it is undefined. Why?', answer: 'Each plugin gets its own **encapsulated context**, so a decorator added inside one plugin is only visible to that plugin and its children [^1]. Wrap the plugin that adds `db` with `fastify-plugin` to skip encapsulation and expose it to the parent [^2].\n\n```ts\nimport fp from \'fastify-plugin\';\n\nexport default fp(async (app) => {\n  app.decorate(\'db\', await connect(app.config.DATABASE_URL));\n});\n```',
          citations: [{ n: 1, path: `${DOCS}/Reference/Encapsulation.md`, line: 60, endLine: 72, quote: null, status: 'verified' }, { n: 2, path: `${DOCS}/Reference/Plugins.md`, line: 30, endLine: 30, quote: 'fastify-plugin', status: 'unverified' }],
          toolCalls: [{ id: 't1', name: 'Grep', summary: 'Grep "decorate(" in service', ok: true }, { id: 't2', name: 'Read', summary: 'Read fastify/lib/pluginUtils.js 1-120', ok: true }],
          usage: { input_tokens: 4100, cache_read_input_tokens: 182000, output_tokens: 640 }, model: 'sonnet', seconds: 21.4 },
      ] },
      { id: 'c-demo-2', title: 'Moving the order routes to v5', updated: new Date(Date.now() - 86400e3 * 2).toISOString(), turns: [] },
    ],
    'django-5.1': [],
  },
  notes: {
    'orders-service': [{ slug: 'cheat-sheet', title: 'Cheat sheet', kind: 'cheat-sheet', updated: new Date(Date.now() - 86400e3).toISOString(), body: '# Fastify 5 cheat sheet\n\n| Need | Use |\n| --- | --- |\n| Validate input | `schema.body` on the route |\n| Share a decorator | `fastify-plugin` |\n| Per-request state | `decorateRequest` |\n| Clean shutdown | the `onClose` hook |\n' }],
    'django-5.1': [],
  },
};

function summary(nb) {
  const files = nb.shelf.reduce((a, d) => a + d.files.length, 0);
  return { id: nb.id, title: nb.title, color: nb.color, description: nb.description, counts: { docs: nb.shelf.length, files, roots: nb.roots.length, conversations: db.conversations[nb.id].length, notes: db.notes[nb.id].length }, tokens: nb.shelf.reduce((a, d) => a + (d.tokens || 4000), 0) };
}

function detail(id) {
  const nb = db.notebooks[id];
  return {
    ...summary(nb),
    config: { name: id, title: nb.title, color: nb.color, pinned: nb.pinned, roots: Object.fromEntries(nb.roots.map((r) => [r.name, r.path])) },
    shelf: nb.shelf, roots: nb.roots,
    conversations: db.conversations[id].map(({ id, title, updated, turns }) => {
      const all = turns.flatMap((t) => t.citations || []);
      const flag = all.some((c) => c.status === 'unverified' || c.status === 'missing') ? 'unverified' : all.some((c) => c.status === 'moved') ? 'moved' : null;
      return { id, title, updated, citations: all.length, flag };
    }),
    notes: db.notes[id].map(({ slug, title, updated, kind }) => ({ slug, title, updated, kind })),
  };
}

// ---------- fake file contents ----------

function fakeCode(path) {
  const ts = path.endsWith('.ts');
  const name = path.split('/').pop().replace(/\.(ts|js)$/, '');
  const out = [
    "'use strict'", '',
    ts ? "import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';" : "const { kErrorHandler } = require('./symbols')",
    ts ? "import { OrderService } from '../domain/orderService';" : "const { FST_ERR_ERROR_HANDLER_NOT_FN } = require('./errors')",
    '', `// ${name}: part of the mock corpus, standing in for ${path}`, '',
  ];
  let i = 0;
  while (out.length < 700) {
    i++;
    out.push('', `// step ${i}`, ts ? `export async function handler${i}(req: FastifyRequest, reply: FastifyReply) {` : `function handler${i} (request, reply) {`,
      `  const id = ${ts ? '(req.params as { id: string }).id' : 'request.params.id'}`, `  if (!id) return reply.code(400).send({ error: 'missing id', step: ${i} })`,
      `  return reply.send({ id, step: ${i} })`, '}');
  }
  out.splice(49, 16,
    'function setErrorHandler (func) {', '  throwIfAlreadyStarted(\'Cannot call "setErrorHandler"!\')', '',
    '  if (typeof func !== \'function\') {', '    throw new FST_ERR_ERROR_HANDLER_NOT_FN()', '  }', '',
    '  // a handler set inside a plugin applies to that plugin and its children only', '  this[kErrorHandler] = buildErrorHandler(this[kErrorHandler], func.bind(this))',
    '  return this', '}', '',
    'function defaultErrorHandler (error, request, reply) {', '  if (error.validation) reply.code(400)', '  reply.send(error)', '}');
  out.push('');
  return out.join('\n');
}

function fakeDoc(path) {
  const name = path.split('/').pop().replace('.md', '');
  if (path === C1) {
    return `<h1 align="center">Fastify</h1>\n\n## Validation and Serialization\n\nFastify uses a schema-based approach, and even if it is not mandatory we recommend using JSON Schema to validate your routes and serialize your outputs. Internally, Fastify compiles the schema into a highly performant function.\n\n### Core concepts\n\nThe validation and the serialization tasks are processed by two different, and customizable, actors.\n\n${'Route validation uses `schema.body`, `schema.querystring`, `schema.params` and `schema.headers`. A request that fails is answered with a 400 before the handler runs.\n\n'.repeat(12)}### Error handling\n\n- \`error.validation\`\n- \`error.validationContext\`\n- \`setErrorHandler\`\n`;
  }
  let body = `# ${name.replace(/-/g, ' ')}\n\nThis page is part of the mock corpus. It stands in for \`${path}\`.\n\n`;
  for (let i = 1; i <= 30; i++) body += `## Section ${i}\n\nParagraph ${i} of the mock document. Routes declare a schema and the framework checks every request against it.\n\n`;
  return body;
}

// ---------- fake tree ----------

const TREES = {
  service: {
    '': ['src/', 'migrations/', 'test/', 'package.json', 'tsconfig.json', 'README.md'],
    src: ['api/', 'domain/', 'events/', 'store/', 'auth/', 'app.ts', 'server.ts'],
    'src/api': ['middleware/', 'orders.ts', 'router.ts', 'validate.ts', 'lists.ts'],
    'src/domain': ['order.ts', 'orderService.ts', 'payments.ts', 'pricing.ts'],
    migrations: ['0001_init.sql', '0012_lists.sql', '0030_soft_delete.sql'],
  },
  fastify: {
    '': ['lib/', 'test/', 'types/', 'docs/', 'fastify.js', 'package.json'],
    lib: ['error-handler.js', 'errors.js', 'hooks.js', 'pluginUtils.js', 'reply.js', 'request.js', 'route.js', 'schemas.js', 'symbols.js', 'validation.js'],
    test: Array.from({ length: 450 }, (_, i) => `route-${String(i).padStart(3, '0')}.test.js`),
  },
};

function fakeTree(rootName, dir) {
  const t = TREES[rootName];
  if (!t) return null;
  return (t[dir] ?? ['helpers.ts', 'index.ts', 'types.ts']).map((e) => (e.endsWith('/') ? { name: e.slice(0, -1), type: 'dir' } : { name: e, type: 'file' }));
}

// ---------- SSE ----------

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

async function* answerScript(nbId, question, conversationId, model) {
  const t0 = Date.now();
  await wait(500);
  for (const [i, t] of TOOLS.entries()) {
    const id = `toolu_${i}`;
    yield { type: 'tool', id, name: t.name, input: t.input, summary: t.summary };
    await wait(350 + Math.random() * 400);
    yield { type: 'tool_result', id, ok: t.ok ?? true, chars: t.chars };
    await wait(120);
  }
  let i = 0;
  while (i < ANSWER_RAW.length) {
    const step = 3 + Math.floor(Math.random() * 9);
    yield { type: 'delta', text: ANSWER_RAW.slice(i, i + step) };
    i += step;
    await wait(14);
  }
  await wait(300);
  const final = { answer: ANSWER_FINAL, citations: CITES, toolCalls: TOOLS.map((t, k) => ({ id: `toolu_${k}`, name: t.name, input: t.input, summary: t.summary, ok: t.ok ?? true })), usage: { input_tokens: 3800, cache_read_input_tokens: 196400, cache_creation_input_tokens: 1200, output_tokens: 712 }, costUsd: 0.0841, sessionId: 'sess-mock', seconds: (Date.now() - t0) / 1000 };
  const list = db.conversations[nbId];
  let conv = list.find((c) => c.id === conversationId);
  if (!conv) { conv = { id: 'c-' + Math.random().toString(36).slice(2, 9), title: question.slice(0, 60), turns: [] }; list.unshift(conv); }
  conv.updated = now();
  conv.turns.push({ question, ...final, model });
  yield { type: 'done', conversationId: conv.id, ...final };
}

async function* generateScript(nbId, kind) {
  await wait(400);
  yield { type: 'tool', id: 'g1', name: 'Glob', input: { pattern: '**/*.md' }, summary: 'Glob "**/*.md" in docs' };
  await wait(500);
  yield { type: 'tool_result', id: 'g1', ok: true, chars: 1800 };
  const text = `# ${kind.replace(/-/g, ' ')}\n\n1. **Errors** go through one \`setErrorHandler\` per scope [[${C2}#L48-L61]].\n2. **Input** is checked by the route schema [[${C1}|"Fastify uses a schema-based approach"]].\n3. **Shared services** are decorators wrapped in \`fastify-plugin\`.\n`;
  for (let i = 0; i < text.length; i += 6) { yield { type: 'delta', text: text.slice(i, i + 6) }; await wait(16); }
  const slug = `${kind}-${Date.now().toString(36)}`;
  const answer = text.replace(`[[${C2}#L48-L61]]`, '[^1]').replace(`[[${C1}|"Fastify uses a schema-based approach"]]`, '[^2]');
  db.notes[nbId].unshift({ slug, title: kind.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), kind, updated: now(), body: answer });
  yield { type: 'done', answer, citations: [{ ...CITES[1], n: 1, status: 'verified' }, { ...CITES[0], n: 2 }], usage: { input_tokens: 2000, output_tokens: 300 }, seconds: 3.1, note: { slug } };
}

async function* sourceScript(nbId, body) {
  const nb = db.notebooks[nbId];
  const steps = body.kind === 'git' ? ['Cloning (depth 1, sparse)', 'Checking out ' + (body.subdir || '/'), 'Counting files: 412'] : body.kind === 'url' ? ['Fetching ' + body.url, 'Converting HTML to markdown', 'Saved sources/page.md'] : ['Saving ' + (body.name || body.path)];
  for (const s of steps) { await wait(450); yield { type: 'progress', message: s }; }
  if (body.kind === 'folder' || body.kind === 'git') nb.roots.push({ name: body.name, path: body.kind === 'git' ? `corpus/${body.name}` : body.path, files: 412 });
  else {
    let g = nb.shelf.find((d) => d.title === 'sources');
    if (!g) { g = { title: 'sources', files: [] }; nb.shelf.push(g); nb.pinned.push('sources/**/*.md'); }
    g.files.push(`sources/${body.kind === 'url' ? 'page-' + g.files.length : body.name}.md`.replace(/\.md\.md$/, '.md'));
  }
  yield { type: 'done', ok: true };
}

// ---------- router ----------

export async function mockFetch(url, opts = {}) {
  const u = new URL(url, location.origin);
  const p = u.pathname;
  const method = (opts.method || 'GET').toUpperCase();
  const body = opts.body ? JSON.parse(opts.body) : {};
  await wait(60 + Math.random() * 120);
  let m;

  if (p === '/api/status') return json({ claude: { found: true, version: '2.1.4 (mock)' }, apiEngine: false });
  if (p === '/api/candidates') return json({
    roots: [
      { path: 'C:/code/web-admin', name: 'web-admin', kind: 'repo', branch: 'main' },
      { path: 'C:/code/billing-worker', name: 'billing-worker', kind: 'root', version: '0.9.4' },
      { path: 'C:/code/search-api', name: 'search-api', kind: 'root', version: '1.4.0' },
    ],
    docs: [{ url: 'https://react.dev/reference/react', label: 'React reference' }, { url: 'https://docs.rs/axum/latest/axum/', label: 'docs.rs/axum' }],
  });
  if (p === '/api/notebooks' && method === 'GET') return json({ notebooks: Object.values(db.notebooks).map(summary) });
  if (p === '/api/notebooks' && method === 'POST') {
    if (db.notebooks[body.id]) return json({ error: 'A notebook with that id exists' }, 409);
    db.notebooks[body.id] = { id: body.id, title: body.title, color: body.color || '#e3a94b', description: '', shelf: [], roots: [], pinned: [] };
    db.conversations[body.id] = []; db.notes[body.id] = [];
    return json({ ok: true, id: body.id });
  }
  if ((m = p.match(/^\/api\/conversations\/([^/]+)\/([^/]+)$/))) {
    const [nbId, id] = [decodeURIComponent(m[1]), decodeURIComponent(m[2])];
    const list = db.conversations[nbId] || [];
    const c = list.find((x) => x.id === id);
    if (!c) return json({ error: 'conversation not found' }, 404);
    if (method === 'DELETE') { list.splice(list.indexOf(c), 1); return json({ ok: true }); }
    if (method === 'PATCH') { c.title = body.title; return json({ ok: true }); }
    return json(c);
  }
  if (!(m = p.match(/^\/api\/notebooks\/([^/]+)(\/.*)?$/))) return json({ error: 'not found' }, 404);
  const nbId = decodeURIComponent(m[1]);
  const rest = m[2] || '';
  const nb = db.notebooks[nbId];
  if (!nb) return json({ error: `unknown notebook ${nbId}` }, 404);

  if (rest === '') return json(detail(nbId));
  if (rest === '/file') {
    const path = u.searchParams.get('path');
    if (!path || path.includes('..')) return json({ error: 'path escapes the notebook' }, 400);
    if (path === C4) return json({ error: 'file not found' }, 404);
    const note = db.notes[nbId].find((x) => `notes/${x.slug}.md` === path);
    const code = /\.(ts|js)$/.test(path);
    const text = note ? note.body : code ? fakeCode(path) : fakeDoc(path);
    return json({ path, text, lang: code ? (path.endsWith('.ts') ? 'typescript' : 'javascript') : 'markdown', lines: text.split('\n').length });
  }
  if (rest === '/tree') {
    const t = fakeTree(u.searchParams.get('root'), u.searchParams.get('dir') || '');
    return t ? json({ entries: t }) : json({ error: 'unknown root' }, 400);
  }
  if (rest === '/search') {
    const q = u.searchParams.get('q') || '';
    await wait(200);
    const hits = [];
    const files = [C1, C3, C2, `${DOCS}/Reference/Routes.md`, 'service/src/api/orders.ts'];
    for (const [fi, f] of files.entries()) for (let k = 0; k < 3 + fi * 4; k++) hits.push({ path: f, line: 10 + k * 17, text: `    ${k % 2 ? 'public static final' : '//'} something about ${q} here, then ${q.toUpperCase()} again` });
    return json({ hits: hits.slice(0, 200) });
  }
  if (rest === '/ask' && method === 'POST') return sse(() => answerScript(nbId, body.question, body.conversationId, body.model), opts.signal);
  if (rest === '/generate' && method === 'POST') return sse(() => generateScript(nbId, body.kind), opts.signal);
  if (rest === '/sources' && method === 'POST') return sse(() => sourceScript(nbId, body), opts.signal);
  if (rest === '/sources' && method === 'DELETE') {
    if (body.kind === 'root') nb.roots = nb.roots.filter((r) => r.name !== body.value);
    else nb.pinned = nb.pinned.filter((x) => x !== body.value);
    return json({ ok: true });
  }
  if (rest.startsWith('/notes')) {
    const list = db.notes[nbId];
    const sub = rest.split('/')[2] ? decodeURIComponent(rest.split('/')[2]) : null;
    if (method === 'GET' && sub) { const n = list.find((x) => x.slug === sub); return n ? json(n) : json({ error: 'no such note' }, 404); }
    if (method === 'GET') return json(list);
    if (method === 'POST') { const slug = body.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50) + '-' + Date.now().toString(36); list.unshift({ slug, title: body.title, body: body.body, updated: now() }); return json({ slug }); }
    if (method === 'DELETE') { const slug = sub || body.slug || u.searchParams.get('slug'); db.notes[nbId] = list.filter((x) => x.slug !== slug); return json({ ok: true }); }
  }
  return json({ error: 'not found' }, 404);
}
