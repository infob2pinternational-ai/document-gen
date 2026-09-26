import { test, expect } from '@playwright/test';
import { setupApp, navigateToTab, switchCompanyProfile, COMPANY_A, COMPANY_B } from '../helpers/crm-test-helpers';

test.describe('Leads — Duplicate Prevention & Multi-Tenant Company Isolation', () => {
  test('rapid double-click on lead submit does not create duplicate lead records and maintains contiguous sequence numbering', async ({ page }) => {
    await setupApp(page);
    await navigateToTab(page, 'leads');

    await page.locator('button:has-text("New Lead Intake")').click();
    const modal = page.locator('.modal-content');
    await expect(modal).toBeVisible();

    await modal.locator('input[placeholder*="Anand Menon"]').fill('Deepak Menon');
    await modal.locator('input[placeholder*="Kalyan Silks"]').fill('Duplicate Test Enterprise');
    await modal.locator('input[type="tel"]').first().fill('9847999888');

    const submitBtn = modal.locator('button[type="submit"]:has-text("Create & Save Lead")');
    
    // Simulate rapid double click (e.g. impatient user or jittery mouse)
    await submitBtn.dblclick();

    // Wait for modal to close
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Verify exactly ONE lead record was created, not two duplicate rows
    const matchingRows = page.locator('table tbody tr', { hasText: 'Duplicate Test Enterprise' });
    const count = await matchingRows.count();
    expect(count, 'Rapid double-clicking save created duplicate leads! Expected exactly 1 record.').toBe(1);

    const firstLeadNum = await matchingRows.first().locator('td').first().textContent();
    expect(firstLeadNum).toMatch(/^B2P-LD-\d+$/);

    // Create a second lead to verify sequence continuity
    await page.locator('button:has-text("New Lead Intake")').click();
    await expect(modal).toBeVisible();
    await modal.locator('input[placeholder*="Anand Menon"]').fill('Subsequent Customer');
    await modal.locator('input[placeholder*="Kalyan Silks"]').fill('Subsequent Enterprise');
    await modal.locator('input[type="tel"]').first().fill('9847999889');
    await modal.locator('button[type="submit"]:has-text("Create & Save Lead")').click();
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    const secondRow = page.locator('table tbody tr', { hasText: 'Subsequent Enterprise' });
    await expect(secondRow).toBeVisible();
    const secondLeadNum = await secondRow.locator('td').first().textContent();
    expect(secondLeadNum).toMatch(/^B2P-LD-\d+$/);

    // Verify numbers are strictly consecutive without skips
    const num1 = parseInt(firstLeadNum!.replace('B2P-LD-', ''), 10);
    const num2 = parseInt(secondLeadNum!.replace('B2P-LD-', ''), 10);
    expect(num2, 'Sequence jumped unexpectedly! Expected contiguous lead numbers.').toBe(num1 + 1);
  });

  test('rapid double-click on lead edit does not create duplicate and preserves lead data', async ({ page }) => {
    await setupApp(page);
    await navigateToTab(page, 'leads');

    // 1. Create a lead
    await page.locator('button:has-text("New Lead Intake")').click();
    const modal = page.locator('.modal-content');
    await expect(modal).toBeVisible();
    await modal.locator('input[placeholder*="Anand Menon"]').fill('Edit Test User');
    await modal.locator('input[placeholder*="Kalyan Silks"]').fill('Edit Enterprise Ltd');
    await modal.locator('input[type="tel"]').first().fill('9847665544');
    await modal.locator('button[type="submit"]:has-text("Create & Save Lead")').click();
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // 2. Open edit modal
    const row = page.locator('table tbody tr', { hasText: 'Edit Enterprise Ltd' });
    await expect(row).toBeVisible();
    await row.locator('button[title="Edit Lead"]').click();
    await expect(modal).toBeVisible();

    // 3. Make edit
    await modal.locator('input[placeholder*="Kalyan Silks"]').fill('Edit Enterprise Ltd - Updated');
    const updateBtn = modal.locator('button[type="submit"]:has-text("Update Lead Record")');

    // 4. Double click update
    await updateBtn.dblclick();
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // 5. Verify only 1 record exists in table
    const matchingRows = page.locator('table tbody tr', { hasText: 'Edit Enterprise Ltd - Updated' });
    expect(await matchingRows.count()).toBe(1);

    // 6. Verify total records for this lead is 1
    const allMatches = page.locator('table tbody tr', { hasText: 'Edit Enterprise Ltd' });
    expect(await allMatches.count()).toBe(1);
  });

  test('failed lead save displays error, preserves entered form inputs, and allows successful retry without reload', async ({ page }) => {
    await setupApp(page, { handleDialogs: false });
    await navigateToTab(page, 'leads');

    await page.locator('button:has-text("New Lead Intake")').click();
    const modal = page.locator('.modal-content');
    await expect(modal).toBeVisible();

    await modal.locator('input[placeholder*="Anand Menon"]').fill('Resilient Lead User');
    await modal.locator('input[placeholder*="Kalyan Silks"]').fill('Retry Resilient Co');
    await modal.locator('input[type="tel"]').first().fill('9847556677');
    await modal.locator('textarea[placeholder*="Specific customer requests"]').fill('Important notes that must be preserved on error');

    // Handle alert dialog
    let dialogMessage = '';
    page.on('dialog', async dialog => {
      dialogMessage = dialog.message();
      await dialog.accept();
    });

    // Inject temporary failure into localStorage for docgen_leads
    await page.evaluate(() => {
      (window as any).__originalSetItem = localStorage.setItem;
      let failedOnce = false;
      localStorage.setItem = function(key: string, val: string) {
        if (key === 'docgen_leads' && !failedOnce) {
          failedOnce = true;
          throw new Error('Simulated QuotaExceeded or Storage Error');
        }
        return (window as any).__originalSetItem.apply(this, arguments);
      };
    });

    const submitBtn = modal.locator('button[type="submit"]:has-text("Create & Save Lead")');
    await submitBtn.click();

    // Verify error occurred and dialog showed
    await page.waitForTimeout(500);

    // Verify modal remains open and inputs preserved
    await expect(modal).toBeVisible();
    await expect(modal.locator('input[placeholder*="Anand Menon"]')).toHaveValue('Resilient Lead User');
    await expect(modal.locator('input[placeholder*="Kalyan Silks"]')).toHaveValue('Retry Resilient Co');
    await expect(modal.locator('input[type="tel"]').first()).toHaveValue('9847556677');
    await expect(modal.locator('textarea[placeholder*="Specific customer requests"]')).toHaveValue('Important notes that must be preserved on error');

    // Retry save now that error condition cleared
    await submitBtn.click();
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Verify lead was created
    const savedRow = page.locator('table tbody tr', { hasText: 'Retry Resilient Co' });
    await expect(savedRow).toBeVisible();
  });

  test('enforces company profile tenant isolation (Leads for Company A never appear in Company B)', async ({ page }) => {
    await setupApp(page);
    await navigateToTab(page, 'leads');

    // 1. Create a lead under Company A (B2P International)
    await page.locator('button:has-text("New Lead Intake")').click();
    const modal = page.locator('.modal-content');
    await modal.locator('input[placeholder*="Anand Menon"]').fill('Company A Customer');
    await modal.locator('input[placeholder*="Kalyan Silks"]').fill('Alpha Corp Kochi');
    await modal.locator('input[type="tel"]').first().fill('9847111000');
    await modal.locator('button[type="submit"]:has-text("Create & Save Lead")').click();

    await expect(page.locator('table tbody tr', { hasText: 'Alpha Corp Kochi' })).toBeVisible();

    // 2. Switch active company to Company B (B2P Media Solutions)
    await switchCompanyProfile(page, COMPANY_B.name);

    // Navigate to Leads tab for Company B
    await navigateToTab(page, 'leads');

    // 3. Verify Lead from Company A is NOT visible in Company B
    const leakedLead = page.locator('table tbody tr', { hasText: 'Alpha Corp Kochi' });
    await expect(leakedLead).not.toBeVisible();

    // 4. Create a lead under Company B
    await page.locator('button:has-text("New Lead Intake")').click();
    const modalB = page.locator('.modal-content');
    await modalB.locator('input[placeholder*="Anand Menon"]').fill('Company B Customer');
    await modalB.locator('input[placeholder*="Kalyan Silks"]').fill('Beta Media Trivandrum');
    await modalB.locator('input[type="tel"]').first().fill('9847222000');
    await modalB.locator('button[type="submit"]:has-text("Create & Save Lead")').click();

    await expect(page.locator('table tbody tr', { hasText: 'Beta Media Trivandrum' })).toBeVisible();
    await expect(page.locator('table tbody tr', { hasText: 'Alpha Corp Kochi' })).not.toBeVisible();

    // 5. Switch back to Company A
    await switchCompanyProfile(page, COMPANY_A.name);
    await navigateToTab(page, 'leads');

    // Verify Company A has Alpha Corp Kochi and NOT Beta Media Trivandrum
    await expect(page.locator('table tbody tr', { hasText: 'Alpha Corp Kochi' })).toBeVisible();
    await expect(page.locator('table tbody tr', { hasText: 'Beta Media Trivandrum' })).not.toBeVisible();
  });

  test('rapid double-click on customer submit does not create duplicate customer records', async ({ page }) => {
    await setupApp(page);
    await navigateToTab(page, 'customers');

    await page.locator('button:has-text("Add Customer")').click();
    const modal = page.locator('.modal-content');
    await expect(modal).toBeVisible();

    await modal.locator('input[placeholder*="Malabar Gold"]').fill('Double Click Retailer');
    await modal.locator('input[type="tel"]').fill('9847888999');

    const submitBtn = modal.locator('button[type="submit"]:has-text("Save Customer")');
    await submitBtn.dblclick();

    await expect(modal).not.toBeVisible({ timeout: 5000 });

    const matchingRows = page.locator('table tbody tr', { hasText: 'Double Click Retailer' });
    expect(await matchingRows.count(), 'Rapid double-clicking save customer created duplicate records!').toBe(1);
  });
});
