// How often do schools use the daily-form remarks field (column I)?
// Relevant to the HM re-orientation: we want schools to add a remark whenever
// off-menu food is served (and generally). Writes reports/comment_usage.json.
import fs from 'node:fs';
import path from 'node:path';
import { getDailySubmissions } from '../backend/source.js';

async function main() {
  const subs = await getDailySubmissions();
  const byDate = {}; // date -> {subs, withComment}
  let total = 0, withComment = 0;
  const samples = [];
  for (const s of subs) {
    const d = s.date; if (!d) continue;
    const c = String(s.comment || '').trim();
    byDate[d] = byDate[d] || { subs: 0, withComment: 0 };
    byDate[d].subs++; total++;
    if (c) { byDate[d].withComment++; withComment++; if (samples.length < 25) samples.push({ date: d, udise: String(s.school && s.school.udise || '').trim(), comment: c.slice(0, 160) }); }
  }
  const dates = Object.keys(byDate).sort();
  const perDay = dates.map((d) => ({ date: d, subs: byDate[d].subs, withComment: byDate[d].withComment, pct: Math.round(100 * byDate[d].withComment / byDate[d].subs) }));
  const out = {
    generated_at: new Date().toISOString(),
    totalSubmissions: total, totalWithComment: withComment,
    overallPct: total ? Math.round(100 * withComment / total) : 0,
    perDay, samples,
  };
  const dir = path.join(process.cwd(), 'reports');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'comment_usage.json'), JSON.stringify(out, null, 2));
  console.log(`comment usage: ${withComment}/${total} submissions (${out.overallPct}%) carried a remark`);
  perDay.slice(-10).forEach((x) => console.log(`  ${x.date}: ${x.withComment}/${x.subs} (${x.pct}%)`));
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
