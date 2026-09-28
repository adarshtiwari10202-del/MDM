// ============================================================
// MDM Pilot — Flag Rules Engine  (Phase 3 core)
// ------------------------------------------------------------
// Pure logic. Takes ONE normalized daily submission + config,
// returns the flags, an overall severity, and a queue score.
//
// Design principle (locked): the AI never decides "acceptable".
// This engine only surfaces FLAGS for a human reviewer to judge.
// Nothing here writes a verdict — reviewer_verdict stays null.
// ============================================================
import { DISH_CATEGORIES } from './menu.js';

/** Severity ranks. Higher = worse. Used to compute overall severity + score. */
export const SEVERITY = { ok: 0, info: 1, amber: 2, red: 3 };
export const SEVERITY_NAME = ['ok', 'info', 'amber', 'red'];

/** Default rule configuration. Override per-deployment via config arg. */
export const DEFAULT_CONFIG = {
  // Meal must be submitted within this local-time window (24h clock).
  mealWindow: { startMin: 10 * 60 + 30, endMin: 13 * 60 + 0 }, // 10:30–13:00
  // Geo: allowed distance (metres). Used both for how far an upload may be from
  // the school's known location, and for the spread among a submission's own
  // photos. Set generously so a large campus + normal GPS drift (a few hundred
  // metres) does not flag; only genuinely different locations do.
  geoRadiusMeters: 500,
  // Timing spread: if all uploads land within this many seconds, it looks
  // like one staged burst rather than a genuine cook→serve→eat sequence.
  burstThresholdSeconds: 90,
  // The four daily items (food stages) every submission must contain.
  requiredItems: ['cooking', 'cooked_meal', 'serving_video', 'plate'],
};

