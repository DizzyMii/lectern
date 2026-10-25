// Studio recipes: each card is data plus a prompt builder. Nothing here may assume a particular
// project, language or framework; recipes speak about "the sources", "the docs" and "the codebase".
import { CONTRACTS } from './schemas.mjs';

export const GROUPS = [
  { id: 'plan', title: 'Plan', hue: 'peach', blurb: 'PRDs, specs and plans' },
  { id: 'visual', title: 'Visual', hue: 'lavender', blurb: 'Maps and diagrams' },
  { id: 'agent', title: 'Agent', hue: 'mint', blurb: 'Files and evals for coding agents' },
  { id: 'learn', title: 'Learn', hue: 'sky', blurb: 'Guides, references and cards' },
  { id: 'code', title: 'Code', hue: 'butter', blurb: 'Reviews and reports on real code' },
];

// ---------- prompt pieces ----------

const CITE = `Citation rule: cite every factual claim with the [[...]] forms from the system prompt. Docs: [[path|"3 to 15 words copied exactly"]]. Code: [[path#L12]] or [[path#L12-L20]] with line numbers you actually read with Read or found with Grep. Never invent a path, a line number or an API name. When the sources do not cover something, write "Not covered by the sources" and move on instead of filling the gap from memory.`;

const GROUND = `Ground the work in this notebook before you write: skim the pinned documents for the relevant sections, then use Glob and Grep on the code roots to find the real files, types and functions, and Read the parts you will rely on.`;

const end = (kind) => `${CITE}\n\n${CONTRACTS[kind]}`;

const tag = (name, text) => `<${name}>\n${text}\n</${name}>`;

const rootLine = (r) => `the "${r.name}" code root (notebook path "${r.path}", absolute path "${r.abs}")`;

function rootsBlock(ctx) {
  if (!ctx.roots.length) return 'This notebook has no code roots, so work from the pinned documents only.';
  return `The code roots are:\n${ctx.roots.map((r) => `- ${rootLine(r)}`).join('\n')}`;
}

const source = (a, what = 'source artifact') => a
  ? `Build on this earlier ${what}, "${a.title}" (${a.recipe}). Treat it as the agreed baseline: keep its decisions and terms, fill its gaps from the sources, and say where the sources contradict it.\n${tag('artifact', a.text)}`
  : '';

const topicLine = (topic, fallback) => topic ? `Topic: ${topic}` : fallback;

// joins prompt parts, dropping empty ones
const P = (...parts) => parts.filter((p) => p && String(p).trim()).join('\n\n');

// ---------- recipes ----------

