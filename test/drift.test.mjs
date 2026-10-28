// The re-check comparison the page shows on reopen (public/ui/status.js), and the generatedAt stamp it measures sheets from.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupNotebook } from './helpers.mjs';
import { shown, changedCite, worseCite, tally, words, dayWord, compare, series } from '../public/ui/status.js';

const env = setupNotebook();
const { getNotebook } = await import('../lib/store.mjs');
const studio = await import('../lib/studio/engine.mjs');
test.after(() => env.cleanup());

const c = (status0, status, extra = {}) => ({ status0, status, ...extra });
const at = (y, m, d, h = 12) => new Date(y, m, d, h).toISOString();

test('shown folds missing into unverified and a missing status into pending', () => {
  assert.equal(shown('missing'), 'unverified');
  assert.equal(shown(undefined), 'pending');
  assert.equal(shown('moved'), 'moved');
});

test('changedCite needs a status0 and a visible change', () => {
  assert.equal(changedCite({ status: 'moved' }), false);
  assert.equal(changedCite(c('unverified', 'missing')), false);
  assert.equal(changedCite(c('verified', 'moved')), true);
  assert.equal(changedCite(null), false);
});

test('worseCite is true only when the status rank went up', () => {
  assert.equal(worseCite(c('verified', 'moved')), true);
  assert.equal(worseCite(c('moved', 'unverified')), true);
  assert.equal(worseCite(c('moved', 'verified')), false);
  assert.equal(worseCite(c('verified', 'verified')), false);
});

test('tally and words count missing as unverified and keep a fixed order', () => {
  const list = [c('verified', 'unverified'), c('verified', 'missing'), c('verified', 'verified')];
  assert.deepEqual(tally(list), { verified: 1, moved: 0, unverified: 2 });
  assert.deepEqual(tally(list, 'status0'), { verified: 3, moved: 0, unverified: 0 });
  assert.equal(words(tally([c(0, 'unverified'), c(0, 'verified'), c(0, 'verified')])), '2 verified, 1 unverified');
  assert.equal(words({ verified: 0, moved: 0, unverified: 0 }), '');
  assert.equal(words({ verified: 1, moved: 2, unverified: 3 }), '1 verified, 2 moved, 3 unverified');
});

test('dayWord gives the time today, the date this year, and the year for another year', () => {
  const now = new Date(2026, 9, 28, 15);
  assert.equal(dayWord(at(2026, 9, 28, 14), now), '14:00');
  const early = dayWord(at(2026, 9, 24), now);
  assert.ok(early && !early.includes('2026'), early);
  assert.ok(dayWord(at(2025, 9, 24), now).includes('2025'));
  assert.equal(dayWord('', now), '');
  assert.equal(dayWord('nope', now), '');
  assert.equal(dayWord(null, now), '');
});

test('compare is null when nothing changed or nothing has a status0', () => {
  assert.equal(compare([c('verified', 'verified'), c('moved', 'moved')]), null);
  assert.equal(compare([{ status: 'verified' }, { status: 'moved' }]), null);
  assert.equal(compare([]), null);
  assert.equal(compare(undefined), null);
});

test('compare words a change', () => {
  const now = new Date(2026, 9, 28, 15);
  const written = at(2026, 9, 24);
  const list = [c('verified', 'verified', { checkedAt0: written }), c('verified', 'moved', { checkedAt0: written }), c('verified', 'verified', { checkedAt0: written })];
  const r = compare(list, { now });
  assert.match(r.then, /^Written .+: 3 verified\.$/);
  assert.equal(r.now, 'Today: 2 verified, 1 moved.');
  assert.equal(r.worse, 1);
  assert.equal(r.changed, 1);
  assert.equal(r.total, 3);
  assert.deepEqual(r.bad, { verified: 0, moved: 1, unverified: 0 });
  assert.ok(r.since);
  assert.match(compare(list, { word: 'Printed', now }).then, /^Printed /);
  assert.ok(compare(list, { at0: at(2026, 9, 20), now }).then.startsWith('Written ' + dayWord(at(2026, 9, 20), now) + ': '));
});

test('compare treats an improvement as a change but not as worse', () => {
  const r = compare([c('moved', 'verified', { checkedAt0: at(2026, 9, 24) })]);
  assert.ok(r);
  assert.equal(r.worse, 0);
  assert.equal(r.changed, 1);
});

test('series is empty without drift, starts as written, and keeps the first plus the last six', () => {
  assert.deepEqual(series({ status0: 'verified' }), []);
  const cite = { status0: 'verified', line0: 92, checkedAt0: 'a0', drift: [{ at: 'a1', status: 'moved', line: 96 }, { at: 'a2', status: 'verified', line: 96 }] };
  const s = series(cite);
  assert.deepEqual(s[0], { at: 'a0', status: 'verified', line: 92 });
  assert.deepEqual(s.at(-1), { at: 'a2', status: 'verified', line: 96 });
  assert.equal(s.length, 3);
  const long = { ...cite, drift: Array.from({ length: 9 }, (_, i) => ({ at: `d${i}`, status: 'moved', line: i })) };
  const l = series(long);
  assert.equal(l.length, 7);
  assert.equal(l[0].at, 'a0');
  assert.deepEqual(l.slice(1).map((e) => e.at), ['d3', 'd4', 'd5', 'd6', 'd7', 'd8']);
});

test('a sheet records generatedAt and the first re-check measures from it', async () => {
  const nb = getNotebook('test');
  const doc = 'This is the body of the document, long enough to pass the length check for docs.';
  const answer = `# Product PRD\n\n${doc} Handlers go in the event [[docs/guide/a.md|"Register handlers in RegisterPayloadHandlersEvent."]].`;
  const impl = (opts) => {
    opts.onEvent({ type: 'delta', text: 'x' });
    const done = Promise.resolve({ answer, rawAnswer: answer, citations: [], toolCalls: [], usage: {}, costUsd: 0, sessionId: 's', seconds: 1 });
    return { done, cancel() {} };
  };
  // the scripted ask stands in for an engine, so this must not depend on a key in the shell running the tests
  process.env.LECTERN_FAKE_ENGINE = '1';
  let job;
  try { job = await studio.generate(nb, 'prd', { idea: 'A thing' }, { model: 'haiku', askImpl: impl, onEvent() {} }); } finally { delete process.env.LECTERN_FAKE_ENGINE; }
  const { id, generatedAt } = await job.done;
  assert.equal(new Date(generatedAt).toISOString(), generatedAt);
  await new Promise((r) => setTimeout(r, 5));
  const patched = studio.patchArtifact(nb, id, { title: 'Renamed' });
  assert.ok(patched.updatedAt > generatedAt);
  assert.equal(patched.generatedAt, generatedAt);
  // the quote leaves the file, so the citation drifts
  fs.writeFileSync(path.join(env.nbDir, 'docs/guide/a.md'), '# Guide A\n\nnothing to see here.\n');
  const a = studio.getArtifact(nb, id, { recheck: true });
  assert.equal(a.citations[0].status, 'unverified');
  assert.equal(a.citations[0].status0, 'verified');
  assert.equal(a.citations[0].checkedAt0, generatedAt);
  assert.equal(a.citeCheck.checkedAt0, generatedAt);
});
