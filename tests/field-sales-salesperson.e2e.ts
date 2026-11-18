// Salesperson screens on a phone-sized browser, against the real database
// functions (see tests/helpers/field-sales-http.mjs).
import { test, expect, type Page } from '@playwright/test';
import { createBackend, SUPABASE_URL, PASSWORD, EMAIL, U, A } from './helpers/field-sales-http.mjs';

let backend: Awaited<ReturnType<typeof createBackend>>;
test.beforeEach(async ({ page }) => {
  backend = await createBackend();
  await page.route(`${SUPABASE_URL}/**`, route => backend.handle(route));
  page.on('dialog', dialog => dialog.accept());
});
test.afterEach(async () => { await backend.close(); });

async function signIn(page: Page, email: string) {
  await page.goto('./');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
}
/** Signed in and the first load from the server has finished. */
async function ready(page: Page) {
  await expect(page.getByTestId('field-sales-app')).toBeVisible();
  await expect.poll(() => backend.rpcCalls('my_field_sales_companies')).toBeGreaterThan(0);
  await page.waitForLoadState('networkidle');
}
/** No connection at all: the browser reports offline and nothing reaches the server. */
async function goOffline(page: Page) { backend.reachable = false; await page.context().setOffline(true); }
async function goOnline(page: Page) { backend.reachable = true; await page.context().setOffline(false); }
async function fillVisit(page: Page, values: { name: string; phone: string; contact?: string; location?: string; budget?: string; remarks?: string }) {
  await page.getByLabel('Business name').fill(values.name);
  await page.getByLabel('Phone number').fill(values.phone);
  if (values.contact) await page.getByLabel(/Contact person/).fill(values.contact);
  if (values.location) await page.getByLabel(/Location/).fill(values.location);
  if (values.budget) await page.getByLabel(/Estimated budget/).fill(values.budget);
  if (values.remarks) await page.getByLabel(/Remarks/).fill(values.remarks);
}

