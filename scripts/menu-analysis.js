// ============================================================
// Menu-vs-reality analysis (read-only). For each reporting day in the results
// store it shows:
//   • the prescribed menu components for that weekday
//   • how many submissions had each component present / absent / unclear
//   • the dishes the AI ACTUALLY observed most often that day (to spot menu
//     mismatches so the prescribed menu can be corrected)
// Presence logic mirrors the flag engine (dishes_visible + menu_items_present,
// with dish categories/synonyms). No AI calls, no writes.
// Needs: GOOGLE_SERVICE_ACCOUNT_JSON, RESULTS_SHEET_ID, RESULTS_SHEET_TAB.
// ============================================================
import { readResults } from '../backend/store.js';
import { getMenu, menuDishList, DISH_CATEGORIES } from '../backend/menu.js';

const DISH_SYNONYMS = { chapati: 'roti', chapatti: 'roti', aloo: 'potato', potato: 'potato', 'boiled egg': 'egg' };
const normDish = (s) => { const k = String(s || '').trim().toLowerCase(); return DISH_SYNONYMS[k] || k; };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const istWeekday = (d) => new Date(`${d}T12:00:00+05:30`).getUTCDay();
const hasAI = (f) => { const a = f && f.ai; return !!(a && typeof a === 'object' && (a.scene_type || (a.dishes_visible && a.dishes_visible.length) || a.menu_items_present || a.food_present != null)); };

const SABZI_RE = /sab[zj]i|bhaji/;
const addSeen = (seen, raw) => { const nd = normDish(raw); seen.add(nd); if (SABZI_RE.test(nd)) seen.add('sabzi'); };
function gatherSeen(row, keys) {
  const seen = new Set();
  for (const k of keys) {
    const ai = row.files?.[k]?.ai; if (!ai) continue;
    (ai.dishes_visible || []).forEach((d) => addSeen(seen, d));
    if (ai.menu_items_present) for (const [it, v] of Object.entries(ai.menu_items_present)) if (v === true) addSeen(seen, it);
  }
  return seen;
}
function gatherMip(row, keys) {
  const mip = {};
  for (const k of keys) {
    const m = row.files?.[k]?.ai?.menu_items_present; if (!m) continue;
    for (const [it, v] of Object.entries(m)) { const nd = normDish(it); if (v === true) mip[nd] = true; else if (v === false && mip[nd] !== true) mip[nd] = false; }
  }
  return mip;
}
const dishSeenIn = (seen, nd) => seen.has(nd) || !!(DISH_CATEGORIES[nd] && DISH_CATEGORIES[nd].some((m) => seen.has(m)));
const itemLabel = (it) => (typeof it === 'string' ? it : (it.anyOf || []).join('/'));

// present / absent / unclear for one menu item in one submission.
function status(item, seen, mip) {
  const names = typeof item === 'string' ? [item] : (item.anyOf || []);
  if (names.some((n) => dishSeenIn(seen, normDish(n)))) return 'present';
  if (names.length && names.every((n) => mip[normDish(n)] === false)) return 'absent';
  return 'unclear';
}

async function main() {
  const rows = await readResults();
  const withAI = rows.filter((r) => hasAI(r.files?.cooked_meal) || hasAI(r.files?.plate) || hasAI(r.files?.serving_video) || hasAI(r.files?.cooking));
  const dates = [...new Set(rows.map((r) => r.date).filter(Boolean))].sort();
  console.log(`[menu] ${rows.length} stored rows, ${withAI.length} with AI readings, ${dates.length} dates`);

  for (const date of dates) {
    const dayRows = withAI.filter((r) => r.date === date);
    if (!dayRows.length) { console.log(`\n=== ${date} (${WD[istWeekday(date)]}) — no AI submissions ===`); continue; }
    const menu = getMenu(date);
    const labels = menuDishList(menu);
    console.log(`\n=== ${date} (${WD[istWeekday(date)]}) — ${dayRows.length} submissions — prescribed: ${labels.join(', ') || '(none)'} ===`);

    // component presence — a dish counts as present if visible in ANY of the
    // four media (cooking photo, cooked-meal pot, serving video, or plate),
    // matching the flag engine.
    const STAGES = ['cooking', 'cooked_meal', 'serving_video', 'plate'];
    for (const item of menu) {
      let p = 0, a = 0, u = 0;
      for (const r of dayRows) {
        const seen = gatherSeen(r, STAGES);
        const mip = gatherMip(r, STAGES);
        const s = status(item, seen, mip);
        if (s === 'present') p++; else if (s === 'absent') a++; else u++;
      }
      const pct = (n) => `${n} (${Math.round((n / dayRows.length) * 100)}%)`;
      console.log(`   ${itemLabel(item).padEnd(14)} present ${pct(p).padEnd(10)}  absent ${pct(a).padEnd(10)}  unclear ${pct(u)}`);
    }

    // observed dishes (what AI actually saw), distinct per submission
    const freq = new Map();
    for (const r of dayRows) {
      const seen = gatherSeen(r, ['cooked_meal', 'plate', 'serving_video']);
      for (const nd of seen) freq.set(nd, (freq.get(nd) || 0) + 1);
    }
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    console.log(`   observed dishes (top): ${top.map(([d, n]) => `${d}:${n}`).join('  ')}`);
  }
}

main().catch((e) => { console.error('[menu] FAILED:', e); process.exit(1); });
