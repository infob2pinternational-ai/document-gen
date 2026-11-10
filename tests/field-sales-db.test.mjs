// Database tests for the security hardening and the Field Sales feature.
//
// By default these run in an in-memory Postgres (PGlite). With
// FIELD_SALES_TEST_PG=1 the same tests run on a throwaway LOCAL PostgreSQL
// server (see tests/helpers/with-local-postgres.sh). Nothing here connects to
// Supabase or any remote database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGINE, FEATURE_MIGRATION, SECURITY_MIGRATION, FEATURE_ROLLBACK, SECURITY_ROLLBACK, SECURITY_ROLLBACK_CONFIRMATION,
  U, EMAIL, A, B, LEAD_A, LEAD_B, OPEN_TABLES, id, as, asAdmin, asService, one, count, setup, seedSales,
  buildInsert, insertRealRow, noOpUpdate, visit, save, review, convert, tomorrow, approvedVisit
} from './helpers/field-sales-db.mjs';

const t = (name, fn) => test(`[${ENGINE}] ${name}`, fn);
// The WhatsApp guard trigger refuses a foreign row before row-level security is even consulted.
const DENIED = /permission denied|row-level security|access denied|not found|Sign in|requires a company and matching conversation/i;

// Company-scoped CRM tables a salesperson must never reach.
const CRM_TABLES = ['leads', 'lead_activities', 'follow_ups', 'customers', 'services', 'crm_quotations', 'comparison_templates',
  'telecalling_entries', 'telecalling_google_sync_queue', 'profiles', 'documents', 'document_items', 'comparison_document_data',
  'whatsapp_conversations', 'whatsapp_messages', 'whatsapp_templates', 'approver_devices', 'owner_report_dispatches'];
const NEW_TABLES = ['field_visits', 'field_visit_events', 'field_sales_members'];
const API_FUNCTIONS = ['public.my_field_sales_companies()', 'public.field_visit_assignees(uuid)', 'public.save_field_visit(jsonb)',
  'public.review_field_visit(uuid,text,text)', 'public.convert_field_visit_to_lead(uuid,text,uuid,boolean,date,time without time zone)'];
const INTERNAL_FUNCTIONS = ['field_sales_internal.normalize_phone(text)', 'field_sales_internal.can_submit(uuid)',
  'field_sales_internal.can_review(uuid)', 'field_sales_internal.assignee_ok(uuid,text)', 'field_sales_internal.guard_membership()',
  'field_sales_internal.audit_guard()'];
const DEFINER_FUNCTIONS = [...API_FUNCTIONS, 'field_sales_internal.can_submit(uuid)', 'field_sales_internal.can_review(uuid)',
  'field_sales_internal.assignee_ok(uuid,text)'];

const policyCount = db => count(db, 'pg_policies', "schemaname = 'public' AND policyname = 'office_roles_only' AND permissive = 'RESTRICTIVE'");
const tableCounts = async (db, tables) => { await asAdmin(db); const out = {}; for (const table of tables) out[table] = await count(db, table); return out; };
/** Run a script that is expected to fail; the open transaction is rolled back, as the SQL editor does. */
async function expectScriptFailure(db, sql, pattern) {
  await assert.rejects(db.exec(sql), pattern);
  await db.exec('ROLLBACK');
}

/** Reads return nothing and every write is refused or touches no row. */
async function assertNoAccess(db, uid, table, label) {
  await asAdmin(db);
  const insert = table === 'profiles' ? { sql: 'INSERT INTO profiles(id, name) VALUES ($1, $2)', params: [id(999), 'Probe'] }
    : await buildInsert(db, table, A).catch(() => null);     // some tables need parents that only exist via RPC
  const update = await noOpUpdate(db, table);
  await as(db, uid);
  let visible = 0;
  try { visible = await count(db, table); } catch (error) { assert.match(error.message, DENIED, `${label}: ${table} read`); }
  assert.equal(visible, 0, `${label} must not read ${table}`);
  if (insert) await assert.rejects(db.query(insert.sql, insert.params), DENIED, `${label} must not insert into ${table}`);
  for (const sql of [update, `DELETE FROM public.${table}`]) {
    try {
      assert.equal((await db.query(sql)).affectedRows, 0, `${label} must not change ${table}`);
    } catch (error) { assert.match(error.message, DENIED, `${label}: ${table} write`); }
  }
}

// ===========================================================================
// A. Security hardening (independent of the feature)
// ===========================================================================

t('fixture reproduces the gap: without the hardening any signed-in account reaches all 19 tables', async () => {
  const db = await setup({ security: false });
  try {
    const before = await tableCounts(db, OPEN_TABLES);
    await as(db, U.nobody);                 // confirmed account with no app_members row
    for (const table of OPEN_TABLES) {
      assert.ok(before[table] >= 2);
      assert.equal(await count(db, table), before[table], `${table} is fully readable by a no-role account`);
    }
    await as(db, null);
    for (const table of OPEN_TABLES) assert.equal(await count(db, table), 0, `${table} is not readable anonymously`);
  } finally { await db.close(); }
});

t('hardening alone (no feature): 19 restrictive policies; owner, admin and staff keep read and write on every table', async () => {
  const db = await setup({ feature: false });
  try {
    assert.equal(await policyCount(db), 19);
    assert.equal((await one(db, "SELECT to_regclass('public.field_visits') AS t")).t, null, 'the feature is not installed');
    const before = await tableCounts(db, OPEN_TABLES);
    for (const [uid, label] of [[U.owner, 'owner'], [U.admin, 'admin'], [U.staffA, 'staff']]) {
      for (const table of OPEN_TABLES) {
        await asAdmin(db);
        const insert = await buildInsert(db, table, A);
        const update = await noOpUpdate(db, table);
        const now = await count(db, table);
        await as(db, uid);
        assert.equal(await count(db, table), now, `${label} still reads ${table}`);
        assert.ok((await db.query(update)).affectedRows >= before[table], `${label} still updates ${table}`);
        try {
          const key = (await one(db, insert.sql, insert.params)).key;
          assert.equal((await db.query(`DELETE FROM public.${table} WHERE "${insert.keyColumn}"::text = $1`, [key])).affectedRows, 1, `${label} still deletes from ${table}`);
        } catch (error) {
          // One row per company is allowed in a few tables; a uniqueness error proves the policy let the write through.
          assert.match(error.message, /duplicate key/, `${label} insert into ${table}: ${error.message}`);
        }
      }
    }
    for (const table of OPEN_TABLES) {
      await assertNoAccess(db, U.nobody, table, 'no-role account');
      await assertNoAccess(db, null, table, 'anonymous');
    }
    assert.deepEqual(await tableCounts(db, OPEN_TABLES), before, 'no row was lost or added');
  } finally { await db.close(); }
});

t('hardening never overwrites an unexpected or modified policy, and a re-run changes nothing', async () => {
  const db = await setup({ security: false });
  try {
    // Someone else already created a policy with our name on one table.
    await asAdmin(db);
    await db.exec('CREATE POLICY office_roles_only ON public.expenses FOR SELECT TO authenticated USING (true)');
    await expectScriptFailure(db, SECURITY_MIGRATION, /policy public\.expenses\/office_roles_only already exists but was not created by these migrations/);
    assert.equal(await policyCount(db), 0, 'nothing was applied');
    assert.equal(await count(db, 'pg_policies', "policyname = 'office_roles_only'"), 1, 'the foreign policy is untouched');
    assert.equal((await one(db, "SELECT to_regnamespace('b2p_migration_internal') AS s")).s, null, 'the registry was rolled back too');

    await db.exec('DROP POLICY office_roles_only ON public.expenses');
    await db.exec(SECURITY_MIGRATION);
    assert.equal(await policyCount(db), 19);
    const fingerprint = async () => (await one(db, "SELECT md5(string_agg(ident || definition_md5, ',' ORDER BY ident)) AS f, count(*) AS n FROM b2p_migration_internal.object_registry"));
    const first = await fingerprint();
    await db.exec(SECURITY_MIGRATION);
    assert.deepEqual(await fingerprint(), first, 're-run is a no-op');
    assert.equal(Number(first.n), 19);

    // One of our policies was weakened afterwards: a re-run stops instead of silently replacing it.
    await db.exec("ALTER POLICY office_roles_only ON public.suppliers USING (true)");
    await expectScriptFailure(db, SECURITY_MIGRATION, /policy public\.suppliers\/office_roles_only was modified after it was created/);
    assert.equal((await one(db, "SELECT qual FROM pg_policies WHERE tablename = 'suppliers' AND policyname = 'office_roles_only'")).qual, 'true');

    // The registry is private.
    for (const uid of [U.owner, U.staffA, null]) {
      await as(db, uid);
      await assert.rejects(db.query('SELECT * FROM b2p_migration_internal.object_registry'), /permission denied/);
      await assert.rejects(db.query("SELECT b2p_migration_internal.record_object('x', 'policy', 'public.expenses/office_roles_only')"), /permission denied/);
    }
  } finally { await db.close(); }
});

