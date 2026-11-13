// Database tests for the Staff Attendance & Working Hours tracking system
// (database/migrations/20261113000001_employee_attendance_tracking.sql).
//
// Runs in an in-memory Postgres (PGlite) with the live-shaped fixture, the
// security hardening and the Field Sales feature migrations applied (the
// same base every other test in this repo uses), then this attendance
// migration on top. Nothing here connects to Supabase or any remote database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setup, asAdmin, as, U, EMAIL, one, count } from './helpers/field-sales-db.mjs';

const ATTENDANCE_MIGRATION = readFileSync(new URL('../database/migrations/20261113000001_employee_attendance_tracking.sql', import.meta.url), 'utf8');

async function withAttendance() {
  const db = await setup();
  await asAdmin(db);
  await db.exec(ATTENDANCE_MIGRATION);
  return db;
}

const login = (db, sessionId, opts = {}) =>
  one(db, 'SELECT record_attendance_login($1, $2, $3, $4, $5) AS r',
    [sessionId, opts.lat ?? null, opts.lng ?? null, opts.accuracy ?? null, opts.status ?? 'not_attempted']).then(row => row.r);
const logout = (db, sessionId, opts = {}) =>
  one(db, 'SELECT record_attendance_logout($1, $2, $3, $4, $5) AS r',
    [sessionId, opts.lat ?? null, opts.lng ?? null, opts.accuracy ?? null, opts.status ?? 'not_attempted']).then(row => row.r);
const listSessions = (db, from, to, userId = null) =>
  one(db, 'SELECT coalesce(jsonb_agg(t), \'[]\'::jsonb) AS r FROM list_attendance_sessions($1, $2, $3) t', [from, to, userId]).then(row => row.r);
const summary = (db, date = null) => one(db, 'SELECT attendance_summary($1) AS r', [date]).then(row => row.r);
const correct = (db, sessionId, newLogin, newLogout, reason) =>
  one(db, 'SELECT correct_attendance_session($1, $2, $3, $4) AS r', [sessionId, newLogin, newLogout, reason]).then(row => row.r);

test('a Field Sales login creates exactly one active session', async () => {
  const db = await withAttendance();
  try {
    await as(db, U.salesA);
    const result = await login(db, 'session-1', { status: 'captured', lat: 10.1, lng: 76.2, accuracy: 12 });
    assert.equal(result.result, 'recorded');
    assert.equal(result.session.session_status, 'active');
    assert.equal(result.session.logout_at, null);
    await asAdmin(db);
    assert.equal(await count(db, 'employee_attendance_sessions', `user_id = '${U.salesA}'`), 1);
  } finally { await db.close(); }
});

test('explicit logout completes the session and calculates duration', async () => {
  const db = await withAttendance();
  try {
    await as(db, U.salesA);
    await login(db, 'session-1');
    await asAdmin(db);
    await one(db, "UPDATE employee_attendance_sessions SET login_at = now() - interval '2 hours' WHERE session_id = 'session-1'");
    await as(db, U.salesA);
    const result = await logout(db, 'session-1', { status: 'captured', lat: 10.1, lng: 76.2, accuracy: 15 });
    assert.equal(result.result, 'recorded');
    assert.equal(result.session.session_status, 'completed');
    assert.ok(result.session.duration_seconds >= 7190 && result.session.duration_seconds <= 7210, `duration was ${result.session.duration_seconds}`);
    assert.equal(result.session.logout_location_status, 'captured');
  } finally { await db.close(); }
});

test('a Supabase token refresh (same session_id called again) does not create another session or corrupt the first', async () => {
  const db = await withAttendance();
  try {
    await as(db, U.salesA);
    const first = await login(db, 'session-1');
    const second = await login(db, 'session-1');   // simulates TOKEN_REFRESHED re-firing the same handler
    assert.equal(second.result, 'already_recorded');
    assert.equal(second.session.id, first.session.id);
    await asAdmin(db);
    assert.equal(await count(db, 'employee_attendance_sessions', `user_id = '${U.salesA}'`), 1, 'still exactly one row');
  } finally { await db.close(); }
});

