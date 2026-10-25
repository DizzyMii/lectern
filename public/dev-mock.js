// Dev-only fake backend, loaded when the page URL has ?mock=1.
// Mirrors the HTTP API and SSE events from SPEC.md with scripted data.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const now = () => new Date().toISOString();

const DOCS = 'corpus/neoforge-docs/versioned_docs/version-1.21.1';
const PRIMERS = 'corpus/neoforge-github/primers';
const DOC_GROUPS = {
  advanced: ['accesstransformers', 'extensibleenums', 'featureflags'],
  blockentities: ['index', 'ber', 'container'],
  blocks: ['index', 'states'],
  concepts: ['events', 'registries', 'sides'],
  datastorage: ['attachments', 'codecs', 'nbt', 'saveddata'],
  gettingstarted: ['index', 'modfiles', 'structuring', 'versioning'],
  gui: ['menus', 'screens'],
  inventories: ['capabilities', 'container', 'itemhandler'],
  items: ['index', 'datacomponents', 'interactionpipeline', 'mobeffects', 'tools'],
  misc: ['config', 'gametest', 'keymappings', 'updatechecker'],
  networking: ['index', 'payload', 'streamcodecs', 'entities'],
  rendering: ['index', 'modelloaders', 'particles'],
  resources: ['index', 'client/models/index', 'server/recipes/index'],
  worldgen: ['biomemodifier'],
};
const shelf = [
  ...Object.entries(DOC_GROUPS).map(([g, fs]) => ({ title: g, files: fs.map((f) => `${DOCS}/${g}/${f}.md`), tokens: 9000 + fs.length * 3100 })),
  { title: '1.20.5', files: [`${PRIMERS}/1.20.5/index.md`] },
  { title: '1.20.6', files: [`${PRIMERS}/1.20.6/index.md`] },
  { title: '1.21', files: [`${PRIMERS}/1.21/index.md`] },
];

const ROOTS = [
  { name: 'neoforge', path: 'corpus/neoforge/src/main/java', files: 956 },
  { name: 'geckolib', path: 'corpus/geckolib/common/src/main/java', files: 312 },
  { name: 'geckolib-neoforge', path: 'corpus/geckolib/neoforge/src/main/java', files: 41 },
];

const C1 = 'corpus/neoforge-docs/versioned_docs/version-1.21.1/items/datacomponents.md';
const C2 = 'corpus/neoforge/src/main/java/net/neoforged/neoforge/registries/DeferredRegister.java';
const C3 = 'corpus/neoforge-github/primers/1.20.5/index.md';
const C4 = 'corpus/neoforge/src/main/java/net/neoforged/neoforge/common/ItemStackTagHelper.java';

const ANSWER_RAW = `Use a **data component**, not NBT. Since 1.20.5 an \`ItemStack\` no longer carries a free-form \`CompoundTag\`; each piece of data is a typed component keyed by a \`DataComponentType<T>\` [[${C1}|"Data components are key-value pairs within a map used to store data on an \`ItemStack\`"]].

### 1. Register the type

Register it through \`DeferredRegister.DataComponents\`, which wraps \`Registries.DATA_COMPONENT_TYPE\` [[${C2}#L612-L618]]:

\`\`\`java
public static final DeferredRegister.DataComponents COMPONENTS =
    DeferredRegister.createDataComponents(Registries.DATA_COMPONENT_TYPE, MODID);

public static final DeferredHolder<DataComponentType<?>, DataComponentType<Integer>> CHARGE =
    COMPONENTS.registerComponentType("charge", b -> b
        .persistent(Codec.INT)
        .networkSynchronized(ByteBufCodecs.VAR_INT));
\`\`\`

\`persistent\` makes it save with the world, \`networkSynchronized\` sends it to the client so tooltips and models see it.

### 2. Read and write it

- \`stack.getOrDefault(CHARGE, 0)\` reads with a fallback.
- \`stack.set(CHARGE, value)\` writes; component values must be immutable, so always set a new value rather than mutating.
- \`stack.update(CHARGE, 0, v -> v + 1)\` is the shorthand for read, change, write.

The primer calls this out directly: \`getOrCreateTag\` and \`getTag\` are gone, and arbitrary NBT now lives only in \`DataComponents.CUSTOM_DATA\` [[${C3}|"The tag on an ItemStack has been replaced by data components"]].

> Avoid \`ItemStackTagHelper\`; it was removed along with the tag API [[${C4}#L40-L44]].`;

