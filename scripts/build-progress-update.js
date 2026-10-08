// Build the "MDM Pilot — Progress Update" one-pager (V2) as a .docx.
// Styled to mirror the V1 PDF: title, status-at-a-glance stat tiles, progress
// section, 7-day reporting-rate table, actions taken, next-steps table.
import fs from 'node:fs';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, HeightRule,
} from 'docx';

const NAVY='1F3864', GREY='595959', INK='2A2E36', TEAL='1A7F6B', GOLD='B88316', RED='B4341B', HAIR='D9DEE6', BG='F2F5FA';
const OUT=process.env.OUT || 'MDM_ProgressUpdate_V2.docx';

// --- small helpers ---
const R=(text,opts={})=>new TextRun({text,...opts});
const P=(runs,opts={})=>new Paragraph({children:Array.isArray(runs)?runs:[runs],spacing:{after:opts.after??100,before:opts.before??0},alignment:opts.align,indent:opts.indent});
const H=(text,{color=NAVY,size=22,before=120,after=80}={})=>new Paragraph({spacing:{before,after},children:[R(text,{bold:true,color,size})]});
const bullet=(runs)=>new Paragraph({bullet:{level:0},spacing:{after:60},children:Array.isArray(runs)?runs:[runs]});
const cell=(children,{bg,align=AlignmentType.LEFT,colW,bold=false,color}={})=>new TableCell({
  width:colW?{size:colW,type:WidthType.PERCENTAGE}:undefined,
  shading:bg?{type:ShadingType.CLEAR,fill:bg,color:'auto'}:undefined,
  margins:{top:80,bottom:80,left:120,right:120},
  children:Array.isArray(children)?children:[new Paragraph({alignment:align,children:Array.isArray(children)?children:[children]})],
});
const thin={style:BorderStyle.SINGLE,size:4,color:HAIR};
const borders={top:thin,bottom:thin,left:thin,right:thin,insideHorizontal:thin,insideVertical:thin};
const noBorder={style:BorderStyle.NONE,size:0,color:'FFFFFF'};
const bordersNone={top:noBorder,bottom:noBorder,left:noBorder,right:noBorder,insideHorizontal:noBorder,insideVertical:noBorder};

// --- status-at-a-glance tiles (3 columns, borderless) ---
function statTile(big, bigColor, label, sub){
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
  width:{size:100,type:WidthType.PERCENTAGE},
  borders:bordersNone,
  rows:[new TableRow({children:[
    statTile('195 / 195', NAVY, 'Schools profiled', 'Baseline complete'),
    statTile('Day 15', TEAL, 'Daily reporting live', 'Since 18 September'),
    statTile('~83%', GOLD, 'Avg daily participation', 'last 7 reporting days'),
  ]})],
});

// --- 7-day reporting-rate table ---
const DAYS=[
  { label:'Tue 30 Sept', n:140, pct:72, note:'' },
  { label:'Wed 1 Oct',   n:127, pct:65, note:'' },
  { label:'Fri 3 Oct',   n:141, pct:72, note:'' },
  { label:'Sun 5 Oct',   n:172, pct:88, note:'BEO meeting with non-compliant schools' },
  { label:'Mon 6 Oct',   n:183, pct:94, note:'' },
  { label:'Tue 7 Oct',   n:184, pct:94, note:'' },
  { label:'Wed 8 Oct ★', n:186, pct:95, note:'highest participation to date' },
];
const headerRow=new TableRow({tableHeader:true,children:[
  cell([new Paragraph({children:[R('Date',{bold:true,color:'FFFFFF',size:18})]})],{bg:NAVY,colW:22}),
  cell([new Paragraph({alignment:AlignmentType.CENTER,children:[R('Schools submitted',{bold:true,color:'FFFFFF',size:18})]})],{bg:NAVY,colW:20,align:AlignmentType.CENTER}),
  cell([new Paragraph({alignment:AlignmentType.CENTER,children:[R('Share of 195',{bold:true,color:'FFFFFF',size:18})]})],{bg:NAVY,colW:18,align:AlignmentType.CENTER}),
  cell([new Paragraph({children:[R('Notes',{bold:true,color:'FFFFFF',size:18})]})],{bg:NAVY,colW:40}),
]});
const bodyRows=DAYS.map((d,i)=>{
  const bg = i%2 ? BG : undefined;
  const pctColor = d.pct>=90 ? TEAL : d.pct>=75 ? GOLD : RED;
  return new TableRow({children:[
    cell([new Paragraph({children:[R(d.label,{bold:true,color:INK,size:19})]})],{bg}),
    cell([new Paragraph({alignment:AlignmentType.CENTER,children:[R(String(d.n),{color:INK,size:19})]})],{bg}),
    cell([new Paragraph({alignment:AlignmentType.CENTER,children:[R(d.pct+'%',{bold:true,color:pctColor,size:19})]})],{bg}),
    cell([new Paragraph({children:[R(d.note,{color:GREY,size:18,italics:!!d.note})]})],{bg}),
  ]});
});
const dataTable=new Table({width:{size:100,type:WidthType.PERCENTAGE},borders,rows:[headerRow,...bodyRows]});

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
  nextRow('Sustain daily compliance in the 90%+ range through block follow-up','Ongoing',0),
  nextRow('Complete dashboard handover to block representative','This week',1),
  nextRow('Begin circulation of the block / district leadership report','Mid-October 2026',2),
]});

