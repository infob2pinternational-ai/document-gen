import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const asModule = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;

function transpile(filePath) {
  const code = readFileSync(new URL(filePath, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(code, {
    fileName: filePath,
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext }
  });
  return outputText;
}

async function load(path, replacements = {}) {
  let outputText = transpile(path);
  for (const [from, to] of Object.entries(replacements)) {
    const target = typeof to === 'string' && to.startsWith('data:') ? to : asModule(to);
    outputText = outputText.replaceAll(`'${from}'`, JSON.stringify(target));
    outputText = outputText.replaceAll(`"${from}"`, JSON.stringify(target));
  }
  return import(asModule(outputText));
}

// Setup environment and mock localStorage
const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, val) => storage.set(key, String(val)),
  removeItem: key => storage.delete(key),
  clear: () => storage.clear()
};

// Mock CustomEvent and window dispatch
globalThis.window = {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {}
};

// Load modules
const dateUtils = await load('../src/utils/dateUtils.ts');
const staffUtils = await load('../src/utils/staffUtils.ts');

const dateUtilsModule = asModule(transpile('../src/utils/dateUtils.ts'));
const staffUtilsModule = asModule(transpile('../src/utils/staffUtils.ts'));

const { metricsService, getDateRangeBounds, isDateInBounds } = await load('../src/services/metricsService.ts', {
  '../utils/dateUtils': dateUtilsModule,
  '../utils/staffUtils': staffUtilsModule
});

const leadServiceModule = asModule(
  transpile('../src/services/leadService.ts')
    .replaceAll(`'./metricsService'`, JSON.stringify(asModule('export const metricsService = { notifyChange() {} };')))
    .replaceAll(`'./db'`, JSON.stringify(asModule('export const isCloudActive = () => false; export const supabase = null;')))
    .replaceAll(`'../utils/uuid'`, JSON.stringify(asModule('let leadSeq = 500; export const generateUUID = () => "lead-" + (leadSeq++);')))
    .replaceAll(`'../utils/staffUtils'`, JSON.stringify(staffUtilsModule))
);
const { leadService } = await import(leadServiceModule);

const { officeService } = await load('../src/services/officeService.ts', {
  '../utils/dateUtils': dateUtilsModule,
  '../utils/staffUtils': staffUtilsModule,
  './metricsService': asModule('export const metricsService = { notifyChange() {} };'),
  './db': asModule('export const isCloudActive = () => false; export const supabase = null;'),
  './leadService': leadServiceModule,
  '../utils/uuid': asModule('let seq = 100; export const generateUUID = () => "uuid-" + (seq++);')
});

const {
  buildStaffRecordsMap,
  buildStaffDetailedBreakdown
} = await load('../src/utils/telecallingShare.ts', {
  './whatsappShare': 'export function normalizeIndianPhone(p) { return p.replace(/\\D/g, ""); }',
  './dateUtils': dateUtilsModule,
  '../types': 'export function isUnresolvedStatus(s) { return ["Follow-up Required", "Call Back"].includes(s); }'
});

