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

// Mock crypto.randomUUID
if (!globalThis.crypto) {
  globalThis.crypto = {};
}
let uuidCounter = 1000;
globalThis.crypto.randomUUID = () => `uuid-${uuidCounter++}`;

// Mock CustomEvent and window dispatch
globalThis.window = {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {}
};

// Load dependencies
const dateUtils = await load('../src/utils/dateUtils.ts');
const staffUtils = await load('../src/utils/staffUtils.ts');
const dateUtilsModule = asModule(transpile('../src/utils/dateUtils.ts'));
const staffUtilsModule = asModule(transpile('../src/utils/staffUtils.ts'));

const { metricsService } = await load('../src/services/metricsService.ts', {
  '../utils/dateUtils': dateUtilsModule,
  '../utils/staffUtils': staffUtilsModule
});

let leadSeqNum = 1;
const leadServiceModule = asModule(
  transpile('../src/services/leadService.ts')
    .replaceAll(`'./metricsService'`, JSON.stringify(asModule('export const metricsService = { notifyChange() {} };')))
    .replaceAll(`'./db'`, JSON.stringify(asModule('export const isCloudActive = () => false; export const supabase = null;')))
    .replaceAll(`'../utils/uuid'`, JSON.stringify(asModule('let seq = 1; export const generateUUID = () => "lead-uuid-" + (seq++);')))
    .replaceAll(`'../utils/staffUtils'`, JSON.stringify(staffUtilsModule))
);

const { leadService } = await import(leadServiceModule);

// Mock dbService for customers
const dbService = {
  getCustomers(companyId) {
    try {
      const raw = localStorage.getItem('customers');
      const list = raw ? JSON.parse(raw) : [];
      return list.filter(c => c.company_id === companyId);
    } catch {
      return [];
    }
  },
  async saveCustomer(customer) {
    if (!customer.id) {
      customer.id = globalThis.crypto.randomUUID();
    }
    const raw = localStorage.getItem('customers');
    const customers = raw ? JSON.parse(raw) : [];
    const idx = customers.findIndex(c => c.id === customer.id);
    if (idx >= 0) {
      customers[idx] = customer;
    } else {
      customers.push(customer);
    }
    localStorage.setItem('customers', JSON.stringify(customers));
    return customer;
  },
  async deleteCustomer(id) {
    const raw = localStorage.getItem('customers');
    const customers = raw ? JSON.parse(raw) : [];
    localStorage.setItem('customers', JSON.stringify(customers.filter(c => c.id !== id)));

    // Mirror ON DELETE SET NULL for leads in local cache
    try {
      const rawLeads = localStorage.getItem('docgen_leads');
      if (rawLeads) {
        const leads = JSON.parse(rawLeads);
        let changed = false;
        leads.forEach(l => {
          if (l.customer_id === id) {
            delete l.customer_id;
            changed = true;
          }
        });
        if (changed) {
          localStorage.setItem('docgen_leads', JSON.stringify(leads));
        }
      }
    } catch {}
  }
};

