// Finds an executable by name on PATH without running a shell, which or where.
import fs from 'node:fs';
import path from 'node:path';

const isExec = (file, platform) => {
  try {
    if (!fs.statSync(file).isFile()) return false;
    if (platform !== 'win32') fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch { return false; }
};

// On Windows only .exe and .com count, because spawn cannot run .cmd or .bat without a shell.
export function onPath(name, { env = process.env, platform = process.platform, exists = isExec } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  // a copied env on Windows may spell it Path
  const key = platform === 'win32' ? Object.keys(env).find((k) => k.toUpperCase() === 'PATH') : 'PATH';
  const dirs = String((key && env[key]) ?? '').split(p.delimiter).map((d) => d.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
  const names = platform === 'win32' && !/\.(exe|com)$/i.test(name) ? [`${name}.exe`, `${name}.com`] : [name];
  for (const dir of dirs) {
    for (const n of names) {
      const file = p.join(dir, n);
      if (exists(file, platform)) return file;
    }
  }
  return null;
}

export { isExec };
