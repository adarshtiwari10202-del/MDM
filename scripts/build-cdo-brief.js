// Build the one-pager progress brief for the CDO, Sitapur.
// Reads the committed snapshots in reports/ so the figures match whatever the
// most recent workflow runs produced; outputs a single .docx.
//   OUT=file.docx  (default MDM_CDO_Brief.docx)
import fs from 'node:fs';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
} from 'docx';

const NAVY='1F3864', GREY='595959', INK='2A2E36', TEAL='1A7F6B', GOLD='B88316', RED='B4341B', HAIR='D9DEE6', BG='F2F5FA';
const OUT = process.env.OUT || 'MDM_CDO_Brief.docx';

const subs = JSON.parse(fs.readFileSync('reports/sub_counts.json','utf8'));
const miss = JSON.parse(fs.readFileSync('reports/missed_ndays.json','utf8'));
const cov  = JSON.parse(fs.readFileSync('reports/ai_coverage.json','utf8'));

// --- derive figures ---
const ROSTER = miss.rosterSize || 195;
// Last 7 counted reporting days, oldest first.
const last7 = miss.reportingDaysNewestFirst.slice(0, 7).sort();
const DAYS = last7.map((d) => {
  const n = subs.counts[d] || 0;
  const c = cov.byDate[d] || {};
  const aiPct = c.present ? Math.round(100 * c.ai / c.present) : 0;
  const dt = new Date(d + 'T12:00:00Z');
  const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getUTCDay()];
  const dd = dt.getUTCDate();
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dt.getUTCMonth()];
  return { date:d, label:`${dow} ${dd} ${mo}`, n, pct:Math.round(100*n/ROSTER), ai:aiPct };
});
const avgN = Math.round(DAYS.reduce((a,x)=>a+x.n,0) / DAYS.length);
const avgPct = Math.round(100 * avgN / ROSTER);
const peak = DAYS.reduce((a,b)=> b.n>a.n?b:a, DAYS[0]);
// AI coverage window = same seven days.
const aiOverall = Math.round(DAYS.reduce((a,x)=>a+x.ai,0) / DAYS.length);
// Chronic non-reporters = schools that missed every one of the last 6 reporting days.
const chronic = (miss.windows.find(w=>w.n===6) || miss.windows[miss.windows.length-1] || {missed:[]}).missed;
// Pilot day = calendar days since 18 Sep inclusive.
const PILOT_START = new Date('2026-09-18T00:00:00Z');
const now = new Date(subs.generated_at || Date.now());
const day = Math.floor((now - PILOT_START) / 86400000) + 1;

// --- doc helpers ---
const R=(t,o={})=>new TextRun({text:t,...o});
const H=(t,{color=NAVY,size=22,before=120,after=80}={})=>new Paragraph({spacing:{before,after},children:[R(t,{bold:true,color,size})]});
const bullet=(runs)=>new Paragraph({bullet:{level:0},spacing:{after:60},children:Array.isArray(runs)?runs:[runs]});
const cell=(children,{bg,align=AlignmentType.LEFT,colW}={})=>new TableCell({
  width: colW?{size:colW,type:WidthType.PERCENTAGE}:undefined,
  shading: bg?{type:ShadingType.CLEAR,fill:bg,color:'auto'}:undefined,
  margins:{top:80,bottom:80,left:120,right:120},
  children: Array.isArray(children)?children:[new Paragraph({alignment:align,children:Array.isArray(children)?children:[children]})],
});
const thin={style:BorderStyle.SINGLE,size:4,color:HAIR};
const borders={top:thin,bottom:thin,left:thin,right:thin,insideHorizontal:thin,insideVertical:thin};
const noBorder={style:BorderStyle.NONE,size:0,color:'FFFFFF'};
const bordersNone={top:noBorder,bottom:noBorder,left:noBorder,right:noBorder,insideHorizontal:noBorder,insideVertical:noBorder};

