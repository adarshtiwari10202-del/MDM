// Quick live-count check: reads the daily Google Form directly and dumps a
// per-date distinct-school submission count to reports/sub_counts.json so
// we can verify what the dashboard's /api/submissions is serving right now.
import fs from 'node:fs';
import path from 'node:path';
import { getDailySubmissions } from '../backend/source.js';

async function main() {
  const subs = await getDailySubmissions();
  const byDate = {};
  for (const s of subs) {
    const d = s.date;
    const u = String((s.school && s.school.udise) || '').trim();
    if (!d || !u) continue;
    (byDate[d] = byDate[d] || new Set()).add(u);
  }
  const dates = Object.keys(byDate).sort();
  const out = {
    generated_at: new Date().toISOString(),
    counts: Object.fromEntries(dates.map((d) => [d, byDate[d].size])),
  };
  const dir = path.join(process.cwd(), 'reports');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sub_counts.json'), JSON.stringify(out, null, 2));
  console.log('sub counts by date:');
  for (const d of dates) console.log(`  ${d}: ${byDate[d].size}`);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
