// Proof ribbon geometry (public/ui/ribbon.js). cites.js needs a DOM, so the pure parts live here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { windows, ghostOf, ribbonPath, hairPath } from '../public/ui/ribbon.js';

test('windows: a verified single line gets one line of padding', () => {
  assert.deepEqual(windows({ line: 10 }, 100), [{ a: 9, b: 11 }]);
});

test('windows: a range and the code pad', () => {
  assert.deepEqual(windows({ line: 10, endLine: 14 }, 100, 2), [{ a: 8, b: 16 }]);
});

test('windows: a long range is capped at 8 lines', () => {
  assert.deepEqual(windows({ line: 10, endLine: 40 }, 100), [{ a: 9, b: 18 }]);
});

test('windows: clamps at both ends of the file', () => {
  assert.deepEqual(windows({ line: 1 }, 100), [{ a: 1, b: 2 }]);
  assert.deepEqual(windows({ line: 100 }, 100), [{ a: 99, b: 100 }]);
});

test('windows: a near moved citation merges into one window', () => {
  assert.deepEqual(windows({ status: 'moved', line: 50, endLine: 50, citedLine: 48 }, 200), [{ a: 47, b: 51 }]);
});

test('windows: a far moved citation keeps two windows', () => {
  assert.deepEqual(windows({ status: 'moved', line: 120, endLine: 120, citedLine: 20 }, 200), [{ a: 19, b: 21 }, { a: 119, b: 121 }]);
});

test('windows: a ghost past the end of the file is dropped, and a missing or out-of-range line gives nothing', () => {
  assert.deepEqual(windows({ status: 'moved', line: 120, citedLine: 500 }, 200), [{ a: 119, b: 121 }]);
  assert.deepEqual(windows({ line: null }, 200), []);
  assert.deepEqual(windows({ line: 300 }, 200), []);
});

test('ghostOf: only moved citations ghost', () => {
  assert.equal(ghostOf({ status: 'verified', line: 96, citedLine: 92 }), null);
  assert.equal(ghostOf({ status: 'unverified', line: 96, citedLine: 92 }), null);
  assert.deepEqual(ghostOf({ status: 'moved', line: 96, citedLine: 92 }), { from: 92, to: 92 });
  assert.deepEqual(ghostOf({ status: 'moved', line: 96, citedLine: 92, endLine0: 95 }), { from: 92, to: 95 });
  assert.deepEqual(ghostOf({ status: 'moved', line: 96, line0: 90 }), { from: 90, to: 90 });
  assert.equal(ghostOf({ status: 'moved', line: 96, citedLine: 96 }), null);
  assert.equal(ghostOf(null), null);
});

test('ribbonPath: exact path, and thin spans are padded', () => {
  assert.equal(ribbonPath(40, [10, 30], [100, 120]), 'M0 10C20 10 20 100 40 100V120C20 120 20 30 0 30Z');
  const thin = ribbonPath(40, [10, 10], [50, 50]);
  assert.ok(thin.startsWith('M0 8.5'));
  assert.ok(thin.endsWith('0 11.5Z'));
  assert.equal(hairPath(40, 20, 60), 'M0 20C20 20 20 60 40 60');
});
