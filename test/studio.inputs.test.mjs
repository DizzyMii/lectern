import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setupNotebook } from './helpers.mjs';

const env = setupNotebook();
const { getNotebook } = await import('../lib/store.mjs');
const { resolveInputs, resolveDiff, resolveGitlog, artifactText } = await import('../lib/studio/inputs.mjs');
const { getRecipe } = await import('../lib/studio/recipes.mjs');
const { saveArtifact, getArtifact } = await import('../lib/studio/engine.mjs');
test.after(() => env.cleanup());

// a small repo as the "code" root, so git diff and log have something real to read
const repo = path.join(env.nbDir, 'src', 'java');
const g = (...args) => {
  const r = spawnSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
g('init', '-q', '-b', 'main');
g('add', '.');
g('commit', '-q', '-m', 'first commit');
g('tag', 'v1');
fs.writeFileSync(path.join(repo, 'net', 'x', 'Foo.java'), 'package net.x;\n\npublic class Foo {\n  void payload() {}\n  void more() {}\n}\n');
g('commit', '-q', '-am', 'add more()', '-m', 'Body line explaining why.');
fs.writeFileSync(path.join(repo, 'Bar.java'), 'class Bar {}\n');
g('add', '.');
g('commit', '-q', '-m', 'add Bar');

const nb = getNotebook('test');

test('git diff over a range in a root', async () => {
  const d = await resolveDiff(nb, { root: 'code', range: 'v1..HEAD' });
  assert.equal(d.source, 'git');
  assert.match(d.text, /\+  void more\(\) \{\}/);
  assert.match(d.text, /Bar\.java/);
  assert.equal(d.truncated, false);
});

test('pasted diff passes through and is capped', async () => {
  const d = await resolveDiff(nb, 'diff --git a/x b/x\n+hi\n');
  assert.equal(d.source, 'paste');
  const big = await resolveDiff(nb, 'x'.repeat(500 * 1024));
  assert.equal(big.truncated, true);
  assert.equal(big.text.length, 400 * 1024);
});

test('git log lists commits newest first with bodies', async () => {
  const l = await resolveGitlog(nb, { root: 'code', range: 'v1..HEAD' });
  assert.equal(l.count, 2);
  const lines = l.text.split('\n');
  assert.match(lines[0], /^[0-9a-f]{7,} \d{4}-\d\d-\d\d Test: add Bar$/);
  assert.match(l.text, /add more\(\)\n    Body line explaining why\./);
});

test('bad ranges and roots are refused before git runs', async () => {
  await assert.rejects(resolveDiff(nb, { root: 'code', range: '--output=/tmp/x' }), /bad git range/);
  await assert.rejects(resolveDiff(nb, { root: 'code', range: 'a b' }), /bad git range/);
  await assert.rejects(resolveDiff(nb, { root: 'nope', range: 'v1..HEAD' }), /unknown root/);
  await assert.rejects(resolveGitlog(nb, { root: 'code', range: 'nosuchref..HEAD' }), /git log failed/);
  await assert.rejects(resolveDiff(nb, { root: 'code', range: 'HEAD..HEAD' }), /is empty/);
});

test('resolveInputs: required, needsOne, roots, paths and artifacts', async () => {
  await assert.rejects(resolveInputs(nb, getRecipe('prd'), {}), /"Idea" is required/);
  await assert.rejects(resolveInputs(nb, getRecipe('tech-spec'), {}), /give one of/);
  const { values } = await resolveInputs(nb, getRecipe('code-map'), { root: 'code', focus: '  payloads ' });
  assert.equal(values.root.name, 'code');
  assert.equal(values.root.path, 'src/java');
  assert.ok(values.root.abs.endsWith('/nb/src/java'));
  assert.equal(values.focus, 'payloads');
  await assert.rejects(resolveInputs(nb, getRecipe('code-map'), { root: 'ghost' }), /unknown root/);
  await assert.rejects(resolveInputs(nb, getRecipe('claude-md'), { path: '../escape.md' }), /without "\.\."/);
  await assert.rejects(resolveInputs(nb, getRecipe('claude-md'), { path: 'C:/abs.md' }), /relative/);

  saveArtifact(nb, { id: 'prd-1', recipe: 'prd', kind: 'doc', title: 'My PRD', status: 'ok', markdown: '# My PRD\n\nUse it [^1].', citations: [{ n: 1, path: 'docs/intro.md', line: 3, endLine: 3, quote: 'Welcome.', status: 'verified' }] });
  saveArtifact(nb, { id: 'map-1', recipe: 'code-map', kind: 'graph', title: 'Map', status: 'ok', summary: 'A map.', data: { title: 'Map', nodes: [] }, citations: [] });
  saveArtifact(nb, { id: 'bad-1', recipe: 'prd', kind: 'doc', title: 'Broken', status: 'invalid', raw: 'x' });
  const r = await resolveInputs(nb, getRecipe('tech-spec'), { source: 'prd-1' }, { getArtifact });
  assert.equal(r.parent, 'prd-1');
  assert.match(r.values.source.text, /# My PRD/);
  assert.match(r.values.source.text, /\[\^1\]: docs\/intro\.md#L3 "Welcome\."/);
  await assert.rejects(resolveInputs(nb, getRecipe('tech-spec'), { source: 'map-1' }, { getArtifact }), /takes an artifact from prd or adr/);
  await assert.rejects(resolveInputs(nb, getRecipe('tech-spec'), { source: 'bad-1' }, { getArtifact }), /is invalid/);
  await assert.rejects(resolveInputs(nb, getRecipe('tech-spec'), { source: 'ghost' }, { getArtifact }), /no artifact/);
  // claude-md takes any artifact
  const c = await resolveInputs(nb, getRecipe('claude-md'), { source: 'map-1' }, { getArtifact });
  assert.match(c.values.source.text, /```json/);

  const d = await resolveInputs(nb, getRecipe('diff-review'), { diff: { root: 'code', range: 'v1..HEAD' } });
  assert.match(d.values.diff.text, /Bar\.java/);
  const rn = await resolveInputs(nb, getRecipe('release-notes'), { log: { root: 'code', range: 'v1..HEAD' } });
  assert.equal(rn.values.log.count, 2);
  await assert.rejects(resolveInputs(nb, getRecipe('release-notes'), { log: { root: 'code', range: '' } }), /bad git range/);
});

test('artifactText inlines structured data as json', () => {
  const t = artifactText({ kind: 'plan', summary: 'Plan summary', data: { title: 'P' }, citations: [] });
  assert.match(t, /^Plan summary\n\n```json\n\{\n  "title": "P"\n\}\n```$/);
});
