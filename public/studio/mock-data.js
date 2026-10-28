// Mock Studio data for ?mock=1, in the exact shapes the server returns.
// studio = GET /api/notebooks/:id/studio, artifacts = full GET /api/notebooks/:id/artifacts/:aid bodies,
// artifactList = GET /api/notebooks/:id/artifacts. Generated from lib/studio/recipes.mjs; regenerate when recipes change.

export const studio = {
  "groups": [
    {
      "id": "plan",
      "title": "Plan",
      "hue": "peach",
      "blurb": "PRDs, specs and plans"
    },
    {
      "id": "visual",
      "title": "Visual",
      "hue": "lavender",
      "blurb": "Maps and diagrams"
    },
    {
      "id": "agent",
      "title": "Agent",
      "hue": "mint",
      "blurb": "Files and evals for coding agents"
    },
    {
      "id": "learn",
      "title": "Learn",
      "hue": "sky",
      "blurb": "Guides, references and cards"
    },
    {
      "id": "code",
      "title": "Code",
      "hue": "butter",
      "blurb": "Reviews and reports on real code"
    }
  ],
  "kinds": [
    "doc",
    "graph",
    "sequence",
    "plan",
    "quiz",
    "file"
  ],
  "exports": {
    "doc": [
      "markdown"
    ],
    "graph": [
      "mermaid",
      "json"
    ],
    "sequence": [
      "mermaid",
      "json"
    ],
    "plan": [
      "markdown",
      "issues",
      "json"
    ],
    "quiz": [
      "json",
      "markdown"
    ],
    "file": [
      "raw"
    ]
  },
  "models": [
    "opus",
    "sonnet",
    "haiku"
  ],
  "recipes": [
    {
      "id": "prd",
      "title": "Product requirements",
      "group": "plan",
      "kind": "doc",
      "blurb": "Turn an idea into a PRD grounded in what the sources already support.",
      "icon": "clipboard",
      "layout": null,
      "filename": null,
      "model": null,
      "inputs": [
        {
          "name": "idea",
          "label": "Idea",
          "type": "longtext",
          "required": true,
          "placeholder": "What should exist that does not yet? Who is it for?"
        }
      ],
      "needsOne": null,
      "next": [
        {
          "recipe": "tech-spec",
          "input": "source"
        },
        {
          "recipe": "impl-plan",
          "input": "source"
        },
        {
          "recipe": "test-plan",
          "input": "source"
        },
        {
          "recipe": "claude-md",
          "input": "source"
        }
      ]
    },
    {
      "id": "tech-spec",
      "title": "Tech spec",
      "group": "plan",
      "kind": "doc",
      "blurb": "An implementation-ready technical design built on the real code.",
      "icon": "blueprint",
      "layout": null,
      "filename": null,
      "model": null,
      "inputs": [
        {
          "name": "source",
          "label": "From an artifact",
          "type": "artifact",
          "required": false,
          "from": [
            "prd",
            "adr"
          ],
          "placeholder": "Pick a PRD"
        },
        {
          "name": "idea",
          "label": "Or describe it",
          "type": "longtext",
          "required": false,
          "placeholder": "The feature or change to design"
        }
      ],
      "needsOne": [
        "source",
        "idea"
      ],
      "next": [
        {
          "recipe": "impl-plan",
          "input": "source"
        },
        {
          "recipe": "test-plan",
          "input": "source"
        },
        {
          "recipe": "claude-md",
          "input": "source"
        }
      ]
    },
    {
      "id": "impl-plan",
      "title": "Implementation plan",
      "group": "plan",
      "kind": "plan",
      "blurb": "Phased tasks with files, dependencies and acceptance checks.",
      "icon": "checklist",
      "layout": null,
      "filename": null,
      "model": null,
      "inputs": [
        {
          "name": "source",
          "label": "From an artifact",
          "type": "artifact",
          "required": false,
          "from": [
            "tech-spec",
            "prd",
            "adr",
            "build-x"
          ],
          "placeholder": "Pick a tech spec or PRD"
        },
        {
          "name": "idea",
          "label": "Or describe it",
          "type": "longtext",
          "required": false,
          "placeholder": "What should be built"
        }
      ],
      "needsOne": [
        "source",
        "idea"
      ],
      "next": [
        {
          "recipe": "test-plan",
          "input": "source"
        }
      ]
    },
    {
      "id": "adr",
      "title": "Decision record",
      "group": "plan",
      "kind": "doc",
      "blurb": "An architecture decision record that weighs real options and picks one.",
      "icon": "scale",
      "layout": null,
      "filename": null,
      "model": null,
      "inputs": [
        {
          "name": "decision",
          "label": "Decision to make",
          "type": "text",
          "required": true,
          "placeholder": "e.g. How should we store per-user settings?"
        },
        {
          "name": "options",
          "label": "Options you are weighing",
          "type": "longtext",
          "required": false,
          "placeholder": "Optional. One per line."
        }
      ],
      "needsOne": null,
      "next": [
        {
          "recipe": "tech-spec",
          "input": "source"
        },
        {
          "recipe": "claude-md",
          "input": "source"
        }
      ]
    },
    {
      "id": "test-plan",
      "title": "Test plan",
      "group": "plan",
      "kind": "doc",
      "blurb": "Risks, test cases and exit criteria using the project's own test tools.",
      "icon": "beaker",
      "layout": null,
      "filename": null,
      "model": null,
      "inputs": [
        {
          "name": "source",
          "label": "From an artifact",
          "type": "artifact",
          "required": false,
          "from": [
            "prd",
            "tech-spec",
            "impl-plan"
          ],
          "placeholder": "Pick a PRD, spec or plan"
        },
        {
          "name": "feature",
          "label": "Or describe the feature",
          "type": "longtext",
          "required": false,
          "placeholder": "What needs testing"
        }
      ],
      "needsOne": [
        "source",
        "feature"
      ],
      "next": [
        {
          "recipe": "claude-md",
          "input": "source"
        }
      ]
    },
    {
      "id": "code-map",
      "title": "Code map",
      "group": "visual",
      "kind": "graph",
      "blurb": "The packages and key types of a code root and how they connect.",
      "icon": "map",
      "layout": "layered",
      "filename": null,
      "model": null,
      "inputs": [
        {
          "name": "root",
          "label": "Code root",
          "type": "root",
          "required": true
        },
        {
          "name": "focus",
          "label": "Focus",
          "type": "text",
          "required": false,
          "placeholder": "Optional: an area to zoom into"
        }
      ],
      "needsOne": null,
      "next": [
        {
          "recipe": "dependency-graph",
          "input": "root"
        }
      ]
    },
    {
      "id": "concept-map",
      "title": "Concept map",
      "group": "visual",
      "kind": "graph",
      "blurb": "A radial map of the ideas in the sources and how they relate.",
      "icon": "orbit",
      "layout": "radial",
      "filename": null,
      "model": null,
      "inputs": [
        {
          "name": "topic",
          "label": "Topic",
          "type": "text",
          "required": false,
          "placeholder": "Optional: leave empty for the whole notebook"
        }
      ],
      "needsOne": null,
      "next": []
    },
    {
      "id": "flow-diagram",
      "title": "Flow diagram",
      "group": "visual",
      "kind": "graph",
      "blurb": "Trace how something happens, step by step and branch by branch.",
      "icon": "flow",
      "layout": "layered",
      "filename": null,
      "model": null,
      "inputs": [
        {
          "name": "trace",
          "label": "Trace how...",
          "type": "text",
          "required": true,
          "placeholder": "e.g. a request is authenticated"
        }
      ],
      "needsOne": null,
      "next": []
    },
    {
      "id": "sequence-diagram",
      "title": "Sequence diagram",
      "group": "visual",
      "kind": "sequence",
      "blurb": "Who calls whom, in what order, for one feature.",
      "icon": "sequence",
      "layout": null,
      "filename": null,
      "model": null,
      "inputs": [
        {
          "name": "feature",
          "label": "Feature or interaction",
          "type": "text",
          "required": true,
          "placeholder": "e.g. saving a document with autosave on"
        }
      ],
      "needsOne": null,
      "next": []
    },
    {
      "id": "dependency-graph",
      "title": "Dependency graph",
      "group": "visual",
      "kind": "graph",
      "blurb": "Imports between packages of a root, with cycles marked.",
      "icon": "network",
      "layout": "layered",
      "filename": null,
      "model": null,
      "inputs": [
        {
          "name": "root",
          "label": "Code root",
          "type": "root",
          "required": true
        }
      ],
      "needsOne": null,
      "next": []
    },
    {
      "id": "claude-md",
      "title": "CLAUDE.md",
      "group": "agent",
      "kind": "file",
      "blurb": "Project memory for Claude Code: commands, layout, conventions, traps.",
      "icon": "robot",
      "layout": null,
      "filename": "CLAUDE.md",
      "model": null,
      "inputs": [
        {
          "name": "root",
          "label": "Code root",
          "type": "root",
          "required": false
        },
        {
          "name": "source",
          "label": "Fold in an artifact",
          "type": "artifact",
          "required": false,
          "from": [
            "*"
          ],
          "placeholder": "Optional: a spec or guide to draw rules from"
        },
        {
          "name": "audience",
          "label": "Notes for the agent",
          "type": "text",
          "required": false,
          "placeholder": "Optional: what the agent will mostly do here"
        },
        {
          "name": "path",
          "label": "Write to",
          "type": "path",
          "required": false,
          "placeholder": "<root>/CLAUDE.md"
        }
      ],
      "needsOne": null,
      "next": []
    },
    {
      "id": "agents-md",
      "title": "AGENTS.md",
      "group": "agent",
      "kind": "file",
      "blurb": "Tool-neutral instructions for any coding agent working in the repo.",
      "icon": "robot",
      "layout": null,
      "filename": "AGENTS.md",
      "model": null,
      "inputs": [
        {
          "name": "root",
          "label": "Code root",
          "type": "root",
          "required": false
        },
        {
          "name": "audience",
          "label": "Notes for the agent",
          "type": "text",
          "required": false,
          "placeholder": "Optional: what agents will mostly do here"
        },
        {
          "name": "path",
          "label": "Write to",
          "type": "path",
          "required": false,
          "placeholder": "<root>/AGENTS.md"
        }
      ],
      "needsOne": null,
      "next": []
    },
    {
      "id": "skill",
      "title": "Agent skill",
      "group": "agent",
      "kind": "file",
      "blurb": "A SKILL.md that teaches an agent one procedure from the sources.",
      "icon": "spark",
      "layout": null,
      "filename": "SKILL.md",
      "model": null,
      "inputs": [
        {
          "name": "topic",
          "label": "Skill topic",
          "type": "text",
          "required": true,
          "placeholder": "e.g. adding a new API endpoint"
        },
        {
          "name": "path",
          "label": "Write to",
          "type": "path",
          "required": false,
          "placeholder": ".claude/skills/<name>/SKILL.md"
        }
      ],
      "needsOne": null,
      "next": []
    },
    {
      "id": "agent-quiz",
      "title": "Agent quiz",
      "group": "agent",
      "kind": "quiz",
      "blurb": "An eval set whose answers are checkable against the sources.",
      "icon": "target",
      "layout": null,
      "filename": null,
      "model": null,
      "inputs": [
        {
          "name": "topic",
          "label": "Topic",
          "type": "text",
          "required": false,
          "placeholder": "Optional: leave empty for the whole notebook"
        }
      ],
      "needsOne": null,
      "next": []
    },
    {
      "id": "onboarding",
      "title": "Onboarding guide",
      "group": "learn",
      "kind": "doc",
      "blurb": "A first-week guide for a developer new to these sources.",
      "icon": "compass",
      "layout": null,
      "filename": null,
      "model": null,
      "inputs": [
        {
          "name": "focus",
          "label": "Role or focus",
          "type": "text",
          "required": false,
          "placeholder": "Optional: e.g. backend contributor"
        }
      ],
      "needsOne": null,
      "next": [
        {
          "recipe": "claude-md",
          "input": "source"
        }
      ]
    },
    {
      "id": "cheat-sheet",
      "title": "Cheat sheet",
      "group": "learn",
      "kind": "doc",
      "blurb": "A dense one-pager of exact names, patterns and snippets.",
      "icon": "bolt",
      "layout": null,
      "filename": null,
      "model": null,
      "inputs": [
        {
          "name": "topic",
          "label": "Topic",
          "type": "text",
          "required": false,
          "placeholder": "Optional: leave empty for the whole notebook"
        }
      ],
      "needsOne": null,
      "next": [
        {
          "recipe": "claude-md",
          "input": "source"
        }
      ]
    },
    {
      "id": "porting-guide",
      "title": "Porting guide",
      "group": "learn",
      "kind": "doc",
      "blurb": "Move code from one version or approach to another, change by change.",
      "icon": "arrows",
      "layout": null,
      "filename": null,
      "model": null,
      "inputs": [
        {
          "name": "from",
          "label": "Porting from",
          "type": "text",
          "required": true,
          "placeholder": "e.g. version 2.x, or the old callback API"
        },
        {
          "name": "to",
          "label": "Porting to",
          "type": "text",
          "required": false,
          "placeholder": "Optional: defaults to what the sources describe"
        }
      ],
      "needsOne": null,
      "next": [
        {
          "recipe": "claude-md",
          "input": "source"
        }
      ]
    },
    {
      "id": "gotchas",
      "title": "Gotchas",
      "group": "learn",
      "kind": "doc",
      "blurb": "The traps the sources warn about, with symptoms and fixes.",
      "icon": "alert",
      "layout": null,
      "filename": null,
      "model": null,
      "inputs": [
        {
          "name": "topic",
          "label": "Topic",
          "type": "text",
          "required": false,
          "placeholder": "Optional: leave empty for the whole notebook"
        }
      ],
      "needsOne": null,
      "next": [
        {
          "recipe": "claude-md",
          "input": "source"
        }
      ]
    },
    {
      "id": "glossary",
      "title": "Glossary",
      "group": "learn",
      "kind": "doc",
      "blurb": "Every term the sources use, defined in a sentence or two.",
      "icon": "book",
      "layout": null,
      "filename": null,
      "model": null,
      "inputs": [
        {
          "name": "topic",
          "label": "Topic",
          "type": "text",
          "required": false,
          "placeholder": "Optional: leave empty for the whole notebook"
        }
      ],
      "needsOne": null,
      "next": [
        {
          "recipe": "claude-md",
          "input": "source"
        }
      ]
    },
    {
      "id": "flashcards",
      "title": "Flashcards",
      "group": "learn",
      "kind": "quiz",
      "blurb": "Short question and answer cards for spaced practice.",
      "icon": "cards",
      "layout": null,
      "filename": null,
      "model": null,
      "inputs": [
        {
          "name": "topic",
          "label": "Topic",
          "type": "text",
          "required": false,
          "placeholder": "Optional: leave empty for the whole notebook"
        }
      ],
      "needsOne": null,
      "next": []
    },
    {
      "id": "gap-report",
      "title": "Gap report",
      "group": "code",
      "kind": "doc",
      "blurb": "Where a code root and the docs disagree, citing both sides.",
      "icon": "scan",
      "layout": null,
      "filename": null,
      "model": null,
      "inputs": [
        {
          "name": "root",
          "label": "Code root",
          "type": "root",
          "required": true
        },
        {
          "name": "focus",
          "label": "Focus",
          "type": "text",
          "required": false,
          "placeholder": "Optional: an area to check"
        }
      ],
      "needsOne": null,
      "next": [
        {
          "recipe": "claude-md",
          "input": "source"
        }
      ]
    },
    {
      "id": "diff-review",
      "title": "Diff review",
      "group": "code",
      "kind": "doc",
      "blurb": "Ranked findings on a diff, each with the documented right way.",
      "icon": "diff",
      "layout": null,
      "filename": null,
      "model": null,
      "inputs": [
        {
          "name": "diff",
          "label": "Diff",
          "type": "diff",
          "required": true,
          "placeholder": "Paste a unified diff, or pick a root and a range like main..HEAD"
        }
      ],
      "needsOne": null,
      "next": [
        {
          "recipe": "claude-md",
          "input": "source"
        }
      ]
    },
    {
      "id": "build-x",
      "title": "How would I build...",
      "group": "code",
      "kind": "doc",
      "blurb": "A build guide for a new feature that reuses the patterns already here.",
      "icon": "hammer",
      "layout": null,
      "filename": null,
      "model": null,
      "inputs": [
        {
          "name": "goal",
          "label": "What to build",
          "type": "text",
          "required": true,
          "placeholder": "e.g. a rate-limited export job"
        }
      ],
      "needsOne": null,
      "next": [
        {
          "recipe": "impl-plan",
          "input": "source"
        },
        {
          "recipe": "claude-md",
          "input": "source"
        }
      ]
    },
    {
      "id": "release-notes",
      "title": "Release notes",
      "group": "code",
      "kind": "doc",
      "blurb": "User-facing release notes from a git range.",
      "icon": "megaphone",
      "layout": null,
      "filename": null,
      "model": null,
      "inputs": [
        {
          "name": "log",
          "label": "Git range",
          "type": "gitlog",
          "required": true,
          "placeholder": "A root and a range like v1.2.0..HEAD"
        },
        {
          "name": "audience",
          "label": "Audience",
          "type": "text",
          "required": false,
          "placeholder": "Optional: e.g. end users, or integrators"
        }
      ],
      "needsOne": null,
      "next": [
        {
          "recipe": "claude-md",
          "input": "source"
        }
      ]
    }
  ],
  "roots": [
    "service",
    "web"
  ]
};

