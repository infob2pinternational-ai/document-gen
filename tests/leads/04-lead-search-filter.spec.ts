import { test, expect } from '@playwright/test';
import { setupApp, navigateToTab, COMPANY_A } from '../helpers/crm-test-helpers';

const SEED_LEADS = [
  {
    id: 'lead-test-001',
    lead_number: 'B2P-LD-1001',
    company_id: COMPANY_A.id,
    customer_name: 'Abhishek Nair',
    company_name: 'Jos Alukkas Jewellery',
    phone: '9847111222',
    location: 'Thrissur',
    service_required: 'LED Van Advertising',
    lead_source: 'instagram',
    priority: 'HOT',
    status: 'new',
    assigned_telecaller_email: 'fransonputhukkara@gmail.com',
    created_at: '2026-09-20T10:00:00.000Z'
  },
  {
    id: 'lead-test-002',
    lead_number: 'B2P-LD-1002',
    company_id: COMPANY_A.id,
    customer_name: 'Biju George',
    company_name: 'Grand Hyatt Kochi',
    phone: '9847333444',
    location: 'Ernakulam',
    service_required: 'LED Wall',
    lead_source: 'facebook',
    priority: 'WARM',
    status: 'requirement_collected',
    assigned_telecaller_email: 'sarathjohnpanengadan@gmail.com',
    created_at: '2026-09-21T11:00:00.000Z'
  },
  {
    id: 'lead-test-003',
    lead_number: 'B2P-LD-1003',
    company_id: COMPANY_A.id,
    customer_name: 'Cherian Mathew',
    company_name: 'Lulu Convention Centre',
    phone: '9847555666',
    location: 'Thrissur',
    service_required: 'Lookwalker',
    lead_source: 'phone',
    priority: 'COLD',
    status: 'lost',
    assigned_telecaller_email: 'brutf5354@gmail.com',
    created_at: '2026-09-22T12:00:00.000Z'
  }
];

test.describe('Leads — Search & Multi-criteria Filtering', () => {
  test('filters leads by search term, stage, priority, source, and staff', async ({ page }) => {
    await setupApp(page, { leads: SEED_LEADS });
    await navigateToTab(page, 'leads');

    // Verify all 3 leads initially visible
    await expect(page.locator('table tbody tr')).toHaveCount(3);

    // 1. Search by customer name
    const searchInput = page.locator('input[placeholder*="Search lead, customer"]');
    await searchInput.fill('Abhishek');
    await expect(page.locator('table tbody tr')).toHaveCount(1);
    await expect(page.locator('table tbody tr')).toContainText('Jos Alukkas Jewellery');

    // 2. Search by phone number
    await searchInput.fill('9847333444');
    await expect(page.locator('table tbody tr')).toHaveCount(1);
    await expect(page.locator('table tbody tr')).toContainText('Grand Hyatt Kochi');

    // Clear search
    await searchInput.fill('');
    await expect(page.locator('table tbody tr')).toHaveCount(3);

    // 3. Filter by Priority: click 'HOT' pill
    await page.locator('.glass-panel button:has-text("Hot")').click();
    await expect(page.locator('table tbody tr')).toHaveCount(1);
    await expect(page.locator('table tbody tr')).toContainText('Jos Alukkas Jewellery');

    // Click 'HOT' again to toggle off
    await page.locator('.glass-panel button:has-text("Hot")').click();
    await expect(page.locator('table tbody tr')).toHaveCount(3);

    // 4. Filter by Stage: select 'Lost'
    const stageSelect = page.locator('select', { has: page.locator('option[value="lost"]') });
    await stageSelect.selectOption('lost');
    await expect(page.locator('table tbody tr')).toHaveCount(1);
    await expect(page.locator('table tbody tr')).toContainText('Lulu Convention Centre');

    // 5. Test Reset Filters button
    const resetBtn = page.locator('button:has-text("Reset")');
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();

    // Verify all 3 restored
    await expect(page.locator('table tbody tr')).toHaveCount(3);

    // 6. Filter by Source: 'Instagram'
    const sourceSelect = page.locator('select', { has: page.locator('option[value="instagram"]') });
    await sourceSelect.selectOption('instagram');
    await expect(page.locator('table tbody tr')).toHaveCount(1);
    await expect(page.locator('table tbody tr')).toContainText('Jos Alukkas Jewellery');

    await resetBtn.click();
    await expect(page.locator('table tbody tr')).toHaveCount(3);
  });
});
