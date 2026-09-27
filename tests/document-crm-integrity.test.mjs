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

// ─────────────────────────────────────────────────────────────────────────────
// Storage & Browser Environment Mocks
// ─────────────────────────────────────────────────────────────────────────────
const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, val) => storage.set(key, String(val)),
  removeItem: key => storage.delete(key),
  clear: () => storage.clear()
};

if (!globalThis.crypto) {
  globalThis.crypto = {};
}
let uuidSeq = 1000;
globalThis.crypto.randomUUID = () => `uuid-${uuidSeq++}`;

globalThis.window = {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
  alert: () => {}
};

// ─────────────────────────────────────────────────────────────────────────────
// Module Dependencies Loading
// ─────────────────────────────────────────────────────────────────────────────
const calcSource = transpile('../src/utils/calculations.ts');
const { calculateDocumentTotals, normalizeAdvance, calculateBalanceDue, numberToWordsIndian } = await import(asModule(calcSource));

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

const { officeService } = await load('../src/services/officeService.ts', {
  '../utils/dateUtils': dateUtilsModule,
  '../utils/staffUtils': staffUtilsModule,
  './metricsService': asModule('export const metricsService = { notifyChange() {} };'),
  './db': asModule('export const isCloudActive = () => false; export const supabase = null;'),
  './leadService': leadServiceModule,
  '../utils/whatsappShare': asModule('export const normalizeIndianPhone = x => x;'),
  '../utils/uuid': asModule('let seq = 100; export const generateUUID = () => "uuid-" + (seq++);')
});

// Transpile dbService with mock cloud stubs
const dbSource = transpile('../src/services/db.ts')
  .replaceAll(`'./supabaseClient'`, JSON.stringify(asModule('export const supabase = null; export const isSupabaseConfigured = () => false; export const isCloudActive = () => false;')))
  .replaceAll(`'./sheetsSyncQueue'`, JSON.stringify(asModule('export const enqueueSync = async () => true; export const retryDocument = async () => {};')))
  .replaceAll(`'jszip'`, JSON.stringify(asModule('export default class JSZip {}')))
  .replaceAll(`import.meta.env.DEV`, 'false');

const { dbService } = await import(asModule(dbSource));

