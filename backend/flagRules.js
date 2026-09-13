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
  // Geo: how far (metres) an upload's location may be from the school.
  geoRadiusMeters: 150,
  // Timing spread: if all uploads land within this many seconds, it looks
  // like one staged burst rather than a genuine cook→serve→eat sequence.
  burstThresholdSeconds: 90,
  // The four items every daily submission must contain.
  requiredItems: ['cooking', 'cooked_meal', 'serving_video', 'children'],
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

  // --- Rule check 2: timestamp within meal window ---
  const times = cfg.requiredItems
    .map((k) => files[k]?.uploadedAt)
    .filter(Boolean);
  const firstTime = times.length ? times.slice().sort()[0] : submission.submittedAt;
  const mod = minuteOfDay(firstTime);
  if (mod != null) {
    if (mod < cfg.mealWindow.startMin || mod > cfg.mealWindow.endMin) {
      flags.push(
        flag(
          'outside_meal_window',
          'amber',
          `Submitted outside meal window (${fmtMin(mod)})`,
          'rule'
        )
      );
    }
  }

  // --- Rule check 3: timing spread (staged burst) ---
  if (times.length >= 2) {
    const secs = times.map((t) => new Date(t).getTime() / 1000);
    const spread = Math.max(...secs) - Math.min(...secs);
    if (spread <= cfg.burstThresholdSeconds) {
      flags.push(
        flag(
          'staged_burst',
          'amber',
          `All media uploaded within ${Math.round(spread)}s — possible staged burst`,
          'rule'
        )
      );
    }
  }

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

  // --- Hash check: duplicate / reused media ---
  for (const k of cfg.requiredItems) {
    const f = files[k];
    if (f?.duplicateOf) {
      flags.push(
        flag(
          'duplicate_media',
          'red',
          `${k} is a duplicate of submission ${f.duplicateOf}`,
          'rule'
        )
      );
    }
  }

  // --- AI check: menu compliance ---
  // Gather all dishes the AI saw in the meal + serving frames.
  const seen = new Set();
  for (const k of ['cooked_meal', 'serving_video']) {
    const ai = files[k]?.ai;
    if (!ai) continue;
    (ai.dishes_visible || []).forEach((d) => seen.add(normDish(d)));
    if (ai.menu_items_present) {
      for (const [item, present] of Object.entries(ai.menu_items_present)) {
        if (present) seen.add(normDish(item));
      }
    }
  }
  // A dish counts as seen if it (or a category member) appears.
  const dishSeen = (nd) => {
    if (seen.has(nd)) return true;
    const cats = DISH_CATEGORIES[nd];
    return !!(cats && cats.some((m) => seen.has(m)));
  };
  const itemPresent = (item) => {
    if (typeof item === 'string') return dishSeen(normDish(item));
    if (item && item.anyOf) return item.anyOf.some((x) => dishSeen(normDish(x)));
    return true;
  };
  const itemLabel = (item) => (typeof item === 'string' ? item : (item.anyOf || []).join('/'));
  if (menu.length) {
    const missingMenu = menu.filter((it) => !itemPresent(it)).map(itemLabel);
    if (missingMenu.length) {
      flags.push(
        flag(
          'menu_missing',
          'red',
          `Prescribed dish not visible: ${missingMenu.join(', ')}`,
          'ai'
        )
      );
    }
  }

  // --- AI scene checks ---
  const cooked = files.cooked_meal?.ai;
  if (cooked && cooked.food_present === false) {
    flags.push(flag('no_food', 'red', 'No food visible in the cooked-meal photo', 'ai'));
  }
  const children = files.children?.ai;
  if (children && children.children_eating === false) {
    flags.push(
      flag('no_children_eating', 'amber', 'Children not visibly eating in wide photo', 'ai')
    );
  }
  const cooking = files.cooking?.ai;
  if (cooking && cooking.cooking_in_progress === false) {
    flags.push(
      flag('no_cooking', 'amber', 'Cooking not visibly in progress in cooking photo', 'ai')
    );
  }

  // --- Roll up ---
  const severityRank = flags.reduce((m, f) => Math.max(m, SEVERITY[f.severity] || 0), 0);
  const severity = SEVERITY_NAME[severityRank];
  // Queue score: reds dominate, ambers add a little. Higher = review sooner.
  const reds = flags.filter((f) => f.severity === 'red').length;
  const ambers = flags.filter((f) => f.severity === 'amber').length;
  const score = reds * 100 + ambers * 10;
  const summary = flags.length
    ? `${reds} red, ${ambers} amber`
    : 'No automated flags';

  return { flags, severity, severityRank, score, summary };
}

function fmtMin(m) {
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  return `${String(h).padStart(2, '0')}:${mm}`;
}
