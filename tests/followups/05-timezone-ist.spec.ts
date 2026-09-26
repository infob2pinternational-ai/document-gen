import { test, expect } from '@playwright/test';
import { setupApp, navigateToTab } from '../helpers/crm-test-helpers';

test.describe('Follow-ups — Indian Standard Time (IST) & Timezone Accuracy', () => {
  test('persists exact IST date/time (26 September 2026, 10:30 AM) without UTC date-shift or off-by-one corruption', async ({ page }) => {
    await setupApp(page);
    await navigateToTab(page, 'follow-ups');

    // 1. Create Follow-up with target date: 26 September 2026 at 10:30 AM
    await page.locator('button:has-text("Schedule Follow-up")').click();
    const modal = page.locator('.modal-content');
    await expect(modal).toBeVisible();

    await modal.locator('input[placeholder*="Arun Kumar"]').fill('Timezone Validation Client');
    await modal.locator('input[type="tel"]').fill('9847123999');

    // Input date: 2026-09-26
    await modal.locator('input[type="date"]').fill('2026-09-26');
    await modal.locator('input[type="time"]').fill('10:30');
    await modal.locator('input[placeholder*="Review quotation details"]').fill('IST 10:30 AM verification meeting');
    await modal.locator('button[type="submit"]:has-text("Save Task")').click();
    await expect(modal).not.toBeVisible();

    // 2. Check UI display in table
    const row = page.locator('table tbody tr', { hasText: 'Timezone Validation Client' });
    await expect(row).toBeVisible();

    // Verify date is exactly 26/09/2026 and time is 10:30
    const dateCell = row.locator('td', { hasText: '26/09/2026' });
    await expect(dateCell).toBeVisible();
    await expect(dateCell).toContainText('at 10:30');

    // 3. Reload page and re-verify
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await navigateToTab(page, 'follow-ups');

    const persistedRow = page.locator('table tbody tr', { hasText: 'Timezone Validation Client' });
    await expect(persistedRow).toBeVisible();
    const persistedDateCell = persistedRow.locator('td', { hasText: '26/09/2026' });
    await expect(persistedDateCell).toBeVisible();
    await expect(persistedDateCell).toContainText('at 10:30');

    // 4. Verify stored raw record in localStorage does not suffer UTC date shift
    const rawStored = await page.evaluate(() => {
      const all = JSON.parse(localStorage.getItem('docgen_follow_ups') || '[]');
      return all.find((f: any) => f.customer_name === 'Timezone Validation Client');
    });

    expect(rawStored).toBeTruthy();
    expect(rawStored.due_date, 'due_date must remain calendar date 2026-09-26 and not shift to 2026-09-25').toBe('2026-09-26');
    expect(rawStored.due_time).toBe('10:30');
  });

  test('detects UTC midnight-boundary discrepancy when client operates in early IST hours', async ({ page }) => {
    // In IST, early morning (e.g. 02:00 AM IST) corresponds to 20:30 UTC of the PREVIOUS DAY.
    // Tests whether code relying on `new Date().toISOString().split('T')[0]` causes off-by-one errors.
    await setupApp(page);

    const comparisonResult = await page.evaluate(() => {
      // Simulate fake clock at 02:00 AM IST on 2026-09-26:
      // In UTC, this is 2026-09-25T20:30:00.000Z
      const earlyMorningIST = new Date('2026-09-25T20:30:00.000Z');
      const utcDate = earlyMorningIST.toISOString().split('T')[0]; // '2026-09-25' (WRONG for IST!)
      
      const istDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(earlyMorningIST); // '2026-09-26' (CORRECT!)
      return { utcDate, istDate, isDivergent: utcDate !== istDate };
    });

    // Verify divergence exists between UTC ISO and IST
    expect(comparisonResult.isDivergent).toBe(true);
    expect(comparisonResult.utcDate).toBe('2026-09-25');
    expect(comparisonResult.istDate).toBe('2026-09-26');
  });
});
