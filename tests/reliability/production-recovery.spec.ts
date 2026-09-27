import { test, expect } from '@playwright/test';
import { setupApp, navigateToTab, switchCompanyProfile, COMPANY_A, COMPANY_B } from '../helpers/crm-test-helpers';

const RECOVERY_COMPANY = {
  id: 'a0000000-0000-4000-a000-000000000001',
  name: 'B2P International',
  currency: 'INR',
  invoice_prefix: 'INV/',
  invoice_start_number: 1001,
  quotation_prefix: 'QTN/',
  quotation_start_number: 1001,
  proforma_prefix: 'PI/',
  proforma_start_number: 1001,
  work_order_prefix: 'WO/',
  work_order_start_number: 1001,
  created_at: '2026-08-01T00:00:00.000Z'
};

const BASE_CUSTOMER = {
  id: 'c1000000-0000-4000-c000-000000000001',
  company_id: RECOVERY_COMPANY.id,
  name: 'Initial Horizon Enterprises',
  phone: '9847011223',
  email: 'horizon@example.com',
  address: 'Marine Drive, Kochi, Kerala',
  created_at: '2026-08-01T00:00:00.000Z'
};

const PERSISTED_DOC = {
  id: 'd1000000-0000-4000-d000-000000000001',
  company_id: RECOVERY_COMPANY.id,
  document_type: 'quotation',
  document_number: 'QTN/1001',
  sequence_number: 1001,
  customer_id: BASE_CUSTOMER.id,
  customer_name: BASE_CUSTOMER.name,
  customer_phone: BASE_CUSTOMER.phone,
  date: '2026-09-27',
  subtotal: 50000,
  tax_total: 9000,
  discount_total: 0,
  total: 59000,
  advance: 0,
  notes: 'Standard Quotation Notes',
  terms: 'Payment 50% advance upon booking.',
  status: 'pending_approval',
  created_at: '2026-09-27T08:00:00.000Z'
};

const PERSISTED_ITEMS = [
  {
    id: 'i1000000-0000-4000-i000-000000000001',
    document_id: PERSISTED_DOC.id,
    description: 'High-Definition LED Screen Rental (3 Days)',
    quantity: 1,
    days: 3,
    unit: 'Unit',
    rate: 50000,
    gst_percentage: 18,
    amount: 50000,
    sort_order: 0
  }
];