test('a browser refresh that re-fires the same session_id login is also idempotent', async () => {
  const db = await withAttendance();
  try {
    await as(db, U.salesA);
    await login(db, 'session-1', { status: 'captured', lat: 1, lng: 2, accuracy: 5 });
    const again = await login(db, 'session-1', { status: 'captured', lat: 99, lng: 99, accuracy: 99 });  // a stale location must never overwrite
    assert.equal(again.result, 'already_recorded');
    assert.equal(Number(again.session.login_lat), 1);
  } finally { await db.close(); }
});

test('internet disconnection: a session with no logout stays "incomplete" once the employee logs in again, never fabricated as complete', async () => {
  const db = await withAttendance();
  try {
    await as(db, U.salesA);
    const firstLogin = await login(db, 'session-1');
    // Browser closed / connection lost - no logout call ever happens.
    const secondLogin = await login(db, 'session-2');
    assert.equal(secondLogin.result, 'recorded');

    await asAdmin(db);
    const previous = await one(db, 'SELECT * FROM employee_attendance_sessions WHERE session_id = $1', ['session-1']);
    assert.equal(previous.session_status, 'incomplete');
    assert.equal(previous.logout_at, null, 'no logout time is ever invented');
    assert.equal(previous.logout_lat, null, 'no location is ever invented');
    assert.equal(new Date(previous.login_at).getTime(), new Date(firstLogin.session.login_at).getTime(), 'the original login timestamp is preserved exactly');

    const current = await one(db, 'SELECT * FROM employee_attendance_sessions WHERE session_id = $1', ['session-2']);
    assert.equal(current.session_status, 'active');
  } finally { await db.close(); }
});

test('multiple login/logout sessions in one day aggregate correctly; incomplete sessions are excluded from confirmed time', async () => {
  const db = await withAttendance();
  try {
    await as(db, U.salesA);
    await login(db, 'session-1');
    await asAdmin(db);
    await one(db, "UPDATE employee_attendance_sessions SET login_at = now() - interval '3 hours' WHERE session_id = 'session-1'");
    await as(db, U.salesA);
    await logout(db, 'session-1');   // ~3h completed

    await login(db, 'session-2');
    await asAdmin(db);
    await one(db, "UPDATE employee_attendance_sessions SET login_at = now() - interval '1 hour' WHERE session_id = 'session-2'");
    await as(db, U.salesA);
    await logout(db, 'session-2');   // ~1h completed

    await login(db, 'session-3');    // left open: must not count

    await asAdmin(db);
    const rows = await one(db, `SELECT session_status, duration_seconds FROM employee_attendance_sessions WHERE user_id = $1 ORDER BY login_at`, [U.salesA]);
    const all = (await db.query('SELECT session_status, duration_seconds FROM employee_attendance_sessions WHERE user_id = $1 ORDER BY login_at', [U.salesA])).rows;
    assert.deepEqual(all.map(r => r.session_status), ['completed', 'completed', 'active']);
    const confirmedTotal = all.filter(r => r.session_status === 'completed').reduce((sum, r) => sum + Number(r.duration_seconds), 0);
    assert.ok(confirmedTotal >= 14390 && confirmedTotal <= 14410, `confirmed total was ${confirmedTotal} seconds (~4h expected)`);
  } finally { await db.close(); }
});

test('GPS failure never blocks login or logout; the failure status is recorded, not a fabricated location', async () => {
  const db = await withAttendance();
  try {
    await as(db, U.salesA);
    const loginResult = await login(db, 'session-1', { status: 'permission_denied' });
    assert.equal(loginResult.result, 'recorded');
    assert.equal(loginResult.session.login_location_status, 'permission_denied');
    assert.equal(loginResult.session.login_lat, null);

    const logoutResult = await logout(db, 'session-1', { status: 'timeout' });
    assert.equal(logoutResult.result, 'recorded');
    assert.equal(logoutResult.session.session_status, 'completed', 'logout still completes despite GPS timeout');
    assert.equal(logoutResult.session.logout_location_status, 'timeout');
    assert.equal(logoutResult.session.logout_lat, null);
  } finally { await db.close(); }
});

