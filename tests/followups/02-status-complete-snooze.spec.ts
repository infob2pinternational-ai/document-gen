import { test, expect } from '@playwright/test';
import { setupApp, navigateToTab, COMPANY_A } from '../helpers/crm-test-helpers';

test.describe('Follow-ups — Status Transitions, Completion & Snooze', () => {
  test('completes a follow-up, logs outcome note, verifies transition to Completed tab, and tests snooze', async ({ page }) => {
    const today = '2026-09-26';
    const INITIAL_FOLLOW_UPS = [
      {
        id: 'fu-test-comp-01',
        company_id: COMPANY_A.id,
        customer_name: 'Vinod Kumar',
        company_name: 'Cochin Shipyard Events',
        phone: '9847121212',
        due_date: today,
        due_time: '11:00',
        reason: 'Payment follow-up for stage setup',
        status: 'PENDING',
        assigned_staff_email: 'fransonputhukkara@gmail.com',
        created_by_email: 'owner@b2p.com',
        created_at: '2026-09-25T10:00:00.000Z'
      },
      {
        id: 'fu-test-snooze-01',
        company_id: COMPANY_A.id,
        customer_name: 'Dr. Joseph Thomas',
        company_name: 'Lakeshore Hospital',
        phone: '9847343434',
        due_date: today,
        due_time: '15:30',
        reason: 'Health camp lookwalker campaign discussion',
        status: 'PENDING',
        assigned_staff_email: 'sarathjohnpanengadan@gmail.com',
        created_by_email: 'owner@b2p.com',
        created_at: '2026-09-25T11:00:00.000Z'
      }
    ];

    await setupApp(page, { followUps: INITIAL_FOLLOW_UPS, handleDialogs: false });
    await navigateToTab(page, 'follow-ups');

    // 1. Verify 2 tasks on 'Due Today'
    await page.locator('.glass-panel button:has-text("Due Today")').click();
    await expect(page.locator('table tbody tr')).toHaveCount(2);

    // 2. Complete Follow-up #1 via Quick Done button with completion outcome note
    page.on('dialog', async dialog => {
      expect(dialog.type()).toBe('prompt');
      await dialog.accept('Client confirmed advance paid via NEFT. Booking locked.');
    });

    const vinodRow = page.locator('table tbody tr', { hasText: 'Vinod Kumar' });
    await vinodRow.locator('button:has-text("Done")').click();

    // 3. Verify Vinod Kumar is no longer in 'Due Today' tab
    await expect(page.locator('table tbody tr', { hasText: 'Vinod Kumar' })).not.toBeVisible();
    await expect(page.locator('table tbody tr')).toHaveCount(1); // Only Joseph Thomas remains

    // 4. Check 'Completed' tab
    await page.locator('.glass-panel button:has-text("Completed")').click();
    const completedRow = page.locator('table tbody tr', { hasText: 'Vinod Kumar' });
    await expect(completedRow).toBeVisible();
    await expect(completedRow).toContainText('Completed');
    await expect(completedRow).toContainText('Outcome: Client confirmed advance paid via NEFT');

    // Verify Quick Actions buttons (Done, Snooze) are hidden for completed tasks
    await expect(completedRow.locator('button:has-text("Done")')).not.toBeVisible();

    // 5. Refresh page and verify completed task stays completed (Phase 2 #24)
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await navigateToTab(page, 'follow-ups');

    // Due Today should still have only Joseph Thomas
    await page.locator('.glass-panel button:has-text("Due Today")').click();
    await expect(page.locator('table tbody tr', { hasText: 'Vinod Kumar' })).not.toBeVisible();
    await expect(page.locator('table tbody tr', { hasText: 'Dr. Joseph Thomas' })).toBeVisible();

    // Completed tab should still have Vinod Kumar
    await page.locator('.glass-panel button:has-text("Completed")').click();
    await expect(page.locator('table tbody tr', { hasText: 'Vinod Kumar' })).toBeVisible();

    // 6. Test Snooze on Dr. Joseph Thomas
    await page.locator('.glass-panel button:has-text("Due Today")').click();
    const josephRow = page.locator('table tbody tr', { hasText: 'Dr. Joseph Thomas' });
    const snoozeSelect = josephRow.locator('select');
    await snoozeSelect.selectOption('30'); // Snooze +30m

    // Verify status updated in localStorage / UI
    await page.locator('.glass-panel button:has-text("Snoozed")').click();
    const snoozedRow = page.locator('table tbody tr', { hasText: 'Dr. Joseph Thomas' });
    await expect(snoozedRow).toBeVisible();
  });

  test('preserves completed_at, completion_note, original created_at, company_id, and lead_id when editing a follow-up', async ({ page }) => {
    const today = '2026-09-26';
    const TEST_LEAD = {
      id: 'lead-fu-dataloss-01',
      lead_number: 'B2P-LD-1099',
      company_id: COMPANY_A.id,
      customer_name: 'Ananthakrishnan Nair',
      company_name: 'Travancore Media Group',
      phone: '9847556677',
      location: 'Kottayam',
      service_required: 'Mobile Roadshow Campaigns',
      priority: 'HOT',
      status: 'proposal_sent',
      assigned_telecaller_email: 'fransonputhukkara@gmail.com',
      created_at: '2026-09-19T08:00:00.000Z'
    };

    await setupApp(page, { leads: [TEST_LEAD], handleDialogs: false });
    await navigateToTab(page, 'follow-ups');

    // 1. Create Follow-up linked to TEST_LEAD
    await page.locator('button:has-text("Schedule Follow-up")').click();
    const createModal = page.locator('.modal-content');
    await expect(createModal).toBeVisible();

    const leadSelect = createModal.locator('select', { has: page.locator(`option[value="${TEST_LEAD.id}"]`) });
    await leadSelect.selectOption(TEST_LEAD.id);

    await createModal.locator('input[type="date"]').fill(today);
    await createModal.locator('input[type="time"]').fill('10:00');
    await createModal.locator('input[placeholder*="Review quotation details"]').fill('Initial roadshow routing discussion');
    await createModal.locator('button[type="submit"]:has-text("Save Task")').click();
    await expect(createModal).not.toBeVisible();

    // Verify task in table and capture original created_at, company_id, lead_id from storage
    const createdRow = page.locator('table tbody tr', { hasText: 'Ananthakrishnan Nair' });
    await expect(createdRow).toBeVisible();

    const storedInitial = await page.evaluate((leadId) => {
      const raw = localStorage.getItem('docgen_follow_ups');
      const list = raw ? JSON.parse(raw) : [];
      return list.find((f: any) => f.lead_id === leadId);
    }, TEST_LEAD.id);

    expect(storedInitial).toBeDefined();
    const followUpId = storedInitial.id;
    const originalCreatedAt = storedInitial.created_at;
    expect(originalCreatedAt).toBeTruthy();
    expect(storedInitial.company_id).toBe(COMPANY_A.id);
    expect(storedInitial.lead_id).toBe(TEST_LEAD.id);
    expect(storedInitial.status).toBe('PENDING');

    // 2. Complete with note
    const outcomeNote = 'Route map approved by client. Advance received.';
    page.on('dialog', async dialog => {
      expect(dialog.type()).toBe('prompt');
      await dialog.accept(outcomeNote);
    });

    await createdRow.locator('button:has-text("Done")').click();

    // Switch to Completed tab
    await page.locator('.glass-panel button:has-text("Completed")').click();
    const completedRow = page.locator('table tbody tr', { hasText: 'Ananthakrishnan Nair' });
    await expect(completedRow).toBeVisible();
    await expect(completedRow).toContainText('Outcome: ' + outcomeNote);

    // Read storage after completion
    const storedAfterComplete = await page.evaluate((fId) => {
      const raw = localStorage.getItem('docgen_follow_ups');
      const list = raw ? JSON.parse(raw) : [];
      return list.find((f: any) => f.id === fId);
    }, followUpId);

    expect(storedAfterComplete).toBeDefined();
    expect(storedAfterComplete.status).toBe('COMPLETED');
    expect(storedAfterComplete.completed_at).toBeTruthy();
    expect(storedAfterComplete.completion_note).toBe(outcomeNote);
    expect(storedAfterComplete.created_at).toBe(originalCreatedAt);
    expect(storedAfterComplete.company_id).toBe(COMPANY_A.id);
    expect(storedAfterComplete.lead_id).toBe(TEST_LEAD.id);

    const completedAtTimestamp = storedAfterComplete.completed_at;

    // Small delay to ensure timestamp comparison would detect a newly created timestamp on edit
    await page.waitForTimeout(50);

    // 3. Edit (change only reason and time)
    await completedRow.locator('button[title="Edit Task"]').click();
    const editModal = page.locator('.modal-content');
    await expect(editModal).toBeVisible();
    await expect(editModal.locator('h2')).toContainText('Edit Follow-up Task');

    const updatedReason = 'Discuss revised route & audio permissions';
    const updatedTime = '16:45';
    await editModal.locator('input[placeholder*="Review quotation details"]').fill(updatedReason);
    await editModal.locator('input[type="time"]').fill(updatedTime);

    // 4. Save
    await editModal.locator('button[type="submit"]:has-text("Update Task")').click();
    await expect(editModal).not.toBeVisible();

    // 5. Assert completed_at, completion_note, original created_at, company_id, lead_id remain intact in storage!
    const storedAfterEdit = await page.evaluate((fId) => {
      const raw = localStorage.getItem('docgen_follow_ups');
      const list = raw ? JSON.parse(raw) : [];
      return list.find((f: any) => f.id === fId);
    }, followUpId);

    expect(storedAfterEdit).toBeDefined();
    // Critical Assertions: All existing metadata strictly preserved without data loss
    expect(storedAfterEdit.completed_at).toBe(completedAtTimestamp);
    expect(storedAfterEdit.completion_note).toBe(outcomeNote);
    expect(storedAfterEdit.created_at).toBe(originalCreatedAt);
    expect(storedAfterEdit.company_id).toBe(COMPANY_A.id);
    expect(storedAfterEdit.lead_id).toBe(TEST_LEAD.id);
    expect(storedAfterEdit.status).toBe('COMPLETED');

    // Intentional changes applied:
    expect(storedAfterEdit.reason).toBe(updatedReason);
    expect(storedAfterEdit.due_time).toBe(updatedTime);

    // 6. UI reflects both updated fields and preserved completion note
    const updatedRow = page.locator('table tbody tr', { hasText: 'Ananthakrishnan Nair' });
    await expect(updatedRow).toBeVisible();
    await expect(updatedRow).toContainText(updatedReason);
    await expect(updatedRow).toContainText('16:45');
    await expect(updatedRow).toContainText('Outcome: ' + outcomeNote);
  });
});

