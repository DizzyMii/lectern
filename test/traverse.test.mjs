// The trail map model (public/ui/traverse.js): which file each tool call read, for both engines, and the drawing built from the steps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toolRead, readRanges, trailSummary, buildTraverse, stationTitle, traverseSvg } from '../public/ui/traverse.js';
import { fileKey, sourceFor } from '../public/ui/layers.js';

const nb = { title: 'T', labels: {}, dir: 'D:/nb', conversations: [],
  shelf: [{ title: 'docs', files: ['docs/a.md', 'docs/b.md'] }],
  roots: [{ name: 'code', path: 'src/java' }, { name: 'ext', path: '../ext' }] };

// the same step in both engines' shapes
const claude = {
  read: (p, extra = {}, label = p) => ({ name: 'Read', summary: `Read ${label}`, input: { file_path: 'D:/nb/' + p, ...extra } }),
  grep: (where) => ({ name: 'Grep', summary: `Grep "x" in ${where}`, input: { pattern: 'x', path: 'D:/nb/' + where } }),
  glob: (where) => ({ name: 'Glob', summary: `Glob "*" in ${where}`, input: { pattern: '*' } }),
};
const api = {
  read: (root, p, extra = {}) => ({ name: 'read', summary: `Read ${root}/${p}`, input: { root, path: p, ...extra } }),
  grep: (root) => ({ name: 'grep', summary: `Grep "x" in ${root}`, input: { root, pattern: 'x' } }),
  ls: (root, dir = '') => ({ name: 'ls', summary: `ls ${root}/${dir}`, input: { root, dir } }),
};
const build = (steps, cites, isDoc = (p) => p.startsWith('docs/')) => buildTraverse(steps, cites, nb, isDoc);

test('fileKey: both spellings of an in-notebook root file match', () => {
  assert.equal(fileKey('src/java/net/X.java', nb), 'code/net/X.java');
  assert.equal(fileKey('code/net/X.java', nb), 'code/net/X.java');
  assert.equal(fileKey('ext/lib/a.js', nb), 'ext/lib/a.js');
  assert.equal(fileKey('docs/a.md', nb), 'docs/a.md');
  assert.equal(fileKey('nowhere/x.md', nb), 'nowhere/x.md');
  assert.equal(fileKey('src\\java\\net\\X.java', nb), 'code/net/X.java');
});

test('a pinned docs folder and a code root on the same prefix: pinned files stay docs, the rest is the root', () => {
  const both = { title: 'Fastify', labels: {}, dir: 'D:/nb', conversations: [],
    shelf: [{ title: 'docs', files: ['corpus/fastify/docs/Reference/Plugins.md'] }],
    roots: [{ name: 'fastify', path: 'corpus/fastify' }] };
  assert.equal(sourceFor('corpus/fastify/docs/Reference/Plugins.md', both).kind, 'docs');
  assert.equal(sourceFor('corpus/fastify/lib/route.js', both).name, 'fastify');
  assert.equal(sourceFor('fastify/lib/route.js', both).name, 'fastify');
  // the trail map puts the cited file in the band its read was drawn in
  const m = buildTraverse([{ name: 'Read', summary: 'Read corpus/fastify/lib/route.js', input: { file_path: 'D:/nb/corpus/fastify/lib/route.js' } }],
    [{ n: 1, path: 'corpus/fastify/lib/route.js', status: 'verified' }], both, () => false);
  assert.equal(m.bands.length, 1);
  assert.equal(m.bands[0].name, 'fastify');
});

test('toolRead: claude-code shape', () => {
  const s = { name: 'Read', summary: 'Read docs/a.md 3-10', input: { file_path: 'D:/nb/docs/a.md', offset: 3, limit: 8 } };
  assert.deepEqual(toolRead(s, nb), { path: 'docs/a.md', from: 3, to: 10 });
  // no limit is Claude Code's 2000 line default
  assert.deepEqual(toolRead({ name: 'Read', input: { file_path: 'D:/nb/docs/a.md' } }, nb), { path: 'docs/a.md', from: 1, to: 2000, open: true });
  assert.deepEqual(toolRead({ name: 'Read', input: { path: 'docs/a.md', offset: 50 } }, nb), { path: 'docs/a.md', from: 50, to: 2049, open: true });
});

