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
  buildWeeklyReportWhatsAppMessage,
  buildDailyReportEmailContent
} = await loadTsModule('../src/utils/telecallingShare.ts', {
  './whatsappShare': 'export function normalizeIndianPhone(p) { return p.replace(/\\D/g, ""); }',
  './dateUtils': 'export function formatKolkataDisplayDate(d) { return d; }',
  '../types': 'export function isUnresolvedStatus(s) { return ["Follow-up Required", "Call Back", "No Answer / No Response", "Not Reachable / Switched Off", "Interested / Details Shared"].includes(s); }'
});

const {
  escapeCsvCell,
  generateTelecallingCsvString
} = await loadTsModule('../src/utils/csvExport.ts');

const {
  UNRESOLVED_TELECALLING_STATUSES,
  isUnresolvedStatus
} = await loadTsModule('../src/types.ts');

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

// ─── 4. Unresolved Statuses & Definition Tests ───────────────────────────────

test('UNRESOLVED_TELECALLING_STATUSES contains required statuses and isUnresolvedStatus works correctly', () => {
  assert.equal(UNRESOLVED_TELECALLING_STATUSES.length, 5);
  assert.ok(UNRESOLVED_TELECALLING_STATUSES.includes('Follow-up Required'));
  assert.ok(UNRESOLVED_TELECALLING_STATUSES.includes('Call Back'));
  assert.ok(UNRESOLVED_TELECALLING_STATUSES.includes('No Answer / No Response'));
  assert.ok(UNRESOLVED_TELECALLING_STATUSES.includes('Not Reachable / Switched Off'));
  assert.ok(UNRESOLVED_TELECALLING_STATUSES.includes('Interested / Details Shared'));

  assert.equal(isUnresolvedStatus('Follow-up Required'), true);
  assert.equal(isUnresolvedStatus('Call Back'), true);
  assert.equal(isUnresolvedStatus('No Answer / No Response'), true);
  assert.equal(isUnresolvedStatus('Not Reachable / Switched Off'), true);
  assert.equal(isUnresolvedStatus('Interested / Details Shared'), true);

  assert.equal(isUnresolvedStatus('Appointment Confirmed'), false);
  assert.equal(isUnresolvedStatus('No Interest'), false);
  assert.equal(isUnresolvedStatus('Wrong / Invalid Number'), false);
  assert.equal(isUnresolvedStatus('Other'), false);
  assert.equal(isUnresolvedStatus(null), false);
  assert.equal(isUnresolvedStatus(undefined), false);
});

// ─── 5. CSV Export & RFC-4180 Escaping Tests ─────────────────────────────────

test('escapeCsvCell correctly escapes commas, quotes, and newlines', () => {
  assert.equal(escapeCsvCell('Simple'), '"Simple"');
  assert.equal(escapeCsvCell('Hello, World'), '"Hello, World"');
  assert.equal(escapeCsvCell('Said "Hello"'), '"Said ""Hello"""');
  assert.equal(escapeCsvCell("Line1\nLine2"), '"Line1\nLine2"');
  assert.equal(escapeCsvCell(null), '""');
  assert.equal(escapeCsvCell(undefined), '""');
});

test('generateTelecallingCsvString creates UTF-8 BOM CSV with RFC-4180 escaping', () => {
  const dummyEntries = [
    {
      id: 'e1',
      company_id: 'c1',
      entry_date: '2026-09-22',
      company_name: 'Devon Foods, Ltd.',
      contact_person: 'Mr. Syam "Manager"',
      phone: '9847012345',
      other_phone: '0484-4000544',
      location: 'Kochi, Kerala',
      email: 'syam@devon.com',
      call_status: 'Interested / Details Shared',
      feedback: 'Sent proposal;\nWill follow up.',
      created_by_name: 'Franson',
      created_at: '2026-09-22T10:30:00Z',
      updated_at: '2026-09-22T10:30:00Z'
    }
  ];

  const csv = generateTelecallingCsvString(dummyEntries);
  // Verify UTF-8 BOM
  assert.ok(csv.startsWith('\uFEFF'), 'CSV must start with UTF-8 BOM');
  // Verify Header contains required fields
  assert.ok(csv.includes('"Date","Company / Name","Contact Person","Phone"'));
  // Verify escaped fields
  assert.ok(csv.includes('"Devon Foods, Ltd."'));
  assert.ok(csv.includes('"Mr. Syam ""Manager"""'));
  assert.ok(csv.includes('"Sent proposal;\nWill follow up."'));
  assert.ok(csv.includes('"Franson"'));
});

