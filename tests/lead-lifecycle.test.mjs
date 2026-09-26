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

const { metricsService, getDateRangeBounds } = await load('../src/services/metricsService.ts', {
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

// ─────────────────────────────────────────────────────────────────────────────
// STEP 10 — LEAD ASSIGNMENT & LIFECYCLE CONSISTENCY AUDIT TESTS
// ─────────────────────────────────────────────────────────────────────────────

test('Step 10 - Test 1: Initial lead assignment persists accurately and updates telecaller metrics', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  leadService.setActiveCompany(companyA);

  const leadA = await leadService.saveLead({
    company_id: companyA,
    customer_name: 'Alpha Customer',
    company_name: 'Alpha Ltd',
    phone: '9847000001',
    service_required: 'LED Van Advertising',
    assigned_telecaller_email: 'staffA@b2p.com',
    status: 'new'
  }, 'admin@b2p.com');

  assert.ok(leadA.id, 'Lead must have generated ID');
  assert.equal(leadA.assigned_telecaller_email, 'staffa@b2p.com', 'Normalized email must be saved');
  assert.equal(leadA.status, 'new');

  // Verify persistence and re-read
  const reloaded = leadService.getLeadById(leadA.id);
  assert.ok(reloaded, 'Lead must be retrievable by ID');
  assert.equal(reloaded.assigned_telecaller_email, 'staffa@b2p.com', 'Assignment preserved across reload');

  // Verify telecaller metrics
  const metrics = metricsService.getTelecallerMetrics(undefined, companyA);
  const staffRow = metrics.find(r => r.email === 'staffa@b2p.com');
  assert.ok(staffRow, 'Staff A must appear in telecaller metrics');
  assert.equal(staffRow.assignedLeads, 1, 'Staff A must have 1 assigned lead');
  assert.equal(staffRow.newLeads, 1, 'Staff A must have 1 new lead');

  // Verify activity note logged
  const activities = leadService.getLeadActivities(leadA.id);
  assert.equal(activities.length, 1, 'Initial creation activity must be logged');
  assert.equal(activities[0].action, 'Lead Created');
});

test('Step 10 - Test 2: Safe lead reassignment updates assignment, logs activity, and updates metrics', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  leadService.setActiveCompany(companyA);

  const lead = await leadService.saveLead({
    company_id: companyA,
    customer_name: 'Beta Customer',
    phone: '9847000002',
    service_required: 'Lookwalker',
    assigned_telecaller_email: 'staffA@b2p.com',
    status: 'telecaller_working'
  }, 'owner@b2p.com');

  // Reassign using reassignLead
  const updated = await leadService.reassignLead(lead.id, 'staffB@b2p.com', 'owner@b2p.com');
  assert.ok(updated);
  assert.equal(updated.assigned_telecaller_email, 'staffb@b2p.com');

  // Verify activities include Staff Reassigned
  const activities = leadService.getLeadActivities(lead.id);
  const reassignAct = activities.find(a => a.action === 'Staff Reassigned');
  assert.ok(reassignAct, 'Staff Reassigned activity must be logged');
  assert.match(reassignAct.note || '', /staffa.*staffb/i, 'Activity note must record handover from staffA to staffB');

  // Verify telecaller metrics shifted
  const metrics = metricsService.getTelecallerMetrics(undefined, companyA);
  const staffARow = metrics.find(r => r.email === 'staffa@b2p.com');
  const staffBRow = metrics.find(r => r.email === 'staffb@b2p.com');
  assert.equal(staffARow?.assignedLeads || 0, 0, 'Staff A must have 0 assigned leads after reassignment');
  assert.equal(staffBRow?.assignedLeads, 1, 'Staff B must have 1 assigned lead after reassignment');
});