// ===========================================================================
// B. Feature migration safety
// ===========================================================================

t('feature migration refuses to run unless all 19 security policies are present, recorded and unmodified', async () => {
  const db = await setup({ security: false });
  try {
    await asAdmin(db);
    const intact = "(SELECT public.current_app_role()) IN ('owner','admin','staff')";
    const untouched = async () => {
      assert.equal((await one(db, "SELECT to_regclass('public.field_visits') AS t")).t, null, 'no feature table');
      assert.equal((await one(db, "SELECT to_regnamespace('field_sales_internal') AS s")).s, null, 'no helper schema');
      assert.equal(await count(db, 'pg_constraint', "conname = 'app_members_role_check' AND pg_get_constraintdef(oid) LIKE '%sales%'"), 0, 'role constraint unchanged');
      assert.equal(await count(db, 'pg_constraint', "conname = 'leads_lead_source_check' AND pg_get_constraintdef(oid) LIKE '%field_visit%'"), 0, 'lead-source constraint unchanged');
    };
    const refused = async (message) => { await expectScriptFailure(db, FEATURE_MIGRATION, message); await untouched(); };

    // 0. No hardening at all.
    await refused(/apply 20261110000001_security_office_roles_only\.sql first/);
    await db.exec(SECURITY_MIGRATION);

    // 1. A MISSING policy.
    await db.exec('BEGIN; DROP POLICY office_roles_only ON public.bookings;');
    await assert.rejects(db.exec(FEATURE_MIGRATION.replace(/^BEGIN;$/m, '')), /security hardening is not intact on: bookings \(missing\)/);
    await db.exec('ROLLBACK');

    // 2. A MODIFIED restrictive policy: still restrictive, still named correctly, but weakened in place.
    await db.exec('BEGIN; ALTER POLICY office_roles_only ON public.expenses USING (true);');
    await assert.rejects(db.exec(FEATURE_MIGRATION.replace(/^BEGIN;$/m, '')), /not intact on: expenses \(modified since the security migration created it\)/);
    await db.exec('ROLLBACK');
    //    ... widened to another role, or its WITH CHECK weakened, or its command narrowed.
    for (const change of [
      "ALTER POLICY office_roles_only ON public.suppliers TO authenticated, anon",
      "ALTER POLICY office_roles_only ON public.suppliers WITH CHECK (true)",
      `DROP POLICY office_roles_only ON public.suppliers; CREATE POLICY office_roles_only ON public.suppliers AS RESTRICTIVE FOR SELECT TO authenticated USING (${intact})`
    ]) {
      await db.exec('BEGIN'); await db.exec(change);
      await assert.rejects(db.exec(FEATURE_MIGRATION.replace(/^BEGIN;$/m, '')), /not intact on: suppliers \(modified since the security migration created it\)/, change);
      await db.exec('ROLLBACK');
    }

    // 3. CORRECT NAME AND MODE, INCORRECT EXPRESSION: re-created by hand as RESTRICTIVE FOR ALL TO authenticated,
    //    but letting the sales role (or everyone) through. The old existence + mode check would have accepted these.
    for (const expression of ["(SELECT public.current_app_role()) IN ('owner','admin','staff','sales')", "(SELECT public.current_app_role()) IS NOT NULL", 'true']) {
      await db.exec('BEGIN');
      await db.exec(`DROP POLICY office_roles_only ON public.journal_entries;
        CREATE POLICY office_roles_only ON public.journal_entries AS RESTRICTIVE FOR ALL TO authenticated USING (${expression}) WITH CHECK (${expression});`);
      assert.equal(await count(db, 'pg_policies', "tablename = 'journal_entries' AND policyname = 'office_roles_only' AND permissive = 'RESTRICTIVE'"), 1);
      await assert.rejects(db.exec(FEATURE_MIGRATION.replace(/^BEGIN;$/m, '')), /not intact on: journal_entries \(modified since the security migration created it\)/, expression);
      await db.exec('ROLLBACK');
    }

    // 4. Correct in every respect but NOT RECORDED as created by the security migration
    //    (for example created by hand on a database where the security migration never ran for that table).
    await db.exec("BEGIN; DELETE FROM b2p_migration_internal.object_registry WHERE ident = 'public.resources/office_roles_only';");
    await assert.rejects(db.exec(FEATURE_MIGRATION.replace(/^BEGIN;$/m, '')), /not intact on: resources \(not recorded as created by the security migration\)/);
    await db.exec('ROLLBACK');
    await db.exec("BEGIN; UPDATE b2p_migration_internal.object_registry SET migration = 'something_else' WHERE ident = 'public.resources/office_roles_only';");
    await assert.rejects(db.exec(FEATURE_MIGRATION.replace(/^BEGIN;$/m, '')), /not intact on: resources \(not recorded as created by the security migration\)/);
    await db.exec('ROLLBACK');

    // 5. Several problems are all reported at once.
    await db.exec('BEGIN; DROP POLICY office_roles_only ON public.bookings; ALTER POLICY office_roles_only ON public.expenses USING (true);');
    await assert.rejects(db.exec(FEATURE_MIGRATION.replace(/^BEGIN;$/m, '')), /not intact on: expenses \(modified[^)]*\), bookings \(missing\)/);
    await db.exec('ROLLBACK');
    await untouched();

    // 6. A COMPLETELY UNCHANGED policy set: the feature installs, and installs again.
    assert.equal(await policyCount(db), 19);
    await db.exec(FEATURE_MIGRATION);
    await db.exec(FEATURE_MIGRATION);
    assert.equal(await count(db, 'pg_class', "relnamespace = 'public'::regnamespace AND relname IN ('field_visits', 'field_visit_events', 'field_sales_members')"), 3);
    assert.equal(await policyCount(db), 19, 'the feature migration did not touch the security policies');
    assert.equal(await count(db, 'b2p_migration_internal.object_registry', "migration = 'security_office_roles_only'"), 19);

    // 7. The same check protects a later re-run of the feature migration.
    await db.exec('BEGIN; ALTER POLICY office_roles_only ON public.bank_accounts USING (true);');
    await assert.rejects(db.exec(FEATURE_MIGRATION.replace(/^BEGIN;$/m, '')), /not intact on: bank_accounts \(modified/);
    await db.exec('ROLLBACK');
  } finally { await db.close(); }
});

t('feature migration stops, changing nothing, when an object of the same name already exists or differs from production', async () => {
  const cases = [
    ['an unrelated function with our name', "CREATE FUNCTION public.save_field_visit(jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$",
      /function public\.save_field_visit\(jsonb\) already exists but was not created by these migrations/],
    ['an unrelated table with our name', 'CREATE TABLE public.field_visits (id uuid PRIMARY KEY, note text)',
      /table public\.field_visits already exists but was not created by these migrations/],
    ['an unrelated helper schema', 'CREATE SCHEMA field_sales_internal',
      /schema field_sales_internal already exists but was not created by these migrations/],
    ['a role constraint that is not the one inspected in production',
      "ALTER TABLE public.app_members DROP CONSTRAINT app_members_role_check; ALTER TABLE public.app_members ADD CONSTRAINT app_members_role_check CHECK (role IN ('owner','admin','staff','manager'))",
      /constraint app_members\.app_members_role_check is not the definition inspected in production/],
    ['a lead-source constraint that is not the one inspected in production',
      "ALTER TABLE public.leads DROP CONSTRAINT leads_lead_source_check; ALTER TABLE public.leads ADD CONSTRAINT leads_lead_source_check CHECK (lead_source <> '')",
      /constraint leads\.leads_lead_source_check is not the definition inspected in production/],
    ['a live column the functions depend on is missing', 'ALTER TABLE public.lead_activities RENAME COLUMN performed_by TO user_email',
      /expected live columns missing: lead_activities\.performed_by/]
  ];
  for (const [label, prepare, message] of cases) {
    const db = await setup({ feature: false });
    try {
      await asAdmin(db);
      await db.exec(prepare);
      const snapshot = async () => (await one(db, `SELECT
        (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('public', 'field_sales_internal')) AS functions,
        (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace) AS relations,
        (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal) AS triggers,
        (SELECT md5(string_agg(pg_get_constraintdef(oid), '|' ORDER BY conname)) FROM pg_constraint WHERE conname IN ('app_members_role_check', 'leads_lead_source_check')) AS constraints,
        (SELECT count(*) FROM b2p_migration_internal.object_registry) AS registry`));
      const before = await snapshot();
      await expectScriptFailure(db, FEATURE_MIGRATION, message);
      assert.deepEqual(await snapshot(), before, `${label}: nothing changed`);
    } finally { await db.close(); }
  }
});

