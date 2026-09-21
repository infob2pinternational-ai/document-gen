import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadUtils } from './load-utils.mjs';

const { drafts } = await loadUtils();

class Storage {
  values = new Map();
  fail = () => false;
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) {
    if (this.fail(key)) throw new Error('Quota exceeded');
    this.values.set(key, String(value));
  }
  removeItem(key) { this.values.delete(key); }
}

const sampleDraftPayload = (customerName = 'Test Corp', rate = 15000) => ({
  draftKey: 'new:invoice:tab-123',
  documentId: null,
  editorType: 'document',
  fields: {
    docType: 'invoice',
    customerName,
    items: [{ id: 'item-1', description: 'Advertising', rate, quantity: 1, amount: rate }]
  },
  lastSaved: '2026-01-01T00:00:00.000Z',
  tabId: 'tab-123'
});

beforeEach(() => {
  globalThis.localStorage = new Storage();
  globalThis.sessionStorage = new Storage();
  sessionStorage.setItem('docgen_tab_id', 'tab-123');
  mock.method(console, 'error', () => {});
});

afterEach(() => mock.restoreAll());

test('draft flush immediately saves pending edits before timer expires (window blur / switch)', () => {
  const saver = drafts.createDraftSaver(5000, 30000);
  try {
    const edit = sampleDraftPayload('B2P Client', 45000);
    saver.markDirty(edit);
    assert.equal(saver.isDirty(), true);
    // Before flush, session storage has not received the edit
    assert.equal(drafts.loadSessionDraft(edit.draftKey), null);

    // Simulating window switch / blur triggers flush() immediately:
    saver.flush();

    // Now session storage has received the edit without waiting 5 seconds
    const saved = drafts.loadSessionDraft(edit.draftKey);
    assert.ok(saved);
    assert.equal(saved.fields.customerName, 'B2P Client');
    assert.equal(saved.fields.items[0].rate, 45000);
    assert.equal(saver.isDirty(), false);
  } finally {
    saver.cancel();
  }
});

test('restoring draft recovers pending fields accurately after window switch', () => {
  const saver = drafts.createDraftSaver(5000, 30000);
  try {
    const edit = sampleDraftPayload('Kerala Supermarket', 28000);
    saver.markDirty(edit);
    // User switches window -> flush() triggers
    saver.flush();

    // App or component restores draft
    const restored = drafts.restoreDraft(edit.draftKey);
    assert.ok(restored);
    assert.equal(restored.draft.fields.customerName, 'Kerala Supermarket');
    assert.equal(restored.draft.fields.items[0].amount, 28000);
  } finally {
    saver.cancel();
  }
});

test('user identity preservation avoids churning user state when id and email match', () => {
  const prevUser = {
    id: 'usr-1',
    email: 'staff@b2pinternational.com',
    user_metadata: { role: 'staff' }
  };
  const sessionUser = {
    id: 'usr-1',
    email: 'staff@b2pinternational.com',
    user_metadata: { role: 'staff' },
    aud: 'authenticated'
  };

  // State updater check logic from App.tsx
  const updateUser = (prev, incoming) => {
    if (
      prev &&
      prev.id === incoming.id &&
      prev.email === incoming.email &&
      JSON.stringify(prev.user_metadata) === JSON.stringify(incoming.user_metadata)
    ) {
      return prev;
    }
    return incoming;
  };

  const result = updateUser(prevUser, sessionUser);
  // Identity is strictly equal (same object reference), preventing component remount
  assert.equal(result, prevUser);
});

