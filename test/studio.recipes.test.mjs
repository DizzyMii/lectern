import test from 'node:test';
import assert from 'node:assert/strict';
import { RECIPES, GROUPS, listRecipes, getRecipe } from '../lib/studio/recipes.mjs';
import { INPUT_TYPES } from '../lib/studio/inputs.mjs';
import { KINDS, CONTRACTS } from '../lib/studio/schemas.mjs';

// SPEC-studio.md lists these ids (it says 23, the list itself has 24)
const IDS = [
  'prd', 'tech-spec', 'impl-plan', 'adr', 'test-plan',
  'code-map', 'concept-map', 'flow-diagram', 'sequence-diagram', 'dependency-graph',
  'claude-md', 'agents-md', 'skill', 'agent-quiz',
  'onboarding', 'cheat-sheet', 'porting-guide', 'gotchas', 'glossary', 'flashcards',
  'gap-report', 'diff-review', 'build-x', 'release-notes',
];
const BANNED = /minecraft|neoforge|forge|fabric/i;

const SAMPLE = {
  text: 'sample text', longtext: 'a longer sample\nwith two lines',
  root: { name: 'code', path: 'src/main', abs: '/tmp/nb/src/main' },
  artifact: { id: 'a1', recipe: 'prd', title: 'Sample PRD', kind: 'doc', text: '# Sample PRD\n\nBody.' },
  diff: { source: 'git', root: 'code', range: 'main..HEAD', text: 'diff --git a/x b/x\n', truncated: false },
  gitlog: { source: 'git', root: 'code', range: 'v1..v2', count: 3, text: 'abc1234 2026-01-01 dev: fix thing' },
  path: 'code/OUT.md',
};
const CTX = { title: 'T', description: '', roots: [{ name: 'code', path: 'src/main', abs: '/tmp/nb/src/main' }] };
const full = (r) => Object.fromEntries(r.inputs.map((i) => [i.name, SAMPLE[i.type]]));
const minimal = (r) => Object.fromEntries(r.inputs.filter((i) => i.required || r.needsOne?.[0] === i.name).map((i) => [i.name, SAMPLE[i.type]]));

test('the recipe table has exactly the spec ids', () => {
  assert.deepEqual(RECIPES.map((r) => r.id).sort(), [...IDS].sort());
  assert.equal(new Set(RECIPES.map((r) => r.id)).size, RECIPES.length);
});

test('every recipe is well formed', () => {
  const groups = new Set(GROUPS.map((g) => g.id));
  for (const r of RECIPES) {
    assert.ok(groups.has(r.group), `${r.id} group`);
    assert.ok(KINDS.includes(r.kind), `${r.id} kind`);
    assert.ok(r.title && r.blurb && r.icon, `${r.id} text`);
    assert.equal(typeof r.prompt, 'function');
    const names = new Set();
    for (const i of r.inputs) {
      assert.ok(INPUT_TYPES.includes(i.type), `${r.id}.${i.name} type ${i.type}`);
      assert.ok(i.label, `${r.id}.${i.name} label`);
      assert.equal(typeof i.required, 'boolean', `${r.id}.${i.name} required`);
      assert.ok(!names.has(i.name), `${r.id} duplicate input ${i.name}`);
      names.add(i.name);
      for (const f of i.from ?? []) assert.ok(f === '*' || getRecipe(f), `${r.id}.${i.name} from ${f}`);
    }
    for (const n of r.needsOne ?? []) assert.ok(names.has(n), `${r.id} needsOne ${n}`);
    for (const n of r.next ?? []) {
      const target = getRecipe(n.recipe);
      assert.ok(target, `${r.id} next ${n.recipe}`);
      const inp = target.inputs.find((i) => i.name === n.input);
      assert.ok(inp, `${r.id} next ${n.recipe}.${n.input}`);
      if (inp.type === 'artifact') assert.ok(inp.from.includes('*') || inp.from.includes(r.id), `${n.recipe}.${n.input} accepts ${r.id}`);
    }
  }
});

