import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'lectern.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lectern-home-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const { lecternHome } = await import('../lib/home.mjs');
const { migrateFrom } = await import('../lib/migrate.mjs');
const { sourceFor } = await import('../lib/cli.mjs');

test('LECTERN_HOME wins, then ~/.lectern.json, then ~/.lectern', () => {
  const fakeHome = path.join(root, 'user');
  fs.mkdirSync(fakeHome, { recursive: true });
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, LECTERN_HOME: process.env.LECTERN_HOME };
  try {
    process.env.HOME = process.env.USERPROFILE = fakeHome;
    delete process.env.LECTERN_HOME;
    assert.equal(lecternHome(), path.join(fakeHome, '.lectern'));
    fs.writeFileSync(path.join(fakeHome, '.lectern.json'), JSON.stringify({ home: path.join(root, 'from-config') }));
    assert.equal(lecternHome(), path.join(root, 'from-config'));
    process.env.LECTERN_HOME = path.join(root, 'from-env');
    assert.equal(lecternHome(), path.join(root, 'from-env'));
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test('migrateFrom turns an old relative registry into absolute paths and keeps base sessions', () => {
  const app = path.join(root, 'spike', 'app');
  fs.mkdirSync(path.join(app, 'data'), { recursive: true });
  fs.writeFileSync(path.join(app, 'data', 'registry.json'), JSON.stringify({ notebooks: { nf: { dir: '..', title: 'NF', color: 'amber' } } }));
  fs.writeFileSync(path.join(app, 'data', 'bases.json'), JSON.stringify({ 'nf|opus|x': { sessionId: 's1' } }));
  const home = path.join(root, 'migrated');
  const r = migrateFrom(app, home);
  assert.deepEqual(r.added, ['nf']);
  const reg = JSON.parse(fs.readFileSync(path.join(home, 'registry.json'), 'utf8'));
  assert.equal(reg.notebooks.nf.dir, path.join(root, 'spike').split(path.sep).join('/'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'bases.json'), 'utf8'))['nf|opus|x'].sessionId, 's1');
  assert.deepEqual(migrateFrom(app, home).added, []);
  assert.equal(migrateFrom(path.join(root, 'nothing'), home).migrated, false);
});

test('add picks git, url, folder or file from the target', () => {
  assert.equal(sourceFor('https://github.com/neoforged/NeoForge').kind, 'git');
  assert.equal(sourceFor('git@github.com:a/b.git').kind, 'git');
  assert.equal(sourceFor('https://example.com/x.git').kind, 'git');
  assert.equal(sourceFor('https://docs.neoforged.net/docs/1.21.1/').kind, 'url');
  assert.equal(sourceFor(root).kind, 'folder');
  const f = path.join(root, 'n.md');
  fs.writeFileSync(f, '# n\n');
  assert.deepEqual(sourceFor(f), { kind: 'file', name: 'n.md', base64: Buffer.from('# n\n').toString('base64') });
  assert.throws(() => sourceFor(path.join(root, 'missing')), /not a url, folder or file/);
});

test('bin prints the version, help, and lists and creates notebooks in LECTERN_HOME', () => {
  const env = { ...process.env, LECTERN_HOME: path.join(root, 'bin-home') };
  const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { env, encoding: 'utf8' });
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(run('--version').stdout.trim(), pkg.version);
  assert.match(run('--help').stdout, /lectern serve/);
  const bogus = run('bogus');
  assert.equal(bogus.status, 2);
  assert.match(bogus.stderr, /usage:/);
  const empty = run('list');
  assert.equal(empty.status, 0);
  assert.match(empty.stdout, /No notebooks yet\. Try `lectern new <id>`/);
  const dir = path.join(root, 'anywhere', 'nb1');
  const made = run('new', 'nb1', '--title', 'Nb One', '--dir', dir);
  assert.equal(made.status, 0, made.stderr);
  // a bad value prints one line and a pointer, not the whole help
  const missing = run('add', 'nb1', path.join(root, 'does', 'not', 'exist'));
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /not a url, folder or file/);
  assert.doesNotMatch(missing.stderr, /usage:/);
  assert.match(missing.stderr, /see lectern --help/);
  const list = JSON.parse(run('list', '--json').stdout);
  assert.deepEqual(list.map((n) => [n.id, n.title]), [['nb1', 'Nb One']]);
  assert.equal(path.resolve(list[0].dir), dir);
  assert.match(run('list').stdout, /nb1 {2}Nb One {2}\(0 pinned docs in 0 files, ~0 tokens; roots: none\)/);
});

test('ask --engine is checked, never silently swapped, and costs print rounded', async () => {
  const { cliEngine, money } = await import('../lib/cli.mjs');
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.equal(cliEngine(undefined), undefined);
    assert.throws(() => cliEngine('api'), /needs ANTHROPIC_API_KEY/);
    assert.throws(() => cliEngine('gpt'), /unknown engine "gpt"/);
  } finally { if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved; }
  assert.equal(money(0.0028731400000000006), '$0.0029');
  assert.equal(money(1.234), '$1.23');
  assert.equal(money(null), '$?');
});
