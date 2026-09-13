# Phase 0 — Google Cloud setup (do this in your Google account)

Phase 0 is account setup only — no code. ~15 minutes. When done, bring back the
5 IDs in the table at the bottom and we wire up live mode.

> All work happens inside ONE Google Cloud project. Recommended: create a new
> project named `mdm-pilot` so all pilot cost sits in one place. Your existing
> AI Studio Gemini key (`AQ.` prefix) keeps working regardless.

## 1. Create the service account
1. https://console.cloud.google.com → project dropdown → **New Project** → name `mdm-pilot` → **Create**. Select it.
2. ☰ → **IAM & Admin** → **Service Accounts** → **+ CREATE SERVICE ACCOUNT**.
3. Name `mdm-backend` → **CREATE AND CONTINUE** → skip roles (**CONTINUE**) → skip users (**DONE**).
4. Copy its email: `mdm-backend@mdm-pilot.iam.gserviceaccount.com`.

## 2. Enable the APIs
☰ → **APIs & Services** → **Library** → enable **Google Sheets API** and **Google Drive API**.

## 3. Download the JSON key (treat like a password)
Service Accounts → click `mdm-backend@…` → **KEYS** → **ADD KEY** → **Create new key** → **JSON** → **CREATE**.
A `.json` downloads (only copy). Keep it out of the repo — put it in `keys/` or set
`GOOGLE_APPLICATION_CREDENTIALS` to its path. Never commit it (`.gitignore` blocks it).

## 4. Share the two Sheets + two Drive folders
For each of: baseline responses Sheet, daily responses Sheet, baseline "File responses"
Drive folder, daily "File responses" Drive folder →
**Share** → paste the service account email → role **Viewer** → untick "Notify people" → **Share**.

(Find the Drive folders by searching your Drive for **"File responses"**.)

## 5. Bring these back
| What | Where |
|---|---|
| Daily Sheet ID | `docs.google.com/spreadsheets/d/`**`ID`**`/edit` |
| Baseline Sheet ID | same, baseline sheet |
| Daily Drive folder ID | `drive.google.com/drive/folders/`**`ID`** |
| Baseline Drive folder ID | same, baseline folder |
| Service account email | `mdm-backend@mdm-pilot.iam.gserviceaccount.com` |

Also paste the **header row** of each Sheet's "Form Responses 1" tab so column mapping is exact.
