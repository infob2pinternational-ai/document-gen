import { test, expect } from '@playwright/test';
import { setupApp, navigateToTab, COMPANY_A } from '../helpers/crm-test-helpers';

function getISTDate(dayOffset = 0): string {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const istDate = new Date(utc + (3600000 * 5.5));
  istDate.setDate(istDate.getDate() + dayOffset);
  const y = istDate.getFullYear();
  const m = String(istDate.getMonth() + 1).padStart(2, '0');
  const d = String(istDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

test.describe('Follow-ups — Real Browser Stability & Scroll Position Suite', () => {
  const todayStr = getISTDate(0);
  const yesterdayStr = getISTDate(-1);

  // Generate 50 items for Due Today sharing identical due_date and due_time
  const todayTasks = Array.from({ length: 50 }, (_, i) => ({
    id: `fu-today-${String(i + 1).padStart(3, '0')}`,
    company_id: COMPANY_A.id,
    customer_name: `Today Customer ${String(i + 1).padStart(3, '0')}`,
    company_name: `Company ${String(i + 1).padStart(3, '0')}`,
    phone: `9847000${String(i + 1).padStart(3, '0')}`,
    due_date: todayStr,
    due_time: '10:00',
    reason: `Review follow-up #${i + 1}`,
    status: 'PENDING',
    assigned_staff_email: 'staff@b2p.com',
    created_by_email: 'owner@b2p.com',
    created_at: `2026-10-01T08:${String(i % 60).padStart(2, '0')}:00.000Z`
  }));

  // Generate 20 items for Overdue sharing identical due_date and due_time
  const overdueTasks = Array.from({ length: 20 }, (_, i) => ({
    id: `fu-overdue-${String(i + 1).padStart(3, '0')}`,
    company_id: COMPANY_A.id,
    customer_name: `Overdue Customer ${String(i + 1).padStart(3, '0')}`,
    company_name: `Overdue Co ${String(i + 1).padStart(3, '0')}`,
    phone: `9848000${String(i + 1).padStart(3, '0')}`,
    due_date: yesterdayStr,
    due_time: '10:00',
    reason: `Payment overdue follow-up #${i + 1}`,
    status: 'PENDING',
    assigned_staff_email: 'staff@b2p.com',
    created_by_email: 'owner@b2p.com',
    created_at: `2026-09-25T08:${String(i % 60).padStart(2, '0')}:00.000Z`
  }));

  const ALL_TASKS = [...todayTasks, ...overdueTasks];

  test('Due Today & Overdue lists do not shuffle during refreshes, tab switching, and follow-up updates', async ({ page }) => {
    // Ensure dialog prompts are automatically filled with outcome notes
    page.on('dialog', async dialog => {
      try {
        await dialog.accept('Client requirement updated successfully.');
      } catch (e) {}
    });

    // 1. Initialize app with 50 Due Today and 20 Overdue records
    await setupApp(page, { followUps: ALL_TASKS, handleDialogs: false });
    await navigateToTab(page, 'follow-ups');

    await expect(page.locator('h1:has-text("Follow-ups & Client Reminders")')).toBeVisible();

    // Verify Tab Badges
    const todayTab = page.locator('button:has-text("Due Today")');
    await expect(todayTab).toBeVisible();
    await expect(todayTab.locator('.mono')).toHaveText('50');

    const overdueTab = page.locator('button:has-text("Overdue")');
    await expect(overdueTab).toBeVisible();
    await expect(overdueTab.locator('.mono')).toHaveText('20');

    // 2. Capture baseline order of all 50 Due Today rows
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(50);

    const baselineIds: string[] = await page.evaluate(() => {
      const trs = Array.from(document.querySelectorAll('table tbody tr'));
      return trs.map(tr => tr.getAttribute('data-followup-id') || '');
    });
    expect(baselineIds.length).toBe(50);
    expect(baselineIds[0]).toBeTruthy();

    // 3. Simulate background refresh interval (30-second polling) multiple times
    for (let cycle = 1; cycle <= 3; cycle++) {
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('docgen_metrics_changed'));
      });
      await page.waitForTimeout(400);

      const currentIds = await page.evaluate(() => {
        const trs = Array.from(document.querySelectorAll('table tbody tr'));
        return trs.map(tr => tr.getAttribute('data-followup-id') || '');
      });

      expect(currentIds).toEqual(baselineIds);
    }

    // 4. Test Scroll Position & Active Follow-up Row Retention
    // Scroll down to row #30 and click to activate
    const row30 = page.locator('table tbody tr').nth(29);
    await row30.scrollIntoViewIfNeeded();
    await row30.click();

    const activeIdBefore = await page.evaluate(() => {
      const active = Array.from(document.querySelectorAll('table tbody tr')).find(tr => 
        (tr as HTMLElement).style.borderLeft.includes('var(--brand-navy)')
      );
      return active?.getAttribute('data-followup-id') || '';
    });
    expect(activeIdBefore).toBe(baselineIds[29]);

    const scrollTopBefore = await page.evaluate(() => {
      const container = document.querySelector('.table-container') || document.documentElement;
      return container.scrollTop || window.scrollY;
    });
    expect(scrollTopBefore).toBeGreaterThan(0);

    // Trigger background refresh while scrolled down
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('docgen_metrics_changed'));
    });
    await page.waitForTimeout(500);

    // Verify row #30 is still visible in the viewport and order is unchanged
    await expect(row30).toBeInViewport();
    const currentIdsAfterScrollRefresh = await page.evaluate(() => {
      const trs = Array.from(document.querySelectorAll('table tbody tr'));
      return trs.map(tr => tr.getAttribute('data-followup-id') || '');
    });
    expect(currentIdsAfterScrollRefresh).toEqual(baselineIds);

    // 5. Test Tab Switching (switching to another browser tab / visibilitychange)
    await page.evaluate(() => {
      // Simulate tab blur / hide
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      // Simulate tab focus / visible return
      Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await page.waitForTimeout(500);

    // Verify list order and active row retention after tab return
    const idsAfterTabSwitch = await page.evaluate(() => {
      const trs = Array.from(document.querySelectorAll('table tbody tr'));
      return trs.map(tr => tr.getAttribute('data-followup-id') || '');
    });
    expect(idsAfterTabSwitch).toEqual(baselineIds);
    await expect(row30).toBeInViewport();

    // 6. Test Follow-Up Action: Complete a task in Due Today
    // Complete row #10 using the "Done" quick action button
    const row10 = page.locator('table tbody tr').nth(9);
    const completedTaskId = baselineIds[9];
    await row10.locator('button:has-text("Done")').click();
    await page.waitForTimeout(400);

    // Verify Due Today row count decreased to 49
    await expect(page.locator('table tbody tr')).toHaveCount(49);
    await expect(todayTab.locator('.mono')).toHaveText('49');

    // Verify the relative order of ALL 49 remaining records is perfectly preserved
    const remainingIds = await page.evaluate(() => {
      const trs = Array.from(document.querySelectorAll('table tbody tr'));
      return trs.map(tr => tr.getAttribute('data-followup-id') || '');
    });
    const expectedRemaining = baselineIds.filter(id => id !== completedTaskId);
    expect(remainingIds).toEqual(expectedRemaining);

    // 7. Test Overdue List Stability
    await overdueTab.click();
    await page.waitForTimeout(300);

    const overdueRows = page.locator('table tbody tr');
    await expect(overdueRows).toHaveCount(20);

    const overdueBaselineIds: string[] = await page.evaluate(() => {
      const trs = Array.from(document.querySelectorAll('table tbody tr'));
      return trs.map(tr => tr.getAttribute('data-followup-id') || '');
    });
    expect(overdueBaselineIds.length).toBe(20);

    // Trigger background refresh in Overdue tab
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('docgen_metrics_changed'));
    });
    await page.waitForTimeout(400);

    const overdueIdsAfterRefresh = await page.evaluate(() => {
      const trs = Array.from(document.querySelectorAll('table tbody tr'));
      return trs.map(tr => tr.getAttribute('data-followup-id') || '');
    });
    expect(overdueIdsAfterRefresh).toEqual(overdueBaselineIds);

    // Complete an overdue task
    const overdueRow1 = overdueRows.first();
    const completedOverdueId = overdueBaselineIds[0];
    await overdueRow1.locator('button:has-text("Done")').click();
    await page.waitForTimeout(400);

    await expect(page.locator('table tbody tr')).toHaveCount(19);
    await expect(overdueTab.locator('.mono')).toHaveText('19');

    const remainingOverdueIds = await page.evaluate(() => {
      const trs = Array.from(document.querySelectorAll('table tbody tr'));
      return trs.map(tr => tr.getAttribute('data-followup-id') || '');
    });
    expect(remainingOverdueIds).not.toContain(completedOverdueId);
    expect(remainingOverdueIds).toEqual(overdueBaselineIds.slice(1));
  });
});
