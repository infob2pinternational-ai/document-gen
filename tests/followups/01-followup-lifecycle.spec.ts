import { test, expect } from '@playwright/test';
import { setupApp, navigateToTab } from '../helpers/crm-test-helpers';

test.describe('Follow-ups — Creation, Persistence, and Editing', () => {
  test('creates a follow-up task, verifies table display, refreshes for persistence, and edits task', async ({ page }) => {
    await setupApp(page);
    await navigateToTab(page, 'follow-ups');

    await expect(page.locator('h1:has-text("Follow-ups & Client Reminders")')).toBeVisible();

    // 1. Open Schedule Follow-up Modal
    await page.locator('button:has-text("Schedule Follow-up")').click();
    const modal = page.locator('.modal-content');
    await expect(modal).toBeVisible();

    // 2. Fill Follow-up fields
    await modal.locator('input[placeholder*="Arun Kumar"]').fill('Suresh Gopi');
    await modal.locator('input[placeholder*="Kerala Grand Events"]').fill('Kalyan Jewellers Thrissur');
    await modal.locator('input[type="tel"]').fill('9847112233');

    // Due Date: Today (2026-09-26)
    const todayStr = '2026-09-26';
    await modal.locator('input[type="date"]').fill(todayStr);
    await modal.locator('input[type="time"]').fill('10:30');

    await modal.locator('input[placeholder*="Review quotation details"]').fill('Discuss revised 3-side LED van quotation & finalize advance');
    await modal.locator('textarea[placeholder*="Points to discuss"]').fill('Customer requested 5% discount on 3-day booking.');

    // 3. Save Follow-up
    await modal.locator('button[type="submit"]:has-text("Save Task")').click();

    // 4. Verify Task appears in Table
    const row = page.locator('table tbody tr', { hasText: 'Suresh Gopi' });
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(row).toContainText('Kalyan Jewellers Thrissur');
    await expect(row).toContainText('9847112233');
    await expect(row).toContainText('26/09/2026');
    await expect(row).toContainText('10:30');
    await expect(row).toContainText('Discuss revised 3-side LED van quotation');
    await expect(row).toContainText('Due Today');

    // 5. Refresh page and verify persistence across browser reload (Phase 2 #2)
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await navigateToTab(page, 'follow-ups');

    const persistedRow = page.locator('table tbody tr', { hasText: 'Suresh Gopi' });
    await expect(persistedRow).toBeVisible({ timeout: 5000 });
    await expect(persistedRow).toContainText('26/09/2026');
    await expect(persistedRow).toContainText('10:30');

    // 6. Edit the Follow-up Task
    await persistedRow.locator('button[title="Edit Task"]').click();
    const editModal = page.locator('.modal-content');
    await expect(editModal).toBeVisible();
    await expect(editModal.locator('h2')).toContainText('Edit Follow-up Task');

    // Change Due Date to tomorrow and update time and purpose
    const tomorrowStr = '2026-09-27';
    await editModal.locator('input[type="date"]').fill(tomorrowStr);
    await editModal.locator('input[type="time"]').fill('14:00');
    await editModal.locator('input[placeholder*="Review quotation details"]').fill('Final confirmation call for LED van campaign');
    await editModal.locator('button[type="submit"]:has-text("Update Task")').click();

    // 7. Verify Task updated in Upcoming tab (since due date is tomorrow)
    await page.locator('.glass-panel button:has-text("Upcoming")').click();
    const updatedRow = page.locator('table tbody tr', { hasText: 'Suresh Gopi' });
    await expect(updatedRow).toBeVisible({ timeout: 5000 });
    await expect(updatedRow).toContainText('27/09/2026');
    await expect(updatedRow).toContainText('14:00');
    await expect(updatedRow).toContainText('Final confirmation call for LED van campaign');
    await expect(updatedRow).toContainText('Scheduled');

    // 8. Refresh and verify edited task persists in Upcoming tab
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await navigateToTab(page, 'follow-ups');
    await page.locator('.glass-panel button:has-text("Upcoming")').click();

    const finalRow = page.locator('table tbody tr', { hasText: 'Suresh Gopi' });
    await expect(finalRow).toBeVisible({ timeout: 5000 });
    await expect(finalRow).toContainText('27/09/2026');
    await expect(finalRow).toContainText('14:00');
  });
});