test('login tracking only applies to Field Sales ("sales") accounts - owner, admin and staff are untouched', async () => {
  const db = await withAttendance();
  try {
    for (const uid of [U.owner, U.admin, U.staffA]) {
      await as(db, uid);
      const result = await login(db, `session-${uid}`);
      assert.equal(result.result, 'not_applicable');
    }
    await asAdmin(db);
    assert.equal(await count(db, 'employee_attendance_sessions'), 0, 'no attendance rows for non-sales accounts');
  } finally { await db.close(); }
});

test('Field Sales staff cannot read attendance data directly or through the RPCs', async () => {
  const db = await withAttendance();
  try {
    await as(db, U.salesA);
    await login(db, 'session-1');

    await assert.rejects(listSessions(db, '2020-01-01', '2030-01-01'), /denied|42501/i);
    await assert.rejects(summary(db), /denied|42501/i);
    await assert.rejects(correct(db, '00000000-0000-0000-0000-000000000000', new Date().toISOString(), null, 'test'), /denied|42501/i);

    // Direct table access: no grant exists at all for 'authenticated'.
    await assert.rejects(db.query('SELECT * FROM employee_attendance_sessions'), /permission denied/i);
  } finally { await db.close(); }
});

test('Office Telecalling (staff) cannot read attendance data either', async () => {
  const db = await withAttendance();
  try {
    await as(db, U.staffA);
    await assert.rejects(listSessions(db, '2020-01-01', '2030-01-01'), /denied|42501/i);
    await assert.rejects(summary(db), /denied|42501/i);
    await assert.rejects(db.query('SELECT * FROM employee_attendance_sessions'), /permission denied/i);
  } finally { await db.close(); }
});

test('an anonymous (signed-out) caller is rejected by every attendance RPC - no EXECUTE grant exists for anon', async () => {
  const db = await withAttendance();
  try {
    await as(db, null);
    await assert.rejects(login(db, 'session-x'), /permission denied/i);
    await assert.rejects(logout(db, 'session-x'), /permission denied/i);
    await assert.rejects(listSessions(db, '2020-01-01', '2030-01-01'), /permission denied/i);
    await assert.rejects(summary(db), /permission denied/i);
  } finally { await db.close(); }
});

test('Owner can view attendance: summary and the full session list', async () => {
  const db = await withAttendance();
  try {
    await as(db, U.salesA);
    await login(db, 'session-1', { status: 'captured', lat: 10, lng: 76, accuracy: 8 });

    await as(db, U.owner);
    const today = new Date().toISOString().slice(0, 10);
    const rows = await listSessions(db, today, today);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].employee_email, EMAIL.salesA);
    assert.equal(rows[0].login_location_status, 'captured');

    const s = await summary(db);
    assert.equal(s.total_field_sales, 3);   // salesA, salesA2, salesB seeded by setup()
    assert.equal(s.present_today, 1);
    assert.equal(s.active_sessions, 1);
    assert.equal(s.not_logged_in, 2);
    assert.equal(s.late_arrivals, null, 'no office hours configured yet');
  } finally { await db.close(); }
});

test('IT Admin (the "admin" role) can view attendance exactly like Owner', async () => {
  const db = await withAttendance();
  try {
    await as(db, U.salesA);
    await login(db, 'session-1');
    await as(db, U.admin);
    const today = new Date().toISOString().slice(0, 10);
    assert.equal((await listSessions(db, today, today)).length, 1);
    assert.equal((await summary(db)).present_today, 1);
  } finally { await db.close(); }
});

test('office hours configuration drives the late-arrival count only once Owner/IT Admin configure it', async () => {
  const db = await withAttendance();
  try {
    await as(db, U.owner);
    assert.deepEqual(await one(db, 'SELECT get_attendance_settings() AS r').then(r => r.r), { configured: false });
    await one(db, 'SELECT set_attendance_settings($1, $2, $3) AS r', ['09:00', '18:00', 15]);

    await as(db, U.salesA);
    await login(db, 'late-session');
    await asAdmin(db);
    await one(db, "UPDATE employee_attendance_sessions SET login_at = (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '9 hours 30 minutes') AT TIME ZONE 'Asia/Kolkata' WHERE session_id = 'late-session'");

    await as(db, U.owner);
    const s = await summary(db);
    assert.equal(s.late_arrivals, 1);
  } finally { await db.close(); }
});

