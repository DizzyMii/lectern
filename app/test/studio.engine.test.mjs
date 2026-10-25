import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupNotebook } from './helpers.mjs';

const env = setupNotebook();
const { getNotebook } = await import('../store.mjs');
const studio = await import('../studio/engine.mjs');
test.after(() => env.cleanup());
const nb = getNotebook('test');

// A scripted stand-in for ask(): each call takes the next answer and records what it was asked.
function scripted(answers) {
  const calls = [];
  const impl = (opts) => {
    const i = calls.length;
    calls.push(opts);
    const text = answers[i];
    opts.onEvent({ type: 'delta', text: 'x' });
    opts.onEvent({ type: 'tool', id: `t${i}`, name: 'Grep', input: {}, summary: 'Grep "x" in code' });
    opts.onEvent({ type: 'tool_result', id: `t${i}`, ok: true, chars: 3 });
    opts.onEvent({ type: 'done' }); // must not leak through
    const done = text instanceof Error ? Promise.reject(text) : Promise.resolve({
      answer: text, rawAnswer: text, citations: [], toolCalls: [{ id: `t${i}`, name: 'Grep', summary: 'Grep', ok: true, chars: 3 }],
      usage: { input_tokens: 10, output_tokens: 5 }, costUsd: 0.01, sessionCostUsd: 0.01 * (i + 1), sessionId: 'sess-1', seconds: 1,
    });
    done.catch(() => {});
    return { done, cancel() {} };
  };
  return { impl, calls };
}

async function runRecipe(recipe, inputs, answers, opts = {}) {
  const s = scripted(answers);
  const events = [];
  const job = await studio.generate(nb, recipe, inputs, { model: 'haiku', askImpl: s.impl, onEvent: (e) => events.push(e), ...opts });
  let artifact, error;
  try { artifact = await job.done; } catch (e) { error = e; }
  return { artifact, error, events, calls: s.calls };
}

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

test('a valid graph is saved ok with one shared citation list and verified refs', async () => {
  const { artifact, events, calls } = await runRecipe('code-map', { root: 'code' }, [fence(goodGraph)]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].persist, false);
  assert.equal(calls[0].model, 'haiku');
  assert.match(calls[0].question, /the "code" code root \(notebook path "src\/java"/);
  assert.equal(artifact.status, 'ok');
  assert.equal(artifact.kind, 'graph');
  assert.equal(artifact.title, 'Code map');
  assert.equal(artifact.citations.length, 2);
  // the summary and a node detail cite the same quote and share number 1
  assert.match(artifact.summary, /\[\^1\]/);
  assert.equal(artifact.data.nodes[2].detail, 'Same handler [^1].');
  assert.equal(artifact.data.nodes[1].detail, 'The main class [^2].');
  assert.equal(artifact.citations[1].status, 'verified');
  assert.equal(artifact.data.nodes[1].refStatus, 'verified');
  assert.equal(artifact.data.nodes[1].ref, 'src/java/net/x/Foo.java#L3');
  assert.equal(artifact.data.nodes[2].refStatus, 'missing');
  assert.equal(artifact.attempts.length, 1);
  assert.deepEqual(artifact.usage, { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
  const types = events.map((e) => e.type);
  assert.deepEqual(types.filter((t) => t === 'phase').length, 2);
  assert.equal(types.filter((t) => t === 'done').length, 1);
  assert.equal(types.at(-1), 'done');
  assert.ok(types.includes('tool') && types.includes('tool_result') && types.includes('delta'));
  assert.equal(events.at(-1).artifact.id, artifact.id);
  assert.deepEqual(studio.getArtifact(nb, artifact.id), artifact);
});

test('invalid json gets one repair turn in the same session, then ok', async () => {
  const broken = { ...goodGraph, edges: [{ from: 'pkg', to: 'nowhere' }] };
  const { artifact, events, calls } = await runRecipe('code-map', { root: 'code' }, [fence(broken), '```json\n' + JSON.stringify(goodGraph) + '\n```']);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].resume, { sessionId: 'sess-1', costUsd: 0.01 });
  assert.match(calls[1].question, /^Your JSON failed validation:\n- edges\[0\]: "to" "nowhere" is not a node id\nReply with only the corrected ```json block/);
  const phase = events.find((e) => e.type === 'phase' && e.name === 'repair');
  assert.ok(phase);
  assert.match(phase.errors[0], /nowhere/);
  assert.equal(artifact.status, 'ok');
  assert.equal(artifact.attempts.length, 2);
  assert.equal(artifact.attempts[0].errors.length, 1);
  assert.deepEqual(artifact.attempts[1].errors, []);
  assert.equal(artifact.costUsd, 0.02);
  assert.equal(artifact.usage.output_tokens, 10);
  // the repair answer had no prose, so the first answer's summary is kept
  assert.match(artifact.summary, /The map shows/);
});

test('still invalid after the repair: saved invalid with the raw text and errors', async () => {
  const { artifact } = await runRecipe('code-map', { root: 'code' }, ['no json at all', 'still none']);
  assert.equal(artifact.status, 'invalid');
  assert.equal(artifact.data, null);
  assert.match(artifact.raw, /no json at all[\s\S]*repair attempt[\s\S]*still none/);
  assert.match(artifact.errors[0], /no ```json block/);
  assert.equal(artifact.attempts.length, 2);
});