export const recipes = studio.recipes;

export const artifacts = [
  {
    "id": "mock-claude-md",
    "recipe": "claude-md",
    "kind": "file",
    "status": "ok",
    "title": "CLAUDE.md",
    "inputs": {
      "root": "service"
    },
    "model": "sonnet",
    "engine": "claude-code",
    "parent": null,
    "createdAt": "2026-10-24T14:50:00.000Z",
    "updatedAt": "2026-10-24T14:50:00.000Z",
    "seconds": 40.1,
    "costUsd": 0.0811,
    "usage": {
      "input_tokens": 1600,
      "output_tokens": 2300,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 51000
    },
    "attempts": [
      {
        "phase": "generate",
        "errors": [],
        "costUsd": 0.0811,
        "seconds": 40.1
      }
    ],
    "summary": "Project memory for agents working in orders-service.",
    "data": {
      "filename": "CLAUDE.md",
      "language": "markdown",
      "notes": "Commands come from package.json scripts [^1]; the layering rule is from the architecture overview [^2].",
      "content": "# CLAUDE.md\n\norders-service is the HTTP service behind checkout. It owns orders, payments and order events.\n\n## Commands\n\n```sh\nnpm ci\nnpm run dev          # starts on :8080 with a local Postgres\nnpm test             # unit tests\nnpm run test:int     # integration tests, needs Docker\nnpm run lint\n```\n\n## Layout\n\n- `src/api` routes, validation, middleware\n- `src/domain` business rules, no IO\n- `src/store` Postgres adapters\n- `src/events` event types and the outbox relay\n- `migrations` numbered SQL files\n\n## Conventions\n\n- Handlers call a service, never a repository. See `src/api/orders.ts`.\n- Every write goes through one transaction in the service. See `src/domain/orderService.ts`.\n- Events are written to the outbox inside that transaction, never sent directly.\n- New tables get a numbered migration with an up and a down block.\n- Errors are `DomainError` subclasses mapped to HTTP codes in `src/api/errors.ts`.\n\n## Gotchas\n\n- Event delivery is at least once. Consumers must be idempotent.\n- The payment call needs the order id as its idempotency key.\n- Integration tests share one database; never rely on row counts.\n\n## Where to look things up\n\n- Architecture: `docs/architecture/overview.md`\n- Realtime: `docs/architecture/realtime.md`\n- Rate limits: `docs/api/rate-limits.md`\n"
    },
    "citations": [
      {
        "n": 1,
        "path": "service/package.json",
        "line": 6,
        "endLine": 14,
        "quote": null,
        "status": "verified"
      },
      {
        "n": 2,
        "path": "docs/architecture/overview.md",
        "line": 22,
        "endLine": 24,
        "quote": "handlers never talk to the database directly",
        "status": "verified"
      }
    ],
    "toolCalls": []
  },
  {
    "id": "mock-invalid",
    "recipe": "dependency-graph",
    "kind": "graph",
    "status": "invalid",
    "title": "Dependency graph",
    "inputs": {
      "root": "service"
    },
    "model": "haiku",
    "engine": "claude-code",
    "parent": null,
    "createdAt": "2026-10-24T14:55:00.000Z",
    "updatedAt": "2026-10-24T14:55:00.000Z",
    "seconds": 30.2,
    "costUsd": 0.0201,
    "usage": {
      "input_tokens": 1500,
      "output_tokens": 2600,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 40000
    },
    "summary": "",
    "data": null,
    "citations": [],
    "errors": [
      "edges[3]: \"to\" \"store/pg\" is not a node id",
      "edges[7]: an edge must not point at its own node"
    ],
    "attempts": [
      {
        "phase": "generate",
        "errors": [
          "edges[3]: \"to\" \"store/pg\" is not a node id",
          "edges[7]: an edge must not point at its own node",
          "nodes[2]: \"label\" is required"
        ],
        "costUsd": 0.012,
        "seconds": 19
      },
      {
        "phase": "repair",
        "errors": [
          "edges[3]: \"to\" \"store/pg\" is not a node id",
          "edges[7]: an edge must not point at its own node"
        ],
        "costUsd": 0.0081,
        "seconds": 11.2
      }
    ],
    "raw": "The api package depends on domain...\n\n```json\n{\"title\":\"deps\",\"layout\":\"layered\",\"nodes\":[{\"id\":\"api\",\"label\":\"api\"}],\"edges\":[{\"from\":\"api\",\"to\":\"store/pg\"}]}\n```\n\n--- repair attempt ---\n\n```json\n{\"title\":\"deps\",\"layout\":\"layered\",\"nodes\":[{\"id\":\"api\",\"label\":\"api\"}],\"edges\":[{\"from\":\"api\",\"to\":\"store/pg\"}]}\n```",
    "toolCalls": []
  },
  {
    "id": "mock-flashcards",
    "recipe": "flashcards",
    "kind": "quiz",
    "status": "ok",
    "title": "Realtime sync flashcards",
    "inputs": {
      "topic": "realtime sync"
    },
    "model": "haiku",
    "engine": "claude-code",
    "parent": null,
    "createdAt": "2026-10-24T14:30:00.000Z",
    "updatedAt": "2026-10-24T14:30:00.000Z",
    "seconds": 18.8,
    "costUsd": 0.0142,
    "usage": {
      "input_tokens": 900,
      "output_tokens": 1700,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 40100
    },
    "attempts": [
      {
        "phase": "generate",
        "errors": [],
        "costUsd": 0.0142,
        "seconds": 18.8
      }
    ],
    "summary": "Cards for the realtime layer.",
    "data": {
      "title": "Realtime sync flashcards",
      "questions": [
        {
          "id": "c1",
          "q": "What is a topic?",
          "kind": "short",
          "answer": "A named stream of events, one per entity such as a list",
          "explain": "Topics map one to one to channels [^1]."
        },
        {
          "id": "c2",
          "q": "What delivery guarantee does the relay give?",
          "kind": "short",
          "answer": "At least once",
          "explain": "So clients must dedupe [^2]."
        },
        {
          "id": "c3",
          "q": "How does a client ignore a duplicate event?",
          "kind": "short",
          "answer": "It compares the entity version and skips older or equal ones",
          "explain": "Versions are monotonic per entity."
        },
        {
          "id": "c4",
          "q": "What does a client receive first after reconnecting?",
          "kind": "short",
          "answer": "A full snapshot of the entity",
          "explain": "Then live events resume."
        },
        {
          "id": "c5",
          "q": "When is topic membership checked?",
          "kind": "short",
          "answer": "On subscribe",
          "explain": "Not per message."
        },
        {
          "id": "c6",
          "q": "Why ping every 15 seconds?",
          "kind": "short",
          "answer": "Proxies close idle sockets",
          "explain": "Heartbeats keep the connection open [^3]."
        }
      ]
    },
    "citations": [
      {
        "n": 1,
        "path": "docs/architecture/realtime.md",
        "line": 14,
        "endLine": 16,
        "quote": "Each topic maps to one channel and fans out to every subscriber",
        "status": "verified"
      },
      {
        "n": 2,
        "path": "docs/architecture/realtime.md",
        "line": 3,
        "endLine": 4,
        "quote": "Delivery is at least once",
        "status": "verified"
      },
      {
        "n": 3,
        "path": "docs/architecture/realtime.md",
        "line": 40,
        "endLine": 40,
        "quote": "send a ping every 15 seconds",
        "status": "verified"
      }
    ],
    "toolCalls": []
  },
  {
    "id": "mock-quiz",
    "recipe": "agent-quiz",
    "kind": "quiz",
    "status": "ok",
    "title": "orders-service: agent quiz",
    "inputs": {},
    "model": "haiku",
    "engine": "claude-code",
    "parent": null,
    "createdAt": "2026-10-24T14:20:00.000Z",
    "updatedAt": "2026-10-24T14:20:00.000Z",
    "seconds": 26.3,
    "costUsd": 0.0187,
    "usage": {
      "input_tokens": 1100,
      "output_tokens": 2400,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 41000
    },
    "attempts": [
      {
        "phase": "generate",
        "errors": [],
        "costUsd": 0.0187,
        "seconds": 26.3
      }
    ],
    "summary": "Six questions on the parts of the service a newcomer is most likely to get wrong.",
    "data": {
      "title": "orders-service: agent quiz",
      "questions": [
        {
          "id": "q1",
          "q": "Where must a handler send a database write?",
          "kind": "single",
          "options": [
            "Straight to Postgres",
            "Through OrderService",
            "Through the outbox relay",
            "Through the router"
          ],
          "answer": "Through OrderService",
          "explain": "Handlers never talk to the database directly; the service owns transactions [^1].",
          "ref": "service/src/domain/orderService.ts#L18"
        },
        {
          "id": "q2",
          "q": "Which statements about event delivery are true?",
          "kind": "multi",
          "options": [
            "Delivery is at least once",
            "Events are sent before commit",
            "Clients must apply events idempotently",
            "Events are never retried"
          ],
          "answer": [
            "Delivery is at least once",
            "Clients must apply events idempotently"
          ],
          "explain": "The outbox relays after commit and may resend [^2]."
        },
        {
          "id": "q3",
          "q": "What header carries the idempotency key for charges?",
          "kind": "short",
          "answer": "Idempotency-Key",
          "explain": "Set from the order id in PaymentsClient [^3].",
          "ref": "service/src/domain/payments.ts#L19"
        },
        {
          "id": "q4",
          "q": "How often does the realtime server ping idle sockets?",
          "kind": "single",
          "options": [
            "Every 5 seconds",
            "Every 15 seconds",
            "Every 60 seconds"
          ],
          "answer": "Every 15 seconds",
          "explain": "Proxies close idle sockets otherwise [^4]."
        },
        {
          "id": "q5",
          "q": "Which interface does PgOrderRepository implement?",
          "kind": "short",
          "answer": "OrderRepository",
          "explain": "The domain depends on the port, not the Postgres class.",
          "ref": "service/src/store/pgOrderRepository.ts#L14"
        },
        {
          "id": "q6",
          "q": "Which layer may import from store?",
          "kind": "single",
          "options": [
            "api",
            "domain",
            "events",
            "none of the listed"
          ],
          "answer": "domain",
          "explain": "Layering runs api to domain to store [^1]."
        }
      ]
    },
    "citations": [
      {
        "n": 1,
        "path": "docs/architecture/overview.md",
        "line": 22,
        "endLine": 24,
        "quote": "handlers never talk to the database directly",
        "status": "verified"
      },
      {
        "n": 2,
        "path": "docs/architecture/realtime.md",
        "line": 3,
        "endLine": 4,
        "quote": "Delivery is at least once",
        "status": "verified"
      },
      {
        "n": 3,
        "path": "service/src/domain/payments.ts",
        "line": 15,
        "endLine": 21,
        "quote": null,
        "status": "verified"
      },
      {
        "n": 4,
        "path": "docs/architecture/realtime.md",
        "line": 40,
        "endLine": 40,
        "quote": "send a ping every 15 seconds",
        "status": "verified"
      }
    ],
    "toolCalls": []
  },
  {
    "id": "mock-plan",
    "recipe": "impl-plan",
    "kind": "plan",
    "status": "ok",
    "title": "Shared lists: implementation plan",
    "inputs": {
      "source": "mock-prd"
    },
    "model": "opus",
    "engine": "claude-code",
    "parent": "mock-prd",
    "createdAt": "2026-10-24T14:00:00.000Z",
    "updatedAt": "2026-10-24T14:40:00.000Z",
    "seconds": 92.7,
    "costUsd": 0.531,
    "usage": {
      "input_tokens": 5200,
      "output_tokens": 6100,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 63000
    },
    "attempts": [
      {
        "phase": "generate",
        "errors": [],
        "costUsd": 0.531,
        "seconds": 92.7
      }
    ],
    "checked": {
      "T1#0": true,
      "T1#1": true,
      "T2#0": true
    },
    "summary": "Ship membership and invites first behind a flag, then realtime, then polish. The main risk is fan-out cost on large lists [^1].",
    "data": {
      "title": "Shared lists: implementation plan",
      "goal": "Households can share a list, see changes live and know who added each item.",
      "phases": [
        {
          "name": "Membership",
          "tasks": [
            {
              "id": "T1",
              "title": "Add list_members table and migration",
              "detail": "New table keyed by list and user with a role column, following the existing migration style [^2].",
              "files": [
                "service/migrations/0031_list_members.sql",
                "service/src/store/lists.ts"
              ],
              "dependsOn": [],
              "ref": "service/src/store/lists.ts#L8",
              "estimate": "S",
              "acceptance": [
                "Migration runs up and down cleanly",
                "lists.test.ts covers member insert and delete"
              ]
            },
            {
              "id": "T2",
              "title": "Check membership in list routes",
              "detail": "Replace owner checks with a member-or-owner check in the list handlers.",
              "files": [
                "service/src/api/lists.ts"
              ],
              "dependsOn": [
                "T1"
              ],
              "estimate": "M",
              "acceptance": [
                "An editor can add items",
                "A stranger gets 404"
              ]
            },
            {
              "id": "T3",
              "title": "Signed invite links",
              "detail": "Reuse the token signer with a 7 day expiry and a list scope [^3].",
              "files": [
                "service/src/auth/tokens.ts",
                "service/src/api/invites.ts"
              ],
              "dependsOn": [
                "T1"
              ],
              "ref": "service/src/auth/tokens.ts#L22",
              "estimate": "M",
              "acceptance": [
                "Expired links are refused",
                "Revoked links are refused"
              ]
            }
          ]
        },
        {
          "name": "Realtime",
          "tasks": [
            {
              "id": "T4",
              "title": "Publish item changes per list topic",
              "detail": "Write an ItemChanged event to the outbox in the same transaction.",
              "files": [
                "service/src/events/types.ts",
                "service/src/domain/listService.ts"
              ],
              "dependsOn": [
                "T2"
              ],
              "estimate": "M",
              "acceptance": [
                "Event row written with the item change"
              ]
            },
            {
              "id": "T5",
              "title": "Subscribe the web client to the list topic",
              "detail": "Join the topic on list open, apply events by version.",
              "files": [
                "web/src/lists/useListLive.ts"
              ],
              "dependsOn": [
                "T4"
              ],
              "estimate": "L",
              "acceptance": [
                "Two browsers see an added item within 1 s",
                "Duplicate events are ignored"
              ]
            }
          ]
        },
        {
          "name": "Polish and verify",
          "tasks": [
            {
              "id": "T6",
              "title": "Show who added each item",
              "detail": "Render addedBy and a relative time on each row.",
              "files": [
                "web/src/lists/ItemRow.tsx"
              ],
              "dependsOn": [
                "T5"
              ],
              "estimate": "S",
              "acceptance": [
                "Name and time visible",
                "Screen reader reads the name"
              ]
            },
            {
              "id": "T7",
              "title": "Load test fan-out at 50 members",
              "detail": "Script 50 subscribers and measure server p95.",
              "files": [
                "service/load/shared-lists.js"
              ],
              "dependsOn": [
                "T5"
              ],
              "estimate": "M",
              "acceptance": [
                "p95 under 200 ms server side"
              ]
            },
            {
              "id": "T8",
              "title": "Remove the feature flag",
              "detail": "Turn on for everyone after a week at 10%.",
              "files": [
                "service/src/flags.ts"
              ],
              "dependsOn": [
                "T6",
                "T7"
              ],
              "estimate": "S",
              "acceptance": [
                "Flag deleted",
                "Dashboards show no error spike"
              ]
            }
          ]
        }
      ]
    },
    "citations": [
      {
        "n": 1,
        "path": "docs/architecture/realtime.md",
        "line": 52,
        "endLine": 54,
        "quote": "fan-out cost grows with subscribers",
        "status": "verified"
      },
      {
        "n": 2,
        "path": "service/migrations/0030_soft_delete.sql",
        "line": 1,
        "endLine": 18,
        "quote": null,
        "status": "verified"
      },
      {
        "n": 3,
        "path": "service/src/auth/tokens.ts",
        "line": 22,
        "endLine": 40,
        "quote": null,
        "status": "verified"
      }
    ],
    "toolCalls": []
  },
  {
    "id": "mock-sequence",
    "recipe": "sequence-diagram",
    "kind": "sequence",
    "status": "ok",
    "title": "Placing an order",
    "inputs": {
      "feature": "placing an order and charging the card"
    },
    "model": "sonnet",
    "engine": "claude-code",
    "parent": null,
    "createdAt": "2026-10-24T13:20:00.000Z",
    "updatedAt": "2026-10-24T13:20:00.000Z",
    "seconds": 33,
    "costUsd": 0.0962,
    "usage": {
      "input_tokens": 1800,
      "output_tokens": 2900,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 52000
    },
    "attempts": [
      {
        "phase": "generate",
        "errors": [],
        "costUsd": 0.0962,
        "seconds": 33
      }
    ],
    "summary": "The charge happens before the order commits; the event goes out through the outbox after commit [^1].",
    "data": {
      "title": "Placing an order",
      "actors": [
        {
          "id": "web",
          "label": "Web client",
          "kind": "user"
        },
        {
          "id": "api",
          "label": "OrdersHandler",
          "kind": "component"
        },
        {
          "id": "svc",
          "label": "OrderService",
          "kind": "class"
        },
        {
          "id": "pay",
          "label": "Payment provider",
          "kind": "external"
        },
        {
          "id": "db",
          "label": "Postgres",
          "kind": "external"
        },
        {
          "id": "relay",
          "label": "Outbox relay",
          "kind": "process"
        }
      ],
      "steps": [
        {
          "from": "web",
          "to": "api",
          "label": "POST /orders",
          "ref": "service/src/api/orders.ts#L22"
        },
        {
          "from": "api",
          "to": "api",
          "label": "validate body",
          "note": "Rejects unknown fields [^2]"
        },
        {
          "from": "api",
          "to": "svc",
          "label": "placeOrder(cmd)",
          "ref": "service/src/domain/orderService.ts#L31"
        },
        {
          "from": "svc",
          "to": "pay",
          "label": "createCharge(total)",
          "note": "Idempotency key = order id"
        },
        {
          "from": "pay",
          "to": "svc",
          "label": "charge ok"
        },
        {
          "from": "svc",
          "to": "db",
          "label": "BEGIN; insert order; insert outbox row; COMMIT",
          "ref": "service/src/store/pgOrderRepository.ts#L40"
        },
        {
          "from": "svc",
          "to": "api",
          "label": "Order"
        },
        {
          "from": "api",
          "to": "web",
          "label": "201 Created"
        },
        {
          "from": "relay",
          "to": "db",
          "label": "poll outbox",
          "async": true
        },
        {
          "from": "relay",
          "to": "web",
          "label": "OrderPlaced via realtime channel",
          "async": true,
          "note": "At least once [^1]"
        }
      ]
    },
    "citations": [
      {
        "n": 1,
        "path": "docs/architecture/overview.md",
        "line": 30,
        "endLine": 33,
        "quote": "events leave through the outbox after the transaction commits",
        "status": "verified"
      },
      {
        "n": 2,
        "path": "service/src/api/validate.ts",
        "line": 7,
        "endLine": 12,
        "quote": null,
        "status": "verified"
      }
    ],
    "toolCalls": []
  },
  {
    "id": "mock-concept-map",
    "recipe": "concept-map",
    "kind": "graph",
    "status": "ok",
    "title": "Realtime sync concepts",
    "inputs": {
      "topic": "realtime sync"
    },
    "model": "haiku",
    "engine": "claude-code",
    "parent": null,
    "createdAt": "2026-10-24T13:00:00.000Z",
    "updatedAt": "2026-10-24T13:00:00.000Z",
    "seconds": 21.4,
    "costUsd": 0.0213,
    "usage": {
      "input_tokens": 1200,
      "output_tokens": 2050,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 40100
    },
    "attempts": [
      {
        "phase": "generate",
        "errors": [],
        "costUsd": 0.0213,
        "seconds": 21.4
      }
    ],
    "summary": "Realtime sync rests on topics and subscriptions; delivery guarantees come from the outbox, not the socket [^1].",
    "data": {
      "title": "Realtime sync concepts",
      "layout": "radial",
      "nodes": [
        {
          "id": "sync",
          "label": "Realtime sync",
          "kind": "concept",
          "group": "core",
          "detail": "Keeping every open client current without reloads [^1]."
        },
        {
          "id": "topic",
          "label": "Topic",
          "kind": "concept",
          "group": "routing",
          "detail": "A named stream, one per list or order."
        },
        {
          "id": "sub",
          "label": "Subscription",
          "kind": "concept",
          "group": "routing",
          "detail": "A client listening on a topic."
        },
        {
          "id": "channel",
          "label": "Channel",
          "kind": "class",
          "group": "transport",
          "detail": "Server object that fans out to subscribers."
        },
        {
          "id": "socket",
          "label": "WebSocket",
          "kind": "external",
          "group": "transport",
          "detail": "The browser connection."
        },
        {
          "id": "heartbeat",
          "label": "Heartbeat",
          "kind": "concept",
          "group": "transport",
          "detail": "Ping every 15 s keeps proxies from closing idle sockets [^2]."
        },
        {
          "id": "outbox",
          "label": "Outbox",
          "kind": "concept",
          "group": "delivery",
          "detail": "Events are stored with the data change, then relayed."
        },
        {
          "id": "ack",
          "label": "At-least-once",
          "kind": "concept",
          "group": "delivery",
          "detail": "Clients may see a message twice."
        },
        {
          "id": "idem",
          "label": "Idempotent apply",
          "kind": "concept",
          "group": "delivery",
          "detail": "Clients ignore versions they already have."
        },
        {
          "id": "version",
          "label": "Version number",
          "kind": "concept",
          "group": "state",
          "detail": "Monotonic per entity."
        },
        {
          "id": "snapshot",
          "label": "Snapshot",
          "kind": "concept",
          "group": "state",
          "detail": "Full state sent on reconnect."
        },
        {
          "id": "auth",
          "label": "Topic auth",
          "kind": "concept",
          "group": "security",
          "detail": "Membership is checked on subscribe."
        }
      ],
      "edges": [
        {
          "from": "sync",
          "to": "topic",
          "label": "organised by"
        },
        {
          "from": "sync",
          "to": "channel",
          "label": "runs on"
        },
        {
          "from": "topic",
          "to": "sub",
          "label": "has"
        },
        {
          "from": "channel",
          "to": "socket",
          "label": "writes to"
        },
        {
          "from": "socket",
          "to": "heartbeat",
          "label": "requires"
        },
        {
          "from": "sync",
          "to": "outbox",
          "label": "guaranteed by"
        },
        {
          "from": "outbox",
          "to": "ack",
          "label": "gives"
        },
        {
          "from": "ack",
          "to": "idem",
          "label": "requires"
        },
        {
          "from": "idem",
          "to": "version",
          "label": "uses"
        },
        {
          "from": "sub",
          "to": "snapshot",
          "label": "starts with"
        },
        {
          "from": "sub",
          "to": "auth",
          "label": "checked by"
        }
      ]
    },
    "citations": [
      {
        "n": 1,
        "path": "docs/architecture/realtime.md",
        "line": 3,
        "endLine": 4,
        "quote": "Delivery is at least once",
        "status": "verified"
      },
      {
        "n": 2,
        "path": "docs/architecture/realtime.md",
        "line": 40,
        "endLine": 40,
        "quote": "send a ping every 15 seconds",
        "status": "verified"
      }
    ],
    "toolCalls": []
  },
  {
    "id": "mock-code-map",
    "recipe": "code-map",
    "kind": "graph",
    "status": "ok",
    "title": "orders-service code map",
    "inputs": {
      "root": "service"
    },
    "model": "sonnet",
    "engine": "claude-code",
    "parent": null,
    "createdAt": "2026-10-24T12:30:00.000Z",
    "updatedAt": "2026-10-24T12:30:00.000Z",
    "seconds": 48.9,
    "costUsd": 0.1874,
    "usage": {
      "input_tokens": 2210,
      "output_tokens": 4630,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 58800
    },
    "attempts": [
      {
        "phase": "generate",
        "errors": [],
        "costUsd": 0.1874,
        "seconds": 48.9
      }
    ],
    "summary": "The service is layered: HTTP handlers in `api` call use cases in `domain`, which persist through `store` and publish to `events` [^1]. Start at `OrderService`, which every handler goes through [^2].",
    "data": {
      "title": "orders-service code map",
      "layout": "layered",
      "nodes": [
        {
          "id": "api",
          "label": "api",
          "kind": "package",
          "group": "api",
          "detail": "HTTP routes and request validation."
        },
        {
          "id": "router",
          "label": "Router",
          "kind": "class",
          "group": "api",
          "ref": "service/src/api/router.ts#L12",
          "refStatus": "verified",
          "detail": "Maps routes to handlers and applies middleware [^3]."
        },
        {
          "id": "ordersHandler",
          "label": "OrdersHandler",
          "kind": "class",
          "group": "api",
          "ref": "service/src/api/orders.ts#L9",
          "refStatus": "verified",
          "detail": "Create, read and cancel orders."
        },
        {
          "id": "rateLimit",
          "label": "rateLimit",
          "kind": "class",
          "group": "api",
          "ref": "service/src/api/middleware/rateLimit.ts#L4",
          "refStatus": "verified",
          "detail": "Token bucket per API key."
        },
        {
          "id": "domain",
          "label": "domain",
          "kind": "package",
          "group": "domain",
          "detail": "Business rules with no IO."
        },
        {
          "id": "orderService",
          "label": "OrderService",
          "kind": "class",
          "group": "domain",
          "ref": "service/src/domain/orderService.ts#L18",
          "refStatus": "verified",
          "detail": "The use case layer every handler calls [^2]."
        },
        {
          "id": "order",
          "label": "Order",
          "kind": "class",
          "group": "domain",
          "ref": "service/src/domain/order.ts#L5",
          "refStatus": "verified",
          "detail": "Aggregate with status transitions."
        },
        {
          "id": "pricing",
          "label": "PricingPolicy",
          "kind": "interface",
          "group": "domain",
          "ref": "service/src/domain/pricing.ts#L3",
          "refStatus": "verified",
          "detail": "Strategy for totals, taxes and discounts."
        },
        {
          "id": "orderPlaced",
          "label": "OrderPlaced",
          "kind": "event",
          "group": "events",
          "ref": "service/src/events/types.ts#L11",
          "refStatus": "verified",
          "detail": "Published after an order commits."
        },
        {
          "id": "store",
          "label": "store",
          "kind": "package",
          "group": "store",
          "detail": "Persistence adapters."
        },
        {
          "id": "orderRepo",
          "label": "OrderRepository",
          "kind": "interface",
          "group": "store",
          "ref": "service/src/store/orderRepository.ts#L6",
          "refStatus": "verified",
          "detail": "Port the domain depends on."
        },
        {
          "id": "pgRepo",
          "label": "PgOrderRepository",
          "kind": "class",
          "group": "store",
          "ref": "service/src/store/pgOrderRepository.ts#L14",
          "refStatus": "verified",
          "detail": "Postgres implementation with row locking."
        },
        {
          "id": "outbox",
          "label": "Outbox",
          "kind": "class",
          "group": "events",
          "ref": "service/src/events/outbox.ts#L20",
          "refStatus": "moved",
          "detail": "Writes events in the same transaction, then relays them [^1]."
        },
        {
          "id": "events",
          "label": "events",
          "kind": "package",
          "group": "events",
          "detail": "Event types and the outbox relay."
        },
        {
          "id": "payments",
          "label": "PaymentsClient",
          "kind": "class",
          "group": "domain",
          "ref": "service/src/domain/payments.ts#L8",
          "refStatus": "verified",
          "detail": "Wraps the payment provider API."
        },
        {
          "id": "postgres",
          "label": "Postgres",
          "kind": "external",
          "group": "external",
          "detail": "Primary database."
        },
        {
          "id": "provider",
          "label": "Payment provider",
          "kind": "external",
          "group": "external",
          "detail": "Card payments over HTTPS."
        },
        {
          "id": "queue",
          "label": "Message queue",
          "kind": "external",
          "group": "external",
          "detail": "Receives relayed events."
        }
      ],
      "edges": [
        {
          "from": "api",
          "to": "router",
          "label": "contains",
          "kind": "contains"
        },
        {
          "from": "api",
          "to": "ordersHandler",
          "label": "contains",
          "kind": "contains"
        },
        {
          "from": "router",
          "to": "rateLimit",
          "label": "uses",
          "kind": "uses"
        },
        {
          "from": "router",
          "to": "ordersHandler",
          "label": "registers",
          "kind": "registers"
        },
        {
          "from": "ordersHandler",
          "to": "orderService",
          "label": "uses",
          "kind": "uses"
        },
        {
          "from": "domain",
          "to": "orderService",
          "label": "contains",
          "kind": "contains"
        },
        {
          "from": "domain",
          "to": "order",
          "label": "contains",
          "kind": "contains"
        },
        {
          "from": "orderService",
          "to": "order",
          "label": "creates",
          "kind": "creates"
        },
        {
          "from": "orderService",
          "to": "pricing",
          "label": "uses",
          "kind": "uses"
        },
        {
          "from": "orderService",
          "to": "orderRepo",
          "label": "uses",
          "kind": "uses"
        },
        {
          "from": "orderService",
          "to": "payments",
          "label": "uses",
          "kind": "uses"
        },
        {
          "from": "orderService",
          "to": "orderPlaced",
          "label": "fires",
          "kind": "fires"
        },
        {
          "from": "store",
          "to": "orderRepo",
          "label": "contains",
          "kind": "contains"
        },
        {
          "from": "pgRepo",
          "to": "orderRepo",
          "label": "implements",
          "kind": "implements"
        },
        {
          "from": "pgRepo",
          "to": "postgres",
          "label": "uses",
          "kind": "uses"
        },
        {
          "from": "events",
          "to": "outbox",
          "label": "contains",
          "kind": "contains"
        },
        {
          "from": "events",
          "to": "orderPlaced",
          "label": "contains",
          "kind": "contains"
        },
        {
          "from": "orderPlaced",
          "to": "outbox",
          "label": "written to",
          "kind": "uses"
        },
        {
          "from": "outbox",
          "to": "queue",
          "label": "relays to",
          "kind": "uses"
        },
        {
          "from": "payments",
          "to": "provider",
          "label": "calls",
          "kind": "uses"
        }
      ]
    },
    "citations": [
      {
        "n": 1,
        "path": "docs/architecture/overview.md",
        "line": 22,
        "endLine": 24,
        "quote": "handlers never talk to the database directly",
        "status": "verified"
      },
      {
        "n": 2,
        "path": "service/src/domain/orderService.ts",
        "line": 18,
        "endLine": 64,
        "quote": null,
        "status": "verified"
      },
      {
        "n": 3,
        "path": "service/src/api/router.ts",
        "line": 12,
        "endLine": 40,
        "quote": null,
        "status": "verified"
      }
    ],
    "toolCalls": [
      {
        "id": "t1",
        "name": "Glob",
        "summary": "Glob \"**/*.ts\" in service",
        "ok": true,
        "chars": 2400
      },
      {
        "id": "t2",
        "name": "Grep",
        "summary": "Grep \"export (class|interface)\" in service",
        "ok": true,
        "chars": 3810
      }
    ]
  },
  {
    "id": "mock-prd",
    "recipe": "prd",
    "kind": "doc",
    "status": "ok",
    "title": "Shared lists: PRD",
    "inputs": {
      "idea": "Let households share a shopping list in the web app, with live updates and who-added-what."
    },
    "model": "opus",
    "engine": "claude-code",
    "parent": null,
    "createdAt": "2026-10-24T12:00:00.000Z",
    "updatedAt": "2026-10-24T12:00:00.000Z",
    "seconds": 74.2,
    "costUsd": 0.4121,
    "usage": {
      "input_tokens": 4120,
      "output_tokens": 3870,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 61200
    },
    "attempts": [
      {
        "phase": "generate",
        "errors": [],
        "costUsd": 0.4121,
        "seconds": 74.2
      }
    ],
    "summary": "",
    "markdown": "# Shared lists: PRD\n\nHouseholds already keep shopping lists in the app, but each list belongs to one account. This PRD adds **shared lists**: a list owner invites other people, everyone sees changes within a second, and each item shows who added it. It builds on the existing list model and the realtime channel the app already uses for notifications [^1].\n\n## Problem\n\nPeople shop for each other. Today one person keeps the list and the rest send messages (\"we're out of milk\"), which get lost. Support tickets tagged *lists* mention sharing in about a third of cases (assumption, from the ticket export in the brief).\n\n## Users and jobs\n\n| User | Job |\n|---|---|\n| List owner | Keep one list the whole household trusts |\n| Contributor | Add an item the moment they notice it is missing |\n| Shopper | Work through the list in the store without duplicates |\n\n## Goals\n\n- Invite up to 10 people to a list by email or link.\n- Changes appear for everyone within 1 second on a normal connection.\n- Every item shows who added it and when.\n\n## Non-goals\n\n- Shared budgets or prices.\n- Offline merge for edits made by two people on the same item (last write wins in this release).\n\n## User stories\n\n1. **As an owner, I want to invite people by link so that they can join without an account setup step.**\n   - The link expires after 7 days.\n   - The owner can revoke it at any time.\n2. **As a contributor, I want my additions to appear for everyone straight away so that nobody buys twice.**\n   - A new item appears on other open devices within 1 second.\n   - The item shows the contributor's display name.\n3. **As a shopper, I want to tick items off so that others see what is already in the cart.**\n   - Ticked items move to a \"Done\" section for everyone.\n\n## Requirements\n\n| ID | Requirement | Priority | Notes |\n|---|---|---|---|\n| R1 | Lists have members with a role: owner or editor | Must | Extends the list table [^2] |\n| R2 | Invite links are single-list, signed and expiring | Must | Reuse the token signer [^3] |\n| R3 | Item changes are pushed over the realtime channel | Must | Channel per list id [^1] |\n| R4 | Item rows store `addedBy` and `addedAt` | Must | |\n| R5 | Owner can remove a member | Should | |\n| R6 | Activity feed per list | Could | Later release |\n\n## Non-functional requirements\n\n- **Performance:** fan-out to 10 members under 200 ms server side.\n- **Security:** invite tokens are signed with the existing key rotation; members never see each other's email addresses.\n- **Accessibility:** live updates announce politely to screen readers.\n\n## What the sources already give us\n\n- A realtime channel keyed by topic, already used for notifications [^1].\n- The list and item tables, with soft delete [^2].\n- A token signer with expiry for password resets that can sign invite links [^3].\n- Rate limiting middleware on all write routes [^4].\n\n## Risks and open questions\n\n| Question | Why it matters | How to resolve |\n|---|---|---|\n| Do we cap members per list? | Fan-out cost | Load test with 50 members |\n| What happens to a shared list when the owner deletes their account? | Data loss for others | Product decision before build |\n\n## Success metrics\n\n- 25% of active households have a shared list within 60 days.\n- Duplicate purchases reported in feedback drop by half.\n- Realtime p95 delivery under 1 second.\n",
    "citations": [
      {
        "n": 1,
        "path": "docs/architecture/realtime.md",
        "line": 14,
        "endLine": 16,
        "quote": "Each topic maps to one channel and fans out to every subscriber",
        "status": "verified"
      },
      {
        "n": 2,
        "path": "service/src/store/lists.ts",
        "line": 8,
        "endLine": 31,
        "quote": null,
        "status": "verified"
      },
      {
        "n": 3,
        "path": "service/src/auth/tokens.ts",
        "line": 22,
        "endLine": 40,
        "quote": null,
        "status": "verified"
      },
      {
        "n": 4,
        "path": "docs/api/rate-limits.md",
        "line": 5,
        "endLine": 5,
        "quote": "All write routes pass through the rate limiter",
        "status": "moved"
      }
    ],
    "toolCalls": [
      {
        "id": "t1",
        "name": "Grep",
        "summary": "Grep \"channel\" in service",
        "ok": true,
        "chars": 1840
      },
      {
        "id": "t2",
        "name": "Read",
        "summary": "Read service/src/store/lists.ts",
        "ok": true,
        "chars": 3022
      },
      {
        "id": "t3",
        "name": "Read",
        "summary": "Read service/src/auth/tokens.ts 1-60",
        "ok": true,
        "chars": 2101
      }
    ]
  }
];

