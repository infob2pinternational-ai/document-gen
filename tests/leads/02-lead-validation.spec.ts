import { test, expect } from '@playwright/test';
import { setupApp, navigateToTab } from '../helpers/crm-test-helpers';

test.describe('Leads — Required Field Validation & Error Handling', () => {
  test('validates required fields: customer name, phone, and location', async ({ page }) => {
    await setupApp(page);
    await navigateToTab(page, 'leads');

    await page.locator('button:has-text("New Lead Intake")').click();
    const modal = page.locator('.modal-content');
    await expect(modal).toBeVisible();

    let dialogMessage = '';
    page.on('dialog', async dialog => {
      dialogMessage = dialog.message();
      await dialog.accept();
    });

    // 1. Submit empty form
    const submitBtn = modal.locator('button[type="submit"]:has-text("Create & Save Lead")');
    await submitBtn.click();

    // HTML5 validation or alert should trigger
    const nameInput = modal.locator('input[placeholder*="Anand Menon"]');
    const isNameInvalid = await nameInput.evaluate((el: HTMLInputElement) => !el.checkValidity());
    expect(isNameInvalid || dialogMessage.includes('customer name')).toBeTruthy();

    // 2. Fill Name only and submit
    await nameInput.fill('Test Customer');
    dialogMessage = '';
    await submitBtn.click();

    const phoneInput = modal.locator('input[type="tel"]').first();
    const isPhoneInvalid = await phoneInput.evaluate((el: HTMLInputElement) => !el.checkValidity());
    expect(isPhoneInvalid || dialogMessage.includes('phone')).toBeTruthy();

    // 3. Switch to custom location, leave it blank, and submit
    await phoneInput.fill('9847000000');
    // Switch to out of Kerala custom location
    await modal.locator('button:has-text("Out of Kerala / Other")').click();
    const customLocInput = modal.locator('input[placeholder*="Coimbatore"]');
    await customLocInput.fill('');
    dialogMessage = '';
    await submitBtn.click();

    const isLocInvalid = await customLocInput.evaluate((el: HTMLInputElement) => !el.checkValidity());
    expect(isLocInvalid || dialogMessage.includes('district') || dialogMessage.includes('city')).toBeTruthy();

    // 4. Verify no lead was created in storage or UI
    await modal.locator('button:has-text("Cancel")').click();
    await expect(page.locator('table tbody tr')).toHaveCount(0);
  });
});
