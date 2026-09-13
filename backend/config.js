// ============================================================
// Config loader — zero-dependency .env reader + typed getters.
// Reads process.env first (Vercel), falls back to a local .env file.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv() {
  const p = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq === -1) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadDotEnv();

export const config = {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  },
  google: {
    serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
  },
  ids: {
    dailySheet: process.env.DAILY_SHEET_ID || '',
    baselineSheet: process.env.BASELINE_SHEET_ID || '',
    dailyFolder: process.env.DAILY_DRIVE_FOLDER_ID || '',
    baselineFolder: process.env.BASELINE_DRIVE_FOLDER_ID || '',
    resultsSheet: process.env.RESULTS_SHEET_ID || '',
    dailyTab: process.env.DAILY_SHEET_TAB || 'Form Responses 1',
    baselineTab: process.env.BASELINE_SHEET_TAB || 'Form Responses 1',
    resultsTab: process.env.RESULTS_SHEET_TAB || 'Results',
  },
  dataMode: process.env.DATA_MODE || 'sample', // 'sample' | 'live'
};

export function requireGeminiKey() {
  if (!config.gemini.apiKey) {
    throw new Error('GEMINI_API_KEY is not set. Add it to .env (see .env.example).');
  }
}
