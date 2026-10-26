// ============================================================
// Baseline × Compliance cross-analysis for the CDO.
// Joins the school PROFILE/baseline form (who is responsible for getting MDM
// cooked — HM or Pradhan; where children eat; number of cooks) against each
// school's ACTUAL monitoring performance over all reporting days (reporting
// rate, red-flag rate, specific flag codes). Answers: do schools run by the
// Pradhan comply differently from schools run by the Headmaster?
// Read-only. Writes reports/baseline_cross.json.
// Needs: GOOGLE_SERVICE_ACCOUNT_JSON, RESULTS_SHEET_ID, PROFILE_SHEET_ID.
// ============================================================
import { readResults } from '../backend/store.js';
import { readSheet } from '../backend/sheets.js';
import fs from 'node:fs';
import path from 'node:path';

const MIN_REPORTING_SUBS = 25;
const HOLIDAYS = new Set(['2026-10-02', '2026-10-23']);
const isSunday = (d) => { try { return new Date(d + 'T12:00:00Z').getUTCDay() === 0; } catch { return false; } };
const PROFILE_SHEET_ID = process.env.PROFILE_SHEET_ID || '1yh2VUK_CUvXbCcr4RlPd7oYaQpx1GVigmlyFl59sA5k';
const PROFILE_TAB = process.env.PROFILE_SHEET_TAB || 'Form Responses 1';

// Normalise a UDISE to the 10-digit form the Results store uses (strip a single
// leading zero / any non-digits).
const normUdise = (v) => { let s = String(v || '').replace(/\D/g, ''); if (s.length === 11 && s[0] === '0') s = s.slice(1); return s; };

// --- baseline profile → per-UDISE attributes (dedup: keep latest timestamp) ---
function loadProfiles(headers, rows) {
  const H = (needle) => headers.findIndex((h) => String(h).toLowerCase().includes(needle));
  const cTs = 0; // Timestamp is col A
  const cUdise = H('udise');
  const cCooks = H('number of cooks') >= 0 ? H('number of cooks') : H('रसोइयों');
  const cEat = headers.findIndex((h) => String(h).includes('कहाँ खाते'));
  const cResp = headers.findIndex((h) => String(h).includes('ज़िम्मेदारी') || String(h).includes('जिम्मेदारी'));
  const byUdise = new Map();
  for (const r of rows) {
    const vals = headers.map((h) => r[h]);
    const udise = normUdise(vals[cUdise]);
    if (!udise) continue;
    const ts = Date.parse(vals[cTs]) || 0;
    const prev = byUdise.get(udise);
    if (prev && prev.ts >= ts) continue;
    // responsibility: हेडमास्टर / In-charge  vs  प्रधान
    const respRaw = String(cResp >= 0 ? vals[cResp] : '').trim();
    const resp = /प्रधान/.test(respRaw) ? 'Pradhan' : (/हेडमास्टर|In-charge|HM/i.test(respRaw) ? 'HM' : (respRaw ? 'Other' : 'Unknown'));
    // where children eat
    const eatRaw = String(cEat >= 0 ? vals[cEat] : '').trim();
    let eat = 'Unknown';
    if (/शेड|Shed/i.test(eatRaw)) eat = 'MDM shed';
    else if (/कक्षा|class/i.test(eatRaw)) eat = 'Classroom';
    else if (/बरामदे|गलियारे|veranda|corridor/i.test(eatRaw)) eat = 'Veranda/corridor';
    else if (/खुले|मैदान|open|ground/i.test(eatRaw)) eat = 'Open ground';
    // cooks
    const cooksN = parseInt(String(cCooks >= 0 ? vals[cCooks] : '').replace(/\D/g, ''), 10);
    byUdise.set(udise, { ts, resp, eat, cooks: Number.isFinite(cooksN) ? cooksN : null });
  }
  return byUdise;
}