t('re-running the feature migration preserves feature data, and refuses to overwrite objects changed since it ran', async () => {
  const db = await setup();
  try {
    const date = await tomorrow(db);
    const converted = await approvedVisit(db, 1);
    const result = await convert(db, converted, { date });
    await as(db, U.salesA);
    await save(db, visit(2));

    const snapshot = async () => {
      await asAdmin(db);
      return one(db, `SELECT
        (SELECT md5(string_agg(to_jsonb(v)::text, '|' ORDER BY id)) FROM field_visits v) AS visits,
        (SELECT md5(string_agg(to_jsonb(e)::text, '|' ORDER BY id)) FROM field_visit_events e) AS events,
        (SELECT md5(string_agg(to_jsonb(m)::text, '|' ORDER BY user_id, company_id)) FROM field_sales_members m) AS members,
        (SELECT md5(string_agg(to_jsonb(l)::text, '|' ORDER BY id)) FROM leads l) AS leads,
        (SELECT md5(string_agg(to_jsonb(f)::text, '|' ORDER BY id)) FROM follow_ups f) AS follow_ups,
        (SELECT md5(string_agg(kind || ident || definition_md5, '|' ORDER BY kind, ident)) FROM b2p_migration_internal.object_registry) AS registry`);
    };
    const before = await snapshot();
    await db.exec(SECURITY_MIGRATION);
    await db.exec(FEATURE_MIGRATION);
    await db.exec(FEATURE_MIGRATION);
    assert.deepEqual(await snapshot(), before, 'visits, events, memberships, leads, follow-ups and definitions are identical after two re-runs');
    assert.equal(await count(db, 'field_visits'), 2);
    assert.equal((await one(db, 'SELECT lead_source FROM leads WHERE id = $1', [result.lead_id])).lead_source, 'field_visit');
    // The feature still works after a re-run.
    await as(db, U.owner);
    await review(db, id(1002), 'approve');

    // Objects edited by hand after the migration are never silently replaced: function, table, policy, trigger, index.
    await asAdmin(db);
    const editedFunction = `CREATE OR REPLACE FUNCTION public.field_visit_assignees(p_company_id uuid) RETURNS TABLE (email text, role text)
      LANGUAGE sql STABLE AS $$ SELECT 'anyone@example.test'::text, 'owner'::text $$`;
    for (const [change, message] of [
      [editedFunction, /function public\.field_visit_assignees\(uuid\) was modified after it was created/],
      ['ALTER TABLE public.field_visits ADD COLUMN extra text', /table public\.field_visits was modified/],
      ['ALTER POLICY field_visits_read ON public.field_visits USING (true)', /policy public\.field_visits\/field_visits_read was modified/],
      ['ALTER TABLE public.field_visit_events DISABLE TRIGGER field_visit_events_append_only', /trigger public\.field_visit_events\/field_visit_events_append_only was modified/],
      ['DROP INDEX public.idx_field_visits_company_phone', /table public\.field_visits was modified/]
    ]) {
      await db.exec('BEGIN'); await db.exec(change);
      await assert.rejects(db.exec(FEATURE_MIGRATION.replace(/^BEGIN;$/m, '')), message);
      await db.exec('ROLLBACK');
    }
    assert.equal(await count(db, 'field_visits'), 2, 'data is intact after every refused re-run');
  } finally { await db.close(); }
});

t('failure recovery: a migration that fails part-way rolls back completely and succeeds once the cause is removed', async () => {
  const db = await setup({ feature: false });
  try {
    await asAdmin(db);
    const state = async () => one(db, `SELECT
      (SELECT string_agg(pg_get_constraintdef(oid), ' || ' ORDER BY conname) FROM pg_constraint WHERE conname IN ('app_members_role_check', 'leads_lead_source_check')) AS constraints,
      (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'field_%') AS feature_tables,
      (SELECT count(*) FROM pg_namespace WHERE nspname = 'field_sales_internal') AS helper_schema,
      (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'field_%') AS triggers,
      (SELECT count(*) FROM b2p_migration_internal.object_registry WHERE migration = 'field_sales') AS registry,
      (SELECT count(*) FROM leads) AS leads, (SELECT count(*) FROM app_members) AS members`);
    const before = await state();

    // An index name the migration needs is already used by something else. The
    // migration gets past the definition checks, changes both constraints,
    // creates two tables and then fails while creating the third index.
    await db.exec('CREATE INDEX idx_field_visit_events_visit ON public.leads (created_at)');
    await expectScriptFailure(db, FEATURE_MIGRATION, /idx_field_visit_events_visit.*already exists/);
    assert.deepEqual(await state(), before, 'constraints, tables, schema, triggers and registry are exactly as before');
    await db.query("INSERT INTO leads(company_id, customer_name, lead_source) VALUES ($1, 'still valid', 'phone')", [A]);
    await assert.rejects(db.query("INSERT INTO leads(company_id, customer_name, lead_source) VALUES ($1, 'x', 'field_visit')", [A]), /leads_lead_source_check/);
    await as(db, U.staffA);
    assert.equal(await count(db, 'leads'), 2, 'existing users are unaffected by the failed attempt');

    await asAdmin(db);
    await db.exec('DROP INDEX public.idx_field_visit_events_visit');
    await db.exec(FEATURE_MIGRATION);
    await seedSales(db);
    await as(db, U.salesA);
    assert.equal((await save(db, visit(1))).result, 'submitted');
  } finally { await db.close(); }
});

// ===========================================================================
// C. What a sales user can and cannot reach
// ===========================================================================

t('sales users, no-role accounts and anonymous callers are denied on all 19 restricted tables (real production columns)', async () => {
  const db = await setup();
  try {
    const before = await tableCounts(db, OPEN_TABLES);
    for (const table of OPEN_TABLES) {
      await assertNoAccess(db, U.salesA, table, 'sales');
      await assertNoAccess(db, U.nobody, table, 'no-role account');
      await assertNoAccess(db, null, table, 'anonymous');
    }
    assert.deepEqual(await tableCounts(db, OPEN_TABLES), before, 'every row is intact');
    await as(db, U.staffA);
    for (const table of OPEN_TABLES) assert.equal(await count(db, table), before[table], `staff still reads ${table}`);
  } finally { await db.close(); }
});

t('sales users cannot reach leads, customers, follow-ups, quotations, telecalling, documents, WhatsApp, devices, reports or profiles', async () => {
  const db = await setup();
  try {
    await asAdmin(db);
    for (const table of ['customers', 'services', 'telecalling_entries', 'crm_quotations', 'comparison_templates', 'follow_ups', 'lead_activities']) {
      if (table === 'follow_ups') await asService(db);            // its audit trigger needs a request identity
      await insertRealRow(db, table, A);
      await asAdmin(db);
    }
    for (const table of CRM_TABLES) {
      await assertNoAccess(db, U.salesA, table, 'sales');
      await assertNoAccess(db, null, table, 'anonymous');
    }
    await as(db, U.salesA);
    assert.equal((await one(db, 'SELECT can_access_company($1) AS ok', [A])).ok, false);
    assert.equal((await one(db, 'SELECT current_app_role() AS role')).role, 'sales');
    for (const sql of ["SELECT save_document_bundle('{}'::jsonb, '[]'::jsonb, NULL)", `SELECT review_document('${id(1)}', true)`,
      `SELECT delete_document_bundle('${id(1)}')`, `SELECT log_document_send('${id(1)}')`]) {
      await assert.rejects(db.query(sql), /denied|Only the owner|not found|Invalid|null value|access/i);
    }
    await asAdmin(db);
    assert.equal(await count(db, 'leads'), 2);
    assert.equal(await count(db, 'customers'), 1);
  } finally { await db.close(); }
});

// ===========================================================================
// D. Membership guards and provisioning
// ===========================================================================

