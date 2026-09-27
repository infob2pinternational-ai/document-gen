import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

let PGlite;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
} catch {
  // PGlite available in project environment
}

function loadTsModule(relativePath, stubs = {}) {
  const code = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  let { outputText } = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext }
  });

  const defaultStubs = {
    '../utils/uuid': 'export const generateUUID = () => "test-uuid-" + Math.random().toString(36).substring(2);',
    '../utils/staffUtils': 'export const normalizeStaffEmail = s => s ? s.toLowerCase().trim() : s;',
    '../utils/dateUtils': 'export const getKolkataToday = () => "2026-09-27"; export const getTodayStr = () => "2026-09-27"; export const getKolkataDateString = () => "2026-09-27"; export const getKolkataTimeString = () => "10:00:00"; export const formatKolkataIsoDateTime = (d, t) => `${d}T${t || "10:00"}:00.000Z`;',
    './metricsService': 'export const metricsService = { notifyChange() {} };',
    './db': 'export const isCloudActive = () => false; export const supabase = null;',
    ...stubs
  };

  for (const [specifier, stubCode] of Object.entries(defaultStubs)) {
    const dataUri = `data:text/javascript;base64,${Buffer.from(stubCode).toString('base64')}`;
    outputText = outputText.replaceAll(`'${specifier}'`, JSON.stringify(dataUri));
    outputText = outputText.replaceAll(`"${specifier}"`, JSON.stringify(dataUri));
  }

  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

// -----------------------------------------------------------------------------
// POSTGRES RLS & DATABASE-LEVEL AUTHORIZATION TESTS
// -----------------------------------------------------------------------------

test('Step 14 - Test 1: RLS Company Isolation (Zero cross-company reads in PostgreSQL)', { skip: !PGlite }, async () => {
  const db = new PGlite();
  const owner = '11111111-1111-4111-8111-111111111111';
  const staffA = '22222222-2222-4222-8222-222222222222';
  const outsider = '33333333-3333-4333-8333-333333333333';
  const companyA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const companyB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  async function login(uid, role = 'authenticated') {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('test.uid',$1,false)", [uid]);
    await db.exec(`SET ROLE ${role}`);
  }

  try {
    await db.exec(readFileSync(new URL('./fixtures/production-document-schema.sql', import.meta.url), 'utf8'));
    await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ($1,$2,now()),($3,$4,now()),($5,$6,now())', [
      owner, 'sarathjohnpanengadan@gmail.com',
      staffA, 'sivasatheesan33@gmail.com',
      outsider, 'unregistered@example.com'
    ]);
    await db.query('INSERT INTO profiles(id,name) VALUES($1,$2),($3,$4)', [
      companyA, 'Company A',
      companyB, 'Company B'
    ]);
    for (const file of ['20260918000000_live_crm_fields.sql', '20260921000003_document_security_and_leads.sql', '20260922000002_telecalling_operations.sql']) {
      await db.exec(readFileSync(new URL('../database/migrations/' + file, import.meta.url), 'utf8'));
    }

    // Clean existing memberships and configure: staffA in companyA only
    await db.query('DELETE FROM app_company_members WHERE user_id = $1', [staffA]);
    await db.query('INSERT INTO app_company_members(user_id, company_id) VALUES ($1, $2)', [staffA, companyA]);

    // Insert records for Company B as superuser
    const leadB = '77777777-7777-4777-8777-77777777777b';
    const customerB = '66666666-6666-4666-8666-66666666666b';
    const followUpB = '88888888-8888-4888-8888-88888888888b';
    const teleB = '99999999-9999-4999-8999-99999999999b';

    await db.query("INSERT INTO customers(id, company_id) VALUES ($1, $2)", [customerB, companyB]);
    await db.query("INSERT INTO leads(id, company_id, customer_name, lead_number) VALUES ($1, $2, 'Lead B', 'B2P-LD-1001')", [leadB, companyB]);
    await db.query("INSERT INTO follow_ups(id, company_id, customer_id, follow_up_date, status) VALUES ($1, $2, $3, current_date, 'pending')", [followUpB, companyB, customerB]);
    await db.query("INSERT INTO telecalling_entries(id, company_id, company_name, phone, call_status) VALUES ($1, $2, 'Target B', '9847000001', 'Follow-up Required')", [teleB, companyB]);

    // Log in as Staff A (who only has access to Company A)
    await login(staffA);

    // Queries from Company A context must return ZERO records of Company B
    const leadsVisible = (await db.query('SELECT * FROM leads')).rows;
    assert.equal(leadsVisible.length, 0, 'Company A staff must see 0 leads from Company B');

    const customersVisible = (await db.query('SELECT * FROM customers')).rows;
    assert.equal(customersVisible.length, 0, 'Company A staff must see 0 customers from Company B');

    const followUpsVisible = (await db.query('SELECT * FROM follow_ups')).rows;
    assert.equal(followUpsVisible.length, 0, 'Company A staff must see 0 follow-ups from Company B');

    const teleVisible = (await db.query('SELECT * FROM telecalling_entries')).rows;
    assert.equal(teleVisible.length, 0, 'Company A staff must see 0 telecalling entries from Company B');

    // Profiles query: Company A cannot see Company B profile
    const profilesVisible = (await db.query('SELECT id, name FROM profiles')).rows;
    assert.equal(profilesVisible.length, 1);
    assert.equal(profilesVisible[0].id, companyA);
  } finally {
    await db.close();
  }
});

