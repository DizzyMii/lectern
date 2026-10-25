import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { processAnswer } from '../lib/cite.mjs';

test('a quote used as the end of a sentence keeps its words', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-'));
  fs.writeFileSync(path.join(dir, 'a.md'), 'Handlers run on the main thread by default.\n');
  const { answer } = processAnswer(dir, 'It works because [[a.md|"Handlers run on the main thread"]].\nPlain claim. [[a.md|"by default"]]', {});
  assert.match(answer, /because "Handlers run on the main thread" \[\^1\]\./);
  assert.match(answer, /Plain claim\. \[\^2\]$/);
});