t('provisioning: owner, admin and staff are created and changed exactly as before', async () => {
  const db = await setup({ sales: false });
  try {
    await asAdmin(db);
    await db.query("INSERT INTO app_members(user_id, role) VALUES ($1, 'staff')", [U.spare]);
    await db.query('INSERT INTO app_company_members(user_id, company_id) VALUES ($1, $2), ($1, $3)', [U.spare, A, B]);
    await db.query('INSERT INTO app_company_members(user_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [U.spare, A]);
    for (const role of ['admin', 'owner', 'staff']) {
      await db.query('UPDATE app_members SET role = $2 WHERE user_id = $1', [U.spare, role]);
      await as(db, U.spare);
      assert.equal((await one(db, 'SELECT current_app_role() AS r')).r, role);
      assert.equal((await one(db, 'SELECT can_access_company($1) AS ok', [A])).ok, true);
      assert.equal(await count(db, 'leads'), 2);
      await asAdmin(db);
    }
    await db.query('DELETE FROM app_company_members WHERE user_id = $1 AND company_id = $2', [U.spare, B]);
    await db.query('UPDATE app_company_members SET company_id = $3 WHERE user_id = $1 AND company_id = $2', [U.spare, A, B]);
    await as(db, U.spare);
    assert.equal(await count(db, 'leads', `company_id = '${B}'`), 1);
    assert.equal(await count(db, 'leads'), 1);
    await asAdmin(db);
    await db.query('UPDATE app_members SET active = false WHERE user_id = $1', [U.spare]);
    await as(db, U.spare);
    assert.equal(await count(db, 'leads'), 0);
    await asAdmin(db);
    await db.query('UPDATE app_members SET active = true WHERE user_id = $1', [U.spare]);
    await db.query('DELETE FROM app_members WHERE user_id = $1', [U.spare]);       // cascades to company membership
    assert.equal(await count(db, 'app_company_members', `user_id = '${U.spare}'`), 0);
    await assert.rejects(db.query("INSERT INTO app_members(user_id, role) VALUES ($1, 'manager')", [U.spare]), /app_members_role_check/);
  } finally { await db.close(); }
});

t('a sales user can never hold normal company membership, by any route, and role changes keep the two memberships separate', async () => {
  const db = await setup();
  try {
    await asAdmin(db);
    const blocked = /cannot be given normal company membership/;
    // Every way of putting a sales user into app_company_members.
    await assert.rejects(db.query('INSERT INTO app_company_members(user_id, company_id) VALUES ($1, $2)', [U.salesA, A]), blocked);
    await assert.rejects(db.query('INSERT INTO app_company_members(user_id, company_id) VALUES ($1, $2) ON CONFLICT (user_id, company_id) DO UPDATE SET company_id = excluded.company_id', [U.salesA, B]), blocked);
    await assert.rejects(db.query('INSERT INTO app_company_members(user_id, company_id) SELECT user_id, $1 FROM app_members ON CONFLICT DO NOTHING', [B]), blocked);
    await assert.rejects(db.query('UPDATE app_company_members SET user_id = $1 WHERE user_id = $2', [U.salesA, U.staffA]), blocked);
    // The seeding statement used by the original security migration (every member x every company) is refused too.
    await assert.rejects(db.exec('INSERT INTO app_company_members SELECT m.user_id, p.id FROM app_members m CROSS JOIN profiles p ON CONFLICT DO NOTHING'), blocked);
    assert.equal(await count(db, 'app_company_members', `user_id IN ('${U.salesA}', '${U.salesA2}', '${U.salesB}')`), 0);

    // staff -> sales needs the normal memberships removed first; sales -> staff needs the field memberships removed first.
    await assert.rejects(db.query("UPDATE app_members SET role = 'sales' WHERE user_id = $1", [U.staffA]), /Remove this user's app_company_members rows/);
    await assert.rejects(db.query("UPDATE app_members SET role = 'staff' WHERE user_id = $1", [U.salesA]), /Remove this user's field_sales_members rows/);
    await assert.rejects(db.query("INSERT INTO app_members(user_id, role) VALUES ($1, 'sales') ON CONFLICT (user_id) DO UPDATE SET role = 'sales'", [U.staffB]), /Remove this user's app_company_members rows/);
    await assert.rejects(db.query('INSERT INTO field_sales_members(user_id, company_id) VALUES ($1, $2)', [U.staffA, A]), /only for users whose app_members role is sales/);
    await assert.rejects(db.query('INSERT INTO field_sales_members(user_id, company_id) VALUES ($1, $2)', [U.owner, A]), /only for users whose app_members role is sales/);
    await assert.rejects(db.query('UPDATE field_sales_members SET user_id = $1 WHERE user_id = $2', [U.admin, U.salesA2]), /only for users whose app_members role is sales/);

    // Correct conversion staff -> sales.
    await db.query('DELETE FROM app_company_members WHERE user_id = $1', [U.staffA]);
    await db.query("UPDATE app_members SET role = 'sales' WHERE user_id = $1", [U.staffA]);
    await db.query('INSERT INTO field_sales_members(user_id, company_id) VALUES ($1, $2)', [U.staffA, A]);
    await as(db, U.staffA);
    assert.equal(await count(db, 'leads'), 0, 'a former staff member loses CRM access when made sales');
    assert.equal((await save(db, visit(31))).result, 'submitted');

    // Correct conversion sales -> staff.
    await asAdmin(db);
    await db.query('DELETE FROM field_sales_members WHERE user_id = $1', [U.salesA2]);
    await db.query("UPDATE app_members SET role = 'staff' WHERE user_id = $1", [U.salesA2]);
    await db.query('INSERT INTO app_company_members(user_id, company_id) VALUES ($1, $2)', [U.salesA2, A]);
    await as(db, U.salesA2);
    assert.equal(await count(db, 'leads', `company_id = '${A}'`), 1);
    await assert.rejects(save(db, visit(32)), /access denied/, 'staff do not submit field visits');

    // Membership changes are refused in isolation levels that could not see a concurrent change.
    await asAdmin(db);
    for (const level of ['REPEATABLE READ', 'SERIALIZABLE']) {
      for (const sql of [`INSERT INTO app_company_members(user_id, company_id) VALUES ('${U.staffB}', '${A}')`,
        `UPDATE app_members SET role = 'admin' WHERE user_id = '${U.staffB}'`,
        `INSERT INTO field_sales_members(user_id, company_id) VALUES ('${U.salesB}', '${A}')`]) {
        await db.exec(`BEGIN ISOLATION LEVEL ${level}`);
        await assert.rejects(db.query(sql), /must run in a READ COMMITTED transaction/);
        await db.exec('ROLLBACK');
      }
    }

    // A sales user cannot do any of this themselves.
    await as(db, U.salesA);
    for (const sql of ["UPDATE app_members SET role = 'owner' WHERE user_id = auth.uid()",
      `INSERT INTO app_company_members(user_id, company_id) VALUES ('${U.salesA}', '${A}')`,
      `INSERT INTO field_sales_members(user_id, company_id) VALUES ('${U.salesA}', '${B}')`,
      'UPDATE field_sales_members SET active = true', 'SELECT * FROM field_sales_members', 'SELECT * FROM app_members']) {
      await assert.rejects(db.query(sql), /permission denied/);
    }
  } finally { await db.close(); }
});

t('moving a sales user between companies, deactivating and reactivating them', async () => {
  const db = await setup();
  try {
    await as(db, U.salesA);
    const inA = (await save(db, visit(1))).visit.id;
    const companies = async () => (await db.query('SELECT name FROM my_field_sales_companies()')).rows.map(r => r.name);
    assert.deepEqual(await companies(), ['Company A']);

    // Move A -> B: delete and insert the field membership.
    await asAdmin(db);
    await db.query('DELETE FROM field_sales_members WHERE user_id = $1 AND company_id = $2', [U.salesA, A]);
    await db.query('INSERT INTO field_sales_members(user_id, company_id) VALUES ($1, $2)', [U.salesA, B]);
    await as(db, U.salesA);
    assert.deepEqual(await companies(), ['Company B']);
    assert.equal(await count(db, 'field_visits'), 0, 'visits of the old company are no longer readable');
    await assert.rejects(save(db, visit(1, { remarks: 'edit after move' })), /access denied/);
    await assert.rejects(save(db, visit(2)), /access denied/, 'new visits for the old company are refused');
    const inB = (await save(db, visit(3, { company_id: B }))).visit.id;
    assert.equal(await count(db, 'field_visits'), 1);
    // The reviewer still sees the old visit, attributed to the same person.
    await as(db, U.owner);
    assert.equal((await one(db, 'SELECT salesperson_email AS e FROM field_visits WHERE id = $1', [inA])).e, EMAIL.salesA);

    // Selling for both companies at once.
    await asAdmin(db);
    await db.query('INSERT INTO field_sales_members(user_id, company_id) VALUES ($1, $2)', [U.salesA, A]);
    await as(db, U.salesA);
    assert.deepEqual(await companies(), ['Company A', 'Company B']);
    assert.equal(await count(db, 'field_visits'), 2);

    // Deactivate one company, then the whole account, then reactivate.
    const locked = async (expectedVisible, label) => {
      await as(db, U.salesA);
      assert.equal(await count(db, 'field_visits'), expectedVisible, `${label}: visible visits`);
    };
    await asAdmin(db);
    await db.query('UPDATE field_sales_members SET active = false WHERE user_id = $1 AND company_id = $2', [U.salesA, B]);
    await locked(1, 'company B deactivated');
    assert.deepEqual(await companies(), ['Company A']);
    await assert.rejects(save(db, visit(4, { company_id: B })), /access denied/);
    await asAdmin(db);
    await db.query('UPDATE app_members SET active = false WHERE user_id = $1', [U.salesA]);
    await locked(0, 'account deactivated');
    assert.deepEqual(await companies(), []);
    await assert.rejects(save(db, visit(5)), /access denied/);
    assert.equal((await one(db, 'SELECT current_app_role() AS r')).r, null);
    for (const table of OPEN_TABLES.slice(0, 3)) assert.equal(await count(db, table), 0);
    await asAdmin(db);
    await db.query("UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = $1", [U.salesA]);
    await db.query('UPDATE app_members SET active = true WHERE user_id = $1', [U.salesA]);
    await locked(0, 'reactivated but banned');
    await asAdmin(db);
    await db.query('UPDATE auth.users SET banned_until = NULL WHERE id = $1', [U.salesA]);
    await db.query('UPDATE field_sales_members SET active = true WHERE user_id = $1', [U.salesA]);
    await locked(2, 'fully reactivated');
    assert.equal((await save(db, visit(6, { company_id: B }))).result, 'submitted');
    // Reactivation never brought normal membership with it.
    await asAdmin(db);
    assert.equal(await count(db, 'app_company_members', `user_id = '${U.salesA}'`), 0);
    assert.equal((await one(db, 'SELECT company_id FROM field_visits WHERE id = $1', [inB])).company_id, B);

    // Fail closed if the guard trigger is ever bypassed by an administrator.
    await db.exec('ALTER TABLE app_company_members DISABLE TRIGGER field_sales_guard_membership');
    await db.query('INSERT INTO app_company_members(user_id, company_id) VALUES ($1, $2)', [U.salesA, A]);
    await as(db, U.salesA);
    assert.equal(await count(db, 'field_visits'), 0);
    await assert.rejects(save(db, visit(7)), /access denied/);
    assert.deepEqual(await companies(), []);
  } finally { await db.close(); }
});

// ===========================================================================
// E. Function security
// ===========================================================================

t('function security: owner, fixed search_path, SECURITY DEFINER set only where needed, and exact execute grants', async () => {
  const db = await setup();
  try {
    await asAdmin(db);
    const owner = (await one(db, 'SELECT current_user AS u')).u;
    const rows = (await db.query(`
      SELECT p.oid::regprocedure::text AS sig, p.prosecdef AS definer, pg_get_userbyid(p.proowner) AS owner,
             coalesce(array_to_string(p.proconfig, ';'), '') AS config,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
             has_function_privilege('public', p.oid, 'EXECUTE') AS everyone
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'field_sales_internal' OR (n.nspname = 'public' AND (p.proname LIKE '%field_visit%' OR p.proname LIKE '%field_sales%'))`)).rows;
    const bySig = Object.fromEntries(rows.map(row => [row.sig.replace(/^public\./, '').replace(/, /g, ','), row]));
    const find = signature => bySig[signature.replace(/^public\./, '')];
    assert.equal(rows.length, API_FUNCTIONS.length + INTERNAL_FUNCTIONS.length, 'no unexpected function exists');
    for (const signature of [...API_FUNCTIONS, ...INTERNAL_FUNCTIONS]) {
      const fn = find(signature);
      assert.ok(fn, `${signature} exists`);
      assert.equal(fn.owner, owner, `${signature} is owned by the migration role`);
      assert.match(fn.config, /^search_path=""$/, `${signature} has an empty, fixed search_path`);
      assert.equal(fn.definer, DEFINER_FUNCTIONS.includes(signature), `${signature} SECURITY DEFINER flag`);
      assert.equal(fn.anon, false, `${signature} is not executable by anon`);
      assert.equal(fn.everyone, false, `${signature} is not executable by PUBLIC`);
      const granted = API_FUNCTIONS.includes(signature) || ['field_sales_internal.can_submit(uuid)', 'field_sales_internal.can_review(uuid)'].includes(signature);
      assert.equal(fn.authenticated, granted, `${signature} authenticated execute = ${granted}`);
    }
    const schema = await one(db, `SELECT has_schema_privilege('anon', 'field_sales_internal', 'USAGE') AS anon,
      has_schema_privilege('authenticated', 'field_sales_internal', 'USAGE') AS authenticated,
      has_schema_privilege('authenticated', 'field_sales_internal', 'CREATE') AS can_create,
      has_schema_privilege('authenticated', 'b2p_migration_internal', 'USAGE') AS registry`);
    assert.deepEqual(schema, { anon: false, authenticated: true, can_create: false, registry: false });
    // Table privileges: read-only for authenticated on two tables, nothing else for anyone.
    const grants = (await db.query(`SELECT table_name AS t, grantee AS g, string_agg(privilege_type, ',' ORDER BY privilege_type) AS p
      FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name LIKE 'field_%' AND grantee IN ('anon', 'authenticated', 'PUBLIC')
      GROUP BY 1, 2 ORDER BY 1, 2`)).rows;
    assert.deepEqual(grants, [{ t: 'field_visit_events', g: 'authenticated', p: 'SELECT' }, { t: 'field_visits', g: 'authenticated', p: 'SELECT' }]);
    assert.equal(await count(db, 'pg_class c', "c.relkind = 'S' AND c.relname LIKE 'field_visit%' AND (has_sequence_privilege('authenticated', c.oid, 'USAGE') OR has_sequence_privilege('anon', c.oid, 'USAGE'))"), 0);

    // Internal helpers that are not needed by the read policy cannot be invoked by a signed-in user at all.
    await as(db, U.owner);
    for (const sql of [`SELECT field_sales_internal.assignee_ok('${A}', '${EMAIL.owner}')`, "SELECT field_sales_internal.normalize_phone('9876543210')"]) {
      await assert.rejects(db.query(sql), /permission denied/);
    }
    // The two the policy needs answer only about the caller.
    await as(db, U.salesA);
    assert.deepEqual(await one(db, 'SELECT field_sales_internal.can_submit($1) AS a, field_sales_internal.can_submit($2) AS b, field_sales_internal.can_review($1) AS r', [A, B]), { a: true, b: false, r: false });
  } finally { await db.close(); }
});

t('auth.uid() behaviour: every entry point refuses anonymous callers, a signed-in role without an identity, and unknown identities', async () => {
  const db = await setup();
  try {
    await as(db, U.salesA);
    const saved = await save(db, visit(1));
    const calls = [
      ['SELECT save_field_visit($1)', [JSON.stringify(visit(2))]],
      ['SELECT review_field_visit($1, $2, $3)', [saved.visit.id, 'approve', null]],
      ['SELECT convert_field_visit_to_lead($1)', [saved.visit.id]],
      ['SELECT * FROM field_visit_assignees($1)', [A]]
    ];
    // Anonymous: no execute privilege on anything, and no table access.
    await as(db, null);
    for (const table of NEW_TABLES) await assert.rejects(db.query(`SELECT * FROM ${table}`), /permission denied/);
    for (const [sql, params] of [...calls, ['SELECT * FROM my_field_sales_companies()', []],
      ['SELECT field_sales_internal.can_submit($1)', [A]], ['SELECT field_sales_internal.can_review($1)', [A]]]) {
      await assert.rejects(db.query(sql, params), /permission denied/);
    }
    // Role "authenticated" but no subject in the token, and a subject that matches no user.
    for (const claims of [{ role: 'authenticated' }, { role: 'authenticated', sub: id(777), email: EMAIL.owner }]) {
      await db.exec('RESET ROLE');
      await db.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
      await db.exec('SET ROLE authenticated');
      for (const [sql, params] of calls) await assert.rejects(db.query(sql, params), /Sign in to continue|access denied|Only the owner or an admin/);
      assert.equal((await db.query('SELECT * FROM my_field_sales_companies()')).rows.length, 0);
      assert.equal(await count(db, 'field_visits'), 0);
      assert.equal(await count(db, 'field_visit_events'), 0);
    }
    // A forged e-mail claim does not help: identity is the token subject, and the stored e-mail comes from auth.users.
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: 'authenticated', sub: U.salesA, email: EMAIL.owner })]);
    await db.exec('SET ROLE authenticated');
    assert.equal((await save(db, visit(3))).visit.salesperson_email, EMAIL.salesA);
    await assert.rejects(review(db, saved.visit.id, 'approve'), /Only the owner or an admin/);
    await asAdmin(db);
    assert.equal(await count(db, 'field_visits'), 2);
  } finally { await db.close(); }
});

