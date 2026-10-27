// Builds dist/Lectern.exe, a Node single executable application (nodejs.org/api/single-executable-applications.html)
// for whatever platform runs this. The app goes in as one asset: the files npm would publish plus the
// production dependencies. scripts/sea-main.cjs unpacks and runs it.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const sh = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
fs.mkdirSync(dist, { recursive: true });

const files = JSON.parse(sh('npm pack --dry-run --json --ignore-scripts'))[0].files.map((f) => f.path);
// each production package folder once; nested node_modules show up as their own entries
const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(path.join(d, e.name), out); }
    else if (e.isFile()) out.push(path.join(d, e.name));
  }
  return out;
};
for (const dep of sh('npm ls --omit=dev --all --parseable').split(/\r?\n/).filter(Boolean).slice(1)) {
  if (fs.existsSync(dep)) for (const f of walk(dep)) files.push(path.relative(root, f));
}

const rels = [...new Set(files.map((f) => f.split(path.sep).join('/')))];
const datas = rels.map((r) => fs.readFileSync(path.join(root, r)));
const head = Buffer.from(JSON.stringify(rels.map((r, i) => [r, datas[i].length])));
const len = Buffer.alloc(4);
len.writeUInt32LE(head.length);
const packed = zlib.gzipSync(Buffer.concat([len, head, ...datas]), { level: 9 });
fs.writeFileSync(path.join(dist, 'app.bin'), packed);
fs.writeFileSync(path.join(dist, 'id.txt'), crypto.createHash('sha256').update(packed).digest('hex').slice(0, 12));
console.log(`packed ${rels.length} files, ${(packed.length / 1048576).toFixed(1)} MB`);

fs.writeFileSync(path.join(dist, 'sea-config.json'), JSON.stringify({
  main: path.join(root, 'scripts', 'sea-main.cjs'),
  output: path.join(dist, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
  assets: { 'app.bin': path.join(dist, 'app.bin'), id: path.join(dist, 'id.txt') },
}));
sh(`"${process.execPath}" --experimental-sea-config "${path.join(dist, 'sea-config.json')}"`);

const exe = path.join(dist, process.platform === 'win32' ? 'Lectern.exe' : 'lectern');
fs.copyFileSync(process.execPath, exe);
// ponytail: Windows and Linux only; macOS also needs the signature stripped and redone around this
sh(`npx --yes postject@1.0.0-alpha.6 "${exe}" NODE_SEA_BLOB "${path.join(dist, 'sea-prep.blob')}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`);
// mark it a GUI program so Windows opens no console window for it (PE optional header Subsystem = 2)
if (process.platform === 'win32') {
  const buf = fs.readFileSync(exe);
  buf.writeUInt16LE(2, buf.readUInt32LE(0x3c) + 0x5c);
  fs.writeFileSync(exe, buf);
}
console.log(`built ${path.relative(root, exe)}`);
