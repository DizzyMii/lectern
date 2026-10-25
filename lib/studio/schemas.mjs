// Output contracts and hand-written validators for each Studio artifact kind.

export const KINDS = ['doc', 'graph', 'sequence', 'plan', 'quiz', 'file'];

export const NODE_KINDS = ['package', 'class', 'interface', 'event', 'concept', 'step', 'decision', 'external'];

// The text appended to every structured prompt. It is what the validators below enforce.
export const CONTRACTS = {
  doc: `Output contract: reply with the document itself as GitHub-flavoured markdown. Start with a single "# " title line. Use "## " sections, tables and fenced code blocks where they help. Do not wrap the document in a code fence and do not add any JSON. Every factual claim carries a citation.`,

  graph: `Output contract: first write two to four sentences of plain markdown saying what the graph shows and what to look at first, with citations. Then write exactly one fenced \`\`\`json block, and nothing after it, holding one object of this shape:
{
  "title": string,
  "layout": "layered" | "radial",
  "nodes": [ { "id": string, "label": string, "kind"?: string, "group"?: string, "detail"?: string, "ref"?: "path#L12" } ],
  "edges": [ { "from": node id, "to": node id, "label"?: string, "kind"?: string } ]
}
Rules: 3 to 120 nodes; ids are short, unique and contain no spaces; every edge's "from" and "to" is an existing node id; no edge from a node to itself. "kind" is one of package, class, interface, event, concept, step, decision, external. "label" is at most 40 characters. "detail" is one to three sentences and may contain citations. "ref" is a plain path#L12 or path#L12-L20 (same path rules as citations, no brackets) pointing at the line that defines the node. The JSON must parse: double quotes, no comments, no trailing commas.`,

  sequence: `Output contract: first write two to four sentences of plain markdown summarising the interaction, with citations. Then write exactly one fenced \`\`\`json block, and nothing after it, holding one object of this shape:
{
  "title": string,
  "actors": [ { "id": string, "label": string, "kind"?: string } ],
  "steps": [ { "from": actor id, "to": actor id, "label": string, "note"?: string, "ref"?: "path#L12", "async"?: boolean } ]
}
Rules: 2 to 12 actors with unique ids; 1 to 60 steps in time order; every "from" and "to" is an existing actor id ("from" may equal "to" for a self call). "label" is a short message or call name, at most 60 characters. "note" may contain citations. "ref" is a plain path#L12 (no brackets). "async": true for one-way messages, events and callbacks. The JSON must parse: double quotes, no comments, no trailing commas.`,

  plan: `Output contract: first write two to four sentences of plain markdown on the approach and the main risk, with citations. Then write exactly one fenced \`\`\`json block, and nothing after it, holding one object of this shape:
{
  "title": string,
  "goal": string,
  "phases": [ { "name": string, "tasks": [ {
    "id": string, "title": string, "detail": string, "files": [string], "dependsOn": [task id],
    "ref"?: "path#L12", "estimate"?: "S" | "M" | "L", "acceptance": [string]
  } ] } ]
}
Rules: at least one phase, every phase has at least one task; task ids are unique across the whole plan (T1, T2, ...); "dependsOn" only names task ids that exist, never the task itself, and never forms a cycle; "files" lists the paths the task creates or changes (may be empty); "acceptance" has at least one checkable statement. "detail" may contain citations. "ref" is a plain path#L12 (no brackets). The JSON must parse: double quotes, no comments, no trailing commas.`,

  quiz: `Output contract: first write one or two sentences of plain markdown on what the quiz covers. Then write exactly one fenced \`\`\`json block, and nothing after it, holding one object of this shape:
{
  "title": string,
  "questions": [ { "id": string, "q": string, "kind": "single" | "multi" | "short", "options"?: [string], "answer": string | [string], "explain": string, "ref"?: "path#L12" } ]
}
Rules: 5 to 40 questions with unique ids. "single": 2 to 6 options and "answer" is a string equal to one option. "multi": 2 to 8 options and "answer" is an array of one or more option strings. "short": no options and "answer" is a short string. "explain" says why, and carries a citation. "ref" is only for code: a plain path#L12 (no brackets) with a line number. When the proof is in a doc, leave "ref" out and put the [[path|"quote"]] citation in "explain". The JSON must parse: double quotes, no comments, no trailing commas.`,

  file: `Output contract: first write one or two sentences of plain markdown on what the file is for. Then write exactly one fenced \`\`\`json block, and nothing after it, holding one object of this shape:
{ "filename": string, "language": string, "content": string, "notes"?: string }
Rules: "content" is the complete file, ready to save, with newlines escaped as \\n inside the JSON string. "filename" is a bare file name, no directories. "language" is a highlight.js language name such as markdown, json or yaml. Citations go in "notes" and the opening sentences, never inside "content", and they use the [[...]] forms from the citation rule, not bare path#L12 lists. Keep "notes" to three to six short lines, each claim followed by its [[...]] citation. The JSON must parse: double quotes, no comments, no trailing commas.`,
};