// ===========================================================================
// F. Workflow
// ===========================================================================

t('a salesperson submits visits with server-controlled identity and sees only their own', async () => {
  const db = await setup();
  try {
    await as(db, U.salesA);
    assert.deepEqual((await db.query('SELECT id, name FROM my_field_sales_companies()')).rows, [{ id: A, name: 'Company A' }]);
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

    for (const sql of [
      `INSERT INTO field_visits(id, company_id, salesperson_email, business_name, phone, phone_normalized) VALUES ('${id(1999)}', '${A}', 'x', 'x', '9', '900000')`,
      "UPDATE field_visits SET status = 'approved'", 'DELETE FROM field_visits', 'TRUNCATE field_visits CASCADE'
    ]) await assert.rejects(db.query(sql), /permission denied/);

    for (const [bad, message] of [
      [{ business_name: '  ' }, /Business name is required/], [{ phone: '12' }, /valid phone number/],
      [{ requirements: ['website', 'payroll'] }, /Unknown requirement/], [{ estimated_budget: '-5' }, /budget/],
      [{ id: 'not-a-uuid' }, /Invalid field visit/], [{ follow_up_date: 'tomorrow' }, /Invalid field visit/],
      [{ requirements: 'website' }, /Requirements must be a list/], [{ remarks: 'x'.repeat(2001) }, /too long/]
    ]) await assert.rejects(save(db, visit(50, bad)), message);

    await as(db, U.salesA2);
    assert.equal(await count(db, 'field_visits'), 0);
    assert.equal(await count(db, 'field_visit_events'), 0);
    await assert.rejects(save(db, visit(1, { business_name: 'Hijacked' })), /access denied/);
    await save(db, visit(2));
    assert.equal(await count(db, 'field_visits'), 1);
    await as(db, U.salesA);
    assert.equal(await count(db, 'field_visits'), 1);
    assert.equal(await count(db, 'field_visit_events'), 1);
    await as(db, U.staffA);
    assert.equal(await count(db, 'field_visits'), 0);
    await assert.rejects(save(db, visit(3)), /access denied/);
    await as(db, U.nobody);
    await assert.rejects(save(db, visit(4)), /access denied/);
  } finally { await db.close(); }
});

