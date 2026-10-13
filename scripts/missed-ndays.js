// ============================================================
// Chronic non-reporters: schools that submitted NO daily report on ANY of the
// last N reporting days, for N = 4, 5, 6. Reporting days are derived from the
// live Google Form sheet with the dashboard's own filters: Sundays dropped,
// declared holidays dropped, today-before-7PM dropped, and outage days
// (< MIN_REPORTING_SUBS distinct submissions) dropped.
//
// Writes reports/missed_ndays.json and a single Word doc with one table per
// window (4/5/6). Read-only on live data.
//   WINDOWS   comma list of N values (default "4,5,6")
//   OUT       output .docx (default MDM_Chronic_NonReporters.docx)
// Needs: GOOGLE_SERVICE_ACCOUNT_JSON, DAILY_SHEET_ID (+ Sheet1 roster).
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { readRoster } from '../backend/roster.js';
import { getDailySubmissions } from '../backend/source.js';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
} from 'docx';

const HOLIDAYS = new Set(['2026-10-02']);
const MIN_REPORTING_SUBS = 25;
const REPORT_CUTOFF_HOUR = 19;
const WINDOWS = (process.env.WINDOWS || '4,5,6').split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
const OUT = process.env.OUT || 'MDM_Chronic_NonReporters.docx';

const istNow = () => new Date(Date.now() + (5 * 60 + 30) * 60000);
const istTodayISO = () => istNow().toISOString().slice(0, 10);
const isSunday = (d) => { try { return new Date(d + 'T12:00:00Z').getUTCDay() === 0; } catch (e) { return false; } };

const norm = (u) => String(u || '').trim();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };

