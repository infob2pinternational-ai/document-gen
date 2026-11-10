// Concurrency tests for field-visit conversion, using INDEPENDENT database
// connections. They need a real PostgreSQL server and are skipped otherwise:
//
//   tests/helpers/with-local-postgres.sh node --test tests/field-sales-concurrency.test.mjs
//
// The server must be local (Unix socket or loopback); the helper refuses
// anything else. Nothing here connects to Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  USE_REAL_POSTGRES, U, EMAIL, A, B, LEAD_A, id, as, asAdmin, one, count, setup, visit, save, convert, tomorrow, approvedVisit
} from './helpers/field-sales-db.mjs';

const t = (name, fn) => test(`[postgres, 2 connections] ${name}`,
  { skip: USE_REAL_POSTGRES ? false : 'needs a local PostgreSQL server: run through tests/helpers/with-local-postgres.sh' }, fn);

/** Resolve once some session of this database is waiting on a lock (i.e. the second caller is really blocked). */
async function waitUntilBlocked(observer, expected = 1) {
  await asAdmin(observer);                 // other sessions' wait state is only visible to their own login role
  for (let attempt = 0; attempt < 200; attempt++) {
    const waiting = await count(observer, 'pg_stat_activity', "datname = current_database() AND state = 'active' AND wait_event_type = 'Lock'");
    if (waiting >= expected) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('The second session never blocked: the calls did not overlap');
}
const settled = promise => Promise.race([promise.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 150))]);

async function totals(db, visitIds) {
  await asAdmin(db);
  const list = visitIds.map(v => `'${v}'`).join(', ');
  return {
    fieldLeads: await count(db, 'leads', "lead_source = 'field_visit'"),
    followUps: await count(db, 'follow_ups', "reason = 'Field visit follow-up'"),
    conversionEvents: await count(db, 'field_visit_events', `visit_id IN (${list}) AND action LIKE 'converted%'`),
    converted: await count(db, 'field_visits', `id IN (${list}) AND status = 'converted'`),
    leadCreatedActivities: await count(db, 'lead_activities la JOIN leads l ON l.id = la.lead_id', "l.lead_source = 'field_visit' AND la.type = 'Lead Created'"),
    reviewStates: await count(db, 'followup_review_state s JOIN follow_ups f ON f.id = s.follow_up_id', "f.reason = 'Field visit follow-up'")
  };
}

t('the same approved visit converted by two reviewers at once yields exactly one lead, one follow-up and one conversion event', async () => {
  const db = await setup();
  try {
    const date = await tomorrow(db);
    const visitId = await approvedVisit(db, 1);
    const first = await db.connect(), second = await db.connect();
    await as(first, U.owner);
    await as(second, U.admin);

    // Session 1 converts inside an open transaction: the work is done but not yet visible to anyone else.
    await first.exec('BEGIN');
    const resultFirst = await convert(first, visitId, { date });
    assert.equal(resultFirst.result, 'converted');

    // Session 2 starts the same conversion while session 1 is still open. It must wait, not proceed.
    const pending = convert(second, visitId, { date, assignee: EMAIL.staffA });
    await waitUntilBlocked(db);
    assert.equal(await settled(pending), false, 'the second conversion is waiting for the first');
    assert.equal((await totals(db, [visitId])).fieldLeads, 0, 'nothing is committed yet');

    await first.exec('COMMIT');
    const resultSecond = await pending;
    assert.equal(resultSecond.result, 'already_converted');
    assert.equal(resultSecond.lead_id, resultFirst.lead_id);
    assert.equal(resultSecond.follow_up_id, resultFirst.follow_up_id);

    assert.deepEqual(await totals(db, [visitId]),
      { fieldLeads: 1, followUps: 1, conversionEvents: 1, converted: 1, leadCreatedActivities: 1, reviewStates: 1 });
    // The first reviewer's choices won; the second caller's different assignee was not applied.
    assert.equal((await one(db, 'SELECT assigned_telecaller_email AS e FROM leads WHERE id = $1', [resultFirst.lead_id])).e, EMAIL.owner);
  } finally { await db.close(); }
});