// --- per-school compliance from the Results store ---
function schoolMetrics(rows, days) {
  const daySet = new Set(days);
  const m = new Map(); // udise -> { sub:Set(date), red:Set(date), codes:{} }
  for (const r of rows) {
    const u = (r.school && r.school.udise || '').trim();
    if (!u || !r.date || !daySet.has(r.date)) continue;
    let e = m.get(u);
    if (!e) { e = { sub: new Set(), red: new Set(), codes: {} }; m.set(u, e); }
    e.sub.add(r.date);
    if (r.severity === 'red') e.red.add(r.date);
    for (const f of (r.flags || [])) { const c = f.code || f; e.codes[c] = (e.codes[c] || 0) + 1; }
  }
  return m;
}

// two-proportion z (pooled) for a defensible "meaningful difference" claim
function twoPropZ(x1, n1, x2, n2) {
  if (!n1 || !n2) return null;
  const p1 = x1 / n1, p2 = x2 / n2, p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!se) return null;
  return Number(((p1 - p2) / se).toFixed(2));
}

function cohortStats(udises, metrics, nDays) {
  let schools = 0, subDays = 0, redDays = 0, redSchools = 0, neverRed = 0;
  const codes = {};
  const perSchoolRedRate = [];
  for (const u of udises) {
    const e = metrics.get(u);
    schools++;
    if (!e) { continue; }
    subDays += e.sub.size;
    redDays += e.red.size;
    if (e.red.size > 0) redSchools++; else neverRed++;
    if (e.sub.size) perSchoolRedRate.push(e.red.size / e.sub.size);
    for (const [c, n] of Object.entries(e.codes)) codes[c] = (codes[c] || 0) + n;
  }
  const possible = schools * nDays;
  return {
    schools,
    reportingRate: possible ? Number((100 * subDays / possible).toFixed(1)) : 0,
    submittedDays: subDays,
    redDays,
    redDayRateOfSubmitted: subDays ? Number((100 * redDays / subDays).toFixed(1)) : 0,
    redDayRateOfPossible: possible ? Number((100 * redDays / possible).toFixed(1)) : 0,
    schoolsEverRed: redSchools,
    schoolsNeverRed: neverRed,
    pctSchoolsEverRed: schools ? Number((100 * redSchools / schools).toFixed(1)) : 0,
    avgRedRatePerSchool: perSchoolRedRate.length ? Number((100 * perSchoolRedRate.reduce((a, b) => a + b, 0) / perSchoolRedRate.length).toFixed(1)) : 0,
    codes,
    // flag-code incidence per submitted day (×100)
    codeRatePerSubDay: Object.fromEntries(Object.entries(codes).map(([c, n]) => [c, subDays ? Number((100 * n / subDays).toFixed(1)) : 0])),
  };
}

