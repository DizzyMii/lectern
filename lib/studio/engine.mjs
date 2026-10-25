// Runs a Studio recipe through ask(), validates the output, repairs once, and stores the artifact.
import fs from 'node:fs';
import path from 'node:path';
import { ask } from '../engine.mjs';
import { processAnswer, parseCitations, verify, reverify, reverifyRefs, fileCache } from '../cite.mjs';
import { ID_RE, newId, readJson, writeJson, httpError, toPosix, slugify } from '../store.mjs';
import { getRecipe } from './recipes.mjs';
import { resolveInputs } from './inputs.mjs';
import { extractJson, validate, validateRecipe } from './schemas.mjs';

// ---------- artifact store ----------

const artDir = (nb) => path.join(nb.dir, 'artifacts');
const artFile = (nb, id) => {
  if (!ID_RE.test(id ?? '')) throw httpError(400, 'bad artifact id');
  return path.join(artDir(nb), `${id}.json`);
};

// With recheck, the citations and data refs are verified again against the files as they are now.
export function getArtifact(nb, id, { recheck = false } = {}) {
  const a = readJson(artFile(nb, id), null);
  if (!a || !recheck) return a;
  const opts = { cache: fileCache(), at: new Date().toISOString(), since: a.updatedAt ?? a.createdAt ?? null };
  const r = reverify(nb.dir, a.citations, nb.config.roots, opts);
  a.citations = r.citations;
  const refs = a.data && typeof a.data === 'object' ? reverifyRefs(nb.dir, a.data, nb.config.roots, opts) : null;
  a.citeCheck = { ...r.summary, refs: refs?.summary ?? null, changed: r.summary.changed || Boolean(refs?.summary.changed) };
  // only write when a status, line or ref drifted
  if (r.dirty || refs?.dirty) saveArtifact(nb, a);
  return a;
}

export function saveArtifact(nb, a) {
  writeJson(artFile(nb, a.id), a);
  return a;
}

export function deleteArtifact(nb, id) {
  const f = artFile(nb, id);
  if (!fs.existsSync(f)) return false;
  fs.unlinkSync(f);
  return true;
}

export function summarizeArtifact(a) {
  return {
    id: a.id, recipe: a.recipe, title: a.title, kind: a.kind, status: a.status, model: a.model,
    costUsd: a.costUsd ?? null, createdAt: a.createdAt, updatedAt: a.updatedAt ?? a.createdAt, parent: a.parent ?? null,
    citations: a.citations?.length ?? 0,
    // per-status counts and item counts for the printed sheets list
    cites: citeCounts(a.citations),
    size: artifactSize(a),
  };
}

export function citeCounts(cites) {
  const out = { verified: 0, moved: 0, unverified: 0 };
  for (const c of cites ?? []) if (c && out[c.status] != null) out[c.status]++;
  return out;
}