t('if the first conversion rolls back, the waiting one completes it: still exactly one lead', async () => {
  const db = await setup();
  try {
    const date = await tomorrow(db);
    const visitId = await approvedVisit(db, 1);
    const first = await db.connect(), second = await db.connect();
    await as(first, U.owner);
    await as(second, U.admin);
    await first.exec('BEGIN');
    await convert(first, visitId, { date });
    const pending = convert(second, visitId, { date });
    await waitUntilBlocked(db);
    await first.exec('ROLLBACK');
    const result = await pending;
    assert.equal(result.result, 'converted');
    assert.deepEqual(await totals(db, [visitId]),
      { fieldLeads: 1, followUps: 1, conversionEvents: 1, converted: 1, leadCreatedActivities: 1, reviewStates: 1 });
    assert.equal((await one(db, 'SELECT converted_by_email AS e FROM field_visits WHERE id = $1', [visitId])).e, EMAIL.admin);
  } finally { await db.close(); }
});

t('twenty visits, each raced by two reviewers with no coordination: every visit converts exactly once', async () => {
  const db = await setup();
  try {
    const date = await tomorrow(db);
    const visitIds = [];
    for (let n = 1; n <= 20; n++) visitIds.push(await approvedVisit(db, n));
    const first = await db.connect(), second = await db.connect();
    await as(first, U.owner);
    await as(second, U.admin);
    const outcomes = [];
    for (const visitId of visitIds) {
      const pair = await Promise.all([convert(first, visitId, { date }), convert(second, visitId, { date })]);
      outcomes.push(pair.map(r => r.result).sort().join('+'));
      assert.equal(pair[0].lead_id, pair[1].lead_id, 'both callers are told about the same lead');
    }
    assert.deepEqual([...new Set(outcomes)], ['already_converted+converted']);
    assert.deepEqual(await totals(db, visitIds),
      { fieldLeads: 20, followUps: 20, conversionEvents: 20, converted: 20, leadCreatedActivities: 20, reviewStates: 20 });
    assert.equal(await count(db, 'leads l', "lead_source = 'field_visit' AND (SELECT count(*) FROM leads d WHERE d.company_id = l.company_id AND d.lead_number = l.lead_number) > 1"), 0, 'no duplicate lead numbers');
  } finally { await db.close(); }
});

t('two different visits with the same company and phone converted at once: one lead, the other is told about the duplicate', async () => {
  const db = await setup();
  try {
    const date = await tomorrow(db);
    const one_ = await approvedVisit(db, 1, { phone: '90000 55555', business_name: 'Corner Store' });
    const two = await approvedVisit(db, 2, { phone: '+91 9000055555', business_name: 'Corner Store (2nd visit)' }, U.salesA2);
    const first = await db.connect(), second = await db.connect();
    await as(first, U.owner);
    await as(second, U.admin);

    await first.exec('BEGIN');
    const resultFirst = await convert(first, one_, { date });
    assert.equal(resultFirst.result, 'converted');
    // The second visit is a different row, so only the company+phone lock can make it wait.
    const pending = convert(second, two, { date });
    await waitUntilBlocked(db);
    assert.equal(await settled(pending), false, 'the second visit waits for the first conversion of the same phone');
    await first.exec('COMMIT');

    const resultSecond = await pending;
    assert.equal(resultSecond.result, 'duplicates_found');
    assert.deepEqual(resultSecond.matches.map(m => m.id), [resultFirst.lead_id]);
    assert.deepEqual(await totals(db, [one_, two]),
      { fieldLeads: 1, followUps: 1, conversionEvents: 1, converted: 1, leadCreatedActivities: 1, reviewStates: 1 });
    assert.equal((await one(db, 'SELECT status FROM field_visits WHERE id = $1', [two])).status, 'approved', 'the second visit is untouched and can still be linked');

    // The reviewer then links the second visit to the lead the first one created.
    const linked = await convert(second, two, { existing: resultFirst.lead_id });
    assert.equal(linked.mode, 'linked_existing');
    await asAdmin(db);
    assert.equal(await count(db, 'leads', "lead_source = 'field_visit'"), 1);
    assert.equal(await count(db, 'field_visits', `lead_id = '${resultFirst.lead_id}'`), 2);
  } finally { await db.close(); }
});