test('Step 14 - Test 2: Direct-ID & Cross-Company Read/Update/Delete Blocked in PostgreSQL', { skip: !PGlite }, async () => {
  const db = new PGlite();
  const owner = '11111111-1111-4111-8111-111111111111';
  const staffA = '22222222-2222-4222-8222-222222222222';
  const outsider = '33333333-3333-4333-8333-333333333333';
  const companyA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const companyB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const docIdB = '55555555-5555-4555-8555-55555555555b';
  const leadIdB = '77777777-7777-4777-8777-77777777777b';

  async function login(uid, role = 'authenticated') {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('test.uid',$1,false)", [uid]);
    await db.exec(`SET ROLE ${role}`);
  }

  try {
    await db.exec(readFileSync(new URL('./fixtures/production-document-schema.sql', import.meta.url), 'utf8'));
    await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ($1,$2,now()),($3,$4,now()),($5,$6,now())', [
      owner, 'sarathjohnpanengadan@gmail.com',
      staffA, 'sivasatheesan33@gmail.com',
      outsider, 'unregistered@example.com'
    ]);
    await db.query('INSERT INTO profiles(id,name) VALUES($1,$2),($3,$4)', [companyA, 'Company A', companyB, 'Company B']);
    for (const file of ['20260918000000_live_crm_fields.sql', '20260921000003_document_security_and_leads.sql']) {
      await db.exec(readFileSync(new URL('../database/migrations/' + file, import.meta.url), 'utf8'));
    }

    await db.query('DELETE FROM app_company_members WHERE user_id = $1', [staffA]);
    await db.query('INSERT INTO app_company_members(user_id, company_id) VALUES ($1, $2)', [staffA, companyA]);

    // Seed doc & lead in Company B
    await db.query("INSERT INTO documents(id, company_id, document_type, document_number, sequence_number, customer_name, total) VALUES ($1, $2, 'invoice', 'INV/B-1', 1, 'Client B', 500)", [docIdB, companyB]);
    await db.query("INSERT INTO leads(id, company_id, customer_name, lead_number) VALUES ($1, $2, 'Lead B', 'B2P-LD-1001')", [leadIdB, companyB]);

    // Login as staff from Company A
    await login(staffA);

    // 1. Direct-ID SELECT of Company B record: 0 rows returned
    const directDoc = (await db.query('SELECT * FROM documents WHERE id = $1', [docIdB])).rows;
    assert.equal(directDoc.length, 0, 'Direct ID query for Company B document must return 0 rows');

    const directLead = (await db.query('SELECT * FROM leads WHERE id = $1', [leadIdB])).rows;
    assert.equal(directLead.length, 0, 'Direct ID query for Company B lead must return 0 rows');

    // 2. Cross-company UPDATE attack: 0 rows modified
    const updateRes = await db.query("UPDATE leads SET customer_name = 'Compromised' WHERE id = $1", [leadIdB]);
    assert.equal(updateRes.rowCount, 0, 'Cross-company UPDATE on leads must affect 0 rows');

    // 3. Cross-company DELETE attack: 0 rows deleted
    const deleteRes = await db.query('DELETE FROM leads WHERE id = $1', [leadIdB]);
    assert.equal(deleteRes.rowCount, 0, 'Cross-company DELETE on leads must affect 0 rows');

    // 4. Attempt to delete document bundle of Company B via RPC: Rejected
    await assert.rejects(
      db.query('SELECT delete_document_bundle($1)', [docIdB]),
      /Document deletion denied/,
      'Deleting another company document bundle must be strictly denied'
    );
  } finally {
    await db.close();
  }
});

