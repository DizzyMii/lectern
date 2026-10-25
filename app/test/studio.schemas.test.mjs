import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, validateRecipe, extractJson, CONTRACTS, KINDS } from '../studio/schemas.mjs';

const clone = (x) => JSON.parse(JSON.stringify(x));
// applies a mutation to a copy of a valid object and expects an error matching re
function rejects(kind, good, mutate, re) {
  const bad = clone(good);
  mutate(bad);
  const errors = validate(kind, bad);
  assert.ok(errors.length > 0, `expected errors for ${re}`);
  assert.ok(errors.some((e) => re.test(e)), `no error matched ${re}: ${errors.join(' | ')}`);
}

const graph = {
  title: 'Map', layout: 'layered',
  nodes: [{ id: 'a', label: 'A', kind: 'package' }, { id: 'b', label: 'B', kind: 'class', ref: 'src/B.java#L3' }, { id: 'c', label: 'C', detail: 'x' }],
  edges: [{ from: 'a', to: 'b', label: 'contains' }, { from: 'b', to: 'c' }],
};

test('every kind has a contract', () => {
  for (const k of KINDS) assert.ok(CONTRACTS[k]?.length > 50, k);
});

test('graph: valid and each invalid case', () => {
  assert.deepEqual(validate('graph', graph), []);
  assert.deepEqual(validate('graph', { ...graph, layout: 'radial' }), []);
  assert.match(validate('graph', null)[0], /JSON object/);
  assert.match(validate('graph', [])[0], /JSON object/);
  rejects('graph', graph, (g) => { delete g.title; }, /"title" is required/);
  rejects('graph', graph, (g) => { g.layout = 'grid'; }, /layout/);
  rejects('graph', graph, (g) => { delete g.layout; }, /layout/);
  rejects('graph', graph, (g) => { g.nodes = g.nodes.slice(0, 2); }, /at least 3/);
  rejects('graph', graph, (g) => { g.nodes = Array.from({ length: 121 }, (_, i) => ({ id: `n${i}`, label: 'x' })); g.edges = []; }, /max 120/);
  rejects('graph', graph, (g) => { g.nodes[1].id = 'a'; g.edges = []; }, /duplicate id "a"/);
  rejects('graph', graph, (g) => { delete g.nodes[0].id; }, /"id" is required/);
  rejects('graph', graph, (g) => { delete g.nodes[0].label; }, /"label" is required/);
  rejects('graph', graph, (g) => { g.nodes[0].label = 'x'.repeat(81); }, /max 80/);
  rejects('graph', graph, (g) => { g.nodes[0].kind = 3; }, /"kind" must be a string/);
  rejects('graph', graph, (g) => { g.nodes[1].ref = '[[src/B.java#L3]]'; }, /"ref" must look like/);
  rejects('graph', graph, (g) => { g.nodes[1].ref = 'src/B.java'; }, /"ref" must look like/);
  rejects('graph', graph, (g) => { g.edges[0].to = 'zz'; }, /"to" "zz" is not a node id/);
  rejects('graph', graph, (g) => { g.edges[0].from = 'zz'; }, /"from" "zz" is not a node id/);
  rejects('graph', graph, (g) => { g.edges.push({ from: 'a', to: 'a' }); }, /own node/);
  rejects('graph', graph, (g) => { g.edges = 'a->b'; }, /"edges" must be an array/);
  rejects('graph', graph, (g) => { g.nodes[2] = 'c'; }, /must be an object/);
});

const sequence = {
  title: 'Save', actors: [{ id: 'ui', label: 'UI' }, { id: 'api', label: 'API', kind: 'process' }],
  steps: [{ from: 'ui', to: 'api', label: 'POST /save', async: true, note: 'n', ref: 'a.ts#L1-L4' }, { from: 'api', to: 'api', label: 'validate' }],
};

test('sequence: valid and each invalid case', () => {
  assert.deepEqual(validate('sequence', sequence), []);
  rejects('sequence', sequence, (s) => { delete s.title; }, /"title" is required/);
  rejects('sequence', sequence, (s) => { s.actors = [s.actors[0]]; }, /at least 2/);
  rejects('sequence', sequence, (s) => { s.actors = Array.from({ length: 13 }, (_, i) => ({ id: `a${i}`, label: 'x' })); s.steps = [{ from: 'a0', to: 'a1', label: 'x' }]; }, /max 12/);
  rejects('sequence', sequence, (s) => { s.steps = []; }, /at least 1/);
  rejects('sequence', sequence, (s) => { s.steps = Array.from({ length: 61 }, () => ({ from: 'ui', to: 'api', label: 'x' })); }, /max 60/);
  rejects('sequence', sequence, (s) => { s.actors[1].id = 'ui'; }, /duplicate id/);
  rejects('sequence', sequence, (s) => { s.steps[0].to = 'db'; }, /"to" "db" is not an actor id/);
  rejects('sequence', sequence, (s) => { delete s.steps[0].label; }, /"label" is required/);
  rejects('sequence', sequence, (s) => { s.steps[0].async = 'yes'; }, /"async" must be true or false/);
  rejects('sequence', sequence, (s) => { s.steps[0].ref = 'nope'; }, /"ref" must look like/);
  rejects('sequence', sequence, (s) => { delete s.actors[0].label; }, /"label" is required/);
});