t('ten same-phone pairs raced with no coordination: exactly one new lead per phone, never two', async () => {
  const db = await setup();
  try {
    const pairs = [];
    for (let n = 1; n <= 10; n++) {
      const phone = `90001${String(10000 + n)}`;
      pairs.push([await approvedVisit(db, 100 + n, { phone }), await approvedVisit(db, 200 + n, { phone: `0${phone}` }, U.salesA2), phone]);
    }
    const first = await db.connect(), second = await db.connect();
    await as(first, U.owner);
    await as(second, U.admin);
    for (const [left, right] of pairs) {
      const results = await Promise.all([convert(first, left), convert(second, right)]);
      assert.deepEqual(results.map(r => r.result).sort(), ['converted', 'duplicates_found']);
    }
    await asAdmin(db);
    assert.equal(await count(db, 'leads', "lead_source = 'field_visit'"), 10);
    for (const [, , phone] of pairs) {
      assert.equal(await count(db, 'leads', `company_id = '${A}' AND right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = '${phone}'`), 1, `one lead for ${phone}`);
    }
    // A forced duplicate racing a normal conversion of the same phone still yields a consistent audit trail.
    const phone = '9000277777';
    const left = await approvedVisit(db, 301, { phone }), right = await approvedVisit(db, 302, { phone }, U.salesA2);
    const results = await Promise.all([convert(first, left, { force: true }), convert(second, right, { force: true })]);
    assert.deepEqual(results.map(r => r.result), ['converted', 'converted']);
    await asAdmin(db);
    const forced = (await db.query("SELECT jsonb_array_length(details->'forced_new_despite_matches') AS n FROM field_visit_events WHERE visit_id IN ($1, $2) AND action = 'converted_new_lead' ORDER BY id", [left, right])).rows.map(r => Number(r.n));
    assert.deepEqual(forced, [0, 1], 'the later of the two saw, and recorded, the lead created by the earlier one');
  } finally { await db.close(); }
});

t('the same visit saved from two devices at once is stored once, and a conversion racing a link to an existing lead stays consistent', async () => {
  const db = await setup();
  try {
    const first = await db.connect(), second = await db.connect();
    await as(first, U.salesA);
    await as(second, U.salesA);
    for (let n = 1; n <= 10; n++) {
      const results = await Promise.all([save(first, visit(n)), save(second, visit(n))]);
      assert.deepEqual(results.map(r => r.result).sort(), ['submitted', 'unchanged']);
    }
    await asAdmin(db);
    assert.equal(await count(db, 'field_visits'), 10);
    assert.equal(await count(db, 'field_visit_events'), 10);

    // One reviewer links a visit to an existing lead while another converts the same visit as new.
    const visitId = await approvedVisit(db, 50, { phone: '9000388888' });
    await as(first, U.owner);
    await as(second, U.admin);
    const results = await Promise.all([convert(first, visitId, { existing: LEAD_A }), convert(second, visitId)]);
    assert.deepEqual(results.map(r => r.result).sort(), ['already_converted', 'converted']);
    assert.equal(results[0].lead_id, results[1].lead_id);
    await asAdmin(db);
    assert.equal(await count(db, 'field_visit_events', `visit_id = '${visitId}' AND action LIKE 'converted%'`), 1);
    const mode = (await one(db, 'SELECT conversion_mode AS m FROM field_visits WHERE id = $1', [visitId])).m;
    assert.equal(await count(db, 'leads', "lead_source = 'field_visit'"), mode === 'new_lead' ? 1 : 0);
  } finally { await db.close(); }
});

// ===========================================================================
// Membership guards under concurrency
//
// Invariant: a user with role "sales" never has an app_company_members row,
// and only a user with role "sales" has field_sales_members rows.
// Each trigger checks a different table from the one it is attached to, so
// without a common per-user lock two transactions could both pass their check
// and both commit. These tests drive the conflicting statements from two
// independent connections and prove that at most one of them can commit.
// ===========================================================================

