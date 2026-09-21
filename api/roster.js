// Vercel serverless function: GET /api/roster
// Returns the baseline list of schools expected to submit daily (from Sheet1
// of the daily spreadsheet, with a bundled snapshot fallback).
import { readRoster } from '../backend/roster.js';

export default async function handler(req, res) {
  try {
    const schools = await readRoster();
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json({ count: schools.length, schools });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