t('saving is idempotent: retries never create a second visit or a second event', async () => {
  const db = await setup();
  try {
    await as(db, U.salesA);
    const first = await save(db, visit(1));
    const retry = await save(db, visit(1));
    const again = await save(db, visit(1, { status: 'approved' }));
    assert.deepEqual([first.result, retry.result, again.result], ['submitted', 'unchanged', 'unchanged']);
    assert.equal(retry.visit.updated_at, first.visit.updated_at);
    assert.equal((await save(db, visit(1, { remarks: 'Call after 5pm' }))).result, 'updated');
    await asAdmin(db);
    assert.equal(await count(db, 'field_visits'), 1);
    assert.deepEqual((await db.query('SELECT action FROM field_visit_events ORDER BY id')).rows.map(r => r.action), ['submitted', 'updated']);
  } finally { await db.close(); }
});

t('cross-company isolation: a visit cannot be created in, moved to, or read from another company', async () => {
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
    await assert.rejects(save(db, visit(1, { company_id: B })), /access denied/);

    await as(db, U.owner);
    await review(db, mine.visit.id, 'approve');
    await assert.rejects(convert(db, mine.visit.id, { assignee: EMAIL.staffB }), /assignee must be an active owner, admin or staff member of this company/);
    await assert.rejects(convert(db, mine.visit.id, { existing: LEAD_B }), /Lead not found in this company/);
    assert.deepEqual((await db.query('SELECT email FROM field_visit_assignees($1)', [A])).rows.map(r => r.email), [EMAIL.owner, EMAIL.admin, EMAIL.staffA]);
    await as(db, U.staffA);
    await assert.rejects(db.query('SELECT * FROM field_visit_assignees($1)', [A]), /access denied/);

    await asAdmin(db);
    assert.equal((await one(db, 'SELECT status FROM field_visits WHERE id = $1', [mine.visit.id])).status, 'approved');
    assert.equal((await one(db, 'SELECT company_id FROM field_visits WHERE id = $1', [theirs.visit.id])).company_id, B);
    assert.equal(await count(db, 'leads'), 2);
    await assert.rejects(db.query('UPDATE field_visits SET company_id = $1 WHERE id = $2', [id(556), mine.visit.id]), /foreign key/);
  } finally { await db.close(); }
});

