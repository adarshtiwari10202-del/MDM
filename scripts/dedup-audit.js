// ============================================================
// Duplication audit for the results store (read-only).
// For each reporting date: total rows, distinct row ids, distinct schools
// (udise), duplicate count (rows - distinct ids), and rows with AI. Flags any
// date where rows > distinct ids (i.e. the store holds duplicate rows).
//   node scripts/dedup-audit.js
// Needs: GOOGLE_SERVICE_ACCOUNT_JSON, RESULTS_SHEET_ID.
// ============================================================
import { readResults } from '../backend/store.js';

const ITEMS = ['cooking', 'cooked_meal', 'serving_video', 'plate'];
const hasAI = (f) => { const a = f && f.ai; return !!(a && typeof a === 'object' && (a.scene_type || a.observed_scene || a.notes || (a.dishes_visible && a.dishes_visible.length) || a.food_present != null || a.cooking_in_progress != null)); };

async function main() {
  const rows = await readResults();
  const byDate = {};
  const idSeen = new Map();          // global id -> count (cross-date dupes too)
  for (const r of rows) {
    const d = r.date || 'nodate';
    const b = byDate[d] || (byDate[d] = { rows: 0, ids: new Set(), udise: new Set(), aiRows: 0 });
    b.rows++;
    b.ids.add(r.id);
    if (r.school && r.school.udise) b.udise.add(String(r.school.udise).trim());
    if (ITEMS.some((k) => hasAI(r.files?.[k]))) b.aiRows++;
    idSeen.set(r.id, (idSeen.get(r.id) || 0) + 1);
  }

  console.log('Duplication audit by reporting date:\n');
  console.log('date          rows   distinctIds  distinctSchools   dupRows   rowsWithAI   AI%');
  let T = { rows: 0, ids: 0, dup: 0, ai: 0 };
  let flagged = 0;
  for (const d of Object.keys(byDate).sort()) {
    const b = byDate[d];
    const dup = b.rows - b.ids.size;
    const pct = b.rows ? Math.round((100 * b.aiRows) / b.rows) : 0;
    T.rows += b.rows; T.ids += b.ids.size; T.dup += dup; T.ai += b.aiRows;
    const mark = dup > 0 ? '  ⚠ DUP' : '';
    if (dup > 0) flagged++;
    console.log(`${d}   ${String(b.rows).padStart(5)}   ${String(b.ids.size).padStart(10)}   ${String(b.udise.size).padStart(14)}   ${String(dup).padStart(7)}   ${String(b.aiRows).padStart(9)}   ${String(pct).padStart(3)}%${mark}`);
  }
  const tpct = T.rows ? Math.round((100 * T.ai) / T.rows) : 0;
  console.log(`TOTAL         ${String(T.rows).padStart(5)}   ${String(T.ids).padStart(10)}   ${''.padStart(14)}   ${String(T.dup).padStart(7)}   ${String(T.ai).padStart(9)}   ${String(tpct).padStart(3)}%`);

  // Any id appearing more than once (including across dates).
  const repeated = [...idSeen.entries()].filter(([, n]) => n > 1);
  console.log(`\nRepeated row ids (same id stored >1x): ${repeated.length}`);
  repeated.slice(0, 15).forEach(([id, n]) => console.log(`   ${id}  ×${n}`));
  console.log(`\n==> ${flagged ? flagged + ' date(s) have duplicate rows' : 'NO duplicate rows on any date'} ; ${repeated.length ? repeated.length + ' repeated ids' : 'no repeated ids'}.`);
}

main().catch((e) => { console.error('[dedup-audit] FAILED:', e); process.exit(1); });
