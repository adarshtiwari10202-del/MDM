// ============================================================
// PEER ANALYSIS (test lane, Phase 1) — isolated side-track.
//
// For a given reporting date, re-reads the cooked-meal photo of every daily-form
// submission and asks Gemini for a focused closed-vocabulary ATTRIBUTE VECTOR
// for dal and sabzi (nothing else — no dish identification, no hygiene, no
// flagging). Writes to reports/peer_analysis_<date>.json. Idempotent: rows
// already in the output file are reused on re-run.
//
// This script does NOT touch the Results sheet, the flag engine, the dashboard
// results store, or anything the live dashboard reads. It only writes a new
// JSON file into reports/.
//
// Env:
//   DATE         target reporting date (YYYY-MM-DD; default 2026-10-08)
//   CONCURRENCY  parallel submissions (default 4)
// Needs: DATA_MODE=live, GEMINI_API_KEY, GOOGLE_SERVICE_ACCOUNT_JSON,
//        DAILY_SHEET_ID. ffmpeg not needed (image-only).
// ============================================================
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, requireGeminiKey } from '../backend/config.js';
import { getDailySubmissions } from '../backend/source.js';
import { fetchDriveFile } from '../backend/sheets.js';

const DATE = process.env.DATE || '2026-10-08';
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 4));
const OUT_PATH = path.join('reports', `peer_analysis_${DATE}.json`);

const GEMINI_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// Closed-vocab attribute schema — tight enums so results aggregate cleanly.
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    dal_visible: { type: 'STRING', enum: ['yes', 'no', 'unclear'] },
    dal_color: { type: 'STRING', enum: ['yellow', 'dark_yellow', 'brown', 'off', 'unclear'] },
    dal_consistency: { type: 'STRING', enum: ['watery', 'medium', 'thick', 'unclear'] },
    dal_oil_film: { type: 'STRING', enum: ['yes', 'no', 'unclear'] },
    dal_vegetables_visible: { type: 'STRING', enum: ['yes', 'no', 'unclear'] },
    dal_fill_level: { type: 'STRING', enum: ['sparse', 'adequate', 'generous', 'unclear'] },

    sabzi_visible: { type: 'STRING', enum: ['yes', 'no', 'unclear'] },
    sabzi_base: { type: 'STRING', enum: ['potato', 'mixed', 'soya_badi', 'leafy', 'other', 'unclear'] },
    sabzi_color: { type: 'STRING', enum: ['rich', 'pale', 'dark', 'unclear'] },
    sabzi_oil_film: { type: 'STRING', enum: ['yes', 'no', 'unclear'] },
    sabzi_type: { type: 'STRING', enum: ['dry', 'gravy', 'unclear'] },
    sabzi_fill_level: { type: 'STRING', enum: ['sparse', 'adequate', 'generous', 'unclear'] },

    notes: { type: 'STRING' },
  },
  required: [
    'dal_visible','dal_color','dal_consistency','dal_oil_film','dal_vegetables_visible','dal_fill_level',
    'sabzi_visible','sabzi_base','sabzi_color','sabzi_oil_film','sabzi_type','sabzi_fill_level','notes',
  ],
  propertyOrdering: [
    'dal_visible','dal_color','dal_consistency','dal_oil_film','dal_vegetables_visible','dal_fill_level',
    'sabzi_visible','sabzi_base','sabzi_color','sabzi_oil_film','sabzi_type','sabzi_fill_level','notes',
  ],
};

const PROMPT = `You are describing one Mid-Day Meal cooked-food photo from a rural school in Uttar Pradesh.
Report ONLY what is visibly present. If the dish is not visible or you are unsure, answer "unclear" (or "no" for visibility).
Do NOT judge quality or acceptability. Do NOT identify people.

For DAL (lentil preparation):
- dal_visible: yes if dal is clearly present in the cookware; no if clearly absent; unclear otherwise.
- dal_color: yellow (bright standard dal yellow) / dark_yellow (deep golden) / brown (dark lentils or heavily spiced) / off (greyish or very pale) / unclear.
- dal_consistency: watery (very thin, soupy, lentils barely visible) / medium (typical dal, lentils visible with liquid) / thick (dense, little liquid, almost paste) / unclear.
- dal_oil_film: yes if a visible oil/ghee film or shiny top layer; no if clearly no oil; unclear.
- dal_vegetables_visible: yes if vegetables are clearly mixed into the dal; no if clearly plain lentils only; unclear.
- dal_fill_level: sparse (vessel one-quarter or less) / adequate (around half) / generous (three-quarters or more) / unclear.

For SABZI (vegetable preparation):
- sabzi_visible: yes if sabzi is clearly present; no if clearly absent; unclear.
- sabzi_base: potato (predominantly aloo) / mixed (multiple vegetables) / soya_badi (soya chunks dominant) / leafy (green leaves dominant) / other / unclear.
- sabzi_color: rich (deep orange/red/green, well-cooked look) / pale (washed-out, light colour) / dark (very dark gravy, strongly spiced) / unclear.
- sabzi_oil_film: yes / no / unclear.
- sabzi_type: dry (little or no gravy) / gravy (clearly saucy) / unclear.
- sabzi_fill_level: sparse / adequate / generous / unclear.

notes: one short factual sentence on anything else notable about the dal or sabzi, or empty string.
Return ONLY the JSON object matching the schema.`;

