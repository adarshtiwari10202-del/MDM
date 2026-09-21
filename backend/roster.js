// ============================================================
// School roster (baseline) — the list of schools expected to submit a daily
// MDM report. Source of truth is the "Sheet1" tab of the daily spreadsheet
// (columns: District | Block_Name | AreaType | UdiseCode | School_Name).
// Read live so it always reflects the sheet; falls back to a bundled snapshot
// (backend/roster.json) if the live read fails or returns nothing.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { resolveColumns } from './parse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROSTER_SPEC = {
  udise: ['udise'],                       // "UdiseCode"
  name: ['school_name', 'school name', 'school'],
  block: ['block'],                       // "Block_Name"
  district: ['district'],
};

function snapshot() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'roster.json'), 'utf8'));
  } catch {
    return [];
  }
}

/** @returns {Promise<Array<{udise,name,block,district}>>} */
export async function readRoster() {
  const sheetId = process.env.ROSTER_SHEET_ID || config.ids.dailySheet;
  const tab = process.env.ROSTER_SHEET_TAB || 'Sheet1';
  if (!sheetId) return snapshot();
  try {
    const { readSheet } = await import('./sheets.js');
    const { headers, rows } = await readSheet(sheetId, tab);
    const cols = resolveColumns(headers, ROSTER_SPEC);
    const out = [];
    const seen = new Set();
    for (const r of rows) {
      const udise = String(cols.udise ? r[cols.udise] : '').trim();
      if (!/^\d{6,}$/.test(udise) || seen.has(udise)) continue;
      seen.add(udise);
      out.push({
        udise,
        name: String(cols.name ? r[cols.name] : '').trim(),
        block: String(cols.block ? r[cols.block] : '').trim(),
        district: String(cols.district ? r[cols.district] : '').trim(),
      });
    }
    return out.length ? out : snapshot();
  } catch {
    return snapshot();
  }
}

export { snapshot as rosterSnapshot };