test('toolRead: claude-code read outside the notebook uses the summary label', () => {
  const s = { name: 'Read', summary: 'Read ext/lib/a.js 1-50', input: { file_path: 'D:/other/ext/lib/a.js', offset: 1, limit: 50 } };
  assert.equal(toolRead(s, nb).path, 'ext/lib/a.js');
  assert.equal(toolRead({ ...s, input: { file_path: '../ext/lib/a.js' } }, nb).path, 'ext/lib/a.js');
});

test('toolRead: API shape', () => {
  const s = { name: 'read', input: { root: 'code', path: 'net/X.java', start: 10 }, summary: 'Read code/net/X.java 10-' };
  assert.deepEqual(toolRead(s, nb), { path: 'code/net/X.java', from: 10, to: 209 });
  assert.equal(toolRead({ ...s, input: { ...s.input, end: 30 } }, nb).to, 30);
  assert.equal(toolRead({ ...s, input: { ...s.input, start: 5, end: 900 } }, nb).to, 304);
  assert.deepEqual(toolRead({ ...s, input: { root: 'code', path: 'net/X.java' } }, nb), { path: 'code/net/X.java', from: 1, to: 200 });
  assert.equal(toolRead({ ...s, input: { root: 'code', path: '.\\net\\X.java' } }, nb).path, 'code/net/X.java');
});

test('toolRead: stripped Studio steps and non-reads', () => {
  assert.deepEqual(toolRead({ name: 'Read', summary: 'Read docs/a.md' }, nb), { path: 'docs/a.md', from: 1, to: null });
  assert.deepEqual(toolRead({ name: 'Read', summary: 'Read docs/a.md 3-10' }, nb), { path: 'docs/a.md', from: 3, to: 10 });
  assert.deepEqual(toolRead({ name: 'Read', summary: 'Read docs/a.md 5-' }, nb), { path: 'docs/a.md', from: 5, to: 2004, open: true });
  for (const s of [{ name: 'Grep', summary: 'Grep "x" in code' }, { name: 'grep', input: { root: 'code' } }, { name: 'ls', summary: 'ls code/' },
    { name: 'Glob', summary: 'Glob "*" in code' }, { name: 'Shelf', summary: 'Loading 2 pinned documents' }, { name: 'read' }, { name: 'Read', summary: 'Read ? ' }, null]) {
    assert.equal(toolRead(s, nb), null);
  }
});

test('readRanges: merges both engines and clips to the file', () => {
  const mixed = [claude.read('src/java/net/X.java', { offset: 1, limit: 10 }), api.read('code', 'net/X.java', { start: 8, end: 20 }), api.read('code', 'net/X.java', { start: 500 })];
  assert.deepEqual(readRanges(mixed, 'code/net/X.java', 100, nb), [[1, 20]]);
  assert.deepEqual(readRanges([claude.read('docs/a.md')], 'docs/a.md', 100, nb), [[1, 100]]);
  assert.deepEqual(readRanges([{ ...claude.read('docs/a.md'), ok: false }], 'docs/a.md', 100, nb), []);
});

test('trailSummary: counts API and claude steps the same', () => {
  const a = [api.read('code', 'net/X.java'), api.read('code', 'net/X.java', { start: 50 }), api.grep('code'), api.ls('code')];
  const c = [claude.read('src/java/net/X.java'), claude.read('src/java/net/X.java', { offset: 50 }), claude.grep('src/java'), claude.glob('src/java')];
  assert.equal(trailSummary(a), 'Read 1 file, 1 search, 1 file lookup');
  assert.equal(trailSummary(c), 'Read 1 file, 1 search, 1 file lookup');
  assert.equal(trailSummary([]), 'No tool calls');
  assert.equal(trailSummary([{ name: 'Edit' }]), '1 other step');
});

