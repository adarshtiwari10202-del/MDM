// ============================================================
// Reconcile each submission's grouping DATE using both the manual
// "Today's Date" field and Google's auto-recorded submission Timestamp.
//
// Rule: the meal day is the submission day, or at most the day before (a late
// submission). So we trust the manual date only when it is within [-1, 0] days
// of the timestamp date; otherwise the manual entry is a typo and we use the
// timestamp date. The original manual date is preserved as `manualDate`, and
// `dateSource` records which was used.
//
// DRYRUN=1 (default) only reports the distribution and sample corrections.
// DRYRUN=0 rewrites the results store with corrected dates (ids preserved).
//   node scripts/fixdates.js
// Needs: GOOGLE_SERVICE_ACCOUNT_JSON, RESULTS_SHEET_ID.
// ============================================================
import { readResults, clearResults, appendResults } from '../backend/store.js';
import { effectiveDate } from '../backend/parse.js';

const DRYRUN = process.env.DRYRUN !== '0';

const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);

async function main() {
  const rows = await readResults();
  console.log(`[fixdates] ${rows.length} stored rows · mode: ${DRYRUN ? 'DRY RUN (no write)' : 'APPLY (rewrite store)'}`);
  if (!rows.length) return;

  const hist = {}; // signed (manual - ts) day diff → count
  let agree = 0, corrected = 0, noTs = 0, noManual = 0;
  const samples = [];

  for (const r of rows) {
    const manual = r.manualDate || r.date || null;   // current stored date is the manual one on first run
    const ts = r.submittedAt ? String(r.submittedAt).slice(0, 10) : null;
    const eff = effectiveDate(manual, r.submittedAt);

    if (!ts) noTs++;
    if (!manual) noManual++;
    if (manual && ts) {
      const d = dayDiff(manual, ts);
      const bucket = d < -3 ? '<=-4' : d > 3 ? '>=4' : String(d);
      hist[bucket] = (hist[bucket] || 0) + 1;
      if (eff.mismatch) { corrected++; if (samples.length < 20) samples.push({ id: r.id, school: r.school?.name, manual, ts, chosen: eff.date }); }
      else agree++;
    }
  }

  console.log(`\n[fixdates] manual vs timestamp — signed day diff (manual − timestamp):`);
  for (const k of Object.keys(hist).sort((a, b) => (parseInt(a) || (a[0] === '<' ? -99 : 99)) - (parseInt(b) || (b[0] === '<' ? -99 : 99)))) {
    console.log(`   ${k.padStart(4)} days : ${hist[k]}`);
  }
  console.log(`\n[fixdates] manual matches timestamp: ${agree}   manual differs (regrouped to timestamp): ${corrected}   no timestamp: ${noTs}   no manual date: ${noManual}`);

  console.log(`\n[fixdates] sample corrections (manual → chosen):`);
  for (const s of samples) console.log(`   ${s.school} | typed ${s.manual} | submitted ${s.ts} | → ${s.chosen}`);

  // Show how the per-date submission counts change (top dates).
  const before = {}, after = {};
  for (const r of rows) {
    const manual = r.manualDate || r.date || null;
    const eff = effectiveDate(manual, r.submittedAt);
    if (manual) before[manual] = (before[manual] || 0) + 1;
    if (eff.date) after[eff.date] = (after[eff.date] || 0) + 1;
  }
  const fmt = (o) => Object.keys(o).sort().map((d) => `${d}:${o[d]}`).join('  ');
  console.log(`\n[fixdates] submissions per date BEFORE (manual):\n   ${fmt(before)}`);
  console.log(`\n[fixdates] submissions per date AFTER (reconciled):\n   ${fmt(after)}`);

  if (DRYRUN) { console.log('\n[fixdates] DRY RUN — no changes written. Re-run with DRYRUN=0 to apply.'); return; }

  for (const r of rows) {
    const manual = r.manualDate || r.date || null;
    const eff = effectiveDate(manual, r.submittedAt);
    r.manualDate = manual;
    r.dateSource = eff.source;
    r.dateMismatch = eff.mismatch;
    r.date = eff.date || r.date;
  }
  await clearResults();
  await appendResults(rows);
  console.log(`\n[fixdates] APPLIED — rewrote ${rows.length} rows with reconciled dates. Run reflag next to recompute flags.`);
}

main().catch((e) => { console.error('[fixdates] FAILED:', e); process.exit(1); });
