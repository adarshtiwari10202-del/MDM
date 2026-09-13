// Vercel serverless function: GET /api/results
// Sample mode: computes results from bundled fixtures (free, offline).
// Live mode: reads the results store the nightly cron populates (fast/cheap).
//   Pass ?date=YYYY-MM-DD to filter to one day.
import { config } from '../backend/config.js';

export default async function handler(req, res) {
  try {
    let rows;
    if (config.dataMode === 'live') {
      const { readResults } = await import('../backend/store.js');
      const date = (req.query && req.query.date) || undefined;
      rows = await readResults({ date });
      rows.sort((a, b) => b.score - a.score);
    } else {
      const { getDailySubmissions } = await import('../backend/source.js');
      const { processAll } = await import('../backend/pipeline.js');
      rows = await processAll(await getDailySubmissions(), { live: false });
    }
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
    res.status(200).json({ mode: config.dataMode, count: rows.length, rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