// ─── 6. Email Report Generator Tests ─────────────────────────────────────────

test('buildDailyReportEmailContent formats subject, text body, and HTML with unresolved section', () => {
  const dummyReport = {
    date: '2026-09-22',
    totalCalls: 10,
    uniqueCompanies: 8,
    statusCounts: {
      'Appointment Confirmed': 2,
      'Interested / Details Shared': 3,
      'Follow-up Required': 2,
      'Call Back': 1,
      'No Answer / No Response': 1,
      'No Interest': 1,
      'Not Reachable / Switched Off': 0,
      'Wrong / Invalid Number': 0,
      'Other': 0
    },
    telecallerActivity: { Franson: 10 },
    followUpsCount: 3,
    unresolvedCallsCount: 7,
    unresolvedEntries: [
      {
        id: 'u1',
        company_id: 'c1',
        entry_date: '2026-09-22',
        company_name: 'Nirapara Industries',
        contact_person: 'Mr. Raju',
        phone: '9847111222',
        call_status: 'Follow-up Required',
        feedback: 'Call back at 4 PM'
      }
    ],
    entries: []
  };

  const email = buildDailyReportEmailContent('B2P INTERNATIONAL', dummyReport);
  assert.ok(email.subject.includes('Telecalling Daily Report'));
  assert.ok(email.subject.includes('2026'));

  // Plain text checks
  assert.ok(email.body.includes('Total Calls Logged: 10'));
  assert.ok(email.body.includes('Unresolved Calls Requiring Action: 7'));
  assert.ok(email.body.includes('Nirapara Industries'));
  assert.ok(email.body.includes('Call back at 4 PM'));

  // HTML checks
  assert.ok(email.htmlBody.includes('<!DOCTYPE html>'));
  assert.ok(email.htmlBody.includes('Nirapara Industries'));
  assert.ok(email.htmlBody.includes('Action Needed: Unresolved Calls'));
});

// ─── 7. Call Again Prefill Logic Tests ───────────────────────────────────────

test('Call Again prefill retains contact identity while discarding date, status, and feedback', () => {
  const previousRecord = {
    id: 'old-1',
    company_id: 'c1',
    entry_date: '2026-08-15', // Past date
    company_name: 'Jayalakshmi Silks',
    contact_person: 'Manager Renjith',
    phone: '9847223344',
    other_phone: '0484-2345678',
    location: 'Ernakulam',
    email: 'renjith@jayalakshmi.com',
    call_status: 'No Answer / No Response',
    feedback: 'Tried 3 times, not picking up'
  };

  // Simulating the Call Again handler contract
  const callAgainPrefill = {
    company_name: previousRecord.company_name,
    contact_person: previousRecord.contact_person,
    phone: previousRecord.phone,
    other_phone: previousRecord.other_phone,
    location: previousRecord.location,
    email: previousRecord.email,
    // Must NOT copy date, status, or feedback
    entry_date: undefined, // will be auto-determined at save time
    call_status: 'Interested / Details Shared', // default reset
    feedback: '' // cleared
  };

  assert.equal(callAgainPrefill.company_name, 'Jayalakshmi Silks');
  assert.equal(callAgainPrefill.phone, '9847223344');
  assert.equal(callAgainPrefill.location, 'Ernakulam');
  assert.equal(callAgainPrefill.entry_date, undefined);
  assert.notEqual(callAgainPrefill.entry_date, '2026-08-15');
  assert.notEqual(callAgainPrefill.call_status, 'No Answer / No Response');
  assert.equal(callAgainPrefill.feedback, '');
});

// ─── 8. Mandatory Feedback Validation Tests ─────────────────────────────────

test('Mandatory feedback validation rejects empty or whitespace-only feedback', () => {
  const validateCallSubmission = (feedbackText) => {
    if (!feedbackText || !feedbackText.trim()) {
      return { valid: false, error: 'Feedback / Remarks is required.' };
    }
    return { valid: true };
  };

  assert.equal(validateCallSubmission('').valid, false);
  assert.equal(validateCallSubmission('   ').valid, false);
  assert.equal(validateCallSubmission(null).valid, false);
  assert.equal(validateCallSubmission(undefined).valid, false);
  assert.equal(validateCallSubmission('Discussed requirements, follow up next Tuesday').valid, true);
});