/** Haversine distance in metres between two {lat,lng} points. */
function metersBetween(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** India Standard Time is UTC+05:30, fixed (no DST). Meal-window checks are
 *  always evaluated against IST wall-clock, independent of the server's TZ. */
const IST_OFFSET_MIN = 5 * 60 + 30;

/** Minutes-since-midnight (IST wall clock) for an ISO timestamp, or null. */
function minuteOfDay(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  // Shift UTC epoch into IST, then read the wall-clock in UTC terms.
  const ist = new Date(d.getTime() + IST_OFFSET_MIN * 60 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

/** Normalize a dish name for comparison (lowercase, trim, common synonyms). */
const DISH_SYNONYMS = {
  chapati: 'roti',
  chapatti: 'roti',
  aloo: 'potato',
  potato: 'potato',
  'boiled egg': 'egg',
};
function normDish(s) {
  const k = String(s || '').trim().toLowerCase();
  return DISH_SYNONYMS[k] || k;
}

/** Build one flag object. */
function flag(code, severity, message, stage = 'ai') {
  return { code, severity, message, stage };
}

// ------------------------------------------------------------
// Main entry point
// ------------------------------------------------------------
/**
 * @param {object} submission normalized daily submission (see sample data)
 * @param {object} [config]   rule config; merged over DEFAULT_CONFIG
 * @returns {{flags:Array, severity:string, severityRank:number, score:number, summary:string}}
 */
export function evaluateSubmission(submission, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const flags = [];
  const files = submission.files || {};
  const school = submission.school || {};
  const menu = submission.menu || []; // structured requirements (string | {anyOf})

  // --- Rule check 1: completeness (all four items received) ---
  const missing = cfg.requiredItems.filter((k) => !files[k] || files[k].missing);
  if (missing.length) {
    flags.push(
      flag(
        'items_missing',
        'red',
        `Incomplete submission: missing ${missing.join(', ')}`,
        'rule'
      )
    );
  }

  // (Amber-severity checks — meal-window timing, staged-burst — were removed:
  //  the system now surfaces only RED flags. The AI readings + stamp times are
  //  still stored, so these can be reintroduced later and re-flagged if wanted.)

  // --- Rule check 4a: geo match to known school location ---
  // Locations come from the GPS stamp the AI reads off each photo, merged
  // into files[k].location by the pipeline. school.location comes from the
  // school registry (backend/schools.js) once known.
  if (school.location) {
    for (const k of cfg.requiredItems) {
      const loc = files[k]?.location;
      if (!loc) continue; // only flag actual mismatches
      const dist = metersBetween(loc, school.location);
      if (dist != null && dist > cfg.geoRadiusMeters) {
        flags.push(
          flag(
            'geo_mismatch',
            'red',
            `${k} taken ${Math.round(dist)}m from school (limit ${cfg.geoRadiusMeters}m)`,
            'rule'
          )
        );
      }
    }
  }

  // --- Rule check 4b: geo consistency (all photos at the same place) ---
  // Works even without a known school location: the four stamped photos of
  // one meal should be co-located. A large spread suggests photos from
  // different places stitched into one submission.
  const geoPoints = cfg.requiredItems
    .map((k) => files[k]?.location)
    .filter((l) => l && l.lat != null);
  if (geoPoints.length >= 2) {
    let maxPair = 0;
    for (let i = 0; i < geoPoints.length; i++) {
      for (let j = i + 1; j < geoPoints.length; j++) {
        maxPair = Math.max(maxPair, metersBetween(geoPoints[i], geoPoints[j]) || 0);
      }
    }
    if (maxPair > cfg.geoRadiusMeters) {
      flags.push(
        flag(
          'geo_inconsistent',
          'red',
          `Photos taken up to ${Math.round(maxPair)}m apart — not one location`,
          'rule'
        )
      );
    }
  }

  // --- Rule check 4c: no geo-tagged photo at all ---
  // The location can only be verified if at least one submitted photo carries a
  // GPS-camera stamp. If the school attached photos but NONE are geo-tagged, the
  // whole submission is unverifiable by location — flag it.
  const presentItems = cfg.requiredItems.filter((k) => files[k] && !files[k].missing);
  const geoTagged = presentItems.filter((k) => files[k].location && files[k].location.lat != null);
  if (presentItems.length && geoTagged.length === 0) {
    flags.push(
      flag('geo_missing', 'red', 'No geo-tagged photo attached — location cannot be verified', 'rule')
    );
  }

  // --- Hash check: reused media (identical image CONTENT, by SHA-256) ---
  // Fires only when a photo's byte content matches one from a DIFFERENT
  // submission (another day/school) = genuine reuse. Same file in two slots of
  // the same submission is ignored. Filename is never used — only pixels.
  // f.duplicateOf carries a human-readable "who/when/which photo" descriptor.
  for (const k of cfg.requiredItems) {
    const f = files[k];
    if (f?.duplicateOf) {
      flags.push(
        flag('duplicate_media', 'red', `${itemName(k)} photo is identical to ${f.duplicateOf}`, 'rule')
      );
    }
  }

  // --- AI check: menu compliance ---
  const itemLabel = (item) => (typeof item === 'string' ? item : (item.anyOf || []).join('/'));
  // Set of dishes visibly present across the given stages (+ category members).
  const gatherSeen = (keys) => {
    const seen = new Set();
    for (const k of keys) {
      const ai = files[k]?.ai;
      if (!ai) continue;
      (ai.dishes_visible || []).forEach((d) => seen.add(normDish(d)));
      if (ai.menu_items_present) {
        for (const [item, present] of Object.entries(ai.menu_items_present)) {
          if (present) seen.add(normDish(item));
        }
      }
    }
    return seen;
  };
  const dishSeenIn = (seen, nd) => {
    if (seen.has(nd)) return true;
    const cats = DISH_CATEGORIES[nd];
    return !!(cats && cats.some((m) => seen.has(m)));
  };

  // menu_missing (red): a prescribed dish wasn't cooked at all (pot + plate both lack it).
  // Track which menu items this already covers so the plate check below does not
  // raise a SECOND flag for the same dish (one flag per missing dish is enough).
  const menuMissingLabels = new Set();
  if (menu.length) {
    const seenAll = gatherSeen(['cooked_meal', 'plate']);
    const present = (item) => {
      const names = typeof item === 'string' ? [item] : (item.anyOf || []);
      return names.some((n) => dishSeenIn(seenAll, normDish(n)));
    };
    const missing = menu.filter((it) => !present(it));
    missing.forEach((it) => menuMissingLabels.add(itemLabel(it)));
    if (missing.length) {
      flags.push(flag('menu_missing', 'red', `Prescribed dish not visible anywhere: ${missing.map(itemLabel).join(', ')}`, 'ai'));
    }
  }

  // plate_menu_missing (red): a prescribed dish is CLEARLY absent from the plate
  // (served-plate photo present; only clear absences flag — "unclear" does not).
  // A dish already reported by menu_missing (absent from the pot too) is skipped
  // so the same dish is never flagged twice.
  const plateAi = files.plate?.ai;
  if (menu.length && plateAi && !files.plate?.missing) {
    const seenPlate = gatherSeen(['plate']);
    const mip = plateAi.menu_items_present || {};
    const clearlyAbsent = (name) => {
      const nd = normDish(name);
      if (dishSeenIn(seenPlate, nd)) return false; // visibly present
      return mip[nd] === false;                    // AI marked it absent (not unclear)
    };
    const itemAbsent = (item) => {
      const names = typeof item === 'string' ? [item] : (item.anyOf || []);
      return names.length > 0 && names.every(clearlyAbsent);
    };
    const missingOnPlate = menu
      .filter((it) => !menuMissingLabels.has(itemLabel(it))) // not already flagged as missing everywhere
      .filter(itemAbsent)
      .map(itemLabel);
    if (missingOnPlate.length) {
      flags.push(flag('plate_menu_missing', 'red', `Prescribed dish not served on the plate: ${missingOnPlate.join(', ')}`, 'ai'));
    }
  }

  // --- AI scene check: food present ---
  const cooked = files.cooked_meal?.ai;
  if (cooked && cooked.food_present === false) {
    flags.push(flag('no_food', 'red', 'No food visible in the cooked-meal photo', 'ai'));
  }

  // --- AI check: hygiene & cleanliness (clear negatives only; 'unclear' never flags) ---
  const hyg = [];
  for (const k of cfg.requiredItems) {
    const ai = files[k]?.ai;
    if (!ai) continue;
    const label = itemName(k);
    if (ai.kitchen_cleanliness === 'dirty' && k === 'cooking') hyg.push('dirty kitchen');
    if (ai.area_cleanliness === 'dirty') hyg.push(`dirty surroundings (${label})`);
    if (ai.waste_or_pests_visible === 'yes') hyg.push(`waste/pests near food (${label})`);
    // Note: uncovered food is NOT a hygiene flag — schools uncover the food to
    // photograph it for us, so it is expected and fine.
  }
  if (hyg.length) {
    flags.push(flag('hygiene_concern', 'red', `Hygiene concern: ${[...new Set(hyg)].join('; ')}`, 'ai'));
  }

  // --- Roll up (RED-only model) ---
  // Every flag is red; a school is ranked by how many red flags it has.
  const reds = flags.length;
  const severity = reds > 0 ? 'red' : 'ok';
  const severityRank = reds > 0 ? SEVERITY.red : SEVERITY.ok;
  const score = reds; // queue sorts by number of red flags, highest first
  const summary = reds ? `${reds} red flag${reds > 1 ? 's' : ''}` : 'No flags';

  return { flags, severity, severityRank, score, summary };
}

/** Readable name for a file slot, used in flag messages. */
function itemName(k) {
  return { cooking: 'Cooking', cooked_meal: 'Cooked-meal', serving_video: 'Serving-video', plate: 'Plate' }[k] || k;
}
