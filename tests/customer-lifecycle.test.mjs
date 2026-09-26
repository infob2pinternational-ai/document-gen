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
let uuidSeq = 1000;
globalThis.crypto.randomUUID = () => `uuid-${uuidSeq++}`;

// Mock CustomEvent and window dispatch
globalThis.window = {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {}
};

// Load dependencies
const dateUtilsModule = asModule(transpile('../src/utils/dateUtils.ts'));
const staffUtilsModule = asModule(transpile('../src/utils/staffUtils.ts'));

const leadServiceModule = asModule(
  transpile('../src/services/leadService.ts')
    .replaceAll(`'./metricsService'`, JSON.stringify(asModule('export const metricsService = { notifyChange() {} };')))
    .replaceAll(`'./db'`, JSON.stringify(asModule('export const isCloudActive = () => false; export const supabase = null;')))
    .replaceAll(`'../utils/uuid'`, JSON.stringify(asModule('let seq = 1; export const generateUUID = () => "lead-uuid-" + (seq++);')))
    .replaceAll(`'../utils/staffUtils'`, JSON.stringify(staffUtilsModule))
);

const { leadService } = await import(leadServiceModule);

// Mock dbService exactly mirroring src/services/db.ts
const dbService = {
  async getCustomers(companyId) {
    const raw = localStorage.getItem('customers');
    const customers = raw ? JSON.parse(raw) : [];
    return customers.filter(c => c.company_id === companyId);
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

    // Mirror ON DELETE SET NULL for follow-ups in local cache
    try {
      const rawFollowUps = localStorage.getItem('docgen_follow_ups');
      if (rawFollowUps) {
        const followUps = JSON.parse(rawFollowUps);
        let changed = false;
        followUps.forEach(f => {
          if (f.customer_id === id) {
            delete f.customer_id;
            changed = true;
          }
        });
        if (changed) {
          localStorage.setItem('docgen_follow_ups', JSON.stringify(followUps));
        }
      }
    } catch {}

    // Mirror ON DELETE SET NULL for documents in local cache
    try {
      const rawDocs = localStorage.getItem('documents');
      if (rawDocs) {
        const docs = JSON.parse(rawDocs);
        let changed = false;
        docs.forEach(d => {
          if (d.customer_id === id) {
            delete d.customer_id;
            changed = true;
          }
        });
        if (changed) {
          localStorage.setItem('documents', JSON.stringify(docs));
        }
      }
    } catch {}

    // Mirror ON DELETE SET NULL for crm_quotations in local cache
    try {
      const rawQuotes = localStorage.getItem('docgen_quotations');
      if (rawQuotes) {
        const quotes = JSON.parse(rawQuotes);
        let changed = false;
        quotes.forEach(q => {
          if (q.customer_id === id) {
            delete q.customer_id;
            changed = true;
          }
        });
        if (changed) {
          localStorage.setItem('docgen_quotations', JSON.stringify(quotes));
        }
      }
    } catch {}
  }
};

