// ============================================================
// Build the Glific "Lookup" sheet for schools that did NOT submit on a given
// reporting day, so Glific sends them the Hindi non-submission WhatsApp alert.
//
//   node scripts/nonsub-lookup.js --date=2026-11-12 --date-hindi="12 नवंबर" [--write]
//
// Without --write it is a DRY RUN: it prints the non-submitter list + counts and
// changes nothing. With --write it clears the Lookup tab's old rows and writes
// the new batch (header kept). Glific reads this sheet on its morning schedule.
//
// Submitters are read from the Results store (processed submissions); the roster
// (phone per school) from the Glific workbook's "All HM Contacts" tab.
// Needs: GOOGLE_SERVICE_ACCOUNT_JSON, RESULTS_SHEET_ID, GLIFIC_SHEET_ID.
// ============================================================
import { google } from 'googleapis';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const has = (k) => process.argv.includes(`--${k}`);

const DATE = arg('date', '');                 // ISO, e.g. 2026-11-12
const DATE_HINDI = arg('date-hindi', '');      // e.g. "12 नवंबर"
const WRITE = has('write');

const GLIFIC_SHEET_ID = process.env.GLIFIC_SHEET_ID;
const ROSTER_TAB = process.env.ROSTER_TAB || 'All HM Contacts';
const LOOKUP_TAB = process.env.LOOKUP_TAB || 'Lookup';

const LOOKUP_HEADER = ['Key', 'school_name', 'udise', 'date', 'reason_hindi'];
const msgFor = (dh) => `${dh} की निर्धारित दैनिक रिपोर्ट (फोटो) प्राप्त नहीं हुई। किसी भी प्रतिक्रिया/सुझाव हेतु कृपया दैनिक रिपोर्ट फॉर्म के 'अतिरिक्त टिप्पणी/Remarks' भाग में अपना संदेश लिखें।`;

const S = (v) => String(v == null ? '' : v).trim();

async function main() {
  if (!DATE || !DATE_HINDI) { console.error('Need --date=YYYY-MM-DD and --date-hindi="..."'); process.exit(1); }
  if (!GLIFIC_SHEET_ID) { console.error('Need GLIFIC_SHEET_ID'); process.exit(1); }

  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  // --- roster: phone + name + udise, one row per school ---
  const rosterRes = await sheets.spreadsheets.values.get({ spreadsheetId: GLIFIC_SHEET_ID, range: `${ROSTER_TAB}!A1:D` });
  const rosterRows = rosterRes.data.values || [];
  const rHead = (rosterRows[0] || []).map((h) => S(h).toLowerCase());
  const pI = rHead.findIndex((h) => h.includes('phone') || h === 'key');
  const nI = rHead.findIndex((h) => h.includes('school') || h.includes('name'));
  const uI = rHead.findIndex((h) => h.includes('udise'));
  const roster = [];
  const seenU = new Set();
  for (const row of rosterRows.slice(1)) {
    const udise = S(row[uI]); const phone = S(row[pI]); const name = S(row[nI]);
    if (!/^\d{9,12}$/.test(udise) || !phone) continue;
    if (seenU.has(udise)) continue;
    seenU.add(udise);
    roster.push({ udise, phone, name });
  }

  // --- submitters on DATE, straight from the LIVE daily sheet (not the store),
  // using the pipeline's own effectiveDate (timestamp date = reporting day). This
  // stays correct even when the nightly processor hasn't caught up to the latest
  // submissions yet. A report submitted after midnight counts for the day it was
  // sent, exactly as the dashboard/streak logic treats it. ---
  // A school counts as having reported for DATE if EITHER its submission-timestamp
  // date OR its typed "Today's Date" is DATE. The typed-date clause catches reports
  // sent after midnight for the previous day (e.g. a Nov-12 report submitted early
  // on Nov 13, before that day's meal) — those schools did report, so they are not
  // non-submitters.
  process.env.DATA_MODE = process.env.DATA_MODE || 'live';
  const { getDailySubmissions } = await import('../backend/source.js');
  const subs = await getDailySubmissions();
  const submitted = new Set();
  for (const s of subs) {
    if (!(s.school && s.school.udise)) continue;
    if (S(s.date) === DATE || S(s.manualDate) === DATE) submitted.add(S(s.school.udise));
  }

  const nonSub = roster.filter((s) => !submitted.has(s.udise))
    .sort((a, b) => a.name.localeCompare(b.name));

  console.log(`[nonsub] date=${DATE}  roster=${roster.length}  submitted=${submitted.size}  non-submitters=${nonSub.length}`);
  console.log(`[nonsub] message: ${msgFor(DATE_HINDI)}`);
  console.log('[nonsub] --- schools that did NOT submit ---');
  for (const s of nonSub) console.log(`  ${s.phone}  ${s.udise}  ${s.name}`);

  if (!WRITE) { console.log('\n[nonsub] DRY RUN — nothing written. Re-run with --write to publish to the Lookup tab.'); return; }

  const values = nonSub.map((s) => [s.phone, s.name, s.udise, DATE_HINDI, msgFor(DATE_HINDI)]);
  // Clear old body, keep/refresh header, write the new batch.
  await sheets.spreadsheets.values.clear({ spreadsheetId: GLIFIC_SHEET_ID, range: `${LOOKUP_TAB}!A2:Z100000` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: GLIFIC_SHEET_ID, range: `${LOOKUP_TAB}!A1`, valueInputOption: 'RAW',
    requestBody: { values: [LOOKUP_HEADER, ...values] },
  });
  console.log(`[nonsub] WROTE ${values.length} rows to ${LOOKUP_TAB}.`);
}

main().catch((e) => { console.error('[nonsub] FAILED:', e.message); process.exit(1); });
