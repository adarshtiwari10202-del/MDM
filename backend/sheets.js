// ============================================================
// Live Google access (Phase 1) — service-account → Sheets + Drive.
// Runs on Vercel / locally. Requires:
//   • googleapis   (npm i googleapis)
//   • GOOGLE_SERVICE_ACCOUNT_JSON  (or GOOGLE_APPLICATION_CREDENTIALS path)
// Read-only scopes only — the backend never edits the response sheets.
// ============================================================
import fs from 'node:fs';
import { config } from './config.js';
import { resolveColumns, parseDailyRow } from './parse.js';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
];

let _clients = null;

async function getClients() {
  if (_clients) return _clients;
  const { google } = await import('googleapis');
  let credentials;
  if (config.google.serviceAccountJson) {
    credentials = JSON.parse(config.google.serviceAccountJson);
  } else if (config.google.credentialsPath && fs.existsSync(config.google.credentialsPath)) {
    credentials = JSON.parse(fs.readFileSync(config.google.credentialsPath, 'utf8'));
  } else {
    throw new Error('No service-account credentials. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.');
  }
  const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
  const authClient = await auth.getClient();
  _clients = {
    sheets: google.sheets({ version: 'v4', auth: authClient }),
    drive: google.drive({ version: 'v3', auth: authClient }),
  };
  return _clients;
}

/** Read a sheet tab as { headers:[], rows:[{header:value}] }. */
export async function readSheet(spreadsheetId, tab) {
  const { sheets } = await getClients();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}`,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const values = res.data.values || [];
  if (!values.length) return { headers: [], rows: [] };
  const headers = values[0];
  const rows = values.slice(1).map((r, i) => {
    const obj = { __rowIndex: i + 2 }; // 1-based incl. header row
    headers.forEach((h, c) => { obj[h] = r[c] ?? ''; });
    return obj;
  });
  return { headers, rows };
}

/** Build udise -> baseline info from the baseline sheet. */
export async function loadBaselineLookup() {
  const { headers, rows } = await readSheet(config.ids.baselineSheet, config.ids.baselineTab);
  const cols = resolveColumns(headers, {
    udise: ['udise'], school: ['school name'], cooks: ['number of cooks'],
    incharge: ['1st mdm', 'in-charge name'], mobile: ['mobile'],
  });
  const lookup = {};
  for (const row of rows) {
    const udise = String(cols.udise ? row[cols.udise] : '').trim();
    if (!udise) continue;
    lookup[udise] = {
      udise,
      name: cols.school ? row[cols.school] : '',
      cooks: cols.cooks ? Number(row[cols.cooks]) || null : null,
      inchargeName: cols.incharge ? row[cols.incharge] : '',
      // location not captured by the baseline form (see Gap 2) → null
      location: null,
    };
  }
  return lookup;
}

/**
 * Read daily submissions as normalized objects (no AI yet).
 * @param {object} [opts] { sinceRowIndex } skip rows already processed.
 */
export async function readDailySubmissions(opts = {}) {
  const [{ headers, rows }, schoolLookup] = await Promise.all([
    readSheet(config.ids.dailySheet, config.ids.dailyTab),
    loadBaselineLookup().catch(() => ({})),
  ]);
  const cols = resolveColumns(headers);
  const since = opts.sinceRowIndex || 0;
  return rows
    .filter((r) => (r.__rowIndex || 0) > since)
    .map((r) => parseDailyRow(r, cols, { rowIndex: r.__rowIndex, schoolLookup }));
}

/** Download a Drive file as a Buffer (for the AI module). */
export async function fetchDriveFile(fileId) {
  const { drive } = await getClients();
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data);
}

/** Download a Drive file with its content-type (for the media proxy). */
export async function fetchDriveMedia(fileId) {
  const { drive } = await getClients();
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  const mimeType = res.headers?.['content-type'] || 'application/octet-stream';
  return { buffer: Buffer.from(res.data), mimeType };
}
