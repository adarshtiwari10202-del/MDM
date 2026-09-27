// ============================================================
// Row parser (Phase 1) — pure logic.
// Turns one daily-form row (object keyed by header text) into the
// normalized submission shape the flag engine already consumes.
//
// Column matching is keyword-based (English substrings) so it
// survives minor edits to the bilingual header text.
// ============================================================
import { getMenu } from './menu.js';

// logical field -> list of case-insensitive keywords to find its header
const DAILY_COLS = {
  timestamp: ['timestamp'],
  school: ['school name'],
  date: ["today's date", 'today date', 'date'],
  headcount: ['number of students', 'students who ate', 'headcount'],
  udise: ['udise'],
  cooking: ['photo 1', 'food being cooked', 'cooking'],
  cooked_meal: ['photo 2', 'cooked meal', 'vessel'],
  serving_video: ['video'],
  // The 4th slot is now the served-plate photo (children photo removed).
  // Matches once the daily form's 4th upload is a "plate with all the food".
  // Specific wording so it never collides with the video column
  // ("...Serving onto a plate"). Matches the relabelled 4th upload.
  plate: ['plate with', 'all the food', 'thali', 'सम्पूर्ण भोजन', 'भोजन की थाली'],
};

/** Resolve logical field -> actual header string present in the sheet. */
export function resolveColumns(headers, spec = DAILY_COLS) {
  const map = {};
  const lowerHeaders = headers.map((h) => ({ raw: h, low: String(h).toLowerCase() }));
  for (const [field, keywords] of Object.entries(spec)) {
    let found = null;
    for (const kw of keywords) {
      const hit = lowerHeaders.find((h) => h.low.includes(kw));
      if (hit) { found = hit.raw; break; }
    }
    map[field] = found; // may be null if column absent
  }
  return map;
}

/** Extract a Drive file id from any of the common URL shapes. */
export function driveFileId(url) {
  if (!url) return null;
  const s = String(url).trim();
  let m = s.match(/[?&]id=([A-Za-z0-9_-]+)/); if (m) return m[1];
  m = s.match(/\/file\/d\/([A-Za-z0-9_-]+)/); if (m) return m[1];
  m = s.match(/\/d\/([A-Za-z0-9_-]+)/); if (m) return m[1];
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s; // bare id
  return null;
}

/** 'M/D/YYYY' (Google Forms default) or ISO -> 'YYYY-MM-DD'. */
export function toISODate(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [, mo, d, y] = m;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

/** 'M/D/YYYY H:MM:SS' timestamp -> ISO datetime in IST. */
export function toISODateTime(s) {
  if (!s) return null;
  const str = String(s).trim();
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const [, mo, d, y, h, mi, se] = m;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${mi}:${se || '00'}+05:30`;
  }
  const dt = new Date(str);
  return isNaN(dt) ? null : dt.toISOString();
}

function fileFromUrl(url) {
  const id = driveFileId(url);
  if (!id) return { missing: true };
  return { fileId: id, url: `https://drive.google.com/open?id=${id}` };
}

/**
 * Grouping date for a submission. Google's auto-recorded submission timestamp
 * is the source of truth (it cannot be mistyped, and MDM photos are taken and
 * submitted the same day), so the timestamp's date is always used when present.
 * The manual "Today's Date" field is kept only as a cross-check: `mismatch` is
 * true when it disagrees with the timestamp date. The manual date is used only
 * as a fallback when no timestamp exists.
 * @param {string|null} manualISO   'YYYY-MM-DD' from toISODate(manual field)
 * @param {string|null} submittedAtISO ISO datetime from toISODateTime(timestamp)
 * @returns {{date: string|null, source: 'timestamp'|'manual'|'none', mismatch: boolean}}
 */
export function effectiveDate(manualISO, submittedAtISO) {
  const ts = submittedAtISO ? String(submittedAtISO).slice(0, 10) : null;
  if (ts) return { date: ts, source: 'timestamp', mismatch: !!manualISO && manualISO !== ts };
  if (manualISO) return { date: manualISO, source: 'manual', mismatch: false };
  return { date: null, source: 'none', mismatch: false };
}

/**
 * Parse one daily row.
 * @param {object} row      header -> cell value
 * @param {object} cols     resolveColumns() output (pass once, reuse per row)
 * @param {object} [opts]   { rowIndex, schoolLookup } schoolLookup: udise -> {name,location,...}
 * @returns {object} normalized submission (no AI readings yet — added in Phase 2)
 */
export function parseDailyRow(row, cols, opts = {}) {
  const get = (field) => (cols[field] ? row[cols[field]] : undefined);
  const schoolRaw = String(get('school') || '').trim();

  // UDISE: prefer a dedicated column; otherwise extract the leading code from
  // the school field (some forms merge them, e.g. "9240504102 NAVINAGAR-2 (PS)").
  let udise = String(get('udise') || '').trim();
  let name = schoolRaw;
  if (!udise) {
    const m = schoolRaw.match(/\b(\d{8,15})\b/);
    if (m) {
      udise = m[1];
      name = schoolRaw.replace(m[1], '').replace(/^[\s\-–—:.,]+/, '').trim();
    }
  }

  const manualDate = toISODate(get('date'));
  const submittedAt = toISODateTime(get('timestamp'));
  const eff = effectiveDate(manualDate, submittedAt);
  const date = eff.date;               // reconciled grouping date (see effectiveDate)
  const baseline = opts.schoolLookup?.[udise] || {};
  const id = `${udise || 'unknown'}_${date || 'nodate'}${opts.rowIndex != null ? '_r' + opts.rowIndex : ''}`;

  return {
    id,
    rowIndex: opts.rowIndex ?? null,
    school: {
      udise,
      name: name || baseline.name || '',
      block: baseline.block || 'Hargaon',
      location: baseline.location || null,
      baseline,
    },
    date,
    manualDate,                        // what the responder typed (may be wrong)
    dateSource: eff.source,           // 'timestamp' | 'manual' | 'none'
    dateMismatch: eff.mismatch,       // true when typed date ≠ submission-timestamp date
    submittedAt,
    menu: getMenu(date, udise),
    headcountReported: Number(String(get('headcount') || '').replace(/[^\d]/g, '')) || null,
    files: {
      cooking: fileFromUrl(get('cooking')),
      cooked_meal: fileFromUrl(get('cooked_meal')),
      serving_video: fileFromUrl(get('serving_video')),
      plate: fileFromUrl(get('plate')),
    },
  };
}
