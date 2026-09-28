// ============================================================
// AI per-scene prompts (v2 design) — pairs with schemas.v2.js.
// Shared preamble + per-stage instruction + rubric, with the day's
// prescribed menu injected where relevant.
//
// NOT yet wired into the live pipeline — pending the eval loop (Step 3).
// ============================================================

export const SHARED_PREAMBLE = `You are screening one media item from a school Mid-Day Meal (PM POSHAN) programme in rural Uttar Pradesh, India. Report ONLY what is visibly present. Do not judge quality, nutrition, or whether the meal is acceptable — only describe what you see.

Rules:
- If something is not clearly visible or you are unsure, answer "unclear" (or null). Never guess. "unclear" is always a valid, expected answer.
- Do not identify any person. Report only whether a person is present, never who.
- Many photos carry a GPS-camera stamp (a band showing address, latitude, longitude, date and time). If present, read the numeric latitude/longitude and the date-time text exactly; otherwise use null.
- Return ONLY the required JSON object, matching the given schema exactly.

Hygiene & cleanliness (report every time, as plain observation — not a verdict).
Be CONSERVATIVE: rural kitchens are modest and that is normal. Rate "dirty" and
report pests ONLY when it is obvious and unmistakable. When in any doubt, choose
"average" or "unclear" — never "dirty", and never "yes" for pests.
- area_cleanliness: clean / average / dirty / unclear (the visible surroundings, floor and surfaces around the food or cooking). Use "dirty" ONLY for clearly, obviously dirty conditions — piled refuse, standing filth, heavy grime. A plain, worn, or simple setting is "average", not "dirty".
- food_on_bare_floor: yes only if a cooking vessel, serving vessel or eating plate rests directly on bare ground with no mat/table/stand; no if raised or on a mat/cloth; unclear otherwise.
- food_left_uncovered: yes if cooked food is open with no lid/cover where a cover would be expected; unclear if it cannot be told.
- waste_or_pests_visible: yes ONLY if there is clearly visible garbage/food waste in a heap, or pests/flies plainly present in numbers right at the food. A single insect, a speck, motion blur, or anything you are unsure about is "no". Do not guess pests from small dark dots or texture.
- hygiene_notes: one short factual sentence on anything hygiene-relevant you see, or "" if nothing notable.

Common Indian dishes to recognise: rice, dal, khichdi, tehri, roti/chapati, sabzi, aloo/potato, kadhi, egg, banana, milk, poha, soya badi, bajra, moong.`;

export const RUBRICS = {
  plate_fullness: `plate_fullness rubric — sparse: plate base clearly visible through/around the food, thin covering. adequate: food covers most of the plate in an even layer, distinct portions. generous: food heaped/mounded above the well of the plate. unclear: angle/glare/crop prevents a fair judgment.`,
  cookware_fill_level: `cookware_fill_level rubric — full: food fills ~three-quarters or more. about_half: ~half full. low: ~a quarter or less. unclear: vessel depth not visible.`,
  kitchen_cleanliness: `kitchen_cleanliness rubric — clean: surfaces tidy, no visible refuse/spillage. average: some clutter, minor spillage, or a plain/worn but ordinary kitchen (this is the DEFAULT for a normal rural kitchen). dirty: ONLY for clearly, obviously dirty — piled refuse, standing waste, or pests plainly present in numbers. unclear: kitchen not sufficiently visible. When in doubt, choose average — never dirty.`,
};

const STAGE_INSTRUCTIONS = {
  cooking: () => `This item should show food being cooked with the kitchen visible.
Report: is cooking genuinely in progress (flame/steam/stirring)? is the kitchen in frame? is a large cooking vessel present? is a person cooking present (presence only, never identity)? rate kitchen cleanliness using the rubric below. List any dishes being cooked.
${RUBRICS.kitchen_cleanliness}`,

  cooked_food: (menu) => `This item should show the finished cooked food in the cookware, ideally top-down.
Today's prescribed menu is: ${menu}.
Report: is food present? is it a top-down view? how many distinct dishes? list the dishes you see. For EACH prescribed menu item, mark present / absent / unclear based only on what is visible. Does it look freshly cooked? Rate cookware fill level using the rubric below.
${RUBRICS.cookware_fill_level}`,

  serving: () => `These frames are sampled (~1 per second) from a short video of food being served from the cookware onto a plate. Treat them together as one clip.
Report: is a serving action visible? is food moved from cookware onto a plate? which dishes are served? is a plate/thali visible? does it look like one continuous clip (not stitched/edited)?`,

  plate: (menu) => `This item should show a single plate with all of today's food on it.
Today's prescribed menu is: ${menu}.
Report: list the dishes on the plate. For EACH prescribed menu item, mark present / absent / unclear. Rate plate fullness using the rubric below. Are all menu components together on one plate? Is it a single standard plate?
${RUBRICS.plate_fullness}`,
};

/**
 * Build the full prompt for one stage.
 * @param {string} stage  one of schemas.v2 STAGES
 * @param {object} [opts] { menuItems: string[] }
 */
export function buildPrompt(stage, opts = {}) {
  const fn = STAGE_INSTRUCTIONS[stage];
  if (!fn) throw new Error(`Unknown stage: ${stage}`);
  const menu = (opts.menuItems && opts.menuItems.length) ? opts.menuItems.join(', ') : '(not provided)';
  return `${SHARED_PREAMBLE}\n\n${fn(menu)}`;
}

/** For the video stage: appends the frame-count note. */
export function buildVideoPrompt(opts = {}) {
  const n = opts.frameCount || 0;
  return `${buildPrompt('serving', opts)}\n\n(There are ${n} sampled frames; describe the clip as a whole in one JSON object.)`;
}
