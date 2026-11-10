// Database tests for the Field Sales Data Collection migration.
//
// Runs entirely inside an in-memory Postgres (PGlite). Nothing here connects to
// Supabase. The schema comes from tests/fixtures/live-schema-2026-11-10.sql, a
// read-only capture of the live objects this migration depends on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const FIXTURE = read('./fixtures/live-schema-2026-11-10.sql');
const MIGRATION = read('../database/migrations/20261110000001_field_sales_data_collection.sql');
const ROLLBACK = read('../database/rollback/20261110000001_field_sales_data_collection_rollback.sql');

const id = n => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const U = { owner: id(1), admin: id(2), staffA: id(3), staffB: id(4), salesA: id(5), salesA2: id(6), salesB: id(7), nobody: id(8) };
const EMAIL = { owner: 'owner@example.test', admin: 'admin@example.test', staffA: 'staff.a@example.test', staffB: 'staff.b@example.test',
  salesA: 'sales.a@example.test', salesA2: 'sales.a2@example.test', salesB: 'sales.b@example.test', nobody: 'nobody@example.test' };
const A = id(101), B = id(102);              // two companies
const LEAD_A = id(201), LEAD_B = id(202);

// The 19 tables that were open to every signed-in account before this migration.
const OPEN_TABLES = [
  'account_groups', 'account_heads', 'bank_accounts', 'bank_reconciliation_statements', 'customer_receipts', 'expenses',
  'financial_audit_logs', 'financial_period_locks', 'financial_year_closures', 'journal_entries', 'purchase_bills',
  'supplier_payments', 'suppliers', 'bookings', 'resources', 'google_sync_log', 'google_sync_queue', 'google_sync_settings',
  'lead_activity'
];
// Company-scoped CRM tables a salesperson must never reach.
const CRM_TABLES = ['leads', 'lead_activities', 'follow_ups', 'customers', 'services', 'crm_quotations', 'comparison_templates',
  'telecalling_entries', 'telecalling_google_sync_queue', 'profiles', 'documents', 'whatsapp_conversations'];
const NEW_TABLES = ['field_visits', 'field_visit_events', 'field_sales_members'];

const insertSql = table => ({
  lead_activity: [`INSERT INTO lead_activity(company_id, lead_id, user_email, action) VALUES ($1, '${LEAD_A}', 'x@example.test', 'note')`],
  leads: ['INSERT INTO leads(company_id, customer_name) VALUES ($1, \'Probe\')'],
  lead_activities: ['INSERT INTO lead_activities(company_id, type, notes) VALUES ($1, \'Note Logged\', \'probe\')'],
  follow_ups: ['INSERT INTO follow_ups(company_id, follow_up_date) VALUES ($1, current_date)'],
  customers: ['INSERT INTO customers(company_id, name) VALUES ($1, \'Probe\')'],
  services: ['INSERT INTO services(company_id, name) VALUES ($1, \'Probe\')'],
  telecalling_entries: ['INSERT INTO telecalling_entries(company_id, company_name, phone, call_status) VALUES ($1, \'Probe\', \'9000000000\', \'Interested\')'],
  profiles: ['INSERT INTO profiles(id, name) VALUES ($1, \'Probe company\')']
}[table] || [`INSERT INTO ${table}(company_id) VALUES ($1)`])[0];

/** Act as the database administrator (bypasses RLS, as the SQL editor does). */
async function asAdmin(db) {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('test.uid', '', false), set_config('test.role', 'service_role', false)");
}
/** Act as a signed-in app user, or as an anonymous caller when uid is null. */
async function as(db, uid) {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('test.uid', $1, false), set_config('test.role', $2, false)", [uid || '', uid ? 'authenticated' : 'anon']);
  await db.exec(`SET ROLE ${uid ? 'authenticated' : 'anon'}`);
}
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const count = async (db, table, where = 'true') => Number((await one(db, `SELECT count(*) AS n FROM ${table} WHERE ${where}`)).n);
const DENIED = /permission denied|row-level security|access denied|not found|Sign in/i;

async function seedBase(db) {
  await asAdmin(db);
  for (const [key, uid] of Object.entries(U)) {
    await db.query('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, now())', [uid, EMAIL[key]]);
  }
  await db.query('INSERT INTO profiles(id, name) VALUES ($1, $2), ($3, $4)', [A, 'Company A', B, 'Company B']);
  await db.query("INSERT INTO app_members(user_id, role) VALUES ($1,'owner'), ($2,'admin'), ($3,'staff'), ($4,'staff')", [U.owner, U.admin, U.staffA, U.staffB]);
  await db.query('INSERT INTO app_company_members(user_id, company_id) VALUES ($1,$2), ($3,$4)', [U.staffA, A, U.staffB, B]);
  await db.query(`INSERT INTO leads(id, company_id, customer_name, company_name, phone, assigned_telecaller_email)
    VALUES ($1, $2, 'Existing A', 'Existing Shop A', '+91 98765 43210', $3), ($4, $5, 'Existing B', 'Existing Shop B', '9000000001', $6)`,
    [LEAD_A, A, EMAIL.staffA, LEAD_B, B, EMAIL.staffB]);
  for (const table of [...OPEN_TABLES, ...CRM_TABLES.filter(t => !['leads', 'profiles'].includes(t))]) {
    for (const company of [A, B]) await db.query(insertSql(table), [company]);
  }
}