// What the sheet is made of, as [{ n, unit }], e.g. 48 nodes, or 4 phases and 14 tasks.
export function artifactSize(a) {
  const d = a.data ?? {};
  const len = (x) => (Array.isArray(x) ? x.length : 0);
  switch (a.kind) {
    case 'doc': return [{ n: (String(a.markdown ?? '').match(/^## /gm) ?? []).length, unit: 'sections' }];
    case 'graph': return [{ n: len(d.nodes), unit: 'nodes' }, { n: len(d.edges), unit: 'edges' }];
    case 'sequence': return [{ n: len(d.actors), unit: 'actors' }, { n: len(d.steps), unit: 'steps' }];
    case 'plan': return [{ n: len(d.phases), unit: 'phases' }, { n: (d.phases ?? []).reduce((n, p) => n + len(p?.tasks), 0), unit: 'tasks' }];
    case 'quiz': return [{ n: len(d.questions), unit: a.recipe === 'flashcards' ? 'cards' : 'questions' }];
    case 'file': return [{ n: d.content ? String(d.content).split('\n').length : 0, unit: 'lines' }];
    default: return [];
  }
}

export function listArtifacts(nb) {
  let names = [];
  try { names = fs.readdirSync(artDir(nb)).filter((f) => f.endsWith('.json')); } catch { return []; }
  return names.map((f) => readJson(path.join(artDir(nb), f), null)).filter(Boolean).map(summarizeArtifact)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

// title, checked (acceptance checkboxes) and file content are the editable parts
export function patchArtifact(nb, id, body = {}) {
  const a = getArtifact(nb, id);
  if (!a) return null;
  if (typeof body.title === 'string' && body.title.trim()) a.title = body.title.trim().slice(0, 200);
  if (body.checked && typeof body.checked === 'object') {
    a.checked = { ...(a.checked ?? {}) };
    for (const [k, v] of Object.entries(body.checked)) {
      if (typeof k !== 'string' || k.length > 200) continue;
      if (v) a.checked[k] = true; else delete a.checked[k];
    }
  }
  if (typeof body.content === 'string' && a.kind === 'file' && a.data) a.data.content = body.content;
  a.updatedAt = new Date().toISOString();
  return saveArtifact(nb, a);
}

// ---------- citations inside structured data ----------

// fields that are identifiers or must stay byte-equal to other fields
const SKIP = new Set(['id', 'from', 'to', 'dependsOn', 'ref', 'content', 'filename', 'language', 'kind', 'layout', 'group', 'estimate', 'options', 'answer', 'files']);
const SEP = '\n␞\n';

function collectStrings(node, out, key = null) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => {
      if (typeof v === 'string') { if (!SKIP.has(key)) out.push({ obj: node, key: i }); }
      else collectStrings(v, out, key);
    });
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (SKIP.has(k)) continue;
      if (typeof v === 'string') out.push({ obj: node, key: k });
      else collectStrings(v, out, k);
    }
  }
}

function verifyRefs(nb, node) {
  if (Array.isArray(node)) return node.forEach((v) => verifyRefs(nb, v));
  if (!node || typeof node !== 'object') return;
  if (typeof node.ref === 'string' && node.ref.trim()) {
    const c = parseCitations(`[[${node.ref.trim()}]]`)[0];
    if (c) {
      const v = verify(nb.dir, c, nb.config.roots);
      node.refStatus = v.status;
      if (v.status !== 'missing') node.ref = `${v.path}${v.line ? `#L${v.line}${v.endLine && v.endLine !== v.line ? `-L${v.endLine}` : ''}` : ''}`;
    } else node.refStatus = 'missing';
  }
  for (const v of Object.values(node)) if (v && typeof v === 'object') verifyRefs(nb, v);
}

// One numbered citation list across the summary and every string in the data.
export function processStructured(nb, summary, data) {
  const clone = JSON.parse(JSON.stringify(data));
  const slots = [];
  collectStrings(clone, slots);
  const texts = [String(summary ?? ''), ...slots.map((s) => s.obj[s.key])];
  const { answer, citations } = processAnswer(nb.dir, texts.join(SEP), nb.config.roots);
  const parts = answer.split(SEP);
  if (parts.length === texts.length) slots.forEach((s, i) => { s.obj[s.key] = parts[i + 1]; });
  verifyRefs(nb, clone);
  return { summary: parts.length === texts.length ? parts[0].trim() : processAnswer(nb.dir, summary, nb.config.roots).answer.trim(), data: clone, citations };
}

// ---------- evaluation ----------

const stripMarks = (s) => String(s ?? '').replace(/\[\^\d+\]/g, '').replace(/[*_`]/g, '').trim();

// Turns a raw answer into { errors, ...artifact fields }.
export function evaluate(nb, recipe, raw) {
  if (recipe.kind === 'doc') {
    const { answer, citations } = processAnswer(nb.dir, raw, nb.config.roots);
    const errors = validate('doc', answer, { citations: recipe.citeRequired === false ? null : citations.length });
    const heading = answer.match(/^#\s+(.+)$/m)?.[1];
    return { errors, markdown: answer.trim(), summary: '', citations, title: heading ? stripMarks(heading) : recipe.title };
  }
  const x = extractJson(raw);
  if (x.error) return { errors: [x.error], citations: [], summary: '', title: recipe.title };
  const errors = [...validate(recipe.kind, x.json), ...validateRecipe(recipe, x.json)];
  if (errors.length) return { errors, citations: [], summary: '', title: recipe.title };
  const prose = [x.before, x.after].filter(Boolean).join('\n\n');
  const p = processStructured(nb, prose, x.json);
  const title = stripMarks(p.data.title || p.data.filename || recipe.title);
  return { errors: [], data: p.data, summary: p.summary, citations: p.citations, title };
}

export function repairPrompt(recipe, errors, rawForApi) {
  const list = errors.slice(0, 30).map((e) => `- ${e}`).join('\n');
  const prev = rawForApi ? `Your previous answer was:\n<previous>\n${rawForApi}\n</previous>\n\n` : '';
  if (recipe.kind === 'doc') return `${prev}Your document failed validation:\n${list}\nReply with the full corrected document only, as markdown, following the same instructions and citation rules.`;
  return `${prev}Your JSON failed validation:\n${list}\nReply with only the corrected \`\`\`json block. Keep everything that was valid, fix only what the errors name, and follow the same output contract.`;
}

// ---------- run ----------

const addUsage = (a = {}, b = {}) => {
  const out = {};
  for (const k of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) out[k] = (a[k] ?? 0) + (b[k] ?? 0);
  return out;
};
const addCost = (a, b) => (a == null && b == null ? null : Math.round(((a ?? 0) + (b ?? 0)) * 1e7) / 1e7);

function promptCtx(nb) {
  return {
    title: nb.title,
    description: nb.description,
    roots: Object.entries(nb.config.roots ?? {}).map(([name, rel]) => ({ name, path: toPosix(rel), abs: toPosix(path.resolve(nb.dir, rel)) })),
  };
}

// Resolves inputs and builds the prompt. Throws 4xx errors before any stream opens.
export async function prepare(nb, recipeId, rawInputs = {}) {
  const recipe = getRecipe(recipeId);
  if (!recipe) throw httpError(400, `unknown recipe ${recipeId}`);
  const { values, parent } = await resolveInputs(nb, recipe, rawInputs, { getArtifact });
  const prompt = recipe.prompt(values, promptCtx(nb));
  return { recipe, values, parent, prompt, rawInputs: rawInputs ?? {} };
}

// Runs a prepared recipe. Events: phase{name}, delta, tool, tool_result, done{artifact}, error{message, artifact?}.
export function run(nb, prepared, { model = 'opus', effort, maxTurns, engine = 'claude-code', onEvent = () => {}, artifactId, askImpl = ask } = {}) {
  const { recipe, parent, prompt, rawInputs } = prepared;
  const startedAt = Date.now();
  let cancelled = false;
  let job = null;
  const emit = (e) => { try { onEvent(e); } catch {} };
  const forward = (e) => { if (e.type !== 'done' && e.type !== 'error') emit(e); };
  const turn = async (question, resume) => {
    if (cancelled) throw new Error('cancelled');
    job = askImpl({ notebook: nb, question, model, effort, maxTurns, engine, persist: false, kind: `studio:${recipe.id}`, onEvent: forward, resume });
    return job.done;
  };

  const base = (existing) => ({
    id: artifactId ?? newId(), recipe: recipe.id, kind: recipe.kind, inputs: rawInputs, model, engine,
    parent: parent ?? null, createdAt: existing?.createdAt ?? new Date(startedAt).toISOString(),
  });

  const done = (async () => {
    const existing = artifactId ? getArtifact(nb, artifactId) : null;
    const attempts = [];
    let usage = {}, costUsd = null, toolCalls = [];
    emit({ type: 'phase', name: 'generate' });
    let out;
    try {
      out = await turn(prompt);
    } catch (e) {
      if (cancelled) throw e;
      const a = saveArtifact(nb, { ...base(existing), title: recipe.title, status: 'error', error: e.message, summary: '', citations: [], usage, costUsd, attempts, updatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - startedAt) / 100) / 10 });
      throw Object.assign(e, { artifact: a });
    }
    usage = addUsage(usage, out.usage); costUsd = addCost(costUsd, out.costUsd); toolCalls = out.toolCalls ?? [];
    let raw = out.rawAnswer ?? out.answer ?? '';
    let ev = evaluate(nb, recipe, raw);
    // test hook: fail the first validation so the repair path runs against a live engine
    if (process.env.LECTERN_STUDIO_FORCE_REPAIR === '1' && !ev.errors.length) ev = { ...ev, errors: ['forced repair (LECTERN_STUDIO_FORCE_REPAIR test hook): resend the same content unchanged'] };
    attempts.push({ phase: 'generate', errors: ev.errors, costUsd: out.costUsd ?? null, seconds: out.seconds ?? null });
    if (ev.errors.length) {
      emit({ type: 'phase', name: 'repair', errors: ev.errors });
      let rep = null;
      try {
        const viaSession = Boolean(out.sessionId) && engine !== 'api';
        rep = await turn(repairPrompt(recipe, ev.errors, viaSession ? null : raw), viaSession ? { sessionId: out.sessionId, costUsd: out.sessionCostUsd ?? null } : undefined);
      } catch (e) {
        if (cancelled) throw e;
        attempts.push({ phase: 'repair', errors: [`repair turn failed: ${e.message}`], costUsd: null, seconds: null });
      }
      if (rep) {
        usage = addUsage(usage, rep.usage); costUsd = addCost(costUsd, rep.costUsd); toolCalls = [...toolCalls, ...(rep.toolCalls ?? [])];
        const repRaw = rep.rawAnswer ?? rep.answer ?? '';
        const ev2 = evaluate(nb, recipe, repRaw);
        attempts.push({ phase: 'repair', errors: ev2.errors, costUsd: rep.costUsd ?? null, seconds: rep.seconds ?? null });
        // a json-only repair drops the prose, so keep the first answer's summary
        if (!ev2.errors.length && !ev2.summary && recipe.kind !== 'doc') {
          const first = extractJson(raw);
          if (first.before || first.after) ev2.summary = processStructured(nb, [first.before, first.after].filter(Boolean).join('\n\n'), {}).summary;
        }
        raw = ev2.errors.length ? `${raw}\n\n--- repair attempt ---\n\n${repRaw}` : repRaw;
        ev = ev2;
      }
    }
    emit({ type: 'phase', name: 'save' });
    const ok = !ev.errors.length;
    const artifact = {
      ...base(existing),
      title: ev.title,
      status: ok ? 'ok' : 'invalid',
      summary: ev.summary ?? '',
      ...(recipe.kind === 'doc' ? { markdown: ev.markdown ?? '' } : { data: ok ? ev.data : null }),
      citations: ev.citations ?? [],
      ...(ok ? {} : { errors: ev.errors, raw }),
      attempts,
      toolCalls: toolCalls.map(({ id, name, summary, ok: tok, chars }) => ({ id, name, summary, ok: tok, chars })),
      usage, costUsd,
      seconds: Math.round((Date.now() - startedAt) / 100) / 10,
      updatedAt: new Date().toISOString(),
    };
    return saveArtifact(nb, artifact);
  })().then(
    (artifact) => { emit({ type: 'done', artifact }); return artifact; },
    (err) => { emit({ type: 'error', message: err.message, ...(err.artifact ? { artifact: err.artifact } : {}) }); throw err; },
  );
  done.catch(() => {});

  return {
    done,
    cancel() { cancelled = true; job?.cancel(); },
  };
}

