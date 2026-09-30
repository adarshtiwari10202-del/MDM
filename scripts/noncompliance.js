// ============================================================
// Daily-reporting non-compliance lists (read-only).
//   Reporting days = distinct dates the block actually reported on, grouped by
//   the Google submission TIMESTAMP (source of truth; manual date is unreliable).
//   List 1: schools that have NOT submitted a single day.
//   List 2: schools that submitted at least once but MISSED > 50% of reporting days.
// Both are roster-based (the 195 expected schools) and disjoint.
// Needs: GOOGLE_SERVICE_ACCOUNT_JSON, DAILY_SHEET_ID (+ Sheet1 roster).
// ============================================================
import { readRoster } from '../backend/roster.js';
import { readSheet } from '../backend/sheets.js';
import { resolveColumns, toISODate, toISODateTime, effectiveDate } from '../backend/parse.js';

const norm = (u) => String(u || '').trim();
const udiseFrom = (s) => { const m = String(s || '').match(/\b(\d{8,15})\b/); return m ? m[1] : ''; };

async function main() {
  const roster = await readRoster();
  const { headers, rows } = await readSheet(process.env.DAILY_SHEET_ID, process.env.DAILY_SHEET_TAB || 'Form Responses 1');
  const cols = resolveColumns(headers, {
    udise: ['udise'], school: ['school name'], timestamp: ['timestamp'],
    date: ["today's date", 'today date', 'date'],
  });

  const allDates = new Set();
  const byUdise = new Map(); // udise -> Set(date)
  for (const r of rows) {
    const eff = effectiveDate(cols.date ? toISODate(r[cols.date]) : null,
                              cols.timestamp ? toISODateTime(r[cols.timestamp]) : null);
    if (!eff.date) continue;
    allDates.add(eff.date);
    let u = norm(cols.udise ? r[cols.udise] : '');
    if (!/^\d{6,}$/.test(u)) u = udiseFrom(cols.school ? r[cols.school] : '');
    if (!/^\d{6,}$/.test(u)) continue;
    (byUdise.get(u) || byUdise.set(u, new Set()).get(u)).add(eff.date);
  }

  const days = [...allDates].sort();
  const total = days.length;
  console.log(`[noncompliance] roster=${roster.length}  reporting days=${total}: ${days.join(', ')}`);

  const rowsOut = roster.map((s) => {
    const sub = (byUdise.get(norm(s.udise)) || new Set()).size;
    return { udise: norm(s.udise), name: s.name, sub, missed: total - sub };
  });

  const never = rowsOut.filter((r) => r.sub === 0).sort((a, b) => a.name.localeCompare(b.name));
  // "> 50% missed" AND submitted at least once (disjoint from `never`).
  const under50 = rowsOut.filter((r) => r.sub > 0 && r.sub * 2 < total)
    .sort((a, b) => a.sub - b.sub || a.name.localeCompare(b.name));

  console.log(`\n===== LIST 1 — NEVER submitted the daily form (${never.length}) =====`);
  never.forEach((r, i) => console.log(`${String(i + 1).padStart(3)}. ${r.udise}  ${r.name}`));

  console.log(`\n===== LIST 2 — submitted but MISSED > 50% of ${total} days (${under50.length}) =====`);
  under50.forEach((r, i) => console.log(`${String(i + 1).padStart(3)}. ${r.udise}  ${r.name}  (submitted ${r.sub}/${total}, missed ${r.missed})`));

  // Reference distribution.
  const buckets = { '0': 0, '1-25%': 0, '25-50%': 0, '50-75%': 0, '75-99%': 0, '100%': 0 };
  for (const r of rowsOut) {
    const p = total ? r.sub / total : 0;
    if (r.sub === 0) buckets['0']++;
    else if (p < 0.25) buckets['1-25%']++;
    else if (p < 0.5) buckets['25-50%']++;
    else if (p < 0.75) buckets['50-75%']++;
    else if (p < 1) buckets['75-99%']++;
    else buckets['100%']++;
  }
  console.log('\n[noncompliance] submission-rate distribution (of days present):');
  for (const [k, v] of Object.entries(buckets)) console.log(`   ${k.padEnd(8)} ${v}`);
}

main().catch((e) => { console.error('[noncompliance] FAILED:', e); process.exit(1); });
