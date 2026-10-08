// Read-only simulation: how many schools would be flagged for meal quality if
// the "red consecutive days" window were 2 instead of 3 — on the current
// results store. Mirrors the dashboard's reporting-day rule (holidays dropped;
// today before 7 PM IST would be dropped, but doesn't apply at run time here).
// Prints 2-day and 3-day counts side by side and the schools in each.
import '../backend/config.js';
import { readResults } from '../backend/store.js';

const HOLIDAYS = new Set(['2026-10-02']);

async function main() {
  const rows = await readResults();
  const days = [...new Set(rows.map(r => r.date).filter(Boolean))]
    .filter(d => !HOLIDAYS.has(d))
    .sort();
  console.log(`[streak-sim] ${rows.length} rows · ${days.length} reporting days: ${days.join(', ')}`);

  const redBy = new Map();            // udise -> Set<date>
  const nameBy = new Map();           // udise -> school name
  for (const r of rows) {
    const u = String((r.school && r.school.udise) || '').trim();
    if (!u) continue;
    if (!nameBy.has(u) && r.school && r.school.name) nameBy.set(u, r.school.name);
    if (r.severity === 'red') (redBy.get(u) || redBy.set(u, new Set()).get(u)).add(r.date);
  }

  for (const N of [2, 3]) {
    if (days.length < N) { console.log(`\nN=${N}: not enough reporting days`); continue; }
    const window = days.slice(-N);
    const hits = [];
    for (const [u, set] of redBy) {
      if (window.every(d => set.has(d))) hits.push({ udise: u, name: nameBy.get(u) || '' });
    }
    hits.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    console.log(`\n==== N = ${N}  (window: ${window.join(', ')}) ====`);
    console.log(`schools red on EVERY one of the last ${N} reporting days: ${hits.length}`);
    hits.forEach((h, i) => console.log(`   ${String(i + 1).padStart(2)}. ${h.udise}  ${h.name}`));
  }
}

main().catch((e) => { console.error('[streak-sim] FAILED:', e); process.exit(1); });
