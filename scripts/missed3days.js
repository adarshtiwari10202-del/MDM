// ============================================================
// Single list: roster schools that MISSED daily reporting on ANY of the last
// three days — 28, 29, 30 Sep 2026 — where 30 Sep counts only submissions up to
// 19:00 IST. A school is listed unless it reported on ALL THREE days.
// Grouping is by the Google submission TIMESTAMP (IST). Read-only.
// Needs: GOOGLE_SERVICE_ACCOUNT_JSON, DAILY_SHEET_ID (+ Sheet1 roster).
// ============================================================
import { readRoster } from '../backend/roster.js';
import { readSheet } from '../backend/sheets.js';
import { resolveColumns, toISODate, toISODateTime, effectiveDate } from '../backend/parse.js';

const norm = (u) => String(u || '').trim();
const udiseFrom = (s) => { const m = String(s || '').match(/\b(\d{8,15})\b/); return m ? m[1] : ''; };
const DAYS = ['2026-09-28', '2026-09-29', '2026-09-30'];
const CUTOFF_DAY = '2026-09-30';
const CUTOFF_TIME = '19:00:00'; // 7 PM IST inclusive

async function main() {
  const roster = await readRoster();
  const { headers, rows } = await readSheet(process.env.DAILY_SHEET_ID, process.env.DAILY_SHEET_TAB || 'Form Responses 1');
  const cols = resolveColumns(headers, { udise: ['udise'], school: ['school name'], timestamp: ['timestamp'], date: ["today's date", 'today date', 'date'] });

  console.log(`[src] DAILY_SHEET_ID(last6)=…${String(process.env.DAILY_SHEET_ID || '').slice(-6)}  tab="${process.env.DAILY_SHEET_TAB || 'Form Responses 1'}"  total rows=${rows.length}`);
  console.log(`[src] resolved → udise:${JSON.stringify(cols.udise)} school:${JSON.stringify(cols.school)} timestamp:${JSON.stringify(cols.timestamp)}`);
  const nowIST = new Date(Date.now() + (5 * 60 + 30) * 60000);
  console.log(`[time] now = ${new Date().toISOString()} (UTC) = ${nowIST.toISOString().slice(0, 19)} IST`);

  // Per-udise set of the three target days it reported on (30 Sep gated by 7 PM).
  const byUdise = new Map();
  const perDayRows = { '2026-09-28': 0, '2026-09-29': 0, '2026-09-30': 0 };
  let excluded30 = [];       // 30-Sep rows AFTER 7 PM (excluded)
  for (const r of rows) {
    const tsISO = cols.timestamp ? toISODateTime(r[cols.timestamp]) : null;
    const eff = effectiveDate(cols.date ? toISODate(r[cols.date]) : null, tsISO);
    if (!DAYS.includes(eff.date)) continue;
    let u = norm(cols.udise ? r[cols.udise] : '');
    if (!/^\d{6,}$/.test(u)) u = udiseFrom(cols.school ? r[cols.school] : '');
    // 7 PM IST cutoff on 30 Sep
    if (eff.date === CUTOFF_DAY) {
      const timePart = tsISO ? tsISO.slice(11, 19) : '';      // HH:MM:SS (IST wall clock)
      if (timePart && timePart > CUTOFF_TIME) { excluded30.push({ u, school: cols.school ? r[cols.school] : '', t: timePart }); continue; }
    }
    perDayRows[eff.date]++;
    if (/^\d{6,}$/.test(u)) (byUdise.get(u) || byUdise.set(u, new Set()).get(u)).add(eff.date);
  }

  const distinct = (d) => [...byUdise.values()].filter((s) => s.has(d)).length;
  console.log('\n[days] distinct schools reporting each day (rows):');
  DAYS.forEach((d) => console.log(`   ${d}: ${distinct(d)} schools  (${perDayRows[d]} rows${d === CUTOFF_DAY ? `, ${excluded30.length} rows excluded as after 7 PM` : ''})`));

  // Missed = roster school not present on ≥1 of the three days.
  const missed = [];
  for (const s of roster) {
    const set = byUdise.get(norm(s.udise)) || new Set();
    const missedDays = DAYS.filter((d) => !set.has(d));
    if (missedDays.length) missed.push({ udise: norm(s.udise), name: s.name, missedDays, got: DAYS.length - missedDays.length });
  }
  missed.sort((a, b) => a.name.localeCompare(b.name));

  console.log(`\n===== MISSED ANY OF 28/29/30 SEP (${missed.length} of ${roster.length}) =====`);
  missed.forEach((m, i) => console.log(`${String(i + 1).padStart(3)}. ${m.udise}  ${m.name}  | reported ${m.got}/3 | missed: ${m.missedDays.map((d) => d.slice(8)).join(',')}`));

  const allThree = roster.length - missed.length;
  console.log(`\n[summary] reported on ALL three days: ${allThree}  |  missed ≥1: ${missed.length}`);
  if (excluded30.length) {
    console.log(`\n[cutoff] 30-Sep rows recorded AFTER 7 PM (not counted): ${excluded30.length}`);
    excluded30.slice(0, 20).forEach((x) => console.log(`   ${x.t} IST  ${x.school}`));
  }
}

main().catch((e) => { console.error('[missed3days] FAILED:', e); process.exit(1); });
