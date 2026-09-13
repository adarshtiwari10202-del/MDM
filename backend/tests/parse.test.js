// Tests the row parser against the REAL header row + a REAL data row
// pulled from the live daily sheet (1oFGXJ5…), so parsing is proven
// before the service-account key is ever wired in.
import { resolveColumns, parseDailyRow, driveFileId, toISODate } from '../parse.js';

let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}`); } };

console.log('\nPhase 1 parser tests (real sheet data)\n');

// Exact headers from the live daily sheet.
const HEADERS = [
  'Timestamp',
  'Email Address',
  'विद्यालय का नाम / School Name',
  "आज की तारीख / Today's Date",
  'आज MDM खाने वाले छात्रों की संख्या / Number of students who ate MDM today',
  'UDISE Code',
  'फोटो 1: खाना पकाते हुए / Photo 1: Food being cooked in Kitchen',
  'फोटो 2: बर्तन में पका हुआ भोजन / Photo 2: Cooked meal in the vessel',
  'वीडियो:  बर्तन  प्लेट में परोसते हुए / Video: Serving onto a plate',
  'फोटो 3: बच्चे भोजन करते हुए (चौड़ा कोण) / Photo 3: Children eating (wide angle)',
];

// The real test row.
const ROW = {
  'Timestamp': '9/14/2026 2:30:45',
  'Email Address': '',
  'विद्यालय का नाम / School Name': 'Test',
  "आज की तारीख / Today's Date": '9/13/2026',
  'आज MDM खाने वाले छात्रों की संख्या / Number of students who ate MDM today': '56',
  'UDISE Code': '9192912922',
  'फोटो 1: खाना पकाते हुए / Photo 1: Food being cooked in Kitchen': 'https://drive.google.com/open?id=165e5MhtCSbHKRxydSz7-D2duifm9RCFc',
  'फोटो 2: बर्तन में पका हुआ भोजन / Photo 2: Cooked meal in the vessel': 'https://drive.google.com/open?id=1SVtt-cQawBlaThzt3Ptn-c9MirxSkFH-',
  'वीडियो:  बर्तन  प्लेट में परोसते हुए / Video: Serving onto a plate': '',
  'फोटो 3: बच्चे भोजन करते हुए (चौड़ा कोण) / Photo 3: Children eating (wide angle)': 'https://drive.google.com/open?id=1evdxIi8XPhpB5dbrv8pgS3WsczrK2X_I',
};

const cols = resolveColumns(HEADERS);
check('resolves all 4 media columns', cols.cooking && cols.cooked_meal && cols.serving_video && cols.children);
check('resolves udise + date + headcount', cols.udise && cols.date && cols.headcount);

const sub = parseDailyRow(ROW, cols, { rowIndex: 2 });
check('udise parsed', sub.school.udise === '9192912922');
check('date -> ISO 2026-09-13', sub.date === '2026-09-13');
check('headcount 56', sub.headcountReported === 56);
check('submittedAt in IST', sub.submittedAt === '2026-09-14T02:30:45+05:30');
check('cooking file id extracted', sub.files.cooking.fileId === '165e5MhtCSbHKRxydSz7-D2duifm9RCFc');
check('cooked_meal file id extracted', sub.files.cooked_meal.fileId === '1SVtt-cQawBlaThzt3Ptn-c9MirxSkFH-');
check('children file id extracted', sub.files.children.fileId === '1evdxIi8XPhpB5dbrv8pgS3WsczrK2X_I');
check('empty video -> missing:true', sub.files.serving_video.missing === true);
check('menu empty until configured (skips menu check)', Array.isArray(sub.menu) && sub.menu.length === 0);

// driveFileId url-shape coverage
check('driveFileId /file/d/ shape', driveFileId('https://drive.google.com/file/d/ABC123abc_def/view') === 'ABC123abc_def');
check('toISODate ISO passthrough', toISODate('2026-09-13') === '2026-09-13');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