const children=[
  new Paragraph({heading:HeadingLevel.HEADING_1,spacing:{after:40},
    children:[R('MDM Pilot, Hargaon — Progress Update',{bold:true,color:NAVY,size:30})]}),
  new Paragraph({spacing:{after:200},children:[R('Sitapur district · 8 October 2026',{color:GREY,size:20})]}),

  H('Status at a glance'),
  statsTable,

  H('Progress since last update',{before:260}),
  bullet([R('Daily reporting: ',{bold:true,color:INK,size:20}),
    R('submission rates have jumped from the 65–72% range in early October to a consistent ',{color:INK,size:20}),
    R('94–95%',{bold:true,color:TEAL,size:20}),
    R(' over the past three days, following the BEO-led intervention on 5 October. 8 October recorded the highest participation to date (',{color:INK,size:20}),
    R('186 / 195',{bold:true,color:INK,size:20}),
    R(').',{color:INK,size:20})]),
  bullet([R('School profiling: ',{bold:true,color:INK,size:20}),
    R('all 195 schools remain complete on the one-time baseline data collection.',{color:INK,size:20})]),
  bullet([R('Dashboard: ',{bold:true,color:INK,size:20}),
    R('live monitoring now updates through the day — intra-day submission tracking and a non-reporting-schools list are available to the block team without waiting for the evening AI run.',{color:INK,size:20})]),

  H('Daily reporting — last 7 reporting days',{before:220}),
  dataTable,
  new Paragraph({spacing:{before:60,after:200},children:[R('Reporting days exclude Sundays and the 2 October holiday. Share of 195 = schools that submitted the daily Google Form that day.',{italics:true,color:GREY,size:16})]}),

  H('Key actions taken'),
  bullet([R('BEO-led Google Meet with non-compliant schools (5 October): ',{bold:true,color:INK,size:20}),
    R('BEO Hargaon convened a call with schools that had been irregular in daily submission. Key queries were addressed and all schools were directed to ensure ',{color:INK,size:20}),
    R('100% daily compliance',{bold:true,color:INK,size:20}),
    R(' going forward. The impact is visible in the three days since: participation lifted from 72% to 94–95% and has held there.',{color:INK,size:20})]),
  bullet([R('Dashboard handover: ',{bold:true,color:INK,size:20}),
    R('handover of the live monitoring dashboard to the block-level representative is underway, enabling regular review and direct follow-up with schools.',{color:INK,size:20})]),
  bullet([R('Flagging system: ',{bold:true,color:INK,size:20}),
    R('AI-driven meal-quality flagging continues to be fine-tuned; red flags are now consistently in single digits per day. Finalisation is on track as submission rates stabilise.',{color:INK,size:20})]),

  H('Next steps',{before:220}),
  nextTable,
];

const doc=new Document({
  styles:{default:{document:{run:{font:'Calibri'}}}},
  sections:[{
    properties:{page:{margin:{top:720,bottom:720,left:720,right:720}}},
    children,
  }],
});

Packer.toBuffer(doc).then(buf=>{
  fs.writeFileSync(OUT,buf);
  console.log('wrote',OUT,'('+buf.length,'bytes)');
});
