// Vercel serverless function: GET /api/submissions
// LIVE submission tracking, independent of the (evening) AI run. Reads the
// daily reporting Google Form directly — no AI, no Drive media — and returns,
// per reporting date, the set of UDISE codes that have submitted. Used by the
// dashboard so the submission count and the "yet to report" list update through
// the day, before the nightly AI batch populates the results store.
import { config } from '../backend/config.js';

export default async function handler(req, res) {
  try {
    if (config.dataMode !== 'live') {
      res.status(200).json({ mode: 'sample', rosterSize: 0, dates: [], submittedByDate: {} });
      return;
    }
    const { getDailySubmissions } = await import('../backend/source.js');
    const { readRoster } = await import('../backend/roster.js');
    const [subs, roster] = await Promise.all([getDailySubmissions(), readRoster()]);

    const byDate = {}; // date -> Set(udise)
    for (const s of subs) {
      const d = s.date;
      const u = String((s.school && s.school.udise) || '').trim();
      if (!d || !u) continue;
      (byDate[d] || (byDate[d] = new Set())).add(u);
    }
    const dates = Object.keys(byDate).sort();
    const submittedByDate = {};
    for (const d of dates) submittedByDate[d] = [...byDate[d]];

    // Short cache so the dashboard stays near-live but doesn't hammer Sheets.
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    res.status(200).json({
      mode: 'live',
      generatedAt: new Date().toISOString(),
      rosterSize: roster.length,
      dates,
      submittedByDate,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