test('buildTraverse: stations, visit order and leg kinds', () => {
  const m = build([api.grep('code'), api.read('code', 'net/X.java'), api.read('code', 'net/X.java', { start: 400 }), claude.read('docs/a.md'), api.grep('code')]);
  assert.deepEqual(m.stations.map((s) => [s.kind, s.path]), [['scope', 'code'], ['file', 'code/net/X.java'], ['file', 'docs/a.md']]);
  assert.equal(m.stations[1].reads.length, 2);
  assert.equal(m.stations[0].searches, 2);
  assert.deepEqual(m.legs, [{ from: 0, to: 1, kind: 'read' }, { from: 1, to: 2, kind: 'read' }, { from: 2, to: 0, kind: 'search' }]);
  assert.deepEqual(m.summary, { files: 2, searches: 2, cited: 0 });
});

test('buildTraverse: citations mark the worst status, and unread cited files are appended unjoined', () => {
  const steps = [claude.read('docs/a.md', { offset: 1, limit: 20 }), claude.read('src/java/net/X.java')];
  const cites = [{ n: 1, path: 'docs/a.md', status: 'verified' }, { n: 3, path: 'docs/a.md', status: 'moved' }, { n: 2, path: 'docs/b.md', status: 'verified' }, { n: 4, path: 'code/net/Y.java', status: 'missing' }];
  const m = build(steps, cites);
  const [x, a, b, y] = [m.stations[1], m.stations[0], m.stations[2], m.stations[3]];
  assert.equal(a.status, 'moved');
  assert.deepEqual(a.ns, [1, 3]);
  assert.equal(a.cite.n, 3);
  assert.equal(x.status, null);
  assert.equal(b.via, 'pinned');
  assert.equal(y.via, 'cited');
  assert.equal(y.status, 'unverified');
  assert.ok(b.id > 1 && y.id > b.id);
  assert.ok(!m.legs.some((l) => [b.id, y.id].includes(l.from) || [b.id, y.id].includes(l.to)));
  assert.equal(m.summary.cited, 3);
});

test('buildTraverse: both spellings land on one station', () => {
  const m = build([api.read('code', 'net/X.java'), api.grep('code')], [{ n: 1, path: 'src/java/net/X.java', status: 'verified' }]);
  assert.equal(m.stations.filter((s) => s.kind === 'file').length, 1);
  assert.equal(m.stations[0].status, 'verified');
  assert.equal(m.stations[0].via, 'trail');
});

test('buildTraverse: engines give the same map', () => {
  const a = build([api.grep('code'), api.read('code', 'net/X.java'), api.ls('code', 'net'), api.read('ext', 'lib/a.js')]);
  const c = build([
    { name: 'Grep', summary: 'Grep "x" in code', input: { pattern: 'x', path: 'D:/nb/src/java' } },
    claude.read('src/java/net/X.java', {}, 'code/net/X.java'),
    { name: 'Glob', summary: 'Glob "*" in code/net', input: { pattern: '*' } },
    { name: 'Read', summary: 'Read ext/lib/a.js', input: { file_path: 'D:/other/ext/lib/a.js' } },
  ]);
  const shape = (m) => ({ keys: m.stations.map((s) => s.key), kinds: m.stations.map((s) => s.kind), legs: m.legs });
  assert.deepEqual(shape(c), shape(a));
});

test('buildTraverse: bands follow the legend order, unmatched go last, failed and Shelf steps are skipped', () => {
  const m = build([
    { name: 'Shelf', summary: 'Starting a cached session (nothing is pinned)' },
    { name: 'Grep', summary: 'Grep "x" in notebook', input: {} },
    api.read('code', 'net/X.java'),
    { ...claude.read('docs/a.md'), ok: false },
    claude.read('docs/b.md'),
  ]);
  assert.deepEqual(m.bands.map((b) => b.name), ['Docs', 'code', 'Other']);
  assert.deepEqual(m.stations.map((s) => s.path), ['', 'code/net/X.java', 'docs/b.md']);
  assert.equal(m.stations[0].band, 2);
  assert.deepEqual(m.bands.map((b) => b.stations.length), [1, 1, 1]);
});