test('spec input requirements', () => {
  const req = (id, name) => getRecipe(id).inputs.find((i) => i.name === name);
  assert.equal(req('prd', 'idea').required, true);
  assert.equal(req('code-map', 'root').type, 'root');
  assert.equal(req('code-map', 'root').required, true);
  assert.equal(req('dependency-graph', 'root').required, true);
  assert.equal(req('gap-report', 'root').required, true);
  assert.equal(req('diff-review', 'diff').type, 'diff');
  assert.equal(req('release-notes', 'log').type, 'gitlog');
  assert.equal(req('skill', 'topic').required, true);
  assert.equal(req('adr', 'decision').required, true);
  assert.deepEqual(req('impl-plan', 'source').from.slice(0, 2), ['tech-spec', 'prd']);
  assert.equal(getRecipe('impl-plan').kind, 'plan');
  assert.equal(getRecipe('concept-map').layout, 'radial');
  assert.equal(getRecipe('flashcards').kind, 'quiz');
  assert.equal(getRecipe('claude-md').filename, 'CLAUDE.md');
});

test('prompts build with full and minimal inputs, end with the contract and cite rule', () => {
  for (const r of RECIPES) {
    for (const v of [full(r), minimal(r)]) {
      const p = r.prompt(v, CTX);
      assert.ok(p.length > 400, `${r.id} prompt is short`);
      assert.ok(!/undefined|\[object Object\]/.test(p), `${r.id} prompt leaks undefined`);
      assert.ok(p.includes('Citation rule'), `${r.id} has the citation rule`);
      // release notes drop the doc contract's citation sentence
      const tail = CONTRACTS[r.kind].split('\n').at(-1).replace(r.id === 'release-notes' ? ' Every factual claim carries a citation.' : '\0', '');
      assert.ok(p.trimEnd().endsWith(tail), `${r.id} ends with the ${r.kind} contract`);
    }
  }
});

test('no recipe text mentions a specific game, loader or library', () => {
  for (const r of RECIPES) {
    const text = [r.title, r.blurb, ...r.inputs.flatMap((i) => [i.label, i.placeholder ?? '']), r.prompt(full(r), CTX), r.prompt(minimal(r), CTX)].join('\n');
    assert.doesNotMatch(text, BANNED, r.id);
  }
  assert.doesNotMatch(JSON.stringify(listRecipes()), BANNED);
});

test('listRecipes is serialisable and adds the CLAUDE.md chain to docs', () => {
  const list = listRecipes();
  assert.equal(list.length, IDS.length);
  for (const r of list) {
    assert.equal(r.prompt, undefined);
    if (r.kind === 'doc') assert.ok(r.next.some((n) => n.recipe === 'claude-md'), r.id);
  }
  assert.deepEqual(list.find((r) => r.id === 'prd').next[0], { recipe: 'tech-spec', input: 'source' });
});

test('doc recipes list the H2 sections their prompt fixes, and nothing for free-form ones', () => {
  const byId = Object.fromEntries(listRecipes().map((r) => [r.id, r]));
  assert.deepEqual(byId.adr.sections, ['Context', 'Options', 'Decision', 'Consequences', 'Revisit if']);
  assert.equal(byId['tech-spec'].sections.length, 9);
  assert.ok(byId.prd.sections.includes('Goals') && byId.prd.sections.includes('Non-goals'));
  // optional or templated headings do not make a fixed total
  assert.equal(byId['release-notes'].sections, null);
  assert.equal(byId['gap-report'].sections, null);
  for (const r of listRecipes()) {
    if (r.kind !== 'doc') assert.equal(r.sections, null, r.id);
    // every listed section is a heading the real prompt asks for
    else if (r.sections) {
      const text = getRecipe(r.id).prompt(full(r), CTX);
      for (const s of r.sections) assert.ok(text.includes(`"## ${s}"`), `${r.id}: ${s}`);
    }
  }
});
