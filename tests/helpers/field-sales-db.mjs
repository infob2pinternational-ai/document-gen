// Shared database helper for the field-sales tests.
//
// Two engines, same tests:
//   * default            in-memory PGlite (single connection)
//   * FIELD_SALES_TEST_PG=1   a throwaway LOCAL PostgreSQL server, reached through
//                             the standard PGHOST / PGPORT / PGUSER variables.
//                             Needed for the two-connection concurrency tests.
//                             Start one with tests/helpers/with-local-postgres.sh.
//
// SAFETY: this helper refuses to connect to anything that is not a local Unix
// socket or the loopback address. It never reads Supabase credentials and no
// test in this repository connects to production.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
export const FIXTURE = read('../fixtures/live-schema-2026-11-10.sql');
export const SECURITY_MIGRATION = read('../../database/migrations/20261110000001_security_office_roles_only.sql');
export const FEATURE_MIGRATION = read('../../database/migrations/20261110000002_field_sales_data_collection.sql');
export const FEATURE_ROLLBACK = read('../../database/rollback/20261110000002_field_sales_feature_rollback.sql');
export const SECURITY_ROLLBACK = read('../../database/rollback/20261110000001_security_office_roles_only_rollback.sql');
export const SECURITY_ROLLBACK_CONFIRMATION = "SET b2p.confirm_reopen_office_tables = 'I accept that all signed-in accounts regain access';";

export const USE_REAL_POSTGRES = process.env.FIELD_SALES_TEST_PG === '1';
export const ENGINE = USE_REAL_POSTGRES ? 'postgres' : 'pglite';
// Role that owns every object in the test database. Like production's "postgres"
// role it is NOT a superuser but can bypass row-level security.
const OWNER_ROLE = 'b2p_test_owner';

function localServerSettings() {
  const host = process.env.PGHOST || '';
  const isLocal = host.startsWith('/') || host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!isLocal) {
    throw new Error(`Refusing to run: PGHOST must be a local Unix socket directory or the loopback address (got "${host}").`);
  }
  if (/supabase|pooler|amazonaws|\.co$|\.com$/i.test(host)) throw new Error('Refusing to run against a remote database.');
  return { host, port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER || 'postgres' };
}

async function pgClient(settings) {
  const { default: pg } = await import('pg');
  // Keep dates, times and numerics as text so both engines return the same shapes where tests compare them.
  for (const oid of [1082, 1083, 1114, 1184, 1700, 20]) pg.types.setTypeParser(oid, value => value);
  const client = new pg.Client(settings);
  await client.connect();
  return client;
}

function wrapPg(client) {
  return {
    engine: 'postgres',
    exec: async sql => { await client.query(sql); },
    query: async (sql, params = []) => {
      const result = await client.query(sql, params);
      const last = Array.isArray(result) ? result[result.length - 1] : result;
      return { rows: last.rows, affectedRows: last.rowCount ?? 0 };
    },
    close: async () => { await client.end(); }
  };
}

/**
 * Open a fresh, empty database with the live-shaped fixture loaded.
 * Returns { engine, exec, query, close, connect }. connect() opens another
 * independent session to the same database (real PostgreSQL only).
 */
export async function openDatabase() {
  if (!USE_REAL_POSTGRES) {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite();
    await db.exec(FIXTURE);
    return {
      engine: 'pglite',
      exec: sql => db.exec(sql),
      query: (sql, params = []) => db.query(sql, params),
      close: () => db.close(),
      connect: async () => { throw new Error('A second connection needs FIELD_SALES_TEST_PG=1'); }
    };
  }

  const server = localServerSettings();
  const name = `field_sales_test_${randomBytes(6).toString('hex')}`;
  const admin = await pgClient({ ...server, database: 'postgres' });
  try {
    // Cluster-wide roles. Tolerate another test file creating them at the same moment.
    for (const [role, options] of [[OWNER_ROLE, 'LOGIN NOSUPERUSER BYPASSRLS'], ['anon', 'NOLOGIN'], ['authenticated', 'NOLOGIN'], ['service_role', 'NOLOGIN BYPASSRLS']]) {
      try { await admin.query(`CREATE ROLE ${role} ${options}`); } catch (error) { if (!/already exists|duplicate key/.test(error.message)) throw error; }
    }
    for (const role of ['anon', 'authenticated', 'service_role']) {
      try { await admin.query(`GRANT ${role} TO ${OWNER_ROLE}`); } catch (error) { if (!/already|tuple concurrently updated/.test(error.message)) throw error; }
    }
    await admin.query(`CREATE DATABASE ${name} OWNER ${OWNER_ROLE}`);
  } finally { await admin.end(); }

  const settings = { ...server, user: OWNER_ROLE, database: name };
  const sessions = [];
  const connect = async () => { const session = wrapPg(await pgClient(settings)); sessions.push(session); return session; };
  const main = await connect();
  await main.exec(FIXTURE);
  return {
    ...main,
    connect,
    close: async () => {
      for (const session of sessions) await session.close().catch(() => {});
      const cleanup = await pgClient({ ...server, database: 'postgres' });
      try { await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); } finally { await cleanup.end(); }
    }
  };
}

