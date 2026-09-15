# AI Analysis — What the AI Reads From Each Photo (v2 design)

*How the AI looks at each of the four daily food captures, what it reports, and exactly what we tell it.*
*Design for review — not yet live. Next step: test on real Hargaon photos, then switch on.*

---

## The idea in one line

For each photo/video the AI returns a small set of **plain observations** — never a verdict. Code turns those observations into flags; the reviewer makes the final call. Every question allows an **"unclear"** answer, so the AI never has to guess.

## The four daily captures

1. **Cooking** — food being cooked, kitchen in frame
2. **Cooked food** — the finished food in the cookware
3. **Serving** — a short video of food served from cookware onto a plate
4. **Plate** — a plate with all the food on it

*(The children-eating photo has been removed.)*

---

## Common questions — asked on EVERY capture

These are checked on all four items (quality, honesty, privacy, location/time stamp):

| What the AI reports | Possible answers | What it tells us |
|---|---|---|
| Which scene is this really? | cooking / cooked food / serving / plate / other | Catches a photo put in the wrong slot |
| Does it match the expected stage? | yes / no / unclear | Wrong-photo detection |
| Image quality | clear / slightly blurry / too blurry / too dark / obstructed | Whether the photo is usable |
| Is this a photo of a screen? | yes / no / unclear | Catches re-photographing an old picture (gaming) |
| GPS stamp present? + lat/long | yes/no + numbers | Location check (read off the photo stamp) |
| Date-time on the stamp | text | Timing check |
| Confidence | high / medium / low | How sure the AI is |
| Notes | one or two sentences | Plain description for the reviewer |

---

## Capture 1 — Cooking (food being cooked, kitchen in frame)

| What the AI reports | Possible answers | What it tells us |
|---|---|---|
| Is cooking genuinely in progress? | yes / no / unclear | Cooking is really happening (not staged) |
| Heat source | flame / steam only / none / unclear | Corroborates active cooking |
| Food or ingredients visible? | yes / no / unclear | Something is actually being cooked |
| Large cooking vessel visible? | yes / no / unclear | Cooking at scale, not a token pot |
| Is the kitchen in frame? | yes / no / unclear | The required framing was followed |
| Is a person cooking present? | yes / no / unclear | Presence only — never who |
| Kitchen cleanliness | clean / average / dirty / unclear | Soft hygiene signal |
| Dishes being cooked | list | What's on the stove |

## Capture 2 — Cooked food (finished food in the cookware)

| What the AI reports | Possible answers | What it tells us |
|---|---|---|
| Is food present? | yes / no / unclear | There is a cooked meal |
| Top-down view? | yes / no / unclear | Required framing followed |
| Number of distinct dishes | a number | How many items were cooked |
| Dishes visible | list | What was cooked |
| For each prescribed menu item | present / absent / unclear | **Menu compliance** — is each required dish there |
| Looks freshly cooked? | yes / no / unclear | Fresh vs stale/re-used |
| Cookware fill level | full / about half / low / unclear | Soft quantity signal (never converted to litres) |

## Capture 3 — Serving (video: cookware → plate)

| What the AI reports | Possible answers | What it tells us |
|---|---|---|
| Serving action visible? | yes / no / unclear | Food is actually being served |
| Food moved from cookware to plate? | yes / no / unclear | The serving really happened |
| Dishes served | list | What reached the plate |
| Plate/thali visible? | yes / no / unclear | Served onto a proper plate |
| Looks like one continuous clip? | yes / no / unclear | Authenticity (not stitched/edited) |

## Capture 4 — Plate (a plate with all the food) — *the portion check*

| What the AI reports | Possible answers | What it tells us |
|---|---|---|
| Dishes on the plate | list | What the child actually gets |
| For each prescribed menu item | present / absent / unclear | Menu compliance, at the plate |
| **Plate fullness** | sparse / adequate / generous / unclear | **Portion size** — compared to the school's own norm & peers |
| All menu components together on one plate? | yes / no / unclear | The full meal is served together |
| Single standard plate? | yes / no / unclear | A fair, comparable reference |

---

## The rubrics (so fuzzy words mean the same thing every time)

| Scale | sparse / low | adequate / half | generous / full | unclear |
|---|---|---|---|---|
| **Plate fullness** | plate base visible through the food; thin covering | food covers most of the plate evenly; distinct portions | food heaped above the plate's well | angle/glare/crop prevents a fair call |
| **Cookware fill** | ~a quarter or less left | ~half full | ~three-quarters or more | vessel depth not visible |
| **Kitchen cleanliness** | — | some clutter / minor spillage | tidy, no refuse (this is "clean") | kitchen not visible enough |

---

## Exactly what we tell the AI (the prompts)

**Said on every capture (the preamble):**
> You are screening one media item from a school Mid-Day Meal (PM POSHAN) programme in rural Uttar Pradesh, India. Report ONLY what is visibly present. Do not judge quality, nutrition, or whether the meal is acceptable — only describe what you see.
> • If something is not clearly visible or you are unsure, answer "unclear". Never guess.
> • Do not identify any person — only whether a person is present.
> • If a GPS-camera stamp is visible (address, latitude, longitude, date, time), read the numbers and date-time exactly; otherwise leave them blank.
> • Return only the required answers, in the exact format given.

**Cooking:**
> This should show food being cooked with the kitchen visible. Report whether cooking is genuinely in progress (flame/steam/stirring), whether the kitchen is in frame, whether a large cooking vessel is present, whether a person cooking is present (presence only), rate kitchen cleanliness using the rubric, and list any dishes being cooked.

**Cooked food:**
> This should show the finished cooked food in the cookware, ideally top-down. Today's prescribed menu is: {menu}. Report whether food is present, whether it's a top-down view, how many distinct dishes, list the dishes, and for EACH prescribed menu item mark present / absent / unclear. Say whether it looks freshly cooked and rate cookware fill level using the rubric.

**Serving (video):**
> These frames are from a short video of food being served from the cookware onto a plate. Treat them as one clip. Report whether a serving action is visible, whether food is moved from cookware onto a plate, which dishes are served, whether a plate/thali is visible, and whether it looks like one continuous clip.

**Plate:**
> This should show a single plate with all of today's food. Today's prescribed menu is: {menu}. List the dishes on the plate, and for EACH prescribed menu item mark present / absent / unclear. Rate plate fullness using the rubric. Say whether all menu components are together on one plate, and whether it's a single standard plate.

---

## What the new signals will let us flag (built later, in code)

| Observation | Flag it feeds |
|---|---|
| Scene doesn't match the slot | wrong photo |
| Photo of a screen | re-photographed / gaming |
| Plate fullness low vs the school's norm/peers | portion low |
| A prescribed dish marked "absent" | menu missing |
| Cooking not in progress | cooking not genuine |
| Kitchen dirty | hygiene low (soft) |
| Clip not continuous | edited video |

*"unclear" never raises a red flag by itself — it routes to the human.*

---

## How we'll make sure it's accurate (next step)

Before switching this on, we test it against ~30–50 **real Hargaon photos you've already reviewed**: we note the correct answer for each, run the AI, and score it field-by-field. Targets: dish detection ≥90%, wrong-photo ≥95%, plate-fullness (within one level) ≥85%, GPS/time stamp read ≥95%. Anything that misses gets its wording/rubric improved and re-tested — then we wire it into the live dashboard.
