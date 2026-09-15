// Manual AI test — run against a REAL image/video with your key set.
//
//   1) cp .env.example .env  and set GEMINI_API_KEY
//   2) node backend/tests/ai.manual.js <file> <stage> [menu,comma,sep]
//      stage = cooking | cooked_food | serving | plate
//      e.g. node backend/tests/ai.manual.js meal.jpg cooked_food rice,dal,sabzi
//           node backend/tests/ai.manual.js serve.mp4 serving rice,dal
//
// Images need only the key. Video (stage 'serving') also needs ffmpeg on PATH.
import path from 'node:path';
import { analyzeImage, analyzeVideo } from '../ai.js';

const file = process.argv[2];
const stage = process.argv[3];
const menuItems = (process.argv[4] || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!file || !stage) {
  console.error('Usage: node backend/tests/ai.manual.js <file> <stage> [menu,comma,sep]');
  console.error('stage = cooking | cooked_food | serving | plate');
  process.exit(1);
}

const isVideo = ['.mp4', '.mov', '.webm', '.avi', '.mkv'].includes(path.extname(file).toLowerCase());
console.log(`Analyzing ${isVideo ? 'VIDEO' : 'IMAGE'} as stage "${stage}": ${file}\nMenu: ${menuItems.join(', ') || '(none)'}\n`);

const p = isVideo ? analyzeVideo(file, { menuItems }) : analyzeImage(file, { stage, menuItems });
p.then((json) => { console.log('AI reading:\n', JSON.stringify(json, null, 2)); })
  .catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
