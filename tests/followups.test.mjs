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

// ─────────────────────────────────────────────────────────────────────────────
// Step 6 — SNOOZED FOLLOW-UP BEHAVIOR TESTS (Tests 1–9)
// ─────────────────────────────────────────────────────────────────────────────

test('Test 1 — Snooze a pending Follow-up: status becomes SNOOZED, snoozed_until stored, appears in Snoozed, count increases', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  const todayStr = dateUtils.getKolkataToday();

  // Create a pending follow-up
  const task = await officeService.saveFollowUp({
    company_id: companyA,
    customer_name: 'Dr. Joseph Thomas',
    due_date: todayStr,
    due_time: '15:30',
    reason: 'Health camp discussion'
  }, 'staff@b2p.com');

  assert.equal(task.status, 'PENDING');
  let counts = metricsService.getFollowUpCounts(undefined, companyA);
  assert.equal(counts.today, 1);
  assert.equal(counts.snoozed, 0);

  // Snooze by 30 minutes
  const snoozed = await officeService.snoozeFollowUp(task.id, 30, 'staff@b2p.com');

  assert.ok(snoozed, 'snoozeFollowUp returned updated task');
  assert.equal(snoozed.status, 'SNOOZED', 'status must become SNOOZED');
  assert.ok(snoozed.snoozed_until, 'snoozed_until must be stored');

  // Verify Snoozed tab retrieval
  const snoozedRecords = officeService.getFollowUps('snoozed', companyA);
  assert.equal(snoozedRecords.length, 1);
  assert.equal(snoozedRecords[0].id, task.id);
  assert.equal(snoozedRecords[0].status, 'SNOOZED');

  // Verify Snoozed count increases
  counts = metricsService.getFollowUpCounts(undefined, companyA);
  assert.equal(counts.snoozed, 1, 'Snoozed count must be 1');
});

test('Test 2 — Snoozed excluded from pending categories: does NOT appear/count as Today, Overdue, or Upcoming', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  const todayStr = dateUtils.getKolkataToday();
  const yesterdayStr = getRelativeDate(-1);
  const tomorrowStr = getRelativeDate(1);

  // Create follow-ups in each pending category and snooze them
  const tToday = await officeService.saveFollowUp({ company_id: companyA, customer_name: 'Task Today', due_date: todayStr, reason: 'R1' }, 'staff@b2p.com');
  const tOverdue = await officeService.saveFollowUp({ company_id: companyA, customer_name: 'Task Overdue', due_date: yesterdayStr, reason: 'R2' }, 'staff@b2p.com');
  const tUpcoming = await officeService.saveFollowUp({ company_id: companyA, customer_name: 'Task Upcoming', due_date: tomorrowStr, reason: 'R3' }, 'staff@b2p.com');

  // Snooze all 3
  await officeService.snoozeFollowUp(tToday.id, 60, 'staff@b2p.com');
  await officeService.snoozeFollowUp(tOverdue.id, 60, 'staff@b2p.com');
  await officeService.snoozeFollowUp(tUpcoming.id, 60, 'staff@b2p.com');

  const counts = metricsService.getFollowUpCounts(undefined, companyA);
  assert.equal(counts.today, 0, 'Snoozed tasks must NOT count in Today');
  assert.equal(counts.overdue, 0, 'Snoozed tasks must NOT count in Overdue');
  assert.equal(counts.upcoming, 0, 'Snoozed tasks must NOT count in Upcoming');
  assert.equal(counts.completed, 0, 'Snoozed tasks must NOT count in Completed');
  assert.equal(counts.snoozed, 3, 'Snoozed count must be 3');
  assert.equal(counts.total, 3, 'Total count must be 3');

  // Verify table views exclude them
  assert.equal(officeService.getFollowUps('today', companyA).length, 0);
  assert.equal(officeService.getFollowUps('overdue', companyA).length, 0);
  assert.equal(officeService.getFollowUps('upcoming', companyA).length, 0);
  assert.equal(officeService.getFollowUps('snoozed', companyA).length, 3);
});