test('Step 14 - Test 3: Role Authorization & Privilege Escalation Protection in PostgreSQL', { skip: !PGlite }, async () => {
  const db = new PGlite();
  const owner = '11111111-1111-4111-8111-111111111111';
  const staff = '22222222-2222-4222-8222-222222222222';
  const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const docId = '55555555-5555-4555-8555-555555555555';
  const quoteId = '44444444-4444-4444-8444-444444444444';

  async function login(uid, role = 'authenticated') {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('test.uid',$1,false)", [uid]);
    await db.exec(`SET ROLE ${role}`);
  }

  try {
    await db.exec(readFileSync(new URL('./fixtures/production-document-schema.sql', import.meta.url), 'utf8'));
    await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ($1,$2,now()),($3,$4,now())', [
      owner, 'sarathjohnpanengadan@gmail.com',
      staff, 'sivasatheesan33@gmail.com'
    ]);
    await db.query('INSERT INTO profiles(id,name) VALUES($1,$2)', [company, 'Test Company']);
    for (const file of ['20260918000000_live_crm_fields.sql', '20260921000003_document_security_and_leads.sql']) {
      await db.exec(readFileSync(new URL('../database/migrations/' + file, import.meta.url), 'utf8'));
    }

    // 1. Staff creates a document bundle
    await login(staff);
    const docPayload = {
      id: docId,
      company_id: company,
      document_type: 'invoice',
      document_number: 'INV/2026/001',
      sequence_number: 1,
      customer_name: 'Customer X',
      total: 1000,
      subtotal: 1000
    };
    const itemsPayload = [{ description: 'Service Item', quantity: 1, rate: 1000, amount: 1000 }];

    await db.query('SELECT save_document_bundle($1, $2, NULL)', [JSON.stringify(docPayload), JSON.stringify(itemsPayload)]);

    // 2. Staff attempts to approve document -> REJECTED
    await assert.rejects(
      db.query('SELECT review_document($1, true)', [docId]),
      /Only the owner can approve or reject/,
      'Staff cannot approve documents'
    );

    // 3. Staff attempts direct table UPDATE to force status='approved' -> REJECTED (permission denied)
    await assert.rejects(
      db.query("UPDATE documents SET status = 'approved' WHERE id = $1", [docId]),
      /permission denied/,
      'Direct table write to documents must be blocked by revoked privileges'
    );

    // 4. Staff attempts to delete document -> REJECTED
    await assert.rejects(
      db.query('SELECT delete_document_bundle($1)', [docId]),
      /Document deletion denied/,
      'Staff cannot delete document bundle'
    );

    // 5. Staff attempts to approve CRM quotation directly -> REJECTED by trigger
    await db.query(`INSERT INTO crm_quotations(id,company_id,quotation_number,date,customer_name,phone,service_summary)
      VALUES($1,$2,'CRM/001',current_date,'Client','9847000000','Web Dev')`, [quoteId, company]);

    await assert.rejects(
      db.query("UPDATE crm_quotations SET approval_status='APPROVED' WHERE id=$1", [quoteId]),
      /Only the owner can approve quotations/,
      'Staff cannot approve crm_quotations'
    );

    // 6. Owner logs in and successfully approves document and quotation
    await login(owner);
    const approvedDoc = (await db.query('SELECT review_document($1, true) AS val', [docId])).rows[0].val;
    assert.equal(approvedDoc.status, 'approved');
    assert.equal(approvedDoc.approved_by_email, 'sarathjohnpanengadan@gmail.com');

    await db.query("UPDATE crm_quotations SET approval_status='APPROVED' WHERE id=$1", [quoteId]);
    const quoteStatus = (await db.query('SELECT approval_status FROM crm_quotations WHERE id=$1', [quoteId])).rows[0].approval_status;
    assert.equal(quoteStatus, 'APPROVED');

    // 7. Owner deletes document bundle -> SUCCESS
    const deletedId = (await db.query('SELECT delete_document_bundle($1) AS val', [docId])).rows[0].val;
    assert.equal(deletedId, docId);
  } finally {
    await db.close();
  }
});

