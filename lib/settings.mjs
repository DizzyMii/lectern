// Settings saved from the page, in settings.json in the home folder. Each one is an environment
// variable, so the rest of Lectern keeps reading process.env. A saved value wins over the
// environment, and clearing it puts back whatever the environment had.
import fs from 'node:fs';
import { ensureHome, homeFile } from './home.mjs';
import { httpError } from './store.mjs';

export const SETTINGS = [
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API key', secret: true, help: 'Create one at console.anthropic.com. It stays on this machine, in settings.json in the home folder.' },
  { key: 'ANTHROPIC_WORKSPACE_ID', label: 'Workspace id', help: 'Only for a key that isn’t tied to a workspace. Starts with wrkspc_.' },
  { key: 'LECTERN_PREFER_CLAUDE_CODE', label: 'Use my Claude Code login', bool: true, help: 'Answer with the Claude Code login on this machine even when an API key is set, so it bills your plan. Personal use only.' },
  { key: 'CLAUDE_BIN', label: 'Claude Code binary', help: 'Path to claude, when it isn’t on PATH. Takes effect after a restart.' },
  { key: 'LECTERN_PROJECTS_DIR', label: 'Projects folder', help: 'Where the first-run screen looks for projects. Your home folder when empty.' },
  { key: 'LECTERN_CLONE_MAX_MB', label: 'Clone size cap (MB)', help: 'A git checkout over this gets deleted again. 1024 when empty.' },
  { key: 'LECTERN_ALLOW_PRIVATE_URLS', label: 'Allow private URLs', bool: true, help: 'Lets Add URL fetch intranet and localhost pages.' },
  { key: 'PORT', label: 'Port', help: 'For lectern serve and Lectern.exe. 4317 when empty. Takes effect after a restart.' },
  { key: 'LECTERN_QUIT_ON_CLOSE', label: 'Quit when the window closes', bool: true, help: 'Desktop app only. Off by default: closing the window keeps Lectern in the system tray, watching your code roots. After a git pull or a save moves the citations in saved answers it shows a notification. Quit from the tray menu.' },
];
const KEYS = new Set(SETTINGS.map((s) => s.key));
const FILE = () => homeFile('settings.json');
const fromEnv = { ...process.env };

function read() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    return Object.fromEntries(Object.entries(s).filter(([k, v]) => KEYS.has(k) && typeof v === 'string'));
  } catch { return {}; }
}

export function applySettings() {
  for (const [k, v] of Object.entries(read())) process.env[k] = v;
}

// What the page sees. A secret comes back as its last four characters, never whole.
export function listSettings() {
  const saved = read();
  return SETTINGS.map((s) => {
    const v = saved[s.key] ?? '';
    const env = fromEnv[s.key] ?? '';
    return { ...s, value: s.secret ? '' : v, set: Boolean(v), hint: s.secret && v ? `…${v.slice(-4)}` : '', fromEnv: Boolean(env) && !v };
  });
}

// patch maps keys to a string to save or null to clear. An unknown key fails the whole save.
export function saveSettings(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw httpError(400, 'settings must be an object');
  for (const [k, v] of Object.entries(patch)) {
    if (!KEYS.has(k)) throw httpError(400, `unknown setting ${k}`);
    if (v !== null && (typeof v !== 'string' || v.length > 4096 || /[\r\n\0]/.test(v))) throw httpError(400, `bad value for ${k}`);
  }
  const saved = read();
  for (const [k, v] of Object.entries(patch)) {
    const val = v?.trim();
    if (val) { saved[k] = val; process.env[k] = val; }
    else {
      delete saved[k];
      if (fromEnv[k] === undefined) delete process.env[k]; else process.env[k] = fromEnv[k];
    }
  }
  ensureHome();
  fs.writeFileSync(FILE(), JSON.stringify(saved, null, 2) + '\n', { mode: 0o600 });
  return listSettings();
}
