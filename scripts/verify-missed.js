// ============================================================
// High-stakes verification for the "missed reporting" list (read-only).
// Independently re-derives who reported on each target day by TWO methods and
// cross-checks them, so no school that actually reported can be wrongly listed:
//   1. by Google submission TIMESTAMP date (the authoritative method)
//   2. by the manually-typed "Today's Date" column (independent method)
// It also surfaces the mis-attribution risks:
//   • rows on a target day whose UDISE could NOT be parsed (orphans)
//   • rows whose parsed UDISE is not in the 195-school roster
//   • schools "missed" by the timestamp method but PRESENT by the manual date
// Finally it recomputes the missed set + md5 and compares to the committed JSON.
// Needs: GOOGLE_SERVICE_ACCOUNT_JSON, DAILY_SHEET_ID (+ Sheet1 roster).
// ============================================================
import crypto from 'node:crypto';
import fs from 'node:fs';
import { readRoster } from '../backend/roster.js';
import { readSheet } from '../backend/sheets.js';
import { resolveColumns, toISODate, toISODateTime } from '../backend/parse.js';

const norm = (u) => String(u || '').trim();
const udiseFrom = (s) => { const m = String(s || '').match(/\b(\d{8,15})\b/); return m ? m[1] : ''; };
const DAYS = (process.env.DAYS ? process.env.DAYS.split(',').map((s) => s.trim()) : ['2026-09-29', '2026-09-30', '2026-10-01']);