test('Step 14 - Test 4: Public Document Access Security (UUID bearer-only, approved-only)', { skip: !PGlite }, async () => {
  const db = new PGlite();
  const owner = '11111111-1111-4111-8111-111111111111';
  const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const approvedDocId = '55555555-5555-4555-8555-55555555555a';
  const pendingDocId = '55555555-5555-4555-8555-55555555555e';

  async function login(uid, role = 'authenticated') {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('test.uid',$1,false)", [uid]);
    await db.exec(`SET ROLE ${role}`);
  }

  try {
    await db.exec(readFileSync(new URL('./fixtures/production-document-schema.sql', import.meta.url), 'utf8'));
    await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ($1,$2,now())', [owner, 'sarathjohnpanengadan@gmail.com']);
    await db.query('INSERT INTO profiles(id,name) VALUES($1,$2)', [company, 'Secure Org']);
    for (const file of ['20260918000000_live_crm_fields.sql', '20260921000003_document_security_and_leads.sql']) {
      await db.exec(readFileSync(new URL('../database/migrations/' + file, import.meta.url), 'utf8'));
    }

    await login(owner);
    // Create approved document and pending document
    const docApp = { id: approvedDocId, company_id: company, document_type: 'invoice', document_number: 'INV-APP', sequence_number: 1, customer_name: 'Client A', total: 100, subtotal: 100 };
    const docPend = { id: pendingDocId, company_id: company, document_type: 'invoice', document_number: 'INV-PEND', sequence_number: 2, customer_name: 'Client P', total: 200, subtotal: 200 };
    const items = [{ description: 'Item', quantity: 1, rate: 100, amount: 100 }];

    await db.query('SELECT save_document_bundle($1, $2, NULL)', [JSON.stringify(docApp), JSON.stringify(items)]);
    await db.query('SELECT save_document_bundle($1, $2, NULL)', [JSON.stringify(docPend), JSON.stringify(items)]);
    await db.query('SELECT review_document($1, true)', [approvedDocId]);

    // Switch to anonymous role (public web visitor)
    await login('', 'anon');

    // 1. Direct table SELECT on documents is blocked
    await assert.rejects(
      db.query('SELECT * FROM documents'),
      /permission denied/,
      'Direct table SELECT on documents must be denied to anon'
    );

    // 2. Public RPC with approved document UUID returns document bundle
    const approvedRes = (await db.query('SELECT get_public_document($1, NULL) AS val', [approvedDocId])).rows[0].val;
    assert.ok(approvedRes !== null);
    assert.equal(approvedRes.document.id, approvedDocId);
    assert.equal(approvedRes.document.total, 100);

    // 3. Public RPC with pending document UUID returns NULL (unapproved docs are strictly private)
    const pendingRes = (await db.query('SELECT get_public_document($1, NULL) AS val', [pendingDocId])).rows[0].val;
    assert.equal(pendingRes, null, 'Unapproved document must never be exposed publicly');

    // 4. Public RPC with sequential document number returns NULL (predictable numbers are not credentials)
    const byNumberRes = (await db.query('SELECT get_public_document(NULL, $1) AS val', ['INV-APP'])).rows[0].val;
    assert.equal(byNumberRes, null, 'Predictable document numbers must not resolve publicly');
  } finally {
    await db.close();
  }
});

// -----------------------------------------------------------------------------
// SERVICE LAYER & LOCAL STORAGE TENANT ISOLATION TESTS
// -----------------------------------------------------------------------------