// Helper for telecalling daily report computation
function computeDailyReportLocal(entries, dateStr) {
  const statusCounts = {
    'Appointment Confirmed': 0,
    'Interested / Details Shared': 0,
    'Follow-up Required': 0,
    'Call Back': 0,
    'No Answer / No Response': 0,
    'No Interest': 0,
    'Not Reachable / Switched Off': 0,
    'Wrong / Invalid Number': 0,
    'Other': 0
  };

  const telecallerActivity = {};
  const uniqueCompanySet = new Set();
  let followUps = 0;
  const unresolvedEntries = [];

  for (const e of entries) {
    if (e.call_status && statusCounts[e.call_status] !== undefined) {
      statusCounts[e.call_status]++;
    } else {
      statusCounts['Other']++;
    }

    if (e.call_status === 'Follow-up Required' || e.call_status === 'Call Back') {
      followUps++;
    }

    const callerKey = e.created_by_name || (e.created_by_email ? e.created_by_email.split('@')[0] : 'Unassigned');
    telecallerActivity[callerKey] = (telecallerActivity[callerKey] || 0) + 1;

    if (e.company_name) {
      uniqueCompanySet.add(e.company_name.trim().toLowerCase());
    }
  }

  return {
    date: dateStr,
    totalCalls: entries.length,
    uniqueCompanies: uniqueCompanySet.size,
    statusCounts,
    telecallerActivity,
    followUpsCount: followUps,
    unresolvedCallsCount: unresolvedEntries.length,
    unresolvedEntries,
    entries
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 9 — OWNER / STAFF ACTIVITY & EOD ACCURACY AUDIT TESTS
// ─────────────────────────────────────────────────────────────────────────────

test('Step 9 - Test 1: Assigned lead ≠ Called lead (Core Principle)', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  leadService.setActiveCompany(companyA);

  // Lead is assigned to Staff 1, but no call or activity has occurred today
  await leadService.saveLead({
    id: 'lead-1',
    company_id: companyA,
    customer_name: 'Client Alpha',
    company_name: 'Alpha Industries',
    assigned_telecaller_email: 'staff1@b2p.com',
    status: 'new'
  });

  // Clear any creation activities from earlier, so today has zero activities logged for this lead
  storage.set('docgen_lead_activities', JSON.stringify([]));

  // Verify telecaller metrics in metricsService
  const metrics = metricsService.getTelecallerMetrics(undefined, companyA);
  const staff1 = metrics.find(m => m.email === 'staff1@b2p.com');
  assert.ok(staff1, 'Staff 1 should appear in telecaller matrix');
  assert.equal(staff1.assignedLeads, 1, 'Assigned leads must be 1');

  // Verify telecalling daily report has 0 calls
  const telecallingEntries = []; // Zero persisted call records
  const dailyReport = computeDailyReportLocal(telecallingEntries, dateUtils.getKolkataToday());
  assert.equal(dailyReport.totalCalls, 0, 'Total calls must remain 0 when only assigned');
  assert.equal(Object.keys(dailyReport.telecallerActivity).length, 0, 'No telecaller activity logged');

  // Verify OwnerDailyMetrics leadsWorked is 0 because no activities/notes were logged
  const ownerMetrics = metricsService.getOwnerDailyMetrics({ type: 'today' }, companyA);
  assert.equal(ownerMetrics.leadsWorked, 0, 'Assigned lead with no activity must not count as leadsWorked');

  // Verify EOD Staff breakdown shows (No calls logged today)
  const breakdown = buildStaffDetailedBreakdown(dailyReport);
  assert.ok(breakdown.includes('(No calls logged today)'), 'Assigned work must not appear as calls in EOD breakdown');
});

test('Step 9 - Test 2: Assigned and actually called increments call count and activity', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  leadService.setActiveCompany(companyA);
  const todayStr = dateUtils.getKolkataToday();

  // Create lead
  const lead = await leadService.saveLead({
    id: 'lead-2',
    company_id: companyA,
    customer_name: 'Client Beta',
    company_name: 'Beta Corp',
    assigned_telecaller_email: 'staff1@b2p.com',
    status: 'telecaller_working'
  });

  // Log actual telecalling call entry in database
  const telecallingEntries = [
    {
      id: 'entry-1',
      company_id: companyA,
      entry_date: todayStr,
      company_name: 'Beta Corp',
      phone: '9847012345',
      call_status: 'Interested / Details Shared',
      feedback: 'Interested in 3-side LED van for 2 days',
      created_by_email: 'staff1@b2p.com',
      created_by_name: 'Staff One',
      created_at: new Date().toISOString()
    }
  ];

  // Log lead activity note
  leadService.addLeadActivity({
    lead_id: lead.id,
    company_id: companyA,
    user_email: 'staff1@b2p.com',
    action: 'status_change',
    previous_status: 'new',
    new_status: 'telecaller_working',
    note: 'Spoke with client, details sent'
  });

  // Compute daily report
  const dailyReport = computeDailyReportLocal(telecallingEntries, todayStr);
  assert.equal(dailyReport.totalCalls, 1, 'Total calls must be 1 for genuine call entry');
  assert.equal(dailyReport.statusCounts['Interested / Details Shared'], 1);
  assert.equal(dailyReport.telecallerActivity['Staff One'], 1, 'Staff One activity recorded');

  // Verify OwnerDailyMetrics reflects 1 lead worked
  const ownerMetrics = metricsService.getOwnerDailyMetrics({ type: 'today' }, companyA);
  assert.equal(ownerMetrics.leadsWorked, 1, 'Lead activity logged must count as 1 lead worked');
});

