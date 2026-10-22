// ============================================================
// Mirror the AI analysis (stored as packed JSON in the Results store) into a
// human-readable Google Sheet — one row per school per reporting day, with the
// key AI fields flattened into columns. Full rewrite each run (idempotent).
// The raw files_json store is left untouched; this is an additional, readable
// copy "for the record".
// Needs: GOOGLE_SERVICE_ACCOUNT_JSON, RESULTS_SHEET_ID (read), AI_SHEET_ID (write).
// ============================================================
import { google } from 'googleapis';
import { config } from '../backend/config.js';
import { readResults } from '../backend/store.js';

const AI_SHEET_ID = process.env.AI_SHEET_ID;
const AI_TAB = process.env.AI_SHEET_TAB || 'AI Analysis';
const ITEMS = ['cooking', 'cooked_meal', 'serving_video', 'plate'];

const aiOf = (r, k) => (r.files && r.files[k] && r.files[k].ai) || null;
const arr = (v) => Array.isArray(v) ? v.filter(Boolean).join(', ') : (v || '');
const scene = (a) => a ? (a.observed_scene || a.scene_type || '') : '';

const QUAL_RANK = { clear: 0, slightly_blurry: 1, obstructed: 2, too_dark: 3, too_blurry: 4 };
function worstQuality(r) {
  let worst = '', rank = -1;
  for (const k of ITEMS) { const a = aiOf(r, k); if (!a || !a.image_quality) continue; const q = a.image_quality; const rk = QUAL_RANK[q] ?? 0; if (rk > rank) { rank = rk; worst = q; } }
  return worst;
}
const CLEAN_RANK = { clean: 0, unclear: 1, average: 2, dirty: 3 };
function hygieneArea(r) {
  let worst = '', rank = -1; const notes = [];
  for (const k of ITEMS) {
    const a = aiOf(r, k); if (!a) continue;
    const c = a.area_cleanliness; if (c) { const rk = CLEAN_RANK[c] ?? 0; if (rk > rank) { rank = rk; worst = c; } }
    if (a.food_on_bare_floor === 'yes') notes.push('food on floor');
    if (a.food_left_uncovered === 'yes') notes.push('food uncovered');
    if (a.waste_or_pests_visible === 'yes') notes.push('waste/pests');
  }
  return worst + (notes.length ? ` (${[...new Set(notes)].join('; ')})` : '');
}
function gpsCount(r) { let n = 0; for (const k of ITEMS) { const a = aiOf(r, k); if (a && a.gps_present === 'yes') n++; } return `${n}/4`; }
function notesOf(r) {
  for (const k of ['cooked_meal', 'cooking', 'serving_video', 'plate']) { const a = aiOf(r, k); if (a && a.notes) return String(a.notes).slice(0, 180); }
  return '';
}

function rowFor(r) {
  const cook = aiOf(r, 'cooking'), cooked = aiOf(r, 'cooked_meal'), serv = aiOf(r, 'serving_video'), plate = aiOf(r, 'plate');
  return [
    r.date || '', (r.school && r.school.udise) || '', (r.school && r.school.name) || '',
    r.severity || '', (r.flags || []).map((f) => f.code).join(', '), r.menuLabel || '',
    r.headcountReported ?? '',
    scene(cook), cook ? (cook.cooking_in_progress || '') : '', cook ? (cook.kitchen_cleanliness || '') : '',
    cooked ? arr(cooked.dishes_visible) : '', cooked ? (cooked.cookware_fill_level || '') : '', cooked ? (cooked.appears_freshly_cooked || '') : '',
    serv ? (serv.serving_action_visible || '') : '', serv ? arr(serv.dishes_served) : '',
    plate ? arr(plate.dishes_visible) : '',
    hygieneArea(r), gpsCount(r), worstQuality(r), notesOf(r), r.processedAt || '',
  ];
}

async function sheetsClient() {
  const creds = JSON.parse(config.google.serviceAccountJson);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

async function main() {
  if (!AI_SHEET_ID) { console.error('AI_SHEET_ID not set'); process.exit(1); }
  const rows = await readResults();
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.school?.name || '').localeCompare(String(b.school?.name || '')));
  const data = rows.map(rowFor);
  console.log(`[export] ${data.length} rows → "${AI_TAB}"`);
  const sheets = await sheetsClient();
  // clear old body then write (idempotent full rewrite; header row kept)
  await sheets.spreadsheets.values.clear({ spreadsheetId: AI_SHEET_ID, range: `${AI_TAB}!A2:U200000` });
  if (data.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: AI_SHEET_ID, range: `${AI_TAB}!A2`, valueInputOption: 'RAW', requestBody: { values: data },
    });
  }
  console.log('[export] done');
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
