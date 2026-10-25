// PATH lookup and the claude binary search, run against a fake filesystem for each OS.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { onPath } from '../lib/which.mjs';
import { findClaude } from '../lib/engine.mjs';

const fakeFs = (...files) => { const set = new Set(files); return (f) => set.has(f); };

test('onPath scans PATH with posix separators on mac and linux', () => {
  const exists = fakeFs('/opt/homebrew/bin/rg');
  for (const platform of ['darwin', 'linux']) {
    assert.equal(onPath('rg', { platform, env: { PATH: '/usr/bin:/opt/homebrew/bin' }, exists }), '/opt/homebrew/bin/rg');
    assert.equal(onPath('fd', { platform, env: { PATH: '/usr/bin:/opt/homebrew/bin' }, exists }), null);
  }
});

test('onPath on Windows takes Path in any case, quoted entries, and only .exe or .com', () => {
  const exists = fakeFs('C:\\tools\\rg.exe', 'C:\\npm\\claude.cmd');
  assert.equal(onPath('rg', { platform: 'win32', env: { Path: 'C:\\npm;"C:\\tools"' }, exists }), 'C:\\tools\\rg.exe');
  assert.equal(onPath('claude', { platform: 'win32', env: { PATH: 'C:\\npm' }, exists }), null);
});

test('onPath with no PATH finds nothing', () => {
  assert.equal(onPath('rg', { platform: 'linux', env: {}, exists: () => true }), null);
});

test('findClaude prefers CLAUDE_BIN, then ~/.local/bin, then PATH', () => {
  const home = '/home/u';
  const env = { PATH: '/usr/local/bin', CLAUDE_BIN: '/custom/claude' };
  const all = fakeFs('/custom/claude', '/home/u/.local/bin/claude', '/usr/local/bin/claude');
  assert.equal(findClaude({ platform: 'linux', env, home, exists: all }), '/custom/claude');
  assert.equal(findClaude({ platform: 'linux', env: { PATH: env.PATH }, home, exists: all }), '/home/u/.local/bin/claude');
  assert.equal(findClaude({ platform: 'darwin', env: { PATH: env.PATH }, home, exists: fakeFs('/usr/local/bin/claude') }), '/usr/local/bin/claude');
  // a CLAUDE_BIN that does not exist falls through
  assert.equal(findClaude({ platform: 'linux', env: { CLAUDE_BIN: '/gone', PATH: env.PATH }, home, exists: fakeFs('/usr/local/bin/claude') }), '/usr/local/bin/claude');
  assert.equal(findClaude({ platform: 'linux', env: {}, home, exists: () => false }), null);
});

test('findClaude on Windows looks for claude.exe in ~/.local/bin and on Path', () => {
  const home = 'C:\\Users\\u';
  assert.equal(findClaude({ platform: 'win32', env: {}, home, exists: fakeFs('C:\\Users\\u\\.local\\bin\\claude.exe') }), 'C:\\Users\\u\\.local\\bin\\claude.exe');
  assert.equal(findClaude({ platform: 'win32', env: { Path: 'C:\\bin' }, home, exists: fakeFs('C:\\bin\\claude.exe') }), 'C:\\bin\\claude.exe');
});

test('the real filesystem check needs the execute bit off Windows', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lectern-which-'));
  try {
    const f = path.join(dir, 'tool');
    fs.writeFileSync(f, '#!/bin/sh\n');
    fs.chmodSync(f, 0o644);
    assert.equal(onPath('tool', { env: { PATH: dir } }), null);
    fs.chmodSync(f, 0o755);
    assert.equal(onPath('tool', { env: { PATH: dir } }), f);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the real filesystem check finds an .exe on Windows', { skip: process.platform !== 'win32' }, () => {
  assert.equal(onPath('node', { env: { PATH: path.dirname(process.execPath) } }).toLowerCase(), process.execPath.toLowerCase());
});

test('the grep tool without rg skips dependency folders and binaries and trims CRLF', async () => {
  const { grepTool } = await import('../lib/shelf.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lectern-grep-'));
  const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  w('src/A.java', 'class A {\r\n  // needle here\r\n}\r\n');
  w('node_modules/x/index.js', 'needle\n');
  w('bin.dat', 'needle\0\0\0');
  process.env.LECTERN_NO_RG = '1';
  try {
    const r = grepTool(dir, { pattern: 'needle' });
    assert.equal(r.text, 'src/A.java:2:  // needle here\n');
  } finally { delete process.env.LECTERN_NO_RG; fs.rmSync(dir, { recursive: true, force: true }); }
});