t('only owner and admin review; transitions, notes, retries and self-review are enforced and audited', async () => {
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

    await as(db, U.salesA);
    assert.equal((await one(db, 'SELECT review_note FROM field_visits WHERE id = $1', [v3])).review_note, 'Phone number looks wrong');
    const fixed = await save(db, visit(3, { phone: '9000019999' }));
    assert.deepEqual([fixed.result, fixed.visit.status], ['resubmitted', 'submitted']);
    assert.equal((await save(db, visit(1, { remarks: 'late edit' }))).result, 'locked');
    assert.equal((await save(db, visit(2, { remarks: 'late edit' }))).result, 'locked');

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

t('audit integrity: history is append-only for every application role, directly and through functions', async () => {
  const db = await setup();
  try {
    const visitId = await approvedVisit(db, 1);
    // Company C has no leads, so nothing but field-visit history stands in the way of deleting it.
    const C = id(103);
    await asAdmin(db);
    await db.query('INSERT INTO profiles(id, name) VALUES ($1, $2)', [C, 'Company C']);
    await as(db, U.owner);
    await save(db, visit(70, { company_id: C }));
    await asAdmin(db);
    const before = await one(db, "SELECT count(*) AS n, md5(string_agg(to_jsonb(e)::text, '|' ORDER BY id)) AS hash FROM field_visit_events e");
    assert.equal(Number(before.n), 3);

    // 1. Direct access: no privilege at all.
    for (const uid of [U.salesA, U.staffA, U.admin, U.owner, null]) {
      await as(db, uid);
      for (const sql of ["UPDATE field_visit_events SET note = 'edited'", 'DELETE FROM field_visit_events', 'TRUNCATE field_visit_events',
        `INSERT INTO field_visit_events(visit_id, company_id, action, to_status, actor_email, actor_role) VALUES ('${visitId}', '${A}', 'approved', 'approved', 'x', 'owner')`,
        'DELETE FROM field_visits', 'TRUNCATE field_visits CASCADE']) {
        await assert.rejects(db.query(sql), /permission denied/);
      }
    }

    // 2. Through functions: SECURITY DEFINER code runs with the owner's privileges, so
    //    privileges alone would not stop it. The triggers do, for any API request.
    await asAdmin(db);
    await db.exec(`
      CREATE FUNCTION public.test_tamper(p_action text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
      BEGIN
        IF p_action = 'update' THEN UPDATE public.field_visit_events SET note = 'tampered', actor_email = 'someone@else.test';
        ELSIF p_action = 'delete' THEN DELETE FROM public.field_visit_events;
        ELSIF p_action = 'truncate' THEN TRUNCATE public.field_visit_events;
        ELSIF p_action = 'delete_visit' THEN DELETE FROM public.field_visits;
        ELSIF p_action = 'truncate_visits' THEN TRUNCATE public.field_visits CASCADE;
        ELSIF p_action = 'delete_company' THEN DELETE FROM public.profiles WHERE id = '${C}';
        END IF;
      END $$;
      GRANT EXECUTE ON FUNCTION public.test_tamper(text) TO authenticated, service_role;`);
    for (const actor of [U.owner, U.admin, U.salesA, 'service']) {
      if (actor === 'service') await asService(db); else await as(db, actor);
      for (const action of ['update', 'delete', 'truncate', 'delete_visit', 'truncate_visits', 'delete_company']) {
        await assert.rejects(db.query('SELECT public.test_tamper($1)', [action]), /append-only/, `${actor} ${action}`);
      }
    }
    // The server-side service key is an application credential too: it bypasses row-level
    // security but is still refused.
    await asService(db);
    await assert.rejects(db.query("UPDATE field_visit_events SET note = 'x'"), /append-only|permission denied/);
    await assert.rejects(db.query('DELETE FROM field_visits'), /append-only|permission denied/);
    // An owner deleting the company from the app would cascade into history: refused.
    await as(db, U.owner);
    await assert.rejects(db.query('DELETE FROM profiles WHERE id = $1', [C]), /append-only/);

    await asAdmin(db);
    assert.deepEqual(await one(db, "SELECT count(*) AS n, md5(string_agg(to_jsonb(e)::text, '|' ORDER BY id)) AS hash FROM field_visit_events e"), before, 'history is byte-for-byte unchanged');
    assert.equal(await count(db, 'profiles'), 3);

    // 3. Normal work still appends.
    await as(db, U.owner);
    await convert(db, visitId);
    await asAdmin(db);
    assert.equal(await count(db, 'field_visit_events'), 4);

    // 4. The documented exception: a direct database-administrator session (no request role).
    assert.equal((await db.query("UPDATE field_visit_events SET note = 'erasure request 2026-11' WHERE action = 'submitted'")).affectedRows, 2);
    assert.equal((await db.query("DELETE FROM field_visit_events WHERE action = 'approved'")).affectedRows, 1);
  } finally { await db.close(); }
});

t('conversion creates one lead, its activities and an optional follow-up; the salesperson is never the assignee', async () => {
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

    const result = await convert(db, submitted, { date });
    assert.deepEqual([result.result, result.mode], ['converted', 'new_lead']);
    assert.match(result.lead_number, /^B2P-LD-\d+$/);

    await asAdmin(db);
    const lead = await one(db, 'SELECT * FROM leads WHERE id = $1', [result.lead_id]);
    assert.equal(lead.company_id, A);
    assert.equal(lead.lead_source, 'field_visit');
    assert.equal(lead.assigned_telecaller_email, EMAIL.owner);
    assert.deepEqual([lead.status, lead.priority, lead.customer_name, lead.company_name], ['new', 'warm', 'Contact 1', 'Shop 1']);
    assert.equal(lead.service_required, 'Billing Software, Other: Inventory app');
    assert.equal(lead.source_details, `Field visit by ${EMAIL.salesA} [field-visit:${submitted}]`);
    assert.match(lead.notes, /Estimated budget: 25000/);
    assert.ok(lead.next_follow_up_at);

    const followUp = await one(db, 'SELECT * FROM follow_ups WHERE id = $1', [result.follow_up_id]);
    assert.deepEqual([followUp.lead_id, followUp.lead_number, followUp.assigned_staff_email, followUp.created_by_email, followUp.status],
      [lead.id, lead.lead_number, lead.assigned_telecaller_email, EMAIL.owner, 'pending']);
    assert.equal(String(followUp.follow_up_time).slice(0, 5), '11:00');
    assert.equal(await count(db, 'followup_review_state', `follow_up_id = '${followUp.id}'`), 1, 'the existing accountability trigger accepted the insert');
    assert.deepEqual((await db.query('SELECT type FROM lead_activities WHERE lead_id = $1 ORDER BY type', [lead.id])).rows.map(r => r.type),
      ['Follow-up Scheduled', 'Lead Created']);

    const second = await approvedVisit(db, 2);
    const chosen = await convert(db, second, { assignee: `  ${EMAIL.staffA.toUpperCase()} `, date });
    await asAdmin(db);
    assert.equal((await one(db, 'SELECT assigned_telecaller_email AS e FROM leads WHERE id = $1', [chosen.lead_id])).e, EMAIL.staffA);
    assert.equal((await one(db, 'SELECT assigned_staff_email AS e FROM follow_ups WHERE id = $1', [chosen.follow_up_id])).e, EMAIL.staffA);

    const third = await approvedVisit(db, 3);
    const plain = await convert(db, third);
    assert.equal(plain.follow_up_id, null);
    await asAdmin(db);
    assert.equal((await one(db, 'SELECT next_follow_up_at AS at FROM leads WHERE id = $1', [plain.lead_id])).at, null);
    assert.equal(await count(db, 'leads', `assigned_telecaller_email IN ('${EMAIL.salesA}', '${EMAIL.salesA2}', '${EMAIL.salesB}')`), 0);

    await as(db, U.salesA);
    assert.equal((await one(db, 'SELECT status FROM field_visits WHERE id = $1', [submitted])).status, 'converted');
    assert.equal(await count(db, 'leads'), 0);
    assert.equal(await count(db, 'follow_ups'), 0);
    // Existing staff work the new lead with the existing tools.
    await as(db, U.staffA);
    assert.equal((await db.query("UPDATE leads SET status = 'telecaller_working' WHERE id = $1", [result.lead_id])).affectedRows, 1);
  } finally { await db.close(); }
});

t('conversion is idempotent when repeated on one connection', async () => {
  const db = await setup();
  try {
    const date = await tomorrow(db);
    const visitId = await approvedVisit(db, 1);
    const first = await convert(db, visitId, { date });
    await as(db, U.admin);
    const second = await convert(db, visitId, { date, force: true, assignee: EMAIL.staffA });
    const third = await convert(db, visitId, { existing: LEAD_A });
    assert.deepEqual([second.result, third.result], ['already_converted', 'already_converted']);
    assert.deepEqual([second.lead_id, second.lead_number, second.follow_up_id], [first.lead_id, first.lead_number, first.follow_up_id]);
    await assert.rejects(review(db, visitId, 'reject', 'too late'), /can no longer be reviewed/);
    await asAdmin(db);
    assert.equal(await count(db, 'leads', "lead_source = 'field_visit'"), 1);
    assert.equal(await count(db, 'follow_ups', `lead_id = '${first.lead_id}'`), 1);
    assert.equal(await count(db, 'field_visit_events', `visit_id = '${visitId}' AND action LIKE 'converted%'`), 1);
    assert.equal((await one(db, 'SELECT assigned_telecaller_email AS e FROM leads WHERE id = $1', [first.lead_id])).e, EMAIL.owner);
  } finally { await db.close(); }
});

t('conversion is atomic: a failure in the follow-up step leaves no lead, no activity and the visit still approved', async () => {
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
    assert.deepEqual({ leads: await count(db, 'leads'), activities: await count(db, 'lead_activities'), followUps: await count(db, 'follow_ups'), counter: await counter() }, before);
    assert.deepEqual(await one(db, 'SELECT status, lead_id, follow_up_id, converted_at FROM field_visits WHERE id = $1', [visitId]),
      { status: 'approved', lead_id: null, follow_up_id: null, converted_at: null });
    assert.equal(await count(db, 'field_visit_events', `visit_id = '${visitId}' AND action LIKE 'converted%'`), 0);
    await db.exec('DROP TRIGGER test_fail_followup ON public.follow_ups; DROP FUNCTION public.test_fail_followup();');
    await as(db, U.owner);
    assert.equal((await convert(db, visitId, { date })).result, 'converted');
  } finally { await db.close(); }
});

t('duplicate protection: a phone match creates nothing until the reviewer links the lead or explicitly forces a new one', async () => {
  const db = await setup();
  try {
    const date = await tomorrow(db);
    const match = await approvedVisit(db, 1, { phone: '098765-43210' });
    const blocked = await convert(db, match, { date });
    assert.equal(blocked.result, 'duplicates_found');
    assert.deepEqual(blocked.matches.map(m => m.id), [LEAD_A]);
    await asAdmin(db);
    assert.equal(await count(db, 'leads'), 2);
    assert.equal(await count(db, 'follow_ups'), 0);
    assert.equal((await one(db, 'SELECT status FROM field_visits WHERE id = $1', [match])).status, 'approved');

    await as(db, U.owner);
    const linked = await convert(db, match, { existing: LEAD_A, date });
    assert.deepEqual([linked.mode, linked.lead_id], ['linked_existing', LEAD_A]);
    await asAdmin(db);
    assert.equal(await count(db, 'leads'), 2);
    assert.deepEqual(await one(db, 'SELECT assigned_telecaller_email AS e, lead_source AS s FROM leads WHERE id = $1', [LEAD_A]), { e: EMAIL.staffA, s: 'other' });
    assert.equal((await one(db, 'SELECT assigned_staff_email AS e FROM follow_ups WHERE id = $1', [linked.follow_up_id])).e, EMAIL.staffA);
    assert.equal(await count(db, 'lead_activities', `lead_id = '${LEAD_A}' AND type = 'Field Visit Linked'`), 1);

    await db.query('INSERT INTO field_sales_members(user_id, company_id) VALUES ($1, $2)', [U.salesB, A]);
    const otherCompany = await approvedVisit(db, 2, { phone: '9000000001' }, U.salesB);   // matches a lead of company B only
    assert.equal((await convert(db, otherCompany)).result, 'converted');

    const forced = await approvedVisit(db, 3, { phone: '9876543210' });
    assert.equal((await convert(db, forced)).result, 'duplicates_found');
    assert.equal((await convert(db, forced, { force: true })).mode, 'new_lead');
    await asAdmin(db);
    const event = await one(db, "SELECT details FROM field_visit_events WHERE visit_id = $1 AND action = 'converted_new_lead'", [forced]);
    assert.deepEqual(event.details.forced_new_despite_matches.map(m => m.id), [LEAD_A]);
    assert.equal(event.details.lead_assignee, EMAIL.owner);
    const repeat = await approvedVisit(db, 4, { phone: '9876543210' });
    assert.equal((await convert(db, repeat)).matches.length, 2);
  } finally { await db.close(); }
});