async function main() {
  const rows = await readResults();
  // reporting days (dashboard logic)
  const subCount = new Map();
  for (const r of rows) { const u = r.school?.udise?.trim(); if (!u || !r.date) continue; (subCount.get(r.date) || subCount.set(r.date, new Set()).get(r.date)).add(u); }
  const days = [...new Set(rows.map((r) => r.date).filter(Boolean))]
    .filter((d) => !isSunday(d) && !HOLIDAYS.has(d) && (subCount.get(d) || new Set()).size >= MIN_REPORTING_SUBS)
    .sort();
  const nDays = days.length;

  const { headers, rows: profRows } = await readSheet(PROFILE_SHEET_ID, PROFILE_TAB);
  const profiles = loadProfiles(headers, profRows);
  const metrics = schoolMetrics(rows, days);

  // group UDISEs by each baseline attribute
  const byResp = { HM: [], Pradhan: [], Other: [], Unknown: [] };
  const byEat = { 'MDM shed': [], Classroom: [], 'Veranda/corridor': [], 'Open ground': [], Unknown: [] };
  const byCooks = { '1': [], '2': [], '3': [], '4+': [], Unknown: [] };
  for (const [u, p] of profiles) {
    (byResp[p.resp] || byResp.Unknown).push(u);
    (byEat[p.eat] || byEat.Unknown).push(u);
    const ck = p.cooks == null ? 'Unknown' : (p.cooks <= 1 ? '1' : p.cooks === 2 ? '2' : p.cooks === 3 ? '3' : '4+');
    byCooks[ck].push(u);
  }

  const S = (grp) => Object.fromEntries(Object.entries(grp).map(([k, us]) => [k, cohortStats(us, metrics, nDays)]));
  const respStats = S(byResp), eatStats = S(byEat), cooksStats = S(byCooks);

  // headline z-tests (HM vs Pradhan)
  const hm = respStats.HM, pr = respStats.Pradhan;
  const z = {
    reporting: twoPropZ(hm.submittedDays, hm.schools * nDays, pr.submittedDays, pr.schools * nDays),
    redOfSubmitted: twoPropZ(hm.redDays, hm.submittedDays, pr.redDays, pr.submittedDays),
    everRed: twoPropZ(hm.schoolsEverRed, hm.schools, pr.schoolsEverRed, pr.schools),
  };

  const out = {
    generated_at: new Date().toISOString(),
    reportingDays: nDays, days,
    profiledSchools: profiles.size,
    matchedToResults: [...profiles.keys()].filter((u) => metrics.has(u)).length,
    responsibility: respStats,
    whereChildrenEat: eatStats,
    numberOfCooks: cooksStats,
    headlineZ_HM_vs_Pradhan: z,
  };
  const dir = path.join(process.cwd(), 'reports'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'baseline_cross.json'), JSON.stringify(out, null, 2));

  // console summary
  const pct = (n) => `${n}%`;
  console.log(`\n[baseline-cross] ${nDays} reporting days, ${profiles.size} profiled schools, ${out.matchedToResults} matched to results\n`);
  console.log('=== WHO IS RESPONSIBLE FOR GETTING MDM COOKED ===');
  for (const k of ['HM', 'Pradhan', 'Other', 'Unknown']) {
    const s = respStats[k]; if (!s.schools) continue;
    console.log(`  ${k.padEnd(8)} n=${String(s.schools).padStart(3)} | reporting ${pct(s.reportingRate).padStart(6)} | red/submitted ${pct(s.redDayRateOfSubmitted).padStart(6)} | %schools ever red ${pct(s.pctSchoolsEverRed).padStart(6)}`);
  }
  console.log(`  z (HM vs Pradhan): reporting=${z.reporting}  red-of-submitted=${z.redOfSubmitted}  ever-red=${z.everRed}  (|z|>1.96 ⇒ p<0.05)`);
  console.log('\n=== WHERE CHILDREN EAT ===');
  for (const k of ['MDM shed', 'Classroom', 'Veranda/corridor', 'Open ground', 'Unknown']) {
    const s = eatStats[k]; if (!s.schools) continue;
    const hyg = (s.codes.hygiene_concern || 0) + (s.codes.no_food || 0);
    console.log(`  ${k.padEnd(16)} n=${String(s.schools).padStart(3)} | reporting ${pct(s.reportingRate).padStart(6)} | red/submitted ${pct(s.redDayRateOfSubmitted).padStart(6)} | hygiene+nofood flags ${hyg}`);
  }
  console.log('\n=== NUMBER OF COOKS ===');
  for (const k of ['1', '2', '3', '4+', 'Unknown']) {
    const s = cooksStats[k]; if (!s.schools) continue;
    console.log(`  cooks ${k.padEnd(3)} n=${String(s.schools).padStart(3)} | reporting ${pct(s.reportingRate).padStart(6)} | red/submitted ${pct(s.redDayRateOfSubmitted).padStart(6)}`);
  }
  console.log('\n[baseline-cross] wrote reports/baseline_cross.json');
}
main().catch((e) => { console.error('[baseline-cross] FAILED:', e); process.exit(1); });
