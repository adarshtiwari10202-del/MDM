// ============================================================
// Build the static GitHub Pages site.
//   • bakes the results store  -> dist/data/results.json
//   • bakes the school roster  -> dist/data/roster.json
//   • bakes recent media       -> dist/media/<fileId>.jpg  (images downscaled,
//                                 video → a poster frame), annotating each file
//                                 with localMedia / localPoster so the static
//                                 dashboard shows photos without any server.
//   • copies public/index.html -> dist/index.html  (+ .nojekyll)
//
// No Gemini, no flag recompute — pure packaging of what the pipeline stored.
//   MEDIA_DAYS (default 3)  how many recent reporting days to bake media for
//   MEDIA_MAX  (default 500) hard cap on media files fetched
// Needs: GOOGLE_SERVICE_ACCOUNT_JSON, RESULTS_SHEET_ID, DAILY_SHEET_ID.
// ============================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readResults } from '../backend/store.js';
import { readRoster } from '../backend/roster.js';
import { fetchDriveFile } from '../backend/sheets.js';

const OUT = 'dist';
const ITEMS = ['cooking', 'cooked_meal', 'serving_video', 'plate'];
const MEDIA_DAYS = Number(process.env.MEDIA_DAYS || 3);
const MEDIA_MAX = Number(process.env.MEDIA_MAX || 500);

function ffmpegPoster(buf) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), `pv-${Math.random().toString(36).slice(2)}.mp4`);
    const out = tmp.replace('.mp4', '.jpg');
    fs.writeFileSync(tmp, buf);
    const ff = spawn('ffmpeg', ['-i', tmp, '-frames:v', '1', '-vf', 'scale=-2:480', '-q:v', '4', out, '-y'], { stdio: 'ignore' });
    ff.on('error', reject);
    ff.on('close', (code) => {
      try {
        if (code === 0 && fs.existsSync(out)) { const b = fs.readFileSync(out); cleanup(tmp, out); resolve(b); }
        else { cleanup(tmp, out); reject(new Error('ffmpeg failed')); }
      } catch (e) { reject(e); }
    });
  });
}
function cleanup(...files) { for (const f of files) try { fs.rmSync(f, { force: true }); } catch {} }

async function downscale(buf) {
  try {
    const sharp = (await import('sharp')).default;
    return await sharp(buf).rotate().resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
  } catch {
    return buf; // sharp missing → ship original (larger, but works)
  }
}

async function main() {
  fs.mkdirSync(`${OUT}/data`, { recursive: true });
  fs.mkdirSync(`${OUT}/media`, { recursive: true });

  const [rows, roster] = await Promise.all([readResults().catch(() => []), readRoster().catch(() => [])]);
  console.log(`[pages] ${rows.length} rows, ${roster.length} roster schools`);

  // Which reporting days get media baked (the most recent MEDIA_DAYS).
  const days = [...new Set(rows.map((r) => r.date).filter(Boolean))].sort();
  const recent = new Set(days.slice(-MEDIA_DAYS));
  console.log(`[pages] baking media for ${recent.size} recent day(s): ${[...recent].join(', ')}`);

  // Newest rows first so the cap keeps the most relevant media.
  const ordered = [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  let baked = 0, failed = 0;
  for (const row of ordered) {
    if (!recent.has(row.date)) continue;
    for (const k of ITEMS) {
      const f = row.files?.[k];
      if (!f || f.missing || !f.fileId) continue;
      if (baked >= MEDIA_MAX) continue;
      const name = `${f.fileId}.jpg`;
      const dest = `${OUT}/media/${name}`;
      try {
        if (fs.existsSync(dest)) { // already baked this fileId (dedupe)
          if (k === 'serving_video') f.localPoster = `media/${name}`; else f.localMedia = `media/${name}`;
          continue;
        }
        const buf = await fetchDriveFile(f.fileId);
        const out = k === 'serving_video' ? await ffmpegPoster(buf) : await downscale(buf);
        fs.writeFileSync(dest, out);
        if (k === 'serving_video') f.localPoster = `media/${name}`; else f.localMedia = `media/${name}`;
        baked++;
      } catch (e) {
        failed++; // leave the file without local media; client falls back gracefully
      }
    }
  }
  console.log(`[pages] media baked: ${baked}, failed: ${failed}`);

  fs.writeFileSync(`${OUT}/data/results.json`, JSON.stringify({ mode: 'static', generatedAt: new Date().toISOString(), count: rows.length, rows }));
  fs.writeFileSync(`${OUT}/data/roster.json`, JSON.stringify({ count: roster.length, schools: roster }));
  fs.copyFileSync('public/index.html', `${OUT}/index.html`);
  fs.writeFileSync(`${OUT}/.nojekyll`, '');
  console.log('[pages] wrote dist/ (index.html, data/, media/)');
}

main().catch((e) => { console.error('[pages] FAILED:', e); process.exit(1); });
