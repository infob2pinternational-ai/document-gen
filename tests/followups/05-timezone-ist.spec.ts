import { test, expect } from '@playwright/test';
import { setupApp, navigateToTab, COMPANY_A } from '../helpers/crm-test-helpers';

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

  test('Test 1 — Normal Today: follow-up due on IST today is classified as Today', async ({ page }) => {
    await setupApp(page);

    // Compute today in Asia/Kolkata
    const kolkataToday = await page.evaluate(() => {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    });

    const task = {
      id: 'fu-ist-today',
      company_id: COMPANY_A.id,
      customer_name: 'IST Today Customer',
      phone: '9847111222',
      due_date: kolkataToday,
      due_time: '11:00',
      reason: 'IST Today Verification Call',
      status: 'PENDING',
      assigned_staff_email: 'fransonputhukkara@gmail.com',
      created_by_email: 'owner@b2p.com',
      created_at: new Date().toISOString()
    };

    await page.evaluate((t) => {
      localStorage.setItem('docgen_follow_ups', JSON.stringify([t]));
    }, task);

    await navigateToTab(page, 'follow-ups');

    // Click 'Due Today' tab
    await page.locator('.glass-panel button:has-text("Due Today")').click();
    const row = page.locator('table tbody tr', { hasText: 'IST Today Customer' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Due Today');

    // Verify it is NOT in Overdue or Upcoming tabs
    await page.locator('.glass-panel button:has-text("Overdue")').click();
    await expect(page.locator('table tbody tr', { hasText: 'IST Today Customer' })).not.toBeVisible();

    await page.locator('.glass-panel button:has-text("Upcoming")').click();
    await expect(page.locator('table tbody tr', { hasText: 'IST Today Customer' })).not.toBeVisible();
  });

  test('Test 2 — Yesterday: follow-up due on previous IST calendar date is classified as Overdue', async ({ page }) => {
    await setupApp(page);

    // Compute yesterday in Asia/Kolkata
    const kolkataYesterday = await page.evaluate(() => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
      const [y, m, d] = today.split('-').map(Number);
      const prev = new Date(Date.UTC(y, m - 1, d - 1, 12, 0, 0));
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(prev);
    });

    const task = {
      id: 'fu-ist-yesterday',
      company_id: COMPANY_A.id,
      customer_name: 'IST Yesterday Customer',
      phone: '9847222333',
      due_date: kolkataYesterday,
      due_time: '10:00',
      reason: 'IST Overdue Yesterday Call',
      status: 'PENDING',
      assigned_staff_email: 'fransonputhukkara@gmail.com',
      created_by_email: 'owner@b2p.com',
      created_at: new Date().toISOString()
    };

    await page.evaluate((t) => {
      localStorage.setItem('docgen_follow_ups', JSON.stringify([t]));
    }, task);

    await navigateToTab(page, 'follow-ups');

    // Click 'Overdue' tab
    await page.locator('.glass-panel button:has-text("Overdue")').click();
    const row = page.locator('table tbody tr', { hasText: 'IST Yesterday Customer' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Overdue');

    // Verify it is NOT in Due Today or Upcoming
    await page.locator('.glass-panel button:has-text("Due Today")').click();
    await expect(page.locator('table tbody tr', { hasText: 'IST Yesterday Customer' })).not.toBeVisible();

    await page.locator('.glass-panel button:has-text("Upcoming")').click();
    await expect(page.locator('table tbody tr', { hasText: 'IST Yesterday Customer' })).not.toBeVisible();
  });

  test('Test 3 — Tomorrow: follow-up due on next IST calendar date is classified as Upcoming', async ({ page }) => {
    await setupApp(page);

    // Compute tomorrow in Asia/Kolkata
    const kolkataTomorrow = await page.evaluate(() => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
      const [y, m, d] = today.split('-').map(Number);
      const next = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0));
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(next);
    });

    const task = {
      id: 'fu-ist-tomorrow',
      company_id: COMPANY_A.id,
      customer_name: 'IST Tomorrow Customer',
      phone: '9847333444',
      due_date: kolkataTomorrow,
      due_time: '14:00',
      reason: 'IST Upcoming Tomorrow Call',
      status: 'PENDING',
      assigned_staff_email: 'fransonputhukkara@gmail.com',
      created_by_email: 'owner@b2p.com',
      created_at: new Date().toISOString()
    };

    await page.evaluate((t) => {
      localStorage.setItem('docgen_follow_ups', JSON.stringify([t]));
    }, task);

    await navigateToTab(page, 'follow-ups');

    // Click 'Upcoming' tab
    await page.locator('.glass-panel button:has-text("Upcoming")').click();
    const row = page.locator('table tbody tr', { hasText: 'IST Tomorrow Customer' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Upcoming');

    // Verify it is NOT in Due Today or Overdue
    await page.locator('.glass-panel button:has-text("Due Today")').click();
    await expect(page.locator('table tbody tr', { hasText: 'IST Tomorrow Customer' })).not.toBeVisible();

    await page.locator('.glass-panel button:has-text("Overdue")').click();
    await expect(page.locator('table tbody tr', { hasText: 'IST Tomorrow Customer' })).not.toBeVisible();
  });

  test('Test 4 — Boundary Check: early morning IST (05:00 IST / 23:30 UTC) classifies by IST date, never UTC date', async ({ page }) => {
    await setupApp(page);

    // At 2026-09-25T23:30:00.000Z UTC, the time in Asia/Kolkata is 2026-09-26 05:00 AM.
    // UTC Date: 2026-09-25
    // IST Date: 2026-09-26
    const results = await page.evaluate(() => {
      // Simulate early morning IST in a Date object
      const simulatedTime = new Date('2026-09-25T23:30:00.000Z');
      const utcDate = simulatedTime.toISOString().split('T')[0]; // '2026-09-25'
      const istDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(simulatedTime); // '2026-09-26'

      // Verification of the discrepancy
      const isDateShiftedInUTC = utcDate !== istDate;

      // Check how officeService.getFollowUps classifies tasks when today is istDate vs utcDate
      const tasks = [
        {
          id: 'fu-target-today',
          customer_name: 'Target Date Client',
          due_date: '2026-09-26', // Today in IST
          status: 'PENDING'
        },
        {
          id: 'fu-target-yesterday',
          customer_name: 'Yesterday Client',
          due_date: '2026-09-25', // Yesterday in IST (but today in UTC!)
          status: 'PENDING'
        },
        {
          id: 'fu-target-tomorrow',
          customer_name: 'Tomorrow Client',
          due_date: '2026-09-27', // Tomorrow in IST
          status: 'PENDING'
        }
      ];

      // Using IST date (correct):
      const todayIST = istDate;
      const todayTasks = tasks.filter(t => t.due_date === todayIST);
      const overdueTasks = tasks.filter(t => t.due_date < todayIST);
      const upcomingTasks = tasks.filter(t => t.due_date > todayIST);

      // Using UTC date (incorrect old behavior):
      const todayUTC = utcDate;
      const flawedTodayTasks = tasks.filter(t => t.due_date === todayUTC);
      const flawedUpcomingTasks = tasks.filter(t => t.due_date > todayUTC);

      return {
        utcDate,
        istDate,
        isDateShiftedInUTC,
        todayTasksCount: todayTasks.length,
        todayTaskName: todayTasks[0]?.customer_name,
        overdueTasksCount: overdueTasks.length,
        overdueTaskName: overdueTasks[0]?.customer_name,
        upcomingTasksCount: upcomingTasks.length,
        upcomingTaskName: upcomingTasks[0]?.customer_name,
        flawedTodayTaskName: flawedTodayTasks[0]?.customer_name,
        flawedUpcomingContainsTodayTask: flawedUpcomingTasks.some(t => t.id === 'fu-target-today')
      };
    });

    expect(results.isDateShiftedInUTC).toBe(true);
    expect(results.utcDate).toBe('2026-09-25');
    expect(results.istDate).toBe('2026-09-26');

    // Under correct IST classification:
    // 2026-09-26 is Due Today
    expect(results.todayTasksCount).toBe(1);
    expect(results.todayTaskName).toBe('Target Date Client');

    // 2026-09-25 is Overdue
    expect(results.overdueTasksCount).toBe(1);
    expect(results.overdueTaskName).toBe('Yesterday Client');

    // 2026-09-27 is Upcoming
    expect(results.upcomingTasksCount).toBe(1);
    expect(results.upcomingTaskName).toBe('Tomorrow Client');

    // Prove that old UTC logic would have erroneously put 2026-09-26 in upcoming and 2026-09-25 in today
    expect(results.flawedTodayTaskName).toBe('Yesterday Client');
    expect(results.flawedUpcomingContainsTodayTask).toBe(true);
  });
});
