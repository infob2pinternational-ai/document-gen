// Regression tests for the WhatsApp review fixes: outbound document links, inbound webhook
// (status order, duplicates, visible failures, optional shared secret) and two client-side bugs.
// Nothing here touches Meta, Bizylead or Supabase: https.request and fetch are faked.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import whatsapp from '../api/whatsapp.js';
import bizylead from '../api/bizylead-webhook.js';
import {
  buildTextWithMedia, normaliseProviderStatus, providerErrorText, sharedSecretMatches, statusUpdatePath
} from '../server/whatsappHelpers.js';
import { loadWhatsAppService } from './load-utils.mjs';

const service = await loadWhatsAppService();
const company = '11111111-1111-4111-8111-111111111111';
const savedEnv = { ...process.env };

function response() {
  return { headers: {}, statusCode: 200,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; }, end() { return this; } };
}
function request(body, { method = 'POST', query = {}, headers = {} } = {}) {
  const req = Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body ?? {}))]);
  return Object.assign(req, { method, query, headers });
}
/** Replaces https.request; `route` sees each call and returns { status, json }. */
function fakeHttps(route) {
  const calls = [];
  mock.method(https, 'request', (url, options, callback) => {
    const chunks = [];
    const req = new EventEmitter();
    req.write = chunk => chunks.push(chunk);
    req.end = () => {
      const text = chunks.join('');
      const call = { url: String(url), method: options?.method || 'GET', body: text ? JSON.parse(text) : null };
      calls.push(call);
      const { status = 200, json = [] } = route(call) || {};
      const res = new EventEmitter();
      res.statusCode = status;
      callback(res);
      res.emit('data', JSON.stringify(json));
      res.emit('end');
    };
    return req;
  });
  return calls;
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://test.invalid';
  process.env.SUPABASE_ANON_KEY = 'test-public-key';
  for (const key of ['SUPABASE_SERVICE_ROLE_KEY', 'BIZYLEAD_WEBHOOK_SECRET', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_APP_SECRET']) delete process.env[key];
  mock.method(console, 'error', () => {});
  mock.method(console, 'warn', () => {});
  mock.method(console, 'log', () => {});
  const store = new Map();
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  delete globalThis.__waTestSupabase;
  mock.restoreAll();
});

// --- helpers -----------------------------------------------------------------

test('a document message keeps both its caption and its link', () => {
  assert.equal(buildTextWithMedia('Quotation Q-1', 'https://x.test/q.pdf'), 'Quotation Q-1\nhttps://x.test/q.pdf');
  assert.equal(buildTextWithMedia('', 'https://x.test/q.pdf'), 'https://x.test/q.pdf');
  assert.equal(buildTextWithMedia('Hello', undefined), 'Hello');
  assert.equal(buildTextWithMedia('  ', null), '');
});

test('status updates only move forward and an external id cannot add query parameters', () => {
  assert.equal(normaliseProviderStatus('Delivered'), 'delivered');
  assert.equal(normaliseProviderStatus('undelivered'), null);
  assert.ok(statusUpdatePath('wamid.A', 'delivered').endsWith('&status=in.(queued,sent)'));
  assert.ok(statusUpdatePath('wamid.A', 'read').endsWith('&status=in.(queued,sent,delivered)'));
  assert.ok(statusUpdatePath('wamid.A', 'sent').endsWith('&status=in.(queued)'));
  assert.ok(statusUpdatePath('wamid.A', 'failed').endsWith('&status=in.(queued,sent)'));
  const hostile = statusUpdatePath('x&status=eq.read', 'delivered');
  assert.equal(hostile.split('&').length, 2, 'the id stayed one encoded value');
  assert.ok(hostile.includes('x%26status%3Deq.read'));
});

test('provider errors become short text, and the shared secret check fails closed', () => {
  assert.equal(providerErrorText({ message: 'Number not on WhatsApp' }), 'Number not on WhatsApp');
  assert.equal(providerErrorText('plain'), 'plain');
  assert.equal(providerErrorText(null), null);
  assert.equal(providerErrorText('x'.repeat(900)).length, 500);
  assert.equal(sharedSecretMatches('', undefined), true, 'no secret configured: open, as before');
  assert.equal(sharedSecretMatches('s', undefined), false);
  assert.equal(sharedSecretMatches('s', 'wrong'), false);
  assert.equal(sharedSecretMatches('s', 's'), true);
});

// --- outbound: api/whatsapp.js ---------------------------------------------------

function authorisedSend(body) {
  mock.method(globalThis, 'fetch', async url => Response.json(url.endsWith('/auth/v1/user') ? { id: 'user' } : [{ id: company }]));
  return request({ company_id: company, phone: '9999999999', ...body }, { query: { action: 'send-message' }, headers: { authorization: 'Bearer token' } });
}

test('Bizylead send: a document with a caption still delivers its link', async () => {
  process.env.BIZYLEAD_API_KEY = 'key';
  process.env.BIZYLEAD_PHONE_NUMBER_ID = '123';
  const calls = fakeHttps(() => ({ json: { messageId: 'wamid.1' } }));
  const res = response();
  await whatsapp(authorisedSend({ type: 'document', text: 'Quotation Q-1', media_url: 'https://x.test/q.pdf', media_filename: 'Q.pdf' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.text, 'Quotation Q-1\nhttps://x.test/q.pdf');
});

test('Bizylead send: an empty message is refused instead of sent', async () => {
  process.env.BIZYLEAD_API_KEY = 'key';
  process.env.BIZYLEAD_PHONE_NUMBER_ID = '123';
  const calls = fakeHttps(() => ({ json: { messageId: 'wamid.1' } }));
  const res = response();
  await whatsapp(authorisedSend({ type: 'text', text: '   ' }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(calls.length, 0);
});

// --- inbound: api/bizylead-webhook.js ---------------------------------------------

const inbound = { senderPhoneNumber: '919876543210', content: { text: 'hello' }, messageId: 'wamid.IN1', senderName: 'Asha' };
function webhookRoute({ existing = [], messageInsert = { json: [{ id: 'msg-1' }] } } = {}) {
  return ({ url, method }) => {
    if (url.includes('/whatsapp_messages?wa_message_id=eq.') && method === 'GET') return { json: existing };
    if (url.includes('/profiles')) return { json: [{ id: company }] };
    if (url.includes('/whatsapp_conversations') && method === 'GET') return { json: [] };
    if (url.endsWith('/whatsapp_conversations') && method === 'POST') return { json: [{ id: 'conv-1' }] };
    if (url.endsWith('/whatsapp_messages') && method === 'POST') return messageInsert;
    return { json: [] };
  };
}
const posted = (calls, table) => calls.filter(call => call.method === 'POST' && call.url.endsWith(`/${table}`));

test('webhook: a new inbound message is stored once and reported as success', async () => {
  const calls = fakeHttps(webhookRoute());
  const res = response();
  await bizylead(request(inbound), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(posted(calls, 'whatsapp_messages').length, 1);
  assert.equal(posted(calls, 'whatsapp_messages')[0].body.wa_message_id, 'wamid.IN1');
});

test('webhook: a repeated delivery is skipped and does not raise the unread count again', async () => {
  const calls = fakeHttps(webhookRoute({ existing: [{ id: 'already-stored' }] }));
  const res = response();
  await bizylead(request(inbound), res);
  assert.equal(res.body.success, true);
  assert.equal(res.body.duplicateMessages, 1);
  assert.equal(posted(calls, 'whatsapp_messages').length, 0);
  assert.equal(calls.filter(call => call.method === 'PATCH').length, 0);
});

test('webhook: a message that could not be saved is reported, not claimed as success', async () => {
  fakeHttps(webhookRoute({ messageInsert: { status: 500, json: { message: 'db down' } } }));
  const res = response();
  await bizylead(request(inbound), res);
  assert.equal(res.statusCode, 200, 'still 200 so the provider does not disable the webhook');
  assert.equal(res.body.success, false);
  assert.equal(res.body.failedMessages, 1);
});

test('webhook: status updates are forward-only, encoded, and unknown statuses are ignored', async () => {
  const calls = fakeHttps(() => ({ json: [] }));
  const res = response();
  await bizylead(request({ statuses: [
    { id: 'wamid.A&status=eq.read', status: 'delivered' },
    { id: 'wamid.B', status: 'bogus' },
    { id: 'wamid.C', status: 'failed', error: { message: 'Number not on WhatsApp' } }
  ] }), res);
  const patches = calls.filter(call => call.method === 'PATCH');
  assert.equal(patches.length, 2, 'the unknown status was not sent to the database');
  assert.ok(patches[0].url.includes('wa_message_id=eq.wamid.A%26status%3Deq.read&status=in.(queued,sent)'));
  assert.deepEqual(patches[0].body, { status: 'delivered', error_message: null });
  assert.deepEqual(patches[1].body, { status: 'failed', error_message: 'Number not on WhatsApp' });
});

test('webhook: with a secret configured, requests without it are rejected before any database call', async () => {
  process.env.BIZYLEAD_WEBHOOK_SECRET = 's3cret';
  const calls = fakeHttps(webhookRoute());
  for (const bad of [request(inbound), request(inbound, { headers: { 'x-webhook-secret': 'nope' } }), request(inbound, { query: { secret: 'nope' } })]) {
    const res = response();
    await bizylead(bad, res);
    assert.equal(res.statusCode, 401);
  }
  assert.equal(calls.length, 0);
  for (const good of [request(inbound, { headers: { 'x-webhook-secret': 's3cret' } }), request(inbound, { query: { secret: 's3cret' } })]) {
    const res = response();
    await bizylead(good, res);
    assert.equal(res.statusCode, 200);
  }
  const ping = response();
  await bizylead(request('', { method: 'GET' }), ping);
  assert.equal(ping.statusCode, 200, 'the verification ping stays open');
});

test('webhook: without a secret configured it keeps accepting posts, so existing delivery is not interrupted', async () => {
  fakeHttps(webhookRoute());
  const res = response();
  await bizylead(request(inbound), res);
  assert.equal(res.statusCode, 200);
});

// --- client: src/services/whatsappService.ts ------------------------------------------

function fakeCloud({ conversations = { data: [], error: null }, inserts = [] } = {}) {
  globalThis.__waTestSupabase = {
    from: () => ({
      select: () => ({ order: async () => conversations }),
      insert: async row => { inserts.push(row); return { error: null }; },
      update: () => ({ eq: async () => ({ error: null }) })
    })
  };
  return inserts;
}

test('client: the reason a send failed is saved with the message, not only shown once', async () => {
  const inserts = fakeCloud();
  mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Number not on WhatsApp' }, { status: 400 }));
  const message = await service.sendMessage({ conversationId: 'c1', phone: '9999999999', text: 'Hi', senderName: 'Staff' });
  assert.equal(message.status, 'failed');
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].status, 'failed');
  assert.equal(inserts[0].error_message, 'Number not on WhatsApp');
});

test('client: an account the cloud shows no conversations to never sees another user\'s cached chats', async () => {
  localStorage.setItem('docgen_whatsapp_conversations', JSON.stringify([
    { id: 'c-other', customer_name: 'Previous User Customer', phone: '919000000000', last_message: 'private', status: 'open' }
  ]));
  fakeCloud({ conversations: { data: [], error: null } });
  assert.deepEqual(await service.getConversations(), [], 'cloud answered with nothing: show nothing');
  assert.deepEqual(JSON.parse(localStorage.getItem('docgen_whatsapp_conversations')), [], 'the stale copy is replaced');
});

test('client: the cached conversations are still used when the cloud cannot be reached', async () => {
  localStorage.setItem('docgen_whatsapp_conversations', JSON.stringify([
    { id: 'c1', customer_name: 'Asha', phone: '919876543210', last_message: 'hello', status: 'open' }
  ]));
  fakeCloud({ conversations: { data: null, error: { message: 'offline' } } });
  const list = await service.getConversations();
  assert.deepEqual(list.map(c => c.id), ['c1']);
});
