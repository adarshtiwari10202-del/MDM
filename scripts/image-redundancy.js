// ============================================================
// Do the cooking photo and the cooked-meal photo carry DIFFERENT information,
// or are they effectively the same picture twice? Read-only analysis over the
// stored AI readings. Writes reports/image_redundancy.json.
// ============================================================
import { readResults } from '../backend/store.js';
import fs from 'node:fs';
import path from 'node:path';

const g = (o, ...keys) => { for (const k of keys) if (o && o[k] != null && o[k] !== '') return o[k]; return undefined; };
const tally = (m, v) => { if (v === undefined) return; const k = String(v); m[k] = (m[k] || 0) + 1; };
const dishesOf = (ai, ...keys) => {
  const out = new Set();
  for (const k of keys) { const a = ai && ai[k]; if (Array.isArray(a)) a.forEach((d) => { const s = String(d || '').trim().toLowerCase(); if (s) out.add(s); }); }
  return out;
};
const jacc = (a, b) => { if (!a.size && !b.size) return null; const inter = [...a].filter((x) => b.has(x)).length; const uni = new Set([...a, ...b]).size; return uni ? inter / uni : null; };

async function main() {
  const rows = await readResults();
  let both = 0;
  const cookScene = {}, cookedScene = {};
  const cookingInProgress = {}, heatSource = {}, kitchenVisible = {}, personCooking = {}, kitchenClean = {};
  const cookQuality = {}, cookedQuality = {};
  const freshlyCooked = {}, fillLevel = {};
  let dishIdentical = 0, dishComparable = 0, jSum = 0, jN = 0;
  let cookAddsDish = 0, cookedAddsDish = 0;
  let kitchenDirty = 0, cookedCouldSeeDirty = 0;
  const cookFieldPresent = {}, cookedFieldPresent = {};

  for (const r of rows) {
    const c = r.files?.cooking?.ai, m = r.files?.cooked_meal?.ai;
    if (!c || typeof c !== 'object' || !m || typeof m !== 'object') continue;
    both++;
    // which scene each image actually shows (the core redundancy test)
    tally(cookScene, g(c, 'observed_scene', 'scene_type'));
    tally(cookedScene, g(m, 'observed_scene', 'scene_type'));
    // cooking-specific unique signals
    tally(cookingInProgress, g(c, 'cooking_in_progress'));
    tally(heatSource, g(c, 'heat_source'));
    tally(kitchenVisible, g(c, 'kitchen_visible_in_frame'));
    tally(personCooking, g(c, 'person_cooking_present'));
    tally(kitchenClean, g(c, 'kitchen_cleanliness'));
    tally(cookQuality, g(c, 'image_quality'));
    // cooked-specific unique signals
    tally(cookedQuality, g(m, 'image_quality'));
    tally(freshlyCooked, g(m, 'appears_freshly_cooked'));
    tally(fillLevel, g(m, 'cookware_fill_level'));
    // track which key names actually exist (schema probe)
    for (const k of Object.keys(c)) cookFieldPresent[k] = (cookFieldPresent[k] || 0) + 1;
    for (const k of Object.keys(m)) cookedFieldPresent[k] = (cookedFieldPresent[k] || 0) + 1;
    // hygiene uniqueness: cooking says dirty — would we have known otherwise?
    if (g(c, 'kitchen_cleanliness') === 'dirty') { kitchenDirty++; if (g(m, 'area_cleanliness') !== 'dirty') cookedCouldSeeDirty++; }
    // dish overlap
    const cd = dishesOf(c, 'dishes_being_cooked', 'dishes_visible');
    const md = dishesOf(m, 'dishes_visible', 'dishes_being_cooked');
    if (cd.size || md.size) {
      dishComparable++;
      const j = jacc(cd, md); if (j != null) { jSum += j; jN++; }
      if ([...cd].sort().join('|') === [...md].sort().join('|')) dishIdentical++;
      if ([...cd].some((x) => !md.has(x))) cookAddsDish++;
      if ([...md].some((x) => !cd.has(x))) cookedAddsDish++;
    }
  }

  const pct = (n) => both ? Math.round((100 * n) / both) + '%' : '0%';
  const out = {
    generated_at: new Date().toISOString(),
    rowsWithBothReadings: both,
    cookingImage_observedScene: cookScene,
    cookedMealImage_observedScene: cookedScene,
    cookingInProgress, heatSource, kitchenVisible, personCooking, kitchenCleanliness: kitchenClean,
    cookingImageQuality: cookQuality, cookedImageQuality: cookedQuality,
    appearsFreshlyCooked: freshlyCooked, cookwareFillLevel: fillLevel,
    dishComparableRows: dishComparable,
    dishIdenticalSets: dishIdentical, dishIdenticalPct: dishComparable ? Math.round(100 * dishIdentical / dishComparable) + '%' : '—',
    avgDishJaccard: jN ? Number((jSum / jN).toFixed(2)) : null,
    cookingAddsADishNotInCooked: cookAddsDish, cookedAddsADishNotInCooking: cookedAddsDish,
    kitchenDirtyFlags: kitchenDirty, kitchenDirtyUniqueToCookingImage: cookedCouldSeeDirty,
    cookFieldPresent, cookedFieldPresent,
  };
  const dir = path.join(process.cwd(), 'reports'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'image_redundancy.json'), JSON.stringify(out, null, 2));

  console.log(`rows with BOTH cooking + cooked-meal AI readings: ${both}`);
  console.log('\ncooking-image observed_scene:', JSON.stringify(cookScene));
  console.log('cooked-image  observed_scene:', JSON.stringify(cookedScene));
  console.log('\ncooking_in_progress (cooking img):', JSON.stringify(cookingInProgress));
  console.log('heat_source:', JSON.stringify(heatSource), ' kitchen_visible:', JSON.stringify(kitchenVisible), ' person_cooking:', JSON.stringify(personCooking));
  console.log('kitchen_cleanliness:', JSON.stringify(kitchenClean));
  console.log('cookware_fill_level (cooked img):', JSON.stringify(fillLevel), ' appears_freshly_cooked:', JSON.stringify(freshlyCooked));
  console.log(`\ndish sets identical: ${dishIdentical}/${dishComparable} (${out.dishIdenticalPct}), avg Jaccard ${out.avgDishJaccard}`);
  console.log(`cooking adds a dish cooked-img missed: ${cookAddsDish}; cooked adds one cooking missed: ${cookedAddsDish}`);
  console.log(`kitchen 'dirty' flags from cooking img: ${kitchenDirty} (unique — cooked img didn't call area dirty: ${cookedCouldSeeDirty})`);
  console.log('\ncooking-img fields present:', Object.keys(cookFieldPresent).join(', '));
  console.log('cooked-img  fields present:', Object.keys(cookedFieldPresent).join(', '));
}
main().catch((e) => { console.error('FAILED', e); process.exit(1); });
