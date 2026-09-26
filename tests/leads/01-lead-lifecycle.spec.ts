import { test, expect } from '@playwright/test';
import { setupApp, navigateToTab, COMPANY_A } from '../helpers/crm-test-helpers';

test.describe('Leads — Lifecycle & Persistence', () => {
  test('creates a new lead, verifies display, refreshes for persistence, and edits record', async ({ page }) => {
    // 1. Setup clean app
    await setupApp(page);
    await navigateToTab(page, 'leads');

    // Verify empty state or header
    await expect(page.locator('h1:has-text("Leads Pipeline Management")')).toBeVisible();

    // 2. Open New Lead Intake Modal
    await page.locator('button:has-text("New Lead Intake")').click();
    await expect(page.locator('.modal-content:has-text("New Lead Intake Form")')).toBeVisible();

    // 3. Fill Lead details
    await page.locator('input[placeholder*="Kalyan Silks"]').fill('Malabar Gold & Diamonds');
    await page.locator('input[placeholder*="Anand Menon"]').fill('Rahul Varma');
    // First tel input is Phone
    await page.locator('input[type="tel"]').first().fill('9847123456');
    // Sub-district (click type custom if select is shown)
    const typeCustomBtn = page.locator('button:has-text("Type custom")').first();
    if (await typeCustomBtn.isVisible()) {
      await typeCustomBtn.click();
    }
    const subDistrictInput = page.locator('input[placeholder*="Chalakudy"]');
    if (await subDistrictInput.isVisible()) {
      await subDistrictInput.fill('Chalakudy');
    }

    // Requirements & Priority
    await page.locator('input[placeholder*="Thrissur Round"]').fill('Thrissur Swaraj Round Campaign');
    await page.locator('.modal-content button:has-text("HOT")').click();

    // Notes
    await page.locator('textarea[placeholder*="Specific customer requests"]').fill('Client requires 3-side LED van for 3 days Onam campaign.');

    // 4. Submit Lead
    await page.locator('button[type="submit"]:has-text("Create & Save Lead")').click();

    // 5. Verify Lead appears in Table
    const leadRow = page.locator('table tbody tr', { hasText: 'Malabar Gold & Diamonds' });
    await expect(leadRow).toBeVisible({ timeout: 5000 });
    await expect(leadRow).toContainText('Rahul Varma');
    await expect(leadRow).toContainText('9847123456');
    await expect(leadRow).toContainText('HOT');
    await expect(leadRow).toContainText('New');

    // Get assigned lead number (e.g. B2P-LD-1001)
    const leadNumberCell = leadRow.locator('td.mono').first();
    const leadNumber = (await leadNumberCell.textContent())?.trim();
    expect(leadNumber).toMatch(/^B2P-LD-\d+$/);

    // 6. Refresh page and verify persistence across browser reload (Phase 2 #1)
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await navigateToTab(page, 'leads');

    const persistedRow = page.locator('table tbody tr', { hasText: 'Malabar Gold & Diamonds' });
    await expect(persistedRow).toBeVisible({ timeout: 5000 });
    await expect(persistedRow).toContainText('Rahul Varma');
    await expect(persistedRow).toContainText(leadNumber!);

    // 7. Open Lead Detail Drawer
    await persistedRow.click();
    const drawer = page.locator('.drawer-content');
    await expect(drawer).toBeVisible({ timeout: 5000 });
    await expect(drawer.locator('h2')).toContainText('Malabar Gold & Diamonds');
    await expect(drawer).toContainText('Rahul Varma');
    await expect(drawer).toContainText('9847123456');
    await expect(drawer).toContainText('Thrissur Swaraj Round Campaign');
    await expect(drawer).toContainText('Client requires 3-side LED van for 3 days Onam campaign.');

    // Close drawer
    await drawer.locator('button[title="Close Drawer"]').click();
    await expect(drawer).not.toBeVisible();

    // 8. Edit the Lead
    const editBtn = page.locator('table tbody tr', { hasText: 'Malabar Gold & Diamonds' }).locator('button[title="Edit Lead"]');
    await editBtn.click();

    const editModal = page.locator('.modal-content');
    await expect(editModal).toBeVisible();
    await expect(editModal.locator('h2')).toContainText('Edit Lead');

    // Update Company Name, Contact Person, Priority to WARM
    await editModal.locator('input[placeholder*="Kalyan Silks"]').fill('Malabar Gold International');
    await editModal.locator('input[placeholder*="Anand Menon"]').fill('Rahul Varma (Director)');
    await editModal.locator('button:has-text("WARM")').click();
    await editModal.locator('button[type="submit"]:has-text("Update Lead Record")').click();

    // 9. Verify updated values in Table
    const updatedRow = page.locator('table tbody tr', { hasText: 'Malabar Gold International' });
    await expect(updatedRow).toBeVisible({ timeout: 5000 });
    await expect(updatedRow).toContainText('Rahul Varma (Director)');
    await expect(updatedRow).toContainText('WARM');

    // 10. Reload again and verify edited record persistence
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await navigateToTab(page, 'leads');

    const finalRow = page.locator('table tbody tr', { hasText: 'Malabar Gold International' });
    await expect(finalRow).toBeVisible({ timeout: 5000 });
    await expect(finalRow).toContainText('Rahul Varma (Director)');
    await expect(finalRow).toContainText('WARM');
  });
});
