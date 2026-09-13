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
  children: ['photo 3', 'children eating', 'wide angle'],
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
 * Parse one daily row.
 * @param {object} row      header -> cell value
 * @param {object} cols     resolveColumns() output (pass once, reuse per row)
 * @param {object} [opts]   { rowIndex, schoolLookup } schoolLookup: udise -> {name,location,...}
 * @returns {object} normalized submission (no AI readings yet — added in Phase 2)
 */
export function parseDailyRow(row, cols, opts = {}) {
  const get = (field) => (cols[field] ? row[cols[field]] : undefined);
  const udise = String(get('udise') || '').trim();
  const date = toISODate(get('date'));
  const submittedAt = toISODateTime(get('timestamp'));
  const baseline = opts.schoolLookup?.[udise] || {};
  const id = `${udise || 'unknown'}_${date || 'nodate'}${opts.rowIndex != null ? '_r' + opts.rowIndex : ''}`;

  return {
    id,
    rowIndex: opts.rowIndex ?? null,
    school: {
      udise,
      name: String(get('school') || baseline.name || '').trim(),
      block: baseline.block || 'Khairabad',
      location: baseline.location || null,
      baseline,
    },
    date,
    submittedAt,
    menu: getMenu(date, udise),
    headcountReported: Number(String(get('headcount') || '').replace(/[^\d]/g, '')) || null,
    files: {
      cooking: fileFromUrl(get('cooking')),
      cooked_meal: fileFromUrl(get('cooked_meal')),
      serving_video: fileFromUrl(get('serving_video')),
      children: fileFromUrl(get('children')),
    },
  };
}