// ===========================================================================
// G. Rollbacks
// ===========================================================================

t('feature rollback keeps all 19 security policies and leaves converted leads valid and untouched', async () => {
  const db = await setup();
  try {
    const date = await tomorrow(db);
    const visitId = await approvedVisit(db, 1);
    const converted = await convert(db, visitId, { date });
    await asAdmin(db);
    const leadBefore = await one(db, 'SELECT to_jsonb(l)::text AS row FROM leads l WHERE id = $1', [converted.lead_id]);
    const leadsBefore = await one(db, "SELECT count(*) AS n, md5(string_agg(to_jsonb(l)::text, '|' ORDER BY id)) AS hash FROM leads l");
    const policiesBefore = await one(db, "SELECT md5(string_agg(tablename || permissive || cmd || qual || with_check, '|' ORDER BY tablename)) AS hash FROM pg_policies WHERE policyname = 'office_roles_only'");

    await expectScriptFailure(db, FEATURE_ROLLBACK, /still have role sales/);
    assert.equal(await count(db, 'field_visits'), 1, 'a refused rollback changes nothing');
    await db.query("DELETE FROM app_members WHERE role = 'sales'");          // documented removal procedure
    await db.exec(FEATURE_ROLLBACK);

    // Feature objects are gone.
    for (const table of NEW_TABLES) assert.equal((await one(db, 'SELECT to_regclass($1) AS t', [`public.${table}`])).t, null, `${table} removed`);
    assert.equal(await count(db, 'pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace', "n.nspname = 'field_sales_internal' OR (n.nspname = 'public' AND (p.proname LIKE '%field_visit%' OR p.proname LIKE '%field_sales%'))"), 0);
    assert.equal((await one(db, "SELECT to_regnamespace('field_sales_internal') AS s")).s, null);
    assert.equal(await count(db, 'pg_trigger', "tgname LIKE 'field_%'"), 0);
    assert.equal(await count(db, 'b2p_migration_internal.object_registry', "migration = 'field_sales'"), 0);
    // Data was archived privately.
    assert.equal(await count(db, 'pg_tables', "schemaname = 'field_sales_archive'"), 3);
    const archive = (await one(db, "SELECT tablename FROM pg_tables WHERE schemaname = 'field_sales_archive' AND tablename LIKE 'field_visits_%'")).tablename;
    assert.equal(await count(db, `field_sales_archive.${archive}`), 1);

    // SECURITY: the 19 restrictive policies are still there, identical, and still enforced.
    assert.equal(await policyCount(db), 19);
    assert.deepEqual(await one(db, "SELECT md5(string_agg(tablename || permissive || cmd || qual || with_check, '|' ORDER BY tablename)) AS hash FROM pg_policies WHERE policyname = 'office_roles_only'"), policiesBefore);
    assert.equal(await count(db, 'b2p_migration_internal.object_registry', "migration = 'security_office_roles_only'"), 19);
    for (const table of OPEN_TABLES) {
      await assertNoAccess(db, U.nobody, table, 'no-role account after feature rollback');
      await assertNoAccess(db, null, table, 'anonymous after feature rollback');
    }
    await as(db, U.staffA);
    for (const table of OPEN_TABLES) assert.ok(await count(db, table) >= 1, `staff still reads ${table}`);
    await assert.rejects(db.query(`SELECT * FROM field_sales_archive.${archive}`), /permission denied/);

    // LEADS: not one lead row changed; the converted lead is still valid and still usable.
    await asAdmin(db);
    assert.deepEqual(await one(db, "SELECT count(*) AS n, md5(string_agg(to_jsonb(l)::text, '|' ORDER BY id)) AS hash FROM leads l"), leadsBefore);
    assert.equal((await one(db, 'SELECT to_jsonb(l)::text AS row FROM leads l WHERE id = $1', [converted.lead_id])).row, leadBefore.row);
    assert.equal(await count(db, 'pg_constraint', "conname = 'leads_lead_source_check' AND NOT convalidated"), 0);
    await db.exec('ALTER TABLE public.leads VALIDATE CONSTRAINT leads_lead_source_check');   // every row satisfies it
    assert.equal(await count(db, 'follow_ups', `lead_id = '${converted.lead_id}'`), 1, 'its follow-up is kept');
    assert.equal(await count(db, 'lead_activities', `lead_id = '${converted.lead_id}'`), 2, 'its timeline is kept');
    await as(db, U.staffA);
    assert.equal((await db.query("UPDATE leads SET status = 'follow_up', remarks = 'still editable' WHERE id = $1", [converted.lead_id])).affectedRows, 1);
    assert.equal((await one(db, 'SELECT lead_source AS s FROM leads WHERE id = $1', [converted.lead_id])).s, 'field_visit');
    // The role constraint is back to three values.
    await asAdmin(db);
    await assert.rejects(db.query("INSERT INTO app_members(user_id, role) VALUES ($1, 'sales')", [U.nobody]), /app_members_role_check/);

    // The feature can be installed again later; the earlier lead is still there.
    await db.exec(FEATURE_MIGRATION);
    assert.equal(await count(db, 'field_visits'), 0);
    assert.equal(await count(db, 'leads', "lead_source = 'field_visit'"), 1);
  } finally { await db.close(); }
});

t('feature rollback restores the original lead-source constraint only when no lead uses field_visit, and refuses modified objects', async () => {
  const db = await setup({ sales: false });
  try {
    await asAdmin(db);
    await db.exec('ALTER TABLE public.field_visits ADD COLUMN extra text');
    await expectScriptFailure(db, FEATURE_ROLLBACK, /table public\.field_visits was modified/);
    assert.equal(await count(db, 'pg_tables', "schemaname = 'field_sales_archive'"), 0);
    await db.exec('ALTER TABLE public.field_visits DROP COLUMN extra');
    await db.exec(FEATURE_ROLLBACK);
    await assert.rejects(db.query("INSERT INTO leads(company_id, customer_name, lead_source) VALUES ($1, 'x', 'field_visit')", [A]), /leads_lead_source_check/);
    assert.equal(await policyCount(db), 19);
  } finally { await db.close(); }
});

t('security-policy rollback is a separate, explicitly confirmed step and is refused while the feature or a sales account exists', async () => {
  const db = await setup();
  try {
    await asAdmin(db);
    const confirmed = SECURITY_ROLLBACK_CONFIRMATION + '\n' + SECURITY_ROLLBACK;
    await expectScriptFailure(db, SECURITY_ROLLBACK, /confirmation setting not provided/);
    await expectScriptFailure(db, confirmed, /field-sales feature is still installed/);
    assert.equal(await policyCount(db), 19);

    await db.query("DELETE FROM app_members WHERE role = 'sales'");
    await db.exec(FEATURE_ROLLBACK);
    await db.exec('RESET b2p.confirm_reopen_office_tables');
    await expectScriptFailure(db, SECURITY_ROLLBACK, /confirmation setting not provided/);
    assert.equal(await policyCount(db), 19, 'the feature rollback and an unconfirmed attempt both leave the policies in place');

    // A policy changed by hand is not dropped blindly.
    await db.exec('ALTER POLICY office_roles_only ON public.expenses USING (true)');
    await expectScriptFailure(db, confirmed, /policy public\.expenses\/office_roles_only was modified/);
    assert.equal(await count(db, 'pg_policies', "policyname = 'office_roles_only'"), 19);
    await db.exec("ALTER POLICY office_roles_only ON public.expenses USING ((SELECT public.current_app_role()) IN ('owner','admin','staff'))");
    await db.exec('RESET b2p.confirm_reopen_office_tables');

    // Confirmed: the policies go, the tables are open again (this is what the confirmation is about).
    await db.exec(confirmed);
    assert.equal(await count(db, 'pg_policies', "policyname = 'office_roles_only'"), 0);
    assert.equal((await one(db, "SELECT to_regnamespace('b2p_migration_internal') AS s")).s, null);
    await as(db, U.nobody);
    for (const table of OPEN_TABLES) assert.ok(await count(db, table) >= 2, `${table} is open to a no-role account again`);
    // Existing policies were never touched, so the original state is exactly restored.
    await asAdmin(db);
    assert.equal(await count(db, 'pg_policies', "schemaname = 'public'"), 55);
  } finally { await db.close(); }
});
