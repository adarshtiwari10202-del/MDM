// Vercel serverless function: GET /api/peer-outliers?date=YYYY-MM-DD
// Serves the pre-computed peer-outliers JSON from reports/. Separate from
// /api/results — does not touch the live results store or the flag engine.
// If the file is absent, returns 404 so the Test panel shows a friendly state.
import fs from 'node:fs';
import path from 'node:path';

export default function handler(req, res) {
  const date = String((req.query && req.query.date) || '').match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  if (!date) { res.status(400).json({ error: 'date=YYYY-MM-DD required' }); return; }
  const file = path.join(process.cwd(), 'reports', `peer_outliers_${date}.json`);
  if (!fs.existsSync(file)) { res.status(404).json({ error: 'no peer-outliers data for ' + date }); return; }
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json(j);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