// prepare + run in one call, for the CLI and tests
export async function generate(nb, recipeId, inputs, opts = {}) {
  return run(nb, await prepare(nb, recipeId, inputs), opts);
}

// ---------- export ----------

export const EXPORTS = {
  doc: ['markdown'],
  graph: ['mermaid', 'json'],
  sequence: ['mermaid', 'json'],
  plan: ['markdown', 'issues', 'json'],
  quiz: ['json', 'markdown'],
  file: ['raw'],
};

const plain = (s) => stripMarks(s);
const mmId = (s, i) => `n${i}_${String(s).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 30)}`;
const mmText = (s) => plain(s).replace(/"/g, '#quot;').replace(/[\r\n]+/g, ' ');

function footnotes(citations = []) {
  return citations.map((c) => `[^${c.n}]: ${c.path}${c.line ? `:${c.line}${c.endLine && c.endLine !== c.line ? `-${c.endLine}` : ''}` : ''}${c.quote ? ` "${c.quote}"` : ''} (${c.status})`).join('\n');
}

export function graphMermaid(g) {
  const ids = new Map(g.nodes.map((n, i) => [n.id, mmId(n.id, i)]));
  const lines = [`flowchart ${g.layout === 'radial' ? 'LR' : 'TD'}`];
  for (const n of g.nodes) {
    const shape = n.kind === 'decision' ? [`{"`, `"}`] : n.kind === 'package' ? [`[["`, `"]]`] : n.kind === 'external' ? [`[/"`, `"/]`] : [`["`, `"]`];
    lines.push(`  ${ids.get(n.id)}${shape[0]}${mmText(n.label)}${shape[1]}`);
  }
  for (const e of g.edges) {
    const arrow = e.kind === 'cycle' ? '==>' : '-->';
    lines.push(`  ${ids.get(e.from)} ${arrow}${e.label ? `|"${mmText(e.label)}"|` : ''} ${ids.get(e.to)}`);
  }
  const kinds = [...new Set(g.nodes.map((n) => n.kind).filter(Boolean))];
  for (const k of kinds) lines.push(`  class ${g.nodes.filter((n) => n.kind === k).map((n) => ids.get(n.id)).join(',')} k_${k.replace(/\W/g, '_')}`);
  return lines.join('\n') + '\n';
}

export function sequenceMermaid(s) {
  const ids = new Map(s.actors.map((a, i) => [a.id, mmId(a.id, i)]));
  const lines = ['sequenceDiagram'];
  for (const a of s.actors) lines.push(`  participant ${ids.get(a.id)} as ${plain(a.label).replace(/[\r\n;]+/g, ' ')}`);
  for (const st of s.steps) {
    const f = ids.get(st.from), t = ids.get(st.to);
    lines.push(`  ${f}${st.async ? '-)' : '->>'}${t}: ${plain(st.label).replace(/[\r\n;#]+/g, ' ')}`);
    if (st.note) lines.push(`  Note over ${f === t ? f : `${f},${t}`}: ${plain(st.note).replace(/[\r\n;#]+/g, ' ')}`);
  }
  return lines.join('\n') + '\n';
}

function planMarkdown(a) {
  const p = a.data;
  const checked = a.checked ?? {};
  const out = [`# ${plain(p.title)}`, '', `> ${plain(p.goal)}`, ''];
  for (const ph of p.phases) {
    out.push(`## ${plain(ph.name)}`, '');
    for (const t of ph.tasks) {
      const allDone = t.acceptance.length && t.acceptance.every((_, i) => checked[`${t.id}#${i}`]);
      const meta = [t.estimate, t.dependsOn?.length ? `after ${t.dependsOn.join(', ')}` : null].filter(Boolean).join(', ');
      out.push(`- [${allDone ? 'x' : ' '}] **${t.id}: ${plain(t.title)}**${meta ? ` (${meta})` : ''}`);
      out.push(`  ${plain(t.detail)}`);
      if (t.files?.length) out.push(`  Files: ${t.files.map((f) => `\`${f}\``).join(', ')}`);
      t.acceptance.forEach((x, i) => out.push(`  - [${checked[`${t.id}#${i}`] ? 'x' : ' '}] ${plain(x)}`));
    }
    out.push('');
  }
  return out.join('\n');
}

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function planIssues(a) {
  const p = a.data;
  const bodies = [];
  const script = ['#!/usr/bin/env sh', '# Creates one GitHub issue per plan task in the current repository.', '# Read it before running it. The notebook app never runs it.', 'set -e', ''];
  for (const ph of p.phases) {
    for (const t of ph.tasks) {
      const body = [
        plain(t.detail), '',
        t.files?.length ? `**Files:** ${t.files.map((f) => `\`${f}\``).join(', ')}` : '',
        t.dependsOn?.length ? `**Depends on:** ${t.dependsOn.join(', ')}` : '',
        t.estimate ? `**Estimate:** ${t.estimate}` : '',
        '', '**Acceptance**', ...t.acceptance.map((x) => `- [ ] ${plain(x)}`), '',
        `Phase: ${plain(ph.name)}. From the plan "${plain(p.title)}".`,
      ].filter((l, i, arr) => l !== '' || arr[i - 1] !== '').join('\n');
      bodies.push(`## ${t.id}: ${plain(t.title)}\n\n${body}\n`);
      script.push(`gh issue create --title ${shq(`${t.id}: ${plain(t.title)}`)} --body ${shq(body)}`);
    }
  }
  return `# Issues for: ${plain(p.title)}\n\n${bodies.join('\n')}\n## Script\n\n\`\`\`sh\n${script.join('\n')}\n\`\`\`\n`;
}