export const RECIPES = [
  // plan
  {
    id: 'prd', title: 'Product requirements', group: 'plan', kind: 'doc', icon: 'clipboard',
    blurb: 'Turn an idea into a PRD grounded in what the sources already support.',
    inputs: [
      { name: 'idea', label: 'Idea', type: 'longtext', required: true, placeholder: 'What should exist that does not yet? Who is it for?' },
    ],
    next: [{ recipe: 'tech-spec', input: 'source' }, { recipe: 'impl-plan', input: 'source' }, { recipe: 'test-plan', input: 'source' }],
    prompt: (v, ctx) => P(
      'Write a product requirements document (PRD) for the idea below. The readers are the product owner and the engineers who will build it; they know the domain but have not seen this idea worked out.',
      tag('idea', v.idea),
      GROUND + ' Look specifically for features, limits, terms and extension points in the sources that this idea depends on or collides with.',
      rootsBlock(ctx),
      `Structure, in this order:
1. "# <product name>: PRD" and a one-paragraph summary.
2. "## Problem": who has it, how they cope today, why now.
3. "## Users and jobs": two to four user types, each with the job they hire this for.
4. "## Goals" and "## Non-goals" as short bullet lists. Non-goals are things a reader might reasonably expect that this release will not do.
5. "## User stories": 5 to 12 stories as "As a <user>, I want <capability> so that <outcome>", each followed by two to four acceptance criteria written as checkable statements.
6. "## Requirements": a table with columns ID (R1, R2, ...), Requirement, Priority (Must, Should, Could), Notes.
7. "## Non-functional requirements": performance, reliability, security, accessibility, compatibility, only those that matter here.
8. "## What the sources already give us": the existing capabilities, constraints and conventions this builds on, each cited. This section is what makes the PRD trustworthy, so make it concrete.
9. "## Risks and open questions": a table with columns Question, Why it matters, How to resolve.
10. "## Success metrics": three to five measurable signals.
Keep it between 900 and 1600 words. Write plainly; no marketing language. Mark anything you assume rather than find as "(assumption)".`,
      end('doc'),
    ),
  },
  {
    id: 'tech-spec', title: 'Tech spec', group: 'plan', kind: 'doc', icon: 'blueprint',
    blurb: 'An implementation-ready technical design built on the real code.',
    inputs: [
      { name: 'source', label: 'From an artifact', type: 'artifact', required: false, from: ['prd', 'adr'], placeholder: 'Pick a PRD' },
      { name: 'idea', label: 'Or describe it', type: 'longtext', required: false, placeholder: 'The feature or change to design' },
    ],
    needsOne: ['source', 'idea'],
    next: [{ recipe: 'impl-plan', input: 'source' }, { recipe: 'test-plan', input: 'source' }],
    prompt: (v, ctx) => P(
      'Write a technical specification. The reader is an engineer who will implement it without being able to ask you anything, so every interface, file and decision has to be spelled out.',
      source(v.source, 'requirements artifact'),
      v.idea ? tag('feature', v.idea) : '',
      GROUND + ' Find the existing extension points, base types, registration or wiring patterns and similar features that the design should reuse. Prefer the patterns the codebase already uses over new ones, and say which file each pattern comes from.',
      rootsBlock(ctx),
      `Structure, in this order:
1. "# <feature>: technical spec" and a three-sentence overview of the approach.
2. "## Scope": in scope and out of scope.
3. "## Architecture": the components, what each owns, and how they connect to the existing code. Name the real classes, modules or functions you build on, with citations.
4. "## Interfaces and data": exact type definitions, function signatures, message or file formats and configuration keys, in fenced code blocks in the codebase's language. Explain each field that is not obvious.
5. "## Key flows": numbered steps for the two to four most important flows, naming the function that runs each step.
6. "## Edge cases and errors": what can go wrong and what the code does about it.
7. "## Performance, security and compatibility": only the points that apply.
8. "## Testing": what to test at which level and which existing test helpers or patterns to use.
9. "## Alternatives considered": one or two options you rejected and why, in two sentences each.
10. "## Open questions".
Length: 1500 to 2500 words. When the sources do not confirm an API you need, say "not found in the sources" next to it rather than presenting it as fact.`,
      end('doc'),
    ),
  },
  {
    id: 'impl-plan', title: 'Implementation plan', group: 'plan', kind: 'plan', icon: 'checklist',
    blurb: 'Phased tasks with files, dependencies and acceptance checks.',
    inputs: [
      { name: 'source', label: 'From an artifact', type: 'artifact', required: false, from: ['tech-spec', 'prd', 'adr', 'build-x'], placeholder: 'Pick a tech spec or PRD' },
      { name: 'idea', label: 'Or describe it', type: 'longtext', required: false, placeholder: 'What should be built' },
    ],
    needsOne: ['source', 'idea'],
    next: [{ recipe: 'test-plan', input: 'source' }],
    prompt: (v, ctx) => P(
      'Write an implementation plan. The reader is an engineer or a coding agent who will execute the tasks in order, one at a time, and tick off the acceptance checks as they go.',
      source(v.source, 'design artifact'),
      v.idea ? tag('goal', v.idea) : '',
      GROUND + ' Use Glob on the roots to learn the real directory layout and naming, so the file paths in the plan match where such files actually live. Each task that extends existing code gets a "ref" to the line it builds on.',
      rootsBlock(ctx),
      `Plan rules:
- 3 to 6 phases in delivery order. The first phase gets a minimal end-to-end path working; the last phase is hardening and verification.
- 8 to 30 tasks in total. A task is small enough to finish and review in under a day. Split anything bigger.
- "title" is an imperative sentence ("Add the settings store"). "detail" says what to do and how, naming the existing types and functions to use, with citations.
- "files" lists the exact paths the task creates or changes, relative to the notebook, following the layout you found.
- "dependsOn" lists only real prerequisites, so independent tasks can run in parallel.
- "estimate" is S (under two hours), M (half a day) or L (a day).
- "acceptance" has one to four statements a reviewer can check by running something or reading the diff: a named test passes, a command prints a value, a file contains a function.
- "goal" is one sentence describing the finished state.`,
      end('plan'),
    ),
  },
  {
    id: 'adr', title: 'Decision record', group: 'plan', kind: 'doc', icon: 'scale',
    blurb: 'An architecture decision record that weighs real options and picks one.',
    inputs: [
      { name: 'decision', label: 'Decision to make', type: 'text', required: true, placeholder: 'e.g. How should we store per-user settings?' },
      { name: 'options', label: 'Options you are weighing', type: 'longtext', required: false, placeholder: 'Optional. One per line.' },
    ],
    next: [{ recipe: 'tech-spec', input: 'source' }],
    prompt: (v, ctx) => P(
      'Write an architecture decision record (ADR). The reader is a maintainer a year from now who needs to know what was decided, why, and what it cost.',
      tag('decision', v.decision),
      v.options ? tag('options', v.options) : 'No options were given: identify the two to four options a competent engineer would seriously consider, using what the sources and the codebase support.',
      GROUND + ' Look for what the sources recommend, what the codebase already does in similar places, and any constraints that rule options out.',
      rootsBlock(ctx),
      `Structure:
1. "# ADR: <decision as a short noun phrase>", then "Status: Proposed" and today's context in one line.
2. "## Context": the forces at play (requirements, constraints, existing code), each cited.
3. "## Options": one "### <option>" per option with a two-sentence description, then "Pros" and "Cons" bullet lists grounded in the sources.
4. "## Decision": pick exactly one option and defend it in one paragraph. Do not hedge.
5. "## Consequences": what becomes easier, what becomes harder, and the follow-up work it creates.
6. "## Revisit if": the conditions under which this decision should be reopened.
Length: 500 to 900 words.`,
      end('doc'),
    ),
  },
  {
    id: 'test-plan', title: 'Test plan', group: 'plan', kind: 'doc', icon: 'beaker',
    blurb: 'Risks, test cases and exit criteria using the project\'s own test tools.',
    inputs: [
      { name: 'source', label: 'From an artifact', type: 'artifact', required: false, from: ['prd', 'tech-spec', 'impl-plan'], placeholder: 'Pick a PRD, spec or plan' },
      { name: 'feature', label: 'Or describe the feature', type: 'longtext', required: false, placeholder: 'What needs testing' },
    ],
    needsOne: ['source', 'feature'],
    prompt: (v, ctx) => P(
      'Write a test plan. The readers are the engineers who will write the tests and the reviewer who signs off the release.',
      source(v.source, 'artifact'),
      v.feature ? tag('feature', v.feature) : '',
      GROUND + ' Use Glob to find how this codebase already tests things (test directories, test frameworks, fixtures, helpers, test-only entry points) and plan in those terms. If the sources describe a built-in test facility, use it.',
      rootsBlock(ctx),
      `Structure:
1. "# Test plan: <feature>" and a two-sentence scope statement.
2. "## Risks": a ranked table with columns Risk, Impact, Likelihood, Covered by (test IDs).
3. "## Approach": which levels (unit, integration, end-to-end, manual) cover what, and the existing tools and helpers to use, cited.
4. "## Test cases": a table with columns ID (TC1, ...), Area, Case, Steps, Expected result, Level, Priority (P0, P1, P2). 15 to 40 rows. Include negative cases, boundaries, concurrency or ordering cases and upgrade or migration cases where they apply.
5. "## Test data and environment": fixtures, seeds, configuration.
6. "## Exit criteria": the checkable conditions for calling it done.
Length: 800 to 1500 words plus the table.`,
      end('doc'),
    ),
  },

  // visual
  {
    id: 'code-map', title: 'Code map', group: 'visual', kind: 'graph', layout: 'layered', icon: 'map',
    blurb: 'The packages and key types of a code root and how they connect.',
    inputs: [
      { name: 'root', label: 'Code root', type: 'root', required: true },
      { name: 'focus', label: 'Focus', type: 'text', required: false, placeholder: 'Optional: an area to zoom into' },
    ],
    next: [{ recipe: 'dependency-graph', input: 'root' }],
    prompt: (v, ctx) => P(
      `Draw a code map of ${rootLine(v.root)}. The reader is a developer opening this codebase for the first time who wants to know where things live and which types matter.`,
      v.focus ? `Focus the map on: ${v.focus}. Keep enough surrounding structure that the focus area has context.` : '',
      `Method, in order:
1. Glob the root ("**/*" with a reasonable depth, then narrower patterns) to see its directory structure.
2. Grep for the main declarations (classes, interfaces, modules, exported functions) to find the central types: the ones many files refer to, the entry points, the base types others extend.
3. Read the declarations you include so each "ref" points at the real line.`,
      `Graph rules:
- Keep to the 40 to 80 most important nodes. Leave out tests, generated code and trivial helpers.
- Node kinds: "package" for directories or modules, "class", "interface", "event", "external" for important outside dependencies.
- "group" is the top-level package or directory the node belongs to, so the renderer can cluster.
- Edges: "contains" (package to its key types), "extends", "implements", "uses", "creates", "registers", "fires". Put the relation in both "label" and "kind".
- Every class and interface node has a "ref" to its declaration line and a "detail" of one or two sentences on what it is for, with a citation.
- "layout" is "layered".`,
      end('graph'),
    ),
  },
  {
    id: 'concept-map', title: 'Concept map', group: 'visual', kind: 'graph', layout: 'radial', icon: 'orbit',
    blurb: 'A radial map of the ideas in the sources and how they relate.',
    inputs: [
      { name: 'topic', label: 'Topic', type: 'text', required: false, placeholder: 'Optional: leave empty for the whole notebook' },
    ],
    prompt: (v, ctx) => P(
      'Draw a concept map. The reader is someone building a mental model of the subject who wants to see the ideas and their relationships at a glance before reading the details.',
      topicLine(v.topic, 'Topic: the subject of the whole notebook, as the pinned documents present it.'),
      'Work from the pinned documents first; use the code roots only to confirm a relationship the docs leave unclear.',
      `Graph rules:
- 20 to 50 nodes. The first node is the central topic; the rest radiate out from it by how directly they relate.
- Most nodes have kind "concept"; use "class", "interface" or "event" only for named things in the sources.
- "group" names the area of the subject each concept belongs to (four to eight groups in total).
- Edges carry short relation verbs in "label": "is a", "has", "requires", "produces", "configured by", "runs on", "replaces". Every node is connected.
- Every node has a "detail" of one or two sentences with a doc citation.
- "layout" is "radial".`,
      end('graph'),
    ),
  },
  {
    id: 'flow-diagram', title: 'Flow diagram', group: 'visual', kind: 'graph', layout: 'layered', icon: 'flow',
    blurb: 'Trace how something happens, step by step and branch by branch.',
    inputs: [
      { name: 'trace', label: 'Trace how...', type: 'text', required: true, placeholder: 'e.g. a request is authenticated' },
    ],
    prompt: (v, ctx) => P(
      `Trace how this happens and draw it as a flow diagram: ${v.trace}`,
      'The reader is a developer debugging or extending this flow who needs the exact order of steps and the decision points.',
      GROUND + ' Start from the entry point, then follow the calls with Read and Grep until the flow ends. Do not draw steps you have not seen in the docs or the code.',
      rootsBlock(ctx),
      `Graph rules:
- 8 to 40 nodes. Kind "step" for actions, "decision" for branches (label phrased as a question), "event" for events fired or handled, "external" for systems outside the codebase.
- Exactly one start node (kind "step", label starting with "Start:"), and one or more end nodes (label starting with "End:").
- Edges go in execution order. Edges leaving a decision carry the branch condition in "label" ("yes", "no", "cached", "error").
- Steps that happen in code have a "ref" to the line that does it and a "detail" naming the function, with a citation.
- "group" names the component or layer that runs the step.
- "layout" is "layered".`,
      end('graph'),
    ),
  },
  {
    id: 'sequence-diagram', title: 'Sequence diagram', group: 'visual', kind: 'sequence', icon: 'sequence',
    blurb: 'Who calls whom, in what order, for one feature.',
    inputs: [
      { name: 'feature', label: 'Feature or interaction', type: 'text', required: true, placeholder: 'e.g. saving a document with autosave on' },
    ],
    prompt: (v, ctx) => P(
      `Draw a sequence diagram of: ${v.feature}`,
      'The reader is a developer who needs to know which components take part, the order of calls and messages, and where work crosses a thread, process or network boundary.',
      GROUND + ' Follow the real call chain in the code with Read and Grep. Prefer the components the sources name over invented ones.',
      rootsBlock(ctx),
      `Diagram rules:
- 2 to 12 actors: components, classes, threads, processes, sides of a connection or external systems. "kind" says which ("component", "class", "thread", "process", "external", "user").
- 6 to 40 steps in time order. "label" is the call or message name, with arguments only when they matter.
- Mark events, callbacks, queued work and network messages "async": true.
- Use "note" for what changes hands (data, ownership, thread) and for conditions, with citations.
- Steps that happen in code have a "ref" to the line that sends or handles them.`,
      end('sequence'),
    ),
  },
  {
    id: 'dependency-graph', title: 'Dependency graph', group: 'visual', kind: 'graph', layout: 'layered', icon: 'network',
    blurb: 'Imports between packages of a root, with cycles marked.',
    inputs: [
      { name: 'root', label: 'Code root', type: 'root', required: true },
    ],
    prompt: (v, ctx) => P(
      `Draw the package dependency graph of ${rootLine(v.root)}. The reader is a developer judging coupling and layering: what depends on what, and where the cycles are.`,
      `Method, in order:
1. Glob the root to list its packages or modules (directories that hold source files). Pick a depth that gives 10 to 60 packages.
2. Grep the import, include, require or use statements across the root (whatever the language uses) and aggregate them per source package and target package.
3. Count imports per package pair. Imports of outside libraries collapse into one "external" node per library.`,
      `Graph rules:
- Nodes are packages (kind "package") and outside libraries (kind "external"). "label" is the short package name; "detail" says what the package holds and how many files, with a citation of one representative import line.
- An edge goes from the importing package to the imported one. "label" is the count, like "12 imports". Leave out pairs with a single import unless the graph would otherwise be disconnected.
- Find every cycle among the packages. Each edge that is part of a cycle has "kind": "cycle"; other edges have "kind": "imports".
- "ref" on a package node points at one file in it (path#L1).
- "group" is the top-level package.
- "layout" is "layered". In the summary before the JSON, list the cycles you found, or say there are none.`,
      end('graph'),
    ),
  },

  // agent
  {
    id: 'claude-md', title: 'CLAUDE.md', group: 'agent', kind: 'file', icon: 'robot', filename: 'CLAUDE.md',
    blurb: 'Project memory for Claude Code: commands, layout, conventions, traps.',
    inputs: [
      { name: 'root', label: 'Code root', type: 'root', required: false },
      { name: 'source', label: 'Fold in an artifact', type: 'artifact', required: false, from: ['*'], placeholder: 'Optional: a spec or guide to draw rules from' },
      { name: 'audience', label: 'Notes for the agent', type: 'text', required: false, placeholder: 'Optional: what the agent will mostly do here' },
      { name: 'path', label: 'Write to', type: 'path', required: false, placeholder: '<root>/CLAUDE.md' },
    ],
    prompt: (v, ctx) => P(
      `Write a CLAUDE.md file for ${v.root ? rootLine(v.root) : 'this notebook'}. Claude Code loads this file into context at the start of every session, so its reader is an AI coding agent about to change this code. Every line costs context on every turn: keep only what changes the agent's behaviour.`,
      v.audience ? `The agent will mostly be: ${v.audience}` : '',
      source(v.source, 'artifact'),
      GROUND + ' Look for build files, package manifests, scripts and CI configuration to learn the real commands. Read a few representative source files to learn the conventions.',
      rootsBlock(ctx),
      `File content, in this order:
1. "# CLAUDE.md" and two sentences on what this codebase is.
2. "## Commands": build, test, run and lint commands exactly as the repository defines them, in a code block. If you cannot find them, write "No build commands found in the sources" instead of guessing.
3. "## Layout": a short map of the important directories, one line each.
4. "## Conventions": 6 to 15 imperative bullets on the patterns this code follows (naming, structure, how things get wired up or registered, error handling), each with an example file path in backticks.
5. "## Gotchas": 4 to 10 bullets on mistakes the docs warn about or the code works around.
6. "## Where to look things up": the pinned doc paths an agent should read before touching each area.
Between 80 and 200 lines. Imperative mood, no filler, no marketing. Paths are plain text in backticks inside the content; the [[...]] citations for your claims go in "notes", not in "content".
"filename" is "CLAUDE.md" and "language" is "markdown".`,
      end('file'),
    ),
  },
  {
    id: 'agents-md', title: 'AGENTS.md', group: 'agent', kind: 'file', icon: 'robot', filename: 'AGENTS.md',
    blurb: 'Tool-neutral instructions for any coding agent working in the repo.',
    inputs: [
      { name: 'root', label: 'Code root', type: 'root', required: false },
      { name: 'audience', label: 'Notes for the agent', type: 'text', required: false, placeholder: 'Optional: what agents will mostly do here' },
      { name: 'path', label: 'Write to', type: 'path', required: false, placeholder: '<root>/AGENTS.md' },
    ],
    prompt: (v, ctx) => P(
      `Write an AGENTS.md file for ${v.root ? rootLine(v.root) : 'this notebook'}. AGENTS.md is the tool-neutral README for coding agents: any agent reads it before working in the repository. Its reader is an AI agent with no other context.`,
      v.audience ? `Agents here will mostly be: ${v.audience}` : '',
      GROUND + ' Find the real setup, build and test commands in build files, manifests, scripts and CI configuration, and the real code style in representative files.',
      rootsBlock(ctx),
      `File content, with these sections in order:
1. "# AGENTS.md" and a "## Project overview" of three to five sentences.
2. "## Setup": prerequisites and setup commands in a code block.
3. "## Build and test": the exact commands, and how to run a single test if the tooling allows it.
4. "## Code style": 5 to 12 bullets taken from what the code actually does, each with an example path in backticks.
5. "## Architecture notes": the few structural rules an agent must not break.
6. "## Working rules": what to do before committing, what never to edit (generated files, vendored code), and how to verify a change.
Between 60 and 160 lines. Commands you cannot find in the sources are marked "(not found, confirm with a maintainer)". The [[...]] citations for your claims go in "notes", not in "content".
"filename" is "AGENTS.md" and "language" is "markdown".`,
      end('file'),
    ),
  },
  {
    id: 'skill', title: 'Agent skill', group: 'agent', kind: 'file', icon: 'spark', filename: 'SKILL.md',
    blurb: 'A SKILL.md that teaches an agent one procedure from the sources.',
    inputs: [
      { name: 'topic', label: 'Skill topic', type: 'text', required: true, placeholder: 'e.g. adding a new API endpoint' },
      { name: 'path', label: 'Write to', type: 'path', required: false, placeholder: '.claude/skills/<name>/SKILL.md' },
    ],
    prompt: (v, ctx) => P(
      `Write an agent skill file (SKILL.md) that teaches a coding agent how to: ${v.topic}`,
      'An agent sees only the frontmatter "description" when deciding whether to load the skill, then follows the body step by step. The reader is that agent, mid-task, with no other context.',
      GROUND + ' Find the exact types, functions, files and steps the procedure needs, and at least one real example in the code roots to model the example on.',
      rootsBlock(ctx),
      `File content:
- Starts with YAML frontmatter between "---" lines containing exactly two keys: "name" (lowercase words joined by hyphens, at most 64 characters) and "description" (one or two sentences, at most 900 characters, written in the third person: what the skill does, then "Use when ..." with the concrete situations and phrases that should trigger it).
- "# <Skill title>" and a two-sentence overview.
- "## When to use" and "## When not to use": short bullets.
- "## Steps": a numbered procedure. Each step names the exact type, function or file to touch.
- "## Example": a minimal, complete code example consistent with the sources.
- "## Common mistakes": 3 to 8 bullets, each with the symptom and the fix.
- "## References": the doc and code paths the steps come from, as plain paths in backticks.
At most 300 lines. The [[...]] citations for your claims go in "notes", not in "content".
"filename" is "SKILL.md" and "language" is "markdown".`,
      end('file'),
    ),
  },
  {
    id: 'agent-quiz', title: 'Agent quiz', group: 'agent', kind: 'quiz', icon: 'target',
    blurb: 'An eval set whose answers are checkable against the sources.',
    inputs: [
      { name: 'topic', label: 'Topic', type: 'text', required: false, placeholder: 'Optional: leave empty for the whole notebook' },
    ],
    prompt: (v, ctx) => P(
      'Write a quiz that tests whether a coding agent (or a developer) really knows these sources. It doubles as an evaluation set, so every answer must be checkable against a cited source line, with no judgement calls.',
      topicLine(v.topic, 'Topic: the whole notebook.'),
      GROUND,
      rootsBlock(ctx),
      `Question rules:
- 12 to 20 questions. About half "single", a quarter "multi", a quarter "short".
- Prefer questions where general knowledge or an older version of the material would give the wrong answer: renamed types, changed signatures, required steps, defaults, ordering rules, which side or thread something runs on.
- No trivia, no trick wording, no "all of the above". Wrong options must be plausible mistakes a real developer makes.
- "short" answers are an exact identifier, value or short phrase that appears in the sources.
- "explain" says why the answer is right and why the most tempting wrong option is wrong, with a citation.
- Questions about code have a "ref" to the line that proves the answer.
- ids are "q1", "q2", ...`,
      end('quiz'),
    ),
  },

  // learn
  {
    id: 'onboarding', title: 'Onboarding guide', group: 'learn', kind: 'doc', icon: 'compass',
    blurb: 'A first-week guide for a developer new to these sources.',
    inputs: [
      { name: 'focus', label: 'Role or focus', type: 'text', required: false, placeholder: 'Optional: e.g. backend contributor' },
    ],
    next: [{ recipe: 'claude-md', input: 'source' }],
    prompt: (v, ctx) => P(
      `Write an onboarding guide for a developer who is new to this material${v.focus ? `, working as: ${v.focus}` : ''}. They are competent but have never seen these sources. After reading it they should know the mental model, where things are, and what to learn in which order.`,
      GROUND,
      rootsBlock(ctx),
      `Structure:
1. "# Onboarding: <subject>" and a paragraph on what this is and what it is for.
2. "## The mental model": the five to eight ideas everything else rests on, each in a short paragraph.
3. "## Map of the sources": which pinned documents cover what (a table with columns Area, Read this, Why), and what each code root holds.
4. "## Setting up": the setup steps the sources describe. If they describe none, say so.
5. "## Learning path": an ordered list of topics, each with the document to read and the code to open.
6. "## Your first change": a small, realistic task walked through step by step with the files involved.
7. "## Where to get unstuck": the docs and code to check for the common questions.
Length: 1200 to 2000 words.`,
      end('doc'),
    ),
  },
  {
    id: 'cheat-sheet', title: 'Cheat sheet', group: 'learn', kind: 'doc', icon: 'bolt',
    blurb: 'A dense one-pager of exact names, patterns and snippets.',
    inputs: [
      { name: 'topic', label: 'Topic', type: 'text', required: false, placeholder: 'Optional: leave empty for the whole notebook' },
    ],
    next: [{ recipe: 'claude-md', input: 'source' }],
    prompt: (v, ctx) => P(
      'Write a dense cheat sheet. The reader already understands the subject and wants exact names and minimal snippets to copy while working, on one screen.',
      topicLine(v.topic, 'Topic: the most used parts of the whole notebook.'),
      GROUND,
      rootsBlock(ctx),
      `Format:
- "# Cheat sheet: <topic>", then 5 to 9 "## " sections by task ("Set up X", "Do Y").
- Mostly tables (columns like Task, Use, Notes) and code blocks of at most eight lines.
- Exact type, function, file and key names as they appear in the sources. No prose paragraphs longer than two sentences.
- End with "## Do not" listing the five most common mistakes in one line each.
Length: 600 to 1000 words.`,
      end('doc'),
    ),
  },
  {
    id: 'porting-guide', title: 'Porting guide', group: 'learn', kind: 'doc', icon: 'arrows',
    blurb: 'Move code from one version or approach to another, change by change.',
    inputs: [
      { name: 'from', label: 'Porting from', type: 'text', required: true, placeholder: 'e.g. version 2.x, or the old callback API' },
      { name: 'to', label: 'Porting to', type: 'text', required: false, placeholder: 'Optional: defaults to what the sources describe' },
    ],
    prompt: (v, ctx) => P(
      `Write a porting guide for moving existing code from ${v.from} to ${v.to || 'the version the sources describe'}. The reader has working code on the old side and wants to change it with as few surprises as possible.`,
      GROUND + ' Read any migration notes, primers, changelogs or upgrade guides in the pinned documents first; they are the strongest evidence. Then confirm the new signatures in the code roots.',
      rootsBlock(ctx),
      `Structure:
1. "# Porting guide: <from> to <to>" and a summary table of the areas that change, with columns Area, Effort (small, medium, large), Breaking (yes or no).
2. One "## " section per area. Inside, one "### " entry per change with: what changed, a "Before" code block, an "After" code block, and the reason when the sources give one. Cite the new form.
3. "## Behaviour changes": things that compile the same but act differently.
4. "## Checklist": a markdown checklist ("- [ ]") of every change, in the order to do them.
Only describe the old side as far as the sources or the user's description support it; if the sources do not say what the old form was, show only the new form and say so.
Length: 1000 to 2500 words.`,
      end('doc'),
    ),
  },
  {
    id: 'gotchas', title: 'Gotchas', group: 'learn', kind: 'doc', icon: 'alert',
    blurb: 'The traps the sources warn about, with symptoms and fixes.',
    inputs: [
      { name: 'topic', label: 'Topic', type: 'text', required: false, placeholder: 'Optional: leave empty for the whole notebook' },
    ],
    next: [{ recipe: 'claude-md', input: 'source' }],
    prompt: (v, ctx) => P(
      'List the gotchas: mistakes, surprising behaviour, ordering and threading traps, easy-to-miss requirements and silent failures that the sources warn about or that the code clearly guards against. The reader is a developer who wants to avoid losing an afternoon to each of them.',
      topicLine(v.topic, 'Topic: the whole notebook.'),
      GROUND + ' Look for warnings, notes, "must", "do not" and "important" in the docs, and for checks, assertions and defensive code in the roots.',
      rootsBlock(ctx),
      `Format:
- "# Gotchas: <topic>" and one sentence on how the list is ordered (most likely to bite first).
- 10 to 25 entries, each a "## " heading naming the trap in plain words, then three short labelled lines: "Symptom:", "Cause:", "Fix:", with a citation on the cause, and a code block for the fix when code helps.
Length: 900 to 1800 words.`,
      end('doc'),
    ),
  },
  {
    id: 'glossary', title: 'Glossary', group: 'learn', kind: 'doc', icon: 'book',
    blurb: 'Every term the sources use, defined in a sentence or two.',
    inputs: [
      { name: 'topic', label: 'Topic', type: 'text', required: false, placeholder: 'Optional: leave empty for the whole notebook' },
    ],
    prompt: (v, ctx) => P(
      'Write a glossary of the terms, named types and concepts the sources use. The reader hits an unfamiliar word while reading the docs or the code and wants a precise definition in a sentence or two.',
      topicLine(v.topic, 'Topic: the whole notebook.'),
      GROUND,
      `Format:
- "# Glossary: <topic>", then one "## A", "## B", ... heading per letter that has entries.
- Under each letter, entries as "**Term**: definition" paragraphs, alphabetical. One or two sentences each, then a citation. Mention a related term in the definition where it helps.
- 30 to 80 terms. Include the terms a newcomer would trip over, not everyday words.
Length: 1000 to 2500 words.`,
      end('doc'),
    ),
  },
  {
    id: 'flashcards', title: 'Flashcards', group: 'learn', kind: 'quiz', icon: 'cards',
    blurb: 'Short question and answer cards for spaced practice.',
    inputs: [
      { name: 'topic', label: 'Topic', type: 'text', required: false, placeholder: 'Optional: leave empty for the whole notebook' },
    ],
    prompt: (v, ctx) => P(
      'Make a deck of flashcards for learning these sources by active recall. The reader flips each card, answers in their head, then checks the back.',
      topicLine(v.topic, 'Topic: the most important ideas in the whole notebook.'),
      GROUND,
      `Card rules:
- 20 to 40 cards. Every question has "kind": "short" and no options.
- "q" is the front: one clear question or prompt, at most 20 words.
- "answer" is the back: at most 25 words, exact names as written in the sources.
- "explain" adds one sentence of context and a citation.
- Cover definitions, "which X does Y", "what happens when", and "what is required before". One fact per card.
- ids are "c1", "c2", ...`,
      end('quiz'),
    ),
  },

  // code
  {
    id: 'gap-report', title: 'Gap report', group: 'code', kind: 'doc', icon: 'scan',
    blurb: 'Where a code root and the docs disagree, citing both sides.',
    inputs: [
      { name: 'root', label: 'Code root', type: 'root', required: true },
      { name: 'focus', label: 'Focus', type: 'text', required: false, placeholder: 'Optional: an area to check' },
    ],
    prompt: (v, ctx) => P(
      `Compare ${rootLine(v.root)} with the pinned documents and report the gaps. The reader maintains this code and wants to know where it departs from what the docs say, ranked by how much it matters.`,
      v.focus ? `Check this area only: ${v.focus}` : '',
      `Method: list the main topics the docs cover that apply to this code. For each, Grep and Read the code to see how it handles that topic. Look for: outdated or deprecated patterns, required steps that are missing, behaviour that differs from the docs, code that relies on something the docs say not to, and features in the code the docs never mention.`,
      `Structure:
1. "# Gap report: <root name>" and a summary table with columns #, Finding, Severity (High, Medium, Low), Area.
2. One "## <n>. <finding>" section per row with: "What the docs say" (doc citation), "What the code does" (code citation), "Why it matters", "Suggested change" (code block where useful).
3. "## Undocumented in the docs": code features the docs do not cover, with code citations.
4. "## Checked and consistent": a short list of areas you checked that match, so the reader knows what was covered.
Every finding cites both sides. If you find no real gaps, say so plainly; do not pad the report.
Length: 800 to 1800 words.`,
      end('doc'),
    ),
  },
  {
    id: 'diff-review', title: 'Diff review', group: 'code', kind: 'doc', icon: 'diff',
    blurb: 'Ranked findings on a diff, each with the documented right way.',
    inputs: [
      { name: 'diff', label: 'Diff', type: 'diff', required: true, placeholder: 'Paste a unified diff, or pick a root and a range like main..HEAD' },
    ],
    prompt: (v, ctx) => P(
      'Review the diff below. The reader is the author of the change, who wants to know what to fix before merging and why, backed by the sources rather than opinion.',
      v.diff.source === 'git' ? `The diff is \`git diff ${v.diff.range}\` in the "${v.diff.root}" root.${v.diff.truncated ? ' It was cut at 400 KB, so review only what is shown and say so.' : ''}` : (v.diff.truncated ? 'The pasted diff was cut at 400 KB; review only what is shown and say so.' : ''),
      tag('diff', v.diff.text),
      GROUND + ' For each changed area, check the docs for the documented way to do it, and Read the surrounding code in the roots for context the diff does not show.',
      rootsBlock(ctx),
      `Structure:
1. "# Diff review" and a one-paragraph verdict: merge, merge after fixes, or rework.
2. "## Findings": ranked by severity (Blocker, Major, Minor, Nit). Each finding is a "### [Severity] <short title>" with: "Where:" the file and line from the diff as plain text like \`src/a.ts:42\`, "Problem:", "The documented way:" with a doc or code citation, and "Suggested fix:" with a code block.
3. "## Looks good": two to five things the change does right.
4. "## Not checked": what you could not verify from the sources.
Only report real problems you can support. Do not invent findings to fill the list; a clean diff gets a short review.
Every finding carries at least one [[...]] citation to the docs or code for the right way, and "Looks good" cites what each point was checked against. A review with no citations fails validation, so even a clean diff cites its evidence.
Length: 300 to 1500 words depending on the size of the diff.`,
      end('doc'),
    ),
  },
  {
    id: 'build-x', title: 'How would I build...', group: 'code', kind: 'doc', icon: 'hammer',
    blurb: 'A build guide for a new feature that reuses the patterns already here.',
    inputs: [
      { name: 'goal', label: 'What to build', type: 'text', required: true, placeholder: 'e.g. a rate-limited export job' },
    ],
    next: [{ recipe: 'impl-plan', input: 'source' }],
    prompt: (v, ctx) => P(
      `Explain how to build this here: ${v.goal}`,
      'The reader is a developer on this codebase who wants a concrete path that fits the existing code, not a generic tutorial.',
      GROUND + ' Find the closest existing feature in the roots and model the answer on it: the same base types, the same wiring or registration, the same file layout. Name that feature and cite it.',
      rootsBlock(ctx),
      `Structure:
1. "# Building <goal>" and a three-sentence summary of the approach.
2. "## What to reuse": the existing types, functions and patterns, each cited, with one line on how each is used here.
3. "## Steps": numbered steps. Each says which file to create or change, shows the code in a fenced block, and cites the doc or code it follows.
4. "## Files": a table with columns File, New or changed, Purpose.
5. "## Testing it": how to check it works, using the project's own test tools if the sources show any.
6. "## Pitfalls": three to six traps specific to this feature.
Length: 1000 to 2000 words.`,
      end('doc'),
    ),
  },
  {
    id: 'release-notes', title: 'Release notes', group: 'code', kind: 'doc', icon: 'megaphone', citeRequired: false,
    blurb: 'User-facing release notes from a git range.',
    inputs: [
      { name: 'log', label: 'Git range', type: 'gitlog', required: true, placeholder: 'A root and a range like v1.2.0..HEAD' },
      { name: 'audience', label: 'Audience', type: 'text', required: false, placeholder: 'Optional: e.g. end users, or integrators' },
    ],
    prompt: (v, ctx) => P(
      `Write release notes for the ${v.log.count} commits below (\`git log ${v.log.range}\` in the "${v.log.root}" root). The readers are ${v.audience || 'the people who use this project'}: they care about what changed for them, not about how the code was reorganised.`,
      tag('commits', v.log.text),
      'Where a commit touches behaviour the pinned docs describe, check the docs and cite them so readers can follow up. You may Read files in the root to understand a commit whose subject is unclear.',
      `Structure:
1. "# Release notes: <range>" and a two-sentence summary of the release.
2. "## Highlights": the two to five changes users will notice most, in a sentence or two each.
3. Then any of these sections that have entries, in this order: "## New", "## Changed", "## Fixed", "## Removed", "## Breaking changes" (with what users must do), "## Internal" (one line summarising refactors, tests and tooling, not one line per commit).
4. Each bullet is written for the reader in plain words and ends with the short commit hashes in parentheses, like (a1b2c3d).
Merge commits that are one change into one bullet. Leave out commits that are only formatting or version bumps. Do not invent changes the commits do not show.
Length: 200 to 1200 words depending on the number of commits.`,
      `${CITE.replace('cite every factual claim', 'cite the docs where a change touches documented behaviour; commit hashes are the source for everything else')}\n\n${CONTRACTS.doc.replace(' Every factual claim carries a citation.', '')}`,
    ),
  },
];