const plan = {
  title: 'Plan', goal: 'Ship it',
  phases: [
    { name: 'One', tasks: [{ id: 'T1', title: 'a', detail: 'd', files: ['x.ts'], dependsOn: [], estimate: 'S', acceptance: ['test passes'] }] },
    { name: 'Two', tasks: [{ id: 'T2', title: 'b', detail: 'd', files: [], dependsOn: ['T1'], acceptance: ['ok'], ref: 'x.ts#L2' }] },
  ],
};

test('plan: valid and each invalid case', () => {
  assert.deepEqual(validate('plan', plan), []);
  rejects('plan', plan, (p) => { delete p.goal; }, /"goal" is required/);
  rejects('plan', plan, (p) => { p.phases = []; }, /at least 1/);
  rejects('plan', plan, (p) => { p.phases[0].tasks = []; }, /at least 1/);
  rejects('plan', plan, (p) => { delete p.phases[0].name; }, /"name" is required/);
  rejects('plan', plan, (p) => { p.phases[1].tasks[0].id = 'T1'; }, /duplicate id "T1"/);
  rejects('plan', plan, (p) => { delete p.phases[0].tasks[0].files; }, /"files" is required/);
  rejects('plan', plan, (p) => { p.phases[0].tasks[0].files = [3]; }, /files\[0\] must be a string/);
  rejects('plan', plan, (p) => { delete p.phases[0].tasks[0].dependsOn; }, /"dependsOn" is required/);
  rejects('plan', plan, (p) => { p.phases[1].tasks[0].dependsOn = ['T9']; }, /"T9", which is not a task id/);
  rejects('plan', plan, (p) => { p.phases[0].tasks[0].dependsOn = ['T1']; }, /depends on itself/);
  rejects('plan', plan, (p) => { p.phases[0].tasks[0].dependsOn = ['T2']; }, /dependency cycle/);
  rejects('plan', plan, (p) => { p.phases[0].tasks[0].acceptance = []; }, /at least 1/);
  rejects('plan', plan, (p) => { p.phases[0].tasks[0].acceptance = ['']; }, /non-empty/);
  rejects('plan', plan, (p) => { p.phases[0].tasks[0].estimate = 'XL'; }, /"estimate"/);
  rejects('plan', plan, (p) => { delete p.phases[0].tasks[0].detail; }, /"detail" is required/);
  rejects('plan', plan, (p) => { p.phases[0].tasks[0].ref = 'x.ts:2'; }, /"ref" must look like/);
});

const q = (id, extra) => ({ id, q: 'Q?', kind: 'single', options: ['a', 'b'], answer: 'a', explain: 'because', ...extra });
const quiz = { title: 'Quiz', questions: [q('q1'), q('q2', { kind: 'multi', options: ['a', 'b', 'c'], answer: ['a', 'c'] }), q('q3', { kind: 'short', options: undefined, answer: 'Foo' }), q('q4'), q('q5')] };

test('quiz: valid and each invalid case', () => {
  assert.deepEqual(validate('quiz', quiz), []);
  rejects('quiz', quiz, (z) => { z.questions = z.questions.slice(0, 4); }, /at least 5/);
  rejects('quiz', quiz, (z) => { z.questions = Array.from({ length: 41 }, (_, i) => q(`q${i}`)); }, /max 40/);
  rejects('quiz', quiz, (z) => { z.questions[1].id = 'q1'; }, /duplicate id/);
  rejects('quiz', quiz, (z) => { z.questions[0].kind = 'essay'; }, /"kind" must be/);
  rejects('quiz', quiz, (z) => { z.questions[0].answer = 'c'; }, /not one of the options/);
  rejects('quiz', quiz, (z) => { z.questions[0].answer = ['a']; }, /needs a string "answer"/);
  rejects('quiz', quiz, (z) => { z.questions[0].options = ['a']; }, /at least 2/);
  rejects('quiz', quiz, (z) => { z.questions[0].options = ['a', 'a']; }, /distinct/);
  rejects('quiz', quiz, (z) => { z.questions[0].options = Array.from({ length: 7 }, (_, i) => `o${i}`); z.questions[0].answer = 'o1'; }, /max 6/);
  rejects('quiz', quiz, (z) => { z.questions[1].answer = 'a'; }, /"answer" array/);
  rejects('quiz', quiz, (z) => { z.questions[1].answer = ['a', 'z']; }, /"z" is not one of the options/);
  rejects('quiz', quiz, (z) => { z.questions[2].options = ['x', 'y']; }, /has no options/);
  rejects('quiz', quiz, (z) => { z.questions[2].answer = ''; }, /non-empty string "answer"/);
  rejects('quiz', quiz, (z) => { delete z.questions[0].explain; }, /"explain" is required/);
  rejects('quiz', quiz, (z) => { delete z.questions[0].q; }, /"q" is required/);
});

