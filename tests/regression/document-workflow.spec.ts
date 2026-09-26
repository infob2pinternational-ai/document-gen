import { test, expect } from '@playwright/test';
import { setupApp, navigateToTab, switchCompanyProfile, COMPANY_A } from '../helpers/crm-test-helpers';

// Production profile with GST configuration for tax testing
const GST_COMPANY = {
  id: 'b0000000-0000-4000-b000-000000000002',
  name: 'B2P Inter-Media Solutions',
  gstin: '32AABCB1234F1Z5',
  currency: 'INR',
  invoice_prefix: 'B2P/INV/',
  invoice_start_number: 2001,
  quotation_prefix: 'B2P/QTN/',
  quotation_start_number: 2001,
  proforma_prefix: 'B2P/PI/',
  proforma_start_number: 2001,
  work_order_prefix: 'B2P/WO/',
  work_order_start_number: 2001,
  created_at: '2026-08-01T00:00:00.000Z'
};

const INITIAL_CUSTOMER = {
  id: 'c0000000-0000-4000-c000-000000000001',
  company_id: GST_COMPANY.id,
  name: 'Acme Mega Events',
  phone: '9847012345',
  email: 'billing@acmemega.com',
  address: 'MG Road, Thrissur, Kerala',
  gstin: '32ABCDE1234F1Z5',
  created_at: '2026-08-01T00:00:00.000Z'
};

