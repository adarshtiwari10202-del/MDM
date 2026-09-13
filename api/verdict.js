// POST /api/verdict  { id, verdict: 'acceptable'|'not_acceptable', comment }
// Saves the reviewer's verdict to the results store (live mode only).
// Reviewer verdict is what goes on record — never the AI flag alone.
import { config } from '../backend/config.js';
import { setVerdict } from '../backend/store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (config.dataMode !== 'live') return res.status(200).json({ ok: true, note: 'sample mode: stored per-browser only' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { id, verdict, comment } = body;
    if (!id) return res.status(400).json({ error: 'id required' });
    const r = await setVerdict(id, { verdict, comment });
    res.status(200).json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
