// ============================================================
// Daily Glific alerts — fills the "Lookup" tab for Glific to send the morning
// WhatsApp alerts. ONE pass, two groups of rows for the given reporting day:
//
//   (A) NON-SUBMITTERS   — schools in the Glific roster that did NOT submit on
//                          DATE (checked against the live daily sheet, using
//                          the same effectiveDate rule as the dashboard).
//
//   (B) MENU NON-COMPLIANCE — schools that DID submit on DATE but whose stored
//                          AI result carries a `menu_missing` flag. Message
//                          names the specific missing item(s) in Hindi.
//
//   node scripts/daily-alerts.js --date=2026-11-17 --date-hindi="17 नवंबर" [--write]
//
// Without --write it is a DRY RUN: it prints both lists + counts and changes
// nothing. With --write it clears the Lookup tab's old rows and writes the
// combined batch (header kept).
//
// Format of the Lookup tab (unchanged — same as nonsub-lookup.js):
//   Key | school_name | udise | date | reason_hindi
//
// Needs: GOOGLE_SERVICE_ACCOUNT_JSON, GLIFIC_SHEET_ID, RESULTS_SHEET_ID,
//        DAILY_SHEET_ID. Optional: ROSTER_TAB, LOOKUP_TAB, RESULTS_SHEET_TAB.
// ============================================================
import { google } from 'googleapis';
import { readResults } from '../backend/store.js';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const has = (k) => process.argv.includes(`--${k}`);

const DATE = arg('date', '');                 // ISO, e.g. 2026-11-17
const DATE_HINDI = arg('date-hindi', '');     // e.g. "17 नवंबर"
const WRITE = has('write');

const GLIFIC_SHEET_ID = process.env.GLIFIC_SHEET_ID;
const ROSTER_TAB = process.env.ROSTER_TAB || 'All HM Contacts';
const LOOKUP_TAB = process.env.LOOKUP_TAB || 'Lookup';

const LOOKUP_HEADER = ['Key', 'school_name', 'udise', 'date', 'reason_hindi'];

const S = (v) => String(v == null ? '' : v).trim();

// Hindi names for the prescribed menu items (used in menu-missing message).
const HINDI_ITEM = {
  roti: 'रोटी', sabzi: 'सब्ज़ी', rice: 'चावल', dal: 'दाल', tehri: 'तहरी',
  khichdi: 'खिचड़ी', milk: 'दूध', fruit: 'फल',
  'dal/sabzi': 'दाल/सब्ज़ी', 'tehri/khichdi': 'तहरी/खिचड़ी',
};
const toHindiItems = (csv) => csv.split(',').map((s) => s.trim().toLowerCase())
  .map((x) => HINDI_ITEM[x] || x).join(', ');

const msgNonSub = (dh) =>
  `${dh} की निर्धारित दैनिक रिपोर्ट (फोटो) प्राप्त नहीं हुई। किसी भी प्रतिक्रिया/सुझाव हेतु कृपया दैनिक रिपोर्ट फॉर्म के 'अतिरिक्त टिप्पणी/Remarks' भाग में अपना संदेश लिखें।`;

const msgMenuMissing = (dh, itemsHi) =>
  `${dh} की दैनिक रिपोर्ट में निर्धारित मेनू का ${itemsHi} फोटो/वीडियो में दिखाई नहीं दिया। कृपया सुनिश्चित करें कि सभी निर्धारित मद फोटो में स्पष्ट दिखें। किसी प्रतिक्रिया/सुझाव हेतु दैनिक रिपोर्ट फॉर्म के 'अतिरिक्त टिप्पणी/Remarks' भाग में अपना संदेश लिखें।`;

// Parse missing items out of the menu_missing flag.reason string, which reads:
//   "Prescribed dish confirmed missing (not in any photo or the video): <csv>"
function missingItemsFromReason(reason) {
  const i = String(reason || '').lastIndexOf(':');
  return i === -1 ? '' : reason.slice(i + 1).trim();
}

