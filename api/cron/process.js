// Vercel Cron: GET /api/cron/process  (scheduled nightly — see vercel.json)
// Reads unprocessed daily submissions, runs them through the pipeline ONCE,
// writes results to the store. The dashboard then reads the store cheaply.
import { config } from '../../backend/config.js';
import { getDailySubmissions } from '../../backend/source.js';
import { processAll } from '../../backend/pipeline.js';
import { getProcessedIds, loadSeenHashes, appendResults, ensureHeader } from '../../backend/store.js';

export default async function handler(req, res) {
  // Optional shared-secret guard (Vercel sends Authorization: Bearer <CRON_SECRET>).
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'unauthorized' });
  }
  if (config.dataMode !== 'live') {
    return res.status(200).json({ skipped: 'DATA_MODE is not live' });
  }
  try {
    await ensureHeader();
    const [subs, processedIds, seenHashes] = await Promise.all([
      getDailySubmissions(),
      getProcessedIds(),
      loadSeenHashes(),
    ]);
    const pending = subs.filter((s) => !processedIds.has(s.id));
    if (!pending.length) return res.status(200).json({ processed: 0, message: 'nothing new' });

    const results = await processAll(pending, { live: true, seenHashes });
    const { added } = await appendResults(results);
    res.status(200).json({
      processed: added,
      dates: [...new Set(results.map((r) => r.date))],
      flagged: results.filter((r) => r.severity === 'red').length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