test.describe('Step 15: Production Reliability, Failure Recovery & Data Preservation', () => {

  // Test A: Customer create → refresh → verify persistence
  test('Test A: Customer create → refresh → verify persistence', async ({ page }) => {
    await setupApp(page, {
      profiles: [RECOVERY_COMPANY, COMPANY_B],
      activeProfileId: RECOVERY_COMPANY.id,
      customers: [BASE_CUSTOMER]
    });

    await navigateToTab(page, 'customers');
    await expect(page.locator(`text=${BASE_CUSTOMER.name}`).first()).toBeVisible();

    // Click Add Customer
    await page.click('button:has-text("Add Customer")');
    await expect(page.locator('.modal-header:has-text("Add New Customer")')).toBeVisible();

    await page.fill('input[placeholder*="Malabar Gold"]', 'Acura Motors Kochi');
    await page.fill('input[placeholder="9847012345"]', '9847111222');
    await page.fill('input[placeholder="billing@customer.com"]', 'service@acuramotors.in');
    await page.fill('textarea[placeholder*="Street, City"]', 'NH Bypass, Maradu, Kochi');

    await page.click('button[type="submit"]:has-text("Save Customer")');
    await expect(page.locator('text=Acura Motors Kochi').first()).toBeVisible({ timeout: 5000 });

    // Refresh browser
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await navigateToTab(page, 'customers');

    // Verify persistence across reload
    const row = page.locator('table tbody tr', { hasText: 'Acura Motors Kochi' });
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(row).toContainText('9847111222');
    await expect(row).toContainText('service@acuramotors.in');
  });

  // Test B: Customer edit → refresh → verify persistence
  test('Test B: Customer edit → refresh → verify persistence', async ({ page }) => {
    await setupApp(page, {
      profiles: [RECOVERY_COMPANY, COMPANY_B],
      activeProfileId: RECOVERY_COMPANY.id,
      customers: [BASE_CUSTOMER]
    });

    await navigateToTab(page, 'customers');
    const row = page.locator('table tbody tr', { hasText: BASE_CUSTOMER.name });
    await expect(row).toBeVisible();

    // Open edit modal
    await row.locator('button[title="Edit Customer"]').click();
    await expect(page.locator('.modal-header:has-text("Edit Customer Record")')).toBeVisible();

    // Modify contact and address
    await page.fill('input[placeholder="9847012345"]', '9847999111');
    await page.fill('textarea[placeholder*="Street, City"]', 'Updated Logistics Hub, Infopark, Kakkanad, Kochi');

    await page.click('button[type="submit"]:has-text("Save Customer")');
    await expect(page.locator('.modal-content')).not.toBeVisible({ timeout: 5000 });

    // Verify change reflected in table
    const updatedRow = page.locator('table tbody tr', { hasText: BASE_CUSTOMER.name });
    await expect(updatedRow).toContainText('9847999111');

    // Refresh browser
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await navigateToTab(page, 'customers');

    // Verify edited data persists
    const persistedRow = page.locator('table tbody tr', { hasText: BASE_CUSTOMER.name });
    await expect(persistedRow).toBeVisible({ timeout: 5000 });
    await expect(persistedRow).toContainText('9847999111');

    // Verify address in edit modal
    await persistedRow.locator('button[title="Edit Customer"]').click();
    await expect(page.locator('textarea[placeholder*="Street, City"]')).toHaveValue('Updated Logistics Hub, Infopark, Kakkanad, Kochi');
  });

  // Test C: Lead create → rapid duplicate submission → verify one record
  test('Test C: Lead create → rapid duplicate submission → verify one record', async ({ page }) => {
    await setupApp(page, {
      profiles: [RECOVERY_COMPANY, COMPANY_B],
      activeProfileId: RECOVERY_COMPANY.id
    });

    await navigateToTab(page, 'leads');
    await page.locator('button:has-text("New Lead Intake")').click();
    const modal = page.locator('.modal-content');
    await expect(modal).toBeVisible();

    await modal.locator('input[placeholder*="Anand Menon"]').fill('Priya Nair');
    await modal.locator('input[placeholder*="Kalyan Silks"]').fill('Malabar Ventures Ltd');
    await modal.locator('input[type="tel"]').first().fill('9847333444');

    const submitBtn = modal.locator('button[type="submit"]:has-text("Create & Save Lead")');

    // Rapid double-click to test duplicate submission lock
    await submitBtn.dblclick();

    // Modal closes upon successful save
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Verify strictly ONE lead record exists in the table
    const matchingRows = page.locator('table tbody tr', { hasText: 'Malabar Ventures Ltd' });
    const count = await matchingRows.count();
    expect(count, 'Rapid double-clicking created duplicate leads! Expected exactly 1 record.').toBe(1);
  });

  // Test D: Follow-up create/edit → refresh → verify lifecycle
  test('Test D: Follow-up create/edit → refresh → verify lifecycle', async ({ page }) => {
    await setupApp(page, {
      profiles: [RECOVERY_COMPANY, COMPANY_B],
      activeProfileId: RECOVERY_COMPANY.id
    });

    await navigateToTab(page, 'follow-ups');
    await page.locator('button:has-text("Schedule Follow-up")').click();
    const modal = page.locator('.modal-content');
    await expect(modal).toBeVisible();

    await modal.locator('input[placeholder*="Arun Kumar"]').fill('Ramesh Varma');
    await modal.locator('input[placeholder*="Kerala Grand Events"]').fill('Varma Jewellers');
    await modal.locator('input[type="tel"]').fill('9847888777');
    await modal.locator('input[type="date"]').fill('2026-09-27');
    await modal.locator('input[type="time"]').fill('11:00');
    await modal.locator('input[placeholder*="Review quotation details"]').fill('Discuss Festive Offer Quotation');
    await modal.locator('textarea[placeholder*="Points to discuss"]').fill('Customer requested flexible payment schedule.');

    await modal.locator('button[type="submit"]:has-text("Save Task")').click();

    // Verify task row appears
    const row = page.locator('table tbody tr', { hasText: 'Ramesh Varma' });
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(row).toContainText('Varma Jewellers');

    // Refresh and verify persistence
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await navigateToTab(page, 'follow-ups');

    const persistedRow = page.locator('table tbody tr', { hasText: 'Ramesh Varma' });
    await expect(persistedRow).toBeVisible({ timeout: 5000 });

    // Edit task
    await persistedRow.locator('button[title="Edit Task"]').click();
    const editModal = page.locator('.modal-content');
    await expect(editModal).toBeVisible();

    await editModal.locator('input[placeholder*="Review quotation details"]').fill('Updated: Festive Offer Final Deal');
    await editModal.locator('input[type="time"]').fill('15:30');
    await editModal.locator('button[type="submit"]:has-text("Update Task")').click();

    // Refresh and verify edit persists
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await navigateToTab(page, 'follow-ups');

    const updatedRow = page.locator('table tbody tr', { hasText: 'Ramesh Varma' });
    await expect(updatedRow).toBeVisible({ timeout: 5000 });
    await expect(updatedRow).toContainText('Updated: Festive Offer Final Deal');
    await expect(updatedRow).toContainText('15:30');
  });

  // Test E: Quotation → Invoice → refresh → reopen
  test('Test E: Quotation → Invoice → refresh → reopen', async ({ page }) => {
    await setupApp(page, {
      profiles: [RECOVERY_COMPANY, COMPANY_B],
      activeProfileId: RECOVERY_COMPANY.id,
      customers: [BASE_CUSTOMER]
    });

    await navigateToTab(page, 'documents');

    // 1. Create Quotation
    await page.click('button:has-text("Standard Doc")');
    await page.locator('select').first().selectOption('quotation');
    await page.locator('select:has-text("-- Choose Customer --")').selectOption({ label: BASE_CUSTOMER.name });

    await page.locator('button:has-text("Add First Item"), button:has-text("Add Item")').first().click();
    const lineItemModal = page.locator('.line-item-modal-container');
    await expect(lineItemModal).toBeVisible();
    await page.waitForTimeout(150);

    const desc1 = lineItemModal.locator('textarea[placeholder*="Enter item description"]');
    await desc1.click();
    await desc1.fill('Stage Lighting Package');
    await lineItemModal.locator('input[placeholder="Qty"]').fill('1');
    await lineItemModal.locator('input[placeholder="0.00"]').first().fill('25000');
    await lineItemModal.locator('button:has-text("Add Item"):not(:disabled)').click();
    await expect(lineItemModal).not.toBeVisible();

    await page.click('button:has-text("Save Document")');
    const successDialog = page.locator('.modal-overlay:has-text("Successfully")');
    await expect(successDialog).toBeVisible({ timeout: 5000 });
    await page.click('button[title="Close (Esc)"], .modal-overlay button:has(.lucide-x)');

    // 2. Create Invoice
    await page.click('button:has-text("Standard Doc")');
    await page.locator('select').first().selectOption('non_tax_invoice');
    await page.locator('select:has-text("-- Choose Customer --")').selectOption({ label: BASE_CUSTOMER.name });

    await page.locator('button:has-text("Add First Item"), button:has-text("Add Item")').first().click();
    await expect(lineItemModal).toBeVisible();
    await page.waitForTimeout(150);

    const desc2 = lineItemModal.locator('textarea[placeholder*="Enter item description"]');
    await desc2.click();
    await desc2.fill('Audio System Rental');
    await lineItemModal.locator('input[placeholder="Qty"]').fill('2');
    await lineItemModal.locator('input[placeholder="0.00"]').first().fill('10000');
    await lineItemModal.locator('button:has-text("Add Item"):not(:disabled)').click();
    await expect(lineItemModal).not.toBeVisible();

    await page.click('button:has-text("Save Document")');
    await expect(successDialog).toBeVisible({ timeout: 5000 });
    await page.click('button[title="Close (Esc)"], .modal-overlay button:has(.lucide-x)');

    // 3. Refresh and verify both documents persist and can be reopened
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await navigateToTab(page, 'documents');

    const quotationRow = page.locator('table tbody tr', { hasText: 'Stage Lighting Package' }).or(page.locator('table tbody tr:has-text("QTN")'));
    await expect(quotationRow.first()).toBeVisible({ timeout: 5000 });

    const invoiceRow = page.locator('table tbody tr:has-text("INV")');
    await expect(invoiceRow.first()).toBeVisible({ timeout: 5000 });

    // Reopen invoice via edit button
    await invoiceRow.first().locator('button[title="Edit Document"]').click();
    await expect(page.locator('h1:has-text("Edit Invoice"), h1:has-text("Edit Document")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Audio System Rental')).toBeVisible();
  });

  // Test F: Document edit → refresh → reopen
  test('Test F: Document edit → refresh → reopen', async ({ page }) => {
    await setupApp(page, {
      profiles: [RECOVERY_COMPANY, COMPANY_B],
      activeProfileId: RECOVERY_COMPANY.id,
      customers: [BASE_CUSTOMER],
      documents: [PERSISTED_DOC],
      documentItems: PERSISTED_ITEMS
    });

    await navigateToTab(page, 'documents');
    const row = page.locator('table tbody tr', { hasText: PERSISTED_DOC.document_number });
    await expect(row).toBeVisible();

    // Click Edit Document
    await row.locator('button[title="Edit Document"]').click();
    await expect(page.locator('h1:has-text("Edit Quotation"), h1:has-text("Edit Document")')).toBeVisible();

    // Modify payment terms
    const termsInput = page.locator('textarea[placeholder*="Net 15 days"]');
    await termsInput.fill('Strictly Net 5 days payment terms after inspection.');

    // Save edited document
    await page.click('button:has-text("Save Document")');
    await expect(page.locator('.modal-overlay:has-text("Successfully")')).toBeVisible({ timeout: 5000 });
    await page.click('button[title="Close (Esc)"], .modal-overlay button:has(.lucide-x)');

    // Refresh browser
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await navigateToTab(page, 'documents');

    // Reopen and verify edited terms persist
    const docRow = page.locator('table tbody tr', { hasText: PERSISTED_DOC.document_number });
    await docRow.locator('button[title="Edit Document"]').click();
    await expect(page.locator('textarea[placeholder*="Net 15 days"]')).toHaveValue('Strictly Net 5 days payment terms after inspection.');
  });

  // Test G: Logout Company A → login Company B → verify no stale Company A data
  test('Test G: Logout Company A → login Company B → verify no stale Company A data', async ({ page }) => {
    const COMPANY_A_DOC = {
      ...PERSISTED_DOC,
      id: 'doc-company-a-exclusive',
      company_id: RECOVERY_COMPANY.id,
      document_number: 'QTN/A/999'
    };

    await setupApp(page, {
      profiles: [RECOVERY_COMPANY, COMPANY_B],
      activeProfileId: RECOVERY_COMPANY.id,
      customers: [BASE_CUSTOMER],
      documents: [COMPANY_A_DOC],
      documentItems: PERSISTED_ITEMS
    });

    // Verify Company A shows document
    await navigateToTab(page, 'documents');
    await expect(page.locator('text=QTN/A/999').first()).toBeVisible();

    // Switch to Company B
    await switchCompanyProfile(page, COMPANY_B.name);

    // Verify sidebar shows Company B
    const profileSelector = page.locator('aside.sidebar button:has(.lucide-chevron-down)');
    await expect(profileSelector).toContainText(COMPANY_B.name);

    // Verify Company A document does NOT leak into Company B
    await navigateToTab(page, 'documents');
    await expect(page.locator('text=QTN/A/999')).not.toBeVisible();

    // Switch back to Company A
    await switchCompanyProfile(page, RECOVERY_COMPANY.name);
    await expect(profileSelector).toContainText(RECOVERY_COMPANY.name);

    // Verify Company A data is intact
    await navigateToTab(page, 'documents');
    await expect(page.locator('text=QTN/A/999').first()).toBeVisible();
  });

  // Test H: Network failure → retry → verify safe recovery
  test('Test H: Network failure → retry → verify safe recovery', async ({ page }) => {
    await setupApp(page, {
      profiles: [RECOVERY_COMPANY, COMPANY_B],
      activeProfileId: RECOVERY_COMPANY.id,
      customers: [BASE_CUSTOMER],
      handleDialogs: false
    });

    await navigateToTab(page, 'customers');
    await page.click('button:has-text("Add Customer")');
    const modal = page.locator('.modal-content');
    await expect(modal).toBeVisible();

    await page.fill('input[placeholder*="Malabar Gold"]', 'Resilient Network Client');
    await page.fill('input[placeholder="9847012345"]', '9847123999');
    await page.fill('textarea[placeholder*="Street, City"]', 'Vyttila Mobility Hub, Kochi');

    // Catch alert dialog
    page.on('dialog', async dialog => {
      await dialog.accept();
    });

    // Inject temporary failure on first setItem call for docgen_customers
    await page.evaluate(() => {
      (window as any).__origSet = localStorage.setItem;
      let failedOnce = false;
      localStorage.setItem = function(key: string, val: string) {
        if (key === 'docgen_customers' && !failedOnce) {
          failedOnce = true;
          throw new Error('Simulated Network RPC / Storage Failure');
        }
        return (window as any).__origSet.apply(this, arguments);
      };
    });

    const saveBtn = modal.locator('button[type="submit"]:has-text("Save Customer")');
    await saveBtn.click();

    // Modal remains open with user data intact
    await page.waitForTimeout(400);
    await expect(modal).toBeVisible();
    await expect(modal.locator('input[placeholder*="Malabar Gold"]')).toHaveValue('Resilient Network Client');
    await expect(modal.locator('input[placeholder="9847012345"]')).toHaveValue('9847123999');
    await expect(modal.locator('textarea[placeholder*="Street, City"]')).toHaveValue('Vyttila Mobility Hub, Kochi');

    // Retry save now that transient error has cleared
    await saveBtn.click();
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Verify record was successfully saved and displayed in table
    const row = page.locator('table tbody tr', { hasText: 'Resilient Network Client' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('9847123999');
  });

  // Test I: Browser Back/Forward during workflow
  test('Test I: Browser Back/Forward during workflow', async ({ page }) => {
    await setupApp(page, {
      profiles: [RECOVERY_COMPANY, COMPANY_B],
      activeProfileId: RECOVERY_COMPANY.id,
      customers: [BASE_CUSTOMER]
    });

    await navigateToTab(page, 'documents');
    await page.click('button:has-text("Standard Doc")');
    await expect(page.locator('h1:has-text("Create Quotation"), h1:has-text("Create Document"), h1:has-text("Create Invoice")')).toBeVisible();

    // Navigate browser back
    await page.goBack();
    await page.waitForTimeout(300);

    // Navigate browser forward
    await page.goForward();
    await page.waitForTimeout(300);

    // Verify application state is resilient and didn't crash or show blank screen
    await expect(page.locator('aside.sidebar')).toBeVisible();
    await navigateToTab(page, 'customers');
    await expect(page.locator(`text=${BASE_CUSTOMER.name}`).first()).toBeVisible();
  });

  // Test J: PDF generation after reopening persisted document
  test('Test J: PDF generation after reopening persisted document', async ({ page }) => {
    await setupApp(page, {
      profiles: [RECOVERY_COMPANY, COMPANY_B],
      activeProfileId: RECOVERY_COMPANY.id,
      customers: [BASE_CUSTOMER],
      documents: [PERSISTED_DOC],
      documentItems: PERSISTED_ITEMS
    });

    await navigateToTab(page, 'documents');
    const docRow = page.locator('table tbody tr', { hasText: PERSISTED_DOC.document_number });
    await expect(docRow).toBeVisible();

    // Click View / Print Document (eye icon)
    await docRow.locator('button[title="View / Print Document"]').click();

    // Verify DocumentPreview canvas opens
    await expect(page.locator('.document-canvas')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button:has-text("Print / Export PDF")')).toBeVisible();
    await expect(page.locator('.document-canvas:has-text("High-Definition LED Screen Rental")')).toBeVisible();

    // Mock window.print
    await page.evaluate(() => {
      (window as any).__pdfTriggered = false;
      window.print = () => {
        (window as any).__pdfTriggered = true;
      };
    });

    // Trigger PDF Export
    await page.click('button:has-text("Print / Export PDF")');

    const pdfTriggered = await page.evaluate(() => (window as any).__pdfTriggered);
    expect(pdfTriggered, 'Export PDF must invoke print workflow').toBe(true);

    // Click Back to List
    await page.click('button:has-text("Back to List")');
    await expect(page.locator('h1:has-text("Doc Gen")')).toBeVisible();
  });
});
