// Dump the header row of the daily form sheet so we can see exactly what
// column holds the schools' comment and under what label.
import { readSheet } from '../backend/sheets.js';
import fs from 'node:fs';
import path from 'node:path';

const SHEET_ID = process.env.DAILY_SHEET_ID;
const TAB = process.env.DAILY_SHEET_TAB || 'Form Responses 1';

async function main() {
  const { headers, rows } = await readSheet(SHEET_ID, TAB);
  console.log('TOTAL columns:', headers.length);
  headers.forEach((h, i) => console.log(`  [${String.fromCharCode(65+i)}] (${i})  ${JSON.stringify(h)}`));
  // Sample value from the first non-empty row for the suspected comment column (index 8 = col I).
  const first = rows.find((r) => Object.values(r).some((v) => v));
  if (first) {
    const idxH = headers[8];
    console.log('\nSample row — column I (header:', JSON.stringify(idxH), ')');
    console.log('  value:', JSON.stringify(first[idxH]));
  }
  const dir = path.join(process.cwd(), 'reports');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sheet_headers.json'), JSON.stringify({ headers, sample: first || null }, null, 2));
}
main().catch((e) => { console.error('FAILED', e); process.exit(1); });
