// ============================================================
// AI module (Phase 2) — Gemini image/video screening.
//
// Design guarantees enforced here:
//  • Video is ALWAYS downscaled to 360p and sampled at ~1 fps
//    BEFORE any bytes reach the API. This is the biggest cost lever.
//  • Images are downscaled to 1280px max before sending.
//  • The model only reports what is visible (see prompts.v2.js); it never
//    decides acceptable/not-acceptable.
//
// Requirements to run LIVE:
//  • GEMINI_API_KEY in .env
//  • ffmpeg on PATH (for video). Images work without ffmpeg.
//  • Optional: `sharp` for image downscaling (npm i sharp). If absent,
//    images are sent at original size (still works, costs a little more).
// ============================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config, requireGeminiKey } from './config.js';
import { buildPrompt, buildVideoPrompt } from './prompts.v2.js';
import { getSchema } from './schemas.v2.js';

const GEMINI_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// ---- low-level Gemini call ----
async function geminiGenerate(parts, { model = config.gemini.model, responseSchema } = {}) {
  requireGeminiKey();
  const body = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      ...(responseSchema ? { responseSchema } : {}),
    },
  };
  const res = await fetch(`${GEMINI_URL(model)}?key=${config.gemini.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${t.slice(0, 500)}`);
  }
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  return text;
}

// Tolerant JSON parse (strips ```json fences if the model adds them).
export function parseModelJson(text) {
  let s = String(text || '').trim();
  if (s.startsWith('```')) s = s.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

function mimeFromPath(p) {
  const ext = path.extname(p).toLowerCase();
  return { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[ext] || 'image/jpeg';
}

// ---- image downscale (optional sharp) ----
async function downscaleImage(buffer, mime, maxDim = 1280) {
  try {
    const sharp = (await import('sharp')).default;
    const out = await sharp(buffer).rotate().resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    return { buffer: out, mime: 'image/jpeg' };
  } catch {
    return { buffer, mime }; // sharp not installed → send original
  }
}

function inlinePart(buffer, mime) {
  return { inline_data: { mime_type: mime, data: buffer.toString('base64') } };
}

// ---- public: analyze one image for a given stage ----
// stage: 'cooking' | 'cooked_food' | 'plate'  (images);  menuItems: string[]
export async function analyzeImage(pathOrBuffer, { stage, menuItems = [] } = {}) {
  let buffer, mime;
  if (Buffer.isBuffer(pathOrBuffer)) { buffer = pathOrBuffer; mime = 'image/jpeg'; }
  else { buffer = fs.readFileSync(pathOrBuffer); mime = mimeFromPath(pathOrBuffer); }
  const ds = await downscaleImage(buffer, mime);
  const text = await geminiGenerate([
    { text: buildPrompt(stage, { menuItems }) },
    inlinePart(ds.buffer, ds.mime),
  ], { responseSchema: getSchema(stage) });
  return parseModelJson(text);
}

// ---- video: downscale to 360p @ 1fps, extract frames via ffmpeg ----
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => (err += d));
    ff.on('error', (e) => reject(new Error(`ffmpeg not available: ${e.message}`)));
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-400)}`))));
  });
}

/** Extract JPEG frames: 360p tall, ~1 fps, capped at maxFrames. Returns file paths. */
export async function extractVideoFrames(videoPath, { fps = 1, height = 360, maxFrames = 12 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-frames-'));
  const pattern = path.join(dir, 'f_%03d.jpg');
  // scale=-2:360 keeps aspect ratio, forces 360p height (the cost lever).
  await runFfmpeg(['-i', videoPath, '-vf', `fps=${fps},scale=-2:${height}`, '-q:v', '4', pattern, '-y']);
  const frames = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort().map((f) => path.join(dir, f));
  return { dir, frames: frames.slice(0, maxFrames) };
}

// ---- public: analyze a serving video (stage 'serving') ----
export async function analyzeVideo(videoPath, { menuItems = [] } = {}) {
  const { dir, frames } = await extractVideoFrames(videoPath);
  try {
    const parts = [{ text: buildVideoPrompt({ menuItems, frameCount: frames.length }) }];
    for (const f of frames) parts.push(inlinePart(fs.readFileSync(f), 'image/jpeg'));
    const text = await geminiGenerate(parts, { responseSchema: getSchema('serving') });
    return parseModelJson(text);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true }); // clean up frames
  }
}
