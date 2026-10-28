// Saved lines in the browser helpers (public/ui/witness.js) and through a fake claude run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupNotebook } from './helpers.mjs';
import { wordDiff, readNote, citeWhy, baseNote, align, when } from '../public/ui/witness.js';
import { receiptCaption, citedByLabel } from '../public/ui/status.js';

const env = setupNotebook();

const flat = (lines) => lines.map((row) => row.map((r) => r.t).join(''));
const marked = (lines) => lines.flat().filter((r) => r.x).map((r) => r.t);

test('wordDiff marks one changed word on both sides', () => {
  const d = wordDiff('void register(Handler h) {}', 'void enroll(Handler h) {}');
  assert.deepEqual(marked(d.a), ['register']);
  assert.deepEqual(marked(d.b), ['enroll']);
  assert.deepEqual(flat(d.a), ['void register(Handler h) {}']);
  assert.deepEqual(flat(d.b), ['void enroll(Handler h) {}']);
});

test('wordDiff in a long dense block marks only the changed word', () => {
  const row = (i) => `  const v${i} = f(${i}, [a, b, c], { k: ${i} }) + g(x, y);`;
  const old = Array.from({ length: 40 }, (_, i) => row(i));
  const now = old.slice();
  now[33] = now[33].replace('g(x, y)', 'h(x, y)');
  const d = wordDiff(old.join('\n'), now.join('\n'));
  assert.equal(d.a.length, 40);
  assert.equal(d.b.length, 40);
  assert.deepEqual(marked(d.a), ['g']);
  assert.deepEqual(marked(d.b), ['h']);
  assert.equal(d.a.findIndex((r) => r.some((x) => x.x)), 33);
  assert.deepEqual(flat(d.b), now);
  // lines that were only added leave the other side's rows alone
  const ins = wordDiff('a\nb', 'a\nnew\nb');
  assert.deepEqual(flat(ins.a), ['a', 'b']);
  assert.deepEqual(flat(ins.b), ['a', 'new', 'b']);
  assert.deepEqual(marked(ins.b), ['new']);
  assert.deepEqual(marked(ins.a), []);
});

test('wordDiff never marks whitespace, so indentation is not a change', () => {
  const d = wordDiff('if (a) {\n  go();\n}', 'if (a) {\n        go();\n}');
  assert.deepEqual(marked(d.a), []);
  assert.deepEqual(marked(d.b), []);
  const spaced = wordDiff('a  b', 'a b c');
  assert.ok(spaced.a.flat().filter((r) => !r.t.trim()).every((r) => !r.x));
  assert.ok(spaced.b.flat().filter((r) => !r.t.trim()).every((r) => !r.x));
  assert.deepEqual(marked(spaced.b), ['c']);
});

test('wordDiff splits multi-line input into lines of runs', () => {
  const d = wordDiff('one\ntwo\nthree', 'one\n2\nthree\nfour');
  assert.deepEqual(flat(d.a), ['one', 'two', 'three']);
  assert.deepEqual(flat(d.b), ['one', '2', 'three', 'four']);
  assert.deepEqual(marked(d.a), ['two']);
  assert.deepEqual(marked(d.b), ['2', 'four']);
  assert.deepEqual(wordDiff('', '').a, [[]]);
  assert.deepEqual(flat(wordDiff('a\r\nb', 'a\r\nb').a), ['a', 'b']);
});

test('wordDiff marks every word when the sides are too big to align', () => {
  const big = Array.from({ length: 600 }, (_, i) => `w${i}`).join(' ');
  const d = wordDiff(big, `zz ${big}`);
  assert.equal(marked(d.a).length, 600);
  assert.equal(marked(d.b).length, 601);
  assert.ok(d.a.flat().filter((r) => !r.t.trim()).every((r) => !r.x));
  const small = Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ');
  const sd = wordDiff(small, `zz ${small}`);
  assert.equal(marked(sd.a).length, 0);
  assert.deepEqual(marked(sd.b), ['zz']);
});

