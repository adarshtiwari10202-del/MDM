// ============================================================
// Flag distribution (read-only) — mirrors the dashboard's schoolFlags():
//   • reporting days = distinct dates present in the results store
//   • RED STREAK  = red on the LAST 3 consecutive reporting days
//   • MISSED DAY  = missed reporting on ANY of the last 3 reporting days
//                   (universe = roster ∪ everyone who ever submitted)
// Prints how the "schools flagged" headline number breaks down.
// Needs: GOOGLE_SERVICE_ACCOUNT_JSON, RESULTS_SHEET_ID (+ roster).
// ============================================================
import '../backend/config.js';
import { readResults } from '../backend/store.js';
import { readRoster } from '../backend/roster.js';

const RED_STREAK_DAYS = 3, RECENT_DAYS = 3;
const norm = (u) => String(u || '').trim();
const short = (d) => { try { return new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }); } catch { return d; } };

async function main() {
  const rows = await readResults();
  let roster = [];
  try { roster = await readRoster(); } catch (e) { console.log('[dist] roster load failed:', e.message); }

  const days = [...new Set(rows.map((r) => r.date).filter(Boolean))].sort();
  const redBy = new Map(), subBy = new Map();
  for (const r of rows) {
    const u = norm(r.school && r.school.udise); if (!u) continue;
    (subBy.get(u) || subBy.set(u, new Set()).get(u)).add(r.date);
    if (r.severity === 'red') (redBy.get(u) || redBy.set(u, new Set()).get(u)).add(r.date);
  }

  const redWindow = days.slice(-RED_STREAK_DAYS);
  const last3 = days.slice(-RECENT_DAYS);

  console.log(`[dist] results rows: ${rows.length}`);
  console.log(`[dist] reporting days (${days.length}): ${days.join(', ')}`);
  console.log(`[dist] red-streak window (last ${RED_STREAK_DAYS}): ${redWindow.map(short).join(', ')}`);
  console.log(`[dist] missed-day window (last ${RECENT_DAYS}): ${last3.map(short).join(', ')}`);

  const rosterU = roster.map((s) => norm(s.udise)).filter(Boolean);
  const universe = new Set([...rosterU, ...subBy.keys()]);
  console.log(`[dist] roster size: ${rosterU.length} · universe (roster ∪ submitters): ${universe.size}`);

  // Rule A — red on ALL of the last 3 reporting days
  const redSet = new Set();
  if (redWindow.length === RED_STREAK_DAYS) {
    for (const [u, set] of redBy) if (redWindow.every((d) => set.has(d))) redSet.add(u);
  }

  // Rule B — missed ANY of the last 3 reporting days
  const missedSet = new Set();
  const missedByCount = { 1: 0, 2: 0, 3: 0 };
  for (const u of universe) {
    const sub = subBy.get(u) || new Set();
    const missed = last3.filter((d) => !sub.has(d));
    if (missed.length) { missedSet.add(u); missedByCount[missed.length] = (missedByCount[missed.length] || 0) + 1; }
  }

  const both = [...redSet].filter((u) => missedSet.has(u));
  const union = new Set([...redSet, ...missedSet]);

  // per-day submission counts (context for why missed-day is large)
  console.log('\n[dist] submissions per reporting day (last 3):');
  for (const d of last3) {
    const n = [...subBy.values()].filter((s) => s.has(d)).length;
    console.log(`   ${short(d)}: ${n} schools submitted · ${universe.size - n} did not`);
  }

  console.log('\n========== FLAG DISTRIBUTION ==========');
  console.log(`TOTAL flagged (union):                 ${union.size}`);
  console.log(`  • Red on last ${RED_STREAK_DAYS} reporting days:      ${redSet.size}`);
  console.log(`  • Missed ≥1 of last ${RECENT_DAYS} reporting days: ${missedSet.size}`);
  console.log(`      – missed exactly 1 day:            ${missedByCount[1] || 0}`);
  console.log(`      – missed exactly 2 days:            ${missedByCount[2] || 0}`);
  console.log(`      – missed all 3 days:                ${missedByCount[3] || 0}`);
  console.log(`  • In BOTH categories (overlap):        ${both.length}`);
  console.log('=======================================');
}

main().catch((e) => { console.error('[dist] FAILED:', e); process.exit(1); });