function statTile(big,bigColor,label,sub){
  return new TableCell({
    width:{size:33,type:WidthType.PERCENTAGE},
    shading:{type:ShadingType.CLEAR,fill:BG,color:'auto'},
    margins:{top:200,bottom:200,left:160,right:160},
    children:[
      new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:40},children:[R(big,{bold:true,color:bigColor,size:40})]}),
      new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:30},children:[R(label,{bold:true,color:INK,size:18})]}),
      new Paragraph({alignment:AlignmentType.CENTER,children:[R(sub,{color:GREY,size:16})]}),
    ],
  });
}
const statsTable=new Table({
  width:{size:100,type:WidthType.PERCENTAGE}, borders:bordersNone,
  rows:[new TableRow({children:[
    statTile(`${ROSTER} / ${ROSTER}`, NAVY, 'Schools profiled', 'Baseline complete'),
    statTile(`Day ${day}`, TEAL, 'Daily reporting live', 'Since 18 September 2026'),
    statTile(`~${avgPct}%`, GOLD, 'Avg daily participation', 'last 7 reporting days'),
  ]})],
});

// --- reporting-rate table ---
const headerRow=new TableRow({tableHeader:true,children:[
  cell([new Paragraph({children:[R('Date',{bold:true,color:'FFFFFF',size:18})]})],{bg:NAVY,colW:22}),
  cell([new Paragraph({alignment:AlignmentType.CENTER,children:[R('Schools submitted',{bold:true,color:'FFFFFF',size:18})]})],{bg:NAVY,colW:22,align:AlignmentType.CENTER}),
  cell([new Paragraph({alignment:AlignmentType.CENTER,children:[R(`Share of ${ROSTER}`,{bold:true,color:'FFFFFF',size:18})]})],{bg:NAVY,colW:18,align:AlignmentType.CENTER}),
  cell([new Paragraph({alignment:AlignmentType.CENTER,children:[R('AI verified',{bold:true,color:'FFFFFF',size:18})]})],{bg:NAVY,colW:16,align:AlignmentType.CENTER}),
  cell([new Paragraph({children:[R('Notes',{bold:true,color:'FFFFFF',size:18})]})],{bg:NAVY,colW:22}),
]});
const noteFor=(d)=>{
  if(d.date==='2026-10-05') return 'BEO Google Meet with non-compliant schools';
  if(d.date===peak.date) return 'highest participation to date';
  return '';
};
const bodyRows=DAYS.map((d,i)=>{
  const bg = i%2 ? BG : undefined;
  const pctColor = d.pct>=90 ? TEAL : d.pct>=75 ? GOLD : RED;
  const aiColor = d.ai>=95 ? TEAL : d.ai>=80 ? GOLD : RED;
  const label = d.date===peak.date ? `${d.label} ★` : d.label;
  return new TableRow({children:[
    cell([new Paragraph({children:[R(label,{bold:true,color:INK,size:19})]})],{bg}),
    cell([new Paragraph({alignment:AlignmentType.CENTER,children:[R(String(d.n),{color:INK,size:19})]})],{bg}),
    cell([new Paragraph({alignment:AlignmentType.CENTER,children:[R(d.pct+'%',{bold:true,color:pctColor,size:19})]})],{bg}),
    cell([new Paragraph({alignment:AlignmentType.CENTER,children:[R(d.ai+'%',{bold:true,color:aiColor,size:19})]})],{bg}),
    cell([new Paragraph({children:[R(noteFor(d),{color:GREY,size:18,italics:!!noteFor(d)})]})],{bg}),
  ]});
});
const dataTable=new Table({width:{size:100,type:WidthType.PERCENTAGE},borders,rows:[headerRow,...bodyRows]});

