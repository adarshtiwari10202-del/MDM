// Minimal zero-dependency test runner for the flag engine.
import { evaluateSubmission } from '../flagRules.js';
import { SAMPLE_SUBMISSIONS } from '../sampleData/submissions.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}
const byId = (id) => SAMPLE_SUBMISSIONS.find((s) => s.id === id);
const codes = (r) => r.flags.map((f) => f.code);

console.log('\nFlag engine tests\n');

const r1 = evaluateSubmission(byId('S-0001'));
check('S-0001 clean submission has no flags', r1.flags.length === 0);
check('S-0001 severity ok', r1.severity === 'ok');

const r2 = evaluateSubmission(byId('S-0002'));
check('S-0002 flags missing menu item (sabzi)', codes(r2).includes('menu_missing'));
check('S-0002 severity red (menu_missing)', r2.severity === 'red');

const r3 = evaluateSubmission(byId('S-0003'));
check('S-0003 flags staged burst', codes(r3).includes('staged_burst'));
check('S-0003 flags geo mismatch', codes(r3).includes('geo_mismatch'));
check('S-0003 flags duplicate media', codes(r3).includes('duplicate_media'));
check('S-0003 flags outside meal window (09:50)', codes(r3).includes('outside_meal_window'));

const r4 = evaluateSubmission(byId('S-0004'));
check('S-0004 flags missing video item', codes(r4).includes('items_missing'));
check('S-0004 severity red (incomplete)', r4.severity === 'red');

// Ranking: worst submissions should score higher than clean ones.
check('clean submission scores 0', r1.score === 0);
check('flagged submissions outrank clean', r2.score > r1.score && r3.score > r1.score);

// --- menu alternatives, categories, geo consistency (new logic) ---
const mkFiles = (cookedAi, extra = {}) => ({
  cooking: { ai: { scene_type: 'cooking', cooking_in_progress: true } },
  cooked_meal: { ai: { scene_type: 'cooked_meal_in_vessel', food_present: true, ...cookedAi } },
  serving_video: { ai: { scene_type: 'serving', food_present: true } },
  plate: { ai: { scene_type: 'served_plate', food_present: true } },
  ...extra,
});
const base = (menu, files) => ({ school: { udise: 'x' }, date: '2026-09-13', menu, files });

// Friday-style alternative satisfied by khichdi
const alt1 = evaluateSubmission(base([{ anyOf: ['tehri', 'khichdi'] }, 'sabzi'],
  mkFiles({ dishes_visible: ['khichdi', 'sabzi'] })));
check('anyOf satisfied by khichdi → no menu_missing', !codes(alt1).includes('menu_missing'));

// Alternative NOT satisfied
const alt2 = evaluateSubmission(base([{ anyOf: ['tehri', 'khichdi'] }],
  mkFiles({ dishes_visible: ['rice'] })));
check('anyOf unmet → menu_missing tehri/khichdi', codes(alt2).includes('menu_missing') &&
  alt2.flags.find((f) => f.code === 'menu_missing').message.includes('tehri/khichdi'));

// Category: banana satisfies "fruit"
const cat = evaluateSubmission(base(['fruit'], mkFiles({ dishes_visible: ['banana'] })));
check('banana satisfies fruit category', !codes(cat).includes('menu_missing'));

// Geo consistency: two photos 500m+ apart
const geo = evaluateSubmission(base(['rice'], mkFiles({ dishes_visible: ['rice'] }, {
  cooking: { location: { lat: 27.5, lng: 80.7 }, ai: {} },
  cooked_meal: { location: { lat: 27.51, lng: 80.71 }, ai: { food_present: true, dishes_visible: ['rice'] } },
})));
check('photos far apart → geo_inconsistent', codes(geo).includes('geo_inconsistent'));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
