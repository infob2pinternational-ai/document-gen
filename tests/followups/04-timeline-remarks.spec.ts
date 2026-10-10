import { test, expect } from '@playwright/test';
import { setupApp, navigateToTab, COMPANY_A } from '../helpers/crm-test-helpers';

const lead = { id: 'timeline-lead', lead_number: 'B2P-LD-1234', company_id: COMPANY_A.id,
  customer_name: 'Timeline Client', company_name: 'Timeline Company', phone: '9847119988',
  priority: 'HOT', status: 'new', created_at: '2026-10-01T10:00:00Z' };
const dateKey = (offset: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })
  .format(new Date(Date.now() + offset * 86400000));

for (const [tab, offset] of [['Due Today', 0], ['Overdue', -1]] as const) {
  test(`${tab} completion remarks appear in the correct timeline and survive reload`, async ({ page }) => {
    await setupApp(page, { leads: [lead], handleDialogs: false, followUps: [{
      id: 'timeline-task', lead_id: lead.id, lead_number: lead.lead_number, company_id: COMPANY_A.id,
      customer_name: lead.customer_name, due_date: dateKey(offset), due_time: '10:00',
      status: 'PENDING', reason: 'Discuss campaign', assigned_staff_email: 'caller@example.test',
      created_by_email: 'caller@example.test', created_at: '2026-10-01T10:00:00Z'
    }] });
    page.on('dialog', dialog => dialog.accept('Customer confirmed the campaign'));
    await navigateToTab(page, 'follow-ups');
    await page.locator('.glass-panel button').filter({ hasText: tab }).click();
    await page.locator('table tbody tr', { hasText: lead.customer_name }).getByRole('button', { name: 'Done' }).click();
    await navigateToTab(page, 'leads');
    await page.locator('table tbody tr', { hasText: lead.company_name }).click();
    await expect(page.locator('.drawer-content')).toContainText('Customer confirmed the campaign');
    await expect(page.locator('.drawer-content')).toContainText('Follow-up Completed');
    await page.reload();
    await navigateToTab(page, 'leads');
    await page.locator('table tbody tr', { hasText: lead.company_name }).click();
    await expect(page.locator('.drawer-content')).toContainText('Customer confirmed the campaign');
    const activities = await page.evaluate(() => JSON.parse(localStorage.getItem('docgen_lead_activities') || '[]'));
    expect(activities.filter((a: any) => a.action === 'Follow-up Completed')).toHaveLength(1);
    expect(activities.every((a: any) => a.lead_id === 'timeline-lead')).toBe(true);
  });
}

test('edited remarks retain the future due date and lead detail notes update immediately', async ({ page }) => {
  await setupApp(page, { leads: [lead], followUps: [{ id: 'timeline-task', lead_id: lead.id,
    company_id: COMPANY_A.id, customer_name: lead.customer_name, due_date: dateKey(0), due_time: '10:00',
    status: 'PENDING', reason: 'Discuss campaign', created_at: '2026-10-01T10:00:00Z' }] });
  await navigateToTab(page, 'follow-ups');
  await page.locator('table tbody tr', { hasText: lead.customer_name }).locator('button[title="Edit Task"]').click();
  const modal = page.locator('.modal-content');
  await modal.locator('textarea').fill('Customer asked for another call');
  await modal.locator('input[type="date"]').fill(dateKey(2));
  await modal.getByRole('button', { name: 'Update Task' }).click();
  await expect(modal).not.toBeVisible();
  await navigateToTab(page, 'leads');
  await page.locator('table tbody tr', { hasText: lead.company_name }).click();
  const drawer = page.locator('.drawer-content');
  await expect(drawer).toContainText('Customer asked for another call');
  await drawer.locator('input[placeholder*="Log customer"]').fill('Confirmed details from lead page');
  await drawer.getByRole('button', { name: 'Add Note' }).click();
  await expect(drawer).toContainText('Confirmed details from lead page');
  const tasks = await page.evaluate(() => JSON.parse(localStorage.getItem('docgen_follow_ups') || '[]'));
  expect(tasks[0].due_date).toBe(dateKey(2));
  expect(tasks[0].status).toBe('PENDING');
});
