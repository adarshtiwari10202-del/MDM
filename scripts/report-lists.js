// ============================================================
// One-off report: which roster schools are missing (a) the one-time school
// PROFILE form, and (b) the daily form on a given date. Prints both lists.
//   PROFILE_SHEET_ID, PROFILE_SHEET_TAB (default 'Form Responses 1')
//   DAILY_SHEET_ID,   DAILY_SHEET_TAB   (default 'Form Responses 1')
//   REPORT_DATE (YYYY-MM-DD, default 2026-09-24)
// Needs: GOOGLE_SERVICE_ACCOUNT_JSON (+ DAILY_SHEET_ID for the roster/Sheet1).
// ============================================================
import { readRoster } from '../backend/roster.js';
import { readSheet } from '../backend/sheets.js';
import { resolveColumns, toISODate } from '../backend/parse.js';

const DATE = process.env.REPORT_DATE || '2026-09-24';
const udiseFrom = (s) => { const m = String(s || '').match(/\b(\d{8,15})\b/); return m ? m[1] : ''; };
const norm = (u) => String(u || '').trim();

async function submittedSet(sheetId, tab, { dateFilter } = {}) {
  const { headers, rows } = await readSheet(sheetId, tab);
  const cols = resolveColumns(headers, { udise: ['udise'], school: ['school name'], date: ["today's date", 'today date', 'date'] });
  const set = new Set();
  for (const r of rows) {
    if (dateFilter) { const d = toISODate(cols.date ? r[cols.date] : ''); if (d !== dateFilter) continue; }
    let u = norm(cols.udise ? r[cols.udise] : '');
    if (!/^\d{6,}$/.test(u)) u = udiseFrom(cols.school ? r[cols.school] : '');
    if (/^\d{6,}$/.test(u)) set.add(u);
  }
  return set;
}

async function main() {
  const roster = await readRoster();

  let profile = null, profileErr = null;
  try { profile = await submittedSet(process.env.PROFILE_SHEET_ID, process.env.PROFILE_SHEET_TAB || 'Form Responses 1'); }
  catch (e) { profileErr = e.message; }

  const daily = await submittedSet(process.env.DAILY_SHEET_ID, process.env.DAILY_SHEET_TAB || 'Form Responses 1', { dateFilter: DATE });

  console.log(`ROSTER=${roster.length}  PROFILE_SUBMITTED=${profile ? profile.size : 'N/A'}  DAILY_${DATE}_SUBMITTED=${daily.size}`);

  if (profile) {
    const noProfile = roster.filter((s) => !profile.has(norm(s.udise)));
    console.log(`\n===== NOT SUBMITTED: SCHOOL PROFILE FORM (${noProfile.length}) =====`);
    noProfile.forEach((s, i) => console.log(`${String(i + 1).padStart(3)}. ${s.udise}  ${s.name}`));
  } else {
    console.log(`\n===== SCHOOL PROFILE FORM: could not read profile sheet =====`);
    console.log(`Reason: ${profileErr}`);
    console.log(`Fix: share the profile sheet with the service account (Viewer), then re-run.`);
  }

  const noDaily = roster.filter((s) => !daily.has(norm(s.udise)));
  console.log(`\n===== NOT SUBMITTED: DAILY FORM on ${DATE} (${noDaily.length}) =====`);
  noDaily.forEach((s, i) => console.log(`${String(i + 1).padStart(3)}. ${s.udise}  ${s.name}`));
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