async function downscaleImage(buffer, mime) {
  try {
    const sharp = (await import('sharp')).default;
    const out = await sharp(buffer).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    return { buffer: out, mime: 'image/jpeg' };
  } catch { return { buffer, mime }; }
}

async function geminiCall(parts, { model = config.gemini.model } = {}) {
  requireGeminiKey();
  const body = {
    contents: [{ parts }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA },
  };
  const delays = [3000, 6000, 12000, 20000, 30000];
  let lastErr = '';
  for (let i = 0; i <= delays.length; i++) {
    const res = await fetch(`${GEMINI_URL(model)}?key=${config.gemini.apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) {
      const j = await res.json();
      const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
      let s = text.trim(); if (s.startsWith('```')) s = s.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
      const a = s.indexOf('{'), b = s.lastIndexOf('}'); if (a !== -1 && b !== -1) s = s.slice(a, b + 1);
      return JSON.parse(s);
    }
    lastErr = `Gemini ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`;
    if (![429, 500, 503].includes(res.status) || i === delays.length) break;
    await new Promise((r) => setTimeout(r, delays[i]));
  }
  throw new Error(lastErr);
}

async function pool(items, n, worker) {
  const out = new Array(items.length);
  let i = 0, done = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await worker(items[idx], idx); }
      catch (e) { out[idx] = { __error: e.message }; }
      done++;
      if (done % 10 === 0 || done === items.length) console.log(`[peer] ${done}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
  return out;
}

function readExisting() {
  try { return JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')); }
  catch { return null; }
}

async function main() {
  if (config.dataMode !== 'live') { console.log('[peer] DATA_MODE must be live'); process.exit(1); }
  console.log(`[peer] date=${DATE}  out=${OUT_PATH}  concurrency=${CONCURRENCY}`);

  const existing = readExisting();
  const prior = new Map((existing?.rows || []).map((r) => [r.id, r]));

  const subs = (await getDailySubmissions()).filter((s) => s.date === DATE);
  const needed = subs.filter((s) => s.files?.cooked_meal && !s.files.cooked_meal.missing && s.files.cooked_meal.fileId);
  console.log(`[peer] ${subs.length} submissions on ${DATE} · ${needed.length} with a cooked-meal photo · ${prior.size} already analysed`);

  const toProcess = needed.filter((s) => !prior.has(s.id));
  console.log(`[peer] re-using ${needed.length - toProcess.length} from previous run · analysing ${toProcess.length} fresh`);

  const fresh = await pool(toProcess, CONCURRENCY, async (s) => {
    const f = s.files.cooked_meal;
    try {
      const buf = await fetchDriveFile(f.fileId);
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      const ds = await downscaleImage(buf, 'image/jpeg');
      const ai = await geminiCall([
        { text: PROMPT },
        { inline_data: { mime_type: ds.mime, data: ds.buffer.toString('base64') } },
      ]);
      return {
        id: s.id,
        udise: s.school?.udise || '',
        name: s.school?.name || '',
        date: s.date,
        fileId: f.fileId,
        hash,
        ai,
        processedAt: new Date().toISOString(),
      };
    } catch (e) {
      return { id: s.id, udise: s.school?.udise || '', name: s.school?.name || '', date: s.date, fileId: f.fileId, error: e.message };
    }
  });

  const rowsOut = [...prior.values(), ...fresh];
  const okCount = rowsOut.filter((r) => r.ai && !r.error).length;
  const errCount = rowsOut.length - okCount;

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    date: DATE,
    schemaVersion: 'peer-v1',
    note: 'Isolated test lane. Not consumed by the live dashboard flag engine.',
    rows: rowsOut,
    stats: { total: rowsOut.length, ok: okCount, error: errCount },
  }, null, 2));
  console.log(`[peer] wrote ${rowsOut.length} rows (${okCount} ok, ${errCount} errors) → ${OUT_PATH}`);
}

main().catch((e) => { console.error('[peer] FAILED:', e); process.exit(1); });