async function main() {
  if (!DATE || !DATE_HINDI) { console.error('Need --date=YYYY-MM-DD and --date-hindi="..."'); process.exit(1); }
  if (!GLIFIC_SHEET_ID) { console.error('Need GLIFIC_SHEET_ID'); process.exit(1); }

  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  // --- roster: phone + name + udise, one row per school ---
  const rosterRes = await sheets.spreadsheets.values.get({
    spreadsheetId: GLIFIC_SHEET_ID, range: `${ROSTER_TAB}!A1:D`,
  });
  const rosterRows = rosterRes.data.values || [];
  const rHead = (rosterRows[0] || []).map((h) => S(h).toLowerCase());
  const pI = rHead.findIndex((h) => h.includes('phone') || h === 'key');
  const nI = rHead.findIndex((h) => h.includes('school') || h.includes('name'));
  const uI = rHead.findIndex((h) => h.includes('udise'));
  const roster = [];
  const phoneByUdise = new Map();
  const nameByUdise = new Map();
  const seenU = new Set();
  for (const row of rosterRows.slice(1)) {
    const udise = S(row[uI]); const phone = S(row[pI]); const name = S(row[nI]);
    if (!/^\d{9,12}$/.test(udise) || !phone) continue;
    if (seenU.has(udise)) continue;
    seenU.add(udise);
    roster.push({ udise, phone, name });
    phoneByUdise.set(udise, phone);
    nameByUdise.set(udise, name);
  }

  // --- submitters on DATE (same rule as dashboard + nonsub-lookup) ---
  process.env.DATA_MODE = process.env.DATA_MODE || 'live';
  const { getDailySubmissions } = await import('../backend/source.js');
  const subs = await getDailySubmissions();
  const submitted = new Set();
  for (const s of subs) {
    if (!(s.school && s.school.udise)) continue;
    if (S(s.date) === DATE || S(s.manualDate) === DATE) submitted.add(S(s.school.udise));
  }

  // --- (A) non-submitters ---
  const nonSub = roster.filter((s) => !submitted.has(s.udise))
    .sort((a, b) => a.name.localeCompare(b.name));

  // --- (B) menu-missing: AI-flagged submissions from the results store ---
  const results = await readResults({ date: DATE });
  const menuRows = [];
  for (const r of results) {
    const flags = Array.isArray(r.flags) ? r.flags : [];
    const mm = flags.find((f) => f && f.code === 'menu_missing');
    if (!mm) continue;
    const udise = S(r.school && r.school.udise);
    if (!udise) continue;
    // Only alert schools that are on the Glific roster (we have a phone).
    const phone = phoneByUdise.get(udise);
    if (!phone) continue;
    const name = nameByUdise.get(udise) || S(r.school && r.school.name);
    const itemsRaw = missingItemsFromReason(mm.reason);
    if (!itemsRaw) continue;
    const itemsHi = toHindiItems(itemsRaw);
    menuRows.push({ udise, phone, name, itemsRaw, itemsHi });
  }
  menuRows.sort((a, b) => a.name.localeCompare(b.name));

  // --- diagnostics ---
  console.log(`[alerts] date=${DATE}  roster=${roster.length}  submitted=${submitted.size}`);
  console.log(`[alerts] (A) non-submitters: ${nonSub.length}`);
  console.log(`[alerts] (B) menu-missing: ${menuRows.length} (from ${results.length} processed rows on ${DATE})`);
  console.log(`\n[alerts] non-sub message: ${msgNonSub(DATE_HINDI)}`);
  console.log(`[alerts] menu-missing message template: ${msgMenuMissing(DATE_HINDI, '<item>')}`);

  console.log('\n[alerts] --- (A) schools that did NOT submit ---');
  for (const s of nonSub) console.log(`  ${s.phone}  ${s.udise}  ${s.name}`);

  console.log('\n[alerts] --- (B) schools flagged for menu_missing ---');
  for (const r of menuRows) console.log(`  ${r.phone}  ${r.udise}  ${r.name}   missing: ${r.itemsRaw}  (${r.itemsHi})`);

  if (!WRITE) { console.log('\n[alerts] DRY RUN — nothing written. Re-run with --write to publish to the Lookup tab.'); return; }

  // Build combined values: non-sub rows first, then menu-missing rows.
  const nonSubValues = nonSub.map((s) => [s.phone, s.name, s.udise, DATE_HINDI, msgNonSub(DATE_HINDI)]);
  const menuValues   = menuRows.map((r) => [r.phone, r.name, r.udise, DATE_HINDI, msgMenuMissing(DATE_HINDI, r.itemsHi)]);
  const values = [...nonSubValues, ...menuValues];

  // Clear old body, (re)write header + the new batch.
  await sheets.spreadsheets.values.clear({ spreadsheetId: GLIFIC_SHEET_ID, range: `${LOOKUP_TAB}!A2:Z100000` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: GLIFIC_SHEET_ID, range: `${LOOKUP_TAB}!A1`, valueInputOption: 'RAW',
    requestBody: { values: [LOOKUP_HEADER, ...values] },
  });
  console.log(`\n[alerts] WROTE ${values.length} rows to ${LOOKUP_TAB} (A: ${nonSubValues.length}, B: ${menuValues.length}).`);
}

main().catch((e) => { console.error('[alerts] FAILED:', e.message); process.exit(1); });