// ---------- JSON extraction ----------

// Finds the single ```json block. Returns { json, before, after, error }.
export function extractJson(text) {
  const src = String(text ?? '');
  // Fences must start a line. Inside a JSON string a newline is always the \n escape, so a ``` in
  // file content (a markdown code fence in AGENTS.md) can never open or close the block.
  let blocks = [...src.matchAll(/^[ \t]*```json[^\n]*\n([\s\S]*?)\r?\n[ \t]*```[ \t]*\r?$/gm)];
  if (blocks.length === 0) blocks = [...src.matchAll(/```json[^\n]*\n([\s\S]*?)\n?```/g)];
  if (blocks.length === 0) {
    // tolerate a bare object when the model skipped the fence
    const t = src.trim();
    if (t.startsWith('{') && t.endsWith('}')) {
      try { return { json: JSON.parse(t), before: '', after: '', error: null }; } catch {}
    }
    return { json: null, before: src, after: '', error: 'the answer has no ```json block' };
  }
  if (blocks.length > 1) return { json: null, before: src, after: '', error: `the answer has ${blocks.length} \`\`\`json blocks, expected exactly one` };
  const b = blocks[0];
  const before = src.slice(0, b.index).trim();
  const after = src.slice(b.index + b[0].length).trim();
  try {
    return { json: JSON.parse(b[1]), before, after, error: null };
  } catch (e) {
    return { json: null, before, after, error: `the json block does not parse: ${e.message}` };
  }
}

// ---------- validators ----------

const isStr = (v) => typeof v === 'string';
const nonEmpty = (v) => isStr(v) && v.trim().length > 0;
const REF_RE = /^[^\s#\[\]|]+#L\d+(-L?\d+)?$/;

function checker() {
  const errors = [];
  const add = (where, msg) => { if (errors.length < 40) errors.push(`${where}: ${msg}`); };
  return { errors, add };
}

function str(c, obj, key, where, { required = true, max } = {}) {
  const v = obj?.[key];
  if (v == null) { if (required) c.add(where, `"${key}" is required`); return; }
  if (!isStr(v)) return c.add(where, `"${key}" must be a string`);
  if (required && !v.trim()) return c.add(where, `"${key}" must not be empty`);
  if (max && v.length > max) c.add(where, `"${key}" is ${v.length} characters, max ${max}`);
}

function ref(c, obj, where) {
  if (obj?.ref == null || obj.ref === '') return;
  if (!isStr(obj.ref) || !REF_RE.test(obj.ref.trim())) c.add(where, `"ref" must look like path#L12 or path#L12-L20, got ${JSON.stringify(obj.ref)}`);
}

function arr(c, obj, key, where, { min = 0, max = Infinity, required = true } = {}) {
  const v = obj?.[key];
  if (v == null) { if (required) c.add(where, `"${key}" is required`); return null; }
  if (!Array.isArray(v)) { c.add(where, `"${key}" must be an array`); return null; }
  if (v.length < min) c.add(where, `"${key}" has ${v.length} items, needs at least ${min}`);
  if (v.length > max) c.add(where, `"${key}" has ${v.length} items, max ${max}`);
  return v;
}

function root(c, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) { c.add('root', 'must be a JSON object'); return false; }
  return true;
}

function uniqueIds(c, list, where) {
  const seen = new Set();
  list.forEach((x, i) => {
    const id = x?.id;
    if (!nonEmpty(id)) return c.add(`${where}[${i}]`, '"id" is required');
    if (seen.has(id)) c.add(`${where}[${i}]`, `duplicate id "${id}"`);
    seen.add(id);
  });
  return seen;
}

export function validateGraph(data) {
  const c = checker();
  if (!root(c, data)) return c.errors;
  str(c, data, 'title', 'root');
  if (data.layout != null && !['layered', 'radial'].includes(data.layout)) c.add('root', '"layout" must be "layered" or "radial"');
  if (data.layout == null) c.add('root', '"layout" is required');
  const nodes = arr(c, data, 'nodes', 'root', { min: 3, max: 120 }) ?? [];
  const edges = arr(c, data, 'edges', 'root') ?? [];
  nodes.forEach((n, i) => {
    const w = `nodes[${i}]`;
    if (!n || typeof n !== 'object') return c.add(w, 'must be an object');
    str(c, n, 'label', w, { max: 80 });
    for (const k of ['kind', 'group', 'detail']) str(c, n, k, w, { required: false });
    ref(c, n, w);
  });
  const ids = uniqueIds(c, nodes.filter((n) => n && typeof n === 'object'), 'nodes');
  edges.forEach((e, i) => {
    const w = `edges[${i}]`;
    if (!e || typeof e !== 'object') return c.add(w, 'must be an object');
    if (!ids.has(e.from)) c.add(w, `"from" ${JSON.stringify(e.from)} is not a node id`);
    if (!ids.has(e.to)) c.add(w, `"to" ${JSON.stringify(e.to)} is not a node id`);
    if (e.from != null && e.from === e.to) c.add(w, 'an edge must not point at its own node');
    for (const k of ['label', 'kind']) str(c, e, k, w, { required: false });
  });
  return c.errors;
}

