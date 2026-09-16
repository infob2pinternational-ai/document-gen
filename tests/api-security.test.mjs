import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import whatsapp from '../api/whatsapp.js';
import document from '../api/doc.js';
import { requireUser, requireCompanyAccess } from '../server/auth.js';

const savedEnv = { ...process.env };
const company = '11111111-1111-4111-8111-111111111111';
function response() {
  return { headers: {}, statusCode: 200,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; }, end() { return this; }
  };
}
function request(body = {}, query = {}, headers = {}) {
  const req = Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
  Object.assign(req, { method: 'POST', query, headers });
  return req;
}
beforeEach(() => {
  process.env.SUPABASE_URL = 'https://test.invalid';
  process.env.SUPABASE_ANON_KEY = 'test-public-key';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_APP_SECRET;
  mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network request'); });
  mock.method(console, 'error', () => {});
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  mock.restoreAll();
});
test('WhatsApp rejects unauthenticated sends before any network call', async () => {
  const res = response();
  await whatsapp(request({}, { action: 'send-message' }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(fetch.mock.callCount(), 0);
});
test('push rejects unauthenticated sends without exposing key headers', async () => {
  const res = response();
  await document(request({}, { action: 'send-push' }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(Object.keys(res.headers).some(key => key.startsWith('X-Key-')), false);
});
test('invalid and anonymous sessions are denied', async () => {
  for (const body of [{}, { id: 'anonymous', is_anonymous: true }]) {
    fetch.mock.mockImplementation(async () => Response.json(body));
    const res = response();
    assert.equal(await requireUser(request({}, {}, { authorization: 'Bearer token' }), res), null);
    assert.equal(res.statusCode, 401);
  }
});
test('valid user and company are checked with caller token, not service role', async () => {
  fetch.mock.mockImplementation(async url => Response.json(url.endsWith('/auth/v1/user') ? { id: 'user' } : [{ id: company }]));
  const res = response();
  const auth = await requireUser(request({}, {}, { authorization: 'Bearer caller-token' }), res);
  assert.equal(auth.user.id, 'user');
  assert.equal(await requireCompanyAccess(auth, company, res), true);
  for (const call of fetch.mock.calls) assert.equal(call.arguments[1].headers.Authorization, 'Bearer caller-token');
});
test('company denied by RLS blocks dispatch', async () => {
  fetch.mock.mockImplementation(async url => Response.json(url.endsWith('/auth/v1/user') ? { id: 'user' } : []));
  const res = response();
  await whatsapp(request({ company_id: company, phone: '9999999999' }, { action: 'send-message' }, { authorization: 'Bearer token' }), res);
  assert.equal(res.statusCode, 403);
});
test('missing WhatsApp credentials produce failure instead of simulated delivery', async () => {
  fetch.mock.mockImplementation(async url => Response.json(url.endsWith('/auth/v1/user') ? { id: 'user' } : [{ id: company }]));
  const res = response();
  await whatsapp(request({ company_id: company, phone: '9999999999' }, { action: 'send-message' }, { authorization: 'Bearer token' }), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.success, false);
});
test('webhooks fail closed without a configured secret', async () => {
  const res = response();
  await whatsapp(request({ object: 'whatsapp_business_account' }), res);
  assert.equal(res.statusCode, 503);
});
test('unsigned and tampered webhooks are rejected before persistence', async () => {
  process.env.WHATSAPP_APP_SECRET = 'test-secret';
  for (const signature of [undefined, 'sha256=abc', `sha256=${'0'.repeat(64)}`]) {
    const res = response();
    await whatsapp(request({}, {}, { 'x-hub-signature-256': signature }), res);
    assert.equal(res.statusCode, 401);
  }
});
test('correctly signed raw JSON is accepted without reserializing', async () => {
  process.env.WHATSAPP_APP_SECRET = 'test-secret';
  // Avoid all persistence/network operations in this isolated verification test.
  delete process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  const raw = '{ "object": "whatsapp_business_account", "entry": [] }';
  const signature = `sha256=${crypto.createHmac('sha256', 'test-secret').update(raw).digest('hex')}`;
  const res = response();
  await whatsapp(request(raw, {}, { 'x-hub-signature-256': signature }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'EVENT_PROCESSED');
});
