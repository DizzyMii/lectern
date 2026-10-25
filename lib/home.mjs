// Where per-user state lives: the notebook registry, base sessions and settings.
// LECTERN_HOME wins, then {"home": "..."} in ~/.lectern.json, then ~/.lectern.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CONFIG_FILE = () => path.join(os.homedir(), '.lectern.json');

export function lecternHome() {
  if (process.env.LECTERN_HOME) return path.resolve(process.env.LECTERN_HOME);
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8'));
    if (typeof c.home === 'string' && c.home.trim()) return path.resolve(os.homedir(), c.home.replace(/^~(?=$|[\\/])/, os.homedir()));
  } catch {}
  return path.join(os.homedir(), '.lectern');
}

export function ensureHome() {
  const home = lecternHome();
  fs.mkdirSync(home, { recursive: true });
  return home;
}

export const homeFile = (name) => path.join(lecternHome(), name);
