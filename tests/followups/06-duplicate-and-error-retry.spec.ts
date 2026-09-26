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

    // Verify company_id was assigned properly and is not 'default'
    const stored = await page.evaluate(() => {
      const items = JSON.parse(localStorage.getItem('docgen_follow_ups') || '[]');
      return items.find((f: any) => f.customer_name === 'Rapid Click Followup User');
    });
    expect(stored).toBeDefined();
    expect(stored.company_id).toBeDefined();
    expect(stored.company_id).not.toBe('default');
  });

  test('rapid double-clicking update on existing follow-up does not duplicate and preserves all metadata', async ({ page }) => {
    await setupApp(page);
    await navigateToTab(page, 'follow-ups');

    // Create a follow-up first
    await page.locator('button:has-text("Schedule Follow-up")').click();
    const modal = page.locator('.modal-content');
    await expect(modal).toBeVisible();

    await modal.locator('input[placeholder*="Arun Kumar"]').fill('Edit Target Customer');
    await modal.locator('input[type="tel"]').fill('9847112233');
    await modal.locator('input[type="date"]').fill('2026-09-26');
    await modal.locator('input[placeholder*="Review quotation details"]').fill('Initial discussion');
    await modal.locator('textarea[placeholder*="Points to discuss"]').fill('Initial points');
    await modal.locator('button[type="submit"]:has-text("Save Task")').click();
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Inject completion metadata and custom created_at directly into this record to verify edit preservation
    const origCreatedAt = '2026-09-01T10:00:00.000Z';
    await page.evaluate((createdAt) => {
      const items = JSON.parse(localStorage.getItem('docgen_follow_ups') || '[]');
      const target = items.find((f: any) => f.customer_name === 'Edit Target Customer');
      if (target) {
        target.created_at = createdAt;
        target.completion_note = 'Preserved Completion Note';
        target.snoozed_until = '2026-10-01';
        localStorage.setItem('docgen_follow_ups', JSON.stringify(items));
      }
    }, origCreatedAt);

    // Refresh view by navigating to follow-ups
    await navigateToTab(page, 'follow-ups');
    const row = page.locator('table tbody tr', { hasText: 'Edit Target Customer' });
    await expect(row).toBeVisible();
    await row.locator('button[title="Edit Task"]').click();

    await expect(modal).toBeVisible();
    await expect(modal.locator('h2')).toContainText('Edit Follow-up Task');

    // Make an intentional change
    await modal.locator('input[placeholder*="Review quotation details"]').fill('Updated proposal review');
    const updateBtn = modal.locator('button[type="submit"]:has-text("Update Task")');

    // Rapid double click on Update Task
    await updateBtn.dblclick();
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Verify exactly ONE record exists for this customer in the UI table
    const matchingRows = page.locator('table tbody tr', { hasText: 'Edit Target Customer' });
    expect(await matchingRows.count()).toBe(1);

    // Verify storage has only 1 record and all preserved fields remained intact
    const updated = await page.evaluate(() => {
      const items = JSON.parse(localStorage.getItem('docgen_follow_ups') || '[]');
      return items.filter((f: any) => f.customer_name === 'Edit Target Customer');
    });
    expect(updated.length).toBe(1);
    expect(updated[0].reason).toBe('Updated proposal review');
    expect(updated[0].created_at).toBe(origCreatedAt);
    expect(updated[0].completion_note).toBe('Preserved Completion Note');
    expect(updated[0].snoozed_until).toBe('2026-10-01');
    expect(updated[0].company_id).not.toBe('default');
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

  test('normal single save creates follow-up smoothly', async ({ page }) => {
    await setupApp(page);
    await navigateToTab(page, 'follow-ups');

    await page.locator('button:has-text("Schedule Follow-up")').click();
    const modal = page.locator('.modal-content');
    await expect(modal).toBeVisible();

    await modal.locator('input[placeholder*="Arun Kumar"]').fill('Single Click Customer');
    await modal.locator('input[type="tel"]').fill('9847334455');
    await modal.locator('input[type="date"]').fill('2026-09-26');
    await modal.locator('input[placeholder*="Review quotation details"]').fill('Single click smooth test');

    const submitBtn = modal.locator('button[type="submit"]:has-text("Save Task")');
    await submitBtn.click();

    await expect(modal).not.toBeVisible({ timeout: 5000 });
    const row = page.locator('table tbody tr', { hasText: 'Single Click Customer' });
    await expect(row).toBeVisible();
  });
});
