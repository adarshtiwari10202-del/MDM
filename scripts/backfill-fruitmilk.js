// ============================================================
// Backfill the Monday/Wednesday fruit-&-milk extra photo (form column J).
//
// For every stored result row whose day prescribes fruit (Mon) or milk (Wed),
// this fetches the school's fruit/milk photo, runs ONE focused AI read on it
// (fruit & milk only), and merges that reading into the row's files store as
// `files.fruit_milk`. It does NOT touch or re-pay for the four core media.
//
// After this, run scripts/reflag.js to recompute flags — a fruit or milk seen
// in this photo (or any other) then counts toward menu compliance.
//
//   node scripts/backfill-fruitmilk.js [--since=YYYY-MM-DD] [--force] [--limit=N]
//
// Needs: DATA_MODE=live, GOOGLE_SERVICE_ACCOUNT_JSON, GEMINI_API_KEY,
//        RESULTS_SHEET_ID, DAILY_SHEET_ID. Idempotent: a row already carrying a
//        fruit_milk AI reading is skipped unless --force.
// ============================================================
import crypto from 'node:crypto';
import { config } from '../backend/config.js';
import { getDailySubmissions } from '../backend/source.js';
import { readResults, clearResults, appendResults } from '../backend/store.js';
import { fetchDriveFile } from '../backend/sheets.js';
import { analyzeImage } from '../backend/ai.js';
import { normalizeReading, dayWantsFruitMilk } from '../backend/pipeline.js';
import { getMenu, menuDishList } from '../backend/menu.js';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=')[1] : d;
};
const has = (k) => process.argv.includes(`--${k}`);

const SINCE = arg('since', '2026-11-01');
const FORCE = has('force');
const LIMIT = Number(arg('limit', '0')) || 0; // 0 = no cap
const CONCURRENCY = Number(arg('concurrency', '6')) || 6;

const hasAi = (f) => !!(f && f.ai && typeof f.ai === 'object'
  && (f.ai.observed_scene || f.ai.menu_items_present || f.ai.fruit_visible != null
      || (Array.isArray(f.ai.dishes_visible))));

async function pool(items, n, worker) {
  let i = 0; let done = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
      done++;
      if (done % 25 === 0) console.log(`[backfill]   ...${done}/${items.length}`);
    }
  });
  await Promise.all(runners);
}

async function main() {
  if (config.dataMode !== 'live') {
    console.error('[backfill] DATA_MODE must be "live"; aborting.');
    process.exit(1);
  }

  const [rows, subs] = await Promise.all([readResults(), getDailySubmissions()]);
  console.log(`[backfill] ${rows.length} stored rows, ${subs.length} live submissions`);

  // Map submission id -> its parsed fruit_milk file (fileId/url) if present.
  const fmById = new Map();
  for (const s of subs) {
    const fm = s.files?.fruit_milk;
    if (fm && !fm.missing && fm.fileId) fmById.set(s.id, fm);
  }
  console.log(`[backfill] ${fmById.size} submissions carry a fruit/milk photo`);

  // Rows eligible for analysis: Mon/Wed, have a fruit/milk photo, not already done.
  const todo = [];
  for (const r of rows) {
    if (SINCE && r.date < SINCE) continue;
    const menu = menuDishList(getMenu(r.date, r.school?.udise));
    if (!dayWantsFruitMilk(menu)) continue;
    const fm = fmById.get(r.id);
    if (!fm) continue;
    if (!FORCE && hasAi(r.files?.fruit_milk)) continue;
    todo.push({ r, fm, menu });
  }
  const work = LIMIT ? todo.slice(0, LIMIT) : todo;
  console.log(`[backfill] ${work.length} photos to analyse (since ${SINCE}, force=${FORCE})`);
  if (!work.length) { console.log('[backfill] nothing to do.'); return; }

  let ok = 0; let err = 0;
  await pool(work, CONCURRENCY, async ({ r, fm, menu }) => {
    try {
      const buf = await fetchDriveFile(fm.fileId);
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      const ai = normalizeReading('fruit_milk', await analyzeImage(buf, { stage: 'fruit_milk', menuItems: menu }));
      r.files = r.files || {};
      r.files.fruit_milk = { fileId: fm.fileId, url: fm.url || '', hash, ai };
      ok++;
    } catch (e) {
      err++;
      r.files = r.files || {};
      r.files.fruit_milk = { fileId: fm.fileId, url: fm.url || '', error: e.message };
      console.error(`[backfill] ${r.id}: ${e.message}`);
    }
  });

  console.log(`[backfill] analysed ${ok} ok, ${err} errors — rewriting store...`);
  await clearResults();
  await appendResults(rows);
  console.log(`[backfill] done. Now run: node scripts/reflag.js`);
}

main().catch((e) => { console.error('[backfill] FAILED:', e); process.exit(1); });