test('an admin correction preserves original values, creates an immutable audit record, and never silently overwrites', async () => {
  const db = await withAttendance();
  try {
    await as(db, U.salesA);
    const loginResult = await login(db, 'session-1');
    const sessionId = loginResult.session.id;
    // Browser closed - left incomplete.

    await as(db, U.owner);
    await assert.rejects(
      one(db, 'SELECT correct_attendance_session($1, $2, $3, $4) AS r', [sessionId, new Date().toISOString(), null, '']),
      /reason is required/
    );

    const newLoginMs = Date.now() - 9 * 3600_000;           // 9 hours ago
    const newLogoutMs = newLoginMs + (8 * 3600_000 + 1800_000);  // 8h30m later, still safely in the past
    const newLogin = new Date(newLoginMs).toISOString();
    const newLogout = new Date(newLogoutMs).toISOString();
    const result = await correct(db, sessionId, newLogin, newLogout, 'Verified with the employee by phone; forgot to sign out.');
    assert.equal(result.result, 'corrected');
    assert.equal(result.session.session_status, 'admin_corrected');
    assert.equal(result.session.duration_seconds, 8 * 3600 + 1800);

    await asAdmin(db);
    const audit = await one(db, 'SELECT * FROM employee_attendance_corrections WHERE session_id = $1', [sessionId]);
    assert.equal(audit.old_session_status, 'active');
    assert.equal(audit.old_logout_at, null);
    assert.equal(audit.new_session_status, 'admin_corrected');
    assert.equal(audit.reason, 'Verified with the employee by phone; forgot to sign out.');
    assert.equal(audit.corrected_by, U.owner);

    const current = await one(db, 'SELECT * FROM employee_attendance_sessions WHERE id = $1', [sessionId]);
    assert.equal(new Date(current.login_at).getTime(), new Date(newLogin).getTime());
    assert.equal(new Date(current.logout_at).getTime(), new Date(newLogout).getTime());
  } finally { await db.close(); }
});

test('a correction cannot backdate a session into the future', async () => {
  const db = await withAttendance();
  try {
    await as(db, U.salesA);
    const loginResult = await login(db, 'session-1');
    await as(db, U.owner);
    const future = new Date(Date.now() + 3600_000).toISOString();
    await assert.rejects(
      correct(db, loginResult.session.id, future, null, 'typo test'),
      /cannot be in the future/
    );
  } finally { await db.close(); }
});

test('a Field Sales account cannot correct or modify attendance rows directly', async () => {
  const db = await withAttendance();
  try {
    await as(db, U.salesA);
    const loginResult = await login(db, 'session-1');
    await assert.rejects(
      correct(db, loginResult.session.id, new Date().toISOString(), null, 'self-correction attempt'),
      /denied|42501/i
    );
    await assert.rejects(db.query('UPDATE employee_attendance_sessions SET session_status = $1 WHERE id = $2', ['completed', loginResult.session.id]), /permission denied/i);
  } finally { await db.close(); }
});

test('timezone: a login just after midnight IST is bucketed to the correct IST date, not the UTC date', async () => {
  const db = await withAttendance();
  try {
    await as(db, U.salesA);
    await login(db, 'session-1');
    await asAdmin(db);
    // 2026-11-14 00:30 IST = 2026-11-13 19:00 UTC.
    await one(db, "UPDATE employee_attendance_sessions SET login_at = '2026-11-13T19:00:00Z' WHERE session_id = 'session-1'");
    await as(db, U.owner);
    const s = await summary(db, '2026-11-14');
    assert.equal(s.present_today, 1, 'bucketed by the IST calendar date, not the UTC date');
    const sameDayUtc = await summary(db, '2026-11-13');
    assert.equal(sameDayUtc.present_today, 0);
  } finally { await db.close(); }
});