let nextUser = 5000;
/** A fresh confirmed user with the given role and memberships (created by the administrator). */
async function newUser(db, role, { company = null, fieldCompany = null } = {}) {
  const uid = id(nextUser++);
  await asAdmin(db);
  await db.query('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, now())', [uid, `user${nextUser}@example.test`]);
  await db.query('INSERT INTO app_members(user_id, role) VALUES ($1, $2)', [uid, role]);
  if (company) await db.query('INSERT INTO app_company_members(user_id, company_id) VALUES ($1, $2)', [uid, company]);
  if (fieldCompany) await db.query('INSERT INTO field_sales_members(user_id, company_id) VALUES ($1, $2)', [uid, fieldCompany]);
  return uid;
}
const violations = async db => {
  await asAdmin(db);
  return {
    salesWithNormalMembership: await count(db, 'app_members m', "m.role = 'sales' AND EXISTS (SELECT 1 FROM app_company_members c WHERE c.user_id = m.user_id)"),
    fieldMembershipWithoutSalesRole: await count(db, 'field_sales_members f JOIN app_members m ON m.user_id = f.user_id', "m.role <> 'sales'")
  };
};
const CLEAN = { salesWithNormalMembership: 0, fieldMembershipWithoutSalesRole: 0 };
const state = async (db, uid) => one(db, `SELECT m.role,
  (SELECT count(*) FROM app_company_members c WHERE c.user_id = m.user_id)::int AS normal,
  (SELECT count(*) FROM field_sales_members f WHERE f.user_id = m.user_id)::int AS field
  FROM app_members m WHERE m.user_id = $1`, [uid]);

const SQL = {
  toSales: "UPDATE app_members SET role = 'sales' WHERE user_id = $1",
  toStaff: "UPDATE app_members SET role = 'staff' WHERE user_id = $1",
  addNormal: `INSERT INTO app_company_members(user_id, company_id) VALUES ($1, '${A}')`,
  addField: `INSERT INTO field_sales_members(user_id, company_id) VALUES ($1, '${A}')`
};
const MESSAGE = {
  toSales: /Remove this user's app_company_members rows before assigning the sales role/,
  toStaff: /Remove this user's field_sales_members rows before changing their role from sales/,
  addNormal: /A sales user cannot be given normal company membership/,
  addField: /field_sales_members is only for users whose app_members role is sales/
};

/**
 * Session 1 runs `firstOp` in an open transaction. Session 2 then runs the conflicting
 * `secondOp`; it must WAIT (proving the two overlap) and, once session 1 commits, FAIL.
 * If session 1 rolls back instead, session 2 must succeed.
 */
async function conflict(db, sessions, makeUser, firstOp, secondOp) {
  const [first, second] = sessions;
  for (const outcome of ['COMMIT', 'ROLLBACK']) {
    const uid = await makeUser();
    await first.exec('BEGIN');
    assert.equal((await first.query(SQL[firstOp], [uid])).affectedRows, 1, `${firstOp} succeeds on its own`);
    const pending = second.query(SQL[secondOp], [uid]);
    const handled = pending.then(result => ({ ok: true, result }), error => ({ ok: false, error }));
    await waitUntilBlocked(db);
    assert.equal(await settled(handled), false, `${secondOp} waits while ${firstOp} is uncommitted`);
    await first.exec(outcome);
    const result = await handled;
    if (outcome === 'COMMIT') {
      assert.equal(result.ok, false, `${secondOp} must fail after ${firstOp} committed`);
      assert.match(result.error.message, MESSAGE[secondOp]);
    } else {
      assert.equal(result.ok, true, `${secondOp} succeeds after ${firstOp} rolled back: ${result.error?.message}`);
    }
    assert.deepEqual(await violations(db), CLEAN, `${firstOp} then ${secondOp}, first ${outcome}`);
  }
}

