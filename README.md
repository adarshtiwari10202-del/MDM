# MDM Monitoring Pipeline — Khairabad Pilot

AI-assisted monitoring for the Mid-Day Meal programme in Khairabad block, Sitapur
(CSF / DPMU, Nipun Bharat). Schools self-report each day's meal via photos + a short
video; the system screens every submission automatically (rule checks + Gemini),
a human reviewer judges what the machine cannot, and only the reviewer's verdict
goes on record.

**Design principles (locked):** monitor the meal not the teacher (no faces); AI
observes, humans judge; video is downscaled to 360p/~1fps before the API; store the
extracted JSON, never re-analyse images; duplicate detection is hash-based.

## Repo layout
```
backend/
  config.js            env loader (.env / process.env)
  prompt.js            Gemini prompt (strict JSON, observe-only)
  ai.js                Phase 2 — analyzeImage / analyzeVideo (+ 360p 1fps downscale)
  flagRules.js         Phase 3 — flag engine (pure logic, source-agnostic)
  sampleData/          fixtures used until Phase 0 grants live Google access
  tests/               flagRules.test.js (auto), ai.manual.js (needs key)
frontend/
  index.html           Phase 4 — reviewer dashboard (NIPUN design system)
docs/
  PHASE0-SETUP.md      Google Cloud service-account setup walkthrough
```

## Build status
| Phase | What | Status |
|---|---|---|
| 0 | GCP service account + share Sheets/Drive | ✅ done (project mdm-pilot-508522) |
| 1 | Read daily Sheet + fetch Drive files | ✅ parser tested on real row; live layer built (needs key at deploy) |
| 2 | AI analysis (image/video → JSON, +GPS/time stamp read) | ✅ built |
| 3 | Flag rules + pipeline (process one/all) | ✅ built & tested; write-back store pending |
| 4 | Reviewer dashboard (+ /api/results) | ✅ built; deploys to Vercel |
| 5 | Vercel Cron automation + daily digest | ⬜ next |
| 6 | Baseline context, dup hashing, peer compare | ◐ dup-hash + geo in pipeline |

Everything runs today against `backend/sampleData/` with `DATA_MODE=sample`. When
Phase 0 is done, set `DATA_MODE=live` and fill the IDs in `.env` — the flag engine
and dashboard are unchanged; only the data source swaps.

### Notes on the live forms
- **Menu:** filled from the official PM POSHAN weekly rotation in
  `backend/menu.js` (`WEEKLY_MENU`). Supports Friday's tehri/khichdi alternative
  and dish categories (a banana satisfies "fruit").
- **Geo + time come from the photo stamp.** Submissions are GPS-Map-Camera
  stamped, so the AI reads `gps_lat/gps_lng` and `stamp_datetime` off each image;
  the pipeline merges those into the flag inputs. This powers the meal-window,
  staged-burst, and geo-consistency checks. Absolute geo-match to the school
  needs a school→lat/lng registry (`school.location`); until populated, the
  co-location check (`geo_inconsistent`) still runs on the four stamped photos.

## Run
```bash
npm test                         # flag engine tests (zero deps)
cp .env.example .env             # then set GEMINI_API_KEY
node backend/tests/ai.manual.js path/to/meal.jpg rice,dal,sabzi   # live AI test
open frontend/index.html         # dashboard preview (sample data)
```

## Config
Copy `.env.example` → `.env`. Secrets never go in code; `.env` and the service-account
JSON are gitignored. On Vercel these become environment variables.
