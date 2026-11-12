// Office review screens in a desktop browser, against the real database
// functions (see tests/helpers/field-sales-http.mjs).
import { test, expect, type Page } from '@playwright/test';
import { createBackend, SUPABASE_URL, PASSWORD, EMAIL, U, A, B } from './helpers/field-sales-http.mjs';

let backend: Awaited<ReturnType<typeof createBackend>>;
let n = 0;
test.beforeEach(async ({ page }) => {
  backend = await createBackend();
  await page.route(`${SUPABASE_URL}/**`, route => backend.handle(route));
  page.on('dialog', dialog => dialog.accept());
});
test.afterEach(async () => { await backend.close(); });

const visitId = () => `0000${String(7000 + ++n)}-0000-4000-8000-000000000000`;
/** A visit submitted by a salesperson through save_field_visit, as the phone app does. */
async function submitVisit(uid: string, values: Record<string, unknown>) {
  const id = visitId();
  await backend.rpcAs(uid, 'save_field_visit', { p_visit: { id, company_id: A, business_name: 'Shop', phone: '9000010000', contact_person: '', location: '',
    requirements: ['website'], requirement_other: '', estimated_budget: '', remarks: '', follow_up_date: '', ...values } });
  return id;
}
async function signIn(page: Page, email: string) {
  await page.goto('./');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
}
async function openReview(page: Page, email: string) {
  await signIn(page, email);
  await page.getByRole('button', { name: 'Field Visits' }).click();
  await expect(page.getByTestId('field-visit-review')).toBeVisible();
}
const row = (page: Page, name: string | RegExp) => page.getByTestId('visit-list').getByRole('button', { name });
const panel = (page: Page) => page.getByTestId('visit-panel');
const tomorrow = () => { const d = new Date(Date.now() + 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('the owner sees submitted visits, filters and searches them, opens one and approves it', async ({ page }) => {
  await submitVisit(U.salesA, { business_name: 'Alpha Traders', phone: '9000011111', contact_person: 'Anil', location: 'Thrissur', requirements: ['website', 'crm'], estimated_budget: '40000', remarks: 'Call in the evening' });
  await submitVisit(U.salesA2, { business_name: 'Beta Bakery', phone: '9000022222' });
  await submitVisit(U.salesB, { company_id: B, business_name: 'Gamma Garage', phone: '9000033333' });

  await openReview(page, EMAIL.owner);
  // The active company's visits waiting for review.
  await expect(row(page, /Alpha Traders/)).toBeVisible();
  await expect(row(page, /Beta Bakery/)).toBeVisible();
  await expect(row(page, /Gamma Garage/)).toHaveCount(0);

  // Company filter.
  await page.getByLabel('Company').selectOption({ label: 'All companies' });
  await expect(row(page, /Gamma Garage/)).toContainText('Company B');
  await page.getByLabel('Company').selectOption({ label: 'Company A' });
  await expect(row(page, /Gamma Garage/)).toHaveCount(0);
  // Salesperson filter.
  await page.getByLabel('Salesperson').selectOption({ label: 'sales.a2' });
  await expect(row(page, /Beta Bakery/)).toBeVisible();
  await expect(row(page, /Alpha Traders/)).toHaveCount(0);
  await page.getByLabel('Salesperson').selectOption({ label: 'Everyone' });
  // Search by business name and by phone number.
  await page.getByLabel('Search').fill('alpha');
  await expect(row(page, /Beta Bakery/)).toHaveCount(0);
  await page.getByLabel('Search').fill('90000 222');
  await expect(row(page, /Beta Bakery/)).toBeVisible();
  await expect(row(page, /Alpha Traders/)).toHaveCount(0);
  await page.getByLabel('Search').fill('nothing like this');
  await expect(page.getByText('No visits match these filters.')).toBeVisible();
  await page.getByLabel('Search').fill('');
  // Date filter.
  await page.getByLabel('From').fill(tomorrow());
  await expect(page.getByText('No visits match these filters.')).toBeVisible();
  await page.getByLabel('From').fill('');

  // Full details and history.
  await row(page, /Alpha Traders/).click();
  await expect(panel(page)).toContainText(`By ${EMAIL.salesA}`);
  await expect(panel(page)).toContainText('Website, CRM');
  await expect(panel(page)).toContainText('₹40,000');
  await expect(panel(page)).toContainText('Call in the evening');
  await expect(page.getByTestId('visit-history')).toContainText('Submitted');

  await panel(page).getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('review-notice')).toContainText('“Alpha Traders” approved.');
  await expect(page.getByTestId('visit-history')).toContainText('Approved');
  await expect(row(page, /Alpha Traders/)).toHaveCount(0);               // no longer "pending review"
  await page.getByLabel('Status').selectOption({ label: 'Approved (1)' });
  await expect(row(page, /Alpha Traders/)).toContainText('Approved');
  expect(await backend.sql("SELECT status, reviewed_by_email FROM field_visits WHERE business_name = 'Alpha Traders'")).toEqual([{ status: 'approved', reviewed_by_email: EMAIL.owner }]);
});

test('rejecting and requesting a correction both need a reason and are recorded in the history', async ({ page }) => {
  const rejectId = await submitVisit(U.salesA, { business_name: 'Closed Down Shop', phone: '9000044444' });
  const fixId = await submitVisit(U.salesA, { business_name: 'Wrong Number Shop', phone: '9000055555' });
  await openReview(page, EMAIL.admin);

  await row(page, /Closed Down Shop/).click();
  await panel(page).getByRole('button', { name: 'Reject' }).click();
  await expect(panel(page).getByRole('button', { name: 'Reject visit' })).toBeDisabled();      // no reason yet
  await page.getByLabel('Reason for rejecting').fill('Shop has closed down');
  await panel(page).getByRole('button', { name: 'Reject visit' }).click();
  await expect(page.getByTestId('review-notice')).toContainText('rejected');

  await row(page, /Wrong Number Shop/).click();
  await panel(page).getByRole('button', { name: 'Request correction' }).click();
  await page.getByLabel('What should the salesperson correct?').fill('Phone number does not ring');
  await panel(page).getByRole('button', { name: 'Send back' }).click();
  await expect(page.getByTestId('review-notice')).toContainText('sent back for correction');
  await expect(page.getByText('Nothing waiting for review.')).toBeVisible();

  expect(await backend.sql('SELECT id, status, review_note, reviewed_by_email FROM field_visits ORDER BY business_name')).toEqual([
    { id: rejectId, status: 'rejected', review_note: 'Shop has closed down', reviewed_by_email: EMAIL.admin },
    { id: fixId, status: 'needs_correction', review_note: 'Phone number does not ring', reviewed_by_email: EMAIL.admin }]);
  await page.getByLabel('Status').selectOption({ label: 'Rejected (1)' });
  await row(page, /Closed Down Shop/).click();
  await expect(page.getByTestId('visit-history')).toContainText('Shop has closed down');
  await expect(panel(page).getByRole('button', { name: 'Approve' })).toHaveCount(0);            // a rejected visit is closed
});

test('an approved visit is handed to Daily Calling, not to a CRM lead, with the visit data carried over', async ({ page }) => {
  await submitVisit(U.salesA, { business_name: 'Delta Designs', phone: '9000066666', contact_person: 'Deepa', requirements: ['billing_software'], follow_up_date: tomorrow(), remarks: 'Needs GST billing' });
  await openReview(page, EMAIL.owner);
  await row(page, /Delta Designs/).click();
  await panel(page).getByRole('button', { name: 'Approve' }).click();

  // No lead is created, and there is no conversion UI left on this screen - the field visit's
  // own job ends at approval. convert_telecalling_entry_to_lead (not tested at the browser layer
  // here; see tests/field-sales-daily-calling-handoff.test.mjs) is what the office uses next, from
  // the existing Daily Calling screen.
  await expect(panel(page).getByRole('button', { name: 'Convert to lead' })).toHaveCount(0);
  await expect(page.getByTestId('review-notice')).toContainText('approved');
  await expect(panel(page)).toContainText('Handed to Daily Calling');

  expect(await backend.sql("SELECT count(*)::int AS n FROM leads WHERE lead_source = 'field_visit'")).toEqual([{ n: 0 }]);
  const entries = await backend.sql(
    `SELECT company_name, contact_person, phone, call_status, visit_remarks, salesperson_email
     FROM telecalling_entries WHERE field_visit_id = (SELECT id FROM field_visits WHERE business_name = 'Delta Designs')`
  );
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    company_name: 'Delta Designs', contact_person: 'Deepa', phone: '9000066666',
    call_status: 'Not Called Yet', visit_remarks: 'Needs GST billing', salesperson_email: EMAIL.salesA
  });
});