// --- identities -------------------------------------------------------------

export const id = n => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
export const U = { owner: id(1), admin: id(2), staffA: id(3), staffB: id(4), salesA: id(5), salesA2: id(6), salesB: id(7), nobody: id(8), spare: id(9) };
export const EMAIL = {
  owner: 'owner@example.test', admin: 'admin@example.test', staffA: 'staff.a@example.test', staffB: 'staff.b@example.test',
  salesA: 'sales.a@example.test', salesA2: 'sales.a2@example.test', salesB: 'sales.b@example.test', nobody: 'nobody@example.test',
  spare: 'spare@example.test'
};
const emailOf = uid => EMAIL[Object.keys(U).find(key => U[key] === uid)] || null;
export const A = id(101), B = id(102);
export const LEAD_A = id(201), LEAD_B = id(202);

/**
 * Database administrator: no request role, bypasses row-level security.
 * This is what the Supabase SQL editor is.
 */
export async function asAdmin(db) {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claims', '', false)");
}
/** Server-side service key: bypasses row-level security but still carries a request role. */
export async function asService(db) {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: 'service_role' })]);
  await db.exec('SET ROLE service_role');
}
/** A signed-in app user, or an anonymous API caller when uid is null. Mirrors how PostgREST sets the session. */
export async function as(db, uid) {
  const role = uid ? 'authenticated' : 'anon';
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify(uid ? { role, sub: uid, email: emailOf(uid) } : { role })]);
  await db.exec(`SET ROLE ${role}`);
}

/** A statement that touches every visible row without changing it: UPDATE t SET <first column> = <first column>. */
export async function noOpUpdate(db, table) {
  const column = (await one(db, `SELECT attname AS c FROM pg_attribute WHERE attrelid = ('public.' || $1)::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum LIMIT 1`, [table])).c;
  return `UPDATE public.${table} SET "${column}" = "${column}"`;
}

export const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
export const count = async (db, table, where = 'true') => Number((await one(db, `SELECT count(*) AS n FROM ${table} WHERE ${where}`)).n);

// --- the 19 tables ----------------------------------------------------------

export const OPEN_TABLES = [
  'account_groups', 'account_heads', 'bank_accounts', 'bank_reconciliation_statements', 'customer_receipts', 'expenses',
  'financial_audit_logs', 'financial_period_locks', 'financial_year_closures', 'journal_entries', 'purchase_bills',
  'supplier_payments', 'suppliers', 'bookings', 'resources', 'google_sync_log', 'google_sync_queue', 'google_sync_settings',
  'lead_activity'
];

/**
 * Build an INSERT for one valid row of any table using its REAL production
 * columns: every NOT NULL column without a default gets a value of the right
 * type, foreign keys are followed to a parent row (created the same way if
 * needed), and CHECK constraints of the form "col = ANY (ARRAY[...])" are
 * honoured. Call it as the administrator; run the returned statement as
 * whichever role is under test. Returns { sql, params }.
 */