test('a salesperson signs in, sees only the visit screens, and submits a visit', async ({ page }) => {
  await signIn(page, EMAIL.salesA);
  await expect(page.getByTestId('field-sales-app')).toBeVisible();
  await expect(page.getByText('No visits yet.')).toBeVisible();
  // None of the office CRM is offered to this role.
  await expect(page.getByText('Leads', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Customers', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '+ New visit' }).click();
  // Validation: clear messages, nothing sent.
  await page.getByRole('button', { name: 'Submit visit' }).click();
  await expect(page.getByText('Enter the business name.')).toBeVisible();
  await expect(page.getByText('Enter a phone number.')).toBeVisible();
  await fillVisit(page, { name: 'Corner Store', phone: '12' });
  await page.getByRole('button', { name: 'Submit visit' }).click();
  await expect(page.getByText('Enter a valid phone number (6 to 15 digits).')).toBeVisible();
  expect(backend.rpcCalls('save_field_visit')).toBe(0);

  await fillVisit(page, { name: 'Corner Store', phone: '98765 11111', contact: 'Anil', location: 'MG Road, Thrissur', budget: '25000', remarks: 'Wants a demo' });
  await page.getByRole('checkbox', { name: 'Digital Marketing' }).click();
  await page.getByRole('checkbox', { name: 'Other / Custom Requirement' }).click();
  await page.getByLabel('Other requirement').fill('Inventory app');
  await page.getByRole('button', { name: 'Submit visit' }).click();

  await expect(page.getByTestId('notice')).toHaveText('1 visit sent.');
  await expect(page.getByRole('button', { name: /Corner Store/ })).toContainText('Pending review');
  const rows = await backend.sql('SELECT salesperson_id, salesperson_email, company_id, status, phone_normalized, requirements, requirement_other, estimated_budget::text AS budget FROM field_visits');
  expect(rows).toEqual([{ salesperson_id: U.salesA, salesperson_email: EMAIL.salesA, company_id: A, status: 'submitted', phone_normalized: '9876511111',
    requirements: ['digital_marketing', 'other'], requirement_other: 'Inventory app', budget: '25000.00' }]);

  // Detail and history.
  await page.getByRole('button', { name: /Corner Store/ }).click();
  await expect(page.getByTestId('field-visit-detail')).toContainText('Digital Marketing, Other: Inventory app');
  await expect(page.getByTestId('field-visit-detail')).toContainText('₹25,000');
  await expect(page.getByTestId('field-visit-detail')).toContainText('Submitted');
});

test('tapping Submit twice sends one visit, and a draft can be saved, reopened, edited and deleted', async ({ page }) => {
  await signIn(page, EMAIL.salesA);
  await page.getByRole('button', { name: '+ New visit' }).click();
  await fillVisit(page, { name: 'Double Tap Traders', phone: '9000022222' });
  await page.getByRole('button', { name: 'Submit visit' }).dblclick();
  await expect(page.getByRole('button', { name: /Double Tap Traders/ })).toContainText('Pending review');
  expect(await backend.sql("SELECT count(*)::int AS n FROM field_visits WHERE business_name = 'Double Tap Traders'")).toEqual([{ n: 1 }]);
  expect(await backend.sql('SELECT count(*)::int AS n FROM field_visit_events')).toEqual([{ n: 1 }]);

  // Draft: stays on the phone, is not sent.
  await page.getByRole('button', { name: '+ New visit' }).click();
  await fillVisit(page, { name: 'Half Entered Shop', phone: '' });
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByTestId('notice')).toHaveText('Draft saved on this phone.');
  await expect(page.getByRole('button', { name: /Half Entered Shop/ })).toContainText('Draft');
  await page.reload();
  await expect(page.getByRole('button', { name: /Half Entered Shop/ })).toContainText('Draft');     // survives a restart
  expect(await backend.sql('SELECT count(*)::int AS n FROM field_visits')).toEqual([{ n: 1 }]);

  await page.getByRole('button', { name: /Half Entered Shop/ }).click();
  await expect(page.getByLabel('Business name')).toHaveValue('Half Entered Shop');
  await page.getByLabel('Phone number').fill('9000033333');
  await page.getByRole('button', { name: 'Submit visit' }).click();
  await expect(page.getByRole('button', { name: /Half Entered Shop/ })).toContainText('Pending review');
  expect(await backend.sql('SELECT count(*)::int AS n FROM field_visits')).toEqual([{ n: 2 }]);

  await page.getByRole('button', { name: '+ New visit' }).click();
  await fillVisit(page, { name: 'Mistake', phone: '' });
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.getByRole('button', { name: /Mistake/ }).click();
  await page.getByRole('button', { name: 'Delete this draft' }).click();
  await expect(page.getByRole('button', { name: /Mistake/ })).toHaveCount(0);
});

test('offline: visits are kept on the phone, shown as waiting, and sent once when the connection returns', async ({ page }) => {
  await signIn(page, EMAIL.salesA);
  await ready(page);

  await goOffline(page);
  await expect(page.getByText('You are offline.')).toBeVisible();
  for (const [name, phone] of [['Offline Shop One', '9000044444'], ['Offline Shop Two', '9000055555']]) {
    await page.getByRole('button', { name: '+ New visit' }).click();
    await fillVisit(page, { name, phone });
    await page.getByRole('button', { name: 'Submit visit' }).click();
    await expect(page.getByRole('button', { name: new RegExp(name) })).toContainText('Waiting to send');
  }
  await expect(page.getByTestId('sync-status')).toContainText('2 waiting to send');
  expect(await backend.sql('SELECT count(*)::int AS n FROM field_visits')).toEqual([{ n: 0 }]);
  // Pressing "Send now" while offline loses nothing.
  await page.getByRole('button', { name: 'Send now' }).click();
  await expect(page.getByTestId('sync-status')).toContainText('2 waiting to send');

  await goOnline(page);                                  // the app sends by itself
  await expect(page.getByTestId('notice')).toHaveText('2 visits sent.');
  await expect(page.getByTestId('sync-status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Offline Shop One/ })).toContainText('Pending review');
  expect(await backend.sql('SELECT business_name FROM field_visits ORDER BY business_name')).toEqual([{ business_name: 'Offline Shop One' }, { business_name: 'Offline Shop Two' }]);
  expect(await backend.sql('SELECT count(*)::int AS n FROM field_visit_events')).toEqual([{ n: 2 }]);
});

test('server unreachable and the app restarted: the screens still open, the visit waits, and it is sent after the server returns', async ({ page }) => {
  await signIn(page, EMAIL.salesA);
  await ready(page);

  backend.reachable = false;
  await page.getByRole('button', { name: '+ New visit' }).click();
  await fillVisit(page, { name: 'No Signal Stores', phone: '9000066666' });
  await page.getByRole('button', { name: 'Submit visit' }).click();
  await expect(page.getByRole('button', { name: /No Signal Stores/ })).toContainText('Waiting to send');

  await page.reload();                                   // app restart with the server still unreachable
  await expect(page.getByTestId('field-sales-app')).toBeVisible();                                  // opened from remembered access
  await expect(page.getByRole('button', { name: /No Signal Stores/ })).toContainText('Waiting to send');
  expect(await backend.sql('SELECT count(*)::int AS n FROM field_visits')).toEqual([{ n: 0 }]);

  backend.reachable = true;
  await page.getByRole('button', { name: 'Send now' }).click();
  await expect(page.getByRole('button', { name: /No Signal Stores/ })).toContainText('Pending review');
  expect(await backend.sql('SELECT count(*)::int AS n FROM field_visits')).toEqual([{ n: 1 }]);
});

test('a visit the office sends back can be corrected and resubmitted; a refused visit shows the reason and is kept', async ({ page }) => {
  await signIn(page, EMAIL.salesA);
  await page.getByRole('button', { name: '+ New visit' }).click();
  await fillVisit(page, { name: 'Needs Fixing Ltd', phone: '9000077777' });
  await page.getByRole('button', { name: 'Submit visit' }).click();
  await expect(page.getByRole('button', { name: /Needs Fixing Ltd/ })).toContainText('Pending review');

  // The office (acting directly on the database functions) asks for a correction.
  const [{ id }] = await backend.sql('SELECT id FROM field_visits');
  await backend.sql("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: 'authenticated', sub: U.owner })]);
  await backend.db.exec('SET ROLE authenticated');
  await backend.db.query("SELECT review_field_visit($1, 'request_correction', 'Phone number looks wrong')", [id]);

  await page.reload();
  const row = page.getByRole('button', { name: /Needs Fixing Ltd/ });
  await expect(row).toContainText('Needs correction');
  await expect(row).toContainText('Office note: Phone number looks wrong');
  await row.click();
  await page.getByRole('button', { name: 'Correct and resubmit' }).click();
  await expect(page.getByText('Office note: Phone number looks wrong')).toBeVisible();
  await page.getByLabel('Phone number').fill('9000088888');
  await page.getByRole('button', { name: 'Resubmit' }).click();
  await expect(page.getByRole('button', { name: /Needs Fixing Ltd/ })).toContainText('Pending review');
  expect(await backend.sql('SELECT status, phone FROM field_visits')).toEqual([{ status: 'submitted', phone: '9000088888' }]);
  expect((await backend.sql('SELECT action FROM field_visit_events ORDER BY id')).map(r => r.action)).toEqual(['submitted', 'correction_requested', 'resubmitted']);

  // Access removed while a visit is being written: the server refuses it, the phone keeps it and says why.
  await page.getByRole('button', { name: '+ New visit' }).click();
  await fillVisit(page, { name: 'After Access Removed', phone: '9000099999' });
  await backend.sql('UPDATE field_sales_members SET active = false WHERE user_id = $1', [U.salesA]);
  await page.getByRole('button', { name: 'Submit visit' }).click();
  const refused = page.getByRole('button', { name: /After Access Removed/ });
  await expect(refused).toContainText('Not sent');
  await expect(refused).toContainText(/access denied/i);
  await page.reload();
  await expect(page.getByRole('button', { name: /After Access Removed/ })).toContainText('Not sent');
  expect(await backend.sql("SELECT count(*)::int AS n FROM field_visits WHERE business_name = 'After Access Removed'")).toEqual([{ n: 0 }]);
});

test('signing out keeps unsent visits for that user only; another salesperson on the same phone does not see them', async ({ page }) => {
  await signIn(page, EMAIL.salesA);
  await ready(page);
  await goOffline(page);
  await page.getByRole('button', { name: '+ New visit' }).click();
  await fillVisit(page, { name: 'Private To Sales A', phone: '9000012121' });
  await page.getByRole('button', { name: 'Submit visit' }).click();
  await expect(page.getByRole('button', { name: /Private To Sales A/ })).toContainText('Waiting to send');
  await page.context().setOffline(false);                // connection back, but the server still cannot be reached: it stays unsent
  await page.getByRole('button', { name: 'Sign out' }).click();   // confirm dialog is accepted
  await expect(page.locator('input[type="email"]')).toBeVisible();   // signed out on this phone although the server was unreachable
  backend.reachable = true;

  await signIn(page, EMAIL.salesA2);
  await expect(page.getByTestId('field-sales-app')).toBeVisible();
  await expect(page.getByText(EMAIL.salesA2)).toBeVisible();
  await expect(page.getByRole('button', { name: /Private To Sales A/ })).toHaveCount(0);
  expect(await backend.sql('SELECT count(*)::int AS n FROM field_visits')).toEqual([{ n: 0 }]);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('input[type="email"]')).toBeVisible();

  await signIn(page, EMAIL.salesA);                      // back again: it is sent now, under the right name
  await expect(page.getByRole('button', { name: /Private To Sales A/ })).toContainText('Pending review');
  expect(await backend.sql('SELECT salesperson_email FROM field_visits')).toEqual([{ salesperson_email: EMAIL.salesA }]);
});

test('the form and dashboard fit a phone screen without sideways scrolling, with touch-sized controls', async ({ page }) => {
  await signIn(page, EMAIL.salesA);
  await ready(page);
  const fits = async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(await fits()).toBe(true);
  await page.getByRole('button', { name: '+ New visit' }).click();
  expect(await fits()).toBe(true);
  for (const name of ['Save draft', 'Submit visit']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(box!.height, `${name} is at least 44px tall`).toBeGreaterThanOrEqual(44);
  }
  for (const name of ['Digital Marketing', 'Graphic Designing']) {
    // The tap target is the whole row (the label wrapping the checkbox), not just the small checkbox glyph.
    const box = await page.getByRole('checkbox', { name, exact: true }).locator('xpath=..').boundingBox();
    expect(box!.height, `${name} row is at least 44px tall`).toBeGreaterThanOrEqual(44);
  }
  for (const label of ['Business name', 'Phone number']) {
    const box = await page.getByLabel(label).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(await page.getByLabel(label).evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  }
});