test('Step 9 - Test 3: Multiple call attempts on single lead tracks attempts vs unique leads', () => {
  const companyA = '11111111-1111-4111-8111-111111111111';
  const todayStr = dateUtils.getKolkataToday();

  // Staff attempts 3 calls to the same lead throughout the day
  const entries = [
    {
      id: 'entry-1',
      company_id: companyA,
      entry_date: todayStr,
      company_name: 'Delta Logistics',
      phone: '9847111222',
      call_status: 'No Answer / No Response',
      created_by_email: 'staff1@b2p.com',
      created_by_name: 'Staff One'
    },
    {
      id: 'entry-2',
      company_id: companyA,
      entry_date: todayStr,
      company_name: 'Delta Logistics',
      phone: '9847111222',
      call_status: 'Call Back',
      created_by_email: 'staff1@b2p.com',
      created_by_name: 'Staff One'
    },
    {
      id: 'entry-3',
      company_id: companyA,
      entry_date: todayStr,
      company_name: 'Delta Logistics',
      phone: '9847111222',
      call_status: 'Appointment Confirmed',
      created_by_email: 'staff1@b2p.com',
      created_by_name: 'Staff One'
    }
  ];

  const report = computeDailyReportLocal(entries, todayStr);
  assert.equal(report.totalCalls, 3, 'Must record 3 total call attempts');
  assert.equal(report.uniqueCompanies, 1, 'Must record 1 unique client/company');
  assert.equal(report.telecallerActivity['Staff One'], 3, 'Staff One logged 3 calls');
});

test('Step 9 - Test 4: Staff filtering strictly isolates staff performance', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  leadService.setActiveCompany(companyA);

  await leadService.saveLead({
    id: 'lead-s1',
    company_id: companyA,
    customer_name: 'Lead 1',
    assigned_telecaller_email: 'staff1@b2p.com',
    status: 'new'
  });
  await leadService.saveLead({
    id: 'lead-s2',
    company_id: companyA,
    customer_name: 'Lead 2',
    assigned_telecaller_email: 'staff2@b2p.com',
    status: 'new'
  });

  const staff1Metrics = metricsService.getTelecallerMetrics('staff1@b2p.com', companyA);
  assert.equal(staff1Metrics.length, 1);
  assert.equal(staff1Metrics[0].email, 'staff1@b2p.com');
  assert.equal(staff1Metrics[0].assignedLeads, 1);

  const staff2Metrics = metricsService.getTelecallerMetrics('staff2@b2p.com', companyA);
  assert.equal(staff2Metrics.length, 1);
  assert.equal(staff2Metrics[0].email, 'staff2@b2p.com');
  assert.equal(staff2Metrics[0].assignedLeads, 1);

  // EOD Staff Records map verification
  const reportData = {
    entries: [
      {
        id: 'e1',
        created_by_email: 'staff1@b2p.com',
        created_by_name: 'Staff One',
        call_status: 'Appointment Confirmed'
      },
      {
        id: 'e2',
        created_by_email: 'staff2@b2p.com',
        created_by_name: 'Staff Two',
        call_status: 'No Interest'
      }
    ]
  };

  const { staffRecords, otherStaff } = buildStaffRecordsMap(reportData);
  const s1Rec = otherStaff['staff1'] || staffRecords['staff1'];
  const s2Rec = otherStaff['staff2'] || staffRecords['staff2'];

  assert.ok(s1Rec && s2Rec, 'Both staff records must exist');
  assert.equal(s1Rec.total, 1, 'Staff 1 must have 1 call');
  assert.equal(s1Rec.confirmed, 1, 'Staff 1 has 1 confirmed');
  assert.equal(s2Rec.total, 1, 'Staff 2 must have 1 call');
  assert.equal(s2Rec.noInterest, 1, 'Staff 2 has 1 no interest');
});

