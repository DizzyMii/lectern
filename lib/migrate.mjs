// Moves an old checkout's data/registry.json and data/bases.json into LECTERN_HOME.
// Old registries held dirs relative to the app folder; the new one holds absolute paths.
import fs from 'node:fs';
import path from 'node:path';
import { lecternHome } from './home.mjs';
import { readJson, writeJson, toPosix } from './store.mjs';

export function migrateFrom(oldAppDir, home = lecternHome()) {
  const appDir = path.resolve(oldAppDir);
  const oldReg = readJson(path.join(appDir, 'data', 'registry.json'), null);
  if (!oldReg) return { migrated: false, reason: `no data/registry.json in ${appDir}` };
  const regFile = path.join(home, 'registry.json');
  const reg = readJson(regFile, { notebooks: {} });
  reg.notebooks ??= {};
  const added = [];
  for (const [id, entry] of Object.entries(oldReg.notebooks ?? {})) {
    if (reg.notebooks[id]) continue;
    reg.notebooks[id] = { ...entry, dir: toPosix(path.resolve(appDir, entry.dir)) };
    added.push(id);
  }
  writeJson(regFile, reg);
  const oldBases = readJson(path.join(appDir, 'data', 'bases.json'), null);
  let bases = 0;
  if (oldBases) {
    const basesFile = path.join(home, 'bases.json');
    const merged = { ...oldBases, ...readJson(basesFile, {}) };
    writeJson(basesFile, merged);
    bases = Object.keys(oldBases).length;
  }
  return { migrated: true, home, added, bases };
}

export const hasHomeRegistry = (home = lecternHome()) => fs.existsSync(path.join(home, 'registry.json'));
