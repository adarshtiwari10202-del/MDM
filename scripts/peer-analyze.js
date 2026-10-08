// ============================================================
// PEER ANALYSIS (test lane, V2 — image + video ensemble) — isolated side-track.
//
// For a given reporting date:
//   1. Analyses the COOKED-MEAL photo with a focused dal/sabzi attribute prompt.
//   2. Also samples the SERVING VIDEO (5 frames) and analyses it with the same
//      prompt (video reveals consistency, oil film and dry-vs-gravy better).
//   3. ENSEMBLES the two readings per attribute using a reliability table —
//      color/base/fill/vegetables prefer image (clean top-down); consistency/
//      oil_film/type prefer video (motion reveals). Writes both the raw image
//      and video readings, plus the merged "ai", to reports/peer_analysis_<date>.json.
// Idempotent: a row is reused only if it has BOTH ai_image and ai_video.
//
// This script does NOT touch the Results sheet, the flag engine, or anything
// the live dashboard flag tiles consume.
//
// Env:
//   DATE         target reporting date (YYYY-MM-DD; default 2026-10-08)
//   CONCURRENCY  parallel submissions (default 4)
// Needs: DATA_MODE=live, GEMINI_API_KEY, GOOGLE_SERVICE_ACCOUNT_JSON,
//        DAILY_SHEET_ID. ffmpeg required (video).
// ============================================================
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config, requireGeminiKey } from '../backend/config.js';
import { getDailySubmissions } from '../backend/source.js';
import { fetchDriveFile } from '../backend/sheets.js';

const DATE = process.env.DATE || '2026-10-08';
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 4));
const OUT_PATH = path.join('reports', `peer_analysis_${DATE}.json`);
const SCHEMA_VERSION = 'peer-v2';
const VIDEO_FRAMES = 5;
const VIDEO_FPS = 1;

const GEMINI_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

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

const PROMPT_HEAD = `You are describing one Mid-Day Meal cooked-food item from a rural school in Uttar Pradesh.
Report ONLY what is visibly present. If a dish is not visible or you are unsure, answer "unclear" (or "no" for visibility).
Do NOT judge quality or acceptability. Do NOT identify people.

For DAL (lentil preparation):
- dal_visible: yes if dal is clearly present; no if clearly absent; unclear otherwise.
- dal_color: yellow (bright standard dal yellow) / dark_yellow (deep golden) / brown (dark lentils or heavily spiced) / off (greyish or very pale) / unclear.
- dal_consistency: watery (very thin, soupy) / medium (typical dal, lentils visible with liquid) / thick (dense, little liquid) / unclear.
- dal_oil_film: yes if a visible oil/ghee film or shiny top layer; no if clearly no oil; unclear.
- dal_vegetables_visible: yes if vegetables are clearly mixed into the dal; no if clearly plain lentils only; unclear.
- dal_fill_level: sparse (vessel one-quarter or less) / adequate (around half) / generous (three-quarters or more) / unclear.

For SABZI (vegetable preparation):
- sabzi_visible: yes if sabzi is clearly present; no if clearly absent; unclear.
- sabzi_base: potato / mixed / soya_badi / leafy / other / unclear.
- sabzi_color: rich (deep orange/red/green) / pale (washed-out) / dark (very dark gravy) / unclear.
- sabzi_oil_film: yes / no / unclear.
- sabzi_type: dry (little or no gravy) / gravy (clearly saucy) / unclear.
- sabzi_fill_level: sparse / adequate / generous / unclear.

notes: one short factual sentence on anything else notable about the dal or sabzi, or empty string.
Return ONLY the JSON object matching the schema.`;

const PROMPT_IMAGE = PROMPT_HEAD + `\n\nSource: ONE still photo of the food in the cookware (top-down view).`;
const PROMPT_VIDEO = (n) => PROMPT_HEAD + `\n\nSource: ${n} frames sampled from a SHORT CLIP of the food being served from the cookware onto plates. Treat the frames as one clip; the clip is especially useful for judging consistency (watery vs thick) and whether an oil film is visible as the food moves.`;

async function downscaleImage(buffer) {
  try {
    const sharp = (await import('sharp')).default;
    const out = await sharp(buffer).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    return { buffer: out, mime: 'image/jpeg' };
  } catch { return { buffer, mime: 'image/jpeg' }; }
}

