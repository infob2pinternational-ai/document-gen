import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

function transpileTs(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext }
  }).outputText;
}

class MockStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

const dateUtilsJs = transpileTs('../src/utils/dateUtils.ts');
const dateUtils = await import(`data:text/javascript;base64,${Buffer.from(dateUtilsJs).toString('base64')}`);

const leadServiceMock = {
  leads: [],
  activities: [],
  getLeads() { return this.leads; },
  getLead(id) { return this.leads.find(l => l.id === id) || null; },
  getLeadById(id) { return this.leads.find(l => l.id === id) || null; },
  saveLead(lead) {
    const idx = this.leads.findIndex(l => l.id === lead.id);
    if (idx >= 0) this.leads[idx] = { ...this.leads[idx], ...lead };
    else this.leads.push(lead);
    return lead;
  },
  getLeadActivities(leadId) {
    if (!leadId) return this.activities;
    return this.activities.filter(a => a.lead_id === leadId);
  },
  addLeadActivity(act) {
    const record = { id: `act-${Date.now()}-${Math.random()}`, created_at: new Date().toISOString(), ...act };
    this.activities.push(record);
    return record;
  },
  getActiveCompany() { return 'comp-1'; }
};

const officeServiceMock = {
  followUps: [],
  getOffices() { return [{ id: 'off-1', name: 'Calicut HQ' }]; },
  async saveFollowUp(fu) {
    this.followUps.push(fu);
    return fu;
  },
  getFollowUps() { return this.followUps; }
};

const metricsServiceMock = {
  recordLeadCallLogged() {},
  recordLeadStatusChange() {},
  notifyChange() {}
};

// INITIALIZE GLOBAL MOCKS BEFORE IMPORT
globalThis.localStorage = new MockStorage();
globalThis.__mockLeadService = leadServiceMock;
globalThis.__mockOfficeService = officeServiceMock;
globalThis.__mockMetricsService = metricsServiceMock;

let errorServiceSource = transpileTs('../src/services/errorService.ts');
errorServiceSource = errorServiceSource
  .replace("from './db'", "from 'mock:db'")
  .replace("from '../utils/uuid'", "from 'mock:uuid'")
  .replace("from './metricsService'", "from 'mock:metricsService'");

const errorMocks = {
  'mock:db': 'export const supabase = null; export const isCloudActive = () => false;',
  'mock:uuid': 'export const generateUUID = () => "err-uuid-" + Math.random().toString(36).slice(2);',
  'mock:metricsService': 'export const metricsService = globalThis.__mockMetricsService;'
};

