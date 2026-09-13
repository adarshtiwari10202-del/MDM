// ============================================================
// Nightly processor (CLI) — the batch job that screens submissions.
// Runs anywhere with no serverless timeout: GitHub Actions (scheduled),
// a laptop, or a server. Reads unprocessed daily rows, runs the pipeline
// once per photo, writes results to the store.
//
//   DATA_MODE=live node scripts/process.js
//
// Env required (live): GEMINI_API_KEY, GOOGLE_SERVICE_ACCOUNT_JSON (or
// GOOGLE_APPLICATION_CREDENTIALS), DAILY_SHEET_ID, BASELINE_SHEET_ID,
// RESULTS_SHEET_ID. ffmpeg on PATH for video.
// ============================================================
import { config } from '../backend/config.js';
import { getDailySubmissions } from '../backend/source.js';
import { processAll } from '../backend/pipeline.js';
import { getProcessedIds, loadSeenHashes, appendResults, ensureHeader } from '../backend/store.js';

async function main() {
  const live = config.dataMode === 'live';
  console.log(`[process] mode=${config.dataMode}`);
  if (!live) {
    console.log('[process] DATA_MODE is not live — refusing to run against sample data. Set DATA_MODE=live.');
    process.exit(0);
  }
  await ensureHeader();
  const [subs, processedIds, seenHashes] = await Promise.all([
    getDailySubmissions(),
    getProcessedIds(),
    loadSeenHashes(),
  ]);
  const pending = subs.filter((s) => !processedIds.has(s.id));
  console.log(`[process] ${subs.length} total rows, ${pending.length} new to process`);
  if (!pending.length) { console.log('[process] nothing new. Done.'); return; }

  const results = await processAll(pending, { live: true, seenHashes });
  const { added } = await appendResults(results);
  const red = results.filter((r) => r.severity === 'red').length;
  const amber = results.filter((r) => r.severity === 'amber').length;
  console.log(`[process] wrote ${added} rows — ${red} red, ${amber} amber.`);
  for (const r of results) console.log(`  ${r.id}  ${r.severity.padEnd(5)} ${r.summary}`);
}

main().catch((e) => { console.error('[process] FAILED:', e); process.exit(1); });