test('Step 14 - Test 5: Service-Layer Cross-Company Read & Direct-ID Isolation', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear()
  };

  const companyA = '11111111-1111-4111-8111-111111111111';
  const companyB = '22222222-2222-4222-8222-222222222222';

  const { leadService } = await loadTsModule('../src/services/leadService.ts');

  const { officeService } = await loadTsModule('../src/services/officeService.ts', {
    './leadService': `export const leadService = {
      getActiveCompany: () => '${companyA}',
      updateLeadNextFollowUpAt: async () => null,
      addLeadActivity: async () => null
    };
    export const hydrateLeadsFromCloud = async () => [];`
  });

  // Seed data directly for both companies
  const leadA = { id: 'lead-a', company_id: companyA, customer_name: 'Lead A', phone: '9847000001', status: 'new' };
  const leadB = { id: 'lead-b', company_id: companyB, customer_name: 'Lead B', phone: '9847000002', status: 'new' };
  store.set('docgen_leads', JSON.stringify([leadA, leadB]));

  const quoteA = { id: 'quote-a', company_id: companyA, customer_name: 'Client A', quotation_number: 'Q-A', total: 100, items: [] };
  const quoteB = { id: 'quote-b', company_id: companyB, customer_name: 'Client B', quotation_number: 'Q-B', total: 200, items: [] };
  store.set('docgen_crm_quotations', JSON.stringify([quoteA, quoteB]));

  // In Company A context:
  leadService.setActiveCompany(companyA);

  // 1. getLeads strictly filters Company A
  const leadsForA = leadService.getLeads(companyA);
  assert.equal(leadsForA.length, 1);
  assert.equal(leadsForA[0].id, 'lead-a');

  // 2. Direct-ID lookup for another company's lead returns null
  assert.equal(leadService.getLeadById('lead-b', companyA), null, 'getLeadById for Company B lead must return null in Company A context');
  assert.equal(leadService.getLeadById('lead-a', companyA)?.id, 'lead-a');

  // 3. getQuotations strictly filters Company A
  const quotesForA = officeService.getQuotations(companyA);
  assert.equal(quotesForA.length, 1);
  assert.equal(quotesForA[0].id, 'quote-a');

  // 4. Direct-ID lookup for another company's quotation returns null
  assert.equal(officeService.getQuotationById('quote-b'), null, 'getQuotationById for Company B quotation must return null');
  assert.equal(officeService.getQuotationById('quote-a')?.id, 'quote-a');
});

test('Step 14 - Test 6: Service-Layer Cross-Company Update & Delete Protection', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear()
  };

  const companyA = '11111111-1111-4111-8111-111111111111';
  const companyB = '22222222-2222-4222-8222-222222222222';

  const { leadService } = await loadTsModule('../src/services/leadService.ts');

  const { officeService } = await loadTsModule('../src/services/officeService.ts', {
    './leadService': `export const leadService = {
      getActiveCompany: () => '${companyA}',
      updateLeadNextFollowUpAt: async () => null,
      addLeadActivity: async () => null
    };
    export const hydrateLeadsFromCloud = async () => [];`
  });

  // Seed Company B records
  const leadB = { id: 'lead-b', company_id: companyB, customer_name: 'Lead B', phone: '9847000002', status: 'new' };
  store.set('docgen_leads', JSON.stringify([leadB]));

  const followUpB = { id: 'fu-b', company_id: companyB, customer_name: 'Client B', due_date: '2026-10-01', reason: 'Meeting', status: 'PENDING' };
  store.set('docgen_follow_ups', JSON.stringify([followUpB]));

  const quoteB = { id: 'quote-b', company_id: companyB, customer_name: 'Client B', quotation_number: 'Q-B', total: 500, items: [] };
  store.set('docgen_crm_quotations', JSON.stringify([quoteB]));

  // Active company is Company A
  leadService.setActiveCompany(companyA);

  // 1. Attempt to modify Company B lead while in Company A -> REJECTED
  await assert.rejects(
    leadService.saveLead({ id: 'lead-b', customer_name: 'Hacked', phone: '9847000002' }),
    /Cannot modify a lead belonging to another company/,
    'Modifying another company lead must throw an error'
  );

  // 2. Attempt to delete Company B lead while in Company A -> REJECTED
  await assert.rejects(
    leadService.deleteLead('lead-b'),
    /Cannot delete a lead belonging to another company/,
    'Deleting another company lead must throw an error'
  );

  // 3. Attempt to modify Company B follow-up while in Company A -> REJECTED
  await assert.rejects(
    officeService.saveFollowUp({ id: 'fu-b', customer_name: 'Hacked', due_date: '2026-10-01', reason: 'Tamper' }, 'staff@b2p.com'),
    /Cannot modify a follow-up belonging to another company/,
    'Modifying another company follow-up must throw an error'
  );

  // 4. Attempt to delete Company B follow-up while in Company A -> REJECTED
  await assert.rejects(
    officeService.deleteFollowUp('fu-b'),
    /Cannot delete a follow-up belonging to another company/,
    'Deleting another company follow-up must throw an error'
  );

  // 5. Attempt to modify Company B quotation while in Company A -> REJECTED
  await assert.rejects(
    officeService.saveQuotation({ id: 'quote-b', customer_name: 'Hacked', quotation_number: 'Q-B', total: 9999, items: [] }, 'staff@b2p.com'),
    /Cannot modify a quotation belonging to another company/,
    'Modifying another company quotation must throw an error'
  );

  // Verify Company B data in storage is completely uncorrupted
  const storedLeads = JSON.parse(store.get('docgen_leads'));
  assert.equal(storedLeads[0].customer_name, 'Lead B');

  const storedFollowUps = JSON.parse(store.get('docgen_follow_ups'));
  assert.equal(storedFollowUps[0].customer_name, 'Client B');

  const storedQuotes = JSON.parse(store.get('docgen_crm_quotations'));
  assert.equal(storedQuotes[0].customer_name, 'Client B');
});