export function validateSequence(data) {
  const c = checker();
  if (!root(c, data)) return c.errors;
  str(c, data, 'title', 'root');
  const actors = arr(c, data, 'actors', 'root', { min: 2, max: 12 }) ?? [];
  const steps = arr(c, data, 'steps', 'root', { min: 1, max: 60 }) ?? [];
  actors.forEach((a, i) => {
    if (!a || typeof a !== 'object') return c.add(`actors[${i}]`, 'must be an object');
    str(c, a, 'label', `actors[${i}]`);
    str(c, a, 'kind', `actors[${i}]`, { required: false });
  });
  const ids = uniqueIds(c, actors.filter((a) => a && typeof a === 'object'), 'actors');
  steps.forEach((s, i) => {
    const w = `steps[${i}]`;
    if (!s || typeof s !== 'object') return c.add(w, 'must be an object');
    if (!ids.has(s.from)) c.add(w, `"from" ${JSON.stringify(s.from)} is not an actor id`);
    if (!ids.has(s.to)) c.add(w, `"to" ${JSON.stringify(s.to)} is not an actor id`);
    str(c, s, 'label', w);
    str(c, s, 'note', w, { required: false });
    if (s.async != null && typeof s.async !== 'boolean') c.add(w, '"async" must be true or false');
    ref(c, s, w);
  });
  return c.errors;
}

export function validatePlan(data) {
  const c = checker();
  if (!root(c, data)) return c.errors;
  str(c, data, 'title', 'root');
  str(c, data, 'goal', 'root');
  const phases = arr(c, data, 'phases', 'root', { min: 1 }) ?? [];
  const tasks = [];
  phases.forEach((p, i) => {
    const w = `phases[${i}]`;
    if (!p || typeof p !== 'object') return c.add(w, 'must be an object');
    str(c, p, 'name', w);
    const ts = arr(c, p, 'tasks', w, { min: 1 }) ?? [];
    ts.forEach((t, j) => {
      const tw = `${w}.tasks[${j}]`;
      if (!t || typeof t !== 'object') return c.add(tw, 'must be an object');
      tasks.push({ t, w: tw });
      str(c, t, 'title', tw);
      str(c, t, 'detail', tw);
      const files = arr(c, t, 'files', tw);
      files?.forEach((f, k) => { if (!isStr(f)) c.add(tw, `files[${k}] must be a string`); });
      const deps = arr(c, t, 'dependsOn', tw);
      deps?.forEach((d, k) => { if (!isStr(d)) c.add(tw, `dependsOn[${k}] must be a task id string`); });
      const acc = arr(c, t, 'acceptance', tw, { min: 1 });
      acc?.forEach((a, k) => { if (!nonEmpty(a)) c.add(tw, `acceptance[${k}] must be a non-empty string`); });
      if (t.estimate != null && !['S', 'M', 'L'].includes(t.estimate)) c.add(tw, '"estimate" must be "S", "M" or "L"');
      ref(c, t, tw);
    });
  });
  const ids = uniqueIds(c, tasks.map((x) => x.t), 'tasks');
  for (const { t, w } of tasks) {
    for (const d of Array.isArray(t.dependsOn) ? t.dependsOn : []) {
      if (d === t.id) c.add(w, `task "${t.id}" depends on itself`);
      else if (isStr(d) && !ids.has(d)) c.add(w, `dependsOn names "${d}", which is not a task id`);
    }
  }
  // cycle check over the dependency graph
  const deps = new Map(tasks.map(({ t }) => [t.id, (Array.isArray(t.dependsOn) ? t.dependsOn : []).filter((d) => ids.has(d) && d !== t.id)]));
  const state = new Map();
  const visit = (id, trail) => {
    if (state.get(id) === 2) return false;
    if (state.get(id) === 1) { c.add('tasks', `dependency cycle: ${[...trail, id].join(' -> ')}`); return true; }
    state.set(id, 1);
    for (const d of deps.get(id) ?? []) if (visit(d, [...trail, id])) return true;
    state.set(id, 2);
    return false;
  };
  for (const id of deps.keys()) if (visit(id, [])) break;
  return c.errors;
}

