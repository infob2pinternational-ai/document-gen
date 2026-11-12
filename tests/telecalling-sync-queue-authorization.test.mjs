// SECURITY REGRESSION: public.claim_telecalling_sync_queue_rows must require a real,
// company-authorized caller.
//
// Before the fix (database/migrations/20261111000001_fix_telecalling_sync_queue_claim_authorization.sql),
// this SECURITY DEFINER function took no company parameter, had no identity check in its body,
// and - per the live grants captured in tests/fixtures/live-schema-2026-11-10.sql - was
// executable by the "anon" role. Anyone with nothing but the public Supabase anon key could call
// it and receive up to p_limit telecalling_google_sync_queue rows (phone numbers, contact names,
// feedback) belonging to ANY company, and would flip those rows to status='syncing', disrupting
// the real sync worker. These tests run entirely on an in-memory/local Postgres; nothing here
// touches Supabase or production.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENGINE, U, EMAIL, A, B, id, as, asAdmin, one, count, openDatabase } from './helpers/field-sales-db.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const FIX = read('../database/migrations/20261111000001_fix_telecalling_sync_queue_claim_authorization.sql');
const ROLLBACK = read('../database/rollback/20261111000001_fix_telecalling_sync_queue_claim_authorization_rollback.sql');
const SECURITY_MIGRATION = read('../database/migrations/20261110000001_security_office_roles_only.sql');
const FEATURE_MIGRATION = read('../database/migrations/20261110000002_field_sales_data_collection.sql');

const t = (name, fn) => test(`[${ENGINE}] ${name}`, fn);

async function seedQueue(db) {
  await asAdmin(db);
  for (const [k, uid] of Object.entries(U)) {
    await db.query('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, now())', [uid, EMAIL[k]]);
  }
  await db.query('INSERT INTO profiles(id, name) VALUES ($1, $2), ($3, $4)', [A, 'Company A', B, 'Company B']);
  await db.query("INSERT INTO app_members(user_id, role) VALUES ($1,'owner'), ($2,'admin'), ($3,'staff'), ($4,'staff')", [U.owner, U.admin, U.staffA, U.staffB]);
  await db.query('INSERT INTO app_company_members(user_id, company_id) VALUES ($1, $2), ($3, $4)', [U.staffA, A, U.staffB, B]);

  const entryA = id(6101), entryB = id(6102);
  await db.query("INSERT INTO telecalling_entries(id, company_id, company_name, phone, call_status) VALUES ($1, $2, 'Shop A', '9000000001', 'Interested')", [entryA, A]);
  await db.query("INSERT INTO telecalling_entries(id, company_id, company_name, phone, call_status) VALUES ($1, $2, 'Shop B', '9000000002', 'Interested')", [entryB, B]);
  const rowA = id(6001), rowB = id(6002);
  await db.query("INSERT INTO telecalling_google_sync_queue(id, company_id, telecalling_entry_id, payload) VALUES ($1, $2, $3, '{\"n\":\"a\"}'::jsonb)", [rowA, A, entryA]);
  await db.query("INSERT INTO telecalling_google_sync_queue(id, company_id, telecalling_entry_id, payload) VALUES ($1, $2, $3, '{\"n\":\"b\"}'::jsonb)", [rowB, B, entryB]);
  return { rowA, rowB, entryA, entryB };
}

async function setupWithFix({ withRegistry = true } = {}) {
  const db = await openDatabase();
  if (withRegistry) {
    await asAdmin(db);
    await db.exec(SECURITY_MIGRATION);
    await db.exec(FEATURE_MIGRATION);
  }
  const rows = await seedQueue(db);
  await asAdmin(db);
  await db.exec(FIX);
  return { db, rows };
}

t('before the fix, the function has no identity/company check and anon can call it (confirms the vulnerability existed)', async () => {
  const db = await openDatabase();
  try {
    const { rowA, rowB } = await seedQueue(db);
    await as(db, null);
    const claimed = await db.query("SELECT id, company_id FROM claim_telecalling_sync_queue_rows('attacker-worker', 10)");
    assert.equal(claimed.rows.length, 2, 'anonymous caller claimed rows from every company');
    assert.deepEqual(claimed.rows.map(r => r.id).sort(), [rowA, rowB].sort());
  } finally { await db.close(); }
});