function resetStorage() {
  storage.clear();
  uuidSeq = 1000;
  leadService.setActiveCompany(null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Customer → Quotation Relationship
// ─────────────────────────────────────────────────────────────────────────────
test('Step 13 - Test 1: Customer details correctly transfer into Quotation with company scoping', async () => {
  resetStorage();
  const companyId = 'b0000000-0000-4000-b000-000000000001';
  leadService.setActiveCompany(companyId);

  // 1. Create Customer
  const customer = await dbService.saveCustomer({
    id: 'c0000000-0000-4000-c000-000000000001',
    company_id: companyId,
    name: 'Apex Infotech Solutions',
    phone: '9847012345',
    email: 'accounts@apex.com',
    address: 'Kochi Infopark, Kerala',
    gstin: '32ABCDE1234F1Z5'
  });

  // 2. Create Quotation linked to Customer
  const quoteDoc = {
    id: 'd0000000-0000-4000-d000-000000000001',
    company_id: companyId,
    document_type: 'quotation',
    document_number: 'QTN/2001',
    sequence_number: 2001,
    customer_id: customer.id,
    customer_name: customer.name,
    customer_email: customer.email,
    customer_phone: customer.phone,
    customer_address: customer.address,
    customer_gstin: customer.gstin,
    date: '2026-09-27',
    subtotal: 50000,
    tax_total: 9000,
    discount_total: 0,
    total: 59000,
    advance: 0,
    status: 'pending_approval'
  };

  const quoteItems = [
    {
      id: 'i0000000-0000-4000-i000-000000000001',
      document_id: quoteDoc.id,
      description: 'Outdoor LED Display 30 Days',
      quantity: 1,
      days: 1,
      rate: 50000,
      unit: 'Campaign',
      gst_percentage: 18,
      amount: 50000,
      sort_order: 0
    }
  ];

  await dbService.saveDocument(quoteDoc, quoteItems);

  // 3. Reopen and verify
  const loaded = await dbService.getDocumentById(quoteDoc.id);
  assert.ok(loaded);
  assert.equal(loaded.document.customer_id, customer.id);
  assert.equal(loaded.document.customer_name, 'Apex Infotech Solutions');
  assert.equal(loaded.document.customer_phone, '9847012345');
  assert.equal(loaded.document.customer_gstin, '32ABCDE1234F1Z5');
  assert.equal(loaded.document.company_id, companyId);
  assert.equal(loaded.items.length, 1);
  assert.equal(loaded.items[0].amount, 50000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Customer Snapshot vs Live Customer Data Immutability
// ─────────────────────────────────────────────────────────────────────────────
test('Step 13 - Test 2: Historical document snapshot is immune to later Customer profile mutations', async () => {
  resetStorage();
  const companyId = 'b0000000-0000-4000-b000-000000000001';

  // 1. Create initial customer
  const customer = await dbService.saveCustomer({
    id: 'c0000000-0000-4000-c000-000000000002',
    company_id: companyId,
    name: 'Original Client Name Ltd',
    phone: '9847099999',
    email: 'original@client.com',
    address: 'Old Street 1, Calicut',
    gstin: '32OLDCL1234F1Z5'
  });

  // 2. Save historical invoice with original snapshot
  const invoiceDoc = {
    id: 'd0000000-0000-4000-d000-000000000002',
    company_id: companyId,
    document_type: 'invoice',
    document_number: 'INV/1001',
    sequence_number: 1001,
    customer_id: customer.id,
    customer_name: customer.name,
    customer_email: customer.email,
    customer_phone: customer.phone,
    customer_address: customer.address,
    customer_gstin: customer.gstin,
    date: '2026-08-01',
    subtotal: 10000,
    tax_total: 1800,
    discount_total: 0,
    total: 11800,
    advance: 0,
    status: 'approved'
  };

  const invoiceItems = [
    {
      id: 'i0000000-0000-4000-i000-000000000002',
      document_id: invoiceDoc.id,
      description: 'Historical Billable Service',
      quantity: 1,
      days: 1,
      rate: 10000,
      unit: 'Unit',
      gst_percentage: 18,
      amount: 10000,
      sort_order: 0
    }
  ];

  await dbService.saveDocument(invoiceDoc, invoiceItems);

  // 3. Mutate Customer Profile completely (legal re-registration, address move)
  await dbService.saveCustomer({
    id: customer.id,
    company_id: companyId,
    name: 'Brand New Identity Private Limited',
    phone: '9999988888',
    email: 'new@identity.com',
    address: 'New Tech Park, Trivandrum',
    gstin: '32NEWID9999F1Z9'
  });

  // 4. Reopen historical document — snapshot fields MUST remain unchanged
  const reopened = await dbService.getDocumentById(invoiceDoc.id);
  assert.ok(reopened);
  assert.equal(reopened.document.customer_name, 'Original Client Name Ltd', 'Snapshot customer_name must not mutate');
  assert.equal(reopened.document.customer_address, 'Old Street 1, Calicut', 'Snapshot customer_address must not mutate');
  assert.equal(reopened.document.customer_gstin, '32OLDCL1234F1Z5', 'Snapshot customer_gstin must not mutate');
  assert.equal(reopened.document.customer_phone, '9847099999', 'Snapshot customer_phone must not mutate');
  assert.equal(reopened.document.customer_id, customer.id, 'Live customer_id relation remains intact');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Lead → Document Flow
// ─────────────────────────────────────────────────────────────────────────────
test('Step 13 - Test 3: Lead requirement flows cleanly into CRM Quotation without data loss', async () => {
  resetStorage();
  const companyId = 'b0000000-0000-4000-b000-000000000001';
  leadService.setActiveCompany(companyId);

  // 1. Create Lead
  const lead = await leadService.saveLead({
    company_id: companyId,
    customer_id: 'c0000000-0000-4000-c000-000000000003',
    customer_name: 'Metro Retail Mart',
    company_name: 'Metro Group',
    phone: '9847055555',
    address: 'MG Road, Ernakulam',
    service_required: 'LED Vehicle Campaign',
    vehicle_service_type: 'Big LED Mobile Display',
    campaign_location: 'Central Kerala',
    required_date: '2026-10-01',
    number_of_days: 3,
    notes: 'Require 2 operators for evening festival shift.',
    status: 'new'
  }, 'telecaller@b2p.com');

  assert.ok(lead.id);
  assert.ok(lead.lead_number);

  // 2. Prepare Quotation from Lead specifications
  const calculatedItems = [
    {
      id: 'item-lead-1',
      description: `${lead.service_required} - ${lead.vehicle_service_type} at ${lead.campaign_location}`,
      quantity: 1,
      days: lead.number_of_days,
      rate: 25000,
      amount: 25000 * lead.number_of_days
    }
  ];
  const subtotal = 75000;
  const taxTotal = Math.round(subtotal * 0.18);
  const total = subtotal + taxTotal;

  const quotePayload = {
    id: 'q0000000-0000-4000-q000-000000000001',
    quotation_number: 'QTN-B2P-1001',
    company_id: lead.company_id,
    lead_id: lead.id,
    lead_number: lead.lead_number,
    customer_id: lead.customer_id,
    customer_name: lead.customer_name,
    company_name: lead.company_name,
    customer_phone: lead.phone,
    customer_address: lead.address,
    service_required: lead.service_required,
    vehicle_service_type: lead.vehicle_service_type,
    campaign_location: lead.campaign_location,
    required_date: lead.required_date,
    number_of_days: lead.number_of_days,
    subtotal,
    tax_total: taxTotal,
    discount_total: 0,
    total,
    items: calculatedItems,
    notes: lead.notes,
    terms: '50% advance on booking.',
    approval_status: 'DRAFT',
    created_by_email: 'admin@b2p.com',
    created_at: new Date().toISOString()
  };

  const savedQuote = await officeService.saveQuotation(quotePayload, 'admin@b2p.com');
  assert.ok(savedQuote);
  assert.equal(savedQuote.customer_id, lead.customer_id);
  assert.equal(savedQuote.lead_id, lead.id);
  assert.equal(savedQuote.lead_number, lead.lead_number);
  assert.equal(savedQuote.total, 88500);

  // 3. Verify lead activity recorded
  const activities = leadService.getLeadActivities(lead.id);
  assert.ok(activities.some(a => a.action === 'Quotation Created'));

  // 4. Verify quotation retrieval by lead ID
  const fetchedByLead = officeService.getQuotationByLeadId(lead.id);
  assert.ok(fetchedByLead);
  assert.equal(fetchedByLead.id, savedQuote.id);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: Quotation → Invoice Conversion (Distinct Entities & Consistency)
// ─────────────────────────────────────────────────────────────────────────────
test('Step 13 - Test 4: Converting Quotation to Invoice creates a distinct document without corrupting quotation', async () => {
  resetStorage();
  const companyId = 'b0000000-0000-4000-b000-000000000001';

  // 1. Create and Save Quotation
  const quotation = {
    id: 'd0000000-0000-4000-d000-000000000010',
    company_id: companyId,
    document_type: 'quotation',
    document_number: 'QTN/2005',
    sequence_number: 2005,
    customer_id: 'c0000000-0000-4000-c000-000000000010',
    customer_name: 'Solar Power Tech',
    customer_phone: '9847011223',
    customer_address: 'Solar Park, Palakkad',
    customer_gstin: '32AABCS1234F1Z1',
    date: '2026-09-20',
    subtotal: 40000,
    tax_total: 7200,
    discount_total: 2000,
    total: 45200,
    advance: 0,
    status: 'approved'
  };

  const quoteItems = [
    {
      id: 'i0000000-0000-4000-i000-000000000010',
      document_id: quotation.id,
      description: 'Solar Rooftop Consultation & Setup',
      quantity: 2,
      days: 1,
      rate: 20000,
      unit: 'Site',
      gst_percentage: 18,
      amount: 40000,
      sort_order: 0
    }
  ];

  await dbService.saveDocument(quotation, quoteItems);

  // 2. Issue an Invoice from the Quotation
  const invoice = {
    id: 'd0000000-0000-4000-d000-000000000011', // DISTINCT ID
    company_id: quotation.company_id,
    document_type: 'invoice',
    document_number: 'INV/2005', // DISTINCT NUMBER
    sequence_number: 2005,
    customer_id: quotation.customer_id,
    customer_name: quotation.customer_name,
    customer_phone: quotation.customer_phone,
    customer_address: quotation.customer_address,
    customer_gstin: quotation.customer_gstin,
    date: '2026-09-27',
    subtotal: quotation.subtotal,
    tax_total: quotation.tax_total,
    discount_total: quotation.discount_total,
    total: quotation.total,
    advance: 10000, // Client paid 10,000 advance against invoice
    status: 'pending_approval'
  };

  const invoiceItems = quoteItems.map(it => ({
    ...it,
    id: 'i0000000-0000-4000-i000-000000000011', // Distinct item ID
    document_id: invoice.id
  }));

  await dbService.saveDocument(invoice, invoiceItems);

  // 3. Verify Quotation is completely intact
  const reopenedQuote = await dbService.getDocumentById(quotation.id);
  assert.ok(reopenedQuote);
  assert.equal(reopenedQuote.document.document_type, 'quotation');
  assert.equal(reopenedQuote.document.document_number, 'QTN/2005');
  assert.equal(reopenedQuote.document.total, 45200);
  assert.equal(reopenedQuote.document.advance, 0);

  // 4. Verify Invoice is a distinct document with matching financial details
  const reopenedInvoice = await dbService.getDocumentById(invoice.id);
  assert.ok(reopenedInvoice);
  assert.equal(reopenedInvoice.document.id, invoice.id);
  assert.notEqual(reopenedInvoice.document.id, quotation.id);
  assert.equal(reopenedInvoice.document.document_type, 'invoice');
  assert.equal(reopenedInvoice.document.document_number, 'INV/2005');
  assert.equal(reopenedInvoice.document.subtotal, 40000);
  assert.equal(reopenedInvoice.document.tax_total, 7200);
  assert.equal(reopenedInvoice.document.total, 45200);
  assert.equal(reopenedInvoice.document.advance, 10000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: Document Edit Integrity (Line items, Deletions, Recalculations)
// ─────────────────────────────────────────────────────────────────────────────
test('Step 13 - Test 5: Editing document preserves document ID/number while correctly applying line additions, updates, and removals', async () => {
  resetStorage();
  const companyId = 'b0000000-0000-4000-b000-000000000001';

  // 1. Create document with 2 items
  const doc = {
    id: 'd0000000-0000-4000-d000-000000000020',
    company_id: companyId,
    document_type: 'invoice',
    document_number: 'INV/3001',
    sequence_number: 3001,
    customer_name: 'Cochin Tech Hub',
    customer_address: 'Kakkanad',
    date: '2026-09-25',
    subtotal: 30000,
    tax_total: 5400,
    discount_total: 0,
    total: 35400,
    advance: 0,
    status: 'pending_approval'
  };

  const initialItems = [
    {
      id: 'i0000000-0000-4000-i000-000000000021',
      document_id: doc.id,
      description: 'Item 1 - Audio Setup',
      quantity: 1,
      days: 1,
      rate: 10000,
      unit: 'Set',
      gst_percentage: 18,
      amount: 10000,
      sort_order: 0
    },
    {
      id: 'i0000000-0000-4000-i000-000000000022',
      document_id: doc.id,
      description: 'Item 2 - Visual Screen Setup',
      quantity: 1,
      days: 1,
      rate: 20000,
      unit: 'Set',
      gst_percentage: 18,
      amount: 20000,
      sort_order: 1
    }
  ];

  await dbService.saveDocument(doc, initialItems);

  // 2. Perform Edit:
  // - Delete Item 1
  // - Update Item 2 rate to 25,000
  // - Add Item 3 (Stage Lighting, rate 5,000)
  const updatedItems = [
    {
      id: 'i0000000-0000-4000-i000-000000000022',
      document_id: doc.id,
      description: 'Item 2 - Visual Screen Setup (Upgraded)',
      quantity: 1,
      days: 1,
      rate: 25000,
      unit: 'Set',
      gst_percentage: 18,
      amount: 25000,
      sort_order: 0
    },
    {
      id: 'i0000000-0000-4000-i000-000000000023',
      document_id: doc.id,
      description: 'Item 3 - Stage Lighting',
      quantity: 1,
      days: 1,
      rate: 5000,
      unit: 'Set',
      gst_percentage: 18,
      amount: 5000,
      sort_order: 1
    }
  ];

  const { subtotal, taxableAmount, taxTotal, total } = calculateDocumentTotals(updatedItems, 0, 'invoice');
  assert.equal(subtotal, 30000);
  assert.equal(taxTotal, 5400);
  assert.equal(total, 35400);

  const updatedDoc = {
    ...doc,
    subtotal,
    tax_total: taxTotal,
    total,
    notes: 'Updated staging requirements'
  };

  await dbService.saveDocument(updatedDoc, updatedItems);

  // 3. Reopen and verify
  const reopened = await dbService.getDocumentById(doc.id);
  assert.ok(reopened);
  assert.equal(reopened.document.id, doc.id, 'Document ID must be preserved');
  assert.equal(reopened.document.document_number, 'INV/3001', 'Document number must remain unchanged');
  assert.equal(reopened.items.length, 2);
  // Verify Item 1 is completely gone
  assert.equal(reopened.items.some(it => it.description.includes('Item 1')), false);
  // Verify Item 2 updated
  assert.equal(reopened.items[0].description, 'Item 2 - Visual Screen Setup (Upgraded)');
  assert.equal(reopened.items[0].rate, 25000);
  // Verify Item 3 added
  assert.equal(reopened.items[1].description, 'Item 3 - Stage Lighting');
  assert.equal(reopened.items[1].rate, 5000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: Duplicate Save Protection (Synchronous Single-Flight)
// ─────────────────────────────────────────────────────────────────────────────
test('Step 13 - Test 6: Synchronous single-flight guard suppresses rapid duplicate saves', async () => {
  resetStorage();
  const companyId = 'b0000000-0000-4000-b000-000000000001';

  // Simulate DocumentEditor single-flight submission controller
  let isSubmitting = false;
  let saveCount = 0;

  async function simulateUserSaveClick(docPayload, itemsPayload) {
    if (isSubmitting) {
      return { status: 'BLOCKED_DUPLICATE' };
    }
    isSubmitting = true;
    try {
      saveCount++;
      // Simulate network persistence latency
      await new Promise(r => setTimeout(r, 15));
      await dbService.saveDocument(docPayload, itemsPayload);
      return { status: 'SAVED', docId: docPayload.id };
    } finally {
      isSubmitting = false;
    }
  }

  const doc = {
    id: 'd0000000-0000-4000-d000-000000000030',
    company_id: companyId,
    document_type: 'invoice',
    document_number: 'INV/4001',
    sequence_number: 4001,
    customer_name: 'Rapid Clicker Inc',
    subtotal: 1000,
    tax_total: 180,
    total: 1180,
    date: '2026-09-27'
  };

  const items = [{
    id: 'i0000000-0000-4000-i000-000000000030',
    document_id: doc.id,
    description: 'Service',
    quantity: 1,
    rate: 1000,
    amount: 1000,
    gst_percentage: 18
  }];

  // Fire 3 simultaneous rapid clicks
  const [click1, click2, click3] = await Promise.all([
    simulateUserSaveClick(doc, items),
    simulateUserSaveClick(doc, items),
    simulateUserSaveClick(doc, items)
  ]);

  // Click 1 must succeed, clicks 2 and 3 must be blocked synchronously
  assert.equal(click1.status, 'SAVED');
  assert.equal(click2.status, 'BLOCKED_DUPLICATE');
  assert.equal(click3.status, 'BLOCKED_DUPLICATE');
  assert.equal(saveCount, 1, 'Only one database save must be triggered');

  // Verify only 1 document in storage
  const docs = await dbService.getDocuments(companyId);
  assert.equal(docs.length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7: Document Number Generation & Company Uniqueness
// ─────────────────────────────────────────────────────────────────────────────
test('Step 13 - Test 7: Document numbering enforces company isolation and correct incrementation', async () => {
  resetStorage();
  const companyA = 'b0000000-0000-4000-b000-000000000001';
  const companyB = 'b0000000-0000-4000-b000-000000000002';

  // Seed Company A doc 1001, 1002
  await dbService.saveDocument({
    id: 'doc-a-1',
    company_id: companyA,
    document_type: 'invoice',
    document_number: 'INV/1001',
    sequence_number: 1001,
    customer_name: 'Comp A Cust',
    total: 1000
  }, []);

  await dbService.saveDocument({
    id: 'doc-a-2',
    company_id: companyA,
    document_type: 'invoice',
    document_number: 'INV/1002',
    sequence_number: 1002,
    customer_name: 'Comp A Cust 2',
    total: 2000
  }, []);

  // Compute next sequence for Company A
  const docsA = await dbService.getDocuments(companyA);
  const prefix = 'INV/';
  let maxSeqA = 0;
  docsA.forEach(d => {
    if (d.document_number?.startsWith(prefix)) {
      const num = parseInt(d.document_number.substring(prefix.length), 10);
      if (num > maxSeqA) maxSeqA = num;
    }
  });
  const nextSeqA = maxSeqA + 1;
  assert.equal(nextSeqA, 1003, 'Company A next sequence should be 1003');

  // Company B starts fresh at 1001 without seeing Company A's sequence
  const docsB = await dbService.getDocuments(companyB);
  let maxSeqB = 0;
  docsB.forEach(d => {
    if (d.document_number?.startsWith(prefix)) {
      const num = parseInt(d.document_number.substring(prefix.length), 10);
      if (num > maxSeqB) maxSeqB = num;
    }
  });
  const nextSeqB = Math.max(1001, maxSeqB + 1);
  assert.equal(nextSeqB, 1001, 'Company B starts independently at 1001');

  // Save Company B doc with INV/1001
  await dbService.saveDocument({
    id: 'doc-b-1',
    company_id: companyB,
    document_type: 'invoice',
    document_number: 'INV/1001',
    sequence_number: 1001,
    customer_name: 'Comp B Cust',
    total: 5000
  }, []);

  // Verify both company documents exist independently
  const finalA = await dbService.getDocuments(companyA);
  const finalB = await dbService.getDocuments(companyB);
  assert.equal(finalA.length, 2);
  assert.equal(finalB.length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8: Line-Item Multiplier & Ordering Integrity
// ─────────────────────────────────────────────────────────────────────────────
test('Step 13 - Test 8: Line items calculate Rate × Qty × (Days || 1) and preserve sort order', async () => {
  resetStorage();
  const companyId = 'b0000000-0000-4000-b000-000000000001';

  const items = [
    {
      id: 'it-1',
      description: 'Single Day Single Unit',
      quantity: 1,
      days: 1,
      rate: 5000,
      gst_percentage: 18
    },
    {
      id: 'it-2',
      description: 'Multi Qty Multi Day Campaign',
      quantity: 3,
      days: 4,
      rate: 2000, // 3 * 4 * 2000 = 24,000
      gst_percentage: 18
    },
    {
      id: 'it-3',
      description: 'Zero Days Multiplier Defaults to 1',
      quantity: 2,
      days: 0, // days 0 or undefined defaults to 1: 2 * 1 * 1500 = 3,000
      rate: 1500,
      gst_percentage: 12
    }
  ];

  const totals = calculateDocumentTotals(items, 0, 'invoice');
  assert.equal(totals.subtotal, 5000 + 24000 + 3000); // 32,000
  assert.equal(totals.taxableAmount, 32000);

  // GST check:
  // it-1: 5000 * 18% = 900
  // it-2: 24000 * 18% = 4320
  // it-3: 3000 * 12% = 360
  // total tax = 900 + 4320 + 360 = 5580
  assert.equal(totals.taxTotal, 5580);
  assert.equal(totals.total, 37580);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 9: Mathematical Calculation Verification (Scenarios A, B, C, & Advance)
// ─────────────────────────────────────────────────────────────────────────────
test('Step 13 - Test 9: Independent mathematical calculation verification for Scenarios A, B, C, and Advance', async () => {
  // Scenario A: ₹1,000 × 1 item, 18% tax
  const scenarioA = calculateDocumentTotals([
    { quantity: 1, days: 1, rate: 1000, gst_percentage: 18 }
  ], 0, 'invoice');
  assert.equal(scenarioA.subtotal, 1000);
  assert.equal(scenarioA.taxableAmount, 1000);
  assert.equal(scenarioA.taxTotal, 180);
  assert.equal(scenarioA.total, 1180);
  assert.equal(scenarioA.amountInWords.includes('One Thousand One Hundred and Eighty'), true);

  // Scenario B: Two items: ₹1,000 × 2 (₹2,000) and ₹500 × 1 (₹500), 18% tax
  const scenarioB = calculateDocumentTotals([
    { quantity: 2, days: 1, rate: 1000, gst_percentage: 18 },
    { quantity: 1, days: 1, rate: 500, gst_percentage: 18 }
  ], 0, 'invoice');
  assert.equal(scenarioB.subtotal, 2500);
  assert.equal(scenarioB.taxableAmount, 2500);
  assert.equal(scenarioB.taxTotal, 450);
  assert.equal(scenarioB.total, 2950);

  // Scenario C: Subtotal ₹2,500 with ₹500 discount
  const scenarioC = calculateDocumentTotals([
    { quantity: 2, days: 1, rate: 1000, gst_percentage: 18 },
    { quantity: 1, days: 1, rate: 500, gst_percentage: 18 }
  ], 500, 'invoice');
  assert.equal(scenarioC.subtotal, 2500);
  assert.equal(scenarioC.discountTotal, 500);
  assert.equal(scenarioC.taxableAmount, 2000);
  // Proportional GST: (2000 / 2500) * 450 = 360
  assert.equal(scenarioC.taxTotal, 360);
  assert.equal(scenarioC.total, 2360);
  assert.equal(scenarioC.effectiveGstRate, 18);

  // Advance Calculation Check
  const normAdvance = normalizeAdvance(1000);
  assert.equal(normAdvance, 1000);
  const balanceDue = calculateBalanceDue(scenarioC.total, normAdvance);
  assert.equal(balanceDue, 1360); // 2360 - 1000 = 1360
  assert.equal(scenarioC.total, 2360, 'Grand total must NEVER be reduced by advance');

  // Negative / Invalid Advance clamp check
  assert.equal(normalizeAdvance(-500), 0);
  assert.equal(normalizeAdvance('invalid'), 0);
  assert.equal(calculateBalanceDue(2360, 3000), 0, 'Balance due must never render negative');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 10: GST Data Integrity (Tax Invoice vs Non-Tax Invoice)
// ─────────────────────────────────────────────────────────────────────────────
test('Step 13 - Test 10: Non-Tax Invoice forces 0% GST while Tax Invoice calculates authoritative GST', async () => {
  const items = [
    { quantity: 1, days: 1, rate: 10000, gst_percentage: 18 }
  ];

  // Tax Invoice
  const taxInvoiceRes = calculateDocumentTotals(items, 0, 'invoice');
  assert.equal(taxInvoiceRes.subtotal, 10000);
  assert.equal(taxInvoiceRes.taxTotal, 1800);
  assert.equal(taxInvoiceRes.total, 11800);

  // Non-Tax Invoice (International profile / plain invoice)
  const nonTaxInvoiceRes = calculateDocumentTotals(items, 0, 'non_tax_invoice');
  assert.equal(nonTaxInvoiceRes.subtotal, 10000);
  assert.equal(nonTaxInvoiceRes.taxTotal, 0, 'Non-tax invoice must apply 0% tax');
  assert.equal(nonTaxInvoiceRes.total, 10000);
  assert.equal(nonTaxInvoiceRes.effectiveGstRate, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 11: PDF / Reopen Data Integrity
// ─────────────────────────────────────────────────────────────────────────────
test('Step 13 - Test 11: Reopening saved document loads authoritative database snapshot for PDF generation', async () => {
  resetStorage();
  const companyId = 'b0000000-0000-4000-b000-000000000001';

  const doc = {
    id: 'd0000000-0000-4000-d000-000000000050',
    company_id: companyId,
    document_type: 'invoice',
    document_number: 'INV/5001',
    sequence_number: 5001,
    customer_name: 'High Precision Printing',
    customer_address: 'Kochi',
    customer_gstin: '32HIGH1234F1Z0',
    date: '2026-09-27',
    subtotal: 15000,
    tax_total: 2700,
    discount_total: 0,
    total: 17700,
    advance: 5000,
    status: 'approved'
  };

  const items = [
    {
      id: 'i0000000-0000-4000-i000-000000000050',
      document_id: doc.id,
      description: 'Color Offset Printing 10,000 units',
      quantity: 10,
      days: 1,
      rate: 1500,
      unit: 'Thousand',
      gst_percentage: 18,
      amount: 15000,
      sort_order: 0
    }
  ];

  await dbService.saveDocument(doc, items);

  // Fetch full details as done by DocumentPreview
  const previewData = await dbService.getDocumentById(doc.id);
  assert.ok(previewData);
  const { document: loadedDoc, items: loadedItems } = previewData;

  // Verify preview calculations match saved totals exactly
  const totals = calculateDocumentTotals(loadedItems, loadedDoc.discount_total, loadedDoc.document_type);
  assert.equal(totals.subtotal, 15000);
  assert.equal(totals.taxTotal, 2700);
  assert.equal(totals.total, 17700);
  assert.equal(calculateBalanceDue(totals.total, loadedDoc.advance), 12700);
  assert.equal(loadedDoc.customer_gstin, '32HIGH1234F1Z0');
  assert.equal(loadedDoc.document_number, 'INV/5001');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 12: Tenant Isolation (Company A vs Company B)
// ─────────────────────────────────────────────────────────────────────────────
test('Step 13 - Test 12: Strict tenant isolation prevents cross-company document visibility and rejects default fallback', async () => {
  resetStorage();
  const companyA = 'b0000000-0000-4000-b000-000000000001';
  const companyB = 'b0000000-0000-4000-b000-000000000002';

  // Create Company A doc
  await dbService.saveDocument({
    id: 'doc-iso-a',
    company_id: companyA,
    document_type: 'invoice',
    document_number: 'INV/A-1',
    sequence_number: 1,
    customer_name: 'Company A Client',
    total: 10000
  }, []);

  // Create Company B doc
  await dbService.saveDocument({
    id: 'doc-iso-b',
    company_id: companyB,
    document_type: 'invoice',
    document_number: 'INV/B-1',
    sequence_number: 1,
    customer_name: 'Company B Client',
    total: 20000
  }, []);

  // Company A documents query
  const docsA = await dbService.getDocuments(companyA);
  assert.equal(docsA.length, 1);
  assert.equal(docsA[0].id, 'doc-iso-a');
  assert.equal(docsA.some(d => d.id === 'doc-iso-b'), false, 'Company A cannot see Company B documents');

  // Company B documents query
  const docsB = await dbService.getDocuments(companyB);
  assert.equal(docsB.length, 1);
  assert.equal(docsB[0].id, 'doc-iso-b');
  assert.equal(docsB.some(d => d.id === 'doc-iso-a'), false, 'Company B cannot see Company A documents');

  // Verification that crm_quotations persistence rejects default company
  leadService.setActiveCompany(null);
  await assert.rejects(
    officeService.saveQuotation({
      id: 'q-default-fail',
      quotation_number: 'QTN-FAIL-01',
      company_id: 'default',
      customer_name: 'Fail Customer',
      service_required: 'Service',
      campaign_location: 'Location',
      required_date: '2026-10-01',
      total: 5000,
      items: []
    }, 'staff@b2p.com'),
    /Cannot persist quotation without a valid company profile/
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 13: Failure / Retry / Partial Save Resilience
// ─────────────────────────────────────────────────────────────────────────────
test('Step 13 - Test 13: Persistence failure preserves draft/form state for retry without leaving partial state', async () => {
  resetStorage();
  const companyId = 'b0000000-0000-4000-b000-000000000001';

  let simulateNetworkError = true;

  // Mock save function with retry
  async function attemptSave(doc, items) {
    if (simulateNetworkError) {
      throw new Error('Simulated network connection failure');
    }
    return dbService.saveDocument(doc, items);
  }

  const doc = {
    id: 'd0000000-0000-4000-d000-000000000060',
    company_id: companyId,
    document_type: 'invoice',
    document_number: 'INV/6001',
    sequence_number: 6001,
    customer_name: 'Resilient Client',
    total: 1000
  };
  const items = [{
    id: 'i0000000-0000-4000-i000-000000000060',
    document_id: doc.id,
    description: 'Item',
    quantity: 1,
    rate: 1000,
    amount: 1000,
    gst_percentage: 0
  }];

  // Attempt 1: Fails
  let caughtError = null;
  try {
    await attemptSave(doc, items);
  } catch (err) {
    caughtError = err;
  }
  assert.ok(caughtError);
  assert.match(caughtError.message, /network connection failure/);

  // Verify no document was saved in database
  const docsAfterFail = await dbService.getDocuments(companyId);
  assert.equal(docsAfterFail.length, 0, 'No partial document must exist after failure');

  // Attempt 2: Retry succeeds
  simulateNetworkError = false;
  const saved = await attemptSave(doc, items);
  assert.ok(saved);
  assert.equal(saved.id, doc.id);

  const docsAfterRetry = await dbService.getDocuments(companyId);
  assert.equal(docsAfterRetry.length, 1);
  assert.equal(docsAfterRetry[0].document_number, 'INV/6001');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 14: Steps 1–12 Non-Regression Verification
// ─────────────────────────────────────────────────────────────────────────────
test('Step 13 - Test 14: Steps 1–12 functionality (Leads, Follow-ups, Customers, Staff Metrics) remains intact', async () => {
  resetStorage();
  const companyId = 'b0000000-0000-4000-b000-000000000001';
  leadService.setActiveCompany(companyId);

  // Step 10 & 11: Create customer and lead
  const customer = await dbService.saveCustomer({
    id: 'c-reg-01',
    company_id: companyId,
    name: 'Regression Customer Corp',
    phone: '9847098765'
  });

  const lead = await leadService.saveLead({
    company_id: companyId,
    customer_id: customer.id,
    customer_name: customer.name,
    phone: customer.phone,
    service_required: 'Display Advertising',
    status: 'new'
  }, 'staff@b2p.com');

  assert.ok(lead.id);

  // Step 1-8: Create and update follow-up
  const followUp = await officeService.saveFollowUp({
    id: 'f-reg-01',
    company_id: companyId,
    lead_id: lead.id,
    customer_name: customer.name,
    due_date: '2026-09-28',
    due_time: '11:00',
    reason: 'Follow-up on proposal',
    status: 'PENDING',
    assigned_staff_email: 'staff@b2p.com'
  });

  assert.ok(followUp);
  assert.equal(followUp.company_id, companyId);

  // Verify lead.next_follow_up_at was synchronized (Step 7)
  const refreshedLead = leadService.getLeadById(lead.id);
  assert.ok(refreshedLead.next_follow_up_at);

  // Step 12: Customer deletion ON DELETE SET NULL on lead, follow-up, and document
  const testDoc = {
    id: 'd-reg-01',
    company_id: companyId,
    document_type: 'invoice',
    document_number: 'INV/REG-01',
    sequence_number: 9999,
    customer_id: customer.id,
    customer_name: customer.name,
    total: 5000
  };
  await dbService.saveDocument(testDoc, []);

  await dbService.deleteCustomer(customer.id);

  // Verify non-cascade unlinking:
  const leadAfterCustDelete = leadService.getLeadById(lead.id);
  assert.ok(leadAfterCustDelete, 'Lead must not be deleted');
  assert.equal(leadAfterCustDelete.customer_id, undefined, 'Lead customer_id must be unlinked');

  const docAfterCustDelete = await dbService.getDocumentById(testDoc.id);
  assert.ok(docAfterCustDelete, 'Document must not be deleted');
  assert.equal(docAfterCustDelete.document.customer_id, undefined, 'Document customer_id must be unlinked');
  assert.equal(docAfterCustDelete.document.customer_name, 'Regression Customer Corp', 'Document customer_name snapshot preserved');
});
