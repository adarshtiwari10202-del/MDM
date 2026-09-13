// ============================================================
// Gemini prompt builder — returns strict JSON, observes only.
// Also extracts the GPS Map Camera stamp (lat/lng + date-time) that
// is burned into the photos, so geo + timing checks work from the image.
// ============================================================

export function buildScreeningPrompt(menuItems = []) {
  const menu = menuItems.length ? menuItems.join(', ') : '(not provided)';
  return `You are screening a photograph from a school Mid-Day Meal (PM POSHAN) programme in Uttar Pradesh, India.
Today's prescribed menu is: ${menu}.  (When a menu item shows alternatives separated by "/", any one of them counts.)

Look at the photograph and report ONLY what is visibly present. Do not guess quantity, nutrition, or quality.

Many of these photos carry a GPS Map Camera style stamp overlay — usually a band showing an address, latitude, longitude, and a date/time. If such a stamp is visible, read it exactly and return the numeric latitude/longitude and the timestamp. If there is no such stamp, use null for those fields.

Return STRICT JSON only, no prose, no markdown, with exactly this shape:
{
  "scene_type": "cooked_meal_in_vessel | serving | children_eating | cooking | other",
  "food_present": true/false,
  "dishes_visible": ["..."],
  "menu_items_present": { "<each menu item>": true/false },
  "children_eating": true/false/null,
  "cooking_in_progress": true/false/null,
  "gps_lat": number or null,
  "gps_lng": number or null,
  "stamp_datetime": "the date-time text from the stamp, or null",
  "stamp_place": "the address/place text from the stamp, or null",
  "notes": "one or two short factual sentences about what is visible"
}
Use null for children_eating / cooking_in_progress if the photo does not show that scene.
Common Indian dishes to recognise: rice, dal, khichdi, tehri, roti, chapati, sabzi, aloo, potato, kadhi, egg, banana, milk, poha, soya badi, soybean, bajra, moong.`;
}

// For a video, we send several sampled frames and ask for one combined reading.
export function buildVideoPrompt(menuItems = [], frameCount = 0) {
  return `${buildScreeningPrompt(menuItems)}

These are ${frameCount} still frames sampled (~1 per second) from a short serving video.
Treat them together as ONE scene and return a single JSON object describing what the video shows overall.`;
}
