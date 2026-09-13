// ============================================================
// Gemini prompt builder — returns strict JSON, observes only.
// Kept identical in spirit to the working demo prompt.
// ============================================================

export function buildScreeningPrompt(menuItems = []) {
  const menu = menuItems.length ? menuItems.join(', ') : '(not provided)';
  return `You are screening a photograph from a school Mid-Day Meal programme in Uttar Pradesh, India.
Today's prescribed menu is: ${menu}.

Look at the photograph and report ONLY what is visibly present. Do not guess quantity, nutrition, or quality.
Return STRICT JSON only, no prose, no markdown, with exactly this shape:
{
  "scene_type": "cooked_meal_in_vessel | serving | children_eating | cooking | other",
  "food_present": true/false,
  "dishes_visible": ["..."],
  "menu_items_present": { "<each menu item>": true/false },
  "children_eating": true/false/null,
  "cooking_in_progress": true/false/null,
  "notes": "one or two short factual sentences about what is visible"
}
Use null for children_eating / cooking_in_progress if the photo does not show that scene.
Common Indian dishes to recognise: rice, dal, khichdi, tehri, roti, chapati, sabzi, aloo, potato, kadhi, egg, banana, milk, poha.`;
}

// For a video, we send several sampled frames and ask for one combined reading.
export function buildVideoPrompt(menuItems = [], frameCount = 0) {
  return `${buildScreeningPrompt(menuItems)}

These are ${frameCount} still frames sampled (~1 per second) from a short serving video.
Treat them together as ONE scene and return a single JSON object describing what the video shows overall.`;
}
