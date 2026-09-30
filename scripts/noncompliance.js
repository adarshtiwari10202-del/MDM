// ============================================================
// Daily-reporting non-compliance lists (read-only).
//   Reporting days = distinct dates the block actually reported on, grouped by
//   the Google submission TIMESTAMP (source of truth; manual date is unreliable).
//   List 1: schools that have NOT submitted a single day.
//   List 2: schools that submitted at least once but MISSED > 50% of reporting days.
// Both are roster-based (the 195 expected schools) and disjoint.
// Needs: GOOGLE_SERVICE_ACCOUNT_JSON, DAILY_SHEET_ID (+ Sheet1 roster).
// ============================================================
import { readRoster } from '../backend/roster.js';
import { readSheet } from '../backend/sheets.js';
import { resolveColumns, toISODate, toISODateTime, effectiveDate } from '../backend/parse.js';

const norm = (u) => String(u || '').trim();
const udiseFrom = (s) => { const m = String(s || '').match(/\b(\d{8,15})\b/); return m ? m[1] : ''; };

async function main() {
  const roster = await readRoster();
  const { headers, rows } = await readSheet(process.env.DAILY_SHEET_ID, process.env.DAILY_SHEET_TAB || 'Form Responses 1');
  const cols = resolveColumns(headers, {
    udise: ['udise'], school: ['school name'], timestamp: ['timestamp'],
    date: ["today's date", 'today date', 'date'],
  });

  // ---- SOURCE DIAGNOSTICS (prove this is the daily reporting Google Form) ----
  console.log(`[src] DAILY_SHEET_ID(last6)=…${String(process.env.DAILY_SHEET_ID || '').slice(-6)}  tab="${process.env.DAILY_SHEET_TAB || 'Form Responses 1'}"  total response rows=${rows.length}`);
  console.log('[src] daily-form columns detected:');
  headers.forEach((h, i) => console.log(`      [${i}] ${h}`));
  console.log(`[src] resolved → udise:${JSON.stringify(cols.udise)}  school:${JSON.stringify(cols.school)}  date:${JSON.stringify(cols.date)}  timestamp:${JSON.stringify(cols.timestamp)}`);

  // Optional window so an in-progress day (or rollout days) can be excluded.
  const DMIN = process.env.DATE_MIN || null; // inclusive lower bound
  const DMAX = process.env.DATE_MAX || null; // inclusive upper bound
  const allDates = new Set();
  const byUdise = new Map(); // udise -> Set(date)
  for (const r of rows) {
    const eff = effectiveDate(cols.date ? toISODate(r[cols.date]) : null,
                              cols.timestamp ? toISODateTime(r[cols.timestamp]) : null);
    if (!eff.date) continue;
    if (DMIN && eff.date < DMIN) continue;
    if (DMAX && eff.date > DMAX) continue;
    allDates.add(eff.date);
    let u = norm(cols.udise ? r[cols.udise] : '');
    if (!/^\d{6,}$/.test(u)) u = udiseFrom(cols.school ? r[cols.school] : '');
    if (!/^\d{6,}$/.test(u)) continue;
    (byUdise.get(u) || byUdise.set(u, new Set()).get(u)).add(eff.date);
  }

  const days = [...allDates].sort();
  const total = days.length;
  console.log(`[noncompliance] roster=${roster.length}  reporting days=${total}: ${days.join(', ')}`);

  const rowsOut = roster.map((s) => {
    const sub = (byUdise.get(norm(s.udise)) || new Set()).size;
    return { udise: norm(s.udise), name: s.name, sub, missed: total - sub };
  });

  const never = rowsOut.filter((r) => r.sub === 0).sort((a, b) => a.name.localeCompare(b.name));
  // "> 50% missed" AND submitted at least once (disjoint from `never`).
  const under50 = rowsOut.filter((r) => r.sub > 0 && r.sub * 2 < total)
    .sort((a, b) => a.sub - b.sub || a.name.localeCompare(b.name));

  console.log(`\n===== LIST 1 — NEVER submitted the daily form (${never.length}) =====`);
  never.forEach((r, i) => console.log(`${String(i + 1).padStart(3)}. ${r.udise}  ${r.name}`));

  console.log(`\n===== LIST 2 — submitted but MISSED > 50% of ${total} days (${under50.length}) =====`);
  under50.forEach((r, i) => console.log(`${String(i + 1).padStart(3)}. ${r.udise}  ${r.name}  (submitted ${r.sub}/${total}, missed ${r.missed})`));

  // Reference distribution.
  const buckets = { '0': 0, '1-25%': 0, '25-50%': 0, '50-75%': 0, '75-99%': 0, '100%': 0 };
  for (const r of rowsOut) {
    const p = total ? r.sub / total : 0;
    if (r.sub === 0) buckets['0']++;
    else if (p < 0.25) buckets['1-25%']++;
    else if (p < 0.5) buckets['25-50%']++;
    else if (p < 0.75) buckets['50-75%']++;
    else if (p < 1) buckets['75-99%']++;
    else buckets['100%']++;
  }
  console.log('\n[noncompliance] submission-rate distribution (of days present):');
  for (const [k, v] of Object.entries(buckets)) console.log(`   ${k.padEnd(8)} ${v}`);

  // --- List 3: recently gone silent — no report in the last RECENT reporting days ---
  const RECENT = Math.max(1, Number(process.env.RECENT_DAYS || 4));
  const recentDays = days.slice(-RECENT);
  const priorDays = days.slice(0, -RECENT);
  const hasAny = (set, ds) => ds.some((d) => set.has(d));
  const silentAll = [], droppedOff = [];
  for (const s of roster) {
    const set = byUdise.get(norm(s.udise)) || new Set();
    if (hasAny(set, recentDays)) continue; // reported recently → not silent
    const rec = { udise: norm(s.udise), name: s.name, everBefore: hasAny(set, priorDays), sub: set.size };
    silentAll.push(rec);
    if (rec.everBefore) droppedOff.push(rec);
  }
  droppedOff.sort((a, b) => a.name.localeCompare(b.name));
  console.log(`\n[noncompliance] recent window (last ${RECENT} reporting days): ${recentDays.join(', ')}`);
  console.log(`\n===== LIST 3 — RECENTLY GONE SILENT: reported earlier but NOT in last ${RECENT} days (${droppedOff.length}) =====`);
  droppedOff.forEach((r, i) => console.log(`${String(i + 1).padStart(3)}. ${r.udise}  ${r.name}  (last active before ${recentDays[0]}, ${r.sub} days total)`));
  console.log(`\n[noncompliance] (schools with no report in last ${RECENT} days, INCLUDING never-submitted: ${silentAll.length})`);

  // ---- HIGH-STAKES VERIFICATION: raw-scan the daily form for every "never" school ----
  // If a school appears anywhere in the raw rows (by UDISE digits or name), it may
  // have submitted under a variant and should NOT be on the never list.
  const digits = (s) => String(s || '').replace(/\D/g, '');
  const rowsText = rows.map((r) => Object.entries(r).filter(([k]) => k !== '__rowIndex').map(([, v]) => String(v ?? '')).join(' | '));
  console.log('\n===== VERIFY — raw scan of daily form for each NEVER-reported school =====');
  let flagged = 0;
  for (const r of never) {
    const nameTok = String(r.name).split('(')[0].trim().toUpperCase();
    const udiseHits = [], nameHits = [];
    rowsText.forEach((t, i) => {
      if (t.includes(r.udise) || digits(t).includes(r.udise)) udiseHits.push(i);
      if (nameTok && t.toUpperCase().includes(nameTok)) nameHits.push(i);
    });
    if (udiseHits.length || nameHits.length) {
      flagged++;
      console.log(`  ⚠ ${r.udise} ${r.name} → UDISE hits:${udiseHits.length} NAME("${nameTok}") hits:${nameHits.length}`);
      [...new Set([...udiseHits, ...nameHits])].slice(0, 3).forEach((i) => console.log(`       row: ${rowsText[i].slice(0, 160)}`));
    }
  }
  console.log(flagged
    ? `  ⚠ ${flagged} never-reported school(s) DID appear in raw rows — review before sending.`
    : '  ✓ none of the never-reported schools appear anywhere in the daily form (by UDISE or name). List is clean.');

  // ---- CHECK_DATE scan: who submitted on a date OUTSIDE the window (e.g. today) ----
  // A school that filed on CHECK_DATE should not be called "never reported" or
  // "recently stopped", even if it had nothing inside the 18–29 window.
  const CHECK = process.env.CHECK_DATE || '2026-09-30';
  const subCheck = new Set();
  for (const r of rows) {
    const eff = effectiveDate(cols.date ? toISODate(r[cols.date]) : null,
                              cols.timestamp ? toISODateTime(r[cols.timestamp]) : null);
    if (eff.date !== CHECK) continue;
    let u = norm(cols.udise ? r[cols.udise] : '');
    if (!/^\d{6,}$/.test(u)) u = udiseFrom(cols.school ? r[cols.school] : '');
    if (/^\d{6,}$/.test(u)) subCheck.add(u);
  }
  const inNever = never.filter((r) => subCheck.has(r.udise));
  const inSilent = droppedOff.filter((r) => subCheck.has(r.udise));
  console.log(`\n===== CHECK_DATE ${CHECK}: listed schools that actually reported that day =====`);
  console.log(`  NEVER-list schools that reported on ${CHECK} (remove from List 1): ${inNever.length}`);
  inNever.forEach((r) => console.log(`     - ${r.udise} ${r.name}`));
  console.log(`  RECENTLY-STOPPED schools that reported on ${CHECK} (remove from List 2): ${inSilent.length}`);
  inSilent.forEach((r) => console.log(`     - ${r.udise} ${r.name}`));
}

main().catch((e) => { console.error('[noncompliance] FAILED:', e); process.exit(1); });
