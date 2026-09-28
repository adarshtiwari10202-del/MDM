// ============================================================
// Read-only flag statistics over the stored results.
//   (1) average number of schools flagged (red) per reporting day
//   (2) number of schools with a red flag on 3 consecutive reporting days
// Mirrors the dashboard's logic exactly (RED_STREAK_DAYS, reporting days =
// distinct dates present in the data). No AI, no writes.
// Needs: GOOGLE_SERVICE_ACCOUNT_JSON, RESULTS_SHEET_ID, RESULTS_SHEET_TAB.
// ============================================================
import { readResults } from '../backend/store.js';

const RED_STREAK_DAYS = 3;
const udiseOf = (r) => (r.school && r.school.udise || '').trim();

async function main() {
  const rows = await readResults();
  console.log(`[stats] ${rows.length} stored rows`);

  // Reporting days = distinct dates that appear in the data, sorted.
  const days = [...new Set(rows.map((r) => r.date).filter(Boolean))].sort();
  console.log(`[stats] ${days.length} reporting days: ${days.join(', ')}`);

  // Per day: distinct schools with at least one RED submission that day.
  const redByDay = new Map();      // date -> Set(udise)
  const subByDay = new Map();      // date -> Set(udise) (any submission)
  const redBySchool = new Map();   // udise -> Set(date) with a red flag
  for (const r of rows) {
    const u = udiseOf(r); if (!u || !r.date) continue;
    (subByDay.get(r.date) || subByDay.set(r.date, new Set()).get(r.date)).add(u);
    if (r.severity === 'red') {
      (redByDay.get(r.date) || redByDay.set(r.date, new Set()).get(r.date)).add(u);
      (redBySchool.get(u) || redBySchool.set(u, new Set()).get(u)).add(r.date);
    }
  }

  console.log('\n[stats] per-day flagged (distinct red schools / schools that submitted):');
  let sumRed = 0;
  for (const d of days) {
    const red = (redByDay.get(d) || new Set()).size;
    const sub = (subByDay.get(d) || new Set()).size;
    sumRed += red;
    console.log(`   ${d}: ${red} flagged / ${sub} submitted`);
  }
  const avg = days.length ? sumRed / days.length : 0;

  // 3-consecutive-reporting-day red streak (dashboard Rule A).
  let streakSchools = 0;
  const streakList = [];
  for (const [u, set] of redBySchool) {
    let has = false;
    for (let i = 0; i + RED_STREAK_DAYS - 1 < days.length; i++) {
      let ok = true;
      for (let k = 0; k < RED_STREAK_DAYS; k++) if (!set.has(days[i + k])) { ok = false; break; }
      if (ok) { has = true; break; }
    }
    if (has) { streakSchools++; streakList.push(u); }
  }

  console.log('\n========================================');
  console.log(`(1) Schools flagged on average per day : ${avg.toFixed(1)}  (total red-school-days ${sumRed} over ${days.length} days)`);
  console.log(`(2) Schools red on ${RED_STREAK_DAYS} consecutive days   : ${streakSchools}`);
  console.log('========================================');
  if (streakList.length) console.log(`[stats] streak UDISEs: ${streakList.join(', ')}`);
}

main().catch((e) => { console.error('[stats] FAILED:', e); process.exit(1); });