async function seedSales(db) {
  await asAdmin(db);
  await db.query("INSERT INTO app_members(user_id, role) VALUES ($1,'sales'), ($2,'sales'), ($3,'sales')", [U.salesA, U.salesA2, U.salesB]);
  await db.query('INSERT INTO field_sales_members(user_id, company_id) VALUES ($1,$2), ($3,$4), ($5,$6)', [U.salesA, A, U.salesA2, A, U.salesB, B]);
}

/** Fresh database: live-shaped schema, seed data, then the migration. */
async function setup({ migrate = true, sales = true } = {}) {
  const db = new PGlite();
  await db.exec(FIXTURE);
  await seedBase(db);
  if (migrate) {
    await asAdmin(db);
    await db.exec(MIGRATION);
    if (sales) await seedSales(db);
  }
  return db;
}

const visit = (n, overrides = {}) => ({
  id: id(1000 + n), company_id: A, business_name: `Shop ${n}`, phone: `90000 ${String(10000 + n)}`, location: 'Thrissur',
  contact_person: `Contact ${n}`, requirements: ['website', 'crm'], estimated_budget: '25000', remarks: 'Wants a demo',
  follow_up_date: null, ...overrides
});
const save = async (db, payload) => (await one(db, 'SELECT save_field_visit($1) AS r', [JSON.stringify(payload)])).r;
const review = async (db, visitId, action, note = null) => (await one(db, 'SELECT review_field_visit($1, $2, $3) AS r', [visitId, action, note])).r;
const convert = async (db, visitId, { assignee = null, existing = null, force = false, date = null } = {}) =>
  (await one(db, 'SELECT convert_field_visit_to_lead($1, $2, $3, $4, $5) AS r', [visitId, assignee, existing, force, date])).r;
const tomorrow = async db => (await one(db, "SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date + 1)::text AS d")).d;

/** Submit as a salesperson and approve as the owner; returns the visit id. */
async function approvedVisit(db, n, overrides = {}, salesperson = U.salesA) {
  await as(db, salesperson);
  const saved = await save(db, visit(n, overrides));
  await as(db, U.owner);
  await review(db, saved.visit.id, 'approve');
  return saved.visit.id;
}

/** Every read returns nothing and every write is refused or touches no row. */
async function assertNoAccess(db, uid, table, label) {
  await as(db, uid);
  let visible = 0;
  try { visible = await count(db, table); } catch (error) { assert.match(error.message, DENIED, `${label}: ${table} read`); }
  assert.equal(visible, 0, `${label} must not read ${table}`);
  await assert.rejects(db.query(insertSql(table), [table === 'profiles' ? id(999) : A]), DENIED, `${label} must not insert into ${table}`);
  for (const sql of [`UPDATE ${table} SET company_id = company_id`, `DELETE FROM ${table}`]) {
    const statement = table === 'profiles' ? sql.replace('company_id = company_id', 'name = name') : sql;
    try {
      const result = await db.query(statement);
      assert.equal(result.affectedRows, 0, `${label} must not change ${table}`);
    } catch (error) { assert.match(error.message, DENIED, `${label}: ${table} write`); }
  }
}

// ---------------------------------------------------------------------------

test('fixture reproduces the gap: before the migration any signed-in account reaches all 19 open tables', async () => {
  const db = await setup({ migrate: false });
  try {
    await as(db, U.nobody);                 // confirmed account with no app_members row
    for (const table of OPEN_TABLES) assert.equal(await count(db, table), 2, `${table} is readable before the migration`);
    await as(db, null);
    for (const table of OPEN_TABLES) assert.equal(await count(db, table), 0, `${table} is not readable anonymously`);
  } finally { await db.close(); }
});

test('migration is additive and re-runnable, and leaves owner, admin and staff access unchanged', async () => {
  const db = await setup();
  try {
    await asAdmin(db);
    await db.exec(MIGRATION);               // second run must be a no-op
    assert.equal(await count(db, 'leads'), 2);
    assert.equal(await count(db, 'app_members', "role = 'sales'"), 3);

    for (const [uid, label] of [[U.owner, 'owner'], [U.admin, 'admin'], [U.staffA, 'staff']]) {
      await as(db, uid);
      for (const table of OPEN_TABLES) {
        assert.equal(await count(db, table), 2, `${label} still reads ${table}`);
        await db.query(insertSql(table), [A]);
        assert.equal(await count(db, table), 3, `${label} still writes ${table}`);
        assert.equal((await db.query(`DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE company_id = $1 LIMIT 1)`, [A])).affectedRows, 1);
      }
    }
    // Existing company isolation for staff is untouched.
    await as(db, U.staffA);
    assert.equal(await count(db, 'leads'), 1);
    assert.equal((await one(db, 'SELECT company_id FROM leads')).company_id, A);
    await db.query("INSERT INTO leads(company_id, customer_name, lead_source) VALUES ($1, 'Staff lead', 'phone')", [A]);
    await assert.rejects(db.query("INSERT INTO leads(company_id, customer_name) VALUES ($1, 'Cross company')", [B]), /row-level security/);
    // The nine original lead sources still work and an unknown one is still rejected.
    await assert.rejects(db.query("INSERT INTO leads(company_id, customer_name, lead_source) VALUES ($1, 'x', 'whatsapp')", [A]), /leads_lead_source_check/);
  } finally { await db.close(); }
});