test('Step 10 - Test 3: Safe lead reassignment via saveLead logs activity and preserves next_follow_up_at', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  leadService.setActiveCompany(companyA);
  const todayStr = dateUtils.getKolkataToday();

  const lead = await leadService.saveLead({
    company_id: companyA,
    customer_name: 'Gamma Customer',
    phone: '9847000003',
    service_required: 'LED Wall',
    assigned_telecaller_email: 'staffA@b2p.com',
    status: 'new'
  }, 'admin@b2p.com');

  // Attach a follow-up
  await officeService.saveFollowUp({
    company_id: companyA,
    lead_id: lead.id,
    customer_name: 'Gamma Customer',
    due_date: todayStr,
    due_time: '15:00',
    reason: 'Follow-up discussion'
  }, 'staffA@b2p.com');

  const leadWithFollowUp = leadService.getLeadById(lead.id);
  assert.ok(leadWithFollowUp.next_follow_up_at, 'next_follow_up_at must be populated');
  const savedNextAt = leadWithFollowUp.next_follow_up_at;

  // Edit lead via saveLead to reassign to Staff C
  const edited = await leadService.saveLead({
    id: lead.id,
    customer_name: 'Gamma Customer',
    phone: '9847000003',
    assigned_telecaller_email: 'staffC@b2p.com'
  }, 'owner@b2p.com');

  assert.equal(edited.assigned_telecaller_email, 'staffc@b2p.com');
  assert.equal(edited.next_follow_up_at, savedNextAt, 'next_follow_up_at must be preserved across reassignment');

  const activities = leadService.getLeadActivities(lead.id);
  const reassignAct = activities.find(a => a.action === 'Staff Reassigned');
  assert.ok(reassignAct, 'Staff Reassigned activity must be logged on saveLead reassignment');
});

test('Step 10 - Test 4: Lead status transition consistency across full pipeline', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  leadService.setActiveCompany(companyA);

  const lead = await leadService.saveLead({
    company_id: companyA,
    customer_name: 'Pipeline Test',
    phone: '9847000004',
    service_required: 'Mobile Roadshow Campaigns',
    status: 'new'
  }, 'admin@b2p.com');

  // 1. Working
  await leadService.updateLeadStatus(lead.id, 'telecaller_working', 'staff@b2p.com');
  assert.equal(leadService.getLeadById(lead.id).status, 'telecaller_working');

  // 2. Requirement Collected
  await leadService.updateLeadStatus(lead.id, 'requirement_collected', 'staff@b2p.com');
  assert.equal(leadService.getLeadById(lead.id).status, 'requirement_collected');

  // 3. Send to Admin validation
  const invalidHandover = await leadService.sendToAdmin('non-existent-id', 'staff@b2p.com');
  assert.equal(invalidHandover.success, false);

  const validHandover = await leadService.sendToAdmin(lead.id, 'staff@b2p.com', 'Client ready for quotation');
  assert.equal(validHandover.success, true);
  assert.equal(leadService.getLeadById(lead.id).status, 'sent_to_admin');

  // 4. Start Quotation Preparation
  const quotePrep = await leadService.startQuotationPreparation(lead.id, 'admin@b2p.com');
  assert.equal(quotePrep.success, true);
  assert.equal(leadService.getLeadById(lead.id).status, 'quotation_preparing');

  // 5. Confirmed (Won)
  await leadService.updateLeadStatus(lead.id, 'confirmed', 'owner@b2p.com');
  assert.equal(leadService.getLeadById(lead.id).status, 'confirmed');

  // Verify lead counts by status
  const counts = metricsService.getLeadCounts(undefined, companyA);
  assert.equal(counts.byStatus['confirmed'], 1);
  assert.equal(counts.byStatus['new'], 0);

  // Verify full timeline is preserved
  const acts = leadService.getLeadActivities(lead.id);
  assert.ok(acts.length >= 5, 'Every lifecycle step must be recorded in lead_activities');
});

