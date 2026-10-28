// The Electron files are read as text: nothing here starts Electron or imports it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'electron');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const regexIn = (src) => {
  const m = src.match(/const HASH_RE = \/(.+)\/([a-z]*);/);
  assert.ok(m, 'HASH_RE literal found');
  return new RegExp(m[1], m[2]);
};

test('preload accepts the hashes the page writes', () => {
  const re = regexIn(read('preload.cjs'));
  for (const ok of ['#/nb', '#/nb/lx8k2-ab12cd34', '#/nb/artifact/a1', '#/my_nb.2/c-1']) assert.ok(re.test(ok), ok);
  const long = 'a'.repeat(65);
  for (const bad of ['#/', '#/nb/../x', '#/nb/a/b/c', 'javascript:alert(1)', `#/${long}`, `#/nb/${long}`, '#/nb/artifact/', ' #/nb', '#/nb\n']) assert.ok(!re.test(bad), JSON.stringify(bad));
  assert.ok(re.test(`#/${'a'.repeat(64)}`));
});

test('the main-side hash check is the same expression as the one in preload', () => {
  const a = regexIn(read('preload.cjs'));
  const b = regexIn(read('hash.mjs'));
  assert.equal(a.source, b.source);
  assert.equal(a.flags, b.flags);
});

test('preload never returns ipcRenderer to the page', () => {
  const src = read('preload.cjs');
  assert.doesNotMatch(src, /=> ipcRenderer\.on\(/);
  assert.doesNotMatch(src, /=> ipcRenderer\.once\(/);
});

test('electron entry files keep the lessons learned', () => {
  for (const f of ['main.mjs', 'tray.mjs']) {
    for (const line of read(f).split('\n')) assert.doesNotMatch(line, /^await app\.whenReady/, `${f}: nothing at the top level may await ready`);
  }
  for (const f of fs.readdirSync(dir)) assert.doesNotMatch(read(f), /ELECTRON_RUN_AS_NODE/, f);
});

test('closing the window hides it instead of quitting, and nothing quits on the last window', () => {
  const src = read('main.mjs');
  assert.doesNotMatch(src, /window-all-closed/);
  assert.match(src, /LECTERN_QUIT_ON_CLOSE/);
  assert.match(src, /e\.preventDefault\(\); win\.hide\(\)/);
});