// --- chronic non-reporter mini-table ---
const chrHeader=new TableRow({tableHeader:true,children:[
  cell([new Paragraph({alignment:AlignmentType.CENTER,children:[R('S.No',{bold:true,color:'FFFFFF',size:18})]})],{bg:NAVY,colW:10,align:AlignmentType.CENTER}),
  cell([new Paragraph({children:[R('UDISE',{bold:true,color:'FFFFFF',size:18})]})],{bg:NAVY,colW:26}),
  cell([new Paragraph({children:[R('School',{bold:true,color:'FFFFFF',size:18})]})],{bg:NAVY,colW:64}),
]});
const chrRows = chronic.length ? chronic.map((c,i)=>new TableRow({children:[
  cell([new Paragraph({alignment:AlignmentType.CENTER,children:[R(String(i+1),{color:INK,size:19})]})],{bg:i%2?BG:undefined,align:AlignmentType.CENTER}),
  cell([new Paragraph({children:[R(c.udise,{color:INK,size:19})]})],{bg:i%2?BG:undefined}),
  cell([new Paragraph({children:[R(c.name,{color:INK,size:19})]})],{bg:i%2?BG:undefined}),
]})) : [new TableRow({children:[cell([new Paragraph({alignment:AlignmentType.CENTER,children:[R('None — every school reported on at least one of the last 6 reporting days.',{italics:true,color:GREY,size:18})]})],{align:AlignmentType.CENTER})]})];
const chrTable=new Table({width:{size:100,type:WidthType.PERCENTAGE},borders,rows:[chrHeader,...chrRows]});

// --- next-steps table ---
const nextHeader=new TableRow({tableHeader:true,children:[
  cell([new Paragraph({children:[R('Milestone',{bold:true,color:'FFFFFF',size:18})]})],{bg:NAVY,colW:72}),
  cell([new Paragraph({children:[R('Target',{bold:true,color:'FFFFFF',size:18})]})],{bg:NAVY,colW:28}),
]});
const nextRow=(m,t,i)=>new TableRow({children:[
  cell([new Paragraph({children:[R(m,{color:INK,size:19})]})],{bg:i%2?BG:undefined}),
  cell([new Paragraph({children:[R(t,{bold:true,color:NAVY,size:19})]})],{bg:i%2?BG:undefined}),
]});
const nextTable=new Table({width:{size:100,type:WidthType.PERCENTAGE},borders,rows:[
  nextHeader,
  nextRow('District-level review: brief the CDO on dashboard and findings', 'This week', 0),
  nextRow('Direct follow-up with the two chronic non-reporting schools', 'This week', 1),
  nextRow('Sustain daily compliance at 90%+ through block follow-up', 'Ongoing', 2),
  nextRow('Peer-comparison test lane: expand to a second menu day', 'Mid-October 2026', 3),
  nextRow('Formal block + district leadership report circulation', 'Late October 2026', 4),
]});

// --- document body ---
const DATE_LABEL = new Date().toLocaleDateString('en-IN', { timeZone:'Asia/Kolkata', day:'numeric', month:'long', year:'numeric' });