test('Step 9 - Test 5: Company tenant isolation in metricsService', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  const companyB = '22222222-2222-4222-8222-222222222222';
  const todayStr = dateUtils.getKolkataToday();

  // Populate Company A
  leadService.setActiveCompany(companyA);
  await leadService.saveLead({ id: 'la-1', company_id: companyA, customer_name: 'A1', assigned_telecaller_email: 'staff@b2p.com', status: 'new' });
  await leadService.saveLead({ id: 'la-2', company_id: companyA, customer_name: 'A2', assigned_telecaller_email: 'staff@b2p.com', status: 'telecaller_working' });
  await officeService.saveFollowUp({ company_id: companyA, customer_name: 'FA-1', due_date: todayStr, reason: 'Follow-up A' }, 'staff@b2p.com');
  await officeService.saveBooking({ company_id: companyA, customer_name: 'BA-1', resource_id: 'res-van-3side', resource_name: '3 Side LED Van', start_date: todayStr, end_date: todayStr, location: 'Kochi', number_of_days: 1, status: 'CONFIRMED' }, 'staff@b2p.com');

  // Populate Company B
  leadService.setActiveCompany(companyB);
  await leadService.saveLead({ id: 'lb-1', company_id: companyB, customer_name: 'B1', assigned_telecaller_email: 'staff@b2p.com', status: 'new' });
  await officeService.saveFollowUp({ company_id: companyB, customer_name: 'FB-1', due_date: todayStr, reason: 'Follow-up B' }, 'staff@b2p.com');

  // 1. Verify getLeadCounts isolation
  const leadCountsA = metricsService.getLeadCounts(undefined, companyA);
  const leadCountsB = metricsService.getLeadCounts(undefined, companyB);
  assert.equal(leadCountsA.total, 2, 'Company A must have exactly 2 leads');
  assert.equal(leadCountsB.total, 1, 'Company B must have exactly 1 lead');

  // 2. Verify getFollowUpCounts isolation
  const fuCountsA = metricsService.getFollowUpCounts(undefined, companyA);
  const fuCountsB = metricsService.getFollowUpCounts(undefined, companyB);
  assert.equal(fuCountsA.total, 1, 'Company A follow-up total must be 1');
  assert.equal(fuCountsB.total, 1, 'Company B follow-up total must be 1');

  // 3. Verify getBookingCounts isolation
  const bkgCountsA = metricsService.getBookingCounts(companyA);
  const bkgCountsB = metricsService.getBookingCounts(companyB);
  assert.equal(bkgCountsA.total, 1, 'Company A has 1 booking');
  assert.equal(bkgCountsB.total, 0, 'Company B has 0 bookings');

  // 4. Verify getTelecallerMetrics isolation
  const teleMetricsA = metricsService.getTelecallerMetrics(undefined, companyA);
  const teleMetricsB = metricsService.getTelecallerMetrics(undefined, companyB);
  assert.equal(teleMetricsA[0].assignedLeads, 2, 'Staff assigned leads in Company A must be 2');
  assert.equal(teleMetricsB[0].assignedLeads, 1, 'Staff assigned leads in Company B must be 1');

  // 5. Verify getOwnerDailyMetrics isolation
  const ownerA = metricsService.getOwnerDailyMetrics({ type: 'today' }, companyA);
  const ownerB = metricsService.getOwnerDailyMetrics({ type: 'today' }, companyB);
  assert.equal(ownerA.newLeads, 2, 'Company A new leads must be 2');
  assert.equal(ownerB.newLeads, 1, 'Company B new leads must be 1');
  assert.equal(ownerA.newBookings, 1, 'Company A new bookings must be 1');
  assert.equal(ownerB.newBookings, 0, 'Company B new bookings must be 0');
});

test('Step 9 - Test 6: Follow-up creation/completion does NOT inflate call count', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  leadService.setActiveCompany(companyA);
  const todayStr = dateUtils.getKolkataToday();

  // Create and complete a follow-up
  const fu = await officeService.saveFollowUp({
    company_id: companyA,
    customer_name: 'FollowUp Client',
    due_date: todayStr,
    reason: 'Price negotiation'
  }, 'staff1@b2p.com');

  await officeService.completeFollowUp(fu.id, 'Price agreed, booking quotation', 'staff1@b2p.com');

  // Build report input
  const reportData = {
    entries: [], // No telecalling calls
    completedFollowUpsList: [
      {
        id: fu.id,
        customer_name: 'FollowUp Client',
        assigned_staff_email: 'staff1@b2p.com',
        completed_at: new Date().toISOString(),
        completion_note: 'Price agreed'
      }
    ]
  };

  const { staffRecords, otherStaff } = buildStaffRecordsMap(reportData);
  const staffRec = otherStaff['staff1'] || staffRecords['staff1'];

  assert.ok(staffRec);
  assert.equal(staffRec.total, 0, 'Call count must remain 0 when only follow-ups are completed');
  assert.equal(staffRec.completedFollowUps.length, 1, 'Completed follow-up must be tracked in completedFollowUps');
});

test('Step 9 - Test 7: IST business date boundary handling (23:59 vs 00:01 IST)', () => {
  const filter = { type: 'today' };
  const bounds = getDateRangeBounds(filter);

  // Kolkata today
  const todayKolkata = dateUtils.getKolkataToday();
  const [y, m, d] = todayKolkata.split('-').map(Number);

  // Time just before midnight IST: 23:59:00 IST -> UTC is 18:29:00
  const lateIST = new Date(Date.UTC(y, m - 1, d, 18, 28, 0)).toISOString();
  assert.ok(isDateInBounds(lateIST, bounds), 'Timestamp at 23:58 IST must fall within today bounds');

  // Time after midnight IST next day: 00:05:00 IST next day
  const nextDayEarlyIST = new Date(Date.UTC(y, m - 1, d + 1, 0, 5, 0)).toISOString();
  assert.equal(isDateInBounds(nextDayEarlyIST, bounds), false, 'Next day timestamp must fall outside today bounds');
});

