// ============================================================
// Re-flag (no AI): recompute duplicates + flags for every stored row
// using the CURRENT flag engine, then rewrite the results store.
// Use after changing flag rules — applies them to history in seconds
// without re-fetching media or calling Gemini.
//
//   node scripts/reflag.js
// Needs: GOOGLE_SERVICE_ACCOUNT_JSON, RESULTS_SHEET_ID. (No GEMINI, no Drive.)
// ============================================================
import { readResults, clearResults, appendResults } from '../backend/store.js';
import { evaluateSubmission } from '../backend/flagRules.js';
import { getMenu } from '../backend/menu.js';

const ITEMS = ['cooking', 'cooked_meal', 'serving_video', 'plate'];
const rn = (id) => { const m = String(id).match(/_r(\d+)$/); return m ? Number(m[1]) : 0; };

async function main() {
  const rows = await readResults();
  console.log(`[reflag] ${rows.length} stored rows`);
  if (!rows.length) { console.log('[reflag] nothing to do'); return; }

  // Deterministic order (matches processing order) so duplicate attribution is stable.
  rows.sort((a, b) => rn(a.id) - rn(b.id));

  // Recompute duplicates by content hash: cross-submission = reuse (red),
  // same-submission = repeated slot (amber).
  const seen = new Map();
  for (const r of rows) {
    for (const k of ITEMS) {
      const f = r.files?.[k];
      if (!f || f.missing || !f.hash) continue;
      delete f.duplicateOf; delete f.repeatedInSubmission; // clear stale marks
      const prev = seen.get(f.hash);
      if (prev && prev !== r.id) f.duplicateOf = prev;
      else if (prev === r.id) f.repeatedInSubmission = true;
      else seen.set(f.hash, r.id);
    }
    const submission = {
      school: r.school,
      date: r.date,
      submittedAt: r.submittedAt,
      menu: getMenu(r.date, r.school?.udise),
      files: r.files,
    };
    const res = evaluateSubmission(submission);
    r.flags = res.flags; r.severity = res.severity; r.score = res.score; r.summary = res.summary;
  }

  await clearResults();
  await appendResults(rows);

  const red = rows.filter((r) => r.severity === 'red').length;
  const amber = rows.filter((r) => r.severity === 'amber').length;
  const ok = rows.filter((r) => r.severity === 'ok').length;
  console.log(`[reflag] rewrote ${rows.length} rows — ${red} red, ${amber} amber, ${ok} clean`);
}

main().catch((e) => { console.error('[reflag] FAILED:', e); process.exit(1); });