test('Test 3 — Snoozed badge: Snoozed count === Snoozed records displayed (including clean 0)', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';

  // Empty state check
  let counts = metricsService.getFollowUpCounts(undefined, companyA);
  let displayed = officeService.getFollowUps('snoozed', companyA);
  assert.equal(counts.snoozed, 0);
  assert.equal(displayed.length, 0);
  assert.equal(counts.snoozed, displayed.length);

  // Add 2 snoozed tasks
  const t1 = await officeService.saveFollowUp({ company_id: companyA, customer_name: 'A', due_date: dateUtils.getKolkataToday(), reason: 'R1' }, 'staff@b2p.com');
  const t2 = await officeService.saveFollowUp({ company_id: companyA, customer_name: 'B', due_date: dateUtils.getKolkataToday(), reason: 'R2' }, 'staff@b2p.com');
  await officeService.snoozeFollowUp(t1.id, 30, 'staff@b2p.com');
  await officeService.snoozeFollowUp(t2.id, 120, 'staff@b2p.com');

  counts = metricsService.getFollowUpCounts(undefined, companyA);
  displayed = officeService.getFollowUps('snoozed', companyA);
  assert.equal(counts.snoozed, 2);
  assert.equal(displayed.length, 2);
  assert.equal(counts.snoozed, displayed.length, 'Snoozed count must exactly equal displayed records');
});

test('Test 4 — Snoozed date/time display: formatKolkataSnoozeUntil displays correctly in IST deterministically', () => {
  // Test deterministic ISO UTC timestamp: 2026-09-26T10:00:00.000Z
  // In Asia/Kolkata (+5:30), 10:00 UTC = 15:30 IST on 26/09/2026.
  const utcTime1 = '2026-09-26T10:00:00.000Z';
  const display1 = dateUtils.formatKolkataSnoozeUntil(utcTime1);
  assert.equal(display1, '26/09/2026 15:30', 'Must display 26/09/2026 15:30 in Asia/Kolkata');

  // Test UTC midnight rollover: 2026-09-26T20:00:00.000Z (8 PM UTC = 1:30 AM next day IST)
  const utcTime2 = '2026-09-26T20:00:00.000Z';
  const display2 = dateUtils.formatKolkataSnoozeUntil(utcTime2);
  assert.equal(display2, '27/09/2026 01:30', 'Must roll over to next calendar day in Asia/Kolkata');

  // Test fallback to due_date and due_time when snoozed_until is undefined
  const displayFallback = dateUtils.formatKolkataSnoozeUntil(undefined, '2026-09-26', '11:00');
  assert.equal(displayFallback, '26/09/2026 11:00');
});

test('Test 5 — Snoozed + Company isolation: Company A and B snoozed tasks remain segregated', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  const companyB = '22222222-2222-4222-8222-222222222222';
  const todayStr = dateUtils.getKolkataToday();

  // Create and snooze 1 task for Company A
  const tA = await officeService.saveFollowUp({ company_id: companyA, customer_name: 'Co A Snoozed', due_date: todayStr, reason: 'Call A' }, 'staff@b2p.com');
  await officeService.snoozeFollowUp(tA.id, 60, 'staff@b2p.com');

  // Create and snooze 2 tasks for Company B
  const tB1 = await officeService.saveFollowUp({ company_id: companyB, customer_name: 'Co B Snoozed 1', due_date: todayStr, reason: 'Call B1' }, 'staff@b2p.com');
  const tB2 = await officeService.saveFollowUp({ company_id: companyB, customer_name: 'Co B Snoozed 2', due_date: todayStr, reason: 'Call B2' }, 'staff@b2p.com');
  await officeService.snoozeFollowUp(tB1.id, 60, 'staff@b2p.com');
  await officeService.snoozeFollowUp(tB2.id, 60, 'staff@b2p.com');

  // Assert Company A sees only its 1 snoozed task
  const aList = officeService.getFollowUps('snoozed', companyA);
  assert.equal(aList.length, 1);
  assert.equal(aList[0].customer_name, 'Co A Snoozed');
  assert.equal(metricsService.getFollowUpCounts(undefined, companyA).snoozed, 1);

  // Assert Company B sees only its 2 snoozed tasks
  const bList = officeService.getFollowUps('snoozed', companyB);
  assert.equal(bList.length, 2);
  assert.ok(bList.every(f => f.company_id === companyB));
  assert.equal(metricsService.getFollowUpCounts(undefined, companyB).snoozed, 2);
});

