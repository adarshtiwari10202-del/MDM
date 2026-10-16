// ============================================================
// Read-only flag statistics over the stored results.
//   (1) average number of schools flagged (red) per reporting day
//   (2) number of schools with a red flag on 3 consecutive reporting days
// Mirrors the dashboard's logic exactly (RED_STREAK_DAYS, reporting days =
// distinct dates present in the data). No AI, no writes.
// Needs: GOOGLE_SERVICE_ACCOUNT_JSON, RESULTS_SHEET_ID, RESULTS_SHEET_TAB.
// ============================================================
import { readResults } from '../backend/store.js';
import fs from 'node:fs';
import path from 'node:path';

const RED_STREAK_DAYS = 3;
const MIN_REPORTING_SUBS = 25;
const HOLIDAYS = new Set(['2026-10-02']);
const isSunday = (d) => { try { return new Date(d + 'T12:00:00Z').getUTCDay() === 0; } catch (e) { return false; } };
const udiseOf = (r) => (r.school && r.school.udise || '').trim();

async function main() {
  const rows = await readResults();
  console.log(`[stats] ${rows.length} stored rows`);

  // Reporting days = distinct dates present, minus Sundays, holidays and
  // outage days (<MIN_REPORTING_SUBS submissions) — matches the dashboard.
  const subCount = new Map();
  for (const r of rows) { const u = udiseOf(r); if (!u || !r.date) continue; (subCount.get(r.date) || subCount.set(r.date, new Set()).get(r.date)).add(u); }
  const days = [...new Set(rows.map((r) => r.date).filter(Boolean))]
    .filter((d) => !isSunday(d) && !HOLIDAYS.has(d) && (subCount.get(d) || new Set()).size >= MIN_REPORTING_SUBS)
    .sort();
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

  // CURRENT rolling-window streak: schools red on the LAST RED_STREAK_DAYS
  // reporting days (matches the dashboard tile), not any-streak-ever.
  const lastWindow = days.slice(-RED_STREAK_DAYS);
  let currentStreak = 0;
  if (lastWindow.length === RED_STREAK_DAYS) {
    for (const [, set] of redBySchool) if (lastWindow.every((d) => set.has(d))) currentStreak++;
  }

  // Per-anchor-day 3-consecutive-day streak: for every reporting day D that has
  // two prior reporting days, how many schools were red on D and both prior
  // reporting days. This is the "new 3-day-streak schools, measured each day".
  const streakByDay = [];
  for (let i = RED_STREAK_DAYS - 1; i < days.length; i++) {
    const win = days.slice(i - RED_STREAK_DAYS + 1, i + 1);
    let c = 0;
    for (const [, set] of redBySchool) if (win.every((d) => set.has(d))) c++;
    streakByDay.push({ day: days[i], count: c });
  }
  const streakDailyAvg = streakByDay.length ? streakByDay.reduce((a, x) => a + x.count, 0) / streakByDay.length : 0;
  // Weekly view: group anchor-days into calendar ISO weeks, average per week.
  const isoWeek = (iso) => { const d = new Date(iso + 'T00:00:00Z'); const t = new Date(d); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return t.getUTCFullYear() + '-W' + String(Math.ceil(((t - ys) / 86400000 + 1) / 7)).padStart(2, '0'); };
  const byWeek = new Map();
  for (const x of streakByDay) { (byWeek.get(isoWeek(x.day)) || byWeek.set(isoWeek(x.day), []).get(isoWeek(x.day))).push(x.count); }
  const weekly = [...byWeek.entries()].map(([wk, arr]) => ({ week: wk, avg: Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)), days: arr.length }));
  const redSeries = days.map((d) => ({ date: d, red: (redByDay.get(d) || new Set()).size, submitted: (subByDay.get(d) || new Set()).size }));

  const latest = days[days.length - 1] || null;
  const out = {
    generated_at: new Date().toISOString(),
    reportingDays: days,
    latestDay: latest,
    latestFlagged: latest ? (redByDay.get(latest) || new Set()).size : 0,
    latestSubmitted: latest ? (subByDay.get(latest) || new Set()).size : 0,
    avgFlaggedPerDay: Number(avg.toFixed(1)),
    redStreak3EverCount: streakSchools,
    currentStreak3Window: lastWindow,
    currentStreak3: currentStreak,
    streakByDay,
    streakDailyAvg: Number(streakDailyAvg.toFixed(1)),
    streakWeekly: weekly,
    redSeries,
  };
  console.log('\n[stats] per-day 3-consecutive-day red-streak count:');
  streakByDay.forEach((x) => console.log(`   ${x.day}: ${x.count}`));
  console.log(`[stats] daily average 3-day-streak schools: ${streakDailyAvg.toFixed(1)}`);
  console.log('[stats] weekly average:', JSON.stringify(weekly));
  const dir = path.join(process.cwd(), 'reports');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'flag_stats.json'), JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error('[stats] FAILED:', e); process.exit(1); });
