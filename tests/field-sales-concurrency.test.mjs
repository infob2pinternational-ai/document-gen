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
  USE_REAL_POSTGRES, FEATURE_MIGRATION, U, EMAIL, A, B, LEAD_A, id, as, asAdmin, one, count, setup, visit, save, convert, tomorrow, approvedVisit
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

// ===========================================================================
// Identity-changing updates (user_id changes) on all three tables
//
// A statement that changes user_id affects TWO users: the one the row leaves
// (OLD) and the one it goes to (NEW). The guard must fire for such a statement
// on app_members even when role is not mentioned, and must lock both users, in
// ascending user-id order.
// ===========================================================================

/** A confirmed auth user with no account row at all. */
async function newAuthUser(db) {
  const uid = id(nextUser++);
  await asAdmin(db);
  await db.query('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, now())', [uid, `user${nextUser}@example.test`]);
  return uid;
}
/** True if some session of this database starts waiting on a lock within the time limit. */
async function blockedWithin(observer, promise, limitMs = 1500) {
  await asAdmin(observer);
  let done = false;
  promise.then(() => { done = true; }, () => { done = true; });
  for (let waited = 0; waited < limitMs && !done; waited += 20) {
    if (await count(observer, 'pg_stat_activity', "datname = current_database() AND state = 'active' AND wait_event_type = 'Lock'") >= 1) return true;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return false;
}
/**
 * Session 1 runs `firstStatements` in an open transaction; session 2 then runs `second`;
 * session 1 then ends with `outcome`. Reports whether session 2 had to wait and how it ended.
 */
async function overlap(db, [first, second], firstStatements, second_, outcome) {
  await first.exec('BEGIN');
  for (const [sql, params] of firstStatements) await first.query(sql, params);
  const handled = second.query(second_[0], second_[1]).then(r => ({ ok: true, rows: r.affectedRows }), e => ({ ok: false, message: e.message }));
  const waited = await blockedWithin(db, handled);
  await first.exec(outcome);
  return { waited, ...(await handled) };
}

const MOVE = {
  account: 'UPDATE app_members SET user_id = $2 WHERE user_id = $1',
  normal: 'UPDATE app_company_members SET user_id = $2 WHERE user_id = $1',
  field: 'UPDATE field_sales_members SET user_id = $2 WHERE user_id = $1'
};
const lockKey = "hashtextextended('field_sales_membership:' || $1::text, 0)";

// --- the guard as shipped, and deliberately broken copies for the negative controls -------------
const guardStart = FEATURE_MIGRATION.indexOf('CREATE OR REPLACE FUNCTION field_sales_internal.guard_membership()');
const GUARD_SQL = FEATURE_MIGRATION.slice(guardStart, FEATURE_MIGRATION.indexOf('END $$;', guardStart) + 'END $$;'.length);
function broken(sql, replacements) {
  for (const [from, to] of replacements) {
    assert.ok(sql.includes(from), `negative control is stale: "${from}" is no longer in the guard`);
    sql = sql.replace(from, to);
  }
  return sql;
}
const BREAK = {
  // Problem 2: lock only the user the row is going to.
  noOldUserLock: broken(GUARD_SQL, [['CASE WHEN v_identity_change THEN OLD.user_id END', 'NULL::uuid']]),
  // Lock NEW first, then OLD, instead of ascending user-id order.
  unsortedLocks: broken(GUARD_SQL, [['SELECT DISTINCT u FROM unnest(', 'SELECT u FROM unnest('], ['ORDER BY u\n', 'ORDER BY (u = NEW.user_id) DESC\n']]),
  // Problem 1: the trigger as it was before this fix.
  roleOnlyTrigger: `DROP TRIGGER field_sales_guard_membership ON public.app_members;
    CREATE TRIGGER field_sales_guard_membership BEFORE INSERT OR UPDATE OF role ON public.app_members
      FOR EACH ROW EXECUTE FUNCTION field_sales_internal.guard_membership();`
};
assert.ok(/BEFORE INSERT OR UPDATE ON public\.app_members/.test(FEATURE_MIGRATION), 'the shipped trigger covers every UPDATE of app_members');
async function breakGuard(db, sql) { await asAdmin(db); await db.exec(sql); }

// --- scenarios, shared by the real tests and their negative controls ----------------------------

/** Session 1 re-points a sales account from X to Y (no role change). Session 2 gives Y normal membership. */
async function scenarioAccountMoveVsNormalMembership(db, sessions, outcome) {
  const x = await newUser(db, 'sales'), y = await newAuthUser(db);
  const result = await overlap(db, sessions, [[MOVE.account, [x, y]]], [SQL.addNormal, [y]], outcome);
  return { result, x, y, violations: await violations(db) };
}
/**
 * The race a user_id-only update opens. Session 1 re-points a sales account from X to Y. Session 2 inserts
 * normal memberships for Y and for a bystander V in ONE statement. Its guard check for Y runs first; its
 * foreign-key check for Y runs only at the end of the statement. A third session holds V's lock, so if
 * session 2 gets past Y it is held inside the statement, between those two checks, while session 1 commits.
 *   - Guarded: session 2 never gets past Y. It waits for session 1 on Y's lock and is then refused.
 *   - Unguarded: Y's check passes (the account move is not yet visible), session 1 commits, the foreign-key
 *     check then finds Y's account, and a sales user ends up with normal company membership.
 */
async function scenarioAccountMoveWindow(db, [first, second]) {
  const x = await newUser(db, 'sales'), y = await newAuthUser(db), v = await newUser(db, 'staff');
  const gate = await db.connect();
  await asAdmin(gate);
  await gate.query(`SELECT pg_advisory_lock(${lockKey})`, [v]);
  await first.exec('BEGIN');
  await first.query(MOVE.account, [x, y]);
  const handled = second.query(`INSERT INTO app_company_members(user_id, company_id) VALUES ($1, '${A}'), ($2, '${A}')`, [y, v])
    .then(r => ({ ok: true, rows: r.affectedRows }), e => ({ ok: false, message: e.message }));
  await waitUntilBlocked(db, 1);
  await first.exec('COMMIT');
  await gate.query(`SELECT pg_advisory_unlock(${lockKey})`, [v]);
  return { result: await handled, x, y, v, violations: await violations(db) };
}
/** Session 1 moves X's normal membership to Y. Session 2 makes X (the OLD user) sales. */
async function scenarioNormalMoveVsOldUserRole(db, sessions, outcome) {
  const x = await newUser(db, 'staff', { company: B }), y = await newUser(db, 'staff');
  const result = await overlap(db, sessions, [[MOVE.normal, [x, y]]], [SQL.toSales, [x]], outcome);
  return { result, x, y, violations: await violations(db) };
}
/** Session 1 moves X's field membership to Y. Session 2 makes X (the OLD user) staff. */
async function scenarioFieldMoveVsOldUserRole(db, sessions, outcome) {
  const x = await newUser(db, 'sales', { fieldCompany: B }), y = await newUser(db, 'sales');
  const result = await overlap(db, sessions, [[MOVE.field, [x, y]]], [SQL.toStaff, [x]], outcome);
  return { result, x, y, violations: await violations(db) };
}
/**
 * P and Q each own one membership row. Session 1 moves P's row to Q while session 2 moves Q's row to P.
 * A third session holds the lock of the HIGHER user id until both are queued, so the order in which the
 * two transactions take their locks is fully determined by the guard, not by timing.
 */
async function scenarioOppositeMoves(db, [first, second], kind) {
  const role = kind === 'normal' ? 'staff' : 'sales';
  const p = await newUser(db, role, kind === 'normal' ? { company: A } : { fieldCompany: A });
  const q = await newUser(db, role, kind === 'normal' ? { company: B } : { fieldCompany: B });
  assert.ok(p < q, 'P has the lower user id');
  const gate = await db.connect();
  await asAdmin(gate);
  await gate.query(`SELECT pg_advisory_lock(${lockKey})`, [q]);
  const one_ = first.query(MOVE[kind], [p, q]).then(() => 'committed', e => e.message);
  await waitUntilBlocked(db, 1);
  const two = second.query(MOVE[kind], [q, p]).then(() => 'committed', e => e.message);
  await waitUntilBlocked(db, 2);
  await gate.query(`SELECT pg_advisory_unlock(${lockKey})`, [q]);
  const outcomes = await Promise.all([one_, two]);
  return { outcomes, p, q, violations: await violations(db) };
}

t('identity: updating app_members.user_id without changing role is guarded, and the new user id cannot gain normal membership meanwhile', async () => {
  const db = await setup({ sales: false });
  try {
    const sessions = await adminSessions(db);
    // Commit: the sales role now belongs to Y, so the waiting insert for Y is refused.
    let run = await scenarioAccountMoveVsNormalMembership(db, sessions, 'COMMIT');
    assert.equal(run.result.waited, true, 'the membership insert waits for the account move');
    assert.equal(run.result.ok, false);
    assert.match(run.result.message, MESSAGE.addNormal);
    assert.deepEqual(await state(db, run.y), { role: 'sales', normal: 0, field: 0 });
    assert.deepEqual(run.violations, CLEAN);
    // Rollback: Y never got an account, so the insert fails on its foreign key instead.
    run = await scenarioAccountMoveVsNormalMembership(db, sessions, 'ROLLBACK');
    assert.equal(run.result.waited, true);
    assert.equal(run.result.ok, false);
    assert.match(run.result.message, /foreign key/);
    assert.deepEqual(run.violations, CLEAN);

    // The exact window: the membership insert is held between its guard check and its foreign-key check
    // while the account move commits. Guarded, it never gets that far.
    const window = await scenarioAccountMoveWindow(db, sessions);
    assert.equal(window.result.ok, false);
    assert.match(window.result.message, MESSAGE.addNormal);
    assert.deepEqual([await state(db, window.y), await state(db, window.v)], [{ role: 'sales', normal: 0, field: 0 }, { role: 'staff', normal: 0, field: 0 }]);
    assert.deepEqual(window.violations, CLEAN);

    // The OLD user id is locked too: a field membership for X waits, then is refused because X has no account any more.
    const x = await newUser(db, 'sales'), y = await newAuthUser(db);
    let result = await overlap(db, sessions, [[MOVE.account, [x, y]]], [SQL.addField, [x]], 'COMMIT');
    assert.deepEqual([result.waited, result.ok], [true, false]);
    assert.match(result.message, MESSAGE.addField);
    // ... and is accepted if the move is rolled back.
    const x2 = await newUser(db, 'sales'), y2 = await newAuthUser(db);
    result = await overlap(db, sessions, [[MOVE.account, [x2, y2]]], [SQL.addField, [x2]], 'ROLLBACK');
    assert.deepEqual([result.waited, result.ok], [true, true]);

    // A staff account move, against a field membership arriving for the new user id.
    const s1 = await newUser(db, 'staff'), s2 = await newAuthUser(db);
    result = await overlap(db, sessions, [[MOVE.account, [s1, s2]]], [SQL.addField, [s2]], 'COMMIT');
    assert.deepEqual([result.waited, result.ok], [true, false]);
    assert.match(result.message, MESSAGE.addField);
    assert.deepEqual(await violations(db), CLEAN);
  } finally { await db.close(); }
});

t('identity: reassigning a sales account to a user who is concurrently given normal company membership - both can never commit', async () => {
  const db = await setup({ sales: false });
  try {
    const sessions = await adminSessions(db);
    for (const outcome of ['COMMIT', 'ROLLBACK']) {
      // Session 1 creates a staff account with normal membership for Y. Session 2 tries to re-point a sales account at Y.
      const x = await newUser(db, 'sales'), y = await newAuthUser(db);
      const result = await overlap(db, sessions,
        [["INSERT INTO app_members(user_id, role) VALUES ($1, 'staff')", [y]], [SQL.addNormal, [y]]], [MOVE.account, [x, y]], outcome);
      assert.equal(result.waited, true, 'the account move waits for the other transaction on Y');
      if (outcome === 'COMMIT') {
        assert.equal(result.ok, false);
        assert.match(result.message, MESSAGE.toSales, 'refused by the guard, before the duplicate-key check');
        assert.deepEqual([await state(db, x), await state(db, y)], [{ role: 'sales', normal: 0, field: 0 }, { role: 'staff', normal: 1, field: 0 }]);
      } else {
        assert.equal(result.ok, true);
        assert.deepEqual(await state(db, y), { role: 'sales', normal: 0, field: 0 });
      }
      assert.deepEqual(await violations(db), CLEAN);
    }
    // The other order is the first test above. A sales account can also not be re-pointed away while it still has field memberships.
    const withField = await newUser(db, 'sales', { fieldCompany: A }), target = await newAuthUser(db);
    await asAdmin(db);
    await assert.rejects(db.query(MOVE.account, [withField, target]), /Move or remove the memberships of the old user id/);
  } finally { await db.close(); }
});

t("identity: changing the old user's role while another transaction moves their normal membership to a different user", async () => {
  const db = await setup({ sales: false });
  try {
    const sessions = await adminSessions(db);
    // Move commits: X is left with no normal membership, so X may become sales - but only after waiting to see that.
    let run = await scenarioNormalMoveVsOldUserRole(db, sessions, 'COMMIT');
    assert.equal(run.result.waited, true, 'the role change for the OLD user waits for the move');
    assert.equal(run.result.ok, true);
    assert.deepEqual([await state(db, run.x), await state(db, run.y)], [{ role: 'sales', normal: 0, field: 0 }, { role: 'staff', normal: 1, field: 0 }]);
    assert.deepEqual(run.violations, CLEAN);
    // Move rolls back: X still has the membership, so the role change is refused.
    run = await scenarioNormalMoveVsOldUserRole(db, sessions, 'ROLLBACK');
    assert.deepEqual([run.result.waited, run.result.ok], [true, false]);
    assert.match(run.result.message, MESSAGE.toSales);
    assert.deepEqual(await state(db, run.x), { role: 'staff', normal: 1, field: 0 });
    assert.deepEqual(run.violations, CLEAN);

    // The NEW user's role changing at the same time: Y becomes sales first, so the move to Y is refused.
    for (const outcome of ['COMMIT', 'ROLLBACK']) {
      const x = await newUser(db, 'staff', { company: B }), y = await newUser(db, 'staff');
      const result = await overlap(db, sessions, [[SQL.toSales, [y]]], [MOVE.normal, [x, y]], outcome);
      assert.equal(result.waited, true);
      assert.equal(result.ok, outcome === 'ROLLBACK');
      if (!result.ok) assert.match(result.message, MESSAGE.addNormal);
      assert.deepEqual(await violations(db), CLEAN);
    }
  } finally { await db.close(); }
});

t('identity: updating user_id in app_company_members concurrently with a role change for the old user', async () => {
  const db = await setup({ sales: false });
  try {
    const sessions = await adminSessions(db);
    // The role change goes first and does not remove the row (staff -> admin). The move waits on the OLD user's lock.
    for (const outcome of ['COMMIT', 'ROLLBACK']) {
      const x = await newUser(db, 'staff', { company: B }), y = await newUser(db, 'staff');
      const result = await overlap(db, sessions, [["UPDATE app_members SET role = 'admin' WHERE user_id = $1", [x]]], [MOVE.normal, [x, y]], outcome);
      assert.deepEqual([result.waited, result.ok, result.rows], [true, true, 1], `first ${outcome}`);
      assert.deepEqual([await state(db, x), await state(db, y)], [{ role: outcome === 'COMMIT' ? 'admin' : 'staff', normal: 0, field: 0 }, { role: 'staff', normal: 1, field: 0 }]);
    }
    // The old user is being converted to sales (membership removed, role changed) while the move is attempted.
    for (const outcome of ['COMMIT', 'ROLLBACK']) {
      const x = await newUser(db, 'staff', { company: B }), y = await newUser(db, 'staff');
      const result = await overlap(db, sessions,
        [['DELETE FROM app_company_members WHERE user_id = $1', [x]], [SQL.toSales, [x]]], [MOVE.normal, [x, y]], outcome);
      assert.equal(result.waited, true);
      assert.deepEqual([result.ok, result.rows], [true, outcome === 'COMMIT' ? 0 : 1], 'after the conversion commits there is nothing left to move');
      assert.deepEqual(await state(db, x), outcome === 'COMMIT' ? { role: 'sales', normal: 0, field: 0 } : { role: 'staff', normal: 0, field: 0 });
      assert.deepEqual(await violations(db), CLEAN);
    }
  } finally { await db.close(); }
});

t('identity: updating user_id in field_sales_members concurrently with a role change for the old user', async () => {
  const db = await setup({ sales: false });
  try {
    const sessions = await adminSessions(db);
    // Move first: X may stop being sales only once the move has committed.
    let run = await scenarioFieldMoveVsOldUserRole(db, sessions, 'COMMIT');
    assert.deepEqual([run.result.waited, run.result.ok], [true, true]);
    assert.deepEqual([await state(db, run.x), await state(db, run.y)], [{ role: 'staff', normal: 0, field: 0 }, { role: 'sales', normal: 0, field: 1 }]);
    assert.deepEqual(run.violations, CLEAN);
    run = await scenarioFieldMoveVsOldUserRole(db, sessions, 'ROLLBACK');
    assert.deepEqual([run.result.waited, run.result.ok], [true, false]);
    assert.match(run.result.message, MESSAGE.toStaff);
    assert.deepEqual(await state(db, run.x), { role: 'sales', normal: 0, field: 1 });
    assert.deepEqual(run.violations, CLEAN);

    // Role change of the old user first (field membership removed, role changed), move second.
    for (const outcome of ['COMMIT', 'ROLLBACK']) {
      const x = await newUser(db, 'sales', { fieldCompany: B }), y = await newUser(db, 'sales');
      const result = await overlap(db, sessions,
        [['DELETE FROM field_sales_members WHERE user_id = $1', [x]], [SQL.toStaff, [x]]], [MOVE.field, [x, y]], outcome);
      assert.equal(result.waited, true);
      assert.deepEqual([result.ok, result.rows], [true, outcome === 'COMMIT' ? 0 : 1]);
      assert.deepEqual(await violations(db), CLEAN);
    }
    // Role change of the NEW user first: Y stops being sales, so a field membership may not move to Y.
    for (const outcome of ['COMMIT', 'ROLLBACK']) {
      const x = await newUser(db, 'sales', { fieldCompany: B }), y = await newUser(db, 'sales');
      const result = await overlap(db, sessions, [[SQL.toStaff, [y]]], [MOVE.field, [x, y]], outcome);
      assert.equal(result.waited, true);
      assert.equal(result.ok, outcome === 'ROLLBACK');
      if (!result.ok) assert.match(result.message, MESSAGE.addField);
      assert.deepEqual(await violations(db), CLEAN);
    }
  } finally { await db.close(); }
});

t('identity: opposite-direction user-id changes take their locks in the same order, so neither deadlocks', async () => {
  const db = await setup({ sales: false });
  try {
    const sessions = await adminSessions(db);
    for (const kind of ['normal', 'field']) {
      const run = await scenarioOppositeMoves(db, sessions, kind);
      assert.deepEqual(run.outcomes, ['committed', 'committed'], `${kind}: both moves commit, no deadlock`);
      const expected = kind === 'normal' ? { role: 'staff', normal: 1, field: 0 } : { role: 'sales', normal: 0, field: 1 };
      assert.deepEqual([await state(db, run.p), await state(db, run.q)], [expected, expected], 'the two users swapped one membership each');
      assert.deepEqual(run.violations, CLEAN);
    }
    // Thirty uncoordinated opposite moves: never a deadlock.
    const [first, second] = sessions;
    for (let n = 0; n < 15; n++) {
      for (const kind of ['normal', 'field']) {
        const role = kind === 'normal' ? 'staff' : 'sales';
        const p = await newUser(db, role, kind === 'normal' ? { company: A } : { fieldCompany: A });
        const q = await newUser(db, role, kind === 'normal' ? { company: B } : { fieldCompany: B });
        const results = await Promise.allSettled([first.query(MOVE[kind], [p, q]), second.query(MOVE[kind], [q, p])]);
        assert.deepEqual(results.map(r => r.status === 'fulfilled' ? 'ok' : r.reason.message), ['ok', 'ok']);
      }
    }
    assert.deepEqual(await violations(db), CLEAN);
  } finally { await db.close(); }
});

t('identity: every pair of membership operations on the same users, in both orders, with commit and rollback - no combination commits an invalid state', async () => {
  const db = await setup({ sales: false });
  try {
    const summary = await runMatrix(db, await adminSessions(db));
    assert.equal(summary.invalid.length, 0, `invalid states: ${JSON.stringify(summary.invalid.slice(0, 3))}`);
    assert.ok(summary.combinations >= 1500, `ran ${summary.combinations} combinations`);
    assert.ok(summary.bothCommitted > 100 && summary.secondRefused > 100, 'the matrix exercised both compatible and conflicting pairs');
    assert.deepEqual(await violations(db), CLEAN);
  } finally { await db.close(); }
});

/**
 * For each starting state of X and Y, run every ordered pair of operations: the first in an open
 * transaction on one connection, the second on another connection, then commit or roll back the first.
 * After each combination check the whole database for the two kinds of invalid state.
 */
async function runMatrix(db, [first, second], { stopAtFirstInvalid = false } = {}) {
  const operations = {
    'X to sales': (x) => [SQL.toSales, [x]],
    'X to staff': (x) => [SQL.toStaff, [x]],
    'add normal to X': (x) => [SQL.addNormal, [x]],
    'add field to X': (x) => [SQL.addField, [x]],
    'remove normal from X': (x) => ['DELETE FROM app_company_members WHERE user_id = $1', [x]],
    'remove field from X': (x) => ['DELETE FROM field_sales_members WHERE user_id = $1', [x]],
    'move normal X to Y': (x, y) => [MOVE.normal, [x, y]],
    'move field X to Y': (x, y) => [MOVE.field, [x, y]],
    'move normal Y to X': (x, y) => [MOVE.normal, [y, x]],
    'move field Y to X': (x, y) => [MOVE.field, [y, x]],
    'move account X to Z': (x, y, z) => [MOVE.account, [x, z]],
    'add normal to Z': (x, y, z) => [SQL.addNormal, [z]],
    'add field to Z': (x, y, z) => [SQL.addField, [z]]
  };
  const startStates = [
    ['staff', { company: B }], ['staff', {}], ['sales', { fieldCompany: B }], ['sales', {}]
  ];
  const names = Object.keys(operations);
  const summary = { combinations: 0, invalid: [], bothCommitted: 0, secondRefused: 0 };
  for (const [xRole, xMembership] of startStates) {
    for (const [yRole, yMembership] of [['staff', { company: B }], ['sales', { fieldCompany: B }]]) {
      for (const firstName of names) {
        for (const secondName of names) {
          for (const outcome of ['COMMIT', 'ROLLBACK']) {
            const x = await newUser(db, xRole, xMembership), y = await newUser(db, yRole, yMembership), z = await newAuthUser(db);
            await first.exec('BEGIN');
            let firstOk = true;
            try { await first.query(...operations[firstName](x, y, z)); } catch { firstOk = false; }
            const handled = second.query(...operations[secondName](x, y, z)).then(() => true, () => false);
            await blockedWithin(db, handled, 400);
            await first.exec(firstOk ? outcome : 'ROLLBACK');
            const secondOk = await handled;
            summary.combinations++;
            if (firstOk && outcome === 'COMMIT' && secondOk) summary.bothCommitted++;
            if (firstOk && outcome === 'COMMIT' && !secondOk) summary.secondRefused++;
            const found = await violations(db);
            if (found.salesWithNormalMembership + found.fieldMembershipWithoutSalesRole > 0) {
              summary.invalid.push({ x: `${xRole} ${JSON.stringify(xMembership)}`, y: yRole, first: firstName, second: secondName, outcome, found });
              if (stopAtFirstInvalid) return summary;
              // Clean up so one finding does not hide the next.
              await db.exec("ALTER TABLE app_company_members DISABLE TRIGGER USER; ALTER TABLE field_sales_members DISABLE TRIGGER USER;");
              await db.exec("DELETE FROM app_company_members c USING app_members m WHERE m.user_id = c.user_id AND m.role = 'sales'; DELETE FROM field_sales_members f USING app_members m WHERE m.user_id = f.user_id AND m.role <> 'sales';");
              await db.exec("ALTER TABLE app_company_members ENABLE TRIGGER USER; ALTER TABLE field_sales_members ENABLE TRIGGER USER;");
            }
          }
        }
      }
    }
  }
  return summary;
}

// ===========================================================================
// Negative controls
//
// Each control installs a deliberately broken copy of the guard and re-runs a
// scenario from the tests above. It passes only if the breakage is observable,
// which shows that those tests would fail without the corresponding fix.
// ===========================================================================

t('negative control: with the old "UPDATE OF role" trigger, a user_id-only update is unguarded and a sales user gains normal membership', async () => {
  const db = await setup({ sales: false });
  try {
    const sessions = await adminSessions(db);
    await breakGuard(db, BREAK.roleOnlyTrigger);
    // The window scenario from "updating app_members.user_id without changing role": the insert for Y is now ACCEPTED.
    const run = await scenarioAccountMoveWindow(db, sessions);
    assert.equal(run.result.ok, true, 'the normal membership for the new user id was accepted');
    assert.deepEqual(await state(db, run.y), { role: 'sales', normal: 1, field: 0 }, 'a sales user now has normal company membership');
    assert.deepEqual(run.violations, { salesWithNormalMembership: 1, fieldMembershipWithoutSalesRole: 0 });
    // Outside that window the foreign key from the membership tables to app_members still refuses the insert,
    // which is why the simpler overlap needs the guard only for a clean, deterministic answer.
    await asAdmin(db);
    await db.exec("ALTER TABLE app_company_members DISABLE TRIGGER USER; DELETE FROM app_company_members c USING app_members m WHERE m.user_id = c.user_id AND m.role = 'sales'; ALTER TABLE app_company_members ENABLE TRIGGER USER;");
    const simple = await scenarioAccountMoveVsNormalMembership(db, sessions, 'COMMIT');
    assert.equal(simple.result.ok, false);
    assert.match(simple.result.message, /foreign key/, 'refused by the foreign key, not by the guard');
    assert.doesNotMatch(simple.result.message, MESSAGE.addNormal);
  } finally { await db.close(); }
});

t('negative control: without the OLD-user lock, a role change for the old user no longer waits for the move and decides on uncommitted data', async () => {
  const db = await setup({ sales: false });
  try {
    const sessions = await adminSessions(db);
    await breakGuard(db, BREAK.noOldUserLock);
    // "changing an old user's role while another transaction moves their membership": the correct result is
    // { waited: true, ok: true }. Without the lock the role change does not wait and is wrongly refused,
    // even though the move then commits and leaves X with no membership.
    const normal = await scenarioNormalMoveVsOldUserRole(db, sessions, 'COMMIT');
    assert.deepEqual([normal.result.waited, normal.result.ok], [false, false]);
    assert.match(normal.result.message, MESSAGE.toSales);
    assert.deepEqual(await state(db, normal.x), { role: 'staff', normal: 0, field: 0 }, 'X ends with no membership and yet was refused the role');
    // Same for field_sales_members.
    const field = await scenarioFieldMoveVsOldUserRole(db, sessions, 'COMMIT');
    assert.deepEqual([field.result.waited, field.result.ok], [false, false]);
    assert.match(field.result.message, MESSAGE.toStaff);
    // And "updating user_id in app_company_members concurrently with a role change for the old user":
    // the move no longer waits for the old user's uncommitted role change.
    const x = await newUser(db, 'staff', { company: B }), y = await newUser(db, 'staff');
    const result = await overlap(db, sessions, [["UPDATE app_members SET role = 'admin' WHERE user_id = $1", [x]]], [MOVE.normal, [x, y]], 'COMMIT');
    assert.equal(result.waited, false, 'the move did not wait for the old user');
  } finally { await db.close(); }
});

t('negative control: with locks taken in NEW-then-OLD order instead of sorted order, opposite-direction moves deadlock', async () => {
  const db = await setup({ sales: false });
  try {
    const sessions = await adminSessions(db);
    await breakGuard(db, BREAK.unsortedLocks);
    for (const kind of ['normal', 'field']) {
      const run = await scenarioOppositeMoves(db, sessions, kind);
      assert.equal(run.outcomes.filter(o => /deadlock detected/.test(o)).length, 1, `${kind}: one of the two moves is aborted by a deadlock: ${run.outcomes}`);
      assert.equal(run.outcomes.filter(o => o === 'committed').length, 1);
      assert.deepEqual(run.violations, CLEAN, 'a deadlock aborts a transaction; it does not corrupt memberships');
    }
  } finally { await db.close(); }
});
