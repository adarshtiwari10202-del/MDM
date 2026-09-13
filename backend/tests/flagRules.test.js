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
check('S-0002 flags children not eating', codes(r2).includes('no_children_eating'));
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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
