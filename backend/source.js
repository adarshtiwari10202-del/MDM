// ============================================================
// Data-source facade. Everything downstream (pipeline, dashboard API)
// asks for submissions here — sample fixtures or live Google — decided
// by DATA_MODE. Flipping DATA_MODE=live is the only change needed once
// Phase 0 credentials are in place.
// ============================================================
import { config } from './config.js';

/** Returns an array of normalized submissions (no AI readings attached). */
export async function getDailySubmissions(opts = {}) {
  if (config.dataMode === 'live') {
    const { readDailySubmissions } = await import('./sheets.js');
    return readDailySubmissions(opts);
  }
  const { SAMPLE_SUBMISSIONS } = await import('./sampleData/submissions.js');
  return SAMPLE_SUBMISSIONS;
}