let n = 0;
const CITES = [];
const ANSWER_FINAL = ANSWER_RAW.replace(/\[\[[^\]]+\]\]/g, () => `[^${++n}]`);
CITES.push(
  { n: 1, path: C1, line: 9, endLine: 9, quote: 'Data components are key-value pairs within a map used to store data on an `ItemStack`', status: 'verified' },
  { n: 2, path: C2, line: 614, citedLine: 612, endLine: 618, quote: 'registerComponentType', status: 'moved' },
  { n: 3, path: C3, line: 48, endLine: 48, quote: 'The tag on an ItemStack has been replaced by data components', status: 'unverified' },
  { n: 4, path: C4, line: 40, endLine: 44, quote: null, status: 'missing' },
);

const TOOLS = [
  { name: 'Grep', input: { pattern: 'DataComponentType', path: 'corpus/neoforge/src/main/java' }, summary: 'Grep "DataComponentType" in neoforge', chars: 2140 },
  { name: 'Read', input: { file_path: C2, offset: 580, limit: 60 }, summary: 'Read neoforge/.../registries/DeferredRegister.java 580-640', chars: 3302 },
  { name: 'Glob', input: { pattern: '**/ItemStack*.java' }, summary: 'Glob "**/ItemStack*.java" in neoforge', chars: 380 },
  { name: 'Read', input: { file_path: 'corpus/neoforge/src/main/java/net/neoforged/neoforge/common/extensions/IItemStackExtension.java' }, summary: 'Read neoforge/.../extensions/IItemStackExtension.java 1-200', chars: 8810 },
  { name: 'Grep', input: { pattern: 'getOrCreateTag' }, summary: 'Grep "getOrCreateTag" in neoforge', chars: 0, ok: true },
];