test('Step 10 - Test 5: Follow-ups remain attached to correct lead across lifecycle', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  leadService.setActiveCompany(companyA);
  const todayStr = dateUtils.getKolkataToday();

  const lead1 = await leadService.saveLead({ company_id: companyA, customer_name: 'Lead One', phone: '9847000005', status: 'new' });
  const lead2 = await leadService.saveLead({ company_id: companyA, customer_name: 'Lead Two', phone: '9847000006', status: 'new' });

  // Add follow-up for Lead 1
  const fu1 = await officeService.saveFollowUp({
    company_id: companyA,
    lead_id: lead1.id,
    customer_name: 'Lead One',
    due_date: todayStr,
    due_time: '11:00',
    reason: 'Call 1'
  }, 'staff@b2p.com');

  // Add follow-up for Lead 2
  const fu2 = await officeService.saveFollowUp({
    company_id: companyA,
    lead_id: lead2.id,
    customer_name: 'Lead Two',
    due_date: todayStr,
    due_time: '12:00',
    reason: 'Call 2'
  }, 'staff@b2p.com');

  // Verify follow-ups are attached to correct leads
  assert.equal(fu1.lead_id, lead1.id);
  assert.equal(fu2.lead_id, lead2.id);

  // Status change on Lead 1 does not affect Lead 2 or unattach follow-ups
  await leadService.updateLeadStatus(lead1.id, 'confirmed', 'staff@b2p.com');
  const allFu = officeService.getFollowUps('all', companyA);
  const fuLead1 = allFu.find(f => f.id === fu1.id);
  const fuLead2 = allFu.find(f => f.id === fu2.id);

  assert.equal(fuLead1.lead_id, lead1.id, 'Follow-up 1 must remain attached to Lead 1');
  assert.equal(fuLead2.lead_id, lead2.id, 'Follow-up 2 must remain attached to Lead 2');
});

test('Step 10 - Test 6: Company tenant isolation prevents cross-company leakage', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  const companyB = '22222222-2222-4222-8222-222222222222';

  // Company A lead
  leadService.setActiveCompany(companyA);
  const leadA = await leadService.saveLead({
    company_id: companyA,
    customer_name: 'Company A Lead',
    phone: '9847000007',
    assigned_telecaller_email: 'shared@b2p.com',
    status: 'new'
  });

  // Company B lead
  leadService.setActiveCompany(companyB);
  const leadB = await leadService.saveLead({
    company_id: companyB,
    customer_name: 'Company B Lead',
    phone: '9847000008',
    assigned_telecaller_email: 'shared@b2p.com',
    status: 'new'
  });

  // Querying Company A must only return Lead A
  const leadsA = leadService.getLeads(companyA);
  assert.equal(leadsA.length, 1);
  assert.equal(leadsA[0].id, leadA.id);

  // Querying Company B must only return Lead B
  const leadsB = leadService.getLeads(companyB);
  assert.equal(leadsB.length, 1);
  assert.equal(leadsB[0].id, leadB.id);

  // Scoped metrics for shared telecaller
  const metricsA = metricsService.getTelecallerMetrics('shared@b2p.com', companyA);
  const metricsB = metricsService.getTelecallerMetrics('shared@b2p.com', companyB);
  assert.equal(metricsA[0].assignedLeads, 1);
  assert.equal(metricsB[0].assignedLeads, 1);
});

test('Step 10 - Test 7: Deleting a lead cleans up activities and unlinks follow-ups (mirrors ON DELETE SET NULL)', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  leadService.setActiveCompany(companyA);
  const todayStr = dateUtils.getKolkataToday();

  const lead = await leadService.saveLead({
    company_id: companyA,
    customer_name: 'Lead To Delete',
    phone: '9847000009',
    status: 'new'
  });

  // Add activity and follow-up
  await leadService.addLeadActivity({
    lead_id: lead.id,
    company_id: companyA,
    user_email: 'staff@b2p.com',
    action: 'Note Logged',
    note: 'Initial contact'
  });

  const fu = await officeService.saveFollowUp({
    company_id: companyA,
    lead_id: lead.id,
    customer_name: 'Lead To Delete',
    due_date: todayStr,
    reason: 'Follow-up'
  }, 'staff@b2p.com');

  assert.equal(officeService.getFollowUps('all', companyA).length, 1);
  assert.equal(leadService.getLeadActivities(lead.id).length, 3, 'Must have 3 activities: Lead Created, Note Logged, Follow-up Scheduled');

  // Delete lead
  await leadService.deleteLead(lead.id);

  // Verify lead is gone
  assert.equal(leadService.getLeadById(lead.id), null);
  assert.equal(leadService.getLeads(companyA).length, 0);

  // Verify activities for this lead are cleaned up (mirrors ON DELETE CASCADE)
  assert.equal(leadService.getLeadActivities(lead.id).length, 0);

  // Verify follow-up is unlinked (mirrors ON DELETE SET NULL), customer record intact
  const remainingFu = officeService.getFollowUps('all', companyA);
  assert.equal(remainingFu.length, 1);
  assert.equal(remainingFu[0].id, fu.id);
  assert.equal(remainingFu[0].lead_id, undefined, 'lead_id must be unlinked');
  assert.equal(remainingFu[0].customer_name, 'Lead To Delete', 'Follow-up customer data must be preserved');
});