function quizEval(a) {
  return JSON.stringify({
    title: plain(a.data.title), source: { artifact: a.id, recipe: a.recipe },
    items: a.data.questions.map((q) => ({
      id: q.id, question: plain(q.q), kind: q.kind, ...(q.options ? { options: q.options } : {}), answer: q.answer, explain: plain(q.explain),
      ref: q.ref ?? null,
      sources: [...String(q.explain).matchAll(/\[\^(\d+)\]/g)].map((m) => a.citations.find((c) => c.n === Number(m[1]))).filter(Boolean).map((c) => ({ path: c.path, line: c.line, endLine: c.endLine, quote: c.quote })),
    })),
  }, null, 2) + '\n';
}

function quizMarkdown(a) {
  const out = [`# ${plain(a.data.title)}`, ''];
  a.data.questions.forEach((q, i) => {
    out.push(`## ${i + 1}. ${plain(q.q)}`, '');
    if (q.options) q.options.forEach((o) => out.push(`- ${o}`));
    out.push('', `**Answer:** ${Array.isArray(q.answer) ? q.answer.join('; ') : q.answer}`, '', plain(q.explain), '');
  });
  return out.join('\n');
}

export function exportArtifact(a, format) {
  if (a.status !== 'ok') throw httpError(409, `artifact is ${a.status}; regenerate it before exporting`);
  const formats = EXPORTS[a.kind] ?? [];
  const f = format || formats[0];
  if (!formats.includes(f)) throw httpError(400, `${a.kind} artifacts export as ${formats.join(', ')}`);
  const slug = slugify(a.title);
  switch (`${a.kind}:${f}`) {
    case 'doc:markdown': return { text: `${a.markdown.trim()}\n\n${footnotes(a.citations)}\n`, filename: `${slug}.md`, mime: 'text/markdown' };
    case 'graph:mermaid': return { text: graphMermaid(a.data), filename: `${slug}.mmd`, mime: 'text/plain' };
    case 'sequence:mermaid': return { text: sequenceMermaid(a.data), filename: `${slug}.mmd`, mime: 'text/plain' };
    case 'plan:markdown': return { text: planMarkdown(a), filename: `${slug}.md`, mime: 'text/markdown' };
    case 'plan:issues': return { text: planIssues(a), filename: `${slug}-issues.md`, mime: 'text/markdown' };
    case 'quiz:json': return { text: quizEval(a), filename: `${slug}.eval.json`, mime: 'application/json' };
    case 'quiz:markdown': return { text: quizMarkdown(a), filename: `${slug}.md`, mime: 'text/markdown' };
    case 'file:raw': return { text: a.data.content, filename: a.data.filename, mime: 'text/plain' };
    default: return { text: JSON.stringify({ title: a.title, summary: a.summary, data: a.data, citations: a.citations }, null, 2) + '\n', filename: `${slug}.json`, mime: 'application/json' };
  }
}

