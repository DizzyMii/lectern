// Builds a throwaway notebook and registry in a temp dir and points the app at it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function setupNotebook() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-test-'));
  const nbDir = path.join(root, 'nb');
  const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(nbDir, rel)), { recursive: true }); fs.writeFileSync(path.join(nbDir, rel), text); };
  w('notebook.json', JSON.stringify({ name: 'test', title: 'Test Notebook', pinned: ['docs/**/*.md'], roots: { code: 'src/java' } }));
  w('docs/guide/a.md', '# Guide A\n\nhello world, this is the\nfirst   guide about payloads.\n\nRegister handlers in RegisterPayloadHandlersEvent.\n');
  w('docs/guide/b.md', '# Guide B\n\nSecond guide.\n');
  w('docs/intro.md', '# Intro\n\nWelcome.\n');
  w('src/java/net/x/Foo.java', 'package net.x;\n\npublic class Foo {\n  void payload() {}\n}\n');
  w('secret.txt', 'outside the shelf\n');
  fs.writeFileSync(path.join(root, 'outside.md'), 'not in the notebook\n');
  const appDir = path.join(root, 'app');
  fs.mkdirSync(path.join(appDir, 'data'), { recursive: true });
  const registry = path.join(appDir, 'data', 'registry.json');
  fs.writeFileSync(registry, JSON.stringify({ notebooks: { test: { dir: '../nb', title: 'Test Notebook', color: 'amber' } } }));
  process.env.NB_REGISTRY = registry;
  process.env.NB_DATA_ROOT = root;
  return { root, nbDir, registry, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

export const FIXTURE = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'fixtures', 'stream.jsonl');
