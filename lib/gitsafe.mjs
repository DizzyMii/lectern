// Settings for every git call Lectern makes. A repo's own .git/config can name programs for git
// to run (fsmonitor, hooks, textconv, filters), so those are switched off or the repo is refused.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homeFile } from './home.mjs';

// an empty folder in the Lectern home, used as core.hooksPath so no repo hook can run
function noHooksDir() {
  const dir = homeFile('no-hooks');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// goes before the git subcommand
export function gitConfigArgs() {
  return [
    '-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${noHooksDir()}`, '-c', 'core.pager=cat',
    '-c', 'core.symlinks=false', '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.required=false',
    '-c', 'protocol.file.allow=never', '-c', 'protocol.ext.allow=never',
  ];
}

const KEEP = new Set(['PATH', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'SYSTEMROOT', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'APPDATA', 'LOCALAPPDATA', 'SSH_AUTH_SOCK', 'LANG', 'LC_ALL']);

// a small env for git, defuddle and other helpers: no API keys, no prompts that would hang
export function childEnv(extra = {}) {
  const env = {};
  // Windows env names ignore case, so match on the upper-case name and keep the real spelling
  for (const [k, v] of Object.entries(process.env)) if (KEEP.has(k.toUpperCase())) env[k] = v;
  return {
    ...env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1',
    GIT_SSH_COMMAND: 'ssh -oBatchMode=yes', GCM_INTERACTIVE: 'never', ...extra,
  };
}

const RISKY = /^(core\.(fsmonitor|hookspath|pager|sshcommand|gitproxy|askpass|editor)|filter\..+|diff\..+\.(textconv|command)|merge\..+\.driver|include(if)?\..+|uploadpack\..+|credential\..*helper)$/i;

// Keys in the repo's own config (and anything it includes) that would make git run a program.
export function riskyConfig(dir) {
  const r = spawnSync('git', ['-C', dir, 'config', '--local', '--includes', '--list', '--name-only'], { encoding: 'utf8', windowsHide: true, timeout: 15_000, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) return [];
  return r.stdout.split(/\r?\n/).filter((k) => RISKY.test(k.trim()));
}

// "https://user:token@host/x" -> "https://host/x"; anything else comes back as it was
export function stripUserinfo(url) {
  try {
    const u = new URL(url);
    if (!u.username && !u.password) return url;
    u.username = '';
    u.password = '';
    return u.href;
  } catch { return url; }
}