// ---------- write (file kind) ----------

const inside = (base, target) => {
  const r = path.relative(base, target);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
};

export function defaultWritePath(nb, a) {
  if (a.inputs?.path) return a.inputs.path;
  const root = a.inputs?.root;
  const name = a.data?.filename ?? 'output.txt';
  return root && nb.config.roots?.[root] != null ? `${root}/${name}` : name;
}

// Resolves "<root>/<rel>", a notebook-relative path, or an absolute path inside the notebook or a root.
export function resolveWritePath(nb, p) {
  const s = String(p ?? '').trim().replace(/\\/g, '/');
  if (!s) throw httpError(400, 'path is required');
  const roots = nb.config.roots ?? {};
  const bases = [nb.dir, ...Object.values(roots).map((r) => path.resolve(nb.dir, r))];
  let abs;
  const first = s.split('/')[0];
  if (path.isAbsolute(s) || /^[A-Za-z]:/.test(s)) abs = path.resolve(s);
  else if (Object.hasOwn(roots, first) && s.includes('/')) abs = path.resolve(nb.dir, roots[first], s.slice(first.length + 1));
  else abs = path.resolve(nb.dir, s);
  if (!bases.some((b) => inside(b, abs)) || bases.some((b) => path.resolve(b) === abs)) throw httpError(403, 'files can only be written inside the notebook directory or one of its roots');
  return abs;
}

export function writeArtifactFile(nb, a, { path: p, overwrite = false, content } = {}) {
  if (a.kind !== 'file') throw httpError(400, 'only file artifacts can be written');
  if (a.status !== 'ok') throw httpError(409, `artifact is ${a.status}`);
  const abs = resolveWritePath(nb, p || defaultWritePath(nb, a));
  if (fs.existsSync(abs)) {
    if (fs.statSync(abs).isDirectory()) throw httpError(400, 'path is a directory');
    if (!overwrite) throw Object.assign(httpError(409, `${toPosix(abs)} exists; send overwrite:true to replace it`), { exists: true, path: toPosix(abs) });
  }
  const text = typeof content === 'string' ? content : a.data.content;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  a.writtenTo = toPosix(abs);
  a.updatedAt = new Date().toISOString();
  saveArtifact(nb, a);
  return { path: toPosix(abs), bytes: Buffer.byteLength(text) };
}
