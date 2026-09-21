// ============================================================
// Open-ended AI probe — NO schema, NO checklist prompt.
// Fetches the four media files for one school+date from the results store
// and asks Gemini to describe, freely, everything it can observe and every
// attribute it thinks it could reliably extract. Purpose: calibrate what the
// model can do on its own, to inform which specific prompts/flags are worth
// writing. Output is free-form prose printed to the log.
//
//   PROBE_UDISE=9240501403 PROBE_DATE=2026-09-19 node scripts/probe.js
// Needs: GEMINI_API_KEY, GOOGLE_SERVICE_ACCOUNT_JSON, RESULTS_SHEET_ID.
// ============================================================
import fs from 'node:fs';
import { readResults } from '../backend/store.js';
import { fetchDriveFile } from '../backend/sheets.js';
import { extractVideoFrames } from '../backend/ai.js';
import { config, requireGeminiKey } from '../backend/config.js';

const ITEMS = ['cooking', 'cooked_meal', 'serving_video', 'plate'];
const LABEL = { cooking: 'Cooking', cooked_meal: 'Cooked meal', serving_video: 'Serving (video)', plate: 'Plate' };

const UDISE = process.env.PROBE_UDISE || '';
const DATE = process.env.PROBE_DATE || '';

// Free-form prompt — deliberately gives NO fields to fill and NO judgement to make.
const OPEN_PROMPT = (label, isVideo, frameCount) => `
You are shown ${isVideo ? `${frameCount} still frames sampled from a short video` : 'a single photo'} submitted to a school Mid-Day Meal (MDM) monitoring programme in rural Uttar Pradesh, India. The submitter labelled this as the "${label}" stage of the day's meal.

There is NO checklist. Do not judge whether anything is acceptable or compliant. Simply OBSERVE and REPORT, as thoroughly and concretely as you can:

1. A detailed description of everything visible in the scene.
2. Food: every dish/ingredient you can identify, its apparent state (raw / cooking / cooked / served), rough quantity or portion size, colour and texture cues.
3. Vessels, utensils, cooking equipment, fuel/heat source.
4. Setting: kitchen / floor / outdoors, surfaces, cleanliness and hygiene cues, water, storage.
5. People: only a COUNT and their role if obvious (cook, server, child) — never identity or description of individuals.
6. Any on-image overlays: GPS coordinates, date/time stamps, app watermarks, and whether they are legible or say "Loading".
7. Image quality: blur, lighting, framing, whether the stage label seems to match what is shown.
8. Anything unusual, ambiguous, or that a human monitor would want to look at.

Then, in a final section titled "EXTRACTABLE ATTRIBUTES", list the specific, structured data points you believe you could extract RELIABLY from images like this one for automated monitoring — as concrete field names with the kind of value each would hold. Be honest about what is reliable versus what is guesswork.

Write plain prose and lists. No JSON.`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geminiFreeform(parts) {
  requireGeminiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent?key=${config.gemini.apiKey}`;
  const body = { contents: [{ parts }], generationConfig: { temperature: 0.2 } };
  // Retry transient overloads (503/429/500) with exponential backoff.
  const delays = [3000, 6000, 12000, 20000, 30000];
  let lastErr = '';
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) {
      const json = await res.json();
      return json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '(empty response)';
    }
    lastErr = `Gemini ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`;
    if (![429, 500, 503].includes(res.status) || attempt === delays.length) break;
    await sleep(delays[attempt]);
  }
  throw new Error(lastErr);
}

const inlinePart = (buf, mime) => ({ inline_data: { mime_type: mime, data: buf.toString('base64') } });

async function main() {
  if (!UDISE || !DATE) throw new Error('Set PROBE_UDISE and PROBE_DATE');
  const rows = await readResults();
  const matches = rows.filter((r) => String(r.school?.udise) === String(UDISE) && r.date === DATE);
  if (!matches.length) { console.log(`[probe] no stored row for UDISE ${UDISE} on ${DATE}`); return; }

  const row = matches.find((r) => ITEMS.some((k) => r.files?.[k]?.fileId)) || matches[0];
  console.log(`\n[probe] ${row.school?.name || ''} — UDISE ${UDISE} — ${DATE}`);
  console.log(`[probe] model: ${config.gemini.model} · open-ended (no schema, no checklist)`);
  console.log(`[probe] ${matches.length} stored row(s) for this school+date; probing one.\n`);

  for (const k of ITEMS) {
    const f = row.files?.[k];
    console.log('\n' + '='.repeat(70));
    console.log(`STAGE: ${LABEL[k]}`);
    console.log('='.repeat(70));
    if (!f || f.missing || !f.fileId) { console.log('(not submitted / no fileId stored)'); continue; }
    try {
      const buf = await fetchDriveFile(f.fileId);
      let out;
      if (k === 'serving_video') {
        const tmp = `/tmp/probe-${k}.mp4`;
        fs.writeFileSync(tmp, buf);
        const { dir, frames } = await extractVideoFrames(tmp);
        try {
          const parts = [{ text: OPEN_PROMPT(LABEL[k], true, frames.length) }];
          for (const fr of frames) parts.push(inlinePart(fs.readFileSync(fr), 'image/jpeg'));
          out = await geminiFreeform(parts);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(tmp, { force: true }); }
      } else {
        out = await geminiFreeform([{ text: OPEN_PROMPT(LABEL[k], false) }, inlinePart(buf, 'image/jpeg')]);
      }
      console.log(out.trim());
    } catch (e) {
      console.log(`(error: ${e.message})`);
    }
  }
  console.log('\n[probe] done.');
}

main().catch((e) => { console.error('[probe] FAILED:', e); process.exit(1); });
