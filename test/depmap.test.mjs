import test from 'node:test';
import assert from 'node:assert/strict';
import { lineMap, refsIn, worst, shown } from '../public/ui/status.js';

const ref = (line, endLine, status = 'verified', id = 'c1') => ({ kind: 'answer', id, line, endLine, status });

test('lineMap puts a ref on every line of its range with start only on the first', () => {
  const m = lineMap([ref(3, 5)]);
  assert.deepEqual([...m.keys()], [3, 4, 5]);
  assert.deepEqual([...m.values()].map((e) => e.start), [true, false, false]);
  assert.ok([...m.values()].every((e) => e.refs.length === 1 && e.status === 'verified'));
  assert.deepEqual([...lineMap([ref(7, null)]).keys()], [7]);
});

test('overlapping refs merge, the worst status wins, and start is true if any range starts there', () => {
  const m = lineMap([ref(3, 6, 'verified', 'a'), ref(5, 8, 'moved', 'b'), ref(6, 6, 'unverified', 'c'), ref(4, 4, 'missing', 'd')]);
  assert.equal(m.get(3).status, 'verified');
  assert.equal(m.get(4).status, 'unverified');
  assert.equal(m.get(5).status, 'moved');
  assert.equal(m.get(6).status, 'unverified');
  assert.equal(m.get(8).status, 'moved');
  assert.deepEqual(m.get(6).refs.map((r) => r.id), ['a', 'b', 'c']);
  assert.equal(m.get(5).start, true);
  assert.equal(m.get(6).start, true);
  assert.equal(m.get(7).start, false);
});

test('ranges clamp to the line count and to 400 lines, and a ref past the end or without a line is skipped', () => {
  assert.deepEqual([...lineMap([ref(8, 20)], 10).keys()], [8, 9, 10]);
  const long = lineMap([ref(1, 5000)]);
  assert.equal(long.size, 400);
  assert.ok(long.has(400) && !long.has(401));
  assert.equal(lineMap([ref(11, 12)], 10).size, 0);
  assert.equal(lineMap([ref(null, null), ref(0, 3), undefined, null]).size, 0);
  assert.equal(lineMap(undefined).size, 0);
});

test('refsIn returns refs overlapping a block span and none outside it', () => {
  const refs = [ref(2, 4, 'verified', 'a'), ref(10, 10, 'verified', 'b'), ref(null, null, 'verified', 'c'), ref(12, 20, 'verified', 'd')];
  assert.deepEqual(refsIn(refs, 4, 9).map((r) => r.id), ['a']);
  assert.deepEqual(refsIn(refs, 5, 9), []);
  assert.deepEqual(refsIn(refs, 10, 12).map((r) => r.id), ['b', 'd']);
  assert.deepEqual(refsIn(undefined, 1, 2), []);
});

test('shown and worst', () => {
  assert.equal(shown('missing'), 'unverified');
  assert.equal(shown(undefined), 'pending');
  assert.equal(worst(['verified', 'moved']), 'moved');
  assert.equal(worst(['moved', 'missing', 'verified']), 'unverified');
  assert.equal(worst([]), 'verified');
});
