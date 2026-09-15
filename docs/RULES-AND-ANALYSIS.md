# MDM Monitoring — Rules & Analysis Points (as built)

*A summary of what the system currently analyses and how it flags, exactly as implemented in the code.*
*Hargaon block, Sitapur · Last updated: 15 Sep 2026*

---

## 1. The daily captures

Every school day a school submits four food-stage items:

| # | Capture | What it shows |
|---|---------|---------------|
| 1 | Cooking | Food being cooked, kitchen in frame |
| 2 | Cooked food | The finished food in the cookware |
| 3 | Serving (video) | Short clip of food served from cookware onto a plate |
| 4 | Plate | A plate with all the food on it |

Plus: school name, UDISE code, date, number of children who ate.

---

## 2. Principles the code enforces

- **AI observes, humans judge.** The AI only reports what is visible. It never decides "acceptable". The reviewer's verdict is what goes on record.
- **"Unclear" is always allowed** — the AI never has to guess; unclear routes to the human, never auto-flags.
- **Analyse once, store the reading** — each photo is read a single time; later comparisons use the stored text, never re-scanned images.
- **Cost control** — video is downscaled to 360p at ~1 frame/second (≤12 frames) and images to 1280px *before* the AI sees them.
- **No faces used** — faces are not detected or flagged (per decision).

---

## 3. What the AI reads from each capture (analysis points)

### Common — asked on every capture
| Observation | Possible answers |
|---|---|
| Which scene is this really | cooking / cooked food / serving / plate / other |
| Matches the expected stage? | yes / no / unclear |
| Image quality | clear / slightly blurry / too blurry / too dark / obstructed |
| Photo of a screen? | yes / no / unclear |
| GPS stamp present + latitude/longitude | yes/no + numbers |
| Date-time on the stamp | text |
| Confidence | high / medium / low |
| Notes | short factual description |

### Capture 1 — Cooking
| Observation | Possible answers |
|---|---|
| Cooking in progress? | yes / no / unclear |
| Heat source | flame / steam only / none / unclear |
| Food or ingredients visible? | yes / no / unclear |
| Large cooking vessel visible? | yes / no / unclear |
| Kitchen in frame? | yes / no / unclear |
| Person cooking present? (presence only) | yes / no / unclear |
| Kitchen cleanliness | clean / average / dirty / unclear |
| Dishes being cooked | list |

### Capture 2 — Cooked food
| Observation | Possible answers |
|---|---|
| Food present? | yes / no / unclear |
| Top-down view? | yes / no / unclear |
| Number of distinct dishes | a number |
| Dishes visible | list |
| Each prescribed menu item | present / absent / unclear |
| Looks freshly cooked? | yes / no / unclear |
| Cookware fill level | full / about half / low / unclear |

### Capture 3 — Serving (video)
| Observation | Possible answers |
|---|---|
| Serving action visible? | yes / no / unclear |
| Food moved cookware → plate? | yes / no / unclear |
| Dishes served | list |
| Plate / thali visible? | yes / no / unclear |
| Looks like one continuous clip? | yes / no / unclear |

### Capture 4 — Plate (portion check)
| Observation | Possible answers |
|---|---|
| Dishes on the plate | list |
| Each prescribed menu item | present / absent / unclear |
| Plate fullness | sparse / adequate / generous / unclear |
| All menu components together on one plate? | yes / no / unclear |
| Single standard plate? | yes / no / unclear |

**Rubrics (so ratings are consistent):**
- Plate fullness — *sparse*: plate base visible through the food; *adequate*: even layer covering most of the plate; *generous*: heaped above the well.
- Cookware fill — *low*: ~¼ or less; *about half*: ~½; *full*: ~¾ or more.
- Kitchen cleanliness — *clean*: tidy, no refuse; *average*: some clutter; *dirty*: visible refuse/spillage/pests.

---

## 4. The prescribed menu (what "should" be served)

Fixed weekly rotation (PM POSHAN), resolved by the meal's day of week:

| Day | Prescribed (visible) items |
|-----|----------------------------|
| Monday | roti, sabzi, fruit |
| Tuesday | rice, dal, sabzi |
| Wednesday | tehri, milk |
| Thursday | roti, dal, sabzi |
| Friday | (tehri **or** khichdi), sabzi |
| Saturday | rice, dal, sabzi |
| Sunday | no school meal |

Matching allows **alternatives** (Friday's tehri *or* khichdi) and **categories** (a banana satisfies "fruit"; aloo/potato satisfies "sabzi"; arhar/moong satisfies "dal").

---

## 5. The flag rules (as implemented)

Two kinds of checks run per submission.

### Rule checks (pure code)
| Flag | Severity | Fires when |
|---|---|---|
| items_missing | 🔴 Red | One of the 4 required captures wasn't submitted |
| outside_meal_window | 🟡 Amber | Photo/submission time outside 10:30–13:00 IST |
| staged_burst | 🟡 Amber | All media captured within ~90 seconds |
| geo_mismatch | 🔴 Red | A photo's stamped GPS is >150 m from the school's known location* |
| geo_inconsistent | 🔴 Red | The photos' GPS points are >150 m apart from each other |
| duplicate_media | 🔴 Red | A photo's fingerprint matches one from an earlier submission |

### AI checks (from the stored reading)
| Flag | Severity | Fires when |
|---|---|---|
| menu_missing | 🔴 Red | A prescribed dish (or its alternative/category) is not visible across cooked-food + plate |
| no_food | 🔴 Red | The cooked-food photo shows no food present |
| no_cooking | 🟡 Amber | The cooking photo shows cooking not in progress |

\* *geo_mismatch needs a school → coordinates registry, which isn't populated yet, so it is currently inactive. geo_inconsistent works on the four stamped photos alone. Timing/GPS checks depend on the photos carrying a GPS-camera stamp.*

---

## 6. Severity & ranking

- A submission's overall severity = its worst flag (**red > amber > clean**).
- **Queue score** = (red flags × 100) + (amber flags × 10).
- The dashboard review queue is sorted by score, highest first.
- "unclear" answers never raise a flag on their own.

---

## 7. Current parameters (tunable in one config block)

| Parameter | Value |
|---|---|
| Meal window | 10:30–13:00 IST |
| Geo radius | 150 m |
| Staged-burst threshold | 90 seconds |
| Video downscale | 360p, ~1 fps, ≤12 frames |
| Image downscale | 1280 px max |
| Red / Amber score weight | 100 / 10 |
| AI model | Gemini 3.6 Flash |

---

## 8. The human layer

- The engine never writes a verdict — every submission starts with **reviewer_verdict = blank**.
- The reviewer marks **Acceptable / Not acceptable** with a comment; that is the record.
- A school only ever hears a mentor's verified finding — never a raw AI flag.

---

## 9. Not yet built (next design step)

- **Persistence / pattern flagging** — currently a flag is computed per single submission. The intended model is that a **single day never flags a school**; a school-level flag should require a *pattern* over a window (e.g. "3 days in 2 weeks", "5 days in a month"), configurable per signal. This is the next piece to design.
- **Portion comparison** — plate fullness is captured but not yet compared to the school's own norm or to peers cooking the same menu that day.
- **Baseline-aware checks** and **peer comparison** — planned.
- **School location registry** — to switch on geo_mismatch.