export async function buildInsert(db, table, companyId, depth = 0) {
  if (depth > 6) throw new Error(`Foreign-key chain too deep at ${table}`);
  const columns = (await db.query(`
    SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
           (a.attnotnull AND d.adbin IS NULL AND a.attidentity = '' AND a.attgenerated = '') AS required
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = ('public.' || $1)::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [table])).rows;
  const foreignKeys = (await db.query(`
    SELECT a.attname AS col, c.confrelid::regclass::text AS parent, n.nspname AS parent_schema, af.attname AS parent_col
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1]
    JOIN pg_class pc ON pc.oid = c.confrelid JOIN pg_namespace n ON n.oid = pc.relnamespace
    WHERE c.conrelid = ('public.' || $1)::regclass AND c.contype = 'f' AND array_length(c.conkey, 1) = 1`, [table])).rows;
  const checks = (await db.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = ('public.' || $1)::regclass AND contype = 'c'`, [table])).rows;
  const allowed = {};
  for (const { def } of checks) {
    const match = def.match(/^CHECK \(\((\w+) = ANY \(ARRAY\[(.+)\]\)\)\)$/);
    if (match) allowed[match[1]] = match[2].split(',')[0].trim().replace(/^'(.*)'::\w+.*$/, '$1');
  }

  const values = {};
  for (const column of columns) {
    const fk = foreignKeys.find(key => key.col === column.name);
    if (column.name === 'company_id') { values.company_id = companyId; continue; }
    if (!column.required) continue;
    if (fk && fk.parent_schema === 'public') {
      const parent = fk.parent.replace(/^public\./, '');
      const existing = parent === 'profiles' ? { v: companyId }
        : await one(db, `SELECT ${fk.parent_col}::text AS v FROM ${fk.parent} WHERE ${await hasColumn(db, parent, 'company_id') ? 'company_id = $1' : '$1::uuid IS NOT NULL'} LIMIT 1`, [companyId]);
      values[column.name] = existing ? existing.v : await insertRealRow(db, parent, companyId, depth + 1);
    } else if (allowed[column.name] !== undefined) values[column.name] = allowed[column.name];
    else if (column.name === 'id' && column.type === 'text') values.id = `probe-${randomBytes(6).toString('hex')}`;
    else if (column.type === 'uuid') values[column.name] = id(900000 + Math.floor(Math.random() * 90000));
    else if (column.type === 'text' || column.type.startsWith('character')) values[column.name] = `probe-${randomBytes(5).toString('hex')}`;
    else if (/^(integer|bigint|smallint|numeric|double|real)/.test(column.type)) values[column.name] = 1;
    else if (column.type === 'boolean') values[column.name] = false;
    else if (column.type === 'date') values[column.name] = '2026-11-10';
    else if (column.type.startsWith('timestamp')) values[column.name] = '2026-11-10T00:00:00Z';
    else if (column.type.startsWith('time')) values[column.name] = '11:00';
    else if (column.type === 'jsonb' || column.type === 'json') values[column.name] = '{}';
    else if (column.type.endsWith('[]')) values[column.name] = '{}';
    else throw new Error(`insertRealRow: no sample value for ${table}.${column.name} (${column.type})`);
  }
  const names = Object.keys(values);
  const key = columns.some(column => column.name === 'id') ? 'id' : names[0];
  const sql = `INSERT INTO public.${table} (${names.map(name => `"${name}"`).join(', ')}) VALUES (${names.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING ${key}::text AS key`;
  return { sql, params: names.map(name => values[name]), keyColumn: key };
}
/** Build and run the insert with the current role; returns the new row's key. */
export async function insertRealRow(db, table, companyId, depth = 0) {
  const { sql, params } = await buildInsert(db, table, companyId, depth);
  return (await one(db, sql, params)).key;
}
async function hasColumn(db, table, column) {
  return Boolean(await one(db, `SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`, [table, column]));
}

// --- seed data ----------------------------------------------------------------

/** Users, two companies, owner/admin/staff, two leads and two rows in each of the 19 tables. */
export async function seedBase(db) {
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
  for (const table of OPEN_TABLES) for (const company of [A, B]) await insertRealRow(db, table, company);
}

export async function seedSales(db) {
  await asAdmin(db);
  await db.query("INSERT INTO app_members(user_id, role) VALUES ($1,'sales'), ($2,'sales'), ($3,'sales')", [U.salesA, U.salesA2, U.salesB]);
  await db.query('INSERT INTO field_sales_members(user_id, company_id) VALUES ($1,$2), ($3,$4), ($5,$6)', [U.salesA, A, U.salesA2, A, U.salesB, B]);
}

/** Fresh database: fixture, seed data, then (optionally) the two migrations and sales accounts. */
export async function setup({ security = true, feature = true, sales = true } = {}) {
  const db = await openDatabase();
  await seedBase(db);
  await asAdmin(db);
  if (security) await db.exec(SECURITY_MIGRATION);
  if (security && feature) {
    await db.exec(FEATURE_MIGRATION);
    if (sales) await seedSales(db);
  }
  return db;
}

// --- workflow shortcuts --------------------------------------------------------

export const visit = (n, overrides = {}) => ({
  id: id(1000 + n), company_id: A, business_name: `Shop ${n}`, phone: `90000 ${String(10000 + n)}`, location: 'Thrissur',
  contact_person: `Contact ${n}`, requirements: ['website', 'crm'], estimated_budget: '25000', remarks: 'Wants a demo',
  follow_up_date: null, ...overrides
});
export const save = async (db, payload) => (await one(db, 'SELECT save_field_visit($1) AS r', [JSON.stringify(payload)])).r;
export const review = async (db, visitId, action, note = null) => (await one(db, 'SELECT review_field_visit($1, $2, $3) AS r', [visitId, action, note])).r;
export const convert = async (db, visitId, { assignee = null, existing = null, force = false, date = null } = {}) =>
  (await one(db, 'SELECT convert_field_visit_to_lead($1, $2, $3, $4, $5) AS r', [visitId, assignee, existing, force, date])).r;
export const tomorrow = async db => (await one(db, "SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date + 1)::text AS d")).d;

/** Submit as a salesperson and approve as the owner; returns the visit id. */
export async function approvedVisit(db, n, overrides = {}, salesperson = U.salesA) {
  await as(db, salesperson);
  const saved = await save(db, visit(n, overrides));
  await as(db, U.owner);
  await review(db, saved.visit.id, 'approve');
  return saved.visit.id;
}