test.describe('Regression: Mid-July Production Workflow (Clean & Unbroken)', () => {

  test('01: Login & Profile Selection (Active Company Switching & Persistence)', async ({ page }) => {
    await setupApp(page, {
      profiles: [COMPANY_A, GST_COMPANY],
      activeProfileId: GST_COMPANY.id,
      customers: [INITIAL_CUSTOMER]
    });

    // Verify company selector in sidebar renders active company
    const profileSelector = page.locator('aside.sidebar button:has(.lucide-chevron-down)');
    await expect(profileSelector).toBeVisible();
    await expect(profileSelector).toContainText(GST_COMPANY.name);

    // Switch profile to COMPANY_A (B2P International)
    await switchCompanyProfile(page, COMPANY_A.name);

    // Verify sidebar updated to B2P International
    await expect(profileSelector).toContainText(COMPANY_A.name);

    // Switch back to B2P Inter-Media Solutions
    await switchCompanyProfile(page, GST_COMPANY.name);
    await expect(profileSelector).toContainText(GST_COMPANY.name);
  });

  test('02: Customer Access (List Rendering & Adding New Customer)', async ({ page }) => {
    await setupApp(page, {
      profiles: [COMPANY_A, GST_COMPANY],
      activeProfileId: GST_COMPANY.id,
      customers: [INITIAL_CUSTOMER]
    });

    // Navigate to Customers tab
    await navigateToTab(page, 'customers');

    // Verify preloaded customer is listed
    await expect(page.locator(`text=${INITIAL_CUSTOMER.name}`).first()).toBeVisible();

    // Click Add Customer
    await page.click('button:has-text("Add Customer")');
    await expect(page.locator('.modal-header:has-text("Add New Customer")')).toBeVisible();

    // Fill form
    await page.fill('input[placeholder*="Malabar Gold"]', 'Zenith Logistics Ltd');
    await page.fill('input[placeholder="9847012345"]', '9895012345');
    await page.fill('input[placeholder="billing@customer.com"]', 'finance@zenith.in');
    await page.fill('textarea[placeholder*="Street, City"]', 'Marine Drive, Kochi, Kerala');

    // Submit
    await page.click('button[type="submit"]:has-text("Save Customer")');

    // Verify new customer appears in directory
    await expect(page.locator('text=Zenith Logistics Ltd').first()).toBeVisible();
  });

  test('03: Quotation Access, GST Calculation Sanity, and Document Saving', async ({ page }) => {
    await setupApp(page, {
      profiles: [COMPANY_A, GST_COMPANY],
      activeProfileId: GST_COMPANY.id,
      customers: [INITIAL_CUSTOMER]
    });

    // Navigate to Doc Gen tab
    await navigateToTab(page, 'documents');

    // Click Standard Doc to open DocumentEditor
    await page.click('button:has-text("Standard Doc")');

    // Switch document type to Quotation
    const docTypeSelect = page.locator('select').first();
    await docTypeSelect.selectOption('quotation');

    // Verify quotation sequence prefix is populated
    const docNumInput = page.locator('input[value*="QTN"]').or(page.locator('input[value*="B2P/QTN"]')).first();
    await expect(docNumInput).toBeVisible();

    // Select customer from dropdown
    const customerSelect = page.locator('select:has-text("-- Choose Customer --")');
    await customerSelect.selectOption({ label: INITIAL_CUSTOMER.name });

    // Customer name input should be filled
    const customerNameInput = page.locator('input[value="Acme Mega Events"]').first();
    await expect(customerNameInput).toBeVisible();

    // Click Add Item (or Add First Item)
    const addItemBtn = page.locator('button:has-text("Add First Item"), button:has-text("Add Item")').first();
    await addItemBtn.click();

    // LineItemModal opens
    const lineItemModal = page.locator('.line-item-modal-container');
    await expect(lineItemModal).toBeVisible();
    await page.waitForTimeout(150); // Allow modal autofocus timer to settle

    // Fill item details
    const descInput = lineItemModal.locator('textarea[placeholder*="Enter item description"]');
    await descInput.click();
    await descInput.fill('LED Outdoor Billboard Campaign (30 Days)');
    await expect(descInput).toHaveValue('LED Outdoor Billboard Campaign (30 Days)');

    await lineItemModal.locator('input[placeholder="Qty"]').fill('2');
    await lineItemModal.locator('input[placeholder="0.00"]').first().fill('15000'); // 2 * 15,000 = 30,000

    // Verify standard 18% GST is selected
    const gstSelect = lineItemModal.locator('select:has-text("GST")');
    await gstSelect.selectOption('18');

    // Line item total should show ₹35,400.00 (30,000 + 18% = 35,400)
    await expect(lineItemModal.locator('text=35,400')).toBeVisible();

    // Click Add Item inside modal
    await lineItemModal.locator('button:has-text("Add Item"):not(:disabled)').click();
    await expect(lineItemModal).not.toBeVisible();

    // Verify Document Editor Grand Total shows 35,400
    await expect(page.locator('text=35,400').first()).toBeVisible();

    // Click Save Document
    await page.click('button:has-text("Save Document")');

    // Verify DocumentSuccessDialog appears
    const successDialog = page.locator('.modal-overlay:has-text("Successfully")');
    await expect(successDialog).toBeVisible();
    await expect(successDialog.locator('text=35,400')).toBeVisible();
  });

  test('04: PDF Preview Trigger & Download Flow', async ({ page }) => {
    await setupApp(page, {
      profiles: [COMPANY_A, GST_COMPANY],
      activeProfileId: GST_COMPANY.id,
      customers: [INITIAL_CUSTOMER]
    });

    // Navigate to documents tab
    await navigateToTab(page, 'documents');

    // Create and save a quotation first
    await page.click('button:has-text("Standard Doc")');
    await page.locator('select').first().selectOption('quotation');
    await page.locator('select:has-text("-- Choose Customer --")').selectOption({ label: INITIAL_CUSTOMER.name });

    await page.locator('button:has-text("Add First Item"), button:has-text("Add Item")').first().click();
    const modal = page.locator('.line-item-modal-container');
    await expect(modal).toBeVisible();
    await page.waitForTimeout(150);
    const descInput4 = modal.locator('textarea[placeholder*="Enter item description"]');
    await descInput4.click();
    await descInput4.fill('Corporate Stage Branding');
    await expect(descInput4).toHaveValue('Corporate Stage Branding');
    await modal.locator('input[placeholder="Qty"]').fill('1');
    await modal.locator('input[placeholder="0.00"]').first().fill('20000');
    await modal.locator('button:has-text("Add Item"):not(:disabled)').click();
    await expect(modal).not.toBeVisible();

    await page.click('button:has-text("Save Document")');
    await expect(page.locator('.modal-overlay:has-text("Successfully")')).toBeVisible();

    // Click "View Document" from success dialog to open DocumentPreview
    await page.click('button:has-text("View Document")');

    // DocumentPreview header should be visible
    await expect(page.locator('button:has-text("Print / Export PDF")')).toBeVisible();
    await expect(page.locator('.document-canvas:has-text("QUOTATION")')).toBeVisible();
    await expect(page.locator('.document-canvas:has-text("Corporate Stage Branding")')).toBeVisible();

    // Mock window.print to test PDF export trigger
    await page.evaluate(() => {
      (window as any).__printCalled = false;
      window.print = () => {
        (window as any).__printCalled = true;
      };
    });

    // Trigger Print / Export PDF
    await page.click('button:has-text("Print / Export PDF")');

    const printCalled = await page.evaluate(() => (window as any).__printCalled);
    expect(printCalled).toBe(true);

    // Click "Back to List"
    await page.click('button:has-text("Back to List")');
    await expect(page.locator('h1:has-text("Doc Gen")')).toBeVisible();
  });

  test('05: Saved Document Reopening and Editing Verification', async ({ page }) => {
    const SAVED_DOC = {
      id: 'd0000000-0000-4000-d000-000000000001',
      company_id: GST_COMPANY.id,
      document_type: 'quotation',
      document_number: 'B2P/QTN/2001',
      sequence_number: 2001,
      customer_id: INITIAL_CUSTOMER.id,
      customer_name: INITIAL_CUSTOMER.name,
      customer_phone: INITIAL_CUSTOMER.phone,
      date: '2026-09-25',
      subtotal: 20000,
      tax_total: 3600,
      discount_total: 0,
      total: 23600,
      advance: 0,
      status: 'pending_approval'
    };

    const SAVED_ITEMS = [
      {
        id: 'i0000000-0000-4000-i000-000000000001',
        document_id: SAVED_DOC.id,
        description: 'Existing Audio Visual Equipment Rental',
        quantity: 1,
        days: 1,
        unit: 'Unit',
        rate: 20000,
        gst_percentage: 18,
        amount: 20000,
        sort_order: 0
      }
    ];

    await setupApp(page, {
      profiles: [COMPANY_A, GST_COMPANY],
      activeProfileId: GST_COMPANY.id,
      customers: [INITIAL_CUSTOMER],
      documents: [SAVED_DOC],
      documentItems: SAVED_ITEMS
    });

    // Navigate to documents tab
    await navigateToTab(page, 'documents');

    // Reopening verification: Document should be listed in the table
    await expect(page.locator('text=B2P/QTN/2001').first()).toBeVisible();
    await expect(page.locator('text=Acme Mega Events').first()).toBeVisible();

    // Click Edit button (pencil icon)
    const editBtn = page.locator('button[title*="Edit" i]').first();
    await editBtn.click();

    // DocumentEditor should open with pre-filled document details
    await expect(page.locator('h1:has-text("Edit Quotation"), h1:has-text("Edit Document")')).toBeVisible();
    await expect(page.locator('input[value="B2P/QTN/2001"]')).toBeVisible();
    await expect(page.locator('text=Existing Audio Visual Equipment Rental')).toBeVisible();

    // Modify payment terms
    const termsInput = page.locator('textarea[placeholder*="Net 15 days"]');
    await termsInput.fill('Strictly Net 7 days payment terms.');

    // Save edited document
    await page.click('button:has-text("Save Document")');

    // Confirm dialog appears
    await expect(page.locator('.modal-overlay:has-text("Successfully")')).toBeVisible();

    // Close dialog
    await page.click('button[title="Close (Esc)"], .modal-overlay button:has(.lucide-x)');

    // Verify returning to doc list
    await expect(page.locator('h1:has-text("Doc Gen")')).toBeVisible();
  });
});