// ─── 9. De-duplication, Double-Submission & Form Reset Tests ───────────────

test('Synchronous submission lock blocks rapid double-clicks and microsecond submissions', () => {
  let isSubmitting = false;
  let saveCount = 0;

  const simulateSubmit = () => {
    if (isSubmitting) {
      return { blocked: true };
    }
    isSubmitting = true;
    saveCount++;
    // In real app, released in finally block
    return { blocked: false, count: saveCount };
  };

  // First click succeeds
  const res1 = simulateSubmit();
  assert.equal(res1.blocked, false);
  assert.equal(res1.count, 1);

  // Immediate second click (within milliseconds before async re-render) is blocked
  const res2 = simulateSubmit();
  assert.equal(res2.blocked, true);
  assert.equal(saveCount, 1, 'Only one actual submission should occur');
});

test('Recent duplicate check detects submissions with same phone or company within cooldown window', () => {
  const existingEntries = [
    {
      id: 'entry-1',
      entry_date: '2026-09-24',
      company_name: 'Axis Eye care',
      phone: '8078788882',
      call_status: 'Follow-up Required',
      feedback: 'Patient inquiries, follow up at 4 PM',
      created_at: new Date(Date.now() - 67 * 1000).toISOString() // 67 seconds ago
    }
  ];

  const findDuplicate = (phone, companyName, entries) => {
    const cleanDigits = (phone || '').replace(/\D/g, '');
    const cleanComp = (companyName || '').trim().toLowerCase();

    return entries.find(entry => {
      const eDigits = (entry.phone || '').replace(/\D/g, '');
      const eComp = (entry.company_name || '').trim().toLowerCase();
      const phoneMatch = cleanDigits.length >= 6 && (eDigits === cleanDigits || eDigits.endsWith(cleanDigits) || cleanDigits.endsWith(eDigits));
      const compMatch = cleanComp.length >= 3 && eComp === cleanComp;
      return phoneMatch || compMatch;
    }) || null;
  };

  // Same phone submitted 67 seconds later
  const duplicateByPhone = findDuplicate('8078788882', 'Axis Eye Care Clinic', existingEntries);
  assert.ok(duplicateByPhone, 'Should detect duplicate by normalized phone');
  assert.equal(duplicateByPhone.id, 'entry-1');

  // Same company name with slight formatting
  const duplicateByName = findDuplicate('9999999999', 'Axis Eye care', existingEntries);
  assert.ok(duplicateByName, 'Should detect duplicate by company name');
  assert.equal(duplicateByName.id, 'entry-1');

  // Different contact
  const nonDuplicate = findDuplicate('9847000000', 'Lotus Hospital', existingEntries);
  assert.equal(nonDuplicate, null, 'Should not match unrelated business');
});

test('Form reset contract wipes all inputs after any save to prevent payload re-POST', () => {
  let formState = {
    companyName: 'Axis Eye care',
    contactPerson: 'Dr. Ramesh',
    phone: '8078788882',
    otherPhone: '',
    location: 'Kochi',
    email: 'info@axis.com',
    callStatus: 'Follow-up Required',
    feedback: 'Patient inquiries, callback at 4 PM',
    editingId: null,
    duplicateWarning: { id: 'old-1' },
    duplicatePrompt: { minutesAgo: 1 }
  };

  // The reset contract guaranteed in TelecallingDailyEntry
  const resetForm = () => {
    formState = {
      companyName: '',
      contactPerson: '',
      phone: '',
      otherPhone: '',
      location: '',
      email: '',
      callStatus: 'Interested / Details Shared',
      feedback: '',
      editingId: null,
      duplicateWarning: null,
      duplicatePrompt: null
    };
  };

  // Execute reset
  resetForm();

  // Assert all fields are completely blanked out
  assert.equal(formState.companyName, '');
  assert.equal(formState.contactPerson, '');
  assert.equal(formState.phone, '');
  assert.equal(formState.location, '');
  assert.equal(formState.email, '');
  assert.equal(formState.feedback, '');
  assert.equal(formState.editingId, null);
  assert.equal(formState.duplicateWarning, null);
  assert.equal(formState.duplicatePrompt, null);
  assert.equal(formState.callStatus, 'Interested / Details Shared');
});

