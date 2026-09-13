// GET /api/media?fileId=<driveFileId>
// Streams a submission's Drive photo/video through the service account so the
// dashboard can show it inline (Drive files aren't publicly linkable).
// Live mode only. The service account can only read files shared with it
// (the two MDM upload folders), so its reach is limited by design.
import { config } from '../backend/config.js';

export default async function handler(req, res) {
  const fileId = req.query && req.query.fileId;
  if (!fileId || !/^[A-Za-z0-9_-]{20,}$/.test(fileId)) {
    return res.status(400).json({ error: 'valid fileId required' });
  }
  if (config.dataMode !== 'live') {
    return res.status(404).json({ error: 'media proxy is live-mode only' });
  }
  try {
    const { fetchDriveMedia } = await import('../backend/sheets.js');
    const { buffer, mimeType } = await fetchDriveMedia(fileId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600'); // cache per-viewer 1h
    res.status(200).send(buffer);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
