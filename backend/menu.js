// ============================================================
// Block weekly menu (the source of truth for menu-compliance).
// UP MDM menus run on a fixed weekly rotation, usually block-wide.
// Fill WEEKLY_MENU with the real Khairabad rotation. Until then,
// getMenu() returns [] and the menu_missing check is simply skipped.
//
// Per-school overrides can go in SCHOOL_OVERRIDES[udise] later.
// ============================================================

// day index: 0=Sun .. 6=Sat  (IST weekday of the meal date)
export const WEEKLY_MENU = {
  0: [], // Sunday (usually no school meal)
  1: [], // Monday      e.g. ['rice','dal','sabzi']
  2: [], // Tuesday
  3: [], // Wednesday
  4: [], // Thursday
  5: [], // Friday
  6: [], // Saturday
};

// Optional per-school overrides: { '<udise>': { 1:[...], 2:[...], ... } }
export const SCHOOL_OVERRIDES = {};

/** IST weekday (0=Sun..6=Sat) for a 'YYYY-MM-DD' date. */
function istWeekday(dateISO) {
  // Treat the date as IST midday to avoid TZ edge flips.
  const d = new Date(`${dateISO}T12:00:00+05:30`);
  return d.getUTCDay();
}

/** Prescribed menu for a school on a given date. */
export function getMenu(dateISO, udise) {
  if (!dateISO) return [];
  const wd = istWeekday(dateISO);
  const override = udise && SCHOOL_OVERRIDES[udise];
  const table = override || WEEKLY_MENU;
  return (table[wd] || []).slice();
}

/** True once a real menu has been configured (any non-empty day). */
export function menuConfigured() {
  return Object.values(WEEKLY_MENU).some((a) => a.length > 0);
}
