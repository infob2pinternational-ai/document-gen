import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadWhatsAppService } from './load-utils.mjs';
const service = await loadWhatsAppService();
const params = { conversationId: 'conversation', phone: '9999999999', text: 'Test', senderName: 'Staff' };
beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  mock.method(console, 'warn', () => {});
});
afterEach(() => mock.restoreAll());
function cachedMessage() { return JSON.parse(localStorage.getItem('docgen_whatsapp_messages')).conversation[0]; }
test('network failure is failed in response and persisted local history', async () => {
  mock.method(globalThis, 'fetch', async () => { throw new Error('Offline'); });
  const message = await service.sendMessage(params);
  assert.equal(message.status, 'failed');
  assert.equal(cachedMessage().status, 'failed');
  assert.equal(cachedMessage().error_message, 'Offline');
});
test('accepted send records one final sent message with authorization', async () => {
  const transport = mock.method(globalThis, 'fetch', async () => Response.json({ success: true, messageId: 'wamid.test' }));
  const message = await service.sendMessage(params);
  assert.equal(message.status, 'sent');
  assert.equal(cachedMessage().wa_message_id, 'wamid.test');
  assert.equal(JSON.parse(localStorage.getItem('docgen_whatsapp_messages')).conversation.length, 1);
  assert.equal(transport.mock.calls[0].arguments[1].headers.Authorization, 'Bearer test-token');
});
test('simulated success and missing message IDs never become sent', async () => {
  for (const body of [{ success: true, simulated: true, messageId: 'sim_1' }, { success: true }]) {
    const transport = mock.method(globalThis, 'fetch', async () => Response.json(body));
    const message = await service.sendMessage(params);
    assert.equal(message.status, 'failed');
    transport.mock.restore();
  }
});
test('HTTP errors persist failed status instead of leaving queued history', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Not configured' }, { status: 503 }));
  assert.equal((await service.sendMessage(params)).status, 'failed');
  assert.equal(cachedMessage().status, 'failed');
});