test('Test 6 — Snoozed + Staff filter: Staff filtering applies correctly to Snoozed tasks', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  const todayStr = dateUtils.getKolkataToday();

  // Snoozed for Staff A
  const tA = await officeService.saveFollowUp({
    company_id: companyA,
    customer_name: 'Staff A Snoozed',
    due_date: todayStr,
    reason: 'R-A',
    assigned_staff_email: 'staffA@b2p.com'
  }, 'admin@b2p.com');
  await officeService.snoozeFollowUp(tA.id, 60, 'staffA@b2p.com');

  // Snoozed for Staff B
  const tB = await officeService.saveFollowUp({
    company_id: companyA,
    customer_name: 'Staff B Snoozed',
    due_date: todayStr,
    reason: 'R-B',
    assigned_staff_email: 'staffB@b2p.com'
  }, 'admin@b2p.com');
  await officeService.snoozeFollowUp(tB.id, 60, 'staffB@b2p.com');

  // Filter Staff A
  const listStaffA = officeService.getFollowUps('snoozed', companyA, 'staffA@b2p.com');
  const countStaffA = metricsService.getFollowUpCounts('staffA@b2p.com', companyA);
  assert.equal(listStaffA.length, 1);
  assert.equal(listStaffA[0].customer_name, 'Staff A Snoozed');
  assert.equal(countStaffA.snoozed, 1);

  // Filter Staff B
  const listStaffB = officeService.getFollowUps('snoozed', companyA, 'staffB@b2p.com');
  const countStaffB = metricsService.getFollowUpCounts('staffB@b2p.com', companyA);
  assert.equal(listStaffB.length, 1);
  assert.equal(listStaffB[0].customer_name, 'Staff B Snoozed');
  assert.equal(countStaffB.snoozed, 1);

  // All Staff
  const listAll = officeService.getFollowUps('snoozed', companyA, 'all');
  const countAll = metricsService.getFollowUpCounts('all', companyA);
  assert.equal(listAll.length, 2);
  assert.equal(countAll.snoozed, 2);
});

test('Test 7 — Edit Snoozed Follow-up: retains SNOOZED status, company_id, lead_id, snoozed_until, no duplicate', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  const leadId = '44444444-4444-4444-8444-444444444444';
  const todayStr = dateUtils.getKolkataToday();

  const original = await officeService.saveFollowUp({
    company_id: companyA,
    lead_id: leadId,
    customer_name: 'Client Snoozed',
    due_date: todayStr,
    reason: 'Initial Call'
  }, 'staff@b2p.com');

  const snoozed = await officeService.snoozeFollowUp(original.id, 90, 'staff@b2p.com');
  const snoozedUntil = snoozed.snoozed_until;
  assert.ok(snoozedUntil);

  // Edit the snoozed follow-up (e.g. updating notes or reason)
  const updated = await officeService.saveFollowUp({
    id: original.id,
    customer_name: 'Client Snoozed Updated',
    reason: 'Updated Reason after Call',
    notes: 'Client was busy, will pick up in 90 mins'
  }, 'staff@b2p.com');

  assert.equal(updated.id, original.id);
  assert.equal(updated.status, 'SNOOZED', 'Must remain SNOOZED after edit');
  assert.equal(updated.company_id, companyA, 'company_id must remain unchanged');
  assert.equal(updated.lead_id, leadId, 'lead_id must remain unchanged');
  assert.equal(updated.snoozed_until, snoozedUntil, 'snoozed_until must be preserved');

  // Verify no duplicate record created
  const allRecords = officeService.getFollowUps('all', companyA);
  assert.equal(allRecords.length, 1);
  assert.equal(allRecords[0].reason, 'Updated Reason after Call');
});

test('Test 8 — Snoozed -> Complete: SNOOZED follow-up transitions to COMPLETED, logs note, leaves Snoozed, joins Completed', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  const todayStr = dateUtils.getKolkataToday();

  const task = await officeService.saveFollowUp({
    company_id: companyA,
    customer_name: 'Snoozed to Complete',
    due_date: todayStr,
    reason: 'Follow-up discussion'
  }, 'staff@b2p.com');

  await officeService.snoozeFollowUp(task.id, 60, 'staff@b2p.com');
  assert.equal(metricsService.getFollowUpCounts(undefined, companyA).snoozed, 1);
  assert.equal(officeService.getFollowUps('snoozed', companyA).length, 1);

  // Complete the snoozed follow-up
  const completed = await officeService.completeFollowUp(task.id, 'Spoke with customer and booked service', 'staff@b2p.com');
  assert.ok(completed);
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.completion_note, 'Spoke with customer and booked service');
  assert.ok(completed.completed_at);

  // Verify counts
  const counts = metricsService.getFollowUpCounts(undefined, companyA);
  assert.equal(counts.snoozed, 0, 'Snoozed count must decrement');
  assert.equal(counts.completed, 1, 'Completed count must increment');

  // Verify tab lists
  assert.equal(officeService.getFollowUps('snoozed', companyA).length, 0, 'Must leave Snoozed tab');
  const completedList = officeService.getFollowUps('completed', companyA);
  assert.equal(completedList.length, 1, 'Must appear in Completed tab');
  assert.equal(completedList[0].completion_note, 'Spoke with customer and booked service');
});

