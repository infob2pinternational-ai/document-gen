import { test, expect } from '@playwright/test';
import { setupApp, navigateToTab, COMPANY_A } from '../helpers/crm-test-helpers';

test.describe('Follow-ups — Urgency Classification: Today, Overdue, Upcoming', () => {
  test('correctly categorizes follow-ups into Overdue, Today, and Upcoming tabs with accurate status badges', async ({ page }) => {
    // Current IST date in test run: 2026-09-26
    const today = '2026-09-26';
    const yesterday = '2026-09-25';
    const pastWeek = '2026-09-19';
    const tomorrow = '2026-09-27';
    const nextWeek = '2026-10-03';

    const TASKS = [
      {
        id: 'fu-overdue-1',
        company_id: COMPANY_A.id,
        customer_name: 'Overdue Client Yesterday',
        company_name: 'Yesterday Corp',
        phone: '9847111111',
        due_date: yesterday,
        due_time: '10:00',
        reason: 'Payment follow-up overdue by 1 day',
        status: 'PENDING',
        assigned_staff_email: 'fransonputhukkara@gmail.com',
        created_by_email: 'owner@b2p.com',
        created_at: '2026-09-24T10:00:00.000Z'
      },
      {
        id: 'fu-overdue-2',
        company_id: COMPANY_A.id,
        customer_name: 'Overdue Client Last Week',
        company_name: 'Last Week Ltd',
        phone: '9847222222',
        due_date: pastWeek,
        due_time: '11:00',
        reason: 'Quotation revision overdue by 1 week',
        status: 'PENDING',
        assigned_staff_email: 'sarathjohnpanengadan@gmail.com',
        created_by_email: 'owner@b2p.com',
        created_at: '2026-09-18T10:00:00.000Z'
      },
      {
        id: 'fu-today-1',
        company_id: COMPANY_A.id,
        customer_name: 'Today Client Morning',
        company_name: 'Morning Star Events',
        phone: '9847333333',
        due_date: today,
        due_time: '09:30',
        reason: 'Morning booking check',
        status: 'PENDING',
        assigned_staff_email: 'fransonputhukkara@gmail.com',
        created_by_email: 'owner@b2p.com',
        created_at: '2026-09-25T10:00:00.000Z'
      },
      {
        id: 'fu-today-2',
        company_id: COMPANY_A.id,
        customer_name: 'Today Client Afternoon',
        company_name: 'Afternoon Delight Caterers',
        phone: '9847444444',
        due_date: today,
        due_time: '15:00',
        reason: 'Afternoon contract signature',
        status: 'PENDING',
        assigned_staff_email: 'sivasatheesan33@gmail.com',
        created_by_email: 'owner@b2p.com',
        created_at: '2026-09-25T11:00:00.000Z'
      },
      {
        id: 'fu-upcoming-1',
        company_id: COMPANY_A.id,
        customer_name: 'Upcoming Client Tomorrow',
        company_name: 'Tomorrowland India',
        phone: '9847555555',
        due_date: tomorrow,
        due_time: '10:00',
        reason: 'LED wall technical spec check',
        status: 'PENDING',
        assigned_staff_email: 'brutf5354@gmail.com',
        created_by_email: 'owner@b2p.com',
        created_at: '2026-09-25T12:00:00.000Z'
      },
      {
        id: 'fu-upcoming-2',
        company_id: COMPANY_A.id,
        customer_name: 'Upcoming Client Next Week',
        company_name: 'Next Gen Exhibitions',
        phone: '9847666666',
        due_date: nextWeek,
        due_time: '14:00',
        reason: 'Post-event feedback call',
        status: 'PENDING',
        assigned_staff_email: 'fransonputhukkara@gmail.com',
        created_by_email: 'owner@b2p.com',
        created_at: '2026-09-25T13:00:00.000Z'
      }
    ];

    await setupApp(page, { followUps: TASKS });
    await navigateToTab(page, 'follow-ups');

    // 1. Due Today View: should contain exactly the 2 today tasks
    await page.locator('.glass-panel button:has-text("Due Today")').click();
    await expect(page.locator('table tbody tr')).toHaveCount(2);
    await expect(page.locator('table tbody tr', { hasText: 'Today Client Morning' })).toBeVisible();
    await expect(page.locator('table tbody tr', { hasText: 'Today Client Afternoon' })).toBeVisible();

    // Verify 'Due Today' yellow badges
    const todayBadges = page.locator('table tbody tr .badge-warning');
    await expect(todayBadges).toHaveCount(2);

    // 2. Overdue View: should contain exactly the 2 overdue tasks
    await page.locator('.glass-panel button:has-text("Overdue")').click();
    await expect(page.locator('table tbody tr')).toHaveCount(2);
    await expect(page.locator('table tbody tr', { hasText: 'Overdue Client Yesterday' })).toBeVisible();
    await expect(page.locator('table tbody tr', { hasText: 'Overdue Client Last Week' })).toBeVisible();

    // Verify 'Overdue' red badges
    const overdueBadges = page.locator('table tbody tr .badge-danger');
    await expect(overdueBadges).toHaveCount(2);

    // 3. Upcoming View: should contain exactly the 2 upcoming tasks
    await page.locator('.glass-panel button:has-text("Upcoming")').click();
    await expect(page.locator('table tbody tr')).toHaveCount(2);
    await expect(page.locator('table tbody tr', { hasText: 'Upcoming Client Tomorrow' })).toBeVisible();
    await expect(page.locator('table tbody tr', { hasText: 'Upcoming Client Next Week' })).toBeVisible();

    // Verify 'Scheduled' info badges
    const upcomingBadges = page.locator('table tbody tr .badge-info');
    await expect(upcomingBadges).toHaveCount(2);

    // 4. All Tasks View: should contain all 6 tasks
    await page.locator('.glass-panel button:has-text("All Tasks")').click();
    await expect(page.locator('table tbody tr')).toHaveCount(6);
  });
});