async function main() {
  const roster = await readRoster();
  const rosterSet = new Set(roster.map((s) => norm(s.udise)));
  const nameByUdise = new Map(roster.map((s) => [norm(s.udise), s.name]));
  const { headers, rows } = await readSheet(process.env.DAILY_SHEET_ID, process.env.DAILY_SHEET_TAB || 'Form Responses 1');
  const cols = resolveColumns(headers, { udise: ['udise'], school: ['school name'], timestamp: ['timestamp'], date: ["today's date", 'today date', 'date'] });
  console.log(`[src] rows=${rows.length}  roster=${roster.length}  days=${DAYS.join(', ')}`);
  console.log(`[src] cols → udise:${JSON.stringify(cols.udise)} school:${JSON.stringify(cols.school)} ts:${JSON.stringify(cols.timestamp)} date:${JSON.stringify(cols.date)}`);

  const byTs = new Map();      // udise -> Set(day)   via timestamp date
  const byManual = new Map();  // udise -> Set(day)   via typed "Today's date"
  const orphans = [];          // rows on a target day with no parseable UDISE
  const nonRoster = new Map(); // udise(not in roster) -> Set(day)
  const add = (map, u, d) => (map.get(u) || map.set(u, new Set()).get(u)).add(d);

  for (const r of rows) {
    const tsDay = cols.timestamp ? (toISODateTime(r[cols.timestamp]) || '').slice(0, 10) : '';
    const manDay = cols.date ? (toISODate(r[cols.date]) || '') : '';
    const onTs = DAYS.includes(tsDay);
    const onMan = DAYS.includes(manDay);
    if (!onTs && !onMan) continue; // irrelevant row

    let u = norm(cols.udise ? r[cols.udise] : '');
    if (!/^\d{6,}$/.test(u)) u = udiseFrom(cols.school ? r[cols.school] : '');
    const schoolText = String(cols.school ? r[cols.school] : '').trim();

    if (!/^\d{6,}$/.test(u)) {           // UDISE did not parse → orphan (only for target-day rows)
      orphans.push({ day: onTs ? tsDay : manDay, schoolText, tsDay, manDay });
      continue;
    }
    if (onTs) add(byTs, u, tsDay);
    if (onMan) add(byManual, u, manDay);
    if (!rosterSet.has(u)) { if (onTs) add(nonRoster, u, tsDay); if (onMan) add(nonRoster, u, manDay); }
  }

  // Per-day distinct counts by each method
  console.log('\n[per-day] distinct roster schools reporting:');
  for (const d of DAYS) {
    const ts = [...byTs.entries()].filter(([u, s]) => rosterSet.has(u) && s.has(d)).length;
    const mn = [...byManual.entries()].filter(([u, s]) => rosterSet.has(u) && s.has(d)).length;
    console.log(`   ${d}:  by-timestamp ${ts}   by-manual-date ${mn}`);
  }

  // Missed by each method (roster schools without all three days)
  const missedBy = (map) => roster.filter((s) => { const set = map.get(norm(s.udise)) || new Set(); return DAYS.some((d) => !set.has(d)); }).map((s) => norm(s.udise));
  const missedTs = new Set(missedBy(byTs));
  const missedMan = new Set(missedBy(byManual));

  // Schools missed by timestamp but PRESENT (all 3) by manual date — the risk set
  const riskTsOnly = [...missedTs].filter((u) => !missedMan.has(u));
  const riskManOnly = [...missedMan].filter((u) => !missedTs.has(u));

  console.log(`\n[missed] by timestamp: ${missedTs.size}   by manual-date: ${missedMan.size}`);
  console.log(`[cross-check] missed by TIMESTAMP but complete by MANUAL date: ${riskTsOnly.length}`);
  riskTsOnly.forEach((u) => console.log(`   ⚠ ${u}  ${nameByUdise.get(u) || ''}`));
  console.log(`[cross-check] missed by MANUAL date but complete by TIMESTAMP: ${riskManOnly.length}`);
  riskManOnly.forEach((u) => console.log(`   ℹ ${u}  ${nameByUdise.get(u) || ''}`));

  // Orphans (target-day rows whose UDISE could not be parsed) — manual eyeball
  console.log(`\n[orphans] target-day rows with UNPARSEABLE UDISE: ${orphans.length}`);
  orphans.forEach((o) => console.log(`   day=${o.day}  "${o.schoolText}"`));

  // Submissions from a UDISE not in the roster (shouldn't normally happen)
  console.log(`\n[non-roster] UDISEs that submitted on a target day but are NOT in roster: ${nonRoster.size}`);
  [...nonRoster.entries()].forEach(([u, s]) => console.log(`   ${u}  days=${[...s].join(',')}`));

  // Detail dump for the risk set (missed-by-timestamp but complete-by-manual):
  // show every row for those UDISEs so a human can judge midnight/late cases.
  const riskSet = new Set(riskTsOnly);
  if (riskSet.size) {
    console.log('\n[detail] every submission for the ⚠ timestamp-vs-manual risk schools:');
    for (const r of rows) {
      let u = norm(cols.udise ? r[cols.udise] : '');
      if (!/^\d{6,}$/.test(u)) u = udiseFrom(cols.school ? r[cols.school] : '');
      if (!riskSet.has(u)) continue;
      const tsFull = cols.timestamp ? toISODateTime(r[cols.timestamp]) : '';
      const man = cols.date ? toISODate(r[cols.date]) : '';
      console.log(`   ${u}  ts=${tsFull || '(none)'}  typedDate=${man || '(none)'}  school="${String(cols.school ? r[cols.school] : '').trim()}"`);
    }
  }

  // Recompute authoritative md5 (timestamp method, missedDays per school) and compare to committed JSON
  const missedList = roster
    .map((s) => { const set = byTs.get(norm(s.udise)) || new Set(); return { udise: norm(s.udise), missedDays: DAYS.filter((d) => !set.has(d)) }; })
    .filter((m) => m.missedDays.length)
    .sort((a, b) => (nameByUdise.get(a.udise) || '').localeCompare(nameByUdise.get(b.udise) || ''));
  const canonical = missedList.map((m) => `${m.udise}:${m.missedDays.join(',')}`).join('|');
  const md5 = crypto.createHash('md5').update(canonical).digest('hex');
  console.log(`\n[verify] recomputed missed=${missedList.length}  md5=${md5}`);
  try {
    const j = JSON.parse(fs.readFileSync('reports/missed3days.json', 'utf8'));
    console.log(`[verify] committed  missed=${j.missedCount}  md5=${j.md5}`);
    console.log(`[verify] MATCH: ${j.md5 === md5 && j.missedCount === missedList.length ? 'YES ✅' : 'NO ❌'}`);
  } catch (e) { console.log('[verify] could not read reports/missed3days.json:', e.message); }
}

main().catch((e) => { console.error('[verify-missed] FAILED:', e); process.exit(1); });
