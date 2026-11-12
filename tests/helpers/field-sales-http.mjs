// Answers the browser's Supabase requests (auth + REST + RPC) from an
// in-memory Postgres that has the live-shaped schema and both migrations
// applied. Used by the browser tests: the real UI runs against the real
// database functions and row-level security, with no network and no Supabase.
import { readFileSync } from 'node:fs';
import { setup, asAdmin, U, EMAIL, A, B, CATALOG_MIGRATION } from './field-sales-db.mjs';
import { fakeSupabase } from './field-sales-fake-supabase.mjs';

const HANDOFF_MIGRATION = readFileSync(new URL('../../database/migrations/20261112000001_field_visit_daily_calling_handoff.sql', import.meta.url), 'utf8');

export const SUPABASE_URL = 'http://127.0.0.1:54399';
export const PASSWORD = 'correct-horse';
export { U, EMAIL, A, B };

const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const tokenFor = uid => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, email: emailOf(uid) })}.test-signature`;
const emailOf = uid => EMAIL[Object.keys(U).find(key => U[key] === uid)];
const uidFromRequest = request => {
  const header = request.headers()['authorization'] || '';
  try { return JSON.parse(Buffer.from(header.replace(/^Bearer\s+/i, '').split('.')[1], 'base64url').toString()).sub || null; } catch { return null; }
};
const userJson = uid => ({ id: uid, aud: 'authenticated', role: 'authenticated', email: emailOf(uid), email_confirmed_at: '2026-10-01T00:00:00Z',
  app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' });
const sessionJson = uid => ({ access_token: tokenFor(uid), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: `refresh-${uid}`, user: userJson(uid) });
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': '*' };

export async function createBackend() {
  const db = await setup();
  await asAdmin(db);
  await db.exec(HANDOFF_MIGRATION);     // field visit approval hands off to Daily Calling, not a lead
  await db.exec(CATALOG_MIGRATION);     // B2P's real services, not the placeholder catalogue
  const backend = {
    db,
    reachable: true,
    requests: [],
    /** Number of times the browser called an RPC. */
    rpcCalls: name => backend.requests.filter(entry => entry === `rpc:${name}`).length,
    async close() { await db.close(); },
    async sql(text, params = []) { await asAdmin(db); return (await db.query(text, params)).rows; },
    /** Call a database function as a signed-in user, exactly as the app would. Throws on a refusal. */
    async rpcAs(uid, name, args = {}) {
      const result = await fakeSupabase(db, () => uid).rpc(name, args);
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },

    async handle(route) {
      const request = route.request();
      const url = new URL(request.url());
      const reply = (status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: body === undefined ? '' : JSON.stringify(body) });
      // A wildcard does not cover the Authorization header, so echo exactly what the browser asked for.
      if (request.method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': request.headers()['access-control-request-headers'] || '*' } });
      }
      if (!backend.reachable) return route.abort('internetdisconnected');

      // ---- auth ----------------------------------------------------------
      if (url.pathname === '/auth/v1/token') {
        const body = request.postDataJSON() || {};
        if (url.searchParams.get('grant_type') === 'refresh_token') {
          const uid = String(body.refresh_token || '').replace(/^refresh-/, '');
          return emailOf(uid) ? reply(200, sessionJson(uid)) : reply(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
        }
        const key = Object.keys(EMAIL).find(k => EMAIL[k] === String(body.email || '').toLowerCase());
        if (!key || body.password !== PASSWORD) return reply(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
        return reply(200, sessionJson(U[key]));
      }
      if (url.pathname === '/auth/v1/user') {
        const uid = uidFromRequest(request);
        return uid ? reply(200, userJson(uid)) : reply(401, { msg: 'Not signed in' });
      }
      if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: CORS });

      // ---- database ------------------------------------------------------
      const uid = uidFromRequest(request);
      const client = fakeSupabase(db, () => uid);
      const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
      if (rpc) {
        backend.requests.push(`rpc:${rpc[1]}`);
        const result = await client.rpc(rpc[1], request.postDataJSON() || {});
        if (result.error) return reply(result.error.code === 'PGRST202' ? 404 : result.error.code === '42501' ? 403 : 400, { message: result.error.message, code: result.error.code });
        return reply(200, result.data ?? null);
      }
      const table = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
      if (table && request.method() === 'GET') {
        backend.requests.push(`select:${table[1]}`);
        const exists = (await backend.sql("SELECT to_regclass('public.' || $1) AS t", [table[1]]))[0].t;
        if (!exists) return reply(200, []);
        let query = client.from(table[1]).select('*');
        for (const [key, value] of url.searchParams) {
          if (key === 'order') { const [column, direction] = value.split(',')[0].split('.'); query = query.order(column, { ascending: direction !== 'desc' }); }
          else if (key === 'limit') query = query.limit(Number(value));
          else if (value.startsWith('eq.')) query = query.eq(key, value.slice(3));
        }
        const result = await query;
        if (result.error) return reply(result.error.code === '42501' ? 403 : 400, { message: result.error.message, code: result.error.code });
        return reply(200, result.data);
      }
      // Anything else the office app asks for (writes to unrelated tables, realtime): not part of these tests.
      return reply(200, []);
    }
  };
  return backend;
}
