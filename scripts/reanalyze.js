// ============================================================
// Re-run AI analysis for submissions AFTER a cutoff date, leaving earlier days
// untouched. Used to backfill the days that were stored without AI (API key was
// suspended / overloaded). Keeps 18–19 Sept as-is; re-analyses the rest.
//
//   DATE_FROM  exclusive lower bound (default 2026-09-19 → reprocess dates > it)
//   CONCURRENCY parallel submissions (default 4)
// Writes the whole store once at the end (kept rows + freshly analysed rows),
// so a mid-run failure leaves the existing store intact. Run reflag afterwards.
// Needs: DATA_MODE=live, GEMINI_API_KEY, GOOGLE_SERVICE_ACCOUNT_JSON,
//        DAILY_SHEET_ID, RESULTS_SHEET_ID. ffmpeg on PATH.
// ============================================================
import { config } from '../backend/config.js';
import { getDailySubmissions } from '../backend/source.js';
import { processSubmission } from '../backend/pipeline.js';
import { readResults, clearResults, appendResults, ensureHeader } from '../backend/store.js';

const ITEMS = ['cooking', 'cooked_meal', 'serving_video', 'plate'];
const DATE_FROM = process.env.DATE_FROM || '2026-09-19';
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 4));
const hasAI = (f) => { const a = f && f.ai; return !!(a && typeof a === 'object' && (a.scene_type || a.observed_scene || a.notes || (a.dishes_visible && a.dishes_visible.length) || a.food_present != null || a.cooking_in_progress != null)); };

async function pool(items, n, worker) {
  const out = new Array(items.length);
  let i = 0, done = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await worker(items[idx], idx); }
      catch (e) { out[idx] = { __error: e.message }; }
      done++;
      if (done % 20 === 0 || done === items.length) console.log(`[reanalyze] ${done}/${items.length} done`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
  return out;
}

async function main() {
  if (config.dataMode !== 'live') { console.log('[reanalyze] DATA_MODE must be live'); process.exit(1); }
  const [stored, subs] = await Promise.all([readResults(), getDailySubmissions()]);
  const kept = stored.filter((r) => (r.date || '') <= DATE_FROM);
  const targets = subs.filter((s) => (s.date || '') > DATE_FROM);
  console.log(`[reanalyze] stored=${stored.length}  keeping ${kept.length} (≤${DATE_FROM})  re-analysing ${targets.length} (>${DATE_FROM})  concurrency=${CONCURRENCY}`);
  if (!targets.length) { console.log('[reanalyze] nothing to do'); return; }

  const processed = await pool(targets, CONCURRENCY, (s) => processSubmission(s, { live: true }));
  const good = processed.filter((r) => r && !r.__error);

  // Per-day AI success summary.
  const byDate = {};
  for (const r of good) {
    const b = byDate[r.date] || (byDate[r.date] = { rows: 0, aiRows: 0 });
    b.rows++; if (ITEMS.some((k) => hasAI(r.files?.[k]))) b.aiRows++;
  }
  console.log('[reanalyze] re-analysed per date (rowsWithAI / rows):');
  for (const d of Object.keys(byDate).sort()) console.log(`   ${d}: ${byDate[d].aiRows}/${byDate[d].rows}`);
  const failed = processed.length - good.length;
  if (failed) console.log(`[reanalyze] ${failed} submissions errored entirely (kept out of write)`);

  // Atomic rewrite: kept (≤cutoff) + freshly analysed (>cutoff).
  const final = [...kept, ...good];
  await clearResults();
  await ensureHeader();
  await appendResults(final);
  console.log(`[reanalyze] wrote ${final.length} rows (${kept.length} kept + ${good.length} re-analysed). Run reflag next.`);
}

main().catch((e) => { console.error('[reanalyze] FAILED:', e); process.exit(1); });
