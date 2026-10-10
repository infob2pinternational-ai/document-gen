import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../database/migrations/20261010053916_followup_timeline_atomic.sql', import.meta.url), 'utf8');
const company = '11111111-1111-4111-8111-111111111111';
const lead = '22222222-2222-4222-8222-222222222222';
const task = '33333333-3333-4333-8333-333333333333';

async function setup(legacy = false) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"email":"caller@example.test"}'::jsonb $$;
    CREATE TABLE leads (id uuid PRIMARY KEY, company_id uuid NOT NULL);
    CREATE TABLE follow_ups (id uuid PRIMARY KEY, company_id uuid NOT NULL, lead_id uuid REFERENCES leads,
      status text, reason text, notes text, completion_note text, follow_up_date date);
    CREATE TABLE lead_activities (id uuid PRIMARY KEY, company_id uuid, lead_id uuid REFERENCES leads,
      ${legacy ? 'action text NOT NULL, note text NOT NULL, user_email text' : 'type text NOT NULL, notes text NOT NULL, performed_by text'}, created_at timestamptz);
    INSERT INTO leads VALUES ('${lead}', '${company}');
    INSERT INTO follow_ups VALUES ('${task}', '${company}', '${lead}', 'pending', 'Call customer', NULL, NULL, '2026-10-10');
  `);
  await db.exec(migration);
  return db;
}

for (const legacy of [false, true]) {
  test(`timeline transaction supports ${legacy ? 'legacy' : 'deployed'} activity schema, retries and future scheduling`, async () => {
    const db = await setup(legacy);
    try {
      await db.exec(`UPDATE follow_ups SET notes = 'Client confirmed requirement', follow_up_date = '2026-10-12' WHERE id = '${task}';`);
      await db.exec(`UPDATE follow_ups SET notes = 'Client confirmed requirement', follow_up_date = '2026-10-12' WHERE id = '${task}';`);
      let rows = (await db.query('SELECT * FROM lead_activities')).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].lead_id, lead);
      assert.equal(rows[0][legacy ? 'note' : 'notes'], 'Client confirmed requirement');
      assert.equal(rows[0][legacy ? 'user_email' : 'performed_by'], 'caller@example.test');
      assert.equal((await db.query('SELECT status, follow_up_date::text FROM follow_ups')).rows[0].status, 'pending');
      await db.exec(`UPDATE follow_ups SET status = 'completed', completion_note = 'Call finished' WHERE id = '${task}';`);
      await db.exec(`UPDATE follow_ups SET status = 'completed', completion_note = 'Call finished' WHERE id = '${task}';`);
      rows = (await db.query('SELECT * FROM lead_activities')).rows;
      assert.equal(rows.length, 2);
      assert.equal(rows[1][legacy ? 'action' : 'type'], 'Follow-up Completed');
      assert.match(rows[1][legacy ? 'note' : 'notes'], /Call finished/);
      await db.exec(`UPDATE follow_ups SET follow_up_date = '2026-10-15' WHERE id = '${task}';`);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM lead_activities')).rows[0].n, 2);
    } finally { await db.close(); }
  });
}

test('activity insert failure rolls back remarks, completion and scheduling', async () => {
  const db = await setup();
  try {
    await db.exec("ALTER TABLE lead_activities ADD CONSTRAINT reject_activity CHECK (false);");
    await assert.rejects(db.exec(`UPDATE follow_ups SET notes = 'Failure', status = 'completed', completion_note = 'Failure', follow_up_date = '2026-10-20' WHERE id = '${task}'`));
    const row = (await db.query('SELECT * FROM follow_ups')).rows[0];
    assert.equal(row.status, 'pending'); assert.equal(row.notes, null); assert.equal(row.completion_note, null);
    assert.equal(row.follow_up_date.toISOString().slice(0, 10), '2026-10-10');
  } finally { await db.close(); }
});

test('cross-company lead is rejected and empty completion follows existing validation', async () => {
  const db = await setup();
  try {
    await assert.rejects(db.exec(`UPDATE follow_ups SET company_id = '44444444-4444-4444-8444-444444444444', notes = 'Wrong tenant' WHERE id = '${task}'`), /another company/);
    await db.exec(`UPDATE follow_ups SET status = 'completed', completion_note = '' WHERE id = '${task}'`);
    assert.match((await db.query('SELECT notes FROM lead_activities')).rows[0].notes, /No completion remarks/);
  } finally { await db.close(); }
});

test('invoker trigger obeys activity RLS and rolls back when insertion is denied', async () => {
  const db = await setup();
  try {
    await db.exec(`GRANT USAGE ON SCHEMA public, auth TO authenticated;
      GRANT SELECT ON leads TO authenticated;
      GRANT SELECT, UPDATE ON follow_ups TO authenticated;
      GRANT SELECT, INSERT ON lead_activities TO authenticated;
      ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;
      CREATE POLICY read_activities ON lead_activities FOR SELECT TO authenticated USING (company_id = '${company}');
      SET ROLE authenticated;`);
    await assert.rejects(db.exec(`UPDATE follow_ups SET status = 'completed' WHERE id = '${task}'`), /row-level security/);
    assert.equal((await db.query('SELECT status FROM follow_ups')).rows[0].status, 'pending');
    await db.exec(`RESET ROLE; CREATE POLICY insert_activities ON lead_activities FOR INSERT TO authenticated WITH CHECK (company_id = '${company}'); SET ROLE authenticated;`);
    await db.exec(`UPDATE follow_ups SET status = 'completed', completion_note = 'Allowed' WHERE id = '${task}'`);
    assert.equal((await db.query('SELECT notes FROM lead_activities')).rows.length, 1);
  } finally { await db.close(); }
});
