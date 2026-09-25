import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import dailyReportHandler, {
  formatDailyReportMessage,
  formatStaffIndividualReport,
  buildStaffRecordsMap,
  formatDocTypeLabel,
  formatAmount,
  formatISTTime
} from '../api/daily-report.js';

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

// Mock localStorage for node environment
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
}

const {
  getOwnerWhatsAppNumber,
  setOwnerWhatsAppNumber,
  DEFAULT_OWNER_WHATSAPP_NUMBER,
  isOwnerAutoReportEnabled,
  setOwnerAutoReportEnabled,
  getOwnerAutoReportTime,
  setOwnerAutoReportTime
} = await loadTsModule('../src/utils/telecallingShare.ts', {
  './whatsappShare': 'export function normalizeIndianPhone(p) { return String(p).replace(/\\D/g, ""); }',
  './dateUtils': 'export function formatKolkataDisplayDate(d) { return d; }',
  '../types': 'export function isUnresolvedStatus(s) { return ["Follow-up Required", "Call Back"].includes(s); }'
});

test('formatDailyReportMessage formats valid B2P WhatsApp text with status counts and telecallers', () => {
  const dummyReport = {
    date: '2026-09-25',
    totalCalls: 28,
    uniqueCompanies: 22,
    statusCounts: {
      'Appointment Confirmed': 5,
      'Interested / Details Shared': 7,
      'Follow-up Required': 4,
      'Call Back': 2,
      'No Answer / No Response': 6,
      'No Interest': 3,
      'Not Reachable / Switched Off': 1,
      'Wrong / Invalid Number': 0,
      'Other': 0
    },
    telecallerActivity: {
      Franson: 18,
      Staff: 10
    },
    followUpsCount: 6,
    unresolvedCallsCount: 13,
    entries: []
  };

  const message = formatDailyReportMessage('B2P INTERNATIONAL', dummyReport);

  assert.ok(message.includes('*B2P INTERNATIONAL*'));
  assert.ok(message.includes('*TELECALLING DAILY REPORT*'));
  assert.ok(message.includes('Total Calls: 28'));
  assert.ok(message.includes('Unique Companies: 22'));
  assert.ok(message.includes('Unresolved Calls: 13'));
  assert.ok(message.includes('1. Appointment Confirmed: 5'));
  assert.ok(message.includes('2. Interested / Details Shared: 7'));
  assert.ok(message.includes('Franson: 18'));
  assert.ok(message.includes('*Follow-ups Due Today:* 6'));
  assert.ok(message.includes('Generated from B2P ONE'));
});

test('OPTIONS /api/daily-report returns 200 with CORS headers', async () => {
  let statusCode = 0;
  let ended = false;
  const headers = {};

  const req = { method: 'OPTIONS', query: {}, headers: {} };
  const res = {
    setHeader: (k, v) => { headers[k] = v; },
    status: (c) => {
      statusCode = c;
      return { end: () => { ended = true; } };
    }
  };

  await dailyReportHandler(req, res);
  assert.equal(statusCode, 200);
  assert.equal(ended, true);
  assert.equal(headers['Access-Control-Allow-Origin'], '*');
});

