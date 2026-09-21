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

// Daily items (form upload slots) and the AI stage each maps to.
const ITEMS = ['cooking', 'cooked_meal', 'serving_video', 'plate'];
const ITEM_STAGE = {
  cooking: 'cooking',
  cooked_meal: 'cooked_food',
  serving_video: 'serving',
  plate: 'plate',
};

// tri-state 'yes'|'no'|'unclear' -> true|false|null
const yn = (x) => (x === 'yes' ? true : x === 'no' ? false : null);

/**
 * Adapter: the v2 per-scene reading is rich, but the current flag engine and
 * dashboard read a small "legacy" field set. We keep the full v2 reading AND
 * merge in these legacy fields so nothing downstream breaks. The flag-policy
 * redesign will consume the rich v2 fields directly.
 */
function normalizeReading(stage, v2) {
  if (!v2 || typeof v2 !== 'object') return v2;
  const dishes = v2.dishes_visible || v2.dishes_on_plate || v2.dishes_served || v2.dishes_being_cooked || [];
  const legacy = {
    scene_type: v2.observed_scene,
    dishes_visible: dishes,
    food_present: v2.food_present !== undefined ? yn(v2.food_present) : null,
    cooking_in_progress: v2.cooking_in_progress !== undefined ? yn(v2.cooking_in_progress) : null,
    notes: v2.notes,
  };
  if (Array.isArray(v2.menu_items)) {
    legacy.menu_items_present = {};
    for (const mi of v2.menu_items) {
      if (mi.status === 'present') legacy.menu_items_present[mi.item] = true;
      else if (mi.status === 'absent') legacy.menu_items_present[mi.item] = false;
      // 'unclear' is intentionally omitted so it never triggers a menu flag
    }
  }
  return { ...v2, ...legacy };
}

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

/** Readable name for a file slot, used in duplicate descriptors. */
const SLOT_LABEL = {
  cooking: 'Cooking',
  cooked_meal: 'Cooked-meal',
  serving_video: 'Serving-video',
  plate: 'Plate',
};

/** Human-readable "who/when/which photo" descriptor for a submission's slot,
 *  e.g. "PARSEHRA NATH (UPS) [9240500704] on 2026-09-18 (Cooked-meal)". */
export function sourceLabel(sub, slot) {
  const school = sub.school || {};
  const name = school.name || school.udise || 'unknown school';
  const udise = school.udise ? ` [${school.udise}]` : '';
  const date = sub.date ? ` on ${sub.date}` : '';
  return `${name}${udise}${date} (${SLOT_LABEL[slot] || slot})`;
}

/**
 * Duplicate detection by content CONTENT hash (SHA-256 of raw bytes — never the
 * filename). seenHashes maps hash -> { id, label } of the FIRST slot that used it.
 *   • match in a DIFFERENT submission  -> f.duplicateOf = that source's label (red)
 *   • match within the SAME submission -> ignored (a school reusing one file
 *     across its own four slots is not reuse across days/schools).
 */
function markDuplicate(file, sub, slot, seenHashes) {
  if (!seenHashes || !file.hash) return;
  const prev = seenHashes.get(file.hash);
  if (prev && prev.id !== sub.id) file.duplicateOf = prev.label;
  else if (!prev) seenHashes.set(file.hash, { id: sub.id, label: sourceLabel(sub, slot) });
}

/** Merge the AI-extracted stamp (GPS + time) into the file's rule inputs. */
function mergeStamp(file) {
  const ai = file.ai;
  if (!ai) return;
  if (ai.gps_lat != null && ai.gps_lng != null && !file.location) {
    file.location = { lat: Number(ai.gps_lat), lng: Number(ai.gps_lng) };
  }
  const stampTime = ai.capture_datetime_text || ai.stamp_datetime; // v2 || legacy
  if (stampTime && !file.uploadedAt) {
    const t = parseStampDateTime(stampTime);
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
        markDuplicate(f, sub, k, ctx.seenHashes);
        const stage = ITEM_STAGE[k];
        if (k === 'serving_video') {
          const tmp = path.join(os.tmpdir(), `mdm-${f.hash.slice(0, 12)}.mp4`);
          fs.writeFileSync(tmp, buf);
          try { f.ai = normalizeReading(stage, await analyzeVideo(tmp, { menuItems: menu })); }
          finally { fs.rmSync(tmp, { force: true }); }
        } else {
          f.ai = normalizeReading(stage, await analyzeImage(buf, { stage, menuItems: menu }));
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
      if (f.hash) markDuplicate(f, sub, k, ctx.seenHashes);
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
