// ============================================================
// HIGH-STAKES cross-check of the "school profile form NOT submitted" list.
// Independently audits the profile sheet instead of trusting the UDISE matcher:
//   - dumps headers + which columns resolve as udise/school
//   - counts responses whose UDISE could NOT be parsed (these are the rows that
//     would make a school WRONGLY appear as "not submitted")
//   - for each flagged school, RAW-scans every cell of every response for its
//     UDISE (exact + digits-only) and for its name tokens, so a response that
//     the strict matcher missed still surfaces here.
// Read-only. Needs GOOGLE_SERVICE_ACCOUNT_JSON, PROFILE_SHEET_ID (+ DAILY for roster).
// ============================================================
import { readRoster } from '../backend/roster.js';
import { readSheet } from '../backend/sheets.js';
import { resolveColumns } from '../backend/parse.js';

const norm = (u) => String(u || '').trim();
const digits = (s) => String(s || '').replace(/\D/g, '');
const udiseFrom = (s) => { const m = String(s || '').match(/\b(\d{8,15})\b/); return m ? m[1] : ''; };

// Schools to verify hard (raw cell scan). Override via VERIFY_TARGETS env as
// "udise:NAME;udise:NAME"; otherwise the default below.
const TARGETS = (process.env.VERIFY_TARGETS
  ? process.env.VERIFY_TARGETS.split(';').map((s) => { const [udise, ...n] = s.split(':'); return { udise: udise.trim(), name: n.join(':').trim() }; })
  : [{ udise: '9240511003', name: 'KAJIPUR' }]);

async function main() {
  const sheetId = process.env.PROFILE_SHEET_ID;
  const tab = process.env.PROFILE_SHEET_TAB || 'Form Responses 1';
  const { headers, rows } = await readSheet(sheetId, tab);
  console.log(`[verify] profile sheet ${sheetId} tab "${tab}"`);
  console.log(`[verify] ${rows.length} response rows, ${headers.length} columns`);
  console.log('[verify] HEADERS:');
  headers.forEach((h, i) => console.log(`   [${i}] ${h}`));

  const cols = resolveColumns(headers, { udise: ['udise'], school: ['school name'], date: ["today's date", 'today date', 'date'] });
  console.log(`\n[verify] resolved columns → udise: ${JSON.stringify(cols.udise)}  school: ${JSON.stringify(cols.school)}`);

  // Replicate report-lists.js extraction exactly, and record misses.
  const extracted = new Set();
  const unreadable = [];
  rows.forEach((r, i) => {
    let u = norm(cols.udise ? r[cols.udise] : '');
    if (!/^\d{6,}$/.test(u)) u = udiseFrom(cols.school ? r[cols.school] : '');
    if (/^\d{6,}$/.test(u)) extracted.add(u);
    else unreadable.push({ i, udiseCell: cols.udise ? r[cols.udise] : '', schoolCell: cols.school ? r[cols.school] : '' });
  });
  console.log(`\n[verify] responses with a parseable UDISE: ${extracted.size}`);
  console.log(`[verify] responses with NO parseable UDISE: ${unreadable.length}  <-- these could hide a "missing" school`);
  unreadable.slice(0, 40).forEach((x) => console.log(`   row#${x.i}: udiseCell=${JSON.stringify(x.udiseCell)} schoolCell=${JSON.stringify(x.schoolCell)}`));

  // Roster cross-check of the 5.
  const roster = await readRoster();
  console.log(`\n[verify] roster size: ${roster.length}`);

  // RAW full-row scan for each target (independent of column resolution).
  console.log('\n[verify] ===== per-target raw scan =====');
  for (const t of TARGETS) {
    const rEntry = roster.find((s) => norm(s.udise) === t.udise);
    const nameTok = t.name.toUpperCase();
    const hitsUdise = [];
    const hitsName = [];
    rows.forEach((r) => {
      const i = r.__rowIndex;
      const cells = Object.entries(r).filter(([k]) => k !== '__rowIndex').map(([, v]) => String(v ?? ''));
      const joined = cells.join(' | ');
      const joinedDigits = digits(joined);
      if (joined.includes(t.udise) || joinedDigits.includes(t.udise)) hitsUdise.push({ i, joined });
      if (joined.toUpperCase().includes(nameTok)) hitsName.push({ i, joined });
    });
    console.log(`\n• ${t.name} (${t.udise})`);
    console.log(`   roster: ${rEntry ? rEntry.name + ' | block=' + rEntry.block : 'NOT IN ROSTER'}`);
    console.log(`   in extracted-UDISE set? ${extracted.has(t.udise) ? 'YES (would count as SUBMITTED)' : 'no'}`);
    console.log(`   raw UDISE matches in responses: ${hitsUdise.length}`);
    hitsUdise.slice(0, 5).forEach((h) => console.log(`      row#${h.i}: ${h.joined.slice(0, 200)}`));
    console.log(`   raw NAME("${nameTok}") matches in responses: ${hitsName.length}`);
    hitsName.slice(0, 5).forEach((h) => console.log(`      row#${h.i}: ${h.joined.slice(0, 200)}`));
  }
}

main().catch((e) => { console.error('[verify] FAILED:', e); process.exit(1); });