test('Test 9 — Snoozed expiry: existing application behavior preserves SNOOZED status and excludes from pending categories', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  const todayStr = dateUtils.getKolkataToday();

  // Create a task that was snoozed in the past (snoozed_until has passed)
  const pastSnoozeTime = new Date(Date.now() - 3 * 3600 * 1000).toISOString(); // 3 hours ago
  const task = await officeService.saveFollowUp({
    company_id: companyA,
    customer_name: 'Past Snooze Task',
    due_date: todayStr,
    due_time: '09:00',
    reason: 'Expired snooze check',
    status: 'SNOOZED',
    snoozed_until: pastSnoozeTime
  }, 'staff@b2p.com');

  // Verify existing behavior: record remains SNOOZED in storage
  const stored = officeService.getFollowUps('all', companyA)[0];
  assert.equal(stored.status, 'SNOOZED');
  assert.equal(stored.snoozed_until, pastSnoozeTime);

  // Verify it appears in Snoozed tab and counts under Snoozed
  assert.equal(officeService.getFollowUps('snoozed', companyA).length, 1);
  const counts = metricsService.getFollowUpCounts(undefined, companyA);
  assert.equal(counts.snoozed, 1);

  // Crucially, it does NOT accidentally leak into Today, Overdue, or Upcoming
  assert.equal(counts.today, 0, 'Expired snooze must not inflate Today count without reactivation');
  assert.equal(counts.overdue, 0, 'Expired snooze must not inflate Overdue count without reactivation');
  assert.equal(counts.upcoming, 0, 'Expired snooze must not inflate Upcoming count without reactivation');
  assert.equal(officeService.getFollowUps('today', companyA).length, 0);
  assert.equal(officeService.getFollowUps('overdue', companyA).length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION PROTECTION TESTS (Steps 1–5)
// ─────────────────────────────────────────────────────────────────────────────

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

test('Regression — Step 5: Filter consistency & table counts match badges across all status categories', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  const todayStr = dateUtils.getKolkataToday();
  const yesterdayStr = getRelativeDate(-1);
  const tomorrowStr = getRelativeDate(1);

  // Overdue
  await officeService.saveFollowUp({ company_id: companyA, customer_name: 'Overdue Task', due_date: yesterdayStr, reason: 'R1' }, 'staff@b2p.com');
  // Today
  await officeService.saveFollowUp({ company_id: companyA, customer_name: 'Today Task', due_date: todayStr, reason: 'R2' }, 'staff@b2p.com');
  // Upcoming
  await officeService.saveFollowUp({ company_id: companyA, customer_name: 'Upcoming Task', due_date: tomorrowStr, reason: 'R3' }, 'staff@b2p.com');
  // Completed
  const comp = await officeService.saveFollowUp({ company_id: companyA, customer_name: 'Completed Task', due_date: todayStr, reason: 'R4' }, 'staff@b2p.com');
  await officeService.completeFollowUp(comp.id, 'Done', 'staff@b2p.com');
  // Snoozed
  const snz = await officeService.saveFollowUp({ company_id: companyA, customer_name: 'Snoozed Task', due_date: todayStr, reason: 'R5' }, 'staff@b2p.com');
  await officeService.snoozeFollowUp(snz.id, 60, 'staff@b2p.com');

  const counts = metricsService.getFollowUpCounts(undefined, companyA);

  assert.equal(counts.overdue, officeService.getFollowUps('overdue', companyA).length, 'Overdue count must match overdue table records');
  assert.equal(counts.today, officeService.getFollowUps('today', companyA).length, 'Today count must match today table records');
  assert.equal(counts.upcoming, officeService.getFollowUps('upcoming', companyA).length, 'Upcoming count must match upcoming table records');
  assert.equal(counts.completed, officeService.getFollowUps('completed', companyA).length, 'Completed count must match completed table records');
  assert.equal(counts.snoozed, officeService.getFollowUps('snoozed', companyA).length, 'Snoozed count must match snoozed table records');
  assert.equal(counts.total, officeService.getFollowUps('all', companyA).length, 'Total count must match all table records');
});
