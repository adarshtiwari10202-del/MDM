# AI Analysis & Flagging Framework (current build)

*The exact logic running in the pilot today, as of 14 Sep 2026.*
*This is the baseline we build the next iteration on.*

---

## 0. Pipeline overview

```
School fills Google Form
        ↓
Google saves → a row in the Daily Sheet (with Drive links) + files in Drive
        ↓
Nightly processor (GitHub Action, 20:00 IST; also on-demand):
   for each new submission:
     1. fetch the 4 media files from Drive
     2. downscale (image → 1280px; video → 360p, ~1 fps, ≤12 frames)
     3. send each to Gemini → strict JSON reading
     4. merge stamped GPS + time from the reading into the item
     5. compute an image fingerprint (SHA-256) for duplicate detection
     6. run the flag engine (rule checks + AI checks)
     7. write one result row to the Results store (verdict = blank)
        ↓
Dashboard reads the Results store → reviewer records verdict → saved back
```

**Model:** Gemini 3.6 Flash. **Design rule:** each photo analysed once; the
JSON reading is stored; all later comparisons run on stored text, never by
re-sending images.

---

## 1. What the AI extracts from each image/video

Every item (cooking photo, cooked-meal photo, serving video, children photo) is
sent to Gemini with the day's prescribed menu, and returns **strict JSON**:

```json
{
  "scene_type": "cooked_meal_in_vessel | serving | children_eating | cooking | other",
  "food_present": true/false,
  "dishes_visible": ["rice", "dal", ...],
  "menu_items_present": { "<each prescribed dish>": true/false },
  "children_eating": true/false/null,
  "cooking_in_progress": true/false/null,
  "gps_lat": number|null,
  "gps_lng": number|null,
  "stamp_datetime": "text from the GPS-camera stamp"|null,
  "stamp_place": "address from the stamp"|null,
  "notes": "one or two factual sentences about what is visible"
}
```

**Key instructions given to the model:**
- Report only what is *visibly present* — no guessing quantity, nutrition, or quality.
- Read the **GPS-Map-Camera stamp** (lat/long + date-time) burned into the photo,
  if present; return null otherwise.
- Use `null` for `children_eating` / `cooking_in_progress` when the scene doesn't apply.
- For the **video**: frames are sampled at ~1 fps (≤12 frames), sent together,
  and summarised as one combined reading.

**Cost controls applied before the API call:** image downscale to 1280px; video
downscale to 360p at ~1 fps. This is the single biggest cost lever.

---

## 2. The menu source (what "should" be on the plate)

The prescribed weekly menu (PM POSHAN rotation) drives menu-compliance. It's a
fixed weekly table, resolved by the meal's day of week:

| Day | Prescribed (visible) items |
|-----|----------------------------|
| Mon | roti, sabzi, fruit |
| Tue | rice, dal, sabzi |
| Wed | tehri, milk |
| Thu | roti, dal, sabzi |
| Fri | (tehri **or** khichdi), sabzi |
| Sat | rice, dal, sabzi |
| Sun | — (no school meal) |

Matching rules:
- **Alternatives** (`anyOf`): Friday's *tehri **or** khichdi* — either satisfies.
- **Categories**: a specific item satisfies a generic one — e.g. a *banana*
  satisfies *fruit*; *aloo/potato* satisfies *sabzi*; *arhar/moong* satisfies *dal*.

---

## 3. The two kinds of checks

### A. Rule checks (pure code, no AI)

| Check | Logic | Flag |
|-------|-------|------|
| Completeness | All 4 required items present | `items_missing` (red) |
| Meal window | Submission/stamp time within **10:30–13:00 IST** | `outside_meal_window` (amber) |
| Staged burst | All media captured within **90 s** of each other | `staged_burst` (amber) |
| Geo match | A photo's stamped GPS is **>150 m** from the school's known location* | `geo_mismatch` (red) |
| Geo consistency | The four photos' GPS are **>150 m apart** from each other | `geo_inconsistent` (red) |
| Duplicate media | A photo's SHA-256 fingerprint matches one from an earlier submission | `duplicate_media` (red) |

