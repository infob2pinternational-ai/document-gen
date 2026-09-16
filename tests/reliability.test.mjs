import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadUtils } from './load-utils.mjs';

const { drafts, calculations } = await loadUtils();
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
const payload = () => ({ draftKey: 'new:quotation:tab', documentId: null,
  editorType: 'document', fields: { docType: 'quotation', customerName: 'Customer' },
  lastSaved: '2026-01-01T00:00:00.000Z', tabId: 'tab' });
beforeEach(() => {
  globalThis.localStorage = new Storage();
  globalThis.sessionStorage = new Storage();
  sessionStorage.setItem('docgen_tab_id', 'tab');
  mock.method(console, 'error', () => {});
});
afterEach(() => mock.restoreAll());

test('amount-in-words carries rounded paise into rupees', () => {
  assert.equal(calculations.numberToWordsIndian(1.999), 'Two Rupees Only');
  assert.equal(calculations.numberToWordsIndian(999.999), 'One Thousand Rupees Only');
  assert.equal(calculations.numberToWordsIndian(0.999), 'One Rupee Only');
  assert.equal(calculations.numberToWordsIndian(12.25), 'Twelve Rupees and Twenty Five Paise Only');
});
test('amount-in-words safely handles non-finite input', () => {
  assert.equal(calculations.numberToWordsIndian(Infinity), 'Zero Rupees Only');
  assert.equal(calculations.numberToWordsIndian(NaN), 'Zero Rupees Only');
});
test('closing editor after session autosave still flushes durable recovery', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const saver = drafts.createDraftSaver(5, 30);
  try {
    saver.markDirty(payload());
    t.mock.timers.tick(5);
    assert.equal(saver.isDirty(), false);
    assert.equal(drafts.loadRecoveryDraft(payload().draftKey), null);
    saver.flush();
    assert.equal(drafts.loadRecoveryDraft(payload().draftKey).fields.customerName, 'Customer');
    saver.cancel();
    drafts.deleteDraft(payload().draftKey);
    t.mock.timers.tick(100);
    assert.equal(drafts.loadRecoveryDraft(payload().draftKey), null);
  } finally { saver.cancel(); }
});
test('draft saver construction does not create abandoned timers', () => {
  const timer = mock.method(globalThis, 'setTimeout');
  const saver = drafts.createDraftSaver();
  try { assert.equal(timer.mock.callCount(), 0); } finally { saver.cancel(); }
});
test('old-format migration retains original when durable storage fails', () => {
  const old = { ...payload(), draftKey: 'new:tab' };
  drafts.saveSessionDraft(old);
  localStorage.fail = () => true;
  assert.equal(drafts.migrateOldNewDraftKeyFormat(), null);
  assert.deepEqual(drafts.loadSessionDraft('new:tab'), old);
});
test('old-format migration retains original when session destination fails', () => {
  const old = { ...payload(), draftKey: 'new:tab' };
  drafts.saveSessionDraft(old);
  sessionStorage.fail = key => key.includes('new:quotation:tab');
  assert.equal(drafts.migrateOldNewDraftKeyFormat(), null);
  assert.deepEqual(drafts.loadSessionDraft('new:tab'), old);
});
test('legacy migration retains original on quota error and can retry', () => {
  localStorage.setItem('docgen_draft_document', JSON.stringify(payload().fields));
  localStorage.fail = key => key !== 'docgen_draft_document';
  assert.equal(drafts.migrateLegacyDraft(), null);
  assert.ok(localStorage.getItem('docgen_draft_document'));
  localStorage.fail = () => false;
  assert.ok(drafts.migrateLegacyDraft());
  assert.equal(localStorage.getItem('docgen_draft_document'), null);
});
test('recovery index write failure is not reported as saved', () => {
  localStorage.fail = key => key === 'docgen_drafts_index';
  assert.equal(drafts.saveRecoveryDraft(payload()), false);
});
test('successful migration restores type-scoped draft and removes old key', () => {
  drafts.saveSessionDraft({ ...payload(), draftKey: 'new:tab' });
  const migrated = drafts.migrateOldNewDraftKeyFormat();
  assert.equal(migrated.draftKey, payload().draftKey);
  assert.equal(drafts.loadSessionDraft('new:tab'), null);
  assert.deepEqual(drafts.loadRecoveryDraft(migrated.draftKey), migrated);
});