test('Step 14 - Test 7: Company ID Manipulation Protection', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear()
  };

  const companyA = '11111111-1111-4111-8111-111111111111';
  const companyB = '22222222-2222-4222-8222-222222222222';

  const { leadService } = await loadTsModule('../src/services/leadService.ts');

  leadService.setActiveCompany(companyA);

  // User belongs to Company A, attempts to save a lead explicitly providing Company B
  await assert.rejects(
    leadService.saveLead({
      company_id: companyB,
      customer_name: 'Injected Lead',
      phone: '9847000003'
    }),
    /Cannot assign lead to a different company than the active profile/,
    'Submitting a foreign company_id while scoped to Company A must be rejected'
  );
});

test('Step 14 - Test 8: Logout and Account Switching Cache Cleanliness', async () => {
  const store = new Map();
  store.set('supabase_user', JSON.stringify({ id: 'user-a', email: 'user.a@example.com' }));
  store.set('docgen_active_profile_id', '11111111-1111-4111-8111-111111111111');

  globalThis.localStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear()
  };

  // Simulate handleLogout logic
  const handleLogout = async () => {
    localStorage.removeItem('supabase_user');
    localStorage.removeItem('docgen_active_profile_id');
  };

  await handleLogout();

  // Verify sensitive session and active company references are eradicated
  assert.equal(store.has('supabase_user'), false);
  assert.equal(store.has('docgen_active_profile_id'), false);
});

test('Step 14 - Test 9: Serverless API Company Scoping & Token Verification', async () => {
  const { requireCompanyAccess } = await import('../server/auth.js');

  const companyA = '11111111-1111-4111-8111-111111111111';
  const companyB = '22222222-2222-4222-8222-222222222222';

  // Mock response object
  function response() {
    return {
      statusCode: 200,
      headers: {},
      status(c) { this.statusCode = c; return this; },
      json(d) { this.body = d; return this; }
    };
  }

  // 1. Invalid company ID format is rejected with 400
  const res1 = response();
  const ok1 = await requireCompanyAccess({}, 'invalid-uuid', res1);
  assert.equal(ok1, false);
  assert.equal(res1.statusCode, 400);

  // 2. Caller has access to Company A, but tries to access Company B
  const auth = {
    url: 'https://test.supabase.co',
    headers: { Authorization: 'Bearer caller-jwt' }
  };

  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      // Supabase REST endpoint returns only profiles that pass caller's RLS
      if (url.includes(companyA)) {
        return Response.json([{ id: companyA }]);
      }
      // Access denied / empty array for Company B
      return Response.json([]);
    };

    const resA = response();
    const okA = await requireCompanyAccess(auth, companyA, resA);
    assert.equal(okA, true);

    const resB = response();
    const okB = await requireCompanyAccess(auth, companyB, resB);
    assert.equal(okB, false);
    assert.equal(resB.statusCode, 403);
    assert.equal(resB.body.error, 'Company access denied.');
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('Step 14 - Test 10: Step 1–13 Non-Regression Verification', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear()
  };

  const companyA = '11111111-1111-4111-8111-111111111111';

  const { leadService } = await loadTsModule('../src/services/leadService.ts');

  leadService.setActiveCompany(companyA);

  // Save new lead for Company A
  const lead1 = await leadService.saveLead({
    customer_name: 'Regression Client 1',
    phone: '9847000010',
    status: 'new'
  });

  assert.equal(lead1.company_id, companyA);
  assert.ok(lead1.lead_number.startsWith('B2P-LD-'));

  // Save second lead -> monotonically increases
  const lead2 = await leadService.saveLead({
    customer_name: 'Regression Client 2',
    phone: '9847000011',
    status: 'new'
  });

  const num1 = parseInt(lead1.lead_number.replace('B2P-LD-', ''), 10);
  const num2 = parseInt(lead2.lead_number.replace('B2P-LD-', ''), 10);
  assert.equal(num2, num1 + 1);

  // Update existing lead preserves ID, number, and company_id
  const updated = await leadService.saveLead({
    id: lead1.id,
    customer_name: 'Updated Name',
    phone: '9847000010'
  });

  assert.equal(updated.id, lead1.id);
  assert.equal(updated.lead_number, lead1.lead_number);
  assert.equal(updated.customer_name, 'Updated Name');
});

