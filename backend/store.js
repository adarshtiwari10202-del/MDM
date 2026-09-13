// ============================================================
// Results store (Phase 3/5) — a Google Sheet the backend writes to.
// One row per processed submission. The dashboard reads this (fast,
// cheap); the nightly cron writes it (AI runs once per photo, ever).
//
// Needs the service account to have WRITER access to RESULTS_SHEET_ID
// (already granted). Scope: spreadsheets (read+write).
// ============================================================
import fs from 'node:fs';
import { config } from './config.js';

export const COLUMNS = [
  'id', 'date', 'udise', 'school_name', 'block', 'menuLabel',
  'severity', 'score', 'summary', 'flags_json', 'files_json',
  'headcount', 'submittedAt', 'processedAt',
  'reviewer_verdict', 'reviewer_comment', 'reviewer_at',
];

let _sheets = null;
async function sheetsClient() {
  if (_sheets) return _sheets;
  const { google } = await import('googleapis');
  let credentials;
  if (config.google.serviceAccountJson) credentials = JSON.parse(config.google.serviceAccountJson);
  else if (config.google.credentialsPath && fs.existsSync(config.google.credentialsPath))
    credentials = JSON.parse(fs.readFileSync(config.google.credentialsPath, 'utf8'));
  else throw new Error('No service-account credentials for results store.');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  _sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  return _sheets;
}

const SHEET = () => config.ids.resultsSheet;
const TAB = () => config.ids.resultsTab || 'Results';

// The results sheet's actual tab may be the auto-created "Sheet1" rather than
// the configured "Results". Resolve (and cache) the real tab title once so all
// ranges are valid regardless of what the tab is actually called.
let _tab = null;
async function tabName(sheets) {
  if (_tab) return _tab;
  const configured = TAB();
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET() });
    const titles = (meta.data.sheets || []).map((s) => s.properties.title);
    _tab = titles.includes(configured) ? configured : (titles[0] || configured);
  } catch {
    _tab = configured;
  }
  return _tab;
}

/** Ensure the header row exists (idempotent). */
export async function ensureHeader() {
  const sheets = await sheetsClient();
  const tab = await tabName(sheets);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET(), range: `${tab}!1:1` });
  const have = (res.data.values && res.data.values[0]) || [];
  if (have.length < COLUMNS.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET(),
      range: `${tab}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [COLUMNS] },
    });
  }
}

function resultToRow(r) {
  const f = r.files || {};
  return [
    r.id, r.date, r.school?.udise || '', r.school?.name || '', r.school?.block || '',
    r.menuLabel || '', r.severity || '', String(r.score ?? ''), r.summary || '',
    JSON.stringify(r.flags || []), JSON.stringify(f),
    String(r.headcountReported ?? ''), r.submittedAt || '', r.processedAt || '',
    r.reviewer_verdict || '', r.reviewer_comment || '', r.reviewer_at || '',
  ];
}

function rowToResult(row, headers) {
  const o = {};
  headers.forEach((h, i) => (o[h] = row[i] ?? ''));
  const safe = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
  const files = safe(o.files_json, {});
  return {
    id: o.id, date: o.date,
    school: { udise: o.udise, name: o.school_name, block: o.block },
    menuLabel: o.menuLabel, menu: o.menuLabel ? o.menuLabel.split(', ') : [],
    severity: o.severity, score: Number(o.score) || 0, summary: o.summary,
    flags: safe(o.flags_json, []), files,
    headcountReported: o.headcount ? Number(o.headcount) : null,
    submittedAt: o.submittedAt, processedAt: o.processedAt,
    reviewer_verdict: o.reviewer_verdict || null,
    reviewer_comment: o.reviewer_comment || '',
    reviewer_at: o.reviewer_at || null,
  };
}

/** Read all stored result rows (optionally filter by date). */
export async function readResults({ date } = {}) {
  const sheets = await sheetsClient();
  const tab = await tabName(sheets);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET(), range: `${tab}` });
  const values = res.data.values || [];
  if (values.length < 2) return [];
  const headers = values[0];
  const rows = values.slice(1).map((r) => rowToResult(r, headers)).filter((r) => r.id);
  return date ? rows.filter((r) => r.date === date) : rows;
}

/** Set of submission ids already in the store. */
export async function getProcessedIds() {
  const sheets = await sheetsClient();
  const tab = await tabName(sheets);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET(), range: `${tab}!A2:A` });
  return new Set((res.data.values || []).map((r) => r[0]).filter(Boolean));
}

/** Map of media hash -> submission id, for cross-day duplicate detection. */
export async function loadSeenHashes() {
  const map = new Map();
  const rows = await readResults();
  for (const r of rows) {
    for (const k of Object.keys(r.files || {})) {
      const h = r.files[k]?.hash;
      if (h && !map.has(h)) map.set(h, r.id);
    }
  }
  return map;
}

/** Append processed result rows (new ids only). */
export async function appendResults(results) {
  if (!results.length) return { added: 0 };
  await ensureHeader();
  const sheets = await sheetsClient();
  const tab = await tabName(sheets);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET(),
    range: `${tab}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: results.map(resultToRow) },
  });
  return { added: results.length };
}

/** Save a reviewer verdict onto an existing row (by id). */
export async function setVerdict(id, { verdict, comment }) {
  const sheets = await sheetsClient();
  const tab = await tabName(sheets);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET(), range: `${tab}` });
  const values = res.data.values || [];
  const headers = values[0] || COLUMNS;
  const idCol = headers.indexOf('id');
  const rowIdx = values.findIndex((r, i) => i > 0 && r[idCol] === id);
  if (rowIdx === -1) throw new Error(`Submission ${id} not found in store`);
  const vCol = headers.indexOf('reviewer_verdict');
  const at = new Date().toISOString();
  // reviewer_verdict, reviewer_comment, reviewer_at are contiguous (see COLUMNS).
  const a1col = (n) => String.fromCharCode(65 + n); // fine: columns < 26
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET(),
    range: `${tab}!${a1col(vCol)}${rowIdx + 1}:${a1col(vCol + 2)}${rowIdx + 1}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[verdict || '', comment || '', at]] },
  });
  return { id, verdict, at };
}
