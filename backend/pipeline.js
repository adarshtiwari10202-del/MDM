// ============================================================
// Processing pipeline (Phase 3 wiring) — process one/all submissions.
//   fetch media → AI read → merge stamped GPS/time → hash for dupes →
//   run flag engine → result row (reviewer_verdict = null).
//
// AI + Drive are only touched in live mode. In sample mode the AI reading
// is already attached to each file, so this stays free and offline.
// ============================================================
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateSubmission } from './flagRules.js';
import { menuDishList } from './menu.js';
import { config } from './config.js';

const ITEMS = ['cooking', 'cooked_meal', 'serving_video', 'children'];

/** Best-effort parse of a stamp date-time string into ISO (IST). */
export function parseStampDateTime(s) {
  if (!s) return null;
  const str = String(s).trim();
  // DD/MM/YYYY hh:mm(:ss) (am/pm) — common GPS Map Camera format in India
  let m = str.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (m) {
    let [, d, mo, y, h, mi, se, ap] = m;
    h = Number(h);
    if (ap) { const P = /pm/i.test(ap); if (P && h < 12) h += 12; if (!P && h === 12) h = 0; }
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${mi}:${se || '00'}+05:30`;
  }
  const dt = new Date(str);
  return isNaN(dt) ? null : dt.toISOString();
}

/** Merge the AI-extracted stamp (GPS + time) into the file's rule inputs. */
function mergeStamp(file) {
  const ai = file.ai;
  if (!ai) return;
  if (ai.gps_lat != null && ai.gps_lng != null && !file.location) {
    file.location = { lat: Number(ai.gps_lat), lng: Number(ai.gps_lng) };
  }
  if (ai.stamp_datetime && !file.uploadedAt) {
    const t = parseStampDateTime(ai.stamp_datetime);
    if (t) file.uploadedAt = t;
  }
}

/**
 * Process one submission into a result row.
 * @param {object} sub normalized submission
 * @param {object} [ctx] { live, seenHashes:Set }
 */
export async function processSubmission(sub, ctx = {}) {
  const live = ctx.live ?? (config.dataMode === 'live');
  const menu = menuDishList(sub.menu);

  if (live) {
    const { fetchDriveFile } = await import('./sheets.js');
    const { analyzeImage, analyzeVideo } = await import('./ai.js');
    for (const k of ITEMS) {
      const f = sub.files[k];
      if (!f || f.missing || !f.fileId) continue;
      try {
        const buf = await fetchDriveFile(f.fileId);
        f.hash = crypto.createHash('sha256').update(buf).digest('hex');
        if (ctx.seenHashes) {
          if (ctx.seenHashes.has(f.hash)) f.duplicateOf = 'an earlier submission';
          else ctx.seenHashes.set(f.hash, sub.id);
        }
        if (k === 'serving_video') {
          const tmp = path.join(os.tmpdir(), `mdm-${f.hash.slice(0, 12)}.mp4`);
          fs.writeFileSync(tmp, buf);
          try { f.ai = await analyzeVideo(tmp, menu); } finally { fs.rmSync(tmp, { force: true }); }
        } else {
          f.ai = await analyzeImage(buf, menu);
        }
      } catch (e) {
        f.error = e.message; // keep going; a fetch/AI failure shouldn't drop the row
      }
      mergeStamp(f);
    }
  } else {
    // sample mode: readings already attached; still honour stamp + hash dedupe.
    for (const k of ITEMS) {
      const f = sub.files[k];
      if (!f || f.missing) continue;
      if (ctx.seenHashes && f.hash) {
        if (ctx.seenHashes.has(f.hash)) f.duplicateOf = f.duplicateOf || 'an earlier submission';
        else ctx.seenHashes.set(f.hash, sub.id);
      }
      mergeStamp(f);
    }
  }

  const r = evaluateSubmission(sub);
  return {
    ...sub,
    ...r,
    menuLabel: menu.join(', '),
    reviewer_verdict: null,
    reviewer_comment: '',
    reviewer_at: null,
    processedAt: new Date().toISOString(),
  };
}

/** Process an array of submissions, sorted worst-first. */
export async function processAll(subs, ctx = {}) {
  const seenHashes = ctx.seenHashes || new Map();
  const out = [];
  for (const s of subs) out.push(await processSubmission(s, { ...ctx, seenHashes }));
  out.sort((a, b) => b.score - a.score);
  return out;
}
