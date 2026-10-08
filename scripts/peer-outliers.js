// ============================================================
// PEER OUTLIERS (test lane) — reads reports/peer_analysis_<DATE>.json and
// ranks schools whose dal / sabzi attribute vector diverges MOST from the
// block cohort majority for that day. Writes reports/peer_outliers_<DATE>.json.
// Pure logic, no AI, no sheet access.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';

const DATE = process.env.DATE || '2026-10-08';
const IN  = path.join('reports', `peer_analysis_${DATE}.json`);
const OUT = path.join('reports', `peer_outliers_${DATE}.json`);
const TOP_N = Number(process.env.TOP_N || 10);

// Attribute groups per dish (order matters only for display).
const DISHES = {
  dal: {
    visibleKey: 'dal_visible',
    attrs: ['dal_color', 'dal_consistency', 'dal_oil_film', 'dal_vegetables_visible', 'dal_fill_level'],
    label: 'Dal',
  },
  sabzi: {
    visibleKey: 'sabzi_visible',
    attrs: ['sabzi_base', 'sabzi_color', 'sabzi_oil_film', 'sabzi_type', 'sabzi_fill_level'],
    label: 'Sabzi',
  },
};

const prettyKey = (k) => k.replace(/^(dal|sabzi)_/, '').replace(/_/g, ' ');
const prettyVal = (v) => String(v || '').replace(/_/g, ' ');

function majority(values) {
  // ignores 'unclear'; returns the most common clear value and its share
  const counts = {};
  let n = 0;
  for (const v of values) {
    if (!v || v === 'unclear') continue;
    counts[v] = (counts[v] || 0) + 1; n++;
  }
  if (!n) return null;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [value, c] = sorted[0];
  return { value, share: c / n, support: n, counts };
}

function scoreDish(rows, dish) {
  const cohort = rows.filter((r) => r.ai && r.ai[dish.visibleKey] === 'yes');
  if (cohort.length < 20) {
    return { dish: dish.label, cohortSize: cohort.length, majority: null, outliers: [], note: 'Cohort too small for stable peer analysis (minimum 20).' };
  }
  const maj = {};
  for (const k of dish.attrs) maj[k] = majority(cohort.map((r) => r.ai[k]));
  const outliers = [];
  for (const r of cohort) {
    const diffs = [];
    for (const k of dish.attrs) {
      const m = maj[k]; if (!m) continue;
      const v = r.ai[k];
      if (v && v !== 'unclear' && v !== m.value) diffs.push({ attr: k, value: v, majority: m.value, majorityShare: m.share });
    }
    outliers.push({ udise: r.udise, name: r.name, fileId: r.fileId, divergence: diffs.length, differs: diffs, notes: r.ai.notes || '' });
  }
  outliers.sort((a, b) => b.divergence - a.divergence || a.name.localeCompare(b.name));
  return {
    dish: dish.label,
    cohortSize: cohort.length,
    majority: Object.fromEntries(dish.attrs.map((k) => [k, maj[k] ? { value: maj[k].value, share: maj[k].share, support: maj[k].support } : null])),
    outliers: outliers.slice(0, TOP_N),
  };
}

function main() {
  const j = JSON.parse(fs.readFileSync(IN, 'utf8'));
  const rows = j.rows.filter((r) => r.ai && !r.error);
  console.log(`[peer-outliers] date=${j.date}  usable rows=${rows.length}`);

  const results = {};
  for (const [key, dish] of Object.entries(DISHES)) {
    results[key] = scoreDish(rows, dish);
    const r = results[key];
    console.log(`\n== ${r.dish} ==  cohort=${r.cohortSize}`);
    if (r.majority) {
      for (const [k, m] of Object.entries(r.majority))
        console.log(`   majority ${prettyKey(k).padEnd(20)} = ${m ? prettyVal(m.value) + ` (${Math.round(m.share * 100)}%, n=${m.support})` : '(no clear majority)'}`);
    }
    console.log(`   top ${r.outliers.length} outliers:`);
    r.outliers.slice(0, 5).forEach((o, i) =>
      console.log(`   ${i + 1}. ${o.udise}  ${o.name}  — differs on ${o.divergence}: ${o.differs.map((d) => prettyKey(d.attr) + '=' + prettyVal(d.value) + ' vs ' + prettyVal(d.majority)).join(' | ')}`)
    );
  }

  const out = {
    generatedAt: new Date().toISOString(),
    date: j.date,
    schemaVersion: 'peer-outliers-v1',
    note: 'Isolated test lane. Ranks visual-attribute divergence from the block cohort majority. Not a quality judgment.',
    dishes: results,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\n[peer-outliers] wrote ${OUT}`);
}

main();