const BY_ID = new Map(RECIPES.map((r) => [r.id, r]));

export function getRecipe(id) {
  return BY_ID.get(id) ?? null;
}

// The H2 headings a doc recipe asks for, in order, so Studio can show progress against a known total.
// Read from the prompt itself with stand-in values; null when the prompt does not fix them.
const STUB = new Proxy({}, { get: (t, k) => (k === Symbol.toPrimitive || k === 'toString' ? () => 'x' : STUB) });
function docSections(r) {
  let text = '';
  try { text = r.prompt(STUB, { roots: [] }); } catch { return null; }
  // only numbered structure lines that open with a heading count; optional or templated ones do not
  const lines = text.split(/\r?\n/).filter((l) => /^\s*\d+\.\s+"## /.test(l));
  const names = [...new Set(lines.flatMap((l) => [...l.matchAll(/"## ([^"]+)"/g)].map((m) => m[1].trim())))].filter((n) => !n.includes('<'));
  return names.length >= 3 ? names : null;
}

// The public shape of the recipe table, as GET /studio returns it.
export function listRecipes() {
  return RECIPES.map((r) => ({
    id: r.id, title: r.title, group: r.group, kind: r.kind, blurb: r.blurb, icon: r.icon,
    layout: r.layout ?? null, filename: r.filename ?? null, model: r.model ?? null,
    inputs: r.inputs.map((i) => ({ ...i })), needsOne: r.needsOne ?? null,
    sections: r.kind === 'doc' ? docSections(r) : null,
    // any doc can seed a CLAUDE.md
    next: [...(r.next ?? []), ...(r.kind === 'doc' && !(r.next ?? []).some((n) => n.recipe === 'claude-md') ? [{ recipe: 'claude-md', input: 'source' }] : [])],
  }));
}

export function buildPrompt(recipe, values, ctx) {
  return recipe.prompt(values, ctx);
}