test('a deliberately strict recipe check forces a repair: flashcards must be short', async () => {
  const qs = (kind) => Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, q: `Q${i}?`, kind, ...(kind === 'single' ? { options: ['a', 'b'], answer: 'a' } : { answer: 'Foo' }), explain: 'See [[docs/intro.md|"Welcome."]]' }));
  const { artifact, calls } = await runRecipe('flashcards', {}, [fence({ title: 'Cards', questions: qs('single') }, 'Cards.'), fence({ title: 'Cards', questions: qs('short') }, 'Cards.')]);
  assert.equal(calls.length, 2);
  assert.match(calls[1].question, /flashcards are "short" questions only/);
  assert.equal(artifact.status, 'ok');
  assert.equal(artifact.data.questions[0].explain, 'See [^1]');
  assert.equal(artifact.data.questions[0].answer, 'Foo');
});

test('the NB_STUDIO_FORCE_REPAIR hook repairs a valid answer', async () => {
  process.env.NB_STUDIO_FORCE_REPAIR = '1';
  try {
    const { artifact, calls } = await runRecipe('code-map', { root: 'code' }, [fence(goodGraph), fence(goodGraph)]);
    assert.equal(calls.length, 2);
    assert.match(calls[1].question, /forced repair/);
    assert.equal(artifact.status, 'ok');
    assert.match(artifact.attempts[0].errors[0], /test hook/);
  } finally { delete process.env.NB_STUDIO_FORCE_REPAIR; }
});

test('doc recipes: markdown with citations, repair when uncited', async () => {
  const body = 'This is the body of the document, long enough to pass the length check for docs.';
  const uncited = `# Product PRD\n\n${body}`;
  const cited = `# Product PRD\n\n${body} Handlers go in the event [[docs/guide/a.md|"Register handlers in RegisterPayloadHandlersEvent."]].`;
  const { artifact, calls } = await runRecipe('prd', { idea: 'A thing' }, [uncited, cited]);
  assert.equal(calls.length, 2);
  assert.match(calls[1].question, /^Your document failed validation:\n- document: has no citations/);
  assert.match(calls[1].question, /Reply with the full corrected document only/);
  assert.equal(artifact.status, 'ok');
  assert.equal(artifact.title, 'Product PRD');
  assert.match(artifact.markdown, /\[\^1\]\.$/);
  assert.equal(artifact.citations[0].status, 'verified');
  assert.equal(artifact.data, undefined);
  // release notes do not require citations
  const rn = await runRecipe('release-notes', { log: 'x' }, [uncited]).catch((e) => ({ error: e }));
  assert.ok(rn.error, 'gitlog needs {root, range}');
});

test('engine errors save an error artifact and emit error with it', async () => {
  const { error, events } = await runRecipe('prd', { idea: 'x' }, [new Error('claude exploded')]);
  assert.match(error.message, /claude exploded/);
  const ev = events.at(-1);
  assert.equal(ev.type, 'error');
  assert.equal(ev.artifact.status, 'error');
  assert.equal(studio.getArtifact(nb, ev.artifact.id).error, 'claude exploded');
});

