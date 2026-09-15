# AI Analysis — Per-Scene Schemas & Prompts (v2 design)

*Step 1 (what each photo/video must yield) + Step 2 (how we ask for it).*
*Design for review — not yet wired into the live pipeline. Next: eval on real photos, then wire in.*

---

## Design rules baked into this

1. **AI perceives, code decides.** Every field below is an *observation*. No field says "acceptable", applies a threshold, or does arithmetic — the flag engine (code) does that.
2. **"Unclear" is always allowed.** Judgment fields are tri-state `yes | no | unclear` (or an enum with `unclear`). This is what stops the model inventing answers when the photo is bad.
3. **Structured output, enforced.** Each schema is handed to Gemini as a `responseSchema`, so the model *must* return this exact shape — not "please return JSON".
4. **One reading per media item, stored once.** Comparisons (peer, self-history) run later on this stored text, never by re-analysing images.
5. **Rubrics, not adjectives.** Fuzzy scales (plate fullness, cleanliness) are defined with anchors so ratings are consistent across schools and days.

---

## The daily captures (stages)

| Stage key | What the school sends |
|-----------|-----------------------|
| `cooking` | Food being cooked, **kitchen in frame** |
| `cooked_food` | Final cooked food **in the cookware** |
| `serving` | Short **video**: food served from cookware onto a plate |
| `plate` | A **plate with all the food** on it |
| `children` | Wide shot of children eating (consumption evidence) |

> **Open decision (please confirm):** is the daily set these **5** items (4 food stages + children), or do the 4 food stages **replace** the children photo? The schema supports either — it only changes which stages we require.

---

## Common block — returned for EVERY item

These fields are in every reading regardless of stage (authenticity, privacy, quality, stamp):

```json
{
  "observed_scene": "cooking | cooked_food_in_cookware | serving | served_plate | children_eating | other",
  "scene_matches_expected": "yes | no | unclear",
  "image_quality": "clear | slightly_blurry | too_blurry | too_dark | obstructed",
  "is_photo_of_a_screen": "yes | no | unclear",
  "face_clearly_visible": "yes | no | unclear",
  "gps_present": "yes | no",
  "gps_lat": number | null,
  "gps_lng": number | null,
  "stamp_place_text": string | null,
  "capture_datetime_text": string | null,
  "confidence": "high | medium | low",
  "notes": "one or two short factual sentences"
}
```

- `scene_matches_expected` catches wrong-photo-in-wrong-slot (e.g., a plate photo in the cooking slot).
- `is_photo_of_a_screen` catches re-photographing an old picture off a phone/PC (anti-gaming).
- `face_clearly_visible` enforces the no-faces rule → the reviewer voids such a submission.
- GPS + `capture_datetime_text` are read off the GPS-camera stamp; code merges them into the timing/geo checks.

---

## Stage schemas (added to the common block)

### 1. `cooking` — food being cooked, kitchen in frame
```json
{
  "cooking_in_progress": "yes | no | unclear",
  "heat_source": "flame | steam_only | no_heat_visible | unclear",
  "food_or_ingredients_visible": "yes | no | unclear",
  "large_cooking_vessel_visible": "yes | no | unclear",
  "kitchen_visible_in_frame": "yes | no | unclear",
  "person_cooking_present": "yes | no | unclear",
  "kitchen_cleanliness": "clean | average | dirty | unclear",
  "dishes_being_cooked": ["string"]
}
```
*`person_cooking_present` = presence only, never identity. `kitchen_cleanliness` is a soft hygiene signal.*

### 2. `cooked_food` — final cooked food in cookware
```json
{
  "food_present": "yes | no | unclear",
  "top_down_view": "yes | no | unclear",
  "number_of_distinct_dishes": integer,
  "dishes_visible": ["string"],
  "menu_items": [ { "item": "string", "status": "present | absent | unclear" } ],
  "appears_freshly_cooked": "yes | no | unclear",
  "cookware_fill_level": "full | about_half | low | unclear"
}
```
*`menu_items` is filled from the prescribed menu we pass in. `cookware_fill_level` is a soft, non-volumetric signal — never converted to litres.*

### 3. `serving` — video, cookware → plate
```json
{
  "serving_action_visible": "yes | no | unclear",
  "food_moved_from_cookware_to_plate": "yes | no | unclear",
  "dishes_served": ["string"],
  "plate_or_thali_visible": "yes | no | unclear",
  "appears_single_continuous_clip": "yes | no | unclear"
}
```
*`appears_single_continuous_clip` is an authenticity signal (stitched/edited clip looks off).*

