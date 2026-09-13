// Vercel serverless function: GET /api/results
// Sample mode: computes results from bundled fixtures (free, offline).
// Live mode (DATA_MODE=live + keys set): reads the daily sheet, runs media
// through the pipeline, returns worst-first results.
import { getDailySubmissions } from '../backend/source.js';
import { processAll } from '../backend/pipeline.js';
import { config } from '../backend/config.js';

export default async function handler(req, res) {
  try {
    const subs = await getDailySubmissions();
    const rows = await processAll(subs, { live: config.dataMode === 'live' });
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ mode: config.dataMode, count: rows.length, rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