export const artifactList = [
  {
    "id": "mock-claude-md",
    "recipe": "claude-md",
    "title": "CLAUDE.md",
    "kind": "file",
    "status": "ok",
    "model": "sonnet",
    "costUsd": 0.0811,
    "createdAt": "2026-10-24T14:50:00.000Z",
    "updatedAt": "2026-10-24T14:50:00.000Z",
    "parent": null,
    "citations": 2
  },
  {
    "id": "mock-invalid",
    "recipe": "dependency-graph",
    "title": "Dependency graph",
    "kind": "graph",
    "status": "invalid",
    "model": "haiku",
    "costUsd": 0.0201,
    "createdAt": "2026-10-24T14:55:00.000Z",
    "updatedAt": "2026-10-24T14:55:00.000Z",
    "parent": null,
    "citations": 0
  },
  {
    "id": "mock-flashcards",
    "recipe": "flashcards",
    "title": "Realtime sync flashcards",
    "kind": "quiz",
    "status": "ok",
    "model": "haiku",
    "costUsd": 0.0142,
    "createdAt": "2026-10-24T14:30:00.000Z",
    "updatedAt": "2026-10-24T14:30:00.000Z",
    "parent": null,
    "citations": 3
  },
  {
    "id": "mock-quiz",
    "recipe": "agent-quiz",
    "title": "orders-service: agent quiz",
    "kind": "quiz",
    "status": "ok",
    "model": "haiku",
    "costUsd": 0.0187,
    "createdAt": "2026-10-24T14:20:00.000Z",
    "updatedAt": "2026-10-24T14:20:00.000Z",
    "parent": null,
    "citations": 4
  },
  {
    "id": "mock-plan",
    "recipe": "impl-plan",
    "title": "Shared lists: implementation plan",
    "kind": "plan",
    "status": "ok",
    "model": "opus",
    "costUsd": 0.531,
    "createdAt": "2026-10-24T14:00:00.000Z",
    "updatedAt": "2026-10-24T14:40:00.000Z",
    "parent": "mock-prd",
    "citations": 3
  },
  {
    "id": "mock-sequence",
    "recipe": "sequence-diagram",
    "title": "Placing an order",
    "kind": "sequence",
    "status": "ok",
    "model": "sonnet",
    "costUsd": 0.0962,
    "createdAt": "2026-10-24T13:20:00.000Z",
    "updatedAt": "2026-10-24T13:20:00.000Z",
    "parent": null,
    "citations": 2
  },
  {
    "id": "mock-concept-map",
    "recipe": "concept-map",
    "title": "Realtime sync concepts",
    "kind": "graph",
    "status": "ok",
    "model": "haiku",
    "costUsd": 0.0213,
    "createdAt": "2026-10-24T13:00:00.000Z",
    "updatedAt": "2026-10-24T13:00:00.000Z",
    "parent": null,
    "citations": 2
  },
  {
    "id": "mock-code-map",
    "recipe": "code-map",
    "title": "orders-service code map",
    "kind": "graph",
    "status": "ok",
    "model": "sonnet",
    "costUsd": 0.1874,
    "createdAt": "2026-10-24T12:30:00.000Z",
    "updatedAt": "2026-10-24T12:30:00.000Z",
    "parent": null,
    "citations": 3
  },
  {
    "id": "mock-prd",
    "recipe": "prd",
    "title": "Shared lists: PRD",
    "kind": "doc",
    "status": "ok",
    "model": "opus",
    "costUsd": 0.4121,
    "createdAt": "2026-10-24T12:00:00.000Z",
    "updatedAt": "2026-10-24T12:00:00.000Z",
    "parent": null,
    "citations": 4
  }
];

export const artifactById = Object.fromEntries(artifacts.map((a) => [a.id, a]));
