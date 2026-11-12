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

test('an approved visit becomes a CRM lead assigned to chosen staff, with a follow-up, and appears in Leads', async ({ page }) => {
  await submitVisit(U.salesA, { business_name: 'Delta Designs', phone: '9000066666', contact_person: 'Deepa', requirements: ['billing_software'], follow_up_date: tomorrow(), remarks: 'Needs GST billing' });
  await openReview(page, EMAIL.owner);
  await row(page, /Delta Designs/).click();
  await panel(page).getByRole('button', { name: 'Approve' }).click();
  await panel(page).getByRole('button', { name: 'Convert to lead' }).click();

  const convert = page.getByTestId('convert-panel');
  await expect(convert.getByLabel('Assign the lead to')).toHaveValue(EMAIL.owner);              // defaults to the reviewer
  await expect(convert.getByLabel('Assign the lead to').locator('option')).toHaveText([/owner@example\.test \(you\)/, /admin@example\.test/, /staff\.a@example\.test/]);
  await expect(convert.getByLabel(/Follow-up date/)).toHaveValue(tomorrow());                    // what the salesperson asked for
  await convert.getByLabel('Assign the lead to').selectOption(EMAIL.staffA);
  await convert.getByRole('button', { name: 'Create lead' }).dblclick();                          // a double click creates one lead

  await expect(page.getByTestId('review-notice')).toContainText(/Lead B2P-LD-\d+ created\./);
  await expect(panel(page)).toContainText(`assigned to ${EMAIL.staffA}`);
  await expect(page.getByTestId('visit-history')).toContainText('Converted to a new lead');
  await expect(page.getByTestId('visit-history')).toContainText('follow-up created');

  const leads = await backend.sql("SELECT id, lead_number, customer_name, company_name, assigned_telecaller_email, service_required, source_details FROM leads WHERE lead_source = 'field_visit'");
  expect(leads).toHaveLength(1);
  expect(leads[0]).toMatchObject({ customer_name: 'Deepa', company_name: 'Delta Designs', assigned_telecaller_email: EMAIL.staffA, service_required: 'Billing Software' });
  expect(leads[0].source_details).toContain(`Field visit by ${EMAIL.salesA}`);                    // salesperson attribution
  expect(await backend.sql('SELECT assigned_staff_email, status, follow_up_date::text AS d FROM follow_ups WHERE lead_id = $1', [leads[0].id]))
    .toEqual([{ assigned_staff_email: EMAIL.staffA, status: 'pending', d: tomorrow() }]);
  expect(await backend.sql("SELECT count(*)::int AS n FROM field_visit_events WHERE action LIKE 'converted%'")).toEqual([{ n: 1 }]);

  // The existing CRM shows the new lead and its timeline.
  await page.getByRole('button', { name: /^Leads/ }).click();
  await expect(page.getByText('Delta Designs').first()).toBeVisible();
  await expect(page.getByText(leads[0].lead_number).first()).toBeVisible();
});

test('a visit whose phone already belongs to a lead is flagged, creates nothing by itself, and can be linked to that lead', async ({ page }) => {
  await submitVisit(U.salesA, { business_name: 'Existing Shop A (revisit)', phone: '098765 43210' });   // same number as an existing lead
  await openReview(page, EMAIL.owner);
  await expect(row(page, /Existing Shop A \(revisit\)/)).toContainText('Possible duplicate');
  await row(page, /Existing Shop A \(revisit\)/).click();
  await expect(panel(page)).toContainText('Existing lead');
  await panel(page).getByRole('button', { name: 'Approve' }).click();
  await panel(page).getByRole('button', { name: 'Convert to lead' }).click();
  await page.getByTestId('convert-panel').getByRole('button', { name: 'Create lead' }).click();

  const matches = page.getByTestId('duplicate-matches');
  await expect(matches).toContainText('already belongs to a lead. Nothing has been created.');
  await expect(matches).toContainText('Existing Shop A');
  expect(await backend.sql('SELECT count(*)::int AS n FROM leads')).toEqual([{ n: 2 }]);
  expect(await backend.sql("SELECT status FROM field_visits")).toEqual([{ status: 'approved' }]);

  await matches.getByRole('button', { name: 'Link to this lead' }).click();
  await expect(page.getByTestId('review-notice')).toContainText('Linked to existing lead');
  await expect(page.getByTestId('visit-history')).toContainText('Linked to an existing lead');
  expect(await backend.sql('SELECT count(*)::int AS n FROM leads')).toEqual([{ n: 2 }]);
  expect(await backend.sql('SELECT status, conversion_mode FROM field_visits')).toEqual([{ status: 'converted', conversion_mode: 'linked_existing' }]);
  expect(await backend.sql("SELECT count(*)::int AS n FROM lead_activities WHERE type = 'Field Visit Linked'")).toEqual([{ n: 1 }]);
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