test('buildTraverse: a grep aimed at one file shares its station with the read', () => {
  const m = build([{ name: 'Grep', summary: 'Grep "x" in docs/a.md', input: {} }, claude.read('docs/a.md')]);
  assert.equal(m.stations.length, 1);
  assert.equal(m.stations[0].searches, 1);
  assert.equal(m.stations[0].reads.length, 1);
});

test('traverseSvg: structure and escaping', () => {
  const evil = 'docs/x<script>"&.md';
  const m = build([api.grep('code'), api.read('code', 'net/X.java'), claude.read('docs/a.md'), api.grep('code'), claude.read(evil)], [{ n: 1, path: 'docs/a.md', status: 'moved' }]);
  const svg = traverseSvg(m);
  assert.equal(svg.match(/class="tm-band"/g).length, m.bands.length);
  assert.equal(svg.match(/class="tm-leg search"/g).length, m.legs.filter((l) => l.kind === 'search').length);
  assert.ok(svg.includes('use href="/marks.svg#moved"'));
  assert.ok(svg.includes(`width="${40 + (m.stations.length - 1) * 40 + 7 * (m.stations.at(-1).ns.join(',').length || 0)}"`));
  assert.equal(stationTitle({ kind: 'file', path: 'a', reads: [[1, null]], searches: 0, status: null, ns: [], via: 'trail' }), 'a · read L1-end');
  assert.ok(svg.includes('x&lt;script&gt;&quot;&amp;.md'));
  assert.ok(!svg.includes('<script'));
  assert.ok(!/ style=/.test(svg));
});

test('traverseSvg: a long run of citation numbers does not run into the next station', () => {
  const cites = [1, 2, 3, 4].map((n) => ({ n, path: 'docs/a.md', status: 'verified' })).concat([{ n: 5, path: 'docs/b.md', status: 'verified' }]);
  const m = build([claude.read('docs/a.md'), claude.read('docs/b.md'), claude.read('docs/a.md', { offset: 5, limit: 3 })], cites);
  const svg = traverseSvg(m);
  const xs = [...svg.matchAll(/data-i="(\d+)" transform="translate\((\d+) /g)].map((g) => +g[2]);
  assert.equal(xs.length, m.stations.length);
  const a = m.stations.find((s) => s.path === 'docs/a.md');
  assert.equal(a.ns.join(','), '1,2,3,4');
  // "1,2,3,4" is 7 characters of 7px starting 11px right of its mark: the next station sits past the end of it
  assert.ok(xs[1] - xs[0] >= 11 + 7 * 7 + 9);
  const w = +/<svg[^>]* width="(\d+)"/.exec(svg)[1];
  assert.ok(w >= xs.at(-1));
});

test('stationTitle: wording', () => {
  const m = build(
    [claude.grep('code'), claude.read('docs/a.md', { offset: 1, limit: 120 }), claude.read('docs/a.md', { offset: 200, limit: 61 }), claude.grep('code')],
    [{ n: 1, path: 'docs/a.md', status: 'verified' }, { n: 2, path: 'docs/a.md', status: 'moved' }, { n: 3, path: 'docs/b.md', status: 'verified' }, { n: 4, path: 'code/net/Y.java', status: 'verified' }]);
  const by = (p) => m.stations.find((s) => s.path === p);
  assert.equal(stationTitle(by('docs/a.md')), 'docs/a.md · read L1-120, L200-260 · cited as 1, 2 (moved)');
  assert.equal(stationTitle(by('code')), 'code · searched 2 times');
  assert.equal(stationTitle(by('docs/b.md')), 'docs/b.md · cited as 3 (verified) · from the pinned docs');
  assert.equal(stationTitle(by('code/net/Y.java')), 'code/net/Y.java · cited as 4 (verified) · not opened by the trail');
  assert.equal(stationTitle({ kind: 'scope', path: '', reads: [], searches: 1, status: null, ns: [], via: 'trail' }), 'notebook · searched 1 time');
  assert.equal(stationTitle({ kind: 'file', path: 'a', reads: [[5, 5], [9, Infinity]], searches: 0, status: null, ns: [], via: 'trail' }), 'a · read L5, L9-end');
});