test('POST /api/daily-report rejects sending to business own sender number (+91 81390 09034)', async () => {
  let statusCode = 0;
  let jsonResult = null;

  const req = {
    method: 'POST',
    query: { action: 'send-report' },
    headers: {},
    body: {
      phone: '918139009034'
    }
  };
  const res = {
    setHeader: () => {},
    status: (c) => {
      statusCode = c;
      return { json: (d) => { jsonResult = d; } };
    }
  };

  await dailyReportHandler(req, res);
  assert.equal(statusCode, 400);
  assert.equal(jsonResult.success, false);
  assert.match(jsonResult.error, /Cannot send WhatsApp report to the business's own sender number/);
});

test('Owner WhatsApp settings defaults to 918589909034 and persists in localStorage', () => {
  setOwnerWhatsAppNumber('');
  assert.equal(getOwnerWhatsAppNumber(), DEFAULT_OWNER_WHATSAPP_NUMBER);
  assert.equal(DEFAULT_OWNER_WHATSAPP_NUMBER, '918589909034');

  setOwnerWhatsAppNumber('9847099999');
  assert.equal(getOwnerWhatsAppNumber(), '9847099999');

  setOwnerWhatsAppNumber('');
  assert.equal(getOwnerWhatsAppNumber(), DEFAULT_OWNER_WHATSAPP_NUMBER);
});

test('Owner Auto-Report schedule preferences toggle and persist correctly', () => {
  setOwnerAutoReportEnabled(true);
  assert.equal(isOwnerAutoReportEnabled(), true);

  setOwnerAutoReportEnabled(false);
  assert.equal(isOwnerAutoReportEnabled(), false);

  setOwnerAutoReportTime('19:30');
  assert.equal(getOwnerAutoReportTime(), '19:30');

  setOwnerAutoReportEnabled(true);
  setOwnerAutoReportTime('18:30');
  assert.equal(getOwnerAutoReportTime(), '18:30');
});

test('formatDailyReportMessage includes detailed breakdown for both staff Shiva and Brutt and CRM follow-ups', () => {
  const dummyReportWithStaff = {
    date: '2026-09-25',
    totalCalls: 30,
    uniqueCompanies: 25,
    statusCounts: {
      'Appointment Confirmed': 4,
      'Interested / Details Shared': 8,
      'Follow-up Required': 6,
      'Call Back': 2,
      'No Answer / No Response': 5,
      'No Interest': 4,
      'Not Reachable / Switched Off': 1,
      'Wrong / Invalid Number': 0,
      'Other': 0
    },
    telecallerActivity: {
      'Shiva': 18,
      'Brutt': 12
    },
    followUpsCount: 4,
    followUpsDueToday: 4,
    overdueFollowUpsCount: 8,
    followUpsDueTodayList: [
      { customer_name: 'manu', company_name: 'Synrah Study Abroad', phone: '7907778028', reason: 'Follow up on Other Advertising', assigned_staff_email: 'brutf5354@gmail.com' },
      { customer_name: 'jineesh', company_name: 'Lakshya', phone: '7994505554', reason: 'sent our marketing services details', assigned_staff_email: 'brutf5354@gmail.com' },
      { customer_name: 'noushad -', company_name: 'Rajakumari', phone: '9349950349', reason: 'sent details our marketting services', assigned_staff_email: 'brutf5354@gmail.com' },
      { customer_name: 'muhammed shahin', company_name: 'pavan masala', phone: '9446488600', reason: 'marketing head not sent a updation', assigned_staff_email: 'brutf5354@gmail.com' }
    ],
    overdueFollowUpsList: [
      { customer_name: 'Overdue Client 1', company_name: 'Past Tech', phone: '9847000001', reason: 'Quotation discussion', assigned_staff_email: 'brutf5354@gmail.com' }
    ],
    unresolvedCallsCount: 14,
    entries: [
      {
        created_by_name: 'Shiva',
        created_by_email: 'sivasatheesan33@gmail.com',
        call_status: 'Appointment Confirmed',
        company_name: 'Cochin Spices',
        phone: '9847011111'
      },
      {
        created_by_name: 'Shiva',
        created_by_email: 'sivasatheesan33@gmail.com',
        call_status: 'Follow-up Required',
        company_name: 'Malabar Logistics',
        phone: '9847022222',
        feedback: 'Wants 5 vans in Thrissur'
      },
      {
        created_by_name: 'Brutt',
        created_by_email: 'brutf5354@gmail.com',
        call_status: 'Interested / Details Shared',
        company_name: 'Skyline Homes',
        phone: '9847033333'
      },
      {
        created_by_name: 'Brutt',
        created_by_email: 'brutf5354@gmail.com',
        call_status: 'Call Back',
        company_name: 'Royal Jewellers',
        phone: '9847044444',
        feedback: 'Call back Monday 10am'
      }
    ]
  };

  const message = formatDailyReportMessage('B2P INTERNATIONAL', dummyReportWithStaff);

  assert.ok(message.includes('STAFF DETAILED BREAKDOWN'));
  assert.ok(message.includes('SHIVA'));
  assert.ok(message.includes('sivasatheesan33@gmail.com'));
  assert.ok(message.includes('BRUTT'));
  assert.ok(message.includes('brutf5354@gmail.com'));
  assert.ok(message.includes('Malabar Logistics'));
  assert.ok(message.includes('Royal Jewellers'));
  assert.ok(message.includes('*Follow-ups Due Today:* 4'));
  assert.ok(message.includes('Synrah Study Abroad'));
  assert.ok(message.includes('*previouse follow up not done =* 8'));
});

test('formatStaffIndividualReport formats standalone report with active window, telecalling, documents with URLs, completed/rescheduled follow-ups', () => {
  const staffData = {
    label: 'BRUTT (Brutf5354)',
    email: 'brutf5354@gmail.com',
    total: 10,
    confirmed: 2,
    interested: 3,
    followUp: 2,
    callBack: 1,
    noAnswer: 1,
    switchedOff: 1,
    noInterest: 0,
    wrongNumber: 0,
    timeline: ['2026-09-25T05:30:00.000Z', '2026-09-25T14:45:00.000Z'],
    unresolved: [
      { company: 'Acme Traders', phone: '9847111222', status: 'Call Back', remarks: 'Busy in meeting' }
    ],
    documents: [
      {
        id: 'doc-uuid-1234',
        document_type: 'quotation',
        document_number: 'QT-2026-0901',
        customer_name: 'Kerala Spices Ltd',
        total: 45000,
        approval_status: 'Approved'
      },
      {
        id: 'doc-uuid-5678',
        document_type: 'invoice',
        document_number: 'INV-2026-0042',
        customer_name: 'Thrissur Logistics',
        total: 120000,
        approval_status: 'Sent'
      }
    ],
    completedFollowUps: [
      {
        customer_name: 'SYNERGY',
        phone: '9847001122',
        completed_at: '2026-09-25T07:15:00.000Z',
        completion_note: 'Discussed campaign; sending proposal tomorrow'
      }
    ],
    rescheduledFollowUps: [
      {
        customer_name: 'Oro Gold',
        phone: '9847003344',
        due_date: '2026-09-28',
        notes: 'Requested call after weekend'
      }
    ],
    dueToday: [],
    overdue: []
  };

  const reportText = formatStaffIndividualReport(staffData, 'B2P INTERNATIONAL', '2026-09-25', false);

  assert.ok(reportText.includes('DAILY STAFF PERFORMANCE REPORT'));
  assert.ok(reportText.includes('BRUTT (Brutf5354)'));
  assert.ok(reportText.includes('brutf5354@gmail.com'));
  assert.ok(reportText.includes('⏱️ *Active Window:*'));
  assert.ok(reportText.includes('TELECALLING CALLS (10)'));
  assert.ok(reportText.includes('• Confirmed: 2 | Interested: 3'));
  assert.ok(reportText.includes('DOCUMENTS / QUOTES / INVOICES (2)'));
  assert.ok(reportText.includes('Quotation #QT-2026-0901'));
  assert.ok(reportText.includes('https://b2pinternational.com/doc/doc-uuid-1234'));
  assert.ok(reportText.includes('Tax Invoice #INV-2026-0042'));
  assert.ok(reportText.includes('₹1,20,000'));
  assert.ok(reportText.includes('CRM FOLLOW-UPS COMPLETED (1)'));
  assert.ok(reportText.includes('SYNERGY'));
  assert.ok(reportText.includes('Discussed campaign; sending proposal tomorrow'));
  assert.ok(reportText.includes('FOLLOW-UPS RESCHEDULED / SNOOZED (1)'));
  assert.ok(reportText.includes('Oro Gold'));
  assert.ok(reportText.includes('28 Sep 2026'));
  assert.ok(reportText.includes('Generated from B2P ONE'));
});

test('formatDailyReportMessage formats evening/night report header and documents count', () => {
  const dummyReport = {
    date: '2026-09-25',
    totalCalls: 15,
    uniqueCompanies: 12,
    statusCounts: { 'Appointment Confirmed': 3 },
    telecallerActivity: { 'Shiva': 10, 'Brutt': 5 },
    followUpsCount: 2,
    followUpsDueToday: 2,
    overdueFollowUpsCount: 3,
    completedFollowUpsCount: 4,
    rescheduledFollowUpsCount: 2,
    documentsCount: 3,
    entries: []
  };

  const nightMessage = formatDailyReportMessage('B2P INTERNATIONAL', dummyReport, true);

  assert.ok(nightMessage.includes('TELECALLING & OPERATIONS NIGHT REPORT (Post 6:30 PM)'));
  assert.ok(nightMessage.includes('Documents Generated: 3'));
  assert.ok(nightMessage.includes('Follow-ups Completed Today: 4'));
  assert.ok(nightMessage.includes('Follow-ups Rescheduled / Snoozed: 2'));
  assert.ok(nightMessage.includes('Detailed individual reports for each staff account are dispatched separately below.'));
});

test('buildStaffRecordsMap attributes documents and CRM follow-ups to correct staff', () => {
  const mockReport = {
    date: '2026-09-25',
    totalCalls: 2,
    uniqueCompanies: 2,
    statusCounts: {},
    telecallerActivity: {},
    entries: [
      {
        created_by_email: 'sivasatheesan33@gmail.com',
        call_status: 'Appointment Confirmed',
        company_name: 'Alpha Ltd'
      },
      {
        created_by_email: 'brutf5354@gmail.com',
        call_status: 'Interested / Details Shared',
        company_name: 'Beta LLC'
      }
    ],
    documentsList: [
      {
        id: 'doc-1',
        document_type: 'invoice',
        document_number: 'INV-1',
        created_by_email: 'sivasatheesan33@gmail.com',
        total: 50000
      },
      {
        id: 'doc-2',
        document_type: 'quotation',
        document_number: 'QT-2',
        created_by_email: 'brutf5354@gmail.com',
        total: 75000
      }
    ],
    completedFollowUpsList: [
      {
        customer_name: 'Gamma Stores',
        assigned_staff_email: 'brutf5354@gmail.com',
        completion_note: 'Order finalized'
      }
    ],
    rescheduledFollowUpsList: [
      {
        customer_name: 'Delta Mart',
        assigned_staff_email: 'sivasatheesan33@gmail.com',
        due_date: '2026-09-27'
      }
    ]
  };

  const { staffRecords } = buildStaffRecordsMap(mockReport);

  assert.equal(staffRecords['shiva'].total, 1);
  assert.equal(staffRecords['shiva'].documents.length, 1);
  assert.equal(staffRecords['shiva'].documents[0].document_number, 'INV-1');
  assert.equal(staffRecords['shiva'].rescheduledFollowUps.length, 1);

  assert.equal(staffRecords['brutt'].total, 1);
  assert.equal(staffRecords['brutt'].documents.length, 1);
  assert.equal(staffRecords['brutt'].documents[0].document_number, 'QT-2');
  assert.equal(staffRecords['brutt'].completedFollowUps.length, 1);
  assert.equal(staffRecords['brutt'].completedFollowUps[0].customer_name, 'Gamma Stores');
});

test('Night slot cron skips dispatching when no activity exists after 6:30 PM IST (13:00 UTC)', async () => {
  let statusCode = 0;
  let jsonResult = null;

  const req = {
    method: 'GET',
    query: { action: 'cron', slot: 'night', date: '2026-09-24' },
    headers: { 'x-vercel-cron': '1' }
  };
  const res = {
    setHeader: () => {},
    status: (c) => {
      statusCode = c;
      return { json: (d) => { jsonResult = d; } };
    }
  };

  // Pre-feed report_data with activity strictly before 13:00 UTC
  req.body = {
    report_data: {
      date: '2026-09-24',
      totalCalls: 5,
      uniqueCompanies: 5,
      statusCounts: {},
      telecallerActivity: {},
      entries: [
        { created_at: '2026-09-24T08:00:00.000Z', call_status: 'Appointment Confirmed' }
      ],
      documentsList: [
        { created_at: '2026-09-24T10:00:00.000Z', document_type: 'invoice', total: 1000 }
      ],
      completedFollowUpsList: [
        { completed_at: '2026-09-24T11:00:00.000Z', customer_name: 'Early Client' }
      ],
      rescheduledFollowUpsList: []
    }
  };

  await dailyReportHandler(req, res);

  assert.equal(statusCode, 200);
  assert.equal(jsonResult.success, true);
  assert.equal(jsonResult.skipped, true);
  assert.match(jsonResult.message, /No activity logged after 6:30 PM IST/);
});

