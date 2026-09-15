// ============================================================
// AI per-scene response schemas (v2 design) — Gemini structured output.
// One schema per capture stage; each merges the COMMON block.
// Handed to Gemini as `responseSchema` so the model MUST return this shape.
//
// NOT yet wired into the live pipeline — pending the eval loop (Step 3).
// See docs/AI-SCHEMA-AND-PROMPTS.md for the human-readable spec + rubrics.
// ============================================================

// --- tiny schema builders (Gemini OpenAPI-subset: UPPERCASE types) ---
const S = (enumVals) => ({ type: 'STRING', ...(enumVals ? { enum: enumVals } : {}) });
const YN = () => S(['yes', 'no', 'unclear']);
const INT = () => ({ type: 'INTEGER' });
const NUM_NULLABLE = () => ({ type: 'NUMBER', nullable: true });
const STR_NULLABLE = () => ({ type: 'STRING', nullable: true });
const STR_ARRAY = () => ({ type: 'ARRAY', items: { type: 'STRING' } });
const MENU_ITEMS = () => ({
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: { item: { type: 'STRING' }, status: S(['present', 'absent', 'unclear']) },
    required: ['item', 'status'],
  },
});

// --- COMMON block: in every reading ---
const COMMON = {
  observed_scene: S(['cooking', 'cooked_food_in_cookware', 'serving', 'served_plate', 'other']),
  scene_matches_expected: YN(),
  image_quality: S(['clear', 'slightly_blurry', 'too_blurry', 'too_dark', 'obstructed']),
  is_photo_of_a_screen: YN(),
  gps_present: S(['yes', 'no']),
  gps_lat: NUM_NULLABLE(),
  gps_lng: NUM_NULLABLE(),
  stamp_place_text: STR_NULLABLE(),
  capture_datetime_text: STR_NULLABLE(),
  confidence: S(['high', 'medium', 'low']),
  notes: { type: 'STRING' },
};

// --- per-stage additions ---
const STAGE_FIELDS = {
  cooking: {
    cooking_in_progress: YN(),
    heat_source: S(['flame', 'steam_only', 'no_heat_visible', 'unclear']),
    food_or_ingredients_visible: YN(),
    large_cooking_vessel_visible: YN(),
    kitchen_visible_in_frame: YN(),
    person_cooking_present: YN(),
    kitchen_cleanliness: S(['clean', 'average', 'dirty', 'unclear']),
    dishes_being_cooked: STR_ARRAY(),
  },
  cooked_food: {
    food_present: YN(),
    top_down_view: YN(),
    number_of_distinct_dishes: INT(),
    dishes_visible: STR_ARRAY(),
    menu_items: MENU_ITEMS(),
    appears_freshly_cooked: YN(),
    cookware_fill_level: S(['full', 'about_half', 'low', 'unclear']),
  },
  serving: {
    serving_action_visible: YN(),
    food_moved_from_cookware_to_plate: YN(),
    dishes_served: STR_ARRAY(),
    plate_or_thali_visible: YN(),
    appears_single_continuous_clip: YN(),
  },
  plate: {
    dishes_on_plate: STR_ARRAY(),
    menu_items: MENU_ITEMS(),
    plate_fullness: S(['sparse', 'adequate', 'generous', 'unclear']),
    all_menu_components_together_on_one_plate: YN(),
    single_standard_plate: YN(),
  },
};

export const STAGES = Object.keys(STAGE_FIELDS);

/** Build the full responseSchema (COMMON + stage fields) for one stage. */
export function getSchema(stage) {
  const stageProps = STAGE_FIELDS[stage];
  if (!stageProps) throw new Error(`Unknown stage: ${stage}`);
  const properties = { ...COMMON, ...stageProps };
  return {
    type: 'OBJECT',
    properties,
    required: Object.keys(properties),
    propertyOrdering: Object.keys(properties),
  };
}