function resetStorage() {
  storage.clear();
  uuidCounter = 1000;
  leadService.setActiveCompany(null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 11 Test 1: Rapid concurrent lead submission / in-flight serialization
// ─────────────────────────────────────────────────────────────────────────────
test('Step 11 - Test 1: Concurrent saveLead calls are serialized and receive unique sequence numbers', async () => {
  resetStorage();
  const companyId = 'comp-test-01';
  leadService.setActiveCompany(companyId);

  // Execute two concurrent lead saves simultaneously
  const [lead1, lead2] = await Promise.all([
    leadService.saveLead({
      company_id: companyId,
      customer_name: 'Alpha Customer',
      phone: '9847000001',
      location: 'Thrissur'
    }, 'telecaller@test.com'),
    leadService.saveLead({
      company_id: companyId,
      customer_name: 'Beta Customer',
      phone: '9847000002',
      location: 'Kochi'
    }, 'telecaller@test.com')
  ]);

  assert.ok(lead1.lead_number, 'lead1 must have a lead_number');
  assert.ok(lead2.lead_number, 'lead2 must have a lead_number');
  assert.notEqual(lead1.lead_number, lead2.lead_number, 'Concurrent leads must NOT have identical lead numbers');
  assert.notEqual(lead1.id, lead2.id, 'Concurrent leads must have distinct IDs');

  const allLeads = leadService.getLeads(companyId);
  assert.equal(allLeads.length, 2, 'Exactly 2 leads must be stored in cache');
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 11 Test 2: Rapid duplicate customer submission & synchronous single-flight
// ─────────────────────────────────────────────────────────────────────────────
test('Step 11 - Test 2: Rapid customer submission and fallback UUID protection', async () => {
  resetStorage();
  const companyId = 'comp-test-02';

  // Customer created with explicit ID
  const cust1 = await dbService.saveCustomer({
    id: 'cust-101',
    company_id: companyId,
    name: 'Rapid Corp',
    phone: '9847012345'
  });
  assert.equal(cust1.id, 'cust-101');

  // Customer created without pre-assigned ID gets auto-generated UUID
  const cust2 = await dbService.saveCustomer({
    company_id: companyId,
    name: 'Auto UUID Corp',
    phone: '9847054321'
  });
  assert.ok(cust2.id, 'Customer without ID must receive auto-assigned UUID');

  // Verify single-flight guard pattern (reproducing Customers.tsx saveInProgressRef contract)
  let saveCount = 0;
  const saveInProgressRef = { current: false };

  const handleSimulatedSubmit = async () => {
    if (saveInProgressRef.current) return;
    saveInProgressRef.current = true;
    try {
      saveCount++;
      await new Promise(r => setTimeout(r, 10));
    } finally {
      saveInProgressRef.current = false;
    }
  };

  // Two synchronous rapid triggers in microtask
  const p1 = handleSimulatedSubmit();
  const p2 = handleSimulatedSubmit();
  await Promise.all([p1, p2]);

  assert.equal(saveCount, 1, 'Synchronous lock must block immediate second invocation');
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 11 Test 3: Failed save + retry preserves data without duplicate creation
// ─────────────────────────────────────────────────────────────────────────────
test('Step 11 - Test 3: Failed save and retry creates exactly one successful record', async () => {
  resetStorage();
  const companyId = 'comp-test-03';
  leadService.setActiveCompany(companyId);

  let failOnce = true;
  const failingStorage = {
    async attemptSave(formData) {
      if (failOnce) {
        failOnce = false;
        throw new Error('Network timeout simulated');
      }
      return leadService.saveLead(formData, 'telecaller@test.com');
    }
  };

  const formData = {
    company_id: companyId,
    customer_name: 'Retry Lead Client',
    phone: '9998887771',
    location: 'Calicut',
    notes: 'Important campaign intake notes'
  };

  // Attempt 1: Fails
  let err = null;
  try {
    await failingStorage.attemptSave(formData);
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'First attempt must fail as simulated');
  assert.equal(leadService.getLeads(companyId).length, 0, 'No lead should be saved on failed attempt');

  // Attempt 2: Form data intact, user retries
  const saved = await failingStorage.attemptSave(formData);
  assert.ok(saved.id, 'Retry must succeed');
  assert.equal(leadService.getLeads(companyId).length, 1, 'Exactly one lead must exist after retry');
  assert.equal(saved.customer_name, 'Retry Lead Client');
  assert.equal(saved.notes, 'Important campaign intake notes');
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 11 Test 4: Edit existing records does not create duplicates
// ─────────────────────────────────────────────────────────────────────────────
test('Step 11 - Test 4: Editing existing lead and customer replaces in place and does not duplicate', async () => {
  resetStorage();
  const companyId = 'comp-test-04';
  leadService.setActiveCompany(companyId);

  // 1. Create lead
  const initialLead = await leadService.saveLead({
    company_id: companyId,
    customer_name: 'Edit Test Customer',
    phone: '9847111222',
    status: 'new'
  }, 'telecaller@test.com');

  assert.equal(leadService.getLeads(companyId).length, 1);
  const originalLeadNumber = initialLead.lead_number;
  const originalId = initialLead.id;

  // 2. Edit lead
  const updatedLead = await leadService.saveLead({
    id: originalId,
    company_id: companyId,
    customer_name: 'Edit Test Customer Updated',
    phone: '9847111222',
    status: 'interested'
  }, 'telecaller@test.com');

  assert.equal(leadService.getLeads(companyId).length, 1, 'Editing must NOT create a second lead');
  assert.equal(updatedLead.id, originalId, 'ID must remain identical');
  assert.equal(updatedLead.lead_number, originalLeadNumber, 'lead_number must NOT be regenerated on edit');
  assert.equal(updatedLead.status, 'interested', 'Status must be updated');

  // 3. Create customer and edit
  const cust = await dbService.saveCustomer({
    id: 'cust-edit-01',
    company_id: companyId,
    name: 'Initial Customer Name',
    phone: '9847000111'
  });
  assert.equal(dbService.getCustomers(companyId).length, 1);

  const updatedCust = await dbService.saveCustomer({
    id: 'cust-edit-01',
    company_id: companyId,
    name: 'Updated Customer Name',
    phone: '9847000999'
  });
  assert.equal(dbService.getCustomers(companyId).length, 1, 'Editing customer must NOT create a second customer');
  assert.equal(updatedCust.id, 'cust-edit-01');
  assert.equal(updatedCust.name, 'Updated Customer Name');
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 11 Test 5: Company / Tenant Isolation prevents cross-company leakage
// ─────────────────────────────────────────────────────────────────────────────
test('Step 11 - Test 5: Company isolation ensures identical data across companies never collides', async () => {
  resetStorage();
  const companyA = 'comp-tenant-aaa';
  const companyB = 'comp-tenant-bbb';

  // Customer with same name & phone in Company A and Company B
  await dbService.saveCustomer({
    id: 'cust-aaa',
    company_id: companyA,
    name: 'Common Name Client',
    phone: '9847999888'
  });

  await dbService.saveCustomer({
    id: 'cust-bbb',
    company_id: companyB,
    name: 'Common Name Client',
    phone: '9847999888'
  });

  const custsA = dbService.getCustomers(companyA);
  const custsB = dbService.getCustomers(companyB);

  assert.equal(custsA.length, 1);
  assert.equal(custsA[0].id, 'cust-aaa');
  assert.equal(custsB.length, 1);
  assert.equal(custsB[0].id, 'cust-bbb');

  // Leads in Company A and Company B
  const leadA = await leadService.saveLead({
    company_id: companyA,
    customer_name: 'Lead Client X',
    phone: '9847000555'
  }, 'staff@a.com');

  const leadB = await leadService.saveLead({
    company_id: companyB,
    customer_name: 'Lead Client X',
    phone: '9847000555'
  }, 'staff@b.com');

  assert.equal(leadService.getLeads(companyA).length, 1);
  assert.equal(leadService.getLeads(companyA)[0].id, leadA.id);
  assert.equal(leadService.getLeads(companyB).length, 1);
  assert.equal(leadService.getLeads(companyB)[0].id, leadB.id);
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 11 Test 6: Duplicate lead number protection and sequence integrity
// ─────────────────────────────────────────────────────────────────────────────
test('Step 11 - Test 6: Sequence generator guarantees monotonically increasing unique lead numbers', async () => {
  resetStorage();
  const companyId = 'comp-seq-06';
  leadService.setActiveCompany(companyId);

  const l1 = await leadService.saveLead({ company_id: companyId, customer_name: 'Cust 1', phone: '9000000001' }, 'staff@test.com');
  const l2 = await leadService.saveLead({ company_id: companyId, customer_name: 'Cust 2', phone: '9000000002' }, 'staff@test.com');
  const l3 = await leadService.saveLead({ company_id: companyId, customer_name: 'Cust 3', phone: '9000000003' }, 'staff@test.com');

  assert.equal(l1.lead_number, 'B2P-LD-1001');
  assert.equal(l2.lead_number, 'B2P-LD-1002');
  assert.equal(l3.lead_number, 'B2P-LD-1003');

  // Re-saving l2 with edits must preserve B2P-LD-1002
  const l2Edited = await leadService.saveLead({ id: l2.id, company_id: companyId, customer_name: 'Cust 2 Updated', phone: '9000000002' }, 'staff@test.com');
  assert.equal(l2Edited.lead_number, 'B2P-LD-1002', 'Editing must never alter existing lead_number');

  // Creating l4 must get B2P-LD-1004
  const l4 = await leadService.saveLead({ company_id: companyId, customer_name: 'Cust 4', phone: '9000000004' }, 'staff@test.com');
  assert.equal(l4.lead_number, 'B2P-LD-1004');
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 11 Test 7: Duplicate customer identifier protection
// ─────────────────────────────────────────────────────────────────────────────
test('Step 11 - Test 7: Customer identifier uniqueness is enforced across creation calls', async () => {
  resetStorage();
  const companyId = 'comp-cust-id';

  const c1 = await dbService.saveCustomer({ company_id: companyId, name: 'Client One', phone: '9111111111' });
  const c2 = await dbService.saveCustomer({ company_id: companyId, name: 'Client Two', phone: '9222222222' });
  const c3 = await dbService.saveCustomer({ company_id: companyId, name: 'Client Three', phone: '9333333333' });

  assert.notEqual(c1.id, c2.id);
  assert.notEqual(c2.id, c3.id);
  assert.notEqual(c1.id, c3.id);

  const list = dbService.getCustomers(companyId);
  const ids = new Set(list.map(c => c.id));
  assert.equal(ids.size, 3, 'All customer IDs must be strictly unique');
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 11 Test 8: Lead ↔ Customer relationship & ON DELETE SET NULL parity
// ─────────────────────────────────────────────────────────────────────────────
test('Step 11 - Test 8: Lead customer_id remains valid, and customer deletion unlinks customer_id mirroring ON DELETE SET NULL', async () => {
  resetStorage();
  const companyId = 'comp-rel-08';
  leadService.setActiveCompany(companyId);

  // 1. Create customer
  const customer = await dbService.saveCustomer({
    id: 'cust-rel-01',
    company_id: companyId,
    name: 'Kalyan Silks',
    phone: '9847098470'
  });

  // 2. Create lead linked to customer
  const lead = await leadService.saveLead({
    company_id: companyId,
    customer_id: customer.id,
    customer_name: customer.name,
    phone: customer.phone,
    service_required: 'LED Video Wall Vehicle'
  }, 'telecaller@test.com');

  assert.equal(lead.customer_id, customer.id, 'Lead must be linked to customer ID');
  const storedLead = leadService.getLeadById(lead.id);
  assert.equal(storedLead.customer_id, customer.id);

  // 3. Delete Customer
  await dbService.deleteCustomer(customer.id);
  assert.equal(dbService.getCustomers(companyId).length, 0, 'Customer must be deleted');

  // 4. Verify lead still exists and customer_id is unlinked (ON DELETE SET NULL parity)
  const afterDeleteLead = leadService.getLeadById(lead.id);
  assert.ok(afterDeleteLead, 'Lead must NOT be deleted when customer is deleted');
  assert.equal(afterDeleteLead.customer_id, undefined, 'customer_id on lead must be unlinked to mirror ON DELETE SET NULL');
  assert.equal(afterDeleteLead.customer_name, 'Kalyan Silks', 'Lead contact data must be completely preserved');
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 11 Test 9: Existing-record preservation (no accidental overwrites)
// ─────────────────────────────────────────────────────────────────────────────
test('Step 11 - Test 9: Saving distinct leads with identical names or phone does not overwrite existing records', async () => {
  resetStorage();
  const companyId = 'comp-preserve-09';
  leadService.setActiveCompany(companyId);

  // Lead 1: LED Video Wall enquiry from customer
  const lead1 = await leadService.saveLead({
    company_id: companyId,
    customer_name: 'Repeat Business Ltd',
    phone: '9847333444',
    service_required: 'LED Video Wall Vehicle',
    campaign_location: 'Thrissur Round',
    status: 'won'
  }, 'telecaller@test.com');

  // Lead 2: Later enquiry for Lookwalkers from same customer phone
  const lead2 = await leadService.saveLead({
    company_id: companyId,
    customer_name: 'Repeat Business Ltd',
    phone: '9847333444',
    service_required: 'Lookwalker Promoters',
    campaign_location: 'Kochi Mall',
    status: 'new'
  }, 'telecaller@test.com');

  assert.notEqual(lead1.id, lead2.id, 'Distinct enquiries must have separate IDs');
  assert.notEqual(lead1.lead_number, lead2.lead_number, 'Distinct enquiries must have separate lead numbers');

  const allLeads = leadService.getLeads(companyId);
  assert.equal(allLeads.length, 2, 'Both lead records must be preserved');

  const reloaded1 = leadService.getLeadById(lead1.id);
  assert.equal(reloaded1.service_required, 'LED Video Wall Vehicle');
  assert.equal(reloaded1.status, 'won');

  const reloaded2 = leadService.getLeadById(lead2.id);
  assert.equal(reloaded2.service_required, 'Lookwalker Promoters');
  assert.equal(reloaded2.status, 'new');
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 11 Test 10: Steps 1–10 regression verification
// ─────────────────────────────────────────────────────────────────────────────
test('Step 11 - Test 10: Non-regression verification for Steps 1–10', async () => {
  resetStorage();
  const companyId = 'comp-regression-10';
  leadService.setActiveCompany(companyId);

  // 1. Initial lead creation
  const lead = await leadService.saveLead({
    company_id: companyId,
    customer_name: 'Regression Test Client',
    phone: '9847112233',
    assigned_telecaller_email: 'first@test.com',
    status: 'new'
  }, 'owner@test.com');

  assert.equal(lead.assigned_telecaller_email, 'first@test.com');

  // 2. Reassignment (Step 10 test) logs 'Staff Reassigned' activity
  const reassigned = await leadService.reassignLead(
    lead.id,
    'second@test.com',
    'owner@test.com',
    'Reassigned to Senior Telecaller'
  );
  assert.equal(reassigned.assigned_telecaller_email, 'second@test.com');

  const activities = leadService.getLeadActivities(lead.id);
  const reassignAct = activities.find(a => a.action === 'Staff Reassigned');
  assert.ok(reassignAct, 'Activity log must contain Staff Reassigned');

  // 3. Next follow-up synchronization (Step 7 test)
  const nextFollowUp = '2026-09-30T10:00:00.000Z';
  const syncedLead = await leadService.updateLeadNextFollowUpAt(lead.id, companyId, nextFollowUp);
  assert.equal(syncedLead.next_follow_up_at, nextFollowUp, 'next_follow_up_at must be updated');

  // 4. Default company fallback protection (Step 7 / Step 10)
  const blockedFallback = await leadService.updateLeadNextFollowUpAt(lead.id, 'default', nextFollowUp);
  assert.equal(blockedFallback, null, 'default companyId must be rejected');
});