export function validateQuiz(data) {
  const c = checker();
  if (!root(c, data)) return c.errors;
  str(c, data, 'title', 'root');
  const qs = arr(c, data, 'questions', 'root', { min: 5, max: 40 }) ?? [];
  qs.forEach((q, i) => {
    const w = `questions[${i}]`;
    if (!q || typeof q !== 'object') return c.add(w, 'must be an object');
    str(c, q, 'q', w);
    str(c, q, 'explain', w);
    ref(c, q, w);
    if (!['single', 'multi', 'short'].includes(q.kind)) return c.add(w, '"kind" must be "single", "multi" or "short"');
    if (q.kind === 'short') {
      if (q.options != null && (!Array.isArray(q.options) || q.options.length)) c.add(w, 'a "short" question has no options');
      if (!nonEmpty(q.answer)) c.add(w, 'a "short" question needs a non-empty string "answer"');
      return;
    }
    const opts = arr(c, q, 'options', w, { min: 2, max: q.kind === 'single' ? 6 : 8 });
    if (!opts) return;
    if (opts.some((o) => !nonEmpty(o))) return c.add(w, 'every option must be a non-empty string');
    if (new Set(opts).size !== opts.length) c.add(w, 'options must be distinct');
    if (q.kind === 'single') {
      if (!isStr(q.answer)) c.add(w, 'a "single" question needs a string "answer"');
      else if (!opts.includes(q.answer)) c.add(w, `"answer" ${JSON.stringify(q.answer)} is not one of the options`);
    } else {
      if (!Array.isArray(q.answer) || !q.answer.length) c.add(w, 'a "multi" question needs an "answer" array with at least one option');
      else for (const a of q.answer) if (!opts.includes(a)) c.add(w, `answer ${JSON.stringify(a)} is not one of the options`);
    }
  });
  uniqueIds(c, qs.filter((q) => q && typeof q === 'object'), 'questions');
  return c.errors;
}

export function validateFile(data) {
  const c = checker();
  if (!root(c, data)) return c.errors;
  str(c, data, 'filename', 'root');
  if (isStr(data.filename) && /[\\/]|^\.\.?$/.test(data.filename)) c.add('root', '"filename" must be a bare file name without directories');
  str(c, data, 'language', 'root');
  str(c, data, 'content', 'root');
  str(c, data, 'notes', 'root', { required: false });
  return c.errors;
}

// doc answers are markdown; citations are counted by the caller after verification
export function validateDoc(markdown, { citations = null } = {}) {
  const c = checker();
  const md = String(markdown ?? '').trim();
  if (md.length < 80) c.add('document', `is only ${md.length} characters`);
  if (!/^#{1,3} \S/m.test(md)) c.add('document', 'has no markdown heading');
  if (md.startsWith('```') && md.endsWith('```')) c.add('document', 'is wrapped in a code fence; reply with plain markdown');
  if (citations != null && citations === 0) c.add('document', 'has no citations; cite the sources with the [[...]] forms');
  return c.errors;
}

const VALIDATORS = { graph: validateGraph, sequence: validateSequence, plan: validatePlan, quiz: validateQuiz, file: validateFile };

// Returns a list of error strings, empty when valid.
export function validate(kind, data, extra = {}) {
  if (kind === 'doc') return validateDoc(data, extra);
  const v = VALIDATORS[kind];
  if (!v) return [`unknown kind ${kind}`];
  return v(data);
}

// Recipe-specific checks on top of the kind contract.
export function validateRecipe(recipe, data) {
  const errors = [];
  if (recipe.id === 'skill' && data && isStr(data.content)) {
    const fm = data.content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) errors.push('content: SKILL.md must start with a --- frontmatter block');
    else {
      const name = fm[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
      const desc = fm[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
      if (!name) errors.push('content: frontmatter needs a "name:" line');
      else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name.replace(/^["']|["']$/g, ''))) errors.push('content: frontmatter "name" must be lowercase words joined by hyphens');
      if (!desc) errors.push('content: frontmatter needs a "description:" line');
    }
  }
  if (recipe.id === 'flashcards' && data && Array.isArray(data.questions)) {
    data.questions.forEach((q, i) => { if (q?.kind !== 'short') errors.push(`questions[${i}]: flashcards are "short" questions only`); });
  }
  if (recipe.layout && data && data.layout && data.layout !== recipe.layout) errors.push(`root: "layout" must be "${recipe.layout}" for this recipe`);
  if (recipe.id === 'flow-diagram' && data && Array.isArray(data.nodes)) {
    if (!data.nodes.some((n) => n?.kind === 'step')) errors.push('nodes: a flow diagram needs nodes of kind "step"');
  }
  return errors;
}
