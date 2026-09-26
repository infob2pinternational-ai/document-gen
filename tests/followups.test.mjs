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
    outputText = outputText.replaceAll(`'${from}'`, JSON.stringify(to));
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

const { metricsService, calculateFollowUpCounts } = await load('../src/services/metricsService.ts', {
  '../utils/dateUtils': dateUtilsModule,
  '../utils/staffUtils': staffUtilsModule
});

const { officeService } = await load('../src/services/officeService.ts', {
  '../utils/dateUtils': dateUtilsModule,
  '../utils/staffUtils': staffUtilsModule,
  './metricsService': asModule('export const metricsService = { notifyChange() {} };'),
  './db': asModule('export const isCloudActive = () => false; export const supabase = null;'),
  './leadService': asModule(`
    let activeCo = null;
    export const leadService = {
      getActiveCompany: () => activeCo,
      setActiveCompany: (id) => { activeCo = id; },
      addLeadActivity: async () => {},
      getLeads: () => []
    };
    export async function hydrateLeadsFromCloud() {}
  `),
  '../utils/uuid': asModule('let seq = 100; export const generateUUID = () => "uuid-" + (seq++);')
});

function getRelativeDate(dayOffset) {
  const [year, month, day] = dateUtils.getKolkataToday().split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + dayOffset, 12, 0, 0));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dt = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dt}`;
}

test('Test 1 — Company A counts: Overdue: 2, Today: 1, Upcoming: 3, Completed: 1', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  const todayStr = dateUtils.getKolkataToday();
  const yesterdayStr = getRelativeDate(-1);
  const twoDaysAgoStr = getRelativeDate(-2);
  const tomorrowStr = getRelativeDate(1);
  const twoDaysLaterStr = getRelativeDate(2);
  const threeDaysLaterStr = getRelativeDate(3);

  // 2 Overdue
  await officeService.saveFollowUp({ company_id: companyA, customer_name: 'Overdue 1', due_date: twoDaysAgoStr, reason: 'Call 1' }, 'staff@b2p.com');
  await officeService.saveFollowUp({ company_id: companyA, customer_name: 'Overdue 2', due_date: yesterdayStr, reason: 'Call 2' }, 'staff@b2p.com');

  // 1 Today
  await officeService.saveFollowUp({ company_id: companyA, customer_name: 'Today 1', due_date: todayStr, reason: 'Call 3' }, 'staff@b2p.com');

  // 3 Upcoming
  await officeService.saveFollowUp({ company_id: companyA, customer_name: 'Upcoming 1', due_date: tomorrowStr, reason: 'Call 4' }, 'staff@b2p.com');
  await officeService.saveFollowUp({ company_id: companyA, customer_name: 'Upcoming 2', due_date: twoDaysLaterStr, reason: 'Call 5' }, 'staff@b2p.com');
  await officeService.saveFollowUp({ company_id: companyA, customer_name: 'Upcoming 3', due_date: threeDaysLaterStr, reason: 'Call 6' }, 'staff@b2p.com');

  // 1 Completed
  const completedTask = await officeService.saveFollowUp({ company_id: companyA, customer_name: 'Completed 1', due_date: todayStr, reason: 'Call 7' }, 'staff@b2p.com');
  await officeService.completeFollowUp(completedTask.id, 'Done successfully', 'staff@b2p.com');

  const counts = metricsService.getFollowUpCounts(undefined, companyA);

  assert.equal(counts.overdue, 2, 'Overdue count should be 2');
  assert.equal(counts.today, 1, 'Today count should be 1');
  assert.equal(counts.dueNow, 1, 'DueNow count should be 1');
  assert.equal(counts.upcoming, 3, 'Upcoming count should be 3');
  assert.equal(counts.completed, 1, 'Completed count should be 1');
  assert.equal(counts.snoozed, 0, 'Snoozed count should be 0');
  assert.equal(counts.total, 7, 'Total count should be 7');

  // Verify officeService.getFollowUps records match counts exactly
  assert.equal(officeService.getFollowUps('overdue', companyA).length, 2);
  assert.equal(officeService.getFollowUps('today', companyA).length, 1);
  assert.equal(officeService.getFollowUps('upcoming', companyA).length, 3);
  assert.equal(officeService.getFollowUps('completed', companyA).length, 1);
  assert.equal(officeService.getFollowUps('snoozed', companyA).length, 0);
  assert.equal(officeService.getFollowUps('all', companyA).length, 7);
});

test('Test 2 — Company B isolation: Company A and B records remain strictly segregated', async () => {
  const companyA = '11111111-1111-4111-8111-111111111111';
  const companyB = '22222222-2222-4222-8222-222222222222';
  const todayStr = dateUtils.getKolkataToday();
  const yesterdayStr = getRelativeDate(-1);

  // Add 3 follow-ups to Company B
  await officeService.saveFollowUp({ company_id: companyB, customer_name: 'B Overdue', due_date: yesterdayStr, reason: 'B Task 1' }, 'staffB@b2p.com');
  await officeService.saveFollowUp({ company_id: companyB, customer_name: 'B Today', due_date: todayStr, reason: 'B Task 2' }, 'staffB@b2p.com');
  const bCompleted = await officeService.saveFollowUp({ company_id: companyB, customer_name: 'B Completed', due_date: todayStr, reason: 'B Task 3' }, 'staffB@b2p.com');
  await officeService.completeFollowUp(bCompleted.id, 'Finished B task', 'staffB@b2p.com');

  // Company A counts should NOT change (still 7 records: 2 overdue, 1 today, 3 upcoming, 1 completed)
  const countsA = metricsService.getFollowUpCounts(undefined, companyA);
  assert.equal(countsA.total, 7);
  assert.equal(countsA.overdue, 2);
  assert.equal(countsA.today, 1);
  assert.equal(countsA.upcoming, 3);
  assert.equal(countsA.completed, 1);

  // Company B counts should only reflect Company B
  const countsB = metricsService.getFollowUpCounts(undefined, companyB);
  assert.equal(countsB.total, 3);
  assert.equal(countsB.overdue, 1);
  assert.equal(countsB.today, 1);
  assert.equal(countsB.upcoming, 0);
  assert.equal(countsB.completed, 1);

  // Dataset queries are strictly isolated
  assert.equal(officeService.getFollowUps('all', companyA).length, 7);
  assert.equal(officeService.getFollowUps('all', companyB).length, 3);
  assert.ok(officeService.getFollowUps('all', companyA).every(f => f.company_id === companyA));
  assert.ok(officeService.getFollowUps('all', companyB).every(f => f.company_id === companyB));
});

test('Test 3 — Staff filtering: All Staff, Staff A, and Staff B counts calculate accurately', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  const todayStr = dateUtils.getKolkataToday();
  const yesterdayStr = getRelativeDate(-1);
  const tomorrowStr = getRelativeDate(1);

  // Staff A tasks (2 tasks: 1 overdue, 1 today)
  await officeService.saveFollowUp({ company_id: companyA, customer_name: 'Customer A1', due_date: yesterdayStr, reason: 'Staff A Overdue', assigned_staff_email: 'staffA@b2p.com' }, 'admin@b2p.com');
  await officeService.saveFollowUp({ company_id: companyA, customer_name: 'Customer A2', due_date: todayStr, reason: 'Staff A Today', assigned_staff_email: 'staffA@b2p.com' }, 'admin@b2p.com');

  // Staff B tasks (3 tasks: 1 today, 2 upcoming)
  await officeService.saveFollowUp({ company_id: companyA, customer_name: 'Customer B1', due_date: todayStr, reason: 'Staff B Today', assigned_staff_email: 'staffB@b2p.com' }, 'admin@b2p.com');
  await officeService.saveFollowUp({ company_id: companyA, customer_name: 'Customer B2', due_date: tomorrowStr, reason: 'Staff B Upcoming 1', assigned_staff_email: 'staffB@b2p.com' }, 'admin@b2p.com');
  await officeService.saveFollowUp({ company_id: companyA, customer_name: 'Customer B3', due_date: tomorrowStr, reason: 'Staff B Upcoming 2', assigned_staff_email: 'staffB@b2p.com' }, 'admin@b2p.com');

  // All Staff
  const allCounts = metricsService.getFollowUpCounts('all', companyA);
  assert.equal(allCounts.total, 5);
  assert.equal(allCounts.overdue, 1);
  assert.equal(allCounts.today, 2);
  assert.equal(allCounts.upcoming, 2);

  // Staff A
  const staffACounts = metricsService.getFollowUpCounts('staffA@b2p.com', companyA);
  assert.equal(staffACounts.total, 2);
  assert.equal(staffACounts.overdue, 1);
  assert.equal(staffACounts.today, 1);
  assert.equal(staffACounts.upcoming, 0);

  // Staff B
  const staffBCounts = metricsService.getFollowUpCounts('staffB@b2p.com', companyA);
  assert.equal(staffBCounts.total, 3);
  assert.equal(staffBCounts.overdue, 0);
  assert.equal(staffBCounts.today, 1);
  assert.equal(staffBCounts.upcoming, 2);
});

test('Test 4 — Staff + status combination: displayed records and count refer to exactly the same subset', async () => {
  const companyA = '11111111-1111-4111-8111-111111111111';

  // Staff A + Overdue
  const staffAOverdueRecords = officeService.getFollowUps('overdue', companyA, 'staffA@b2p.com');
  const staffACounts = metricsService.getFollowUpCounts('staffA@b2p.com', companyA);
  assert.equal(staffAOverdueRecords.length, staffACounts.overdue);
  assert.equal(staffAOverdueRecords.length, 1);
  assert.equal(staffAOverdueRecords[0].assigned_staff_email, 'staffa@b2p.com');

  // Staff A + Today
  const staffATodayRecords = officeService.getFollowUps('today', companyA, 'staffA@b2p.com');
  assert.equal(staffATodayRecords.length, staffACounts.today);
  assert.equal(staffATodayRecords.length, 1);
  assert.equal(staffATodayRecords[0].assigned_staff_email, 'staffa@b2p.com');

  // Staff A + Upcoming
  const staffAUpcomingRecords = officeService.getFollowUps('upcoming', companyA, 'staffA@b2p.com');
  assert.equal(staffAUpcomingRecords.length, staffACounts.upcoming);
  assert.equal(staffAUpcomingRecords.length, 0);

  // Staff B + Upcoming
  const staffBUpcomingRecords = officeService.getFollowUps('upcoming', companyA, 'staffB@b2p.com');
  const staffBCounts = metricsService.getFollowUpCounts('staffB@b2p.com', companyA);
  assert.equal(staffBUpcomingRecords.length, staffBCounts.upcoming);
  assert.equal(staffBUpcomingRecords.length, 2);
  assert.ok(staffBUpcomingRecords.every(r => r.assigned_staff_email === 'staffb@b2p.com'));
});

test('Test 5 — Completed: counted only in Completed and not in pending counts', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  const todayStr = dateUtils.getKolkataToday();
  const yesterdayStr = getRelativeDate(-1);

  // Save an overdue follow-up, then complete it
  const task = await officeService.saveFollowUp({ company_id: companyA, customer_name: 'To Complete', due_date: yesterdayStr, reason: 'Initial call' }, 'staff@b2p.com');
  assert.equal(metricsService.getFollowUpCounts(undefined, companyA).overdue, 1);
  assert.equal(metricsService.getFollowUpCounts(undefined, companyA).completed, 0);

  await officeService.completeFollowUp(task.id, 'Customer confirmed booking', 'staff@b2p.com');

  const afterComplete = metricsService.getFollowUpCounts(undefined, companyA);
  assert.equal(afterComplete.overdue, 0, 'Completed task must not remain in overdue');
  assert.equal(afterComplete.today, 0, 'Completed task must not be in today');
  assert.equal(afterComplete.upcoming, 0, 'Completed task must not be in upcoming');
  assert.equal(afterComplete.completed, 1, 'Completed count must be 1');
  assert.equal(afterComplete.total, 1, 'Total must be 1');

  // Verify getFollowUps('overdue') does NOT return it
  assert.equal(officeService.getFollowUps('overdue', companyA).length, 0);
  assert.equal(officeService.getFollowUps('completed', companyA).length, 1);
});

test('Test 6 — Snoozed: counted only in Snoozed and does not inflate pending categories', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  const todayStr = dateUtils.getKolkataToday();

  // Create a pending follow-up for today
  const task = await officeService.saveFollowUp({ company_id: companyA, customer_name: 'To Snooze', due_date: todayStr, reason: 'Pending call' }, 'staff@b2p.com');
  assert.equal(metricsService.getFollowUpCounts(undefined, companyA).today, 1);
  assert.equal(metricsService.getFollowUpCounts(undefined, companyA).snoozed, 0);

  // Snooze by 60 minutes
  await officeService.snoozeFollowUp(task.id, 60, 'staff@b2p.com');

  const afterSnooze = metricsService.getFollowUpCounts(undefined, companyA);
  assert.equal(afterSnooze.snoozed, 1, 'Snoozed count should be 1');
  assert.equal(afterSnooze.today, 0, 'Snoozed task must NOT inflate today count');
  assert.equal(afterSnooze.overdue, 0, 'Snoozed task must NOT inflate overdue count');
  assert.equal(afterSnooze.upcoming, 0, 'Snoozed task must NOT inflate upcoming count');
  assert.equal(afterSnooze.completed, 0, 'Snoozed task must NOT inflate completed count');
  assert.equal(afterSnooze.total, 1, 'Total task count should be 1');

  // Verify getFollowUps views
  assert.equal(officeService.getFollowUps('snoozed', companyA).length, 1);
  assert.equal(officeService.getFollowUps('today', companyA).length, 0);
  assert.equal(officeService.getFollowUps('overdue', companyA).length, 0);
  assert.equal(officeService.getFollowUps('upcoming', companyA).length, 0);
});

test('Test 7 — Company switch refresh: counts immediately update when company changes', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  const companyB = '22222222-2222-4222-8222-222222222222';
  const todayStr = dateUtils.getKolkataToday();

  await officeService.saveFollowUp({ company_id: companyA, customer_name: 'Cust A', due_date: todayStr, reason: 'Call A' }, 'staff@b2p.com');
  await officeService.saveFollowUp({ company_id: companyB, customer_name: 'Cust B1', due_date: todayStr, reason: 'Call B1' }, 'staff@b2p.com');
  await officeService.saveFollowUp({ company_id: companyB, customer_name: 'Cust B2', due_date: todayStr, reason: 'Call B2' }, 'staff@b2p.com');

  // Step 1: Viewing Company A
  let activeCounts = metricsService.getFollowUpCounts(undefined, companyA);
  assert.equal(activeCounts.total, 1);
  assert.equal(activeCounts.today, 1);

  // Step 2: Switch to Company B
  activeCounts = metricsService.getFollowUpCounts(undefined, companyB);
  assert.equal(activeCounts.total, 2);
  assert.equal(activeCounts.today, 2);

  // Step 3: Switch back to Company A
  activeCounts = metricsService.getFollowUpCounts(undefined, companyA);
  assert.equal(activeCounts.total, 1);
  assert.equal(activeCounts.today, 1);
});

test('Test 8 — IST consistency: pure Asia/Kolkata date boundary prevents UTC shifts', () => {
  // Midnight UTC boundary test:
  // At 2026-09-26T20:00:00Z (8 PM UTC), in Asia/Kolkata (+5:30), the time is 2026-09-27T01:30:00+05:30 (next calendar day).
  const lateNightUTC = new Date('2026-09-26T20:00:00Z');
  const kolkataDate = dateUtils.getKolkataDateString(lateNightUTC);
  const kolkataTime = dateUtils.getKolkataTimeString(lateNightUTC);

  assert.equal(kolkataDate, '2026-09-27', 'Date in IST must be next calendar day 2026-09-27');
  assert.equal(kolkataTime, '01:30', 'Time in IST must be 01:30');

  // Follow-up due on 2026-09-27 evaluated at this moment is TODAY, not upcoming
  const mockFollowUps = [
    { id: '1', due_date: '2026-09-27', status: 'PENDING', customer_name: 'Test' },
    { id: '2', due_date: '2026-09-26', status: 'PENDING', customer_name: 'Test 2' }
  ];

  // In IST on 2026-09-27:
  // id 1 (2026-09-27) is TODAY
  // id 2 (2026-09-26) is OVERDUE
  const counts = calculateFollowUpCounts(mockFollowUps);
  // Today in current runtime vs given
  const runtimeToday = dateUtils.getKolkataToday();
  const testItems = [
    { id: 't1', due_date: runtimeToday, status: 'PENDING', customer_name: 'Due today' },
    { id: 't2', due_date: '2020-01-01', status: 'PENDING', customer_name: 'Old overdue' }
  ];
  const runtimeCounts = calculateFollowUpCounts(testItems);
  assert.equal(runtimeCounts.today, 1);
  assert.equal(runtimeCounts.overdue, 1);
});

test('Regression — Step 1: Follow-up edit preserves metadata, completion notes, and company_id', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  const leadId = '33333333-3333-4333-8333-333333333333';
  const todayStr = dateUtils.getKolkataToday();

  const original = await officeService.saveFollowUp({
    company_id: companyA,
    lead_id: leadId,
    customer_name: 'Metadata Test',
    due_date: todayStr,
    reason: 'Initial setup',
    notes: 'Important notes'
  }, 'staff@b2p.com');

  assert.equal(original.company_id, companyA);
  assert.equal(original.lead_id, leadId);
  const createdAt = original.created_at;

  // Complete the task
  await officeService.completeFollowUp(original.id, 'First completion note', 'staff@b2p.com');
  const completedState = officeService.getFollowUps('completed', companyA)[0];
  assert.equal(completedState.completion_note, 'First completion note');
  const completedAt = completedState.completed_at;

  // Edit the task reason without passing company_id/lead_id
  const updated = await officeService.saveFollowUp({
    id: original.id,
    customer_name: 'Metadata Test Edited',
    due_date: todayStr,
    reason: 'Updated reason'
  }, 'staff@b2p.com');

  assert.equal(updated.id, original.id);
  assert.equal(updated.company_id, companyA, 'company_id must be preserved');
  assert.equal(updated.lead_id, leadId, 'lead_id must be preserved');
  assert.equal(updated.created_at, createdAt, 'created_at must be preserved');
  assert.equal(updated.completion_note, 'First completion note', 'completion_note must be preserved');
  assert.equal(updated.completed_at, completedAt, 'completed_at must be preserved');
});

test('Regression — Step 2: Company isolation intact without defaulting to "default"', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  const companyB = '22222222-2222-4222-8222-222222222222';
  const todayStr = dateUtils.getKolkataToday();

  await officeService.saveFollowUp({ company_id: companyA, customer_name: 'Co A Item', due_date: todayStr, reason: 'R1' }, 'staff@b2p.com');
  await officeService.saveFollowUp({ company_id: companyB, customer_name: 'Co B Item', due_date: todayStr, reason: 'R2' }, 'staff@b2p.com');

  const listA = officeService.getFollowUps('all', companyA);
  const listB = officeService.getFollowUps('all', companyB);

  assert.equal(listA.length, 1);
  assert.equal(listA[0].customer_name, 'Co A Item');
  assert.equal(listB.length, 1);
  assert.equal(listB[0].customer_name, 'Co B Item');
});

test('Regression — Step 3: Rapid duplicate submissions remain blocked in FollowUpModal', () => {
  const modalCode = readFileSync(new URL('../src/components/FollowUpModal.tsx', import.meta.url), 'utf8');
  assert.ok(modalCode.includes('saveInProgressRef.current') || /if\s*\(\s*isSaving\s*\)\s*return;/.test(modalCode));
  assert.match(modalCode, /setIsSaving\(true\);/);
});

test('Regression — Step 4: Pure Asia/Kolkata date classification used across services and components', () => {
  const followUpsCode = readFileSync(new URL('../src/components/FollowUps.tsx', import.meta.url), 'utf8');
  const metricsServiceCode = readFileSync(new URL('../src/services/metricsService.ts', import.meta.url), 'utf8');
  const officeServiceCode = readFileSync(new URL('../src/services/officeService.ts', import.meta.url), 'utf8');

  assert.match(followUpsCode, /getKolkataToday\(\)/);
  assert.match(metricsServiceCode, /getKolkataToday\(\)/);
  assert.match(officeServiceCode, /getKolkataToday\(\)/);
});
