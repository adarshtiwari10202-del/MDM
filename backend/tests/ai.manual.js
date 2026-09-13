// Manual AI test — run against a REAL image/video with your key set.
//
//   1) cp .env.example .env  and set GEMINI_API_KEY
//   2) node backend/tests/ai.manual.js <path-to-image.jpg> [menu items comma sep]
//      node backend/tests/ai.manual.js <path-to-video.mp4> rice,dal,sabzi
//
// Images need only the key. Video also needs ffmpeg on PATH.
import path from 'node:path';
import { analyzeImage, analyzeVideo } from '../ai.js';

const file = process.argv[2];
const menu = (process.argv[3] || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!file) { console.error('Usage: node backend/tests/ai.manual.js <file> [menu,comma,sep]'); process.exit(1); }

const isVideo = ['.mp4', '.mov', '.webm', '.avi', '.mkv'].includes(path.extname(file).toLowerCase());
console.log(`Analyzing ${isVideo ? 'VIDEO' : 'IMAGE'}: ${file}\nMenu: ${menu.join(', ') || '(none)'}\n`);

const run = isVideo ? analyzeVideo : analyzeImage;
run(file, menu)
  .then((json) => { console.log('AI reading:\n', JSON.stringify(json, null, 2)); })
  .catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
