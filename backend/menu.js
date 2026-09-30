// ============================================================
// Block weekly menu — PM POSHAN (MDM) prescribed rotation.
// Source: official "पी०एम० पोषण योजना साप्ताहिक आहार तालिका" for the pilot block.
//
// A day's menu is a list of REQUIREMENTS. Each requirement is either:
//   • a dish string           -> must be visibly present
//   • { anyOf: [...] }         -> satisfied if ANY listed dish is present
// Dish categories (fruit, milk, sabzi, dal) let a specific item satisfy a
// generic requirement (e.g. a banana satisfies "fruit").
// ============================================================

// day index: 0=Sun .. 6=Sat  (IST weekday of the meal date)
// "Dal-yukt sabzi" (dal + vegetable, served together) is treated as ONE
// requirement satisfied when EITHER dal OR sabzi (or both) is visible — it is
// flagged only when NEITHER appears. It is written as { anyOf: ['dal','sabzi'] }
// on every day that prescribes dal-with-sabzi (Tue, Thu, Sat).
export const WEEKLY_MENU = {
  0: [], // Sunday — no school meal
  1: ['roti', 'sabzi', 'fruit'],                        // Mon: roti + soya-badi seasonal sabzi + fresh fruit
  2: ['rice', { anyOf: ['dal', 'sabzi'] }],             // Tue: rice + dal-yukt sabzi (dal OR sabzi)
  3: ['tehri', 'milk'],                                 // Wed: veg + soya-badi tehri + hot boiled milk (mandatory)
  4: ['roti', { anyOf: ['dal', 'sabzi'] }],             // Thu: roti + dal-yukt sabzi (dal OR sabzi)
  5: [{ anyOf: ['tehri', 'khichdi'] }, 'sabzi'],        // Fri: veg+soya tehri  OR  bajra+moong khichdi (+ seasonal veg)
  6: ['rice', { anyOf: ['dal', 'sabzi'] }],             // Sat: rice + dal-yukt sabzi (dal OR sabzi)
};

// Wednesday additionally mandates hot boiled milk with the meal (already listed).
// Optional per-school overrides: { '<udise>': { 1:[...], ... } }
export const SCHOOL_OVERRIDES = {};

// A generic requirement is satisfied by any of its member dishes.
export const DISH_CATEGORIES = {
  fruit: ['fruit', 'banana', 'apple', 'guava', 'orange', 'papaya', 'mango'],
  milk: ['milk', 'doodh'],
  sabzi: ['sabzi', 'vegetable', 'mixed vegetable', 'potato', 'aloo'],
  dal: ['dal', 'arhar', 'chana', 'moong', 'toor'],
};

/** IST weekday (0=Sun..6=Sat) for a 'YYYY-MM-DD' date. */
function istWeekday(dateISO) {
  const d = new Date(`${dateISO}T12:00:00+05:30`);
  return d.getUTCDay();
}

/** Structured menu requirements for a school on a given date. */
export function getMenu(dateISO, udise) {
  if (!dateISO) return [];
  const wd = istWeekday(dateISO);
  const override = udise && SCHOOL_OVERRIDES[udise];
  const table = override || WEEKLY_MENU;
  return (table[wd] || []).map((it) => (typeof it === 'string' ? it : { ...it }));
}

/** Human/prompt-friendly flat dish list, alternatives joined with "/". */
export function menuDishList(items) {
  return (items || []).map((it) => (typeof it === 'string' ? it : (it.anyOf || []).join('/')));
}

/** True once a real menu is configured. */
export function menuConfigured() {
  return Object.values(WEEKLY_MENU).some((a) => a.length > 0);
}
