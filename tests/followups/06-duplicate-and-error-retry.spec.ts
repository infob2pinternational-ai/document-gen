import { test, expect } from '@playwright/test';
import { setupApp, navigateToTab } from '../helpers/crm-test-helpers';

test.describe('Follow-ups — Duplicate Prevention & Error/Retry Handling', () => {
  test('rapid double-clicking save does not create duplicate follow-up records', async ({ page }) => {
    await setupApp(page);
    await navigateToTab(page, 'follow-ups');

    await page.locator('button:has-text("Schedule Follow-up")').click();
    const modal = page.locator('.modal-content');
    await expect(modal).toBeVisible();

    await modal.locator('input[placeholder*="Arun Kumar"]').fill('Rapid Click Followup User');
    await modal.locator('input[type="tel"]').fill('9847661122');
    await modal.locator('input[type="date"]').fill('2026-09-26');
    await modal.locator('input[placeholder*="Review quotation details"]').fill('Rapid click duplicate test');

    const submitBtn = modal.locator('button[type="submit"]:has-text("Save Task")');

    // Simulate rapid double click
    await submitBtn.dblclick();

    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Verify exactly ONE record was created
    const rows = page.locator('table tbody tr', { hasText: 'Rapid Click Followup User' });
    const count = await rows.count();
    expect(count, 'Double click created duplicate follow-up records! Expected 1.').toBe(1);
  });

  test('failed save displays error, preserves entered inputs, and allows successful retry', async ({ page }) => {
    await setupApp(page, { handleDialogs: false });
    await navigateToTab(page, 'follow-ups');

    await page.locator('button:has-text("Schedule Follow-up")').click();
    const modal = page.locator('.modal-content');
    await expect(modal).toBeVisible();

    await modal.locator('input[placeholder*="Arun Kumar"]').fill('Retry Test Customer');
    await modal.locator('input[type="tel"]').fill('9847001122');
    await modal.locator('input[type="date"]').fill('2026-09-26');
    await modal.locator('input[placeholder*="Review quotation details"]').fill('Crucial contract negotiations');
    await modal.locator('textarea[placeholder*="Points to discuss"]').fill('Important preparation notes that must not be lost.');

    // Inject temporary failure into officeService.saveFollowUp
    let alertMessage = '';
    page.on('dialog', async dialog => {
      alertMessage = dialog.message();
      await dialog.accept();
    });

    await page.evaluate(() => {
      (window as any).__originalSetItem = localStorage.setItem;
      let failedOnce = false;
      localStorage.setItem = function(key: string, val: string) {
        if (key === 'docgen_follow_ups' && !failedOnce) {
          failedOnce = true;
          throw new Error('Simulated QuotaExceeded or Storage Error');
        }
        return (window as any).__originalSetItem.apply(this, arguments);
      };
    });

    // Attempt save which fails
    const submitBtn = modal.locator('button[type="submit"]:has-text("Save Task")');
    await submitBtn.click();

    // Verify error was reported to user
    await page.waitForTimeout(500);

    // Verify modal remains open and entered inputs are NOT lost
    await expect(modal).toBeVisible();
    await expect(modal.locator('input[placeholder*="Arun Kumar"]')).toHaveValue('Retry Test Customer');
    await expect(modal.locator('input[placeholder*="Review quotation details"]')).toHaveValue('Crucial contract negotiations');
    await expect(modal.locator('textarea[placeholder*="Points to discuss"]')).toHaveValue('Important preparation notes that must not be lost.');

    // Retry save now that failure has passed
    await submitBtn.click();
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Verify saved record exists in table
    const row = page.locator('table tbody tr', { hasText: 'Retry Test Customer' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Crucial contract negotiations');
  });
});
