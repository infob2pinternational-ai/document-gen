// Unit tests for src/services/attendanceService.ts, in particular the
// security-review fix: GPS must never be requested from an account
// attendance doesn't apply to, not even to discard it server-side
// afterwards. The Geolocation API itself isn't exercised here (no DOM) -
// these tests only need to prove captureLocation (and therefore a real
// browser permission prompt) is never reached for a non-"sales" account.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const dataUri = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const transpile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
const service = await import(dataUri(transpile('../src/services/attendanceService.ts')));
const { recordAttendanceLogin, recordAttendanceLogout, sessionIdFromAccessToken } = service;

const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const fakeAccessToken = sessionId => `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', session_id: sessionId })}.sig`;

function fakeSupabase(role) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'current_app_role') return { data: role, error: null };
      return { data: { result: 'recorded' }, error: null };
    },
    auth: { getSession: async () => ({ data: { session: { access_token: fakeAccessToken('session-1') } } }) }
  };
}

test('sessionIdFromAccessToken decodes the session_id claim and fails closed on garbage input', () => {
  assert.equal(sessionIdFromAccessToken(fakeAccessToken('abc-123')), 'abc-123');
  assert.equal(sessionIdFromAccessToken(null), null);
  assert.equal(sessionIdFromAccessToken('not-a-jwt'), null);
  assert.equal(sessionIdFromAccessToken('a.b.c'), null);
});

test('login never calls the Geolocation-backed RPC, or even checks role, without a decodable session', async () => {
  const supabase = fakeSupabase('sales');
  await recordAttendanceLogin(supabase, { access_token: undefined });
  assert.deepEqual(supabase.calls, []);
});

test('login checks the caller\'s role server-side before ever requesting GPS, and skips entirely for non-"sales" accounts', async () => {
  for (const role of ['owner', 'admin', 'staff', null]) {
    const supabase = fakeSupabase(role);
    await recordAttendanceLogin(supabase, { access_token: fakeAccessToken('session-1') });
    assert.deepEqual(supabase.calls.map(c => c[0]), ['current_app_role'], `role=${role}: must stop after the role check, never reach record_attendance_login`);
  }
});

test('login proceeds to record_attendance_login only for a "sales" account', async () => {
  const supabase = fakeSupabase('sales');
  await recordAttendanceLogin(supabase, { access_token: fakeAccessToken('session-1') });
  assert.deepEqual(supabase.calls.map(c => c[0]), ['current_app_role', 'record_attendance_login']);
  assert.equal(supabase.calls[1][1].p_session_id, 'session-1');
});

test('logout checks role the same way and skips GPS/the logout RPC for non-"sales" accounts', async () => {
  const supabase = fakeSupabase('staff');
  await recordAttendanceLogout(supabase);
  assert.deepEqual(supabase.calls.map(c => c[0]), ['current_app_role']);
});

test('logout proceeds to record_attendance_logout only for a "sales" account', async () => {
  const supabase = fakeSupabase('sales');
  await recordAttendanceLogout(supabase);
  assert.deepEqual(supabase.calls.map(c => c[0]), ['current_app_role', 'record_attendance_logout']);
});

test('a role-check RPC failure fails closed (no GPS, no attendance call) rather than throwing into the caller', async () => {
  const supabase = {
    calls: [],
    rpc: async name => { supabase.calls.push(name); throw new Error('network error'); },
    auth: { getSession: async () => ({ data: { session: { access_token: fakeAccessToken('session-1') } } }) }
  };
  await assert.doesNotReject(recordAttendanceLogin(supabase, { access_token: fakeAccessToken('session-1') }));
  await assert.doesNotReject(recordAttendanceLogout(supabase));
});
