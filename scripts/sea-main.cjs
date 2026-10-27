// The entry point baked into Lectern.exe. The app rides along as one gzipped asset, gets unpacked
// once per build under %LOCALAPPDATA%\Lectern, and runs from there like a normal checkout.
// Lectern starts itself again by process.execPath with a script (the regex scanner, the Claude Code
// hook, defuddle), so a script path as the first argument runs that script the way node would.
const { getAsset } = require('node:sea');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const id = getAsset('id', 'utf8');
const base = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Lectern');
const dir = path.join(base, `app-${id}`);

function unpack() {
  const buf = zlib.gunzipSync(Buffer.from(getAsset('app.bin')));
  const headLen = buf.readUInt32LE(0);
  const files = JSON.parse(buf.subarray(4, 4 + headLen).toString('utf8'));
  const tmp = `${dir}.tmp-${process.pid}`;
  let at = 4 + headLen;
  for (const [rel, size] of files) {
    const out = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf.subarray(at, at + size));
    at += size;
  }
  fs.writeFileSync(path.join(tmp, 'sea-import.cjs'), 'module.exports = (u) => import(u);\n');
  try { fs.renameSync(tmp, dir); } catch { fs.rmSync(tmp, { recursive: true, force: true }); } // another copy won the race
  // older builds; one that is still running keeps its files locked and stays until next time
  for (const d of fs.readdirSync(base)) {
    if (d.startsWith('app-') && d !== path.basename(dir)) try { fs.rmSync(path.join(base, d), { recursive: true, force: true }); } catch {}
  }
}

if (!fs.existsSync(path.join(dir, 'package.json'))) unpack();

const args = process.argv.slice(2);
const asScript = /\.[cm]?js$/i.test(args[0] ?? '') && fs.existsSync(args[0]);
const script = asScript ? path.resolve(args.shift()) : path.join(dir, 'bin', 'lectern.mjs');
// a double click has no arguments, so it serves and opens the browser
process.argv = [process.execPath, script, ...(asScript || args.length ? args : ['serve', '--open'])];
createRequire(path.join(dir, 'x'))('./sea-import.cjs')(pathToFileURL(script).href).catch((e) => {
  console.error(e?.stack ?? e);
  process.exit(1);
});
