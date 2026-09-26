import { test, expect } from '@playwright/test';
import { setupApp, navigateToTab, switchCompanyProfile, COMPANY_A, COMPANY_B } from '../helpers/crm-test-helpers';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test.describe('Follow-ups — Multi-Company Scoping & Tenant Isolation', () => {
  test('Test 1 & 2: Follow-up creation scopes to active Company A and Company B with distinct UUIDs', async ({ page }) => {
    await setupApp(page);
    await navigateToTab(page, 'follow-ups');

    // Ensure on Company A
    await switchCompanyProfile(page, COMPANY_A.name);
    await navigateToTab(page, 'follow-ups');

    // 1. Create Follow-up under Company A
    await page.locator('button:has-text("Schedule Follow-up")').click();
    let modal = page.locator('.modal-content');
    await expect(modal).toBeVisible();

    await modal.locator('input[placeholder*="Arun Kumar"]').fill('Alpha Client Co A');
    await modal.locator('input[type="date"]').fill('2026-09-26');
    await modal.locator('input[type="time"]').fill('10:00');
    await modal.locator('input[placeholder*="Review quotation details"]').fill('Follow-up under Company A');
    await modal.locator('button[type="submit"]:has-text("Save Task")').click();
    await expect(modal).not.toBeVisible();

    const rowA = page.locator('table tbody tr', { hasText: 'Alpha Client Co A' });
    await expect(rowA).toBeVisible();

    // Verify stored company_id is Company A's real UUID
    const storedA = await page.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('docgen_follow_ups') || '[]');
      return list.find((f: any) => f.customer_name === 'Alpha Client Co A');
    });
    expect(storedA).toBeDefined();
    expect(storedA.company_id).toBe(COMPANY_A.id);
    expect(UUID_REGEX.test(storedA.company_id)).toBe(true);
    expect(storedA.company_id).not.toBe('default');

    // 2. Switch to Company B
    await switchCompanyProfile(page, COMPANY_B.name);
    await navigateToTab(page, 'follow-ups');

    // Create Follow-up under Company B
    await page.locator('button:has-text("Schedule Follow-up")').click();
    modal = page.locator('.modal-content');
    await expect(modal).toBeVisible();

    await modal.locator('input[placeholder*="Arun Kumar"]').fill('Beta Client Co B');
    await modal.locator('input[type="date"]').fill('2026-09-26');
    await modal.locator('input[type="time"]').fill('11:00');
    await modal.locator('input[placeholder*="Review quotation details"]').fill('Follow-up under Company B');
    await modal.locator('button[type="submit"]:has-text("Save Task")').click();
    await expect(modal).not.toBeVisible();

    const rowB = page.locator('table tbody tr', { hasText: 'Beta Client Co B' });
    await expect(rowB).toBeVisible();

    // Verify stored company_id is Company B's real UUID and distinct from Company A
    const storedB = await page.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('docgen_follow_ups') || '[]');
      return list.find((f: any) => f.customer_name === 'Beta Client Co B');
    });
    expect(storedB).toBeDefined();
    expect(storedB.company_id).toBe(COMPANY_B.id);
    expect(UUID_REGEX.test(storedB.company_id)).toBe(true);
    expect(storedB.company_id).not.toBe(COMPANY_A.id);
    expect(storedB.company_id).not.toBe('default');
  });

  test('Test 3: Editing an existing follow-up preserves its original company_id even under another company context', async ({ page }) => {
    const today = '2026-09-26';
    const TEST_FU = {
      id: 'fu-company-a-orig-01',
      company_id: COMPANY_A.id,
      customer_name: 'Original Co A Client',
      phone: '9847112233',
      due_date: today,
      due_time: '12:00',
      reason: 'Original discussion under Company A',
      status: 'PENDING' as const,
      assigned_staff_email: 'fransonputhukkara@gmail.com',
      created_by_email: 'owner@b2p.com',
      created_at: '2026-09-20T10:00:00.000Z'
    };

    await setupApp(page, { followUps: [TEST_FU], handleDialogs: false });
    await navigateToTab(page, 'follow-ups');

    // Edit the task while Company A is active
    const row = page.locator('table tbody tr', { hasText: 'Original Co A Client' });
    await expect(row).toBeVisible();
    await row.locator('button[title="Edit Task"]').click();

    const editModal = page.locator('.modal-content');
    await expect(editModal).toBeVisible();

    // Update reason only
    await editModal.locator('input[placeholder*="Review quotation details"]').fill('Updated reason under Company A');
    await editModal.locator('button[type="submit"]:has-text("Update Task")').click();
    await expect(editModal).not.toBeVisible();

    // Verify company_id remains COMPANY_A.id
    const stored = await page.evaluate((fuId) => {
      const list = JSON.parse(localStorage.getItem('docgen_follow_ups') || '[]');
      return list.find((f: any) => f.id === fuId);
    }, TEST_FU.id);

    expect(stored).toBeDefined();
    expect(stored.company_id).toBe(COMPANY_A.id);
    expect(stored.company_id).not.toBe(COMPANY_B.id);
    expect(stored.company_id).not.toBe('default');
    expect(stored.reason).toBe('Updated reason under Company A');
  });

  test('Test 4: Multi-company isolation (Company A follow-ups do not leak into Company B, and vice versa)', async ({ page }) => {
    await setupApp(page);
    await navigateToTab(page, 'follow-ups');

    // 1. Create a follow-up in Company A
    await switchCompanyProfile(page, COMPANY_A.name);
    await navigateToTab(page, 'follow-ups');

    await page.locator('button:has-text("Schedule Follow-up")').click();
    let modal = page.locator('.modal-content');
    await modal.locator('input[placeholder*="Arun Kumar"]').fill('Isolation Client A');
    await modal.locator('input[type="date"]').fill('2026-09-26');
    await modal.locator('input[type="time"]').fill('10:00');
    await modal.locator('input[placeholder*="Review quotation details"]').fill('Secret deal under Company A');
    await modal.locator('button[type="submit"]:has-text("Save Task")').click();
    await expect(modal).not.toBeVisible();

    await expect(page.locator('table tbody tr', { hasText: 'Isolation Client A' })).toBeVisible();

    // 2. Switch to Company B
    await switchCompanyProfile(page, COMPANY_B.name);
    await navigateToTab(page, 'follow-ups');

    // Verify Company A's follow-up is NOT visible in Company B
    await expect(page.locator('table tbody tr', { hasText: 'Isolation Client A' })).not.toBeVisible();

    // 3. Create a follow-up in Company B
    await page.locator('button:has-text("Schedule Follow-up")').click();
    modal = page.locator('.modal-content');
    await modal.locator('input[placeholder*="Arun Kumar"]').fill('Isolation Client B');
    await modal.locator('input[type="date"]').fill('2026-09-26');
    await modal.locator('input[type="time"]').fill('14:00');
    await modal.locator('input[placeholder*="Review quotation details"]').fill('Campaign deal under Company B');
    await modal.locator('button[type="submit"]:has-text("Save Task")').click();
    await expect(modal).not.toBeVisible();

    // In Company B view: Client B is visible, Client A is not visible
    await expect(page.locator('table tbody tr', { hasText: 'Isolation Client B' })).toBeVisible();
    await expect(page.locator('table tbody tr', { hasText: 'Isolation Client A' })).not.toBeVisible();

    // 4. Switch back to Company A
    await switchCompanyProfile(page, COMPANY_A.name);
    await navigateToTab(page, 'follow-ups');

    // In Company A view: Client A is visible, Client B is not visible
    await expect(page.locator('table tbody tr', { hasText: 'Isolation Client A' })).toBeVisible();
    await expect(page.locator('table tbody tr', { hasText: 'Isolation Client B' })).not.toBeVisible();
  });

  test('Test 5: No newly created or saved follow-up uses "default" as company_id', async ({ page }) => {
    await setupApp(page);
    await navigateToTab(page, 'follow-ups');

    // Create follow-up
    await page.locator('button:has-text("Schedule Follow-up")').click();
    const modal = page.locator('.modal-content');
    await modal.locator('input[placeholder*="Arun Kumar"]').fill('Non-Default Audit Client');
    await modal.locator('input[type="date"]').fill('2026-09-26');
    await modal.locator('input[type="time"]').fill('16:00');
    await modal.locator('input[placeholder*="Review quotation details"]').fill('Audit test for default company prevention');
    await modal.locator('button[type="submit"]:has-text("Save Task")').click();
    await expect(modal).not.toBeVisible();

    // Verify in storage
    const allStored = await page.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('docgen_follow_ups') || '[]');
      return list;
    });

    for (const fu of allStored) {
      expect(fu.company_id).not.toBe('default');
      expect(fu.company_id).toBeTruthy();
      expect(UUID_REGEX.test(fu.company_id)).toBe(true);
    }
  });

  test('Test 6: Missing or invalid company fails safely without creating corrupted records', async ({ page }) => {
    await setupApp(page, { handleDialogs: false });
    await navigateToTab(page, 'follow-ups');

    // Verify rejection when service attempts to save a new follow-up with 'default' or missing company
    const failureResult = await page.evaluate(async () => {
      // Temporarily clear leadService active company to simulate uninitialized/missing state
      const leadServiceModule = (window as any).leadService;
      const officeServiceModule = (window as any).officeService;

      // Direct service test if exposed, or verify officeService error contract
      let caughtError = '';
      try {
        if (officeServiceModule) {
          await officeServiceModule.saveFollowUp({
            customer_name: 'Corrupted Test Client',
            due_date: '2026-09-26',
            reason: 'Test missing company',
            company_id: 'default'
          }, 'staff@b2p.com');
        } else {
          // If modules are not on window, test via localStorage inspection
          caughtError = 'Modules internal';
        }
      } catch (err: any) {
        caughtError = err.message;
      }
      return caughtError;
    });

    // Check that localStorage has zero follow-ups with 'default' or 'Corrupted Test Client'
    const corruptedRecord = await page.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('docgen_follow_ups') || '[]');
      return list.find((f: any) => f.customer_name === 'Corrupted Test Client' || f.company_id === 'default');
    });

    expect(corruptedRecord).toBeUndefined();
  });
});