for (const [key, code] of Object.entries(errorMocks)) {
  errorServiceSource = errorServiceSource.replaceAll(
    `'${key}'`,
    JSON.stringify(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
  );
}

const errorServiceModule = await import(`data:text/javascript;base64,${Buffer.from(errorServiceSource).toString('base64')}`);
const { errorService } = errorServiceModule;
globalThis.__mockErrorService = errorService;

let telecallingServiceSource = transpileTs('../src/services/telecallingService.ts');
telecallingServiceSource = telecallingServiceSource
  .replace("from './leadService'", "from 'mock:leadService'")
  .replace("from './officeService'", "from 'mock:officeService'")
  .replace("from './metricsService'", "from 'mock:metricsService'")
  .replace("from './errorService'", "from 'mock:errorService'")
  .replace("from '../utils/dateUtils'", "from 'mock:dateUtils'")
  .replace("from '../utils/staffUtils'", "from 'mock:staffUtils'");

const mocks = {
  'mock:leadService': 'export const leadService = globalThis.__mockLeadService;',
  'mock:officeService': 'export const officeService = globalThis.__mockOfficeService;',
  'mock:metricsService': 'export const metricsService = globalThis.__mockMetricsService;',
  'mock:errorService': 'export const errorService = globalThis.__mockErrorService;',
  'mock:dateUtils': dateUtilsJs,
  'mock:staffUtils': 'export const formatStaffDisplayName = e => e ? e.split(\'@\')[0] : \'Staff\';'
};

for (const [key, code] of Object.entries(mocks)) {
  telecallingServiceSource = telecallingServiceSource.replaceAll(
    `'${key}'`,
    JSON.stringify(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
  );
}

const telecallingModule = await import(`data:text/javascript;base64,${Buffer.from(telecallingServiceSource).toString('base64')}`);
const { telecallingService, determineLeadStatusFromOutcome, mapRemarkToOutcome } = telecallingModule;

beforeEach(() => {
  leadServiceMock.leads = [];
  leadServiceMock.activities = [];
  officeServiceMock.followUps = [];
  globalThis.localStorage.clear();
});

afterEach(() => {
  mock.restoreAll();
});

// 1. Asia/Kolkata Business Timezone Tests
test('dateUtils: accurately computes Asia/Kolkata date across UTC day boundaries', () => {
  const lateNightUtc = '2026-09-17T19:00:00.000Z';
  assert.equal(dateUtils.getIstDateStr(lateNightUtc), '2026-09-18');
  assert.equal(dateUtils.isTimestampOnIstDate(lateNightUtc, '2026-09-18'), true);
  assert.equal(dateUtils.isTimestampOnIstDate(lateNightUtc, '2026-09-17'), false);

  const morningUtc = '2026-09-17T02:00:00.000Z';
  assert.equal(dateUtils.getIstDateStr(morningUtc), '2026-09-17');
  assert.equal(dateUtils.isTimestampOnIstDate(morningUtc, '2026-09-17'), true);
});

// 2. Call Outcome to Lead Status Mapping
test('determineLeadStatusFromOutcome: maps telecalling outcomes to appropriate CRM pipeline stages', () => {
  assert.equal(determineLeadStatusFromOutcome('Requirement Collected', 'new'), 'requirement_collected');
  assert.equal(determineLeadStatusFromOutcome('Interested', 'new'), 'telecaller_working');
  assert.equal(determineLeadStatusFromOutcome('Call Back', 'new'), 'follow_up');
  assert.equal(determineLeadStatusFromOutcome('Follow-up Required', 'new'), 'follow_up');
  assert.equal(determineLeadStatusFromOutcome('Not Interested', 'new'), 'lost');
  assert.equal(determineLeadStatusFromOutcome('Invalid Number', 'new'), 'lost');
  assert.equal(determineLeadStatusFromOutcome('Appointment Confirmed', 'new'), 'telecaller_working');
});

// 3. Natural Language Remark Matching
test('mapRemarkToOutcome: infers correct CallOutcome from freeform Excel feedback text', () => {
  assert.equal(mapRemarkToOutcome('Client was busy, call back at 4pm'), 'Call Back');
  assert.equal(mapRemarkToOutcome('Wrong number, person said wrong person'), 'Invalid Number');
  assert.equal(mapRemarkToOutcome('Switched off, try tomorrow'), 'Switched Off');
  assert.equal(mapRemarkToOutcome('Already took services from another vendor, not interested'), 'Not Interested');
  assert.equal(mapRemarkToOutcome('Wants to know quotation for ISO certification, spec collected'), 'Requirement Collected');
  assert.equal(mapRemarkToOutcome('Confirmed meeting at office on Friday'), 'Meeting Scheduled');
  assert.equal(mapRemarkToOutcome('no answer'), 'No Answer');
});

// 4. Excel Import Preview and Duplicate Detection
test('previewExcelImport: detects duplicates against database and within sheet', () => {
  leadServiceMock.leads = [
    {
      id: 'existing-1',
      company_name: 'Existing Motors Pvt Ltd',
      customer_name: 'Existing Motors Pvt Ltd',
      phone: '9876543210',
      status: 'new',
      lead_source: 'telecalling'
    }
  ];

  const rawRows = [
    {
      company_name: 'Existing Motors Pvt Ltd',
      customer_name: 'Manager',
      phone: '9876543210',
      location: 'Calicut',
      remarks: 'Called yesterday'
    },
    {
      company_name: 'New Enterprise A',
      customer_name: 'Director',
      phone: '9123456780',
      location: 'Cochin',
      remarks: 'Interested in registration'
    },
    {
      company_name: 'New Enterprise B (Duplicate phone of A in file)',
      customer_name: 'Director',
      phone: '9123456780',
      location: 'Cochin',
      remarks: ''
    }
  ];

  const preview = telecallingService.previewExcelImport(rawRows);
  assert.equal(preview.totalRows, 3);
  assert.equal(preview.newRows.length, 1);
  assert.equal(preview.duplicateRows.length, 2);

  // Row 0 is duplicate with existing lead
  assert.equal(preview.duplicateRows[0].existingLead.id, 'existing-1');
  assert.equal(preview.duplicateRows[0].matchReason.includes('primary phone'), true);

  // Row 2 is duplicate within file
  assert.equal(preview.duplicateRows[1].row.company_name.includes('New Enterprise B'), true);
  assert.equal(preview.duplicateRows[1].matchReason.includes('within this import file'), true);
});

// 5. Logging Call Result: updates lead, increments count, and creates immutable audit record
test('logCallResult: updates lead counters and appends immutable lead_activity record', async () => {
  const initialLead = {
    id: 'lead-test-101',
    company_name: 'Apex Industries',
    customer_name: 'Rahul V',
    phone: '9847012345',
    status: 'new',
    lead_source: 'cold_calling',
    call_count: 0
  };
  leadServiceMock.leads = [initialLead];

  const result = await telecallingService.logCallResult({
    leadId: 'lead-test-101',
    telecallerEmail: 'anjali@b2p.com',
    callOutcome: 'Interested',
    remarks: 'Customer showed strong interest in factory license renewal. Requested follow up tomorrow morning.',
    followUpDate: '2026-09-18',
    followUpTime: '10:30',
    contactPerson: 'Rahul V',
    phoneUsed: '9847012345'
  });

  // Verify Lead is updated
  assert.equal(result.lead.call_count, 1);
  assert.equal(result.lead.last_call_outcome, 'Interested');
  assert.equal(result.lead.last_contacted_by_email, 'anjali@b2p.com');
  assert.equal(result.lead.status, 'telecaller_working');
  assert.equal(result.lead.next_follow_up_at, '2026-09-18T10:30:00');

  // Verify immutable lead_activities entry was created
  assert.equal(leadServiceMock.activities.length, 1);
  const act = leadServiceMock.activities[0];
  assert.equal(act.lead_id, 'lead-test-101');
  assert.equal(act.user_email, 'anjali@b2p.com');
  assert.equal(act.activity_type, 'call');
  assert.equal(act.call_outcome, 'Interested');
  assert.equal(act.phone_used, '9847012345');
  assert.equal(act.note.includes('Customer showed strong interest'), true);
  assert.equal(act.next_follow_up_at, '2026-09-18T10:30:00');

  // Verify FollowUp was scheduled
  assert.equal(officeServiceMock.followUps.length, 1);
  assert.equal(officeServiceMock.followUps[0].due_date, '2026-09-18');
  assert.equal(officeServiceMock.followUps[0].due_time, '10:30');

  // Log second call to verify count increments and history appends rather than overwrites
  await telecallingService.logCallResult({
    leadId: 'lead-test-101',
    telecallerEmail: 'anjali@b2p.com',
    callOutcome: 'Requirement Collected',
    remarks: 'Collected document list for inspection.',
    phoneUsed: '9847012345'
  });

  const leadAfterSecondCall = leadServiceMock.getLead('lead-test-101');
  assert.equal(leadAfterSecondCall.call_count, 2);
  assert.equal(leadAfterSecondCall.last_call_outcome, 'Requirement Collected');
  assert.equal(leadAfterSecondCall.status, 'requirement_collected');

  // Must have 2 distinct historical activities now
  assert.equal(leadServiceMock.activities.length, 2);
  assert.equal(leadServiceMock.activities[0].call_outcome, 'Interested');
  assert.equal(leadServiceMock.activities[1].call_outcome, 'Requirement Collected');
});

// 6. In-flight Submission Locking Test
test('logCallResult: locks concurrent submissions for the same lead to prevent duplicate activities', async () => {
  const lead = {
    id: 'lead-concurrent-1',
    customer_name: 'Concurrent Client',
    phone: '9847099999',
    status: 'new'
  };
  leadServiceMock.leads = [lead];

  let delayedResolve;
  const originalSave = leadServiceMock.saveLead;
  leadServiceMock.saveLead = (l) => new Promise(res => {
    delayedResolve = () => res(originalSave.call(leadServiceMock, l));
  });

  const p1 = telecallingService.logCallResult({
    leadId: 'lead-concurrent-1',
    telecallerEmail: 'anjali@b2p.com',
    callOutcome: 'Connected',
    remarks: 'Call 1'
  });

  // Second concurrent submission must throw lock rejection
  await assert.rejects(
    async () => {
      await telecallingService.logCallResult({
        leadId: 'lead-concurrent-1',
        telecallerEmail: 'anjali@b2p.com',
        callOutcome: 'Connected',
        remarks: 'Call 2 duplicate'
      });
    },
    /A call save for this contact is already in progress/
  );

  delayedResolve();
  await p1;
  leadServiceMock.saveLead = originalSave;
});

// 7. Follow-up Error Decoupling Test
test('logCallResult: call activity is preserved and returned with followUpError if follow-up creation fails', async () => {
  const lead = {
    id: 'lead-fail-fu-1',
    customer_name: 'Resilient Client',
    phone: '9847088888',
    status: 'new'
  };
  leadServiceMock.leads = [lead];

  const originalSaveFollowUp = officeServiceMock.saveFollowUp;
  officeServiceMock.saveFollowUp = async () => {
    throw new Error('Supabase network timeout on follow_ups');
  };

  const result = await telecallingService.logCallResult({
    leadId: 'lead-fail-fu-1',
    telecallerEmail: 'anjali@b2p.com',
    callOutcome: 'Call Back',
    remarks: 'Customer asked for callback tomorrow at 3pm',
    followUpDate: '2026-09-18',
    followUpTime: '15:00'
  });

  // Call activity must be recorded safely despite follow-up failure!
  assert.equal(result.lead.id, 'lead-fail-fu-1');
  assert.equal(result.lead.call_count, 1);
  assert.equal(leadServiceMock.activities.length, 1);
  assert.equal(leadServiceMock.activities[0].call_outcome, 'Call Back');

  // followUpError is captured
  assert.ok(result.followUpError);
  assert.equal(result.followUpError.includes('Supabase network timeout on follow_ups'), true);

  // Restore
  officeServiceMock.saveFollowUp = originalSaveFollowUp;
});

// 8. Dedicated retryFollowUp Test
test('retryFollowUp: schedules follow-up without duplicating call activity or incrementing call_count', async () => {
  const lead = {
    id: 'lead-retry-fu-1',
    customer_name: 'Retry Client',
    phone: '9847077777',
    status: 'telecaller_working',
    call_count: 1,
    last_call_remark: 'Spoke with client'
  };
  leadServiceMock.leads = [lead];
  leadServiceMock.activities = [
    { id: 'existing-act', lead_id: 'lead-retry-fu-1', call_outcome: 'Connected' }
  ];

  await telecallingService.retryFollowUp({
    leadId: 'lead-retry-fu-1',
    telecallerEmail: 'anjali@b2p.com',
    dueDate: '2026-09-19',
    dueTime: '11:00',
    reason: 'Follow-up on quote'
  });

  // Follow-up was created
  assert.equal(officeServiceMock.followUps.length, 1);
  assert.equal(officeServiceMock.followUps[0].due_date, '2026-09-19');
  assert.equal(officeServiceMock.followUps[0].due_time, '11:00');

  // Lead next_follow_up_at updated
  const updatedLead = leadServiceMock.getLead('lead-retry-fu-1');
  assert.equal(updatedLead.next_follow_up_at, '2026-09-19T11:00:00');

  // call_count and activities count MUST NOT change!
  assert.equal(updatedLead.call_count, 1);
  assert.equal(leadServiceMock.activities.length, 1);
});

// 9. errorService Sanitization and Persistence Test
test('errorService: sanitizes sensitive tokens and passwords and writes to local storage buffer', async () => {
  const logged = await errorService.logError({
    userEmail: 'telecaller@b2p.com',
    operation: 'test_op',
    errorMessage: 'Something went wrong',
    metadata: {
      password: 'SuperSecretPassword123',
      apiKey: 'xyz-secret-key',
      safeDetail: 'Company ABC'
    }
  });

  assert.equal(logged.metadata.password, '[REDACTED]');
  assert.equal(logged.metadata.apiKey, '[REDACTED]');
  assert.equal(logged.metadata.safeDetail, 'Company ABC');

  // Check it is retrievable via getErrors
  const errors = await errorService.getErrors();
  assert.ok(errors.length > 0);
  assert.equal(errors[0].operation, 'test_op');
});

// 10. Network Retry Idempotency Test
test('logCallResult: idempotency prevents duplicate call count and duplicate activity on network retry', async () => {
  const lead = {
    id: 'lead-idempotent-1',
    customer_name: 'Retry Client Ltd',
    phone: '9847099999',
    status: 'new',
    call_count: 0
  };
  leadServiceMock.leads = [lead];
  leadServiceMock.activities = [];

  const submissionToken = 'unique-session-token-abc-123';

  // First call submission
  const firstResult = await telecallingService.logCallResult({
    leadId: 'lead-idempotent-1',
    telecallerEmail: 'anjali@b2p.com',
    callOutcome: 'Connected',
    remarks: 'Customer answered, asked for presentation',
    submissionToken
  });

  assert.equal(firstResult.lead.call_count, 1);
  assert.equal(leadServiceMock.activities.length, 1);
  const firstActivityId = firstResult.activity.id;

  // Immediate retry with the same submissionToken (simulating dropped response retry)
  const retryResult = await telecallingService.logCallResult({
    leadId: 'lead-idempotent-1',
    telecallerEmail: 'anjali@b2p.com',
    callOutcome: 'Connected',
    remarks: 'Customer answered, asked for presentation',
    submissionToken
  });

  // Must return the cached result without creating a new activity or incrementing call_count
  assert.equal(retryResult.activity.id, firstActivityId);
  const recheckLead = leadServiceMock.getLead('lead-idempotent-1');
  assert.equal(recheckLead.call_count, 1, 'call_count must remain 1 and not be double-incremented');
  assert.equal(leadServiceMock.activities.length, 1, 'activities count must remain 1 without duplicate entries');

  // Secondary heuristic check: retry without token within 60s
  const heuristicRetryResult = await telecallingService.logCallResult({
    leadId: 'lead-idempotent-1',
    telecallerEmail: 'anjali@b2p.com',
    callOutcome: 'Connected',
    remarks: 'Customer answered, asked for presentation'
  });

  assert.equal(heuristicRetryResult.activity.id, firstActivityId);
  assert.equal(leadServiceMock.getLead('lead-idempotent-1').call_count, 1);
  assert.equal(leadServiceMock.activities.length, 1);
});

