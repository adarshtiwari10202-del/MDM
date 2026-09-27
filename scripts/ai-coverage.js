// ============================================================
// Verify AI-analysis coverage per date in the results store.
// For each reporting day, counts how many submitted media files actually have
// a Gemini reading vs. an error vs. nothing — so we can see which days got real
// AI analysis and which were rule-only (e.g. while the API key was suspended).
//   node scripts/ai-coverage.js
// Needs: GOOGLE_SERVICE_ACCOUNT_JSON, RESULTS_SHEET_ID.
// ============================================================
import { readResults } from '../backend/store.js';

const ITEMS = ['cooking', 'cooked_meal', 'serving_video', 'plate'];

function hasAI(f) {
  const a = f && f.ai;
  if (!a || typeof a !== 'object') return false;
  return !!(a.scene_type || a.observed_scene || a.notes ||
    (Array.isArray(a.dishes_visible) && a.dishes_visible.length) ||
    a.food_present != null || a.cooking_in_progress != null || a.plate_fullness);
}

async function main() {
  const rows = await readResults();
  const byDate = {};
  const errSamples = {};
  for (const r of rows) {
    const d = r.date || 'nodate';
    const b = byDate[d] || (byDate[d] = { rows: 0, present: 0, ai: 0, err: 0, none: 0, missing: 0, aiRows: 0 });
    b.rows++;
    let rowHasAI = false;
    for (const k of ITEMS) {
      const f = r.files?.[k];
      if (!f) continue;
      if (f.missing) { b.missing++; continue; }
      b.present++;
      if (hasAI(f)) { b.ai++; rowHasAI = true; }
      else if (f.error) { b.err++; if (!errSamples[d] && f.error) errSamples[d] = String(f.error).slice(0, 140); }
      else b.none++;
    }
    if (rowHasAI) b.aiRows++;
  }

  console.log('AI coverage by reporting date (media files with a real Gemini reading):\n');
  console.log('date         rows  rowsWithAI   files  withAI  errors   noAI  missing   AI%');
  let T = { rows: 0, present: 0, ai: 0, err: 0, none: 0, missing: 0, aiRows: 0 };
  for (const d of Object.keys(byDate).sort()) {
    const b = byDate[d];
    for (const k of Object.keys(T)) T[k] += b[k];
    const pct = b.present ? Math.round((100 * b.ai) / b.present) : 0;
    console.log(`${d}   ${String(b.rows).padStart(4)}   ${String(b.aiRows).padStart(8)}   ${String(b.present).padStart(5)}  ${String(b.ai).padStart(6)}  ${String(b.err).padStart(6)}  ${String(b.none).padStart(5)}  ${String(b.missing).padStart(6)}  ${String(pct).padStart(3)}%`);
  }
  const tpct = T.present ? Math.round((100 * T.ai) / T.present) : 0;
  console.log(`TOTAL        ${String(T.rows).padStart(4)}   ${String(T.aiRows).padStart(8)}   ${String(T.present).padStart(5)}  ${String(T.ai).padStart(6)}  ${String(T.err).padStart(6)}  ${String(T.none).padStart(5)}  ${String(T.missing).padStart(6)}  ${String(tpct).padStart(3)}%`);

  console.log('\nSample error per date (why AI is missing), if any:');
  for (const d of Object.keys(errSamples).sort()) console.log(`  ${d}: ${errSamples[d]}`);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