test('sales users, accounts with no role and anonymous callers are denied on all 19 restricted tables', async () => {
  const db = await setup();
  try {
    for (const table of OPEN_TABLES) {
      await assertNoAccess(db, U.salesA, table, 'sales');
      await assertNoAccess(db, U.nobody, table, 'no-role account');
      await assertNoAccess(db, null, table, 'anonymous');
      await asAdmin(db);
      assert.equal(await count(db, table), 2, `${table} rows are intact`);
    }
  } finally { await db.close(); }
});

test('sales users cannot reach leads, customers, follow-ups, quotations, telecalling, documents, WhatsApp or company profiles', async () => {
  const db = await setup();
  try {
    for (const table of CRM_TABLES) {
      await assertNoAccess(db, U.salesA, table, 'sales');
      await assertNoAccess(db, null, table, 'anonymous');
    }
    await as(db, U.salesA);
    assert.equal((await one(db, 'SELECT can_access_company($1) AS ok', [A])).ok, false);
    assert.equal((await one(db, 'SELECT current_app_role() AS role')).role, 'sales');
    await asAdmin(db);
    assert.equal(await count(db, 'leads'), 2);
    assert.equal(await count(db, 'customers'), 2);
  } finally { await db.close(); }
});

test('sales users cannot change roles or memberships, and the sales role excludes normal company membership', async () => {
  const db = await setup();
  try {
    await as(db, U.salesA);
    for (const sql of [
      "UPDATE app_members SET role = 'owner' WHERE user_id = auth.uid()",
      `INSERT INTO app_company_members(user_id, company_id) VALUES ('${U.salesA}', '${A}')`,
      `INSERT INTO field_sales_members(user_id, company_id) VALUES ('${U.salesA}', '${B}')`,
      'SELECT * FROM field_sales_members', 'SELECT * FROM app_members'
    ]) await assert.rejects(db.query(sql), /permission denied/);
    await assert.rejects(db.query('SELECT field_visit_assignee_ok($1, $2)', [A, EMAIL.owner]), /permission denied/);

    await asAdmin(db);
    await assert.rejects(db.query('INSERT INTO app_company_members(user_id, company_id) VALUES ($1, $2)', [U.salesA, A]), /cannot be given normal company membership/);
    await assert.rejects(db.query("UPDATE app_members SET role = 'sales' WHERE user_id = $1", [U.staffA]), /Remove this user's app_company_members rows/);
    await assert.rejects(db.query('INSERT INTO field_sales_members(user_id, company_id) VALUES ($1, $2)', [U.staffA, A]), /only for users whose app_members role is sales/);
    await assert.rejects(db.query("INSERT INTO app_members(user_id, role) VALUES ($1, 'manager')", [U.nobody]), /app_members_role_check/);
  } finally { await db.close(); }
});

test('anonymous callers cannot read the new tables or run any field-sales function', async () => {
  const db = await setup();
  try {
    await as(db, U.salesA);
    const saved = await save(db, visit(1));
    await as(db, null);
    for (const table of NEW_TABLES) await assert.rejects(db.query(`SELECT * FROM ${table}`), /permission denied/);
    for (const [sql, params] of [
      ['SELECT save_field_visit($1)', [JSON.stringify(visit(2))]],
      ['SELECT review_field_visit($1, $2, $3)', [saved.visit.id, 'approve', null]],
      ['SELECT convert_field_visit_to_lead($1)', [saved.visit.id]],
      ['SELECT * FROM my_field_sales_companies()', []],
      ['SELECT * FROM field_visit_assignees($1)', [A]],
      ['SELECT field_sales_can_submit($1)', [A]],
      ['SELECT field_visit_can_review($1)', [A]],
      ['SELECT field_visit_normalize_phone($1)', ['9']]
    ]) await assert.rejects(db.query(sql, params), /permission denied/);
    await asAdmin(db);
    assert.equal(await count(db, 'field_visits'), 1);
  } finally { await db.close(); }
});

test('a salesperson submits visits with server-controlled identity and sees only their own', async () => {
  const db = await setup();
  try {
    await as(db, U.salesA);
    assert.deepEqual((await db.query('SELECT id, name FROM my_field_sales_companies()')).rows, [{ id: A, name: 'Company A' }]);

    // Forged identity, status, review and conversion fields are ignored.
    const saved = await save(db, visit(1, {
      salesperson_id: U.owner, salesperson_email: EMAIL.owner, status: 'approved', reviewed_by: U.owner,
      lead_id: LEAD_A, converted_by: U.owner, created_at: '2001-01-01T00:00:00Z', phone: '+91 98765 11111'
    }));
    assert.equal(saved.result, 'submitted');
    assert.equal(saved.visit.salesperson_id, U.salesA);
    assert.equal(saved.visit.salesperson_email, EMAIL.salesA);
    assert.equal(saved.visit.status, 'submitted');
    assert.equal(saved.visit.phone_normalized, '9876511111');
    assert.equal(saved.visit.lead_id, null);
    assert.equal(saved.visit.reviewed_by, null);
    assert.deepEqual(saved.visit.requirements, ['crm', 'website']);

    // Direct writes to the tables are impossible; only the functions write.
    for (const sql of [
      `INSERT INTO field_visits(id, company_id, salesperson_email, business_name, phone, phone_normalized) VALUES ('${id(1999)}', '${A}', 'x', 'x', '9', '900000')`,
      "UPDATE field_visits SET status = 'approved'", 'DELETE FROM field_visits',
      "UPDATE field_visit_events SET note = 'edited'", 'DELETE FROM field_visit_events'
    ]) await assert.rejects(db.query(sql), /permission denied/);

    // Validation happens on the server.
    for (const [bad, message] of [
      [{ business_name: '  ' }, /Business name is required/], [{ phone: '12' }, /valid phone number/],
      [{ requirements: ['website', 'payroll'] }, /Unknown requirement/], [{ estimated_budget: '-5' }, /budget/],
      [{ id: 'not-a-uuid' }, /Invalid field visit/], [{ follow_up_date: 'tomorrow' }, /Invalid field visit/]
    ]) await assert.rejects(save(db, visit(50, bad)), message);

    // Another salesperson of the same company cannot see or overwrite it.
    await as(db, U.salesA2);
    assert.equal(await count(db, 'field_visits'), 0);
    assert.equal(await count(db, 'field_visit_events'), 0);
    await assert.rejects(save(db, visit(1, { business_name: 'Hijacked' })), /access denied/);
    await save(db, visit(2));
    assert.equal(await count(db, 'field_visits'), 1);

    await as(db, U.salesA);
    assert.equal(await count(db, 'field_visits'), 1);
    assert.equal(await count(db, 'field_visit_events'), 1);
    // Staff are not reviewers and not submitters.
    await as(db, U.staffA);
    assert.equal(await count(db, 'field_visits'), 0);
    await assert.rejects(save(db, visit(3)), /access denied/);
    await as(db, U.nobody);
    await assert.rejects(save(db, visit(4)), /access denied/);
  } finally { await db.close(); }
});

test('saving is idempotent: retries never create a second visit or a second event', async () => {
  const db = await setup();
  try {
    await as(db, U.salesA);
    const first = await save(db, visit(1));
    const retry = await save(db, visit(1));
    const again = await save(db, visit(1, { status: 'approved' }));
    assert.equal(first.result, 'submitted');
    assert.equal(retry.result, 'unchanged');
    assert.equal(again.result, 'unchanged');
    assert.equal(retry.visit.updated_at, first.visit.updated_at);
    const edited = await save(db, visit(1, { remarks: 'Call after 5pm' }));
    assert.equal(edited.result, 'updated');
    await asAdmin(db);
    assert.equal(await count(db, 'field_visits'), 1);
    assert.deepEqual((await db.query('SELECT action FROM field_visit_events ORDER BY id')).rows.map(r => r.action), ['submitted', 'updated']);
  } finally { await db.close(); }
});

test('cross-company isolation: a visit cannot be created in, moved to, or read from another company', async () => {
  const db = await setup();
  try {
    await as(db, U.salesA);
    await assert.rejects(save(db, visit(1, { company_id: B })), /access denied/);
    await assert.rejects(save(db, visit(1, { company_id: id(555) })), /access denied/);
    await assert.rejects(save(db, visit(1, { company_id: null })), /access denied/);
    const mine = await save(db, visit(1));
    await assert.rejects(save(db, visit(1, { company_id: B, remarks: 'moved' })), /cannot be moved/);

    await as(db, U.salesB);
    const theirs = await save(db, visit(2, { company_id: B }));
    assert.equal(await count(db, 'field_visits'), 1);
    assert.equal((await one(db, 'SELECT company_id FROM field_visits')).company_id, B);
    await assert.rejects(save(db, visit(1, { company_id: B })), /access denied/);   // cannot take over company A's visit id

    // A staff member of company B is not an eligible assignee for company A.
    await as(db, U.owner);
    await review(db, mine.visit.id, 'approve');
    await assert.rejects(convert(db, mine.visit.id, { assignee: EMAIL.staffB }), /assignee must be an active owner, admin or staff member of this company/);
    // A lead of company B cannot be linked to a visit of company A.
    await assert.rejects(convert(db, mine.visit.id, { existing: LEAD_B }), /Lead not found in this company/);
    assert.deepEqual((await db.query('SELECT email FROM field_visit_assignees($1)', [A])).rows.map(r => r.email), [EMAIL.owner, EMAIL.admin, EMAIL.staffA]);

    await asAdmin(db);
    assert.equal((await one(db, 'SELECT status FROM field_visits WHERE id = $1', [mine.visit.id])).status, 'approved');
    assert.equal((await one(db, 'SELECT company_id FROM field_visits WHERE id = $1', [theirs.visit.id])).company_id, B);
    assert.equal(await count(db, 'leads'), 2);
  } finally { await db.close(); }
});

test('access is re-checked on the server every time: deactivation, ban, membership removal and stray company membership', async () => {
  const db = await setup();
  try {
    await as(db, U.salesA);
    await save(db, visit(1));

    const expectLockedOut = async label => {
      await as(db, U.salesA);
      await assert.rejects(save(db, visit(2)), /access denied/, `${label}: new visit`);
      await assert.rejects(save(db, visit(1, { remarks: 'edit' })), /access denied/, `${label}: edit`);
      assert.equal(await count(db, 'field_visits'), 0, `${label}: read`);
      assert.equal((await db.query('SELECT * FROM my_field_sales_companies()')).rows.length, 0, `${label}: companies`);
    };

    await asAdmin(db);
    await db.query('UPDATE field_sales_members SET active = false WHERE user_id = $1', [U.salesA]);
    await expectLockedOut('field membership deactivated');
    await asAdmin(db);
    await db.query('UPDATE field_sales_members SET active = true WHERE user_id = $1', [U.salesA]);
    await db.query('UPDATE app_members SET active = false WHERE user_id = $1', [U.salesA]);
    await expectLockedOut('member deactivated');
    await asAdmin(db);
    await db.query('UPDATE app_members SET active = true WHERE user_id = $1', [U.salesA]);
    await db.query("UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = $1", [U.salesA]);
    await expectLockedOut('user banned');
    await asAdmin(db);
    await db.query('UPDATE auth.users SET banned_until = NULL WHERE id = $1', [U.salesA]);
    await db.query('DELETE FROM field_sales_members WHERE user_id = $1', [U.salesA]);
    await expectLockedOut('field membership removed');

    // Fail closed if a sales user somehow also holds normal company membership.
    await asAdmin(db);
    await db.query('INSERT INTO field_sales_members(user_id, company_id) VALUES ($1, $2)', [U.salesA, A]);
    await db.exec('ALTER TABLE app_company_members DISABLE TRIGGER field_sales_guard_membership');
    await db.query('INSERT INTO app_company_members(user_id, company_id) VALUES ($1, $2)', [U.salesA, A]);
    await expectLockedOut('stray company membership');

    await asAdmin(db);
    assert.equal(await count(db, 'field_visits'), 1);
  } finally { await db.close(); }
});

test('only owner and admin review; transitions, notes, retries and self-review are enforced and audited', async () => {
  const db = await setup();
  try {
    await as(db, U.salesA);
    const v1 = (await save(db, visit(1))).visit.id;
    const v2 = (await save(db, visit(2))).visit.id;
    const v3 = (await save(db, visit(3))).visit.id;

    for (const uid of [U.salesA, U.salesA2, U.staffA, U.nobody]) {
      await as(db, uid);
      await assert.rejects(review(db, v1, 'approve'), /Only the owner or an admin/);
      await assert.rejects(convert(db, v1), /Only the owner or an admin/);
    }

    await as(db, U.admin);
    await assert.rejects(review(db, id(4242), 'approve'), /Field visit not found/);
    await assert.rejects(review(db, v1, 'delete'), /Unknown review action/);
    await assert.rejects(review(db, v2, 'reject'), /note is required/);
    await assert.rejects(review(db, v3, 'request_correction', '   '), /note is required/);
    assert.equal((await review(db, v1, 'approve')).visit.status, 'approved');
    assert.equal((await review(db, v1, 'approve')).result, 'unchanged');
    assert.equal((await review(db, v2, 'reject', 'Not a real business')).visit.status, 'rejected');
    await assert.rejects(review(db, v2, 'approve'), /rejected field visit is closed/);
    assert.equal((await review(db, v3, 'request_correction', 'Phone number looks wrong')).visit.status, 'needs_correction');

    // The salesperson corrects and resubmits; a rejected or approved visit is locked for them.
    await as(db, U.salesA);
    assert.equal((await one(db, 'SELECT review_note FROM field_visits WHERE id = $1', [v3])).review_note, 'Phone number looks wrong');
    const fixed = await save(db, visit(3, { phone: '9000019999' }));
    assert.equal(fixed.result, 'resubmitted');
    assert.equal(fixed.visit.status, 'submitted');
    assert.equal((await save(db, visit(1, { remarks: 'late edit' }))).result, 'locked');
    assert.equal((await save(db, visit(2, { remarks: 'late edit' }))).result, 'locked');

    // Owner submits and approves their own visit: allowed, and flagged.
    await as(db, U.owner);
    const own = (await save(db, visit(9))).visit.id;
    await review(db, own, 'approve');

    await asAdmin(db);
    const events = (await db.query('SELECT visit_id, action, actor_email, actor_role, self_review, note FROM field_visit_events ORDER BY id')).rows;
    assert.deepEqual(events.filter(e => e.visit_id === v3).map(e => e.action), ['submitted', 'correction_requested', 'resubmitted']);
    assert.equal(events.filter(e => e.visit_id === v1 && e.action === 'approved').length, 1, 'a repeated approval is not logged twice');
    const selfApproval = events.find(e => e.visit_id === own && e.action === 'approved');
    assert.deepEqual([selfApproval.self_review, selfApproval.actor_email, selfApproval.actor_role], [true, EMAIL.owner, 'owner']);
    assert.equal(events.find(e => e.visit_id === v1 && e.action === 'approved').self_review, false);
    assert.equal(await count(db, 'leads'), 2, 'reviewing never creates a lead');
  } finally { await db.close(); }
});

test('conversion creates one lead, its activities and an optional follow-up; the salesperson is never the assignee', async () => {
  const db = await setup();
  try {
    const date = await tomorrow(db);
    await as(db, U.salesA);
    const submitted = (await save(db, visit(1, { requirements: ['other', 'billing_software'], requirement_other: 'Inventory app' }))).visit.id;
    await as(db, U.owner);
    await assert.rejects(convert(db, submitted), /Only an approved field visit can be converted/);
    await review(db, submitted, 'approve');
    await assert.rejects(convert(db, submitted, { assignee: EMAIL.salesA }), /assignee must be an active owner, admin or staff member/);
    await assert.rejects(convert(db, submitted, { assignee: 'stranger@example.test' }), /assignee must be/);
    await assert.rejects(convert(db, submitted, { date: '2020-01-01' }), /cannot be in the past/);

    // Default assignee is the reviewer.
    const result = await convert(db, submitted, { date });
    assert.equal(result.result, 'converted');
    assert.equal(result.mode, 'new_lead');
    assert.match(result.lead_number, /^B2P-LD-\d+$/);

    await asAdmin(db);
    const lead = await one(db, 'SELECT * FROM leads WHERE id = $1', [result.lead_id]);
    assert.equal(lead.company_id, A);
    assert.equal(lead.lead_source, 'field_visit');
    assert.equal(lead.assigned_telecaller_email, EMAIL.owner);
    assert.notEqual(lead.assigned_telecaller_email, EMAIL.salesA);
    assert.equal(lead.status, 'new');
    assert.equal(lead.priority, 'warm');
    assert.equal(lead.customer_name, 'Contact 1');
    assert.equal(lead.company_name, 'Shop 1');
    assert.equal(lead.service_required, 'Billing Software, Other: Inventory app');
    assert.equal(lead.source_details, `Field visit by ${EMAIL.salesA} [field-visit:${submitted}]`);
    assert.match(lead.notes, /Estimated budget: 25000/);
    assert.ok(lead.next_follow_up_at);

    const followUp = await one(db, 'SELECT * FROM follow_ups WHERE id = $1', [result.follow_up_id]);
    assert.equal(followUp.lead_id, lead.id);
    assert.equal(followUp.lead_number, lead.lead_number);
    assert.equal(followUp.assigned_staff_email, lead.assigned_telecaller_email);
    assert.equal(followUp.created_by_email, EMAIL.owner);
    assert.equal(followUp.status, 'pending');
    assert.equal(String(followUp.follow_up_time).slice(0, 5), '11:00');
    // The existing accountability trigger accepted the insert.
    assert.equal(await count(db, 'followup_review_state', `follow_up_id = '${followUp.id}'`), 1);
    assert.deepEqual((await db.query('SELECT type FROM lead_activities WHERE lead_id = $1 ORDER BY type', [lead.id])).rows.map(r => r.type),
      ['Follow-up Scheduled', 'Lead Created']);

    // An explicitly chosen eligible staff member becomes lead assignee and follow-up owner.
    const second = await approvedVisit(db, 2);
    const chosen = await convert(db, second, { assignee: `  ${EMAIL.staffA.toUpperCase()} `, date });
    await asAdmin(db);
    assert.equal((await one(db, 'SELECT assigned_telecaller_email AS e FROM leads WHERE id = $1', [chosen.lead_id])).e, EMAIL.staffA);
    assert.equal((await one(db, 'SELECT assigned_staff_email AS e FROM follow_ups WHERE id = $1', [chosen.follow_up_id])).e, EMAIL.staffA);

    // No follow-up date means no follow-up.
    const third = await approvedVisit(db, 3);
    const plain = await convert(db, third);
    assert.equal(plain.follow_up_id, null);
    await asAdmin(db);
    assert.equal((await one(db, 'SELECT next_follow_up_at AS at FROM leads WHERE id = $1', [plain.lead_id])).at, null);
    assert.equal(await count(db, 'leads', `assigned_telecaller_email IN ('${EMAIL.salesA}', '${EMAIL.salesA2}', '${EMAIL.salesB}')`), 0);

    // The salesperson sees the outcome on their visit but still cannot read the lead.
    await as(db, U.salesA);
    assert.equal((await one(db, 'SELECT status FROM field_visits WHERE id = $1', [submitted])).status, 'converted');
    assert.equal(await count(db, 'leads'), 0);
    assert.equal(await count(db, 'follow_ups'), 0);
  } finally { await db.close(); }
});

test('conversion is idempotent: repeating it never creates a second lead, follow-up or audit event', async () => {
  const db = await setup();
  try {
    const date = await tomorrow(db);
    const visitId = await approvedVisit(db, 1);
    const first = await convert(db, visitId, { date });
    await as(db, U.admin);                                   // a second reviewer retries
    const second = await convert(db, visitId, { date, force: true, assignee: EMAIL.staffA });
    const third = await convert(db, visitId, { existing: LEAD_A });
    assert.equal(second.result, 'already_converted');
    assert.equal(third.result, 'already_converted');
    assert.equal(second.lead_id, first.lead_id);
    assert.equal(second.lead_number, first.lead_number);
    assert.equal(second.follow_up_id, first.follow_up_id);
    await assert.rejects(review(db, visitId, 'reject', 'too late'), /can no longer be reviewed/);

    await asAdmin(db);
    assert.equal(await count(db, 'leads', "lead_source = 'field_visit'"), 1);
    assert.equal(await count(db, 'follow_ups', `lead_id = '${first.lead_id}'`), 1);
    assert.equal(await count(db, 'field_visit_events', `visit_id = '${visitId}' AND action LIKE 'converted%'`), 1);
    assert.equal((await one(db, 'SELECT assigned_telecaller_email AS e FROM leads WHERE id = $1', [first.lead_id])).e, EMAIL.owner);
  } finally { await db.close(); }
});

test('conversion is atomic: a failure in the follow-up step leaves no lead, no activity and the visit still approved', async () => {
  const db = await setup();
  try {
    const date = await tomorrow(db);
    const visitId = await approvedVisit(db, 1);
    await asAdmin(db);
    const counter = async () => Number((await one(db, 'SELECT coalesce(max(last_number), 0) AS n FROM lead_number_counters WHERE company_id = $1', [A])).n);
    const before = { leads: await count(db, 'leads'), activities: await count(db, 'lead_activities'), followUps: await count(db, 'follow_ups'), counter: await counter() };
    await db.exec(`CREATE FUNCTION public.test_fail_followup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated follow-up failure'; END $$;
      CREATE TRIGGER test_fail_followup BEFORE INSERT ON public.follow_ups FOR EACH ROW EXECUTE FUNCTION public.test_fail_followup();`);

    await as(db, U.owner);
    await assert.rejects(convert(db, visitId, { date }), /simulated follow-up failure/);

    await asAdmin(db);
    assert.equal(await count(db, 'leads'), before.leads);
    assert.equal(await count(db, 'lead_activities'), before.activities);
    assert.equal(await count(db, 'follow_ups'), before.followUps);
    assert.equal(await counter(), before.counter, 'no lead number was consumed');
    const stored = await one(db, 'SELECT status, lead_id, follow_up_id, converted_at FROM field_visits WHERE id = $1', [visitId]);
    assert.deepEqual(stored, { status: 'approved', lead_id: null, follow_up_id: null, converted_at: null });
    assert.equal(await count(db, 'field_visit_events', `visit_id = '${visitId}' AND action LIKE 'converted%'`), 0);

    await db.exec('DROP TRIGGER test_fail_followup ON public.follow_ups; DROP FUNCTION public.test_fail_followup();');
    await as(db, U.owner);
    assert.equal((await convert(db, visitId, { date })).result, 'converted');   // works once the cause is removed
  } finally { await db.close(); }
});

test('duplicate protection: a phone match creates nothing until the reviewer links the lead or explicitly forces a new one', async () => {
  const db = await setup();
  try {
    const date = await tomorrow(db);
    // Same number as the existing lead of company A, written differently.
    const match = await approvedVisit(db, 1, { phone: '098765-43210' });
    const blocked = await convert(db, match, { date });
    assert.equal(blocked.result, 'duplicates_found');
    assert.deepEqual(blocked.matches.map(m => m.id), [LEAD_A]);
    await asAdmin(db);
    assert.equal(await count(db, 'leads'), 2);
    assert.equal(await count(db, 'follow_ups', "reason = 'Field visit follow-up'"), 0);
    assert.equal((await one(db, 'SELECT status FROM field_visits WHERE id = $1', [match])).status, 'approved');

    // Link to the existing lead: no new lead, the lead keeps its assignee, the follow-up goes to that assignee.
    await as(db, U.owner);
    const linked = await convert(db, match, { existing: LEAD_A, date });
    assert.equal(linked.mode, 'linked_existing');
    assert.equal(linked.lead_id, LEAD_A);
    await asAdmin(db);
    assert.equal(await count(db, 'leads'), 2);
    const existing = await one(db, 'SELECT assigned_telecaller_email AS e, lead_source AS s FROM leads WHERE id = $1', [LEAD_A]);
    assert.deepEqual(existing, { e: EMAIL.staffA, s: 'other' });
    assert.equal((await one(db, 'SELECT assigned_staff_email AS e FROM follow_ups WHERE id = $1', [linked.follow_up_id])).e, EMAIL.staffA);
    assert.equal(await count(db, 'lead_activities', `lead_id = '${LEAD_A}' AND type = 'Field Visit Linked'`), 1);

    // The same phone in the OTHER company is not a duplicate.
    await asAdmin(db);
    await db.query('INSERT INTO field_sales_members(user_id, company_id) VALUES ($1, $2)', [U.salesB, A]);
    const otherCompany = await approvedVisit(db, 2, { phone: '9000000001' }, U.salesB);   // matches a lead of company B only
    assert.equal((await convert(db, otherCompany)).result, 'converted');

    // Force a new lead despite a match: allowed, and recorded in the audit trail.
    const forced = await approvedVisit(db, 3, { phone: '9876543210' });
    assert.equal((await convert(db, forced)).result, 'duplicates_found');
    const created = await convert(db, forced, { force: true });
    assert.equal(created.mode, 'new_lead');
    await asAdmin(db);
    const event = await one(db, "SELECT details FROM field_visit_events WHERE visit_id = $1 AND action = 'converted_new_lead'", [forced]);
    assert.deepEqual(event.details.forced_new_despite_matches.map(m => m.id), [LEAD_A]);
    assert.equal(event.details.lead_assignee, EMAIL.owner);

    // A visit converted earlier is itself found as a duplicate by a later visit to the same business.
    const repeat = await approvedVisit(db, 4, { phone: '9876543210' });
    assert.equal((await convert(db, repeat)).matches.length, 2);
  } finally { await db.close(); }
});

test('rollback script archives feature data, removes every new object and restores the original constraints', async () => {
  const db = await setup();
  try {
    const visitId = await approvedVisit(db, 1);
    const converted = await convert(db, visitId);

    await asAdmin(db);
    await assert.rejects(db.exec(ROLLBACK), /still have role sales/);
    await db.exec('ROLLBACK');
    assert.equal(await count(db, 'field_visits'), 1, 'a refused rollback changes nothing');

    // Documented removal procedure first, then roll back.
    await db.query("DELETE FROM app_members WHERE role = 'sales'");
    await db.exec(ROLLBACK);

    for (const table of NEW_TABLES) assert.equal((await one(db, 'SELECT to_regclass($1) AS t', [`public.${table}`])).t, null, `${table} removed`);
    assert.equal(await count(db, 'pg_proc', "pronamespace = 'public'::regnamespace AND (proname LIKE 'field_%' OR proname LIKE '%field_visit%' OR proname = 'my_field_sales_companies')"), 0);
    assert.equal(await count(db, 'pg_policies', "policyname = 'office_roles_only'"), 0);
    assert.equal(await count(db, 'pg_trigger', "tgname = 'field_sales_guard_membership'"), 0);
    assert.equal(await count(db, 'pg_tables', "schemaname = 'field_sales_archive'"), 3, 'three archive tables kept');
    const archive = (await one(db, "SELECT tablename FROM pg_tables WHERE schemaname = 'field_sales_archive' AND tablename LIKE 'field_visits_%'")).tablename;
    assert.equal(await count(db, `field_sales_archive.${archive}`), 1);

    // The converted lead survives as an ordinary lead with its origin still readable.
    const lead = await one(db, 'SELECT lead_source, source_details FROM leads WHERE id = $1', [converted.lead_id]);
    assert.equal(lead.lead_source, 'other');
    assert.match(lead.source_details, /\[field-visit:/);
    await assert.rejects(db.query("INSERT INTO leads(company_id, customer_name, lead_source) VALUES ($1, 'x', 'field_visit')", [A]), /leads_lead_source_check/);
    await assert.rejects(db.query("INSERT INTO app_members(user_id, role) VALUES ($1, 'sales')", [U.nobody]), /app_members_role_check/);

    // Existing users are exactly where they were, and the archive is private.
    await as(db, U.staffA);
    assert.equal(await count(db, 'leads'), 2);
    for (const table of OPEN_TABLES) assert.equal(await count(db, table), 2);
    await assert.rejects(db.query(`SELECT * FROM field_sales_archive.${archive}`), /permission denied/);

    // The migration can be applied again after a rollback.
    await asAdmin(db);
    await db.exec(MIGRATION);
    assert.equal(await count(db, 'field_visits'), 0);
  } finally { await db.close(); }
});
