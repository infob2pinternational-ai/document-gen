import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadTsModule(relativePath, stubs = {}) {
  const code = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  let { outputText } = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext }
  });

  for (const [specifier, stubCode] of Object.entries(stubs)) {
    const dataUri = `data:text/javascript;base64,${Buffer.from(stubCode).toString('base64')}`;
    outputText = outputText.replaceAll(`'${specifier}'`, JSON.stringify(dataUri));
    outputText = outputText.replaceAll(`"${specifier}"`, JSON.stringify(dataUri));
  }

  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

const { 
  getKolkataToday, 
  getKolkataWeekRange, 
  shiftKolkataWeek, 
  formatKolkataDisplayDate 
} = await loadTsModule('../src/utils/dateUtils.ts');

const {
  categorizeFeedback,
  normalizeExcelPhone,
  normalizeExcelDate
} = await loadTsModule('../src/utils/excelImport.ts', {
  'jszip': 'export default {};',
  './dateUtils': 'export function getKolkataToday() { return "2026-09-22"; }'
});

const {
  buildDailyReportWhatsAppMessage,
  buildWeeklyReportWhatsAppMessage
} = await loadTsModule('../src/utils/telecallingShare.ts', {
  './whatsappShare': 'export function normalizeIndianPhone(p) { return p.replace(/\\D/g, ""); }',
  './dateUtils': 'export function formatKolkataDisplayDate(d) { return d; }'
});

// ─── 1. Asia/Kolkata Date & Week Range Tests ─────────────────────────────────

test('getKolkataToday returns a valid ISO date YYYY-MM-DD', () => {
  const today = getKolkataToday();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
});

test('getKolkataWeekRange accurately sets Monday as start and Sunday as end', () => {
  // 2026-09-22 is a Tuesday
  const week = getKolkataWeekRange('2026-09-22');
  assert.equal(week.startDate, '2026-09-21', 'Monday should be 2026-09-21');
  assert.equal(week.endDate, '2026-09-27', 'Sunday should be 2026-09-27');
  assert.equal(week.days.length, 7);
  assert.equal(week.days[0].dayName, 'Mon');
  assert.equal(week.days[6].dayName, 'Sun');
});

test('shiftKolkataWeek correctly jumps by 7 days forward and backward', () => {
  const nextWeekMonday = shiftKolkataWeek('2026-09-21', 1);
  assert.equal(nextWeekMonday, '2026-09-28');

  const prevWeekMonday = shiftKolkataWeek('2026-09-21', -1);
  assert.equal(prevWeekMonday, '2026-09-14');
});

test('formatKolkataDisplayDate formats dates into human-readable representation', () => {
  const formatted = formatKolkataDisplayDate('2026-09-22');
  assert.match(formatted, /22.*Sep.*2026/i);
});

// ─── 2. Excel Import & Feedback Categorization Tests ─────────────────────────

test('categorizeFeedback maps real-world spreadsheet feedback to standard statuses', () => {
  assert.equal(categorizeFeedback('appointment confirm - next week 22'), 'Appointment Confirmed');
  assert.equal(categorizeFeedback('sent details of pachakarani event'), 'Interested / Details Shared');
  assert.equal(categorizeFeedback('sent mail'), 'Interested / Details Shared');
  assert.equal(categorizeFeedback('followup next week'), 'Follow-up Required');
  assert.equal(categorizeFeedback('call back'), 'Call Back');
  assert.equal(categorizeFeedback('currently bc'), 'Call Back');
  assert.equal(categorizeFeedback('no intrest'), 'No Interest');
  assert.equal(categorizeFeedback('in house team available'), 'No Interest');
  assert.equal(categorizeFeedback('no response'), 'No Answer / No Response');
  assert.equal(categorizeFeedback('no answer'), 'No Answer / No Response');
  assert.equal(categorizeFeedback('switch off'), 'Not Reachable / Switched Off');
  assert.equal(categorizeFeedback('out of service'), 'Not Reachable / Switched Off');
  assert.equal(categorizeFeedback('invalid'), 'Wrong / Invalid Number');
  assert.equal(categorizeFeedback('wrong number'), 'Wrong / Invalid Number');
  assert.equal(categorizeFeedback('dubai office'), 'Other');
});

test('normalizeExcelPhone strips trailing .0 and cleans formatted numbers', () => {
  assert.equal(normalizeExcelPhone(9447780000.0), '9447780000');
  assert.equal(normalizeExcelPhone('9447994456 ,9846413666'), '9447994456');
  assert.equal(normalizeExcelPhone('0484-4000544'), '0484-4000544');
});

test('normalizeExcelDate parses Indian DD-MM-YYYY format and ISO format', () => {
  assert.equal(normalizeExcelDate('14-09-2026'), '2026-09-14');
  assert.equal(normalizeExcelDate('2026-09-14'), '2026-09-14');
  assert.equal(normalizeExcelDate('14/09/2026'), '2026-09-14');
});

// ─── 3. WhatsApp Report Generation Tests ─────────────────────────────────────

test('buildDailyReportWhatsAppMessage outputs required format with dynamic status counts', () => {
  const dummyReport = {
    date: '2026-09-22',
    totalCalls: 35,
    uniqueCompanies: 30,
    statusCounts: {
      'Appointment Confirmed': 3,
      'Interested / Details Shared': 8,
      'Follow-up Required': 10,
      'Call Back': 2,
      'No Answer / No Response': 7,
      'No Interest': 5,
      'Not Reachable / Switched Off': 0,
      'Wrong / Invalid Number': 0,
      'Other': 0
    },
    telecallerActivity: {
      Franson: 35
    },
    followUpsCount: 12,
    entries: []
  };

  const msg = buildDailyReportWhatsAppMessage('B2P INTERNATIONAL', dummyReport);
  assert.match(msg, /B2P INTERNATIONAL/);
  assert.match(msg, /TELECALLING DAILY REPORT/);
  assert.match(msg, /Total Calls:\s*35/);
  assert.match(msg, /Appointment Confirmed:\s*3/);
  assert.match(msg, /Interested \/ Details Shared:\s*8/);
  assert.match(msg, /Follow-up Required:\s*10/);
  assert.match(msg, /Franson:\s*35/);
  assert.match(msg, /Generated from B2P ONE/);
});

test('buildWeeklyReportWhatsAppMessage formats week range and breakdowns', () => {
  const dummyWeekly = {
    startDate: '2026-09-14',
    endDate: '2026-09-20',
    totalCalls: 120,
    uniqueCompanies: 110,
    statusCounts: {
      'Appointment Confirmed': 5,
      'Interested / Details Shared': 25,
      'Follow-up Required': 20,
      'Call Back': 10,
      'No Answer / No Response': 40,
      'No Interest': 15,
      'Not Reachable / Switched Off': 5,
      'Wrong / Invalid Number': 0,
      'Other': 0
    },
    dailyBreakdown: [
      { date: '2026-09-14', dayName: 'Mon', totalCalls: 40, statusCounts: {} },
      { date: '2026-09-15', dayName: 'Tue', totalCalls: 30, statusCounts: {} }
    ],
    telecallerBreakdown: {
      Franson: { total: 120, statusCounts: {} }
    },
    followUpsCount: 30,
    entries: []
  };

  const msg = buildWeeklyReportWhatsAppMessage('B2P INTERNATIONAL', dummyWeekly);
  assert.match(msg, /TELECALLING WEEKLY REPORT/);
  assert.match(msg, /Total Calls:\s*120/);
  assert.match(msg, /Franson:\s*120 calls/);
});