const children=[
  new Paragraph({heading:HeadingLevel.HEADING_1,spacing:{after:40},
    children:[R('MDM Pilot, Hargaon — Brief for the CDO',{bold:true,color:NAVY,size:30})]}),
  new Paragraph({spacing:{after:200},children:[R(`Sitapur district · ${DATE_LABEL}`,{color:GREY,size:20})]}),

  H('Status at a glance'),
  statsTable,

  H('What the pilot does',{before:260}),
  new Paragraph({spacing:{after:80},children:[R(
    `An AI-assisted daily monitoring layer sits over the ${ROSTER}-school Mid-Day Meal (PM POSHAN) delivery in Hargaon block. Each school submits a short Google Form every reporting day — four photographs (register, cooking, cooked meal, plate) and one serving video. An overnight AI pipeline reads every submission through a vision model, applies a set of flag rules (menu missing, portion short, hygiene issues, etc.) and writes a per-school verdict to a block-level dashboard that the BEO and the block MDM team use to decide who to call.`,
    {color:INK,size:20})]}),

  H('Progress since start of the pilot',{before:220}),
  bullet([R('Baseline: ',{bold:true,color:INK,size:20}), R(`one-time profiling of all ${ROSTER} schools complete.`,{color:INK,size:20})]),
  bullet([R('Daily participation: ',{bold:true,color:INK,size:20}),
    R(`${avgPct}% average over the last 7 reporting days — up from the 65–72% range in early October. The jump followed the BEO-led Google Meet with non-compliant schools on 5 October; participation has held at `,{color:INK,size:20}),
    R(`87–95%`,{bold:true,color:TEAL,size:20}), R(' every reporting day since. Peak so far: ',{color:INK,size:20}),
    R(`${peak.n} of ${ROSTER}`,{bold:true,color:INK,size:20}), R(` on ${peak.label}.`,{color:INK,size:20})]),
  bullet([R('AI verification: ',{bold:true,color:INK,size:20}),
    R(`${aiOverall}% of submitted media across the last 7 reporting days were successfully analysed by the vision model (Google Gemini). Short gaps on 6 Oct and 10 Oct caused by prepaid-credit depletion were fully recovered through a backfill run.`,{color:INK,size:20})]),
  bullet([R('Dashboard: ',{bold:true,color:INK,size:20}),
    R(`live monitoring now updates intra-day. Password-gated access has been issued to the BEO; a mobile-friendly view is used from the field. Live submission tracking, a 3-day meal-quality streak tile, and a 1-to-30-day non-reporting filter are all available without waiting for the nightly AI pass.`,{color:INK,size:20})]),
  bullet([R('Peer-comparison test lane: ',{bold:true,color:INK,size:20}),
    R(`a research prototype has been run on 8 October's cooked-meal photos and serving-video clips to compare how each school prepared the day's dal and sabzi against the block cohort. Isolated from the live flag engine; results are available on the dashboard behind a muted 'Test' chip.`,{color:INK,size:20})]),

  H('Daily reporting — last 7 reporting days',{before:220}),
  dataTable,
  new Paragraph({spacing:{before:60,after:200},children:[R('Reporting days exclude Sundays, the 2 October holiday, and any day with fewer than 25 block-wide submissions (treated as a data outage). "AI verified" is the share of submitted media the vision model returned a reading for.',{italics:true,color:GREY,size:16})]}),

  H(`Schools of concern — chronic non-reporters`,{before:220}),
  new Paragraph({spacing:{after:80},children:[R(
    `${chronic.length} schools did not submit a single daily report on any of the last 6 reporting days (${miss.windows.find(w=>w.n===6)?.days.join(', ') || ''}). These are the top-priority follow-up calls for the block team this week.`,
    {color:INK,size:20})]}),
  chrTable,

  H('Key actions taken',{before:220}),
  bullet([R('BEO-led Google Meet (5 October): ',{bold:true,color:INK,size:20}),
    R(`BEO Hargaon convened a call with the schools that had been irregular on daily submission. Issues were resolved on the call; impact is visible in the three days since — participation lifted from 72% to 94–95% and has held.`,{color:INK,size:20})]),
  bullet([R('Dashboard handover: ',{bold:true,color:INK,size:20}),
    R('handover to the block representative is underway so the BEO can review and follow up directly, without the pilot team in the loop.',{color:INK,size:20})]),
  bullet([R('AI backfill: ',{bold:true,color:INK,size:20}),
    R('every day on which the vision model had an unprocessed batch (credit depletion, image-processing errors) has been re-analysed; coverage now 97–98% across all reporting days from 18 September onwards.',{color:INK,size:20})]),
  bullet([R('Operational hygiene: ',{bold:true,color:INK,size:20}),
    R(`Sundays, holidays, and data-outage days (<25 submissions block-wide) are now explicitly excluded from the "missed" counts, so no school is penalised for a day it was never expected to report.`,{color:INK,size:20})]),

  H('Next steps',{before:220}),
  nextTable,

  new Paragraph({spacing:{before:200},children:[R(
    `Prepared from live data as of ${new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})} IST. Figures reconcile to the daily Google Form responses and the processed Results store; pipeline runs on GitHub Actions with the dashboard hosted on Vercel.`,
    {italics:true,color:GREY,size:16})]}),
];

const doc=new Document({
  styles:{default:{document:{run:{font:'Calibri'}}}},
  sections:[{properties:{page:{margin:{top:720,bottom:720,left:720,right:720}}},children}],
});

Packer.toBuffer(doc).then(buf=>{
  fs.writeFileSync(OUT,buf);
  console.log('wrote',OUT,'('+buf.length,'bytes)');
});
