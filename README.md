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
| 2 | AI analysis (image/video → JSON) | ✅ built (run with your Gemini key) |
| 3 | Flag rules + results store | ✅ engine built & tested; store needs Phase 0 |
| 4 | Reviewer dashboard | ✅ built (preview on sample data) |
| 5 | Vercel Cron automation + daily digest | ⬜ |
| 6 | Baseline context, dup hashing, peer compare | ◐ dup/geo logic in engine |

Everything runs today against `backend/sampleData/` with `DATA_MODE=sample`. When
Phase 0 is done, set `DATA_MODE=live` and fill the IDs in `.env` — the flag engine
and dashboard are unchanged; only the data source swaps.

### Open gaps found while mapping the live forms
- **No "today's menu" source.** Neither form captures the prescribed menu, so
  `menu_missing` cannot fire until the block weekly menu is filled in
  `backend/menu.js` (`WEEKLY_MENU`). This is the flagship AI check — needs the
  Khairabad Mon–Sat rotation.
- **No geo-location captured.** Forms strip photo GPS and there is no location
  question, so `geo_mismatch` is inert for now (deferred; add a location question
  later if wanted).
- **No per-file upload times.** Forms give one row timestamp only, so the
  staged-burst check has nothing to compare within a submission (meal-window
  check still works off the row timestamp).

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