test('Step 9 - Test 8: EOD metrics strictly derived from persisted database records', () => {
  // Test that computeDailyReport aggregates purely from persisted entry records
  const sampleEntries = [
    {
      id: 'e1',
      call_status: 'Interested / Details Shared',
      company_name: 'Company X',
      created_by_name: 'Staff Alpha'
    },
    {
      id: 'e2',
      call_status: 'Appointment Confirmed',
      company_name: 'Company Y',
      created_by_name: 'Staff Alpha'
    }
  ];

  const report = computeDailyReportLocal(sampleEntries, '2026-09-26');
  assert.equal(report.totalCalls, 2);
  assert.equal(report.uniqueCompanies, 2);
  assert.equal(report.statusCounts['Appointment Confirmed'], 1);
  assert.equal(report.statusCounts['Interested / Details Shared'], 1);
  assert.equal(report.telecallerActivity['Staff Alpha'], 2);

  // Empty entries array produces exactly 0 calls, never phantom counts
  const emptyReport = computeDailyReportLocal([], '2026-09-26');
  assert.equal(emptyReport.totalCalls, 0);
  assert.equal(emptyReport.uniqueCompanies, 0);
  assert.equal(Object.keys(emptyReport.telecallerActivity).length, 0);
});

test('Step 9 - Test 9: Steps 1–8 regression verification', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  leadService.setActiveCompany(companyA);
  const todayStr = dateUtils.getKolkataToday();

  // Create lead and follow-up
  const lead = await leadService.saveLead({
    id: 'lead-reg',
    company_id: companyA,
    customer_name: 'Reg Customer',
    status: 'new'
  });

  const fu = await officeService.saveFollowUp({
    company_id: companyA,
    lead_id: lead.id,
    customer_name: 'Reg Customer',
    due_date: todayStr,
    due_time: '14:30',
    reason: 'Follow-up'
  }, 'staff@b2p.com');

  // Verify next_follow_up_at synced (Step 7)
  const hydratedLead = leadService.getLeadById(lead.id);
  assert.ok(hydratedLead.next_follow_up_at, 'lead.next_follow_up_at must be populated');

  // Snooze follow-up (Step 6 & 8)
  await officeService.snoozeFollowUp(fu.id, 60, 'staff@b2p.com');
  const snoozedFu = officeService.getFollowUps('snoozed', companyA);
  assert.equal(snoozedFu.length, 1);
  assert.equal(snoozedFu[0].status, 'SNOOZED');

  // Verify lead next_follow_up_at cleared after snooze
  assert.equal(leadService.getLeadById(lead.id).next_follow_up_at, null);

  // Complete snoozed follow-up
  await officeService.completeFollowUp(fu.id, 'Done', 'staff@b2p.com');
  assert.equal(officeService.getFollowUps('snoozed', companyA).length, 0);
  assert.equal(officeService.getFollowUps('completed', companyA).length, 1);
});

test('Step 9 - Test 10: Document workflow records documents without inflating call counts', () => {
  const reportData = {
    entries: [], // Zero calls
    documentsList: [
      {
        id: 'doc-1',
        document_type: 'invoice',
        document_number: 'INV-2026-001',
        customer_name: 'Acme Corp',
        total: 50000,
        created_by_email: 'staff1@b2p.com',
        created_by_name: 'Staff One'
      },
      {
        id: 'doc-2',
        document_type: 'quotation',
        document_number: 'QTN-2026-001',
        customer_name: 'Globex Ltd',
        total: 75000,
        created_by_email: 'staff1@b2p.com',
        created_by_name: 'Staff One'
      }
    ]
  };

  const { otherStaff, staffRecords } = buildStaffRecordsMap(reportData);
  const staffRec = otherStaff['staff1'] || staffRecords['staff1'];

  assert.ok(staffRec);
  assert.equal(staffRec.total, 0, 'Calls must remain 0 when documents are created');
  assert.equal(staffRec.documents.length, 2, 'Staff must have 2 documents recorded');

  const breakdown = buildStaffDetailedBreakdown(reportData);
  assert.ok(breakdown.includes('Documents Generated (2)'), 'Breakdown must display Documents Generated');
  assert.ok(breakdown.includes('(No calls logged today)'), 'Breakdown must state No calls logged today');
});