async function geminiCall(parts, { model = config.gemini.model } = {}) {
  requireGeminiKey();
  const body = { contents: [{ parts }], generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA } };
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

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => (err += d));
    ff.on('error', (e) => reject(new Error(`ffmpeg not available: ${e.message}`)));
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-400)}`))));
  });
}

async function extractFrames(videoBuf) {
  const stash = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-vid-'));
  const inPath = path.join(stash, 'in.mp4');
  fs.writeFileSync(inPath, videoBuf);
  await runFfmpeg(['-i', inPath, '-vf', `fps=${VIDEO_FPS},scale=-2:360`, '-q:v', '4', path.join(stash, 'f_%03d.jpg'), '-y']);
  const files = fs.readdirSync(stash).filter((f) => f.endsWith('.jpg')).sort().slice(0, VIDEO_FRAMES);
  const bufs = files.map((f) => fs.readFileSync(path.join(stash, f)));
  fs.rmSync(stash, { recursive: true, force: true });
  return bufs;
}

async function analyzeImage(buf) {
  const ds = await downscaleImage(buf);
  return geminiCall([
    { text: PROMPT_IMAGE },
    { inline_data: { mime_type: ds.mime, data: ds.buffer.toString('base64') } },
  ]);
}

async function analyzeVideo(buf) {
  const frames = await extractFrames(buf);
  if (!frames.length) throw new Error('no video frames extracted');
  const parts = [{ text: PROMPT_VIDEO(frames.length) }];
  for (const f of frames) parts.push({ inline_data: { mime_type: 'image/jpeg', data: f.toString('base64') } });
  return geminiCall(parts);
}

// Per-attribute source preference. true = prefer video, false = prefer image.
const PREFER_VIDEO = {
  dal_consistency: true, dal_oil_film: true,
  sabzi_type: true, sabzi_oil_film: true,
  dal_color: false, dal_vegetables_visible: false, dal_fill_level: false,
  sabzi_base: false, sabzi_color: false, sabzi_fill_level: false,
};
const ATTR_KEYS = Object.keys(PREFER_VIDEO);

function mergeReadings(img, vid) {
  const out = { notes: '' };
  // visibility: yes from either source wins
  const yesEither = (k) => (img?.[k] === 'yes' || vid?.[k] === 'yes') ? 'yes'
                        : (img?.[k] === 'no' && vid?.[k] === 'no') ? 'no'
                        : (img?.[k] || vid?.[k] || 'unclear');
  out.dal_visible = yesEither('dal_visible');
  out.sabzi_visible = yesEither('sabzi_visible');
  // other attributes: prefer the preferred source if clear, else use the other
  for (const k of ATTR_KEYS) {
    const preferred = PREFER_VIDEO[k] ? vid?.[k] : img?.[k];
    const other     = PREFER_VIDEO[k] ? img?.[k] : vid?.[k];
    if (preferred && preferred !== 'unclear') out[k] = preferred;
    else if (other && other !== 'unclear')    out[k] = other;
    else out[k] = 'unclear';
  }
  // notes: concatenate non-empty
  const n = [img?.notes, vid?.notes].filter(Boolean).join(' | ');
  out.notes = n.slice(0, 400);
  return out;
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
  console.log(`[peer] date=${DATE}  out=${OUT_PATH}  concurrency=${CONCURRENCY}  schema=${SCHEMA_VERSION}`);

  const existing = readExisting();
  // Only reuse rows that are from the SAME schema AND have both image + video readings.
  const reuseFromPrior = (existing?.schemaVersion === SCHEMA_VERSION) ? new Map((existing.rows || []).filter((r) => r.ai_image && r.ai_video).map((r) => [r.id, r])) : new Map();
  const subs = (await getDailySubmissions()).filter((s) => s.date === DATE);
  const needed = subs.filter((s) => s.files?.cooked_meal && !s.files.cooked_meal.missing && s.files.cooked_meal.fileId);
  console.log(`[peer] ${subs.length} submissions on ${DATE} · ${needed.length} with cooked-meal photo · ${reuseFromPrior.size} already fully analysed (image+video)`);

  const toProcess = needed.filter((s) => !reuseFromPrior.has(s.id));
  console.log(`[peer] re-using ${needed.length - toProcess.length} · analysing ${toProcess.length} fresh (image + video ensemble)`);

  const fresh = await pool(toProcess, CONCURRENCY, async (s) => {
    const fImg = s.files.cooked_meal;
    const fVid = s.files.serving_video;
    const row = { id: s.id, udise: s.school?.udise || '', name: s.school?.name || '', date: s.date,
                  fileId: fImg.fileId, videoFileId: fVid?.fileId || null, processedAt: new Date().toISOString() };
    try {
      const imgBuf = await fetchDriveFile(fImg.fileId);
      row.hash = crypto.createHash('sha256').update(imgBuf).digest('hex');
      row.ai_image = await analyzeImage(imgBuf);
    } catch (e) { row.image_error = e.message; }
    try {
      if (fVid && !fVid.missing && fVid.fileId) {
        const vBuf = await fetchDriveFile(fVid.fileId);
        row.ai_video = await analyzeVideo(vBuf);
      } else {
        row.video_error = 'no serving video attached';
      }
    } catch (e) { row.video_error = e.message; }
    // Merge whatever we got. If one source failed, mergeReadings falls back cleanly.
    row.ai = mergeReadings(row.ai_image, row.ai_video);
    row.sources = { image: !!row.ai_image, video: !!row.ai_video };
    if (!row.ai_image && !row.ai_video) row.error = (row.image_error || '') + ' | ' + (row.video_error || '');
    return row;
  });

  const rowsOut = [...reuseFromPrior.values(), ...fresh];
  const okCount = rowsOut.filter((r) => r.ai && !r.error).length;
  const bothCount = rowsOut.filter((r) => r.ai_image && r.ai_video).length;
  const imgOnly = rowsOut.filter((r) => r.ai_image && !r.ai_video).length;
  const vidOnly = rowsOut.filter((r) => !r.ai_image && r.ai_video).length;
  const errCount = rowsOut.length - okCount;

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    date: DATE,
    schemaVersion: SCHEMA_VERSION,
    note: 'Isolated test lane. Image + video ensemble. Not consumed by the live dashboard flag engine.',
    rows: rowsOut,
    stats: { total: rowsOut.length, ok: okCount, image_and_video: bothCount, image_only: imgOnly, video_only: vidOnly, error: errCount },
  }, null, 2));
  console.log(`[peer] wrote ${rowsOut.length} rows → ${OUT_PATH}`);
  console.log(`[peer] breakdown: both=${bothCount}  image_only=${imgOnly}  video_only=${vidOnly}  error=${errCount}`);
}

main().catch((e) => { console.error('[peer] FAILED:', e); process.exit(1); });