test('Step 10 - Test 8: Closed (Lost) lead preserves data and updates conversion metrics', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  leadService.setActiveCompany(companyA);

  const lead = await leadService.saveLead({
    company_id: companyA,
    customer_name: 'Lost Opportunity',
    phone: '9847000010',
    assigned_telecaller_email: 'staff@b2p.com',
    status: 'telecaller_working'
  });

  // Mark lost
  await leadService.updateLeadStatus(lead.id, 'lost', 'staff@b2p.com', 'Client chose competitor');

  const lostLead = leadService.getLeadById(lead.id);
  assert.equal(lostLead.status, 'lost');

  // Verify metrics reflect lost lead
  const metrics = metricsService.getTelecallerMetrics('staff@b2p.com', companyA);
  assert.equal(metrics[0].lost, 1);
  assert.equal(metrics[0].conversionRate, 0);

  // Lead counts
  const counts = metricsService.getLeadCounts(undefined, companyA);
  assert.equal(counts.byStatus['lost'], 1);
});

test('Step 10 - Test 9: Steps 1–9 non-regression verification', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  leadService.setActiveCompany(companyA);
  const todayStr = dateUtils.getKolkataToday();

  // Create lead
  const lead = await leadService.saveLead({
    company_id: companyA,
    customer_name: 'Regression Test',
    phone: '9847000011',
    assigned_telecaller_email: 'staff1@b2p.com',
    status: 'new'
  });

  // Step 1: Follow-up edit preservation
  const fu = await officeService.saveFollowUp({
    company_id: companyA,
    lead_id: lead.id,
    customer_name: 'Regression Test',
    due_date: todayStr,
    due_time: '10:00',
    reason: 'Initial check'
  }, 'staff1@b2p.com');

  assert.equal(leadService.getLeadById(lead.id).next_follow_up_at?.split('T')[0], todayStr);

  // Step 6 & 8: Snoozed status lifecycle
  await officeService.snoozeFollowUp(fu.id, 60, 'staff1@b2p.com');
  assert.equal(leadService.getLeadById(lead.id).next_follow_up_at, null);

  // Step 5: Follow-up counters & badges
  const fuCounts = metricsService.getFollowUpCounts(undefined, companyA);
  assert.equal(fuCounts.snoozed, 1);
  assert.equal(fuCounts.today, 0);

  // Step 9: Assigned ≠ Called
  const ownerDaily = metricsService.getOwnerDailyMetrics({ type: 'today' }, companyA);
  assert.equal(ownerDaily.newLeads, 1);
});

test('Step 10 - Test 10: Document workflow remains intact with quotation linked to lead', async () => {
  storage.clear();
  const companyA = '11111111-1111-4111-8111-111111111111';
  leadService.setActiveCompany(companyA);

  const lead = await leadService.saveLead({
    company_id: companyA,
    customer_name: 'Quotation Deal',
    company_name: 'Deal Corp',
    phone: '9847000012',
    service_required: '3 Side LED Van',
    status: 'quotation_preparing'
  });

  // Save CRM quotation linked to lead
  const quote = await officeService.saveQuotation({
    company_id: companyA,
    lead_id: lead.id,
    lead_number: lead.lead_number,
    customer_name: 'Quotation Deal',
    company_name: 'Deal Corp',
    customer_phone: '9847000012',
    service_required: '3 Side LED Van',
    campaign_location: 'Kochi',
    required_date: '2026-10-01',
    number_of_days: 2,
    subtotal: 50000,
    tax_total: 9000,
    discount_total: 0,
    total: 59000,
    items: [],
    approval_status: 'WAITING_APPROVAL'
  }, 'staff@b2p.com');

  assert.ok(quote.id);
  assert.equal(quote.lead_id, lead.id);
  assert.equal(quote.total, 59000);

  // Quotation counts
  const quoteCounts = metricsService.getQuotationCounts();
  assert.equal(quoteCounts.waitingApproval, 1);
});
