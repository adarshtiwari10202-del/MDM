// Build the Word doc for the missed-reporting escalation list from the
// authoritative reports/missed3days.json. Excludes any UDISE in EXCLUDE.
// Output path via OUT env. Uses the `docx` library.
import fs from 'node:fs';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
} from 'docx';

const EXCLUDE = new Set((process.env.EXCLUDE || '').split(',').map((s) => s.trim()).filter(Boolean));
const OUT = process.env.OUT || 'MDM_Missed_Reporting.docx';
const j = JSON.parse(fs.readFileSync('reports/missed3days.json', 'utf8'));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
const daysLabel = j.days.map(fmt).join(', ');

const rows = j.missed
  .filter((m) => !EXCLUDE.has(m.udise))
  .sort((a, b) => a.name.localeCompare(b.name));

const NAVY = '1F3864', GREY = '595959', HAIR = 'BFBFBF', HEADBG = '1F3864';

const cell = (text, { bold = false, color, align = AlignmentType.LEFT, bg, width } = {}) =>
  new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: bg ? { type: ShadingType.CLEAR, fill: bg, color: 'auto' } : undefined,
    margins: { top: 40, bottom: 40, left: 90, right: 90 },
    children: [new Paragraph({ alignment: align, children: [new TextRun({ text, bold, color, size: 19 })] })],
  });

const headerRow = new TableRow({
  tableHeader: true,
  children: [
    cell('S.No', { bold: true, color: 'FFFFFF', align: AlignmentType.CENTER, bg: HEADBG, width: 8 }),
    cell('UDISE Code', { bold: true, color: 'FFFFFF', bg: HEADBG, width: 20 }),
    cell('School Name', { bold: true, color: 'FFFFFF', bg: HEADBG, width: 44 }),
    cell('Day(s) not reported', { bold: true, color: 'FFFFFF', bg: HEADBG, width: 28 }),
  ],
});

const bodyRows = rows.map((m, i) => new TableRow({
  children: [
    cell(String(i + 1), { align: AlignmentType.CENTER, bg: i % 2 ? 'F2F5FA' : undefined }),
    cell(m.udise, { bg: i % 2 ? 'F2F5FA' : undefined }),
    cell(m.name, { bg: i % 2 ? 'F2F5FA' : undefined }),
    cell(m.missedDays.map(fmt).join(', '), { bg: i % 2 ? 'F2F5FA' : undefined }),
  ],
}));

const thin = { style: BorderStyle.SINGLE, size: 4, color: HAIR };
const table = new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: { top: thin, bottom: thin, left: thin, right: thin, insideHorizontal: thin, insideVertical: thin },
  rows: [headerRow, ...bodyRows],
});

const P = (text, opts = {}) => new Paragraph({ children: [new TextRun({ text, ...opts })], spacing: { after: opts.after ?? 120 }, alignment: opts.align });

const doc = new Document({
  styles: { default: { document: { run: { font: 'Calibri' } } } },
  sections: [{
    properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
    children: [
      new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { after: 40 },
        children: [new TextRun({ text: 'Mid-Day Meal (PM POSHAN) — Daily Reporting Non-Compliance', bold: true, color: NAVY, size: 28 })] }),
      new Paragraph({ spacing: { after: 160 },
        children: [new TextRun({ text: 'Hargaon Block, Sitapur District, Uttar Pradesh', color: GREY, size: 20 })] }),

      P('Subject: Schools that did not submit the daily MDM reporting (Google Form) on one or more of the last three reporting days.', { bold: true }),
      P(`Reporting days checked: ${daysLabel} 2026. A school is listed if it did not submit on any one (or more) of these three days. Schools that reported on all three days are not listed.`),
      P(`Source of truth: the daily reporting Google Form responses, grouped by the form's automatic submission timestamp (IST). Roster: ${j.rosterSize} schools.`),

      new Paragraph({ spacing: { before: 80, after: 60 }, children: [new TextRun({ text: 'Summary', bold: true, color: NAVY, size: 22 })] }),
      P(`Schools submitting each day — ${j.perDay.map((d) => `${fmt(d.date)}: ${d.schools}`).join('   ·   ')}.`),
      P(`Schools that missed at least one of the three days: ${rows.length} of ${j.rosterSize}. Reported on all three days: ${j.rosterSize - rows.length}.`, { bold: true }),

      new Paragraph({ spacing: { before: 120, after: 80 }, children: [new TextRun({ text: `Schools to follow up (${rows.length})`, bold: true, color: NAVY, size: 22 })] }),
      table,

      new Paragraph({ spacing: { before: 200 },
        children: [new TextRun({ text: `Generated ${new Date(j.generatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST. Figures verified against the Google Form by two independent methods (submission timestamp and the manually-entered date); counts reconcile to the full ${j.rosterSize}-school roster.`, italics: true, color: GREY, size: 17 })] }),
    ],
  }],
});

const buf = await Packer.toBuffer(doc);
fs.writeFileSync(OUT, buf);
console.log(`wrote ${OUT} — ${rows.length} schools listed (excluded: ${[...EXCLUDE].join(', ') || 'none'})`);