t('after the fix: anonymous callers are denied entirely', async () => {
  const { db } = await setupWithFix();
  try {
    await as(db, null);
    await assert.rejects(db.query("SELECT * FROM claim_telecalling_sync_queue_rows('w', $1, 10)", [A]), /permission denied/);
    await assert.rejects(db.query("SELECT * FROM claim_telecalling_sync_queue_rows('w', $1, 10)", [null]), /permission denied/);
  } finally { await db.close(); }
});

t('after the fix: a no-role signed-in account and a cross-company caller are denied, never seeing another company\'s rows', async () => {
  const { db, rows } = await setupWithFix();
  try {
    await as(db, U.nobody);
    await assert.rejects(db.query("SELECT * FROM claim_telecalling_sync_queue_rows('w', $1, 10)", [A]), /access denied/);

    await as(db, U.staffB);
    await assert.rejects(db.query("SELECT * FROM claim_telecalling_sync_queue_rows('w', $1, 10)", [A]), /access denied/);

    await asAdmin(db);
    assert.equal((await one(db, 'SELECT status FROM telecalling_google_sync_queue WHERE id = $1', [rows.rowA])).status, 'pending', 'denied calls never touched the row');
  } finally { await db.close(); }
});

t('after the fix: a company member claims only their own company\'s rows, and owner/admin can reach either company', async () => {
  const { db, rows } = await setupWithFix();
  try {
    await as(db, U.staffA);
    const claimedA = await db.query("SELECT id, company_id, status FROM claim_telecalling_sync_queue_rows('w', $1, 10)", [A]);
    assert.deepEqual(claimedA.rows, [{ id: rows.rowA, company_id: A, status: 'syncing' }]);

    await as(db, U.owner);
    const claimedB = await db.query("SELECT id, company_id FROM claim_telecalling_sync_queue_rows('w', $1, 10)", [B]);
    assert.deepEqual(claimedB.rows, [{ id: rows.rowB, company_id: B }]);
    await asAdmin(db);
    assert.equal(await count(db, 'telecalling_google_sync_queue', "status = 'syncing'"), 2);
  } finally { await db.close(); }
});

t('a null or missing company id is refused, not treated as "all companies"', async () => {
  const { db } = await setupWithFix();
  try {
    await as(db, U.staffA);
    await assert.rejects(db.query("SELECT * FROM claim_telecalling_sync_queue_rows('w', NULL, 10)"), /access denied/);
  } finally { await db.close(); }
});

t('the fix is additive, standalone (no registry required) and safe to re-run', async () => {
  const db = await openDatabase();
  try {
    const { rowA } = await seedQueue(db);
    await asAdmin(db);
    await db.exec(FIX);
    await db.exec(FIX);   // re-run: must be a no-op, not an error
    assert.equal((await one(db, "SELECT to_regprocedure('public.claim_telecalling_sync_queue_rows(text,integer)') AS p")).p, null);
    await as(db, U.staffA);
    const claimed = await db.query("SELECT id FROM claim_telecalling_sync_queue_rows('w', $1, 10)", [A]);
    assert.deepEqual(claimed.rows, [{ id: rowA }]);
  } finally { await db.close(); }
});

t('the fix stops, changing nothing, if the old function was already modified by someone else', async () => {
  const db = await openDatabase();
  try {
    await seedQueue(db);
    await asAdmin(db);
    await db.exec("CREATE OR REPLACE FUNCTION public.claim_telecalling_sync_queue_rows(p_worker_id text, p_limit integer DEFAULT 10) RETURNS SETOF public.telecalling_google_sync_queue LANGUAGE sql AS $$ SELECT * FROM public.telecalling_google_sync_queue LIMIT 1 $$;");
    await assert.rejects(db.exec(FIX), /does not match the definition this fix expects to replace/);
    await db.exec('ROLLBACK');   // the migration's own BEGIN was left open by the raised exception
    assert.equal((await one(db, "SELECT to_regprocedure('public.claim_telecalling_sync_queue_rows(text,integer)') AS p")).p, 'claim_telecalling_sync_queue_rows(text,integer)');
  } finally { await db.close(); }
});

t('rollback restores the original (vulnerable) signature, for deliberate, approved use only', async () => {
  const { db, rows } = await setupWithFix();
  try {
    await db.exec(ROLLBACK);
    await as(db, null);
    const claimed = await db.query("SELECT id, company_id FROM claim_telecalling_sync_queue_rows('attacker', 10)");
    assert.equal(claimed.rows.length, 2, 'rollback deliberately restores the anonymous-callable, unscoped function');
    assert.deepEqual(claimed.rows.map(r => r.id).sort(), [rows.rowA, rows.rowB].sort());
  } finally { await db.close(); }
});