\* *Geo match needs a school→coordinates registry, which isn't populated yet;
until then it's inactive. Geo consistency works on the four stamped photos alone.
Time/GPS checks depend on the photos carrying a GPS-camera stamp.*

### B. AI checks (from the stored JSON reading)

| Check | Logic | Flag |
|-------|-------|------|
| Menu compliance | Every prescribed item (or an alternative/category member) is visible across the meal + serving readings | `menu_missing` (red) |
| Food present | Cooked-meal photo shows food | `no_food` (red) if false |
| Children eating | Wide photo shows children eating | `no_children_eating` (amber) if false |
| Cooking genuine | Cooking photo shows cooking in progress | `no_cooking` (amber) if false |

---

## 4. Flag catalogue (severity + meaning)

**🔴 Red** (likely real problem):
- `items_missing` — a required photo/video wasn't submitted
- `menu_missing` — a prescribed dish for the day isn't visible
- `no_food` — cooked-meal photo shows no food
- `geo_mismatch` — photo taken >150 m from the school
- `geo_inconsistent` — the four photos taken >150 m apart
- `duplicate_media` — a photo reused from an earlier submission

**🟡 Amber** (worth a glance):
- `outside_meal_window` — time outside 10:30–13:00
- `staged_burst` — all media within ~90 s
- `no_children_eating` — children not visibly eating
- `no_cooking` — cooking not visibly in progress

Each flag records: `code`, `severity`, a human-readable `message`, and `stage`
(`rule` or `ai`).

---

## 5. Severity roll-up & queue ranking

- A submission's overall severity = its worst flag (red > amber > clean).
- **Queue score** = (red flags × 100) + (amber flags × 10).
- The review queue sorts by score, highest first — worst offenders on top.
- Example: a submission missing its video (red) and submitted at 02:30 (amber)
  → score 110, shown as "Red · 1 red, 1 amber".

---

## 6. The human layer

- The engine **never** writes a verdict. `reviewer_verdict` starts blank.
- The reviewer sets *Acceptable / Not acceptable* + a comment; that is the record.
- A school only ever hears a mentor's verified finding — never a raw AI flag.

---

## 7. What is stored per submission (the results store)

`id, date, udise, school_name, block, menuLabel, severity, score, summary,
flags (JSON), files (JSON: per-item AI reading + GPS + time + fingerprint + link),
headcount, submittedAt, processedAt, reviewer_verdict, reviewer_comment, reviewer_at`

Because the full AI reading is stored, future comparison rules (baseline, peer,
history) run on this text without touching the images again.

---

## 8. Known gaps / not yet implemented (the design agenda)

These are deliberately **out** of the current build and are the focus of the next
iteration:

1. **Baseline-aware checks** — portion/quantity judged against each school's
   recorded vessel sizes, enrolment, and daily eater count. *(Baseline data is
   captured by the profiling form but not yet wired into analysis.)*
2. **Peer comparison** — compare a school against others cooking the same menu the
   same day (portion, dishes, timing outliers).
3. **School location registry** — to activate absolute `geo_mismatch`.
4. **Richer, menu- and baseline-aware image prompts** — more specific extraction
   per scene type, and per-dish confidence.
5. **Portion / adequacy signals**, **repeat-offender history**, and a
   **daily digest** to leadership.

---

## 9. Parameters (currently hard-set, easily tunable)

| Parameter | Value |
|-----------|-------|
| Meal window | 10:30–13:00 IST |
| Geo radius | 150 m |
| Staged-burst threshold | 90 s |
| Video downscale | 360p, ~1 fps, ≤12 frames |
| Image downscale | 1280 px max |
| Red score weight / Amber | 100 / 10 |
| Model | Gemini 3.6 Flash |

*These live in one config block and can be tuned per the pilot's experience.*