test('readNote covers, partial, elsewhere, never read, doc path and unknown', () => {
  const c = (read, extra = {}) => ({ line: 30, endLine: 40, saw: { read }, ...extra });
  assert.deepEqual(readNote(c([[22, 58]]), false), { ok: true, text: 'The trail read L22-58, which covers these lines.' });
  assert.deepEqual(readNote(c([[22, 35]]), false), { ok: false, text: 'The trail read L22-35. The rest of these lines was not read.' });
  assert.deepEqual(readNote(c([[1, 120]], { line: 300, endLine: 310 }), false), { ok: false, text: 'The trail read L1-120 of this file. It never read these lines.' });
  assert.match(readNote(c([]), false).text, /^The trail never opened this file\./);
  assert.equal(readNote(c([]), false).ok, false);
  assert.equal(readNote(c([[1, 5]]), true), null);
  assert.equal(readNote({ line: 3, saw: { text: 'x' } }, false), null);
  assert.equal(readNote({ saw: { read: [] } }, false), null);
  // readNote measures from line0, where the citation started
  assert.equal(readNote(c([[1, 10]], { line: 200, endLine: 210, line0: 5, endLine0: 8 }), false).ok, true);
  assert.equal(readNote(c([[7, 7]], { line: 7, endLine: 7 }), false).text, 'The trail read L7, which covers these lines.');
  assert.match(readNote(c([[3, 3], [9, 9], [20, 22]], { line: 1, endLine: 2 }), false).text, /^The trail read L3 and L9 of this file/);
});

test('the first-saved note shows once: not under a card whose reason already says it', () => {
  const saw = { text: 'x', base: true, at: '2026-10-28T12:00:00.000Z' };
  const rewritten = { status: 'unverified', line: 90, saw };
  assert.match(citeWhy(rewritten, 'Foo.java').text, /first saved them/);
  assert.equal(baseNote(rewritten), null);
  assert.match(baseNote({ status: 'verified', line: 90, saw }), /^Lines saved on .* when this citation was first re-checked/);
  assert.match(baseNote({ status: 'moved', line: 90, saw }), /first re-checked/);
  assert.equal(baseNote({ status: 'verified', line: 90, saw: { text: 'x' } }), null);
});

test('the receipt caption does not talk about quotes for an answer with only code citations', () => {
  const code = [{ n: 1, status: 'verified', path: 'a.java', line: 3, saw: { text: 'x' } }];
  const k = { verified: 1, moved: 0, unverified: 0, pending: 0, uncited: 0, total: 1, thin: 0 };
  assert.ok(!/quote/i.test(receiptCaption(code, k)));
  assert.match(receiptCaption(code, k), /^Every citation here was found again/);
  const quote = [{ n: 1, status: 'verified', path: 'a.md', quote: 'hi', line: 3 }];
  assert.match(receiptCaption(quote, k), /^Every quote here was found again/);
});

test('the Cited by button counts what the list under it counts', () => {
  const ref = (id, turn) => ({ kind: 'conv', id, turn });
  assert.equal(citedByLabel([ref('a', 0), ref('b', 0)]), 'Cited by 2');
  const twelve = [...Array(4).keys()].flatMap((i) => [0, 1, 2].map((t) => ref('c' + i, 0 + 0 * t)));
  assert.equal(citedByLabel(twelve), 'Cited by 4 (12 citations)');
  assert.equal(citedByLabel(twelve, true), 'Cited by 4+ (12+ citations)');
});