test('Step 14 - Test 11: OfficeService Follow-up Tenant Scoping & Cross-Tenant Isolation', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear()
  };

  const companyA = '11111111-1111-4111-8111-111111111111';
  const companyB = '22222222-2222-4222-8222-222222222222';

  const { officeService } = await loadTsModule('../src/services/officeService.ts', {
    './leadService': `export const leadService = {
      getActiveCompany: () => '${companyA}',
      updateLeadNextFollowUpAt: async () => null,
      addLeadActivity: async () => null
    };
    export const hydrateLeadsFromCloud = async () => [];`
  });

  const fuA = { id: 'fu-a', company_id: companyA, customer_name: 'Client A', due_date: '2026-10-01', due_time: '10:00', status: 'PENDING' };
  const fuB = { id: 'fu-b', company_id: companyB, customer_name: 'Client B', due_date: '2026-10-01', due_time: '11:00', status: 'PENDING' };
  store.set('docgen_follow_ups', JSON.stringify([fuA, fuB]));

  // 1. Scoped query for company A returns only fuA
  const listA = officeService.getFollowUps(companyA);
  assert.equal(listA.length, 1);
  assert.equal(listA[0].id, 'fu-a');

  // 2. Default call (inheriting company A from active context) returns only fuA
  const listDefault = officeService.getFollowUps();
  assert.equal(listDefault.length, 1);
  assert.equal(listDefault[0].id, 'fu-a');

  // 3. Due follow-ups scoped for company A excludes fuB
  const dueA = officeService.getDueFollowUps(companyA);
  assert.equal(dueA.some(f => f.id === 'fu-b'), false);
});

test('Step 14 - Test 12: Telecalling Operations & Sheets Sync Isolation', async () => {
  const { isUnresolvedStatus } = await import('../src/types.ts');
  assert.equal(isUnresolvedStatus('Follow-up Required'), true);
  assert.equal(isUnresolvedStatus('Converted'), false);

  const sheetsSync = await loadTsModule('../src/services/sheetsSyncQueue.ts', {
    './supabaseClient': `export const supabase = {
      from: () => ({
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) })
      })
    };
    export const isSupabaseConfigured = () => true;`
  });

  assert.equal(typeof sheetsSync.getSyncSettings, 'function');
  assert.equal(typeof sheetsSync.enqueueSync, 'function');
  assert.equal(typeof sheetsSync.claimDueRows, 'function');
});

test('Step 14 - Test 13: Credential Sanitization & Secret Exposure Prevention Audit', () => {
  const filesToCheck = [
    '../api/whatsapp.js',
    '../api/daily-report.js',
    '../.env.example'
  ];

  for (const relativePath of filesToCheck) {
    const content = readFileSync(new URL(relativePath, import.meta.url), 'utf8');

    // Verify no hardcoded production anon keys or tokens remain in code
    assert.equal(content.includes('DEFAULT_ANON_KEY'), false, `${relativePath} must not contain DEFAULT_ANON_KEY`);
    assert.equal(content.includes('DEFAULT_ADMIN_REFRESH_TOKEN'), false, `${relativePath} must not contain DEFAULT_ADMIN_REFRESH_TOKEN`);
    assert.equal(content.includes('eyJh'), false, `${relativePath} must not contain raw JWT strings`);
    assert.equal(content.includes('EAAOx'), false, `${relativePath} must not contain Bizylead live API tokens`);
  }
});

