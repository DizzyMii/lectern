import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setupNotebook } from './helpers.mjs';

const env = setupNotebook();
const { getNotebook } = await import('../lib/store.mjs');
const studio = await import('../lib/studio/engine.mjs');
const { fromPromptArgs, resolveInputs } = await import('../lib/studio/inputs.mjs');
const { getRecipe } = await import('../lib/studio/recipes.mjs');
test.after(() => env.cleanup());
const nb = getNotebook('test');
const artDir = path.join(env.nbDir, 'artifacts');
const artFiles = () => (fs.existsSync(artDir) ? fs.readdirSync(artDir) : []);

const fence = (o, before = 'The map shows the payload class [[docs/guide/a.md|"Register handlers in RegisterPayloadHandlersEvent."]].') => `${before}\n\n\`\`\`json\n${JSON.stringify(o, null, 2)}\n\`\`\`\n`;
const goodGraph = {
  title: 'Code map', layout: 'layered',
  nodes: [
    { id: 'pkg', label: 'net.x', kind: 'package' },
    { id: 'foo', label: 'Foo', kind: 'class', ref: 'src/java/net/x/Foo.java#L3', detail: 'The main class [[src/java/net/x/Foo.java#L3-L5]].' },
    { id: 'ghost', label: 'Ghost', kind: 'class', ref: 'src/java/Ghost.java#L1', detail: 'Same handler [[docs/guide/a.md|"Register handlers in RegisterPayloadHandlersEvent."]].' },
  ],
  edges: [{ from: 'pkg', to: 'foo', label: 'contains', kind: 'contains' }, { from: 'pkg', to: 'ghost' }],
};
const doc = (cite) => `# Cheats\n\nThese notes are long enough to pass the length check for a document and they point at one line. ${cite}\n`;

test('submit saves an agent-written graph through the same checks as a run', async () => {
  const { artifact: a } = await studio.submit(nb, { recipe: 'code-map', inputs: { root: 'code' }, draft: fence(goodGraph), client: 'claude-code' });
  assert.equal(a.status, 'ok');
  assert.equal(a.engine, 'mcp');
  assert.equal(a.client, 'claude-code');
  assert.equal(a.model, null);
  assert.equal(a.costUsd, 0);
  assert.equal(a.citations.length, 2);
  assert.equal(a.data.nodes[2].refStatus, 'missing');
  assert.equal(a.data.nodes[1].detail, 'The main class [^2].');
  assert.match(a.summary, /The map shows/);
  assert.equal(typeof a.generatedAt, 'string');
  assert.deepEqual(studio.getArtifact(nb, a.id), a);
  assert.equal(studio.listArtifacts(nb).find((x) => x.id === a.id).citations, 2);
});

test('submit returns errors and writes nothing for a broken draft', async () => {
  const before = artFiles().length;
  const broken = { ...goodGraph, edges: [{ from: 'pkg', to: 'nowhere' }] };
  const r = await studio.submit(nb, { recipe: 'code-map', inputs: { root: 'code' }, draft: fence(broken) });
  assert.ok(r.errors.some((e) => e.includes('nowhere')), r.errors.join('\n'));
  assert.equal('artifact' in r, false);
  assert.equal(artFiles().length, before);
});

test('submit replaces keep id and createdAt and refuse artifacts it did not make', async () => {
  const one = (await studio.submit(nb, { recipe: 'cheat-sheet', draft: doc('[[docs/intro.md|"Welcome."]]') })).artifact;
  await new Promise((r) => setTimeout(r, 5));
  const two = (await studio.submit(nb, { recipe: 'cheat-sheet', draft: doc('[[docs/intro.md|"Welcome."]]').replace('# Cheats', '# Cheats again'), replaces: one.id })).artifact;
  assert.equal(two.id, one.id);
  assert.equal(two.createdAt, one.createdAt);
  assert.notEqual(two.updatedAt, one.updatedAt);
  assert.equal(two.title, 'Cheats again');

  studio.saveArtifact(nb, { id: 'run-1', recipe: 'cheat-sheet', kind: 'doc', engine: 'claude-code', status: 'ok', title: 'Run', markdown: '# Run', citations: [] });
  const bytes = fs.readFileSync(path.join(artDir, 'run-1.json'));
  await assert.rejects(studio.submit(nb, { recipe: 'cheat-sheet', draft: doc('[[docs/intro.md#L1]]'), replaces: 'run-1' }), { status: 409 });
  await assert.rejects(studio.submit(nb, { recipe: 'glossary', draft: doc('[[docs/intro.md#L1]]'), replaces: one.id }), { status: 409 });
  await assert.rejects(studio.submit(nb, { recipe: 'cheat-sheet', draft: doc('[[docs/intro.md#L1]]'), replaces: 'gone-1' }), { status: 404 });
  assert.ok(fs.readFileSync(path.join(artDir, 'run-1.json')).equals(bytes));
});

test('fromPromptArgs turns prompt strings into inputs', async () => {
  const repo = path.join(env.nbDir, 'src', 'java');
  const g = (...args) => {
    const r = spawnSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  g('init', '-q', '-b', 'main');
  g('add', '.');
  g('commit', '-q', '-m', 'first commit');
  g('tag', 'v1');
  fs.writeFileSync(path.join(repo, 'Bar.java'), 'class Bar {}\n');
  g('add', '.');
  g('commit', '-q', '-m', 'add Bar');

  const review = getRecipe('diff-review');
  const want = { diff: { root: 'code', range: 'v1..HEAD' } };
  assert.deepEqual(fromPromptArgs(nb, review, { diff: 'code:v1..HEAD' }), want);
  assert.deepEqual(fromPromptArgs(nb, review, { diff: 'v1..HEAD' }), want);
  assert.equal(fromPromptArgs(nb, review, { diff: 'diff --git a/x b/x\n+hi\n' }).diff, 'diff --git a/x b/x\n+hi');
  assert.deepEqual(fromPromptArgs(nb, getRecipe('release-notes'), { log: 'code:v1..HEAD' }), { log: { root: 'code', range: 'v1..HEAD' } });
  assert.deepEqual(fromPromptArgs(nb, getRecipe('adr'), { decision: 'x', options: '  ' }), { decision: 'x' });
  const two = { ...nb, config: { ...nb.config, roots: { code: 'src/java', docs: 'docs' } } };
  assert.throws(() => fromPromptArgs(two, review, { diff: 'v1..HEAD' }), /<root>:<range>/);
  const { values } = await resolveInputs(nb, review, fromPromptArgs(nb, review, { diff: 'code:v1..HEAD' }));
  assert.match(values.diff.text, /Bar\.java/);
});