test('citeWhy words every case, and a line citation never says Quote', () => {
  assert.equal(citeWhy({ status: 'verified' }, 'Foo.java'), null);
  assert.equal(citeWhy({ status: 'pending' }, 'Foo.java'), null);
  assert.deepEqual(citeWhy({ status: 'missing' }, 'Foo.java'), { cls: 'bad', text: 'File no longer exists at this path.', short: 'file not found' });
  assert.deepEqual(citeWhy({ status: 'moved', citedLine: 92, line: 96 }, 'Foo.java'), { cls: 'moved', text: 'Cited L92, found at L96. Same text.', short: 'cited L92, found at L96' });
  assert.deepEqual(citeWhy({ status: 'unverified', quote: 'x' }, 'a.md'), { cls: 'bad', text: 'Quote not found in a.md.', short: 'quote not found in this file' });
  const lines = { status: 'unverified', line: 3, saw: { text: 'x' } };
  assert.deepEqual(citeWhy(lines, 'Foo.java'), { cls: 'bad', text: 'These lines were rewritten after the answer was written.', short: 'lines rewritten since the answer' });
  const base = citeWhy({ ...lines, saw: { text: 'x', base: true, at: '2026-10-28T12:00:00.000Z' } }, 'Foo.java');
  assert.equal(base.text, `These lines changed after Lectern first saved them on ${when('2026-10-28T12:00:00.000Z')}. Edits before that are not visible.`);
  assert.equal(base.short, 'lines changed since first saved');
  assert.deepEqual(citeWhy({ status: 'unverified', line: 90 }, 'Foo.java'), { cls: 'bad', text: 'Foo.java no longer has these lines.', short: 'lines past the end of the file' });
  for (const c of [lines, { ...lines, saw: { base: true, at: '2026-10-28T12:00:00.000Z' } }, { status: 'unverified', line: 9 }, { status: 'moved', citedLine: 1, line: 2 }]) {
    const w = citeWhy(c, 'Foo.java');
    assert.ok(!/quote/i.test(w.text + w.short), w.text);
  }
});

test('align pads the shorter side', () => {
  assert.deepEqual(align(3, 8), { old: 5, new: 0 });
  assert.deepEqual(align(8, 3), { old: 0, new: 5 });
  assert.deepEqual(align(4, 4), { old: 0, new: 0 });
});

// ---------- through the engine: what the trail read ends up in saw.read ----------

const { ask } = await import('../lib/engine.mjs');
test.after(() => env.cleanup());
const foo = path.join(env.nbDir, 'src/java/net/x/Foo.java');

function fixture(name, calls, answer) {
  const lines = [
    { type: 'system', subtype: 'init', session_id: 'sess-w', model: 'claude-haiku-5-5' },
    { type: 'assistant', message: { id: 'm1', content: calls.map((input, i) => ({ type: 'tool_use', id: `tu${i}`, name: 'Read', input })) } },
    { type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: answer }] } },
    { type: 'result', subtype: 'success', is_error: false, result: answer, session_id: 'sess-w', total_cost_usd: 0.01, usage: { input_tokens: 5, output_tokens: 7 } },
  ];
  const f = path.join(env.root, name);
  fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return f;
}

test('a fake claude run saves what the Read tool covered, and [] when the file was never opened', async () => {
  process.env.LECTERN_FAKE_ENGINE = '1';
  process.env.LECTERN_FAKE_FIXTURE = fixture('read.jsonl', [{ file_path: foo, offset: 2, limit: 3 }], 'It is a class [[src/java/net/x/Foo.java#L3]].');
  const out = await ask({ notebook: 'test', question: 'What is Foo?', engine: 'claude-code' }).done;
  const cite = out.citations[0];
  assert.equal(cite.status, 'verified');
  assert.equal(cite.saw.text, 'public class Foo {');
  assert.deepEqual(cite.saw.read, [[2, 4]]);

  process.env.LECTERN_FAKE_FIXTURE = fixture('none.jsonl', [{ file_path: path.join(env.nbDir, 'docs/intro.md') }], 'It is a class [[src/java/net/x/Foo.java#L3]].');
  const second = await ask({ notebook: 'test', question: 'And again?', engine: 'claude-code' }).done;
  assert.deepEqual(second.citations[0].saw.read, []);

  // a later turn keeps what the earlier turns read
  process.env.LECTERN_FAKE_FIXTURE = fixture('later.jsonl', [], 'Still a class [[src/java/net/x/Foo.java#L3]].');
  const third = await ask({ notebook: 'test', question: 'Follow up?', engine: 'claude-code', conversationId: out.conversationId }).done;
  assert.deepEqual(third.citations[0].saw.read, [[2, 4]]);
});
