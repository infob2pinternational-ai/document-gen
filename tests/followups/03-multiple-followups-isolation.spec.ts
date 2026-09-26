import { test, expect } from '@playwright/test';
import { setupApp, navigateToTab, COMPANY_A } from '../helpers/crm-test-helpers';

test.describe('Follow-ups — Multiple Follow-ups per Lead & Modification Isolation', () => {
  test('creating 2 follow-ups for same lead; completing #1 keeps #2 strictly pending and updates lead drawer next follow-up', async ({ page }) => {
    const today = '2026-09-26';
    const futureDate = '2026-10-05';

    const TEST_LEAD = {
      id: 'lead-multi-fu-01',
      lead_number: 'B2P-LD-1055',
      company_id: COMPANY_A.id,
      customer_name: 'Harikrishnan Namboothiri',
      company_name: 'Guruvayur Devaswom Catering',
      phone: '9847119988',
      location: 'Thrissur',
      service_required: '3 Side LED Van',
      priority: 'HOT',
      status: 'requirement_collected',
      assigned_telecaller_email: 'fransonputhukkara@gmail.com',
      created_at: '2026-09-20T10:00:00.000Z'
    };

    await setupApp(page, { leads: [TEST_LEAD], handleDialogs: false });

    // 1. Create Follow-up #1 for this lead (due today)
    await navigateToTab(page, 'follow-ups');
    await page.locator('button:has-text("Schedule Follow-up")').click();
    let modal = page.locator('.modal-content');
    await expect(modal).toBeVisible();

    // Link to TEST_LEAD
    const leadSelect = modal.locator('select', { has: page.locator('option[value="lead-multi-fu-01"]') });
    await leadSelect.selectOption('lead-multi-fu-01');

    await modal.locator('input[type="date"]').fill(today);
    await modal.locator('input[type="time"]').fill('10:00');
    await modal.locator('input[placeholder*="Review quotation details"]').fill('Follow-up #1: Initial quotation discussion');
    await modal.locator('button[type="submit"]:has-text("Save Task")').click();
    await expect(modal).not.toBeVisible();

    // 2. Create Follow-up #2 for the same lead (due in future)
    await page.locator('button:has-text("Schedule Follow-up")').click();
    modal = page.locator('.modal-content');
    await expect(modal).toBeVisible();

    await modal.locator('select', { has: page.locator('option[value="lead-multi-fu-01"]') }).selectOption('lead-multi-fu-01');
    await modal.locator('input[type="date"]').fill(futureDate);
    await modal.locator('input[type="time"]').fill('16:00');
    await modal.locator('input[placeholder*="Review quotation details"]').fill('Follow-up #2: Final booking confirmation & driver allocation');
    await modal.locator('button[type="submit"]:has-text("Save Task")').click();
    await expect(modal).not.toBeVisible();

    // 3. Verify both follow-ups appear in 'All Tasks' tab linked to B2P-LD-1055
    await page.locator('.glass-panel button:has-text("All Tasks")').click();
    await expect(page.locator('table tbody tr')).toHaveCount(2);

    const fu1Row = page.locator('table tbody tr', { hasText: 'Follow-up #1' });
    const fu2Row = page.locator('table tbody tr', { hasText: 'Follow-up #2' });

    await expect(fu1Row).toBeVisible();
    await expect(fu1Row).toContainText('B2P-LD-1055');
    await expect(fu2Row).toBeVisible();
    await expect(fu2Row).toContainText('B2P-LD-1055');

    // 4. Check Lead Detail Drawer: 'Next Follow-up Scheduled' should point to Follow-up #1 (earliest)
    await navigateToTab(page, 'leads');
    const leadRow = page.locator('table tbody tr', { hasText: 'Guruvayur Devaswom Catering' });
    await leadRow.click();

    const drawer = page.locator('.drawer-content');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('Next Follow-up Scheduled');
    await expect(drawer).toContainText(today);
    await expect(drawer).toContainText('Follow-up #1: Initial quotation discussion');

    await drawer.locator('button[title="Close Drawer"]').click();

    // 5. Complete Follow-up #1
    await navigateToTab(page, 'follow-ups');
    page.on('dialog', async dialog => {
      await dialog.accept('Call completed. Client agreed to review quote.');
    });

    await page.locator('.glass-panel button:has-text("All Tasks")').click();
    await page.locator('table tbody tr', { hasText: 'Follow-up #1' }).locator('button:has-text("Done")').click();

    // 6. CRITICAL VERIFICATION: Follow-up #1 is Completed, Follow-up #2 MUST REMAIN PENDING!
    await page.locator('.glass-panel button:has-text("All Tasks")').click();
    const completedFU1 = page.locator('table tbody tr', { hasText: 'Follow-up #1' });
    const pendingFU2 = page.locator('table tbody tr', { hasText: 'Follow-up #2' });

    await expect(completedFU1).toContainText('Completed');
    await expect(completedFU1).toContainText('Outcome: Call completed. Client agreed to review quote.');

    // Follow-up #2 must NOT be marked completed or modified!
    await expect(pendingFU2).toContainText('Scheduled');
    await expect(pendingFU2).toContainText(futureDate.split('-').reverse().join('/'));
    await expect(pendingFU2.locator('button:has-text("Done")')).toBeVisible();

    // 7. Verify Lead Detail Drawer now points to Follow-up #2 as next follow-up
    await navigateToTab(page, 'leads');
    await page.locator('table tbody tr', { hasText: 'Guruvayur Devaswom Catering' }).click();

    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('Next Follow-up Scheduled');
    await expect(drawer).toContainText(futureDate);
    await expect(drawer).toContainText('Follow-up #2: Final booking confirmation');

    // Verify activity timeline has Follow-up Completed entry for #1
    await expect(drawer.locator('.drawer-body')).toContainText('Follow-up Completed');
  });
});
