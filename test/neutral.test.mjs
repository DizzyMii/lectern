import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BANNED = /minecraft|neoforge/i;

function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files(full, out);
    else if (/\.(m?js|html|css|json|md|svg)$/.test(e.name)) out.push(full);
  }
  return out;
}

// Lectern ships for any stack; game specific wording belongs in examples/ only
test('shipped code and UI stay neutral outside examples/', () => {
  const hits = [];
  for (const dir of ['public', 'lib', 'bin']) {
    for (const f of files(path.join(ROOT, dir))) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (BANNED.test(l)) hits.push(`${path.relative(ROOT, f)}:${i + 1}`); });
    }
  }
  assert.deepEqual(hits, []);
});

test('the system prompt takes its target from notebook.json', async () => {
  const { systemPrompt } = await import('../lib/shelf.mjs');
  const plain = systemPrompt({ roots: { code: 'src' } });
  assert.doesNotMatch(plain, /The target is/);
  assert.doesNotMatch(plain, BANNED);
  const s = systemPrompt({ roots: {}, target: 'Python 3.12 with Django 5.1', system: 'Prefer class based views.' });
  assert.match(s, /The target is Python 3\.12 with Django 5\.1\./);
  assert.match(s, /Prefer class based views\.$/);
});

test('candidates suggest framework docs from the table', async () => {
  const { candidates } = await import('../lib/sources.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lectern-cand-'));
  const mk = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  try {
    mk('api/package.json', JSON.stringify({ version: '1.2.0', dependencies: { express: '^5.0.0' } }));
    mk('svc/Cargo.toml', '[package]\nname = "svc"\nversion = "0.3.1"\n\n[dependencies]\naxum = "0.8"\n');
    mk('site/pyproject.toml', '[project]\nname = "site"\nversion = "2.0.0"\ndependencies = ["Django>=5.1", "requests"]\n');
    mk('game/gradle.properties', 'minecraft_version=1.21.1\nneo_version=21.1.77\nmod_version=4.7.1\n');
    mk('plain/gradle.properties', 'version=1.0\n');
    const c = candidates([dir]);
    const byName = Object.fromEntries(c.roots.map((r) => [r.name, r]));
    assert.equal(byName.api.version, '1.2.0');
    assert.equal(byName.svc.version, '0.3.1');
    assert.equal(byName.site.version, '2.0.0');
    const labels = c.docs.map((d) => d.label).sort();
    assert.deepEqual(labels, ['Django docs', 'Express API', 'docs.neoforged.net/docs/1.21.1', 'docs.rs/axum']);
    assert.ok(c.docs.every((d) => /^https:\/\//.test(d.url) && !d.url.includes('{')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('every example is well formed', async () => {
  const { listExamples, readExample } = await import('../lib/examples.mjs');
  const names = listExamples();
  assert.ok(names.includes('neoforge') && names.includes('node-docs'));
  for (const n of names) {
    const ex = readExample(n);
    assert.match(ex.id, /^[a-z0-9][a-z0-9._-]{0,63}$/, n);
    assert.ok(ex.title && ex.sources.length, n);
    for (const s of ex.sources) {
      assert.match(s.name, /^[\w.-]+$/, `${n} source name`);
      assert.ok(Boolean(s.git) !== Boolean(s.fetch), `${n}/${s.name} is git or fetch`);
      assert.ok(s.pin?.length || Object.keys(s.roots ?? {}).length, `${n}/${s.name} pins or roots something`);
      if (s.fetch) assert.ok(s.files?.length, `${n}/${s.name} files`);
    }
  }
  assert.equal(readExample('neoforge').target, 'Minecraft 1.21.1 with NeoForge 21.1');
  assert.equal(readExample('../package'), null);
});
