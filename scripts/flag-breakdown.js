// ============================================================
// Read-only: what is actually driving the red flags? Prints the count of rows
// per flag code, how many reds are ONLY the missing-GPS flag, and what the
// numbers look like if geo_missing were treated as a data-quality note rather
// than a red flag. No AI, no writes.
// Needs: GOOGLE_SERVICE_ACCOUNT_JSON, RESULTS_SHEET_ID, RESULTS_SHEET_TAB.
// ============================================================
import { readResults } from '../backend/store.js';

const RED_STREAK_DAYS = 3;
const udiseOf = (r) => (r.school && r.school.udise || '').trim();
const codesOf = (r) => (r.flags || []).map((f) => f.code);

function streakCount(redBySchool, days) {
  let n = 0;
  for (const [, set] of redBySchool) {
    for (let i = 0; i + RED_STREAK_DAYS - 1 < days.length; i++) {
      let ok = true;
      for (let k = 0; k < RED_STREAK_DAYS; k++) if (!set.has(days[i + k])) { ok = false; break; }
      if (ok) { n++; break; }
    }
  }
  return n;
}

async function main() {
  const rows = await readResults();
  const days = [...new Set(rows.map((r) => r.date).filter(Boolean))].sort();
  console.log(`[breakdown] ${rows.length} rows over ${days.length} days (${days.join(', ')})`);

  // Per-code row counts.
  const perCode = new Map();
  for (const r of rows) for (const c of new Set(codesOf(r))) perCode.set(c, (perCode.get(c) || 0) + 1);
  console.log('\n[breakdown] rows containing each flag code:');
  [...perCode.entries()].sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`   ${c.padEnd(20)} ${n}`));

  const red = rows.filter((r) => r.severity === 'red');
  const clean = rows.length - red.length;
  const geoMissingOnly = red.filter((r) => { const cs = new Set(codesOf(r)); return cs.size >= 1 && [...cs].every((c) => c === 'geo_missing'); });
  const substantive = rows.filter((r) => codesOf(r).some((c) => c !== 'geo_missing')); // has a non-GPS flag
  console.log(`\n[breakdown] current: ${red.length} red, ${clean} clean`);
  console.log(`[breakdown] reds whose ONLY flag is geo_missing: ${geoMissingOnly.length}`);
  console.log(`[breakdown] rows with at least one NON-geo_missing flag (substantive): ${substantive.length}`);

  // Daily flagged + streak, current vs. excluding geo_missing.
  const dayAvg = (isRed) => {
    const byDay = new Map();
    for (const r of rows) { const u = udiseOf(r); if (!u || !r.date) continue; if (isRed(r)) (byDay.get(r.date) || byDay.set(r.date, new Set()).get(r.date)).add(u); }
    let s = 0; for (const d of days) s += (byDay.get(d) || new Set()).size; return days.length ? s / days.length : 0;
  };
  const streak = (isRed) => {
    const rb = new Map();
    for (const r of rows) { const u = udiseOf(r); if (!u || !r.date) continue; if (isRed(r)) (rb.get(u) || rb.set(u, new Set()).get(u)).add(r.date); }
    return streakCount(rb, days);
  };
  const isRedNow = (r) => r.severity === 'red';
  const isRedSub = (r) => codesOf(r).some((c) => c !== 'geo_missing');

  console.log('\n========================================');
  console.log(`Avg schools flagged/day   — current: ${dayAvg(isRedNow).toFixed(1)}   |   excluding geo_missing: ${dayAvg(isRedSub).toFixed(1)}`);
  console.log(`Schools on 3-day streak   — current: ${streak(isRedNow)}   |   excluding geo_missing: ${streak(isRedSub)}`);
  console.log('========================================');
}

main().catch((e) => { console.error('[breakdown] FAILED:', e); process.exit(1); });