const file = { filename: 'CLAUDE.md', language: 'markdown', content: '# x\n', notes: 'n' };

test('file: valid and each invalid case', () => {
  assert.deepEqual(validate('file', file), []);
  rejects('file', file, (f) => { delete f.filename; }, /"filename" is required/);
  rejects('file', file, (f) => { f.filename = 'docs/CLAUDE.md'; }, /bare file name/);
  rejects('file', file, (f) => { delete f.language; }, /"language" is required/);
  rejects('file', file, (f) => { f.content = ''; }, /"content" must not be empty/);
  rejects('file', file, (f) => { f.notes = 4; }, /"notes" must be a string/);
});

test('doc: valid and each invalid case', () => {
  const md = '# Title\n\n' + 'Some text that is long enough to count as a document body. '.repeat(3);
  assert.deepEqual(validate('doc', md, { citations: 2 }), []);
  assert.deepEqual(validate('doc', md, { citations: null }), []);
  assert.match(validate('doc', 'short', {}).join(), /characters/);
  assert.match(validate('doc', md.replace('# Title', 'Title'), {}).join(), /no markdown heading/);
  assert.match(validate('doc', md, { citations: 0 }).join(), /no citations/);
  assert.match(validate('doc', '```\n' + md + '\n```', {}).join(), /code fence/);
});

test('recipe-specific checks', () => {
  const skill = { id: 'skill' };
  assert.deepEqual(validateRecipe(skill, { content: '---\nname: add-endpoint\ndescription: Adds things. Use when adding.\n---\n# x' }), []);
  assert.match(validateRecipe(skill, { content: '# no frontmatter' }).join(), /frontmatter/);
  assert.match(validateRecipe(skill, { content: '---\nname: Add Endpoint\ndescription: d\n---\n' }).join(), /lowercase/);
  assert.match(validateRecipe(skill, { content: '---\nname: a\n---\n' }).join(), /description/);
  assert.match(validateRecipe({ id: 'flashcards' }, { questions: [{ kind: 'single' }] }).join(), /short/);
  assert.match(validateRecipe({ id: 'concept-map', layout: 'radial' }, { layout: 'layered' }).join(), /radial/);
  assert.match(validateRecipe({ id: 'flow-diagram', layout: 'layered' }, { layout: 'layered', nodes: [{ kind: 'class' }] }).join(), /step/);
});

test('extractJson finds exactly one block and keeps the prose', () => {
  const ok = extractJson('Intro text.\n\n```json\n{"a":1}\n```\n');
  assert.deepEqual(ok.json, { a: 1 });
  assert.equal(ok.before, 'Intro text.');
  assert.equal(ok.error, null);
  assert.match(extractJson('no json here').error, /no ```json block/);
  assert.match(extractJson('```json\n{"a":1}\n```\n```json\n{"b":2}\n```').error, /2 ```json blocks/);
  assert.match(extractJson('```json\n{"a":1,}\n```').error, /does not parse/);
  assert.deepEqual(extractJson('{"bare":true}').json, { bare: true });
});

test('extractJson ignores code fences inside JSON strings', () => {
  const file = { filename: 'AGENTS.md', language: 'markdown', content: '# Agents\n\n## Setup\n```\n# Not found\nnpm test\n```\n\n```json\n{"x":1}\n```\n', notes: 'See the setup.' };
  const raw = `The agent guide.\n\n\`\`\`json\n${JSON.stringify(file, null, 2)}\n\`\`\`\n`;
  const x = extractJson(raw);
  assert.equal(x.error, null);
  assert.deepEqual(x.json, file);
  assert.equal(x.before, 'The agent guide.');
  assert.deepEqual(validate('file', x.json), []);
  const crlf = extractJson(raw.replace(/\n/g, '\r\n'));
  assert.equal(crlf.error, null);
  assert.equal(crlf.json.content, file.content);
  // a fence glued to the closing brace still parses through the lenient fallback
  assert.deepEqual(extractJson('```json\n{"a":1}```').json, { a: 1 });
});