async function adminSessions(db) {
  const first = await db.connect(), second = await db.connect();
  await asAdmin(first); await asAdmin(second);
  return [first, second];
}

t('membership: assigning role sales concurrently with inserting app_company_members - both can never commit', async () => {
  const db = await setup({ sales: false });
  try {
    const sessions = await adminSessions(db);
    const staffWithoutMembership = () => newUser(db, 'staff');
    // Either order: the second transaction waits for the first, re-checks, and is refused.
    await conflict(db, sessions, staffWithoutMembership, 'toSales', 'addNormal');
    await conflict(db, sessions, staffWithoutMembership, 'addNormal', 'toSales');
  } finally { await db.close(); }
});

t('membership: inserting field_sales_members concurrently with changing role away from sales - both can never commit', async () => {
  const db = await setup({ sales: false });
  try {
    const sessions = await adminSessions(db);
    const salesWithoutMembership = () => newUser(db, 'sales');
    await conflict(db, sessions, salesWithoutMembership, 'addField', 'toStaff');
    await conflict(db, sessions, salesWithoutMembership, 'toStaff', 'addField');
  } finally { await db.close(); }
});

t('membership: whole transitions racing each other (sales to staff with normal membership vs. a new field membership, and the reverse)', async () => {
  const db = await setup({ sales: false });
  try {
    const [first, second] = await adminSessions(db);

    // Transaction 1 converts a sales user to staff AND gives normal membership. Transaction 2 adds a field membership.
    for (const outcome of ['COMMIT', 'ROLLBACK']) {
      const uid = await newUser(db, 'sales');
      await first.exec('BEGIN');
      await first.query(SQL.toStaff, [uid]);
      await first.query(SQL.addNormal, [uid]);
      const handled = second.query(SQL.addField, [uid]).then(() => ({ ok: true }), error => ({ ok: false, error }));
      await waitUntilBlocked(db);
      await first.exec(outcome);
      const result = await handled;
      assert.equal(result.ok, outcome === 'ROLLBACK');
      if (!result.ok) assert.match(result.error.message, MESSAGE.addField);
      assert.deepEqual(await state(db, uid), outcome === 'COMMIT' ? { role: 'staff', normal: 1, field: 0 } : { role: 'sales', normal: 0, field: 1 });
      assert.deepEqual(await violations(db), CLEAN);
    }

    // Transaction 1 converts a staff user to sales (removing normal membership) AND adds a field membership.
    // Transaction 2 tries to add another normal membership for the same user.
    for (const outcome of ['COMMIT', 'ROLLBACK']) {
      const uid = await newUser(db, 'staff', { company: B });
      await first.exec('BEGIN');
      await first.query('DELETE FROM app_company_members WHERE user_id = $1', [uid]);
      await first.query(SQL.toSales, [uid]);
      await first.query(SQL.addField, [uid]);
      const handled = second.query(SQL.addNormal, [uid]).then(() => ({ ok: true }), error => ({ ok: false, error }));
      await waitUntilBlocked(db);
      await first.exec(outcome);
      const result = await handled;
      assert.equal(result.ok, outcome === 'ROLLBACK');
      if (!result.ok) assert.match(result.error.message, MESSAGE.addNormal);
      assert.deepEqual(await state(db, uid), outcome === 'COMMIT' ? { role: 'sales', normal: 0, field: 1 } : { role: 'staff', normal: 2, field: 0 });
      assert.deepEqual(await violations(db), CLEAN);
    }

    // The two role changes themselves (staff -> sales and sales -> staff are mutually exclusive by state, so race
    // an upsert that sets role sales against a normal membership arriving through an upsert).
    const uid = await newUser(db, 'staff');
    await first.exec('BEGIN');
    await first.query("INSERT INTO app_members(user_id, role) VALUES ($1, 'sales') ON CONFLICT (user_id) DO UPDATE SET role = 'sales'", [uid]);
    const handled = second.query(`INSERT INTO app_company_members(user_id, company_id) VALUES ($1, '${A}') ON CONFLICT (user_id, company_id) DO NOTHING`, [uid])
      .then(() => ({ ok: true }), error => ({ ok: false, error }));
    await waitUntilBlocked(db);
    await first.exec('COMMIT');
    const result = await handled;
    assert.equal(result.ok, false);
    assert.match(result.error.message, MESSAGE.addNormal);
    assert.deepEqual(await violations(db), CLEAN);
  } finally { await db.close(); }
});

