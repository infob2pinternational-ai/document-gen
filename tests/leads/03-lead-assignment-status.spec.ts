import { test, expect } from '@playwright/test';
import { setupApp, navigateToTab } from '../helpers/crm-test-helpers';

test.describe('Leads — Assignment, Pipeline Stages & Activity Timeline', () => {
  test('assigns staff, steps through pipeline stages, hands over to Admin queue, and logs notes', async ({ page }) => {
    await setupApp(page);
    await navigateToTab(page, 'leads');

    // 1. Create a lead assigned to Franson Puthukkara
    await page.locator('button:has-text("New Lead Intake")').click();
    const modal = page.locator('.modal-content');
    await modal.locator('input[placeholder*="Anand Menon"]').fill('Vishnu Namboothiri');
    await modal.locator('input[placeholder*="Kalyan Silks"]').fill('Temple Festival Committee');
    await modal.locator('input[type="tel"]').first().fill('9847555666');
    await modal.locator('input[placeholder*="Thrissur Round"]').fill('Guruvayur Temple Road');

    // Select assigned telecaller: Franson Puthukkara
    const staffSelect = modal.locator('label:has-text("Assigned Staff") ~ select');
    await staffSelect.selectOption({ label: 'Franson Puthukkara (fransonputhukkara@gmail.com)' });

    await modal.locator('button[type="submit"]:has-text("Create & Save Lead")').click();

    // 2. Verify assigned staff in table
    const leadRow = page.locator('table tbody tr', { hasText: 'Temple Festival Committee' });
    await expect(leadRow).toBeVisible();
    await expect(leadRow).toContainText('Franson Puthukkara');
    await expect(leadRow).toContainText('New');

    // 3. Open Drawer to step through pipeline
    await leadRow.click();
    const drawer = page.locator('.drawer-content');
    await expect(drawer).toBeVisible();

    // Verify initial activity log has 'Lead Created'
    await expect(drawer.locator('.drawer-body')).toContainText('Lead Created');

    // 4. Click 'Calling' step (telecaller_working)
    await drawer.locator('.pipeline-step:has-text("Calling")').click();
    await expect(drawer.locator('.badge-info')).toContainText('telecaller working');

    // 5. Click 'Details collected' step (requirement_collected)
    await drawer.locator('.pipeline-step:has-text("Details collected")').click();
    await expect(drawer.locator('.badge-info')).toContainText('requirement collected');

    // 6. Test 'Send to Admin' handover flow
    const sendToAdminBtn = drawer.locator('button:has-text("Send to Admin")');
    await expect(sendToAdminBtn).toBeVisible();
    await sendToAdminBtn.click();

    // Fill handover instructions
    const handoverTextarea = drawer.locator('textarea[placeholder*="Specific instructions for admin"]');
    await expect(handoverTextarea).toBeVisible();
    await handoverTextarea.fill('Client confirmed 2-day LED Van campaign for festival procession. Please issue quotation for ₹45,000.');
    await drawer.locator('button:has-text("Confirm & Transfer")').click();

    // Status is now sent_to_admin
    await expect(drawer.locator('.badge-info')).toContainText('sent to admin');

    // Verify activity timeline updated with handover note
    await expect(drawer.locator('.drawer-body')).toContainText('Telecaller Handover');
    await expect(drawer.locator('.drawer-body')).toContainText('Client confirmed 2-day LED Van campaign');

    // 7. Add custom conversation note
    const noteInput = drawer.locator('input[placeholder*="Log customer conversation"]');
    await noteInput.fill('Called client to confirm route timings (4:00 PM to 9:00 PM).');
    await drawer.locator('button:has-text("Add Note")').click();

    // Verify custom note appeared in timeline
    await expect(drawer.locator('.drawer-body')).toContainText('Called client to confirm route timings');

    // 8. Close drawer and verify Admin Incoming Requirements Queue on main Leads page
    await drawer.locator('button[title="Close Drawer"]').click();
    const adminQueueBanner = page.locator('.glass-panel:has-text("Incoming Requirements — Admin Queue")');
    await expect(adminQueueBanner).toBeVisible();
    await expect(adminQueueBanner).toContainText('Temple Festival Committee');
    await expect(adminQueueBanner).toContainText('Vishnu Namboothiri');
  });
});
