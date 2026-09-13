# Go live — connect, add keys, process real data

Architecture: **Vercel** hosts the dashboard + read API. A **GitHub Action**
runs the nightly batch (no serverless timeout) and writes to the **results Sheet**.
The dashboard reads that Sheet. AI touches each photo exactly once.

```
Daily Form → Daily Sheet ─┐
                          ├─ GitHub Action (nightly) → Gemini + rules → Results Sheet
Baseline Sheet ───────────┘                                                 │
                                                     Vercel /api/results ◄───┘
                                                     Vercel dashboard ◄── reads
                                                     Vercel /api/verdict → writes verdict
```

## Step 1 — Connect Vercel to GitHub (dashboard hosting)
1. https://vercel.com/csf2/mdm-monitoring/settings/git
2. **Connect Git Repository** → authorize **adarshtiwari10202-del/MDM** → Save.
3. Vercel builds the default branch automatically (and on every push after).

## Step 2 — Vercel environment variables
Project → **Settings → Environment Variables** (apply to Production). The
service-account JSON goes here — never in chat or code.

| Name | Value |
|---|---|
| `DATA_MODE` | `live` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | *(paste the entire .json key on one line)* |
| `GEMINI_API_KEY` | your `AQ.` key |
| `GEMINI_MODEL` | `gemini-3.6-flash` |
| `DAILY_SHEET_ID` | `1oFGXJ5OxlGzjxm1eRsfDFGPVzQ_hf0oyKsI3bEOWsxI` |
| `BASELINE_SHEET_ID` | `1yh2VUK_CUvXbCcr4RlPd7oYaQpx1GVigmlyFl59sA5k` |
| `RESULTS_SHEET_ID` | `1OrcCX0KpKlVytBMND3kdSsSIK6_j393PQZD_13rWqsY` |
| `DAILY_SHEET_TAB` | `Form Responses 1` |
| `BASELINE_SHEET_TAB` | `Form Responses 1` |
| `RESULTS_SHEET_TAB` | `Results` |

Redeploy after adding them.

## Step 3 — GitHub secrets (for the nightly processor)
Repo → **Settings → Secrets and variables → Actions → New repository secret**:

- `GEMINI_API_KEY`
- `GOOGLE_SERVICE_ACCOUNT_JSON` (the whole .json)
- `DAILY_SHEET_ID` = `1oFGXJ5OxlGzjxm1eRsfDFGPVzQ_hf0oyKsI3bEOWsxI`
- `BASELINE_SHEET_ID` = `1yh2VUK_CUvXbCcr4RlPd7oYaQpx1GVigmlyFl59sA5k`
- `RESULTS_SHEET_ID` = `1OrcCX0KpKlVytBMND3kdSsSIK6_j393PQZD_13rWqsY`

## Step 4 — Populate the store now (don't wait for tonight)
Repo → **Actions → "Nightly MDM processing" → Run workflow**. It processes
every unprocessed submission and writes results to the Sheet. Re-runs are safe
(already-processed rows are skipped).

## Step 5 — See real data
Open the Vercel URL. The dashboard now shows your actual Hargaon submissions,
ranked worst-first, with the AI reading (dishes, GPS, timestamp) and flags.
Reviewer verdicts save back to the results Sheet.

### Notes
- Until the Action has run once, `/api/results` returns an empty store and the
  dashboard shows the sample fallback — run Step 4 to switch to real data.
- The nightly Action runs at 20:00 IST. It also runs on demand (Step 4).
- Cost lever intact: video is downscaled to 360p ~1fps before Gemini.