t('membership: forty uncoordinated races - in every one exactly one of the two conflicting statements commits', async () => {
  const db = await setup({ sales: false });
  try {
    const [first, second] = await adminSessions(db);
    const race = async (uid, opA, opB) => {
      const results = await Promise.allSettled([first.query(SQL[opA], [uid]), second.query(SQL[opB], [uid])]);
      const fulfilled = results.filter(r => r.status === 'fulfilled').length;
      assert.equal(fulfilled, 1, `${opA} vs ${opB}: exactly one commits (got ${fulfilled})`);
      const failure = results.find(r => r.status === 'rejected');
      assert.match(failure.reason.message, results[0].status === 'rejected' ? MESSAGE[opA] : MESSAGE[opB]);
    };
    for (let n = 0; n < 20; n++) await race(await newUser(db, 'staff'), 'toSales', 'addNormal');
    for (let n = 0; n < 20; n++) await race(await newUser(db, 'sales'), 'addField', 'toStaff');
    assert.deepEqual(await violations(db), CLEAN);
  } finally { await db.close(); }
});

t('membership: compatible changes for one user still both succeed, and a cross-user deadlock is detected rather than hanging', async () => {
  const db = await setup({ sales: false });
  try {
    const [first, second] = await adminSessions(db);

    // Two field memberships for the same sales user at once: serialised, both commit.
    const sales = await newUser(db, 'sales');
    await first.exec('BEGIN');
    await first.query(SQL.addField, [sales]);
    const other = second.query(`INSERT INTO field_sales_members(user_id, company_id) VALUES ($1, '${B}')`, [sales]);
    await waitUntilBlocked(db);
    await first.exec('COMMIT');
    assert.equal((await other).affectedRows, 1);
    assert.deepEqual(await state(db, sales), { role: 'sales', normal: 0, field: 2 });

    // Two normal memberships for the same staff user at once: both commit.
    const staff = await newUser(db, 'staff');
    const both = await Promise.all([first.query(SQL.addNormal, [staff]), second.query(`INSERT INTO app_company_members(user_id, company_id) VALUES ($1, '${B}')`, [staff])]);
    assert.deepEqual(both.map(r => r.affectedRows), [1, 1]);

    // Changes for DIFFERENT users do not wait for each other.
    const x = await newUser(db, 'staff'), y = await newUser(db, 'staff');
    await first.exec('BEGIN');
    await first.query(SQL.addNormal, [x]);
    assert.equal((await second.query(SQL.addNormal, [y])).affectedRows, 1, 'another user is not blocked');
    await first.exec('COMMIT');

    // Two transactions touching the same two users in opposite order: Postgres detects the deadlock and
    // aborts one; the other commits. Neither hangs, and the invariant holds.
    const p = await newUser(db, 'staff'), q = await newUser(db, 'staff');
    await first.exec('BEGIN'); await second.exec('BEGIN');
    await first.query(SQL.addNormal, [p]);
    await second.query(SQL.addNormal, [q]);
    const results = await Promise.allSettled([first.query(SQL.addNormal, [q]), second.query(SQL.addNormal, [p])]);
    assert.deepEqual(results.map(r => r.status).sort(), ['fulfilled', 'rejected']);
    assert.match(results.find(r => r.status === 'rejected').reason.message, /deadlock detected/);
    await first.exec(results[0].status === 'fulfilled' ? 'COMMIT' : 'ROLLBACK');
    await second.exec(results[1].status === 'fulfilled' ? 'COMMIT' : 'ROLLBACK');
    assert.equal((await state(db, p)).normal + (await state(db, q)).normal, 2, 'the surviving transaction committed both of its rows');
    assert.deepEqual(await violations(db), CLEAN);
  } finally { await db.close(); }
});