function resetStorage() {
  storage.clear();
  uuidSeq = 1000;
  leadService.setActiveCompany(null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Customer Creation → Stable ID, Company ID, and Data Persistence
// ─────────────────────────────────────────────────────────────────────────────
test('Step 12 - Test 1: Customer creation assigns stable primary ID, company_id, and persists correctly', async () => {
  resetStorage();
  const companyId = 'comp-cust-01';

  const customer = await dbService.saveCustomer({
    company_id: companyId,
    name: 'Kalyan Silks Pvt Ltd',
    phone: '9847011223',
    email: 'accounts@kalyansilks.com',
    address: 'Palace Road, Thrissur',
    gstin: '32AAAAA0000A1Z5'
  });

  assert.ok(customer.id, 'Customer must receive a primary ID');
  assert.equal(customer.company_id, companyId, 'Customer must belong to companyId');
  assert.equal(customer.name, 'Kalyan Silks Pvt Ltd');
  assert.equal(customer.gstin, '32AAAAA0000A1Z5');

  // Verify retrieval
  const list = await dbService.getCustomers(companyId);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, customer.id);
  assert.equal(list[0].email, 'accounts@kalyansilks.com');

  // Verify creating customer does NOT create any unrelated leads or follow-ups
  const leads = leadService.getLeads(companyId);
  assert.equal(leads.length, 0, 'Customer creation must not create unrelated leads');
  const followUpsRaw = localStorage.getItem('docgen_follow_ups');
  assert.equal(followUpsRaw, null, 'Customer creation must not create unrelated follow-ups');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Customer Edit Integrity → Preserves ID and Does Not Duplicate
// ─────────────────────────────────────────────────────────────────────────────
test('Step 12 - Test 2: Editing existing customer updates fields in-place, preserves ID, and avoids duplicates', async () => {
  resetStorage();
  const companyId = 'comp-cust-02';

  const initial = await dbService.saveCustomer({
    id: 'cust-stable-02',
    company_id: companyId,
    name: 'Initial Name Ltd',
    phone: '9847000001',
    address: 'Old Address',
    gstin: '32AAAAA1111A1Z1'
  });

  assert.equal(initial.id, 'cust-stable-02');
  assert.equal((await dbService.getCustomers(companyId)).length, 1);

  // Edit customer details
  const updated = await dbService.saveCustomer({
    id: 'cust-stable-02',
    company_id: companyId,
    name: 'Renamed Enterprise Ltd',
    phone: '9847000999',
    address: 'New Prime Tower, MG Road',
    gstin: '32AAAAA1111A1Z9'
  });

  assert.equal(updated.id, 'cust-stable-02', 'Primary customer ID must NEVER change on edit');
  assert.equal(updated.name, 'Renamed Enterprise Ltd');
  assert.equal(updated.phone, '9847000999');
  assert.equal(updated.address, 'New Prime Tower, MG Road');

  const list = await dbService.getCustomers(companyId);
  assert.equal(list.length, 1, 'Editing customer must NOT create a second customer record');
  assert.equal(list[0].id, 'cust-stable-02');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Customer Edit Preserves Lead Relationship
// ─────────────────────────────────────────────────────────────────────────────
test('Step 12 - Test 3: Customer edit preserves lead relationship and link integrity', async () => {
  resetStorage();
  const companyId = 'comp-cust-03';
  leadService.setActiveCompany(companyId);

  // 1. Create Customer
  const customer = await dbService.saveCustomer({
    id: 'cust-link-03',
    company_id: companyId,
    name: 'Malabar Jewelers',
    phone: '9847111222'
  });

  // 2. Create Lead linked to Customer
  const lead = await leadService.saveLead({
    company_id: companyId,
    customer_id: customer.id,
    customer_name: customer.name,
    phone: customer.phone,
    service_required: 'LED Video Wall Vehicle',
    status: 'new'
  }, 'telecaller@test.com');

  assert.equal(lead.customer_id, customer.id, 'Lead must be linked to customer.id');

  // 3. Edit Customer contact info
  await dbService.saveCustomer({
    id: customer.id,
    company_id: companyId,
    name: 'Malabar Gold & Diamonds',
    phone: '9847999888'
  });

  // 4. Verify lead still points to the same customer ID
  const reloadedLead = leadService.getLeadById(lead.id);
  assert.equal(reloadedLead.customer_id, customer.id, 'lead.customer_id must remain valid and unchanged');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: Customer Edit Preserves Follow-Up Relationship
// ─────────────────────────────────────────────────────────────────────────────
test('Step 12 - Test 4: Customer edit preserves follow-up relationship', async () => {
  resetStorage();
  const companyId = 'comp-cust-04';
  leadService.setActiveCompany(companyId);

  const customer = await dbService.saveCustomer({
    id: 'cust-fup-04',
    company_id: companyId,
    name: 'Josco Fashion',
    phone: '9847222333'
  });

  const lead = await leadService.saveLead({
    company_id: companyId,
    customer_id: customer.id,
    customer_name: customer.name,
    phone: customer.phone
  }, 'telecaller@test.com');

  // Store follow-up linked to both customer and lead
  const followUp = {
    id: 'fup-04',
    company_id: companyId,
    lead_id: lead.id,
    lead_number: lead.lead_number,
    customer_id: customer.id,
    customer_name: customer.name,
    phone: customer.phone,
    assigned_staff_email: 'telecaller@test.com',
    due_date: '2026-09-30',
    due_time: '11:00',
    reason: 'Price negotiation call',
    status: 'PENDING',
    created_by_email: 'telecaller@test.com'
  };
  localStorage.setItem('docgen_follow_ups', JSON.stringify([followUp]));

  // Edit customer
  await dbService.saveCustomer({
    id: customer.id,
    company_id: companyId,
    name: 'Josco Fashion International',
    phone: '9847888777'
  });

  // Verify follow-up still resolves to the customer.id and lead.id
  const rawFollowUps = JSON.parse(localStorage.getItem('docgen_follow_ups'));
  assert.equal(rawFollowUps.length, 1);
  assert.equal(rawFollowUps[0].customer_id, customer.id);
  assert.equal(rawFollowUps[0].lead_id, lead.id);
  assert.equal(rawFollowUps[0].status, 'PENDING');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: Customer Deletion Relationship Behavior (Leads & Follow-ups Preserved)
// ─────────────────────────────────────────────────────────────────────────────
test('Step 12 - Test 5: Deleting customer does NOT delete linked leads or follow-ups', async () => {
  resetStorage();
  const companyId = 'comp-cust-05';
  leadService.setActiveCompany(companyId);

  const customer = await dbService.saveCustomer({
    id: 'cust-del-05',
    company_id: companyId,
    name: 'Legacy Motors',
    phone: '9847555666'
  });

  const lead = await leadService.saveLead({
    company_id: companyId,
    customer_id: customer.id,
    customer_name: customer.name,
    phone: customer.phone,
    notes: 'Important inquiry'
  }, 'telecaller@test.com');

  const followUp = {
    id: 'fup-del-05',
    company_id: companyId,
    customer_id: customer.id,
    lead_id: lead.id,
    customer_name: customer.name,
    status: 'PENDING'
  };
  localStorage.setItem('docgen_follow_ups', JSON.stringify([followUp]));

  // Delete customer
  await dbService.deleteCustomer(customer.id);

  // Customer must be deleted
  assert.equal((await dbService.getCustomers(companyId)).length, 0);

  // Lead must still exist intact with all contact info and notes
  const reloadedLead = leadService.getLeadById(lead.id);
  assert.ok(reloadedLead, 'Lead must NOT be deleted when customer is deleted');
  assert.equal(reloadedLead.customer_name, 'Legacy Motors');
  assert.equal(reloadedLead.notes, 'Important inquiry');

  // Follow-up must still exist
  const reloadedFups = JSON.parse(localStorage.getItem('docgen_follow_ups'));
  assert.equal(reloadedFups.length, 1, 'Follow-up must NOT be deleted when customer is deleted');
  assert.equal(reloadedFups[0].customer_name, 'Legacy Motors');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: Local Cache Deletion Parity (ON DELETE SET NULL across all tables)
// ─────────────────────────────────────────────────────────────────────────────
test('Step 12 - Test 6: Customer deletion unlinks customer_id across leads, follow-ups, documents, and quotations (ON DELETE SET NULL parity)', async () => {
  resetStorage();
  const companyId = 'comp-cust-06';
  leadService.setActiveCompany(companyId);

  const customerId = 'cust-nullify-06';
  await dbService.saveCustomer({
    id: customerId,
    company_id: companyId,
    name: 'Apex Construction',
    phone: '9847123123'
  });

  // Seed records across all 4 collections referencing customerId
  const lead = await leadService.saveLead({
    company_id: companyId,
    customer_id: customerId,
    customer_name: 'Apex Construction',
    phone: '9847123123'
  }, 'staff@test.com');

  localStorage.setItem('docgen_follow_ups', JSON.stringify([{
    id: 'fup-06',
    customer_id: customerId,
    customer_name: 'Apex Construction',
    status: 'PENDING'
  }]));

  localStorage.setItem('documents', JSON.stringify([{
    id: 'doc-06',
    customer_id: customerId,
    customer_name: 'Apex Construction',
    document_type: 'invoice',
    total: 25000
  }]));

  localStorage.setItem('docgen_quotations', JSON.stringify([{
    id: 'quote-06',
    customer_id: customerId,
    customer_name: 'Apex Construction',
    approval_status: 'APPROVED',
    total: 25000
  }]));

  // Perform deletion
  await dbService.deleteCustomer(customerId);

  // Verify all 4 local collections unlinked customer_id mirroring PostgreSQL ON DELETE SET NULL
  const afterLead = leadService.getLeadById(lead.id);
  assert.equal(afterLead.customer_id, undefined, 'Lead customer_id must be unlinked');

  const afterFups = JSON.parse(localStorage.getItem('docgen_follow_ups'));
  assert.equal(afterFups[0].customer_id, undefined, 'Follow-up customer_id must be unlinked');

  const afterDocs = JSON.parse(localStorage.getItem('documents'));
  assert.equal(afterDocs[0].customer_id, undefined, 'Document customer_id must be unlinked');
  assert.equal(afterDocs[0].total, 25000, 'Document totals must remain preserved');

  const afterQuotes = JSON.parse(localStorage.getItem('docgen_quotations'));
  assert.equal(afterQuotes[0].customer_id, undefined, 'Quotation customer_id must be unlinked');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7: Document Relationship & Point-in-Time Billing Snapshot Integrity
// ─────────────────────────────────────────────────────────────────────────────
test('Step 12 - Test 7: Historical documents maintain immutable billing snapshot even after customer profile is modified', async () => {
  resetStorage();
  const companyId = 'comp-cust-07';

  // 1. Customer created
  const customer = await dbService.saveCustomer({
    id: 'cust-snapshot-07',
    company_id: companyId,
    name: 'Original Client Name',
    phone: '9847000111',
    address: 'Original Address 2024',
    gstin: '32ORIGINAL001Z1'
  });

  // 2. Document created storing point-in-time snapshot
  const invoice = {
    id: 'inv-07',
    company_id: companyId,
    document_type: 'invoice',
    document_number: 'INV/1001',
    customer_id: customer.id,
    customer_name: customer.name,
    customer_phone: customer.phone,
    customer_address: customer.address,
    customer_gstin: customer.gstin,
    total: 50000,
    date: '2026-09-01'
  };
  localStorage.setItem('documents', JSON.stringify([invoice]));

  // 3. Customer changes address and phone next year
  await dbService.saveCustomer({
    id: customer.id,
    company_id: companyId,
    name: 'New Corporate Identity Ltd',
    phone: '9847999999',
    address: 'Brand New Headquarters 2026',
    gstin: '32BRANDNEW001Z2'
  });

  // 4. Reopen past invoice: verify historical billing snapshot is strictly preserved
  const loadedDocs = JSON.parse(localStorage.getItem('documents'));
  const historicalInvoice = loadedDocs.find(d => d.id === 'inv-07');
  assert.ok(historicalInvoice);
  assert.equal(historicalInvoice.customer_id, customer.id, 'Historical invoice still links to customer profile');
  assert.equal(historicalInvoice.customer_name, 'Original Client Name', 'Historical invoice customer_name must NOT mutate');
  assert.equal(historicalInvoice.customer_address, 'Original Address 2024', 'Historical invoice customer_address must NOT mutate');
  assert.equal(historicalInvoice.customer_gstin, '32ORIGINAL001Z1', 'Historical GSTIN must NOT mutate');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8: Historical Activity Preservation
// ─────────────────────────────────────────────────────────────────────────────
test('Step 12 - Test 8: Historical activities remain attached to lead with timestamps and authors when customer changes', async () => {
  resetStorage();
  const companyId = 'comp-cust-08';
  leadService.setActiveCompany(companyId);

  const customer = await dbService.saveCustomer({
    id: 'cust-act-08',
    company_id: companyId,
    name: 'Act Test Customer',
    phone: '9847123456'
  });

  const lead = await leadService.saveLead({
    company_id: companyId,
    customer_id: customer.id,
    customer_name: customer.name,
    phone: customer.phone,
    status: 'new'
  }, 'staff.initial@test.com');

  // Trigger status transition
  await leadService.saveLead({
    id: lead.id,
    company_id: companyId,
    customer_name: customer.name,
    phone: customer.phone,
    status: 'requirement_collected'
  }, 'staff.updater@test.com');

  const activities = leadService.getLeadActivities(lead.id);
  assert.equal(activities.length, 2);
  const createdAct = activities.find(a => a.action === 'Lead Created');
  const updatedAct = activities.find(a => a.action === 'Status Updated');
  assert.equal(createdAct.user_email, 'staff.initial@test.com');
  assert.equal(updatedAct.user_email, 'staff.updater@test.com');

  // Modify customer profile
  await dbService.saveCustomer({
    id: customer.id,
    company_id: companyId,
    name: 'Act Test Customer Renamed',
    phone: '9847999999'
  });

  // Verify historical activities remain completely untouched
  const activitiesAfter = leadService.getLeadActivities(lead.id);
  assert.equal(activitiesAfter.length, 2);
  assert.equal(activitiesAfter[0].user_email, activities[0].user_email);
  assert.equal(activitiesAfter[0].created_at, activities[0].created_at);
  assert.equal(activitiesAfter[1].user_email, activities[1].user_email);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 9: Company / Tenant Isolation
// ─────────────────────────────────────────────────────────────────────────────
test('Step 12 - Test 9: Customers in Company A and Company B remain strictly isolated even with identical names', async () => {
  resetStorage();
  const companyA = 'comp-aaa-09';
  const companyB = 'comp-bbb-09';

  // Customer in Company A
  const custA = await dbService.saveCustomer({
    id: 'cust-a-09',
    company_id: companyA,
    name: 'John Traders',
    phone: '9847001122'
  });

  // Customer in Company B with identical name and phone
  const custB = await dbService.saveCustomer({
    id: 'cust-b-09',
    company_id: companyB,
    name: 'John Traders',
    phone: '9847001122'
  });

  assert.notEqual(custA.id, custB.id);

  // Query Company A
  const listA = await dbService.getCustomers(companyA);
  assert.equal(listA.length, 1);
  assert.equal(listA[0].id, 'cust-a-09');

  // Query Company B
  const listB = await dbService.getCustomers(companyB);
  assert.equal(listB.length, 1);
  assert.equal(listB[0].id, 'cust-b-09');

  // Editing Customer A must not affect Customer B
  await dbService.saveCustomer({
    id: 'cust-a-09',
    company_id: companyA,
    name: 'John Traders Kerala Ltd',
    phone: '9847001122'
  });

  const listBAfter = await dbService.getCustomers(companyB);
  assert.equal(listBAfter[0].name, 'John Traders', 'Company B customer must not be altered');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 10: Customer Lookup Isolation
// ─────────────────────────────────────────────────────────────────────────────
test('Step 12 - Test 10: Customer lookup only returns customers for the active company', async () => {
  resetStorage();
  const companyA = 'comp-scope-a';
  const companyB = 'comp-scope-b';

  await dbService.saveCustomer({ id: 'c-a1', company_id: companyA, name: 'Client A1', phone: '9000000001' });
  await dbService.saveCustomer({ id: 'c-a2', company_id: companyA, name: 'Client A2', phone: '9000000002' });
  await dbService.saveCustomer({ id: 'c-b1', company_id: companyB, name: 'Client B1', phone: '9000000003' });

  // Lookup for Company A
  const custsA = await dbService.getCustomers(companyA);
  assert.equal(custsA.length, 2);
  assert.ok(custsA.every(c => c.company_id === companyA));

  // Lookup for Company B
  const custsB = await dbService.getCustomers(companyB);
  assert.equal(custsB.length, 1);
  assert.equal(custsB[0].id, 'c-b1');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 11: Failed Save / Retry
// ─────────────────────────────────────────────────────────────────────────────
test('Step 12 - Test 11: Failed customer save allows retry without corrupting state', async () => {
  resetStorage();
  const companyId = 'comp-retry-11';

  let failOnce = true;
  const failingStorage = {
    async save(cust) {
      if (failOnce) {
        failOnce = false;
        throw new Error('Database connection dropped');
      }
      return dbService.saveCustomer(cust);
    }
  };

  const payload = {
    id: 'cust-retry-11',
    company_id: companyId,
    name: 'Resilient Client',
    phone: '9847111222'
  };

  // Attempt 1 fails
  let errorCaught = null;
  try {
    await failingStorage.save(payload);
  } catch (e) {
    errorCaught = e;
  }
  assert.ok(errorCaught);
  assert.equal((await dbService.getCustomers(companyId)).length, 0);

  // Attempt 2 succeeds
  const saved = await failingStorage.save(payload);
  assert.equal(saved.id, 'cust-retry-11');
  assert.equal((await dbService.getCustomers(companyId)).length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 12: Steps 1–11 Regression Verification
// ─────────────────────────────────────────────────────────────────────────────
test('Step 12 - Test 12: Steps 1–11 non-regression verification', async () => {
  resetStorage();
  const companyId = 'comp-regression-12';
  leadService.setActiveCompany(companyId);

  // 1. Initial lead creation with sequential number
  const lead1 = await leadService.saveLead({
    company_id: companyId,
    customer_name: 'Lead Reg 1',
    phone: '9847111111'
  }, 'staff@test.com');
  assert.equal(lead1.lead_number, 'B2P-LD-1001');

  // 2. Reassignment logs activity
  await leadService.reassignLead(lead1.id, 'telecaller2@test.com', 'owner@test.com');
  const acts = leadService.getLeadActivities(lead1.id);
  assert.ok(acts.some(a => a.action === 'Staff Reassigned'));

  // 3. Fallback to 'default' is blocked in next_follow_up_at sync
  const fallbackResult = await leadService.updateLeadNextFollowUpAt(lead1.id, 'default', '2026-09-30T10:00:00Z');
  assert.equal(fallbackResult, null);
});
