import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOP, BEAT, READ, hold, hopFrames, liveBars } from '../public/studio/sequence-play.js';

test('hopFrames on a straight arrow is two keyframes from offset 0 to 1', () => {
  const f = hopFrames([[10, 20], [110, 20]]);
  assert.deepEqual(f.map((k) => k.transform), ['translate(10.0px, 20.0px)', 'translate(110.0px, 20.0px)']);
  assert.deepEqual(f.map((k) => k.offset), [0, 1]);
});

test('hopFrames spaces a self-call by segment length', () => {
  const f = hopFrames([[0, 0], [22, 0], [22, 14], [4, 14]]);
  assert.equal(f.length, 4);
  assert.equal(f[0].offset, 0);
  assert.ok(Math.abs(f[1].offset - 22 / 54) < 1e-9);
  assert.ok(Math.abs(f[2].offset - 36 / 54) < 1e-9);
  assert.equal(f[3].offset, 1);
  assert.ok(f.every((k, i) => !i || k.offset >= f[i - 1].offset));
});

test('hopFrames with a zero-length path still spans 0 to 1', () => {
  assert.deepEqual(hopFrames([[5, 5], [5, 5]]).map((k) => k.offset), [0, 1]);
});

test('liveBars opens a bar when its call lands and closes it when the reply leaves', () => {
  const bars = [{ actor: 1, from: 1, to: 4 }];
  const live = (i, landed) => liveBars(bars, i, landed)[0];
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => live(i, false)), [false, false, true, true, false, false]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => live(i, true)), [false, true, true, true, false, false]);
});

test('liveBars handles nested calls', () => {
  const bars = [{ actor: 1, from: 0, to: 3 }, { actor: 2, from: 1, to: 2 }];
  assert.deepEqual(liveBars(bars, 1, false), [true, false]);
  assert.deepEqual(liveBars(bars, 1, true), [true, true]);
  assert.deepEqual(liveBars(bars, 2, false), [true, false]);
  assert.deepEqual(liveBars(bars, 3, false), [false, false]);
});

test('hold rests longer after the drawer opens and under reduced motion', () => {
  assert.equal(hold(false, false), BEAT);
  assert.equal(hold(true, false), READ);
  assert.equal(hold(false, true), READ);
  assert.equal(HOP, 320);
});