test('a visit whose phone already belongs to a lead is still flagged here, and approving it only hands off to Daily Calling (no lead created or linked by this screen)', async ({ page }) => {
  await submitVisit(U.salesA, { business_name: 'Existing Shop A (revisit)', phone: '098765 43210' });   // same number as an existing lead
  await openReview(page, EMAIL.owner);
  await expect(row(page, /Existing Shop A \(revisit\)/)).toContainText('Possible duplicate');
  await row(page, /Existing Shop A \(revisit\)/).click();
  await expect(panel(page)).toContainText('Existing lead');
  await panel(page).getByRole('button', { name: 'Approve' }).click();

  // Duplicate-of-a-lead is informational here; this screen no longer offers any way to create or
  // link a lead itself. Whether to qualify the resulting Daily Calling entry (and whether its own
  // phone-duplicate check catches it, as proven in field-sales-daily-calling-handoff.test.mjs) is
  // now entirely the office's decision, made later, in Daily Calling.
  await expect(panel(page).getByRole('button', { name: 'Convert to lead' })).toHaveCount(0);
  expect(await backend.sql('SELECT count(*)::int AS n FROM leads')).toEqual([{ n: 2 }]);          // unchanged: just the two pre-existing seeded leads
  expect(await backend.sql("SELECT status FROM field_visits")).toEqual([{ status: 'approved' }]);
  expect(await backend.sql("SELECT count(*)::int AS n FROM telecalling_entries WHERE field_visit_id IS NOT NULL")).toEqual([{ n: 1 }]);
});

