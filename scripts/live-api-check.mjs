// Live check of the API engine against the real Anthropic API. Run it yourself with ANTHROPIC_API_KEY set:
//   node scripts/live-api-check.mjs [notebook] [--with-opus]
// It never prints the key. Results go to stdout and to live-api-check.json in your Lectern home (LECTERN_HOME, else ~/.lectern).
// It asks questions about the NeoForge notebook, so make that first: node bin/lectern.mjs example neoforge
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lecternHome } from '../lib/home.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(repo, 'bin', 'lectern.mjs');
const args = process.argv.slice(2);
const nb = args.find((a) => !a.startsWith('--')) ?? 'neoforge-1.21.1';
const withOpus = args.includes('--with-opus');
const home = lecternHome();
const key = process.env.ANTHROPIC_API_KEY ?? '';
if (!key) { console.error('Set ANTHROPIC_API_KEY first.'); process.exit(2); }
let registered = {};
try { registered = JSON.parse(fs.readFileSync(path.join(home, 'registry.json'), 'utf8')).notebooks ?? {}; } catch {}
if (!registered[nb]) {
  console.error(`No notebook named "${nb}" in ${home}.
This check asks questions about the NeoForge docs. Create that notebook with:
  node bin/lectern.mjs example neoforge
or pass the name of a notebook you already have: node scripts/live-api-check.mjs <notebook>
(The questions are about NeoForge payloads and attachments, so another notebook will fail the citation checks.)`);
  process.exit(2);
}
const scrub = (s) => String(s ?? '').split(key).join('[key]');

function cli(argv) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [bin, ...argv], { cwd: repo, env: process.env });
    let out = '', err = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => resolve({ code, out, err }));
  });
}
const parse = (s) => { try { return JSON.parse(s.slice(s.indexOf('{'))); } catch { return null; } };
const statuses = (cites = []) => cites.reduce((m, c) => ((m[c.status] = (m[c.status] ?? 0) + 1), m), {});

const results = [];
async function check(name, fn) {
  const t = Date.now();
  try { const r = await fn(); results.push({ name, ok: r.ok !== false, seconds: Math.round((Date.now() - t) / 100) / 10, ...r }); }
  catch (e) { results.push({ name, ok: false, seconds: Math.round((Date.now() - t) / 100) / 10, error: scrub(e.message) }); }
  const last = results.at(-1);
  console.log(`${last.ok ? 'PASS' : 'FAIL'}  ${name}  ${last.seconds}s${last.costUsd != null ? '  $' + Number(last.costUsd).toFixed(4) : ''}${last.error ? '  ' + last.error : ''}`);
}

let convId = null;
await check('fast ask on the API engine', async () => {
  const r = await cli(['ask', nb, 'Which event registers payload handlers? Cite the doc.', '--engine', 'api', '--fast', '--json']);
  const o = parse(r.out);
  if (!o) return { ok: false, error: scrub(r.err || r.out).slice(0, 600) };
  convId = o.conversationId;
  const shown = parse((await cli(['show', nb, convId, '--json'])).out);
  const engine = shown?.engine ?? shown?.turns?.at(-1)?.engine ?? null;
  return { ok: engine === 'api' && o.citations.length > 0, engine, model: o.model, costUsd: o.costUsd, citations: statuses(o.citations), usage: o.usage, answer: o.answer.slice(0, 300) };
});

await check('follow-up continues on the API engine', async () => {
  if (!convId) return { ok: false, error: 'no conversation from the first check' };
  const r = await cli(['ask', nb, 'And how do I send one from the client?', '--continue', convId, '--fast', '--json']);
  const o = parse(r.out);
  if (!o) return { ok: false, error: scrub(r.err || r.out).slice(0, 600) };
  return { ok: o.citations.length > 0, model: o.model, costUsd: o.costUsd, citations: statuses(o.citations), usage: o.usage, answer: o.answer.slice(0, 300) };
});

if (withOpus) {
  await check('deep ask on Opus', async () => {
    const r = await cli(['ask', nb, 'How do data attachments differ from capabilities in 1.21.1? Cite both docs.', '--engine', 'api', '--deep', '--json']);
    const o = parse(r.out);
    if (!o) return { ok: false, error: scrub(r.err || r.out).slice(0, 600) };
    return { ok: o.citations.length > 0, model: o.model, costUsd: o.costUsd, citations: statuses(o.citations), usage: o.usage };
  });
}

// The web server path: streaming over SSE, cancel mid-answer, and one Studio recipe.
const port = 4798;
const server = spawn(process.execPath, [bin, 'serve', '--port', String(port)], { cwd: repo, env: process.env });
let serverErr = '';
server.stderr.on('data', (d) => { serverErr += d; });
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/api/status')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }

async function sse(url, body, onEvent, signal) {
  const res = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) return;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (data) { const ev = JSON.parse(data); if (onEvent(ev) === 'stop') return; }
    }
  }
}

await check('web ask streams on the API engine', async () => {
  const seen = {}; let done = null;
  await sse(`/api/notebooks/${nb}/ask`, { question: 'What does PacketDistributor do? One paragraph.', model: 'haiku', engine: 'api' }, (ev) => { seen[ev.type] = (seen[ev.type] ?? 0) + 1; if (ev.type === 'done') done = ev; if (ev.type === 'error') throw new Error(ev.message); });
  return { ok: !!done && (seen.delta ?? 0) > 0, events: seen, costUsd: done?.costUsd, citations: statuses(done?.citations) };
});

await check('cancel mid-answer leaves the server healthy', async () => {
  const ac = new AbortController(); let deltas = 0;
  try { await sse(`/api/notebooks/${nb}/ask`, { question: 'Explain every networking class in detail.', model: 'haiku', engine: 'api' }, (ev) => { if (ev.type === 'delta' && ++deltas >= 3) { ac.abort(); return 'stop'; } }, ac.signal); } catch (e) { if (e.name !== 'AbortError') throw e; }
  await new Promise((r) => setTimeout(r, 1500));
  const status = await fetch(base + '/api/status');
  return { ok: deltas >= 1 && status.ok, deltasBeforeCancel: deltas };
});

await check('Studio glossary on the API engine', async () => {
  let done = null; const seen = {};
  await sse(`/api/notebooks/${nb}/artifacts`, { recipe: 'glossary', inputs: {}, model: 'haiku', engine: 'api' }, (ev) => { seen[ev.type] = (seen[ev.type] ?? 0) + 1; if (ev.type === 'done') done = ev; if (ev.type === 'error') throw new Error(ev.message); });
  const a = done?.artifact ?? done;
  return { ok: !!a && a.status !== 'error', status: a?.status, events: seen, costUsd: a?.costUsd, citations: statuses(a?.citations) };
});

server.kill();
const total = results.reduce((n, r) => n + (Number(r.costUsd) || 0), 0);
const report = { at: new Date().toISOString(), notebook: nb, passed: results.filter((r) => r.ok).length, of: results.length, totalCostUsd: Math.round(total * 10000) / 10000, results, serverStderr: scrub(serverErr).slice(-2000) };
fs.mkdirSync(home, { recursive: true });
fs.writeFileSync(path.join(home, 'live-api-check.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.passed}/${report.of} passed, about $${report.totalCostUsd.toFixed(3)}. Full report: ${path.join(home, 'live-api-check.json')}`);
process.exit(report.passed === report.of ? 0 : 1);
