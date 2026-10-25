// API spend per notebook per calendar month, kept in LECTERN_HOME/spend.json.
// A notebook can set "budgetUsd" in notebook.json; past 80% runs carry a warning, at 100% new paid work is refused.
import fs from 'node:fs';
import path from 'node:path';
import { homeFile } from './home.mjs';
import { httpError } from './store.mjs';

export const WARN_AT = 0.8;
const FILE = () => homeFile('spend.json');

export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

function readAll() {
  try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { return {}; }
}

export function spentUsd(nbId, month = monthKey()) {
  return readAll()[month]?.[nbId]?.usd ?? 0;
}

export function addSpend(nbId, usd, month = monthKey()) {
  if (!(usd > 0)) return spentUsd(nbId, month);
  const all = readAll();
  const row = ((all[month] ??= {})[nbId] ??= { usd: 0, runs: 0 });
  row.usd = Math.round((row.usd + usd) * 1e7) / 1e7;
  row.runs += 1;
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify(all, null, 2));
  return row.usd;
}

export function budgetOf(nb) {
  const b = Number(nb.config?.budgetUsd);
  return Number.isFinite(b) && b > 0 ? b : null;
}

// { month, spentUsd, budgetUsd, fraction, state: 'none' | 'ok' | 'warn' | 'over' }
export function budgetStatus(nb, month = monthKey()) {
  const spent = spentUsd(nb.id, month);
  const budget = budgetOf(nb);
  const fraction = budget ? spent / budget : null;
  const state = !budget ? 'none' : fraction >= 1 ? 'over' : fraction >= WARN_AT ? 'warn' : 'ok';
  return { month, spentUsd: spent, budgetUsd: budget, fraction: fraction == null ? null : Math.round(fraction * 1000) / 1000, state };
}

export const warningText = (s) => `${s.month} API spend for this notebook is $${s.spentUsd.toFixed(2)} of a $${s.budgetUsd.toFixed(2)} budget (${Math.round(s.fraction * 100)}%)`;

// Throws 402 when the notebook is at or past its budget and the request did not say override.
export function checkBudget(nb, override = false) {
  const s = budgetStatus(nb);
  if (s.state === 'over' && !override) {
    const e = httpError(402, `${warningText(s)}. New paid work is paused until next month; raise budgetUsd in notebook.json or send override: true.`);
    e.budget = s;
    throw e;
  }
  return s;
}