const db = {
  notebooks: {
    'neoforge-1.21.1': { id: 'neoforge-1.21.1', title: 'NeoForge 1.21.1', color: '#e3a94b', description: 'The NeoForge docs for 1.21.1, the porting primers from 1.20.5 on, and the NeoForge and GeckoLib sources.', shelf, roots: ROOTS, pinned: [`${DOCS}/**/*.md`, `${PRIMERS}/1.20.5/*.md`, `${PRIMERS}/1.20.6/*.md`, `${PRIMERS}/1.21/*.md`] },
    'fabric-1.21.1': { id: 'fabric-1.21.1', title: 'Fabric 1.21.1', color: '#4cc9a0', description: '', shelf: [{ title: 'fabric-docs', files: ['corpus/fabric-docs/develop/index.md'] }], roots: [], pinned: ['corpus/fabric-docs/**/*.md'] },
  },
  conversations: {
    'neoforge-1.21.1': [
      { id: 'c-demo-1', title: 'How do I register an entity renderer safely?', updated: new Date(Date.now() - 3600e3 * 5).toISOString(), turns: [
        { question: 'How do I register an entity renderer so it does not crash a dedicated server?', answer: 'Subscribe to `EntityRenderersEvent.RegisterRenderers` on the **mod bus**, in a class annotated `@EventBusSubscriber(modid = MODID, bus = Bus.MOD, value = Dist.CLIENT)` [^1]. The `Dist.CLIENT` value keeps the class from loading on a dedicated server [^2].\n\n```java\n@SubscribeEvent\npublic static void renderers(EntityRenderersEvent.RegisterRenderers e) {\n    e.registerEntityRenderer(MyEntities.GOLEM.get(), GolemRenderer::new);\n}\n```',
          citations: [{ n: 1, path: `${DOCS}/concepts/events.md`, line: 60, endLine: 72, quote: null, status: 'verified' }, { n: 2, path: `${DOCS}/concepts/sides.md`, line: 30, endLine: 30, quote: 'Dist.CLIENT', status: 'unverified' }],
          toolCalls: [{ id: 't1', name: 'Grep', summary: 'Grep "RegisterRenderers" in neoforge', ok: true }, { id: 't2', name: 'Read', summary: 'Read neoforge/.../EntityRenderersEvent.java 1-120', ok: true }],
          usage: { input_tokens: 4100, cache_read_input_tokens: 182000, output_tokens: 640 }, model: 'sonnet', seconds: 21.4 },
      ] },
      { id: 'c-demo-2', title: 'Per-player mana that survives death', updated: new Date(Date.now() - 86400e3 * 2).toISOString(), turns: [] },
    ],
    'fabric-1.21.1': [],
  },
  notes: {
    'neoforge-1.21.1': [{ slug: 'cheat-sheet', title: 'Cheat sheet', kind: 'cheat-sheet', updated: new Date(Date.now() - 86400e3).toISOString(), body: '# NeoForge 1.21.1 cheat sheet\n\n| Need | Use |\n| --- | --- |\n| Item data | `DataComponentType` |\n| Packets | `CustomPacketPayload` + `RegisterPayloadHandlersEvent` |\n| Player data | `AttachmentType` with `copyOnDeath()` |\n| Capabilities | `RegisterCapabilitiesEvent` |\n' }],
    'fabric-1.21.1': [],
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

function fakeJava(path) {
  const cls = path.split('/').pop().replace('.java', '');
  const pkg = path.replace(/^.*?src\/main\/java\//, '').split('/').slice(0, -1).join('.');
  const out = [
    '/*', ' * Copyright (c) NeoForged and contributors', ' * SPDX-License-Identifier: LGPL-2.1-only', ' */', '',
    `package ${pkg};`, '', 'import com.mojang.serialization.Codec;', 'import net.minecraft.core.Registry;', 'import net.minecraft.core.component.DataComponentType;',
    'import net.minecraft.network.codec.StreamCodec;', 'import net.minecraft.resources.ResourceKey;', 'import java.util.function.Supplier;', 'import java.util.function.UnaryOperator;', '',
    '/**', ` * ${cls}: a helper that registers entries for one mod against one registry.`, ' */', `public class ${cls}<T> {`,
  ];
  let i = 0;
  while (out.length < 700) {
    i++;
    out.push('', `    /** Registers entry number ${i}. */`, `    public <I extends T> DeferredHolder<T, I> register${i}(String name, Supplier<? extends I> sup) {`,
      `        final ResourceLocation key = ResourceLocation.fromNamespaceAndPath(namespace, name + "_${i}");`, '        if (seenRegisterEvent) throw new IllegalStateException("Cannot register new entries after RegisterEvent has been fired.");',
      '        return createHolder(registryKey, key); // keeps the holder lazy', '    }');
  }
  out.splice(605, 20,
    '', '    /**', '     * Specialised register for {@link DataComponentType data component types}.', '     */',
    '    public static class DataComponents extends DeferredRegister<DataComponentType<?>> {',
    '        protected DataComponents(ResourceKey<? extends Registry<DataComponentType<?>>> registryKey, String namespace) {',
    '            super(registryKey, namespace);', '        }', '',
    '        public <D> DeferredHolder<DataComponentType<?>, DataComponentType<D>> registerComponentType(String name, UnaryOperator<DataComponentType.Builder<D>> builder) {',
    '            return this.register(name, () -> builder.apply(DataComponentType.builder()).build());', '        }', '    }', '');
  out.push('}', '');
  return out.join('\n');
}

function fakeDoc(path) {
  const name = path.split('/').pop().replace('.md', '');
  if (path === C1) {
    return `---\nsidebar_position: 2\n---\nimport Tabs from '@theme/Tabs';\nimport TabItem from '@theme/TabItem';\n\n# Data Components\n\nData components are key-value pairs within a map used to store data on an \`ItemStack\`. Each piece of data, such as firework explosions or tools, are stored as actual objects on the stack, making the values visible and operable without having to dynamically transform a general encoded instance (e.g., \`CompoundTag\`, \`JsonElement\`).\n\n## \`DataComponentType\`\n\nEach data component has an associated \`DataComponentType<T>\`, where \`T\` is the component value type.\n\n:::note\nComponent values can very easily be implemented using a record. Record fields are immutable and implement \`hashCode\` and \`equals\`.\n:::\n\n\`\`\`java\npublic record ExampleRecord(int value1, boolean value2) {}\n\`\`\`\n\n${'A standard `DataComponentType` can be created via `DataComponentType#builder` and built using `DataComponentType.Builder#build`. The builder contains three settings: `persistent`, `networkSynchronized`, `cacheEncoding`.\n\n'.repeat(12)}## Using the component\n\n- \`getOrDefault\`\n- \`set\`\n- \`update\`\n`;
  }
  let body = `# ${name[0].toUpperCase() + name.slice(1)}\n\nThis page is part of the mock corpus. It stands in for \`${path}\`.\n\n`;
  for (let i = 1; i <= 30; i++) body += `## Section ${i}\n\nParagraph ${i} of the mock document. Item stacks keep their data in typed components.\n\n`;
  return body;
}

// ---------- fake tree ----------

function fakeTree(rootName, dir) {
  const parts = dir ? dir.split('/') : [];
  const depth = parts.length;
  const r = ROOTS.find((x) => x.name === rootName);
  if (!r) return null;
  const top = rootName.startsWith('gecko') ? 'software/bernie/geckolib' : 'net/neoforged/neoforge';
  const chain = top.split('/');
  if (depth < chain.length) return [{ name: chain[depth], type: 'dir' }];
  if (depth === chain.length) {
    return ['client', 'common', 'registries', 'network', 'event', 'capabilities', 'items', 'attachment'].map((name) => ({ name, type: 'dir' }))
      .concat([{ name: 'NeoForgeMod.java', type: 'file' }, { name: 'package-info.java', type: 'file' }]);
  }
  if (parts.at(-1) === 'client' && depth === chain.length + 1) {
    return [{ name: 'model', type: 'dir' }, ...Array.from({ length: 450 }, (_, i) => ({ name: `ClientHook${String(i).padStart(3, '0')}.java`, type: 'file' }))];
  }
  if (parts.at(-1) === 'registries') return ['DeferredRegister.java', 'DeferredHolder.java', 'RegisterEvent.java', 'NeoForgeRegistries.java'].map((name) => ({ name, type: 'file' }));
  return ['Helper.java', 'Events.java', 'Util.java', 'Constants.java'].map((name) => ({ name, type: 'file' }));
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
  const text = `# ${kind.replace(/-/g, ' ')}\n\n1. **Registries** go through \`DeferredRegister\` [[${C2}#L612-L618]].\n2. **Item data** uses data components [[${C1}|"Data components are key-value pairs"]].\n3. **Packets** implement \`CustomPacketPayload\`.\n`;
  for (let i = 0; i < text.length; i += 6) { yield { type: 'delta', text: text.slice(i, i + 6) }; await wait(16); }
  const slug = `${kind}-${Date.now().toString(36)}`;
  const answer = text.replace(`[[${C2}#L612-L618]]`, '[^1]').replace(`[[${C1}|"Data components are key-value pairs"]]`, '[^2]');
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
      { path: 'D:/projects/wtg', name: 'wtg', kind: 'repo', branch: 'main' },
      { path: 'D:/projects/neoforge-src', name: 'neoforge-src', kind: 'root', version: '21.1.77' },
      { path: 'D:/projects/geckolib', name: 'geckolib', kind: 'root', version: '4.7.1' },
    ],
    docs: [{ url: 'https://docs.neoforged.net/docs/1.21.1/', label: 'docs.neoforged.net/docs/1.21.1' }],
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
    const text = note ? note.body : path.endsWith('.java') ? fakeJava(path) : fakeDoc(path);
    return json({ path, text, lang: path.endsWith('.java') ? 'java' : 'markdown', lines: text.split('\n').length });
  }
  if (rest === '/tree') {
    const t = fakeTree(u.searchParams.get('root'), u.searchParams.get('dir') || '');
    return t ? json({ entries: t }) : json({ error: 'unknown root' }, 400);
  }
  if (rest === '/search') {
    const q = u.searchParams.get('q') || '';
    await wait(200);
    const hits = [];
    const files = [C1, C3, C2, `${DOCS}/networking/payload.md`, 'corpus/neoforge/src/main/java/net/neoforged/neoforge/common/NeoForgeMod.java'];
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