### 4. `plate` — a plate with all the food  *(the portion item)*
```json
{
  "dishes_on_plate": ["string"],
  "menu_items": [ { "item": "string", "status": "present | absent | unclear" } ],
  "plate_fullness": "sparse | adequate | generous | unclear",
  "all_menu_components_together_on_one_plate": "yes | no | unclear",
  "single_standard_plate": "yes | no | unclear"
}
```
*`plate_fullness` drives portion-adequacy — used **relatively** (vs this school's own norm and vs peers today), never as an absolute grade.*

### 5. `children` — wide shot, children eating
```json
{
  "children_present": "yes | no | unclear",
  "children_eating": "yes | no | unclear",
  "approx_group_size": "none | few_under_10 | some_10_to_30 | many_over_30 | unclear",
  "eating_from_plates": "yes | no | unclear",
  "wide_angle_no_closeups": "yes | no | unclear",
  "faces_clearly_visible": "yes | no | unclear"
}
```
*`approx_group_size` is a coarse band, **not** a head count of individuals — dignity/no-surveillance.*

---

## The rubrics (anchors for the fuzzy scales)

**`plate_fullness`**
- `sparse` — plate base clearly visible through/around the food; thin covering.
- `adequate` — food covers most of the plate in an even layer; distinct portions.
- `generous` — food heaped/mounded above the rim of the plate's well.
- `unclear` — angle, glare, or crop prevents a fair judgment.

**`cookware_fill_level`**
- `full` — food fills roughly three-quarters or more of the vessel.
- `about_half` — around half full.
- `low` — roughly a quarter or less remaining.
- `unclear` — can't see the vessel depth.

**`kitchen_cleanliness`**
- `clean` — surfaces tidy, no visible refuse or spillage.
- `average` — some clutter or minor spillage.
- `dirty` — visible refuse, standing waste, or pests.
- `unclear` — kitchen not sufficiently visible.

---

## The prompts (Step 2)

### Shared preamble (prepended to every stage prompt)
```
You are screening one media item from a school Mid-Day Meal (PM POSHAN) programme
in rural Uttar Pradesh, India. Report ONLY what is visibly present. Do not judge
quality, nutrition, or whether the meal is acceptable — only describe what you see.

Rules:
- If something is not clearly visible or you are unsure, answer "unclear" (or null).
  Never guess. "unclear" is always a valid, expected answer.
- Do not identify any person. Report only whether a person is present, never who.
- Many photos carry a GPS-camera stamp (a band showing address, latitude,
  longitude, date and time). If present, read the numeric latitude/longitude and
  the date-time text exactly; otherwise use null.
- Return ONLY the required JSON object, matching the given schema exactly.

Common Indian dishes to recognise: rice, dal, khichdi, tehri, roti/chapati, sabzi,
aloo/potato, kadhi, egg, banana, milk, poha, soya badi, bajra, moong.
```

### Per-stage instruction (added after the preamble)

**cooking**
```
This should show food being cooked with the kitchen visible.
Report: is cooking genuinely in progress (flame/steam/stirring)? is the kitchen
in frame? is a large cooking vessel present? is a person cooking present (presence
only)? rate kitchen cleanliness using the rubric. List any dishes being cooked.
```

**cooked_food**
```
This should show the finished cooked food in the cookware, ideally top-down.
Today's prescribed menu is: {menu}.
Report: is food present? is it a top-down view? how many distinct dishes? list the
dishes you see. For EACH prescribed menu item, mark present / absent / unclear
based only on what is visible. Does it look freshly cooked? Rate cookware fill
level using the rubric.
```

**serving** *(video — frames sampled ~1 fps)*
```
These frames are sampled from a short video of food being served from the cookware
onto a plate. Treat them together as one clip.
Report: is a serving action visible? is food moved from cookware onto a plate? which
dishes are served? is a plate/thali visible? does it look like one continuous clip?
```

**plate**
```
This should show a single plate with all of today's food on it.
Today's prescribed menu is: {menu}.
Report: list the dishes on the plate. For EACH prescribed menu item, mark present /
absent / unclear. Rate plate fullness using the rubric (sparse/adequate/generous).
Are all menu components together on one plate? Is it a single standard plate?
```

**children**
```
This should be a wide shot of children eating. It must NOT contain clear faces or
close-ups of individuals.
Report: are children present? are they eating? approximate group size as a band
(not an exact count). are they eating from plates? is it a wide shot without
close-ups? are any faces clearly visible?
```

---

## What each new field unlocks downstream (code-side, later)

| New/'richer' observation | Flag or insight it will feed (Step 5) |
|---|---|
| `scene_matches_expected = no` | `wrong_photo` — item doesn't match its slot |
| `is_photo_of_a_screen = yes` | `rephotographed` — anti-gaming |
| `face_clearly_visible = yes` | `face_visible` — submission void per policy |
| `plate_fullness` + history/peers | `portion_low` (relative, not absolute) |
| `menu_items[].status = absent` | `menu_missing` (unchanged, now per-item + unclear-aware) |
| `cooking_in_progress = no` | `no_cooking` (unchanged) |
| `children_eating = no` | `no_children_eating` (unchanged) |
| `kitchen_cleanliness = dirty` | `hygiene_low` (soft, amber) |
| `appears_single_continuous_clip = no` | `edited_clip` — authenticity |

*(`unclear` never raises a red flag on its own — it routes to the human, or is ignored, by design.)*

---

## The eval bar (Step 3 preview)

Before wiring in, each field must clear a target on a labelled set of ~30–50 real
Hargaon photos:

| Field type | Target |
|---|---|
| Dish detection (present/absent) | ≥ 90% agreement with human label |
| Scene match / wrong-photo | ≥ 95% |
| `children_eating`, `cooking_in_progress` | ≥ 90% |
| `plate_fullness` (within one level) | ≥ 85% |
| GPS/time stamp read (when present) | ≥ 95% |
| Face-visible detection | ≥ 98% (safety-critical) |

Fields that miss the bar get a reworded prompt / an extra rubric line / an example,
then re-scored — until they pass or we drop the field as unreliable.