test('staff are not offered the review screen, and the database refuses them if they try', async ({ page }) => {
  const id = await submitVisit(U.salesA, { business_name: 'Not For Staff', phone: '9000077777' });
  await signIn(page, EMAIL.staffA);
  await expect(page.getByRole('button', { name: /^Leads/ })).toBeVisible();          // the normal CRM
  await expect(page.getByRole('button', { name: 'Field Visits' })).toHaveCount(0);
  await expect(backend.rpcAs(U.staffA, 'review_field_visit', { p_visit_id: id, p_action: 'approve', p_note: null })).rejects.toThrow(/Only the owner or an admin/);
  await expect(backend.rpcAs(U.staffA, 'convert_field_visit_to_lead', { p_visit_id: id })).rejects.toThrow(/Only the owner or an admin/);
  expect(await backend.sql('SELECT status FROM field_visits')).toEqual([{ status: 'submitted' }]);
});

test('the review screen works at phone width: the open visit replaces the list and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await submitVisit(U.salesA, { business_name: 'Narrow Screen Stores', phone: '9000088888' });
  await signIn(page, EMAIL.owner);
  await page.goto('./');
  // On a narrow screen the sidebar is behind the menu button.
  const item = page.getByRole('button', { name: 'Field Visits' });
  if (!(await item.isVisible())) await page.getByRole('button', { name: /menu/i }).first().click();
  await item.click();
  await expect(row(page, /Narrow Screen Stores/)).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('[data-testid="field-visit-review"]')!.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await row(page, /Narrow Screen Stores/).click();
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId('visit-list')).toBeHidden();
  await panel(page).getByRole('button', { name: '← Back to list' }).click();
  await expect(page.getByTestId('visit-list')).toBeVisible();
});
