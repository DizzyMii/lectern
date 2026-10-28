// Quick ask: the fast flag on the ask route, and the page-side pieces that Node can load.
// The popup window and the hotkey are Electron and are checked by hand (docs/SETUP.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupNotebook, FIXTURE } from './helpers.mjs';
import { flat, restore } from '../public/ui/quicktext.js';

const env = setupNotebook();
const lines = fs.readFileSync(FIXTURE, 'utf8').trim().split('\n');
const fixture = path.join(env.root, 'fixture.jsonl');
fs.writeFileSync(fixture, lines.join('\n') + '\n');
process.env.LECTERN_FAKE_ENGINE = '1';
process.env.LECTERN_FAKE_FIXTURE = fixture;

const { createServer } = await import('../lib/server.mjs');
const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); env.cleanup(); });

// asks, then returns the turn the server saved
async function turnFor(body) {
  const res = await fetch(`${base}/api/notebooks/test/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Which event?', ...body }) });
  const text = await res.text();
  const done = text.split('\n\n').filter((b) => b.startsWith('event: done')).map((b) => JSON.parse(b.split('\n')[1].slice(6)))[0];
  assert.ok(done?.conversationId, text);
  return (await (await fetch(`${base}/api/conversations/test/${done.conversationId}`)).json()).turns[0];
}

test('ask with fast:true runs the fast preset and plain asks keep the defaults', async () => {
  const fast = await turnFor({ fast: true });
  assert.deepEqual([fast.model, fast.effort, fast.maxTurns], ['haiku', 'low', 4]);
  const plain = await turnFor({});
  assert.deepEqual([plain.model, plain.effort, plain.maxTurns], ['opus', null, 12]);
  const loose = await turnFor({ fast: 'yes' });
  assert.deepEqual([loose.model, loose.effort, loose.maxTurns], ['opus', null, 12]);
  const named = await turnFor({ fast: true, model: 'sonnet' });
  assert.deepEqual([named.model, named.effort, named.maxTurns], ['sonnet', 'low', 4]);
});

test('flat joins lines and trims', () => {
  assert.equal(flat('  Error: boom\n    at a (x.js:1)\r\n\tat b  \n'), 'Error: boom at a (x.js:1) at b');
  assert.equal(flat(''), '');
  assert.equal(flat(null), 'null');
});

test('restore swaps the original lines back after a typed prefix', () => {
  const full = 'Error: boom\n  at a (x.js:1)\n  at b';
  const short = flat(full);
  assert.equal(restore('why: ' + short, short, full), 'why: ' + full);
  assert.equal(restore(short, short, full), full);
  assert.equal(restore('  ' + short + '  ', short, full), full);
});

test('restore leaves an edited or empty paste alone', () => {
  const full = 'a\nb';
  const short = flat(full);
  assert.equal(restore(short + ' and then', short, full), short + ' and then');
  assert.equal(restore('why', '', ''), 'why');
  assert.equal(restore('why', '', 'x'), 'why');
});

// dom.js decides quick mode once, when it loads, so each mode gets its own copy of the module
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); } };

test('in quick mode store.set writes nothing and store.get still reads', async () => {
  globalThis.location = { search: '?quick=1' };
  mem.set('nb.lastNotebook', JSON.stringify('test'));
  const { store, quickMode } = await import('../public/ui/dom.js?quick');
  assert.equal(quickMode, true);
  store.set('conv.test', 'abc');
  store.set('lastNotebook', 'other');
  assert.equal(mem.has('nb.conv.test'), false);
  assert.equal(store.get('lastNotebook', null), 'test');
});

test('outside quick mode it writes through', async () => {
  globalThis.location = { search: '' };
  const { store, quickMode } = await import('../public/ui/dom.js?plain');
  assert.equal(quickMode, false);
  store.set('conv.test', 'abc');
  assert.equal(store.get('conv.test', null), 'abc');
  assert.equal(mem.get('nb.conv.test'), '"abc"');
});