async function main() {
  const [roster, subs] = await Promise.all([readRoster(), getDailySubmissions()]);
  // udise -> Set<date>
  const byUdise = new Map();
  const byDate = new Map();
  for (const s of subs) {
    const d = s.date;
    const u = norm(s.school && s.school.udise);
    if (!d || !/^\d{6,}$/.test(u)) continue;
    (byUdise.get(u) || byUdise.set(u, new Set()).get(u)).add(d);
    (byDate.get(d) || byDate.set(d, new Set()).get(d)).add(u);
  }
  const today = istTodayISO();
  const todayCounts = istNow().getUTCHours() >= REPORT_CUTOFF_HOUR;

  // Reporting days — same filter the dashboard uses, newest first.
  const allDates = [...byDate.keys()].sort().reverse();
  const reportingDays = allDates.filter((d) => {
    if (isSunday(d) || HOLIDAYS.has(d)) return false;
    if (d === today && !todayCounts) return false;
    if ((byDate.get(d) || new Set()).size < MIN_REPORTING_SUBS) return false;
    return true;
  });

  const windows = WINDOWS.map((n) => ({ n, days: reportingDays.slice(0, n).reverse() }));
  console.log(`Reporting-day pool (newest first): ${reportingDays.slice(0, 10).join(', ')}`);
  for (const w of windows) console.log(`  last ${w.n}: ${w.days.join(', ')}`);

  // For each window, roster schools with ZERO submissions across those days.
  const results = windows.map((w) => {
    const missed = roster
      .map((s) => ({ udise: norm(s.udise), name: s.name }))
      .filter((s) => /^\d{6,}$/.test(s.udise))
      .filter((s) => {
        const set = byUdise.get(s.udise) || new Set();
        return w.days.every((d) => !set.has(d));
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return { n: w.n, days: w.days, missed };
  });

  for (const r of results) console.log(`\nChronic non-reporters — missed ALL of last ${r.n} reporting days: ${r.missed.length}`);

  // JSON snapshot
  const dir = path.join(process.cwd(), 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const jsonOut = {
    generated_at: new Date().toISOString(),
    today, todayCountsAfter7PM: todayCounts,
    rosterSize: roster.length,
    reportingDaysNewestFirst: reportingDays,
    windows: results,
  };
  fs.writeFileSync(path.join(dir, 'missed_ndays.json'), JSON.stringify(jsonOut, null, 2));

  // Word doc
  const NAVY = '1F3864', GREY = '595959', HAIR = 'BFBFBF', HEADBG = '1F3864';
  const cell = (text, { bold = false, color, align = AlignmentType.LEFT, bg, width } = {}) =>
    new TableCell({
      width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
      shading: bg ? { type: ShadingType.CLEAR, fill: bg, color: 'auto' } : undefined,
      margins: { top: 40, bottom: 40, left: 90, right: 90 },
      children: [new Paragraph({ alignment: align, children: [new TextRun({ text, bold, color, size: 19 })] })],
    });
  const header = () => new TableRow({
    tableHeader: true,
    children: [
      cell('S.No', { bold: true, color: 'FFFFFF', align: AlignmentType.CENTER, bg: HEADBG, width: 10 }),
      cell('UDISE Code', { bold: true, color: 'FFFFFF', bg: HEADBG, width: 26 }),
      cell('School Name', { bold: true, color: 'FFFFFF', bg: HEADBG, width: 64 }),
    ],
  });
  const body = (rows) => rows.map((m, i) => new TableRow({
    children: [
      cell(String(i + 1), { align: AlignmentType.CENTER, bg: i % 2 ? 'F2F5FA' : undefined }),
      cell(m.udise, { bg: i % 2 ? 'F2F5FA' : undefined }),
      cell(m.name, { bg: i % 2 ? 'F2F5FA' : undefined }),
    ],
  }));
  const thin = { style: BorderStyle.SINGLE, size: 4, color: HAIR };
  const tableFor = (rows) => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: thin, bottom: thin, left: thin, right: thin, insideHorizontal: thin, insideVertical: thin },
    rows: [header(), ...body(rows)],
  });
  const P = (text, opts = {}) => new Paragraph({ children: [new TextRun({ text, ...opts })], spacing: { after: opts.after ?? 120 }, alignment: opts.align });

  const sections = [];
  sections.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { after: 40 },
    children: [new TextRun({ text: 'Mid-Day Meal (PM POSHAN) — Chronic Daily-Reporting Non-Compliance', bold: true, color: NAVY, size: 28 })] }));
  sections.push(new Paragraph({ spacing: { after: 160 },
    children: [new TextRun({ text: 'Hargaon Block, Sitapur District, Uttar Pradesh', color: GREY, size: 20 })] }));
  sections.push(P(`Subject: Schools that submitted NO daily MDM reporting (Google Form) on any of the last 4, 5, and 6 reporting days.`, { bold: true }));
  sections.push(P(`"Reporting days" exclude Sundays, declared holidays, today before 7 PM IST, and outage days (fewer than ${MIN_REPORTING_SUBS} schools in the whole block submitted). Source of truth: the daily reporting Google Form responses, grouped by the form's automatic submission timestamp (IST). Roster: ${roster.length} schools.`));

  for (const r of results) {
    sections.push(new Paragraph({ spacing: { before: 240, after: 80 },
      children: [new TextRun({ text: `Last ${r.n} reporting days — ${r.days.map(fmt).join(', ')} 2026 — ${r.missed.length} schools missed every one`, bold: true, color: NAVY, size: 22 })] }));
    if (r.missed.length) sections.push(tableFor(r.missed));
    else sections.push(P(`No chronic non-reporters for this window — every roster school submitted on at least one of ${r.days.map(fmt).join(', ')}.`, { italics: true, color: GREY }));
  }

  sections.push(new Paragraph({ spacing: { before: 240 },
    children: [new TextRun({ text: `Generated ${new Date(jsonOut.generated_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST. Windows nested — a school listed under "last 6" is also listed under "last 5" and "last 4" if it missed every one of those shorter windows too.`, italics: true, color: GREY, size: 17 })] }));

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri' } } } },
    sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } }, children: sections }],
  });
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(OUT, buf);
  console.log(`\nwrote ${OUT}`);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
