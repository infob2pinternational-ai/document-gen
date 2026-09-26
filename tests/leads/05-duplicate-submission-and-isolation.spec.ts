import { test, expect } from '@playwright/test';
import { setupApp, navigateToTab, switchCompanyProfile, COMPANY_A, COMPANY_B } from '../helpers/crm-test-helpers';

test.describe('Leads — Duplicate Prevention & Multi-Tenant Company Isolation', () => {
  test('rapid double-click on lead submit does not create duplicate lead records', async ({ page }) => {
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
});
