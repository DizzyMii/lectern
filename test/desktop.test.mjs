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
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
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

test('every quick ask IPC handler checks the sender first', () => {
  const src = read('quick.mjs');
  for (const name of ['ready', 'hide', 'open']) {
    const at = src.indexOf(`ipcMain.on('quick:${name}'`);
    assert.ok(at >= 0, name);
    const rest = src.slice(at);
    assert.ok(rest.slice(0, rest.indexOf(';')).includes('mine(e)'), name);
  }
  assert.doesNotMatch(src, /ipcMain\.handle\(/);
});

test('quick ask passes only a checked hash on to the main window', () => {
  const src = read('quick.mjs');
  assert.match(src, /HASH_RE\.test\(hash\)/);
  assert.ok(src.indexOf('HASH_RE.test(hash)') < src.indexOf('goto(hash)'));
});

test('quick ask is off until the setting says so, and the key is released on quit', () => {
  const src = read('quick.mjs');
  assert.match(src, /LECTERN_QUICK_ASK !== '1'\) return/);
  assert.match(src, /will-quit/);
  assert.match(src, /unregisterAll/);
});

test('preload exposes the quick channels without handing over ipcRenderer', () => {
  const src = read('preload.cjs');
  for (const c of ['quick:ready', 'quick:hide', 'quick:open']) assert.ok(src.includes(`'${c}'`), c);
  assert.match(src, /ready: \(fn\) => \{ ipcRenderer\.on\('quick'/);
});