test('artifact inputs set the parent and inline the earlier artifact', async () => {
  const prd = (await runRecipe('prd', { idea: 'A thing' }, ['# Seed PRD\n\nA body that is comfortably long enough to pass the length check for documents, with a cite [[docs/intro.md|"Welcome."]].'])).artifact;
  const plan = { title: 'Plan', goal: 'Do it', phases: [{ name: 'P1', tasks: [{ id: 'T1', title: 'Add Foo', detail: 'Extend [[src/java/net/x/Foo.java#L3]]', files: ['src/java/net/x/Foo.java'], dependsOn: [], acceptance: ['compiles', 'test passes'], ref: 'src/java/net/x/Foo.java#L3' }] }] };
  const { artifact, calls } = await runRecipe('impl-plan', { source: prd.id }, [fence(plan, 'Approach.')]);
  assert.equal(artifact.parent, prd.id);
  assert.match(calls[0].question, /# Seed PRD/);
  assert.equal(artifact.data.phases[0].tasks[0].detail, 'Extend [^1]');
  assert.deepEqual(artifact.data.phases[0].tasks[0].files, ['src/java/net/x/Foo.java']);

  // checkbox state persists through PATCH and shows in the markdown export
  studio.patchArtifact(nb, artifact.id, { checked: { 'T1#0': true } });
  let md = studio.exportArtifact(studio.getArtifact(nb, artifact.id), 'markdown');
  assert.match(md.text, /- \[ \] \*\*T1: Add Foo\*\*/);
  assert.match(md.text, /  - \[x\] compiles\n  - \[ \] test passes/);
  studio.patchArtifact(nb, artifact.id, { checked: { 'T1#1': true } });
  md = studio.exportArtifact(studio.getArtifact(nb, artifact.id), 'markdown');
  assert.match(md.text, /- \[x\] \*\*T1: Add Foo\*\*/);
  const issues = studio.exportArtifact(artifact, 'issues');
  assert.match(issues.text, /gh issue create --title 'T1: Add Foo' --body '/);
  assert.match(issues.text, /never runs it/);
  assert.equal(issues.filename, 'plan-issues.md');
});

test('exports for graph, sequence, quiz and doc', async () => {
  const { artifact: g } = await runRecipe('code-map', { root: 'code' }, [fence(goodGraph)]);
  const mm = studio.exportArtifact(g, 'mermaid').text;
  assert.match(mm, /^flowchart TD\n/);
  assert.match(mm, /n0_pkg\[\["net\.x"\]\]/);
  assert.match(mm, /n0_pkg -->\|"contains"\| n1_foo/);
  assert.equal(JSON.parse(studio.exportArtifact(g, 'json').text).data.nodes.length, 3);
  assert.throws(() => studio.exportArtifact(g, 'issues'), /export as mermaid, json/);

  const seq = { title: 'Flow', actors: [{ id: 'ui', label: 'UI' }, { id: 'srv', label: 'Server' }], steps: [{ from: 'ui', to: 'srv', label: 'send', async: true, note: 'over the wire [[docs/intro.md|"Welcome."]]' }, { from: 'srv', to: 'srv', label: 'handle' }] };
  const { artifact: s } = await runRecipe('sequence-diagram', { feature: 'x' }, [fence(seq, 'Flow.')]);
  const smm = studio.exportArtifact(s, 'mermaid').text;
  assert.match(smm, /participant n0_ui as UI/);
  assert.match(smm, /n0_ui-\)n1_srv: send/);
  assert.match(smm, /Note over n0_ui,n1_srv: over the wire/);
  assert.match(smm, /n1_srv->>n1_srv: handle/);

  const quiz = { title: 'Quiz', questions: Array.from({ length: 5 }, (_, i) => ({ id: `q${i}`, q: `Q${i}?`, kind: 'single', options: ['a', 'b'], answer: 'b', explain: 'Because [[docs/intro.md|"Welcome."]]' })) };
  const { artifact: qz } = await runRecipe('agent-quiz', {}, [fence(quiz, 'Quiz.')]);
  const ev = JSON.parse(studio.exportArtifact(qz, 'json').text);
  assert.equal(ev.items.length, 5);
  assert.equal(ev.items[0].answer, 'b');
  assert.equal(ev.items[0].sources[0].path, 'docs/intro.md');

  const doc = studio.getArtifact(nb, studio.listArtifacts(nb).find((a) => a.kind === 'doc' && a.status === 'ok').id);
  const dm = studio.exportArtifact(doc, 'markdown');
  assert.match(dm.text, /\[\^1\]: docs\//);
  assert.ok(dm.filename.endsWith('.md'));
});

test('file artifacts write only inside the notebook or a root, and never overwrite silently', async () => {
  const content = '# CLAUDE.md\n\nRules.\n';
  const { artifact } = await runRecipe('claude-md', { root: 'code' }, [fence({ filename: 'CLAUDE.md', language: 'markdown', content, notes: 'Rules come from the intro [[docs/intro.md|"Welcome."]]' }, 'Memory file.')]);
  assert.equal(artifact.status, 'ok');
  assert.equal(artifact.data.content, content);
  assert.equal(artifact.data.notes, 'Rules come from the intro [^1]');
  assert.equal(studio.defaultWritePath(nb, artifact), 'code/CLAUDE.md');
  const w = studio.writeArtifactFile(nb, artifact, {});
  assert.equal(w.path, path.join(env.nbDir, 'src', 'java', 'CLAUDE.md').replace(/\\/g, '/'));
  assert.equal(fs.readFileSync(w.path, 'utf8'), content);
  assert.throws(() => studio.writeArtifactFile(nb, artifact, {}), (e) => e.status === 409 && e.exists);
  studio.writeArtifactFile(nb, artifact, { overwrite: true, content: 'edited\n' });
  assert.equal(fs.readFileSync(w.path, 'utf8'), 'edited\n');
  assert.throws(() => studio.writeArtifactFile(nb, artifact, { path: '../outside.md' }), (e) => e.status === 403);
  assert.throws(() => studio.writeArtifactFile(nb, artifact, { path: path.join(env.root, 'x.md') }), (e) => e.status === 403);
  assert.throws(() => studio.writeArtifactFile(nb, artifact, { path: 'code/../../../x.md' }), (e) => e.status === 403);
  const nested = studio.writeArtifactFile(nb, artifact, { path: 'agents/new/CLAUDE.md' });
  assert.ok(fs.existsSync(nested.path));
  assert.equal(studio.getArtifact(nb, artifact.id).writtenTo, nested.path);
});

test('list, patch and delete', async () => {
  const list = studio.listArtifacts(nb);
  assert.ok(list.length >= 5);
  assert.ok(list.every((a) => a.id && a.recipe && a.status && a.createdAt));
  const id = list[0].id;
  assert.equal(studio.patchArtifact(nb, id, { title: 'Renamed' }).title, 'Renamed');
  assert.equal(studio.deleteArtifact(nb, id), true);
  assert.equal(studio.getArtifact(nb, id), null);
  assert.equal(studio.deleteArtifact(nb, id), false);
  assert.throws(() => studio.getArtifact(nb, '../x'), /bad artifact id/);
});

test('artifact summaries carry citation status counts and item sizes', () => {
  const cites = [{ status: 'verified' }, { status: 'verified' }, { status: 'moved' }, { status: 'unverified' }, { status: 'pending' }];
  const graph = studio.summarizeArtifact({ id: 'a', kind: 'graph', recipe: 'code-map', citations: cites, data: { nodes: [{}, {}, {}], edges: [{}] } });
  assert.deepEqual(graph.cites, { verified: 2, moved: 1, unverified: 1 });
  assert.deepEqual(graph.size, [{ n: 3, unit: 'nodes' }, { n: 1, unit: 'edges' }]);
  const doc = studio.summarizeArtifact({ id: 'b', kind: 'doc', markdown: '# T\n\n## One\n\ntext\n\n## Two\n\n### sub\n' });
  assert.deepEqual(doc.size, [{ n: 2, unit: 'sections' }]);
  assert.deepEqual(doc.cites, { verified: 0, moved: 0, unverified: 0 });
  const plan = studio.summarizeArtifact({ id: 'c', kind: 'plan', data: { phases: [{ tasks: [{}, {}] }, { tasks: [{}] }] } });
  assert.deepEqual(plan.size, [{ n: 2, unit: 'phases' }, { n: 3, unit: 'tasks' }]);
  const cards = studio.summarizeArtifact({ id: 'd', kind: 'quiz', recipe: 'flashcards', data: { questions: [{}, {}] } });
  assert.deepEqual(cards.size, [{ n: 2, unit: 'cards' }]);
  const broken = studio.summarizeArtifact({ id: 'e', kind: 'graph', status: 'invalid', data: null });
  assert.deepEqual(broken.size, [{ n: 0, unit: 'nodes' }, { n: 0, unit: 'edges' }]);
});
