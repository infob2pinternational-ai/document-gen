// Tests for src/services/fieldVisitService.ts: validation, the offline outbox,
// and - through the real createSupabaseFieldSalesApi() - the complete workflow
// against the real database functions in an in-memory Postgres.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { U, EMAIL, A, B, LEAD_A, asAdmin, one, count, setup, tomorrow } from './helpers/field-sales-db.mjs';
import { fakeSupabase, memoryStorage } from './helpers/field-sales-fake-supabase.mjs';

const dataUri = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const transpile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
const service = await import(dataUri(transpile('../src/services/fieldVisitService.ts')
  .replaceAll("'../utils/uuid'", JSON.stringify(dataUri(transpile('../src/utils/uuid.ts'))))));
const { FieldVisitStore, FieldSalesError, createSupabaseFieldSalesApi, emptyVisit, inputFromVisit, validateVisit, toServerPayload,
  toFieldSalesError, normalizePhone, fieldSalesAccessCache, ACCESS_CACHE_MAX_AGE_MS, REQUIREMENT_OPTIONS, requirementLabel } = service;
const { requirementText } = await import(dataUri(transpile('../src/components/fieldsales/fieldSalesText.ts')
  .replaceAll("'../../services/fieldVisitService'", JSON.stringify(dataUri(transpile('../src/services/fieldVisitService.ts')
    .replaceAll("'../utils/uuid'", JSON.stringify(dataUri(transpile('../src/utils/uuid.ts')))))))));

// ---------------------------------------------------------------------------
// Service catalogue: B2P's real services, with old (pre-catalogue) values
// still displaying correctly instead of as a raw database key.
// ---------------------------------------------------------------------------

test('the service catalogue is B2P\'s real services, and legacy values from before it changed still have a real label', () => {
  assert.equal(REQUIREMENT_OPTIONS.length, 18);
  assert.deepEqual(REQUIREMENT_OPTIONS.map(o => o.label).slice(0, 4),
    ['Mobile LED Van Advertising', 'LED Wall Display Rental', 'Lookwalker Advertising', 'Vehicle Branding & Fleet Wraps']);
  assert.equal(REQUIREMENT_OPTIONS.at(-1).label, 'Other / Custom Requirement');
  assert.ok(!REQUIREMENT_OPTIONS.some(o => o.label === 'Website' || o.label === 'Billing Software'), 'the retired options are no longer offered');

  // A visit saved before the catalogue changed, never touched since: still a real label, not a raw key.
  assert.equal(requirementLabel('billing_software'), 'Billing Software');
  assert.equal(requirementLabel('attendance_software'), 'Attendance Software');
  assert.equal(requirementLabel('digital_marketing'), 'Digital Marketing');
  assert.equal(requirementLabel('something_unrecognised'), 'something_unrecognised');

  // Mixed old and new values on the same (old) visit: current options display first, legacy ones after.
  assert.equal(requirementText(['crm', 'digital_marketing', 'other'], 'Inventory app'), 'Digital Marketing, Other: Inventory app, CRM');
  assert.equal(requirementText(['mobile_led_van_advertising', 'graphic_designing']), 'Mobile LED Van Advertising, Graphic Designing');
});

const filled = (overrides = {}) => ({ ...emptyVisit(A), business_name: 'Corner Store', phone: '98765 43210', contact_person: 'Anil',
  location: 'MG Road, Thrissur', requirements: ['website', 'other'], requirement_other: 'Inventory app', estimated_budget: '25000',
  remarks: 'Wants a demo next week', follow_up_date: '', ...overrides });

/** An API whose behaviour the test controls, recording every call. */
function scriptedApi() {
  const api = {
    saved: new Map(), calls: [], mode: 'ok',
    async saveVisit(payload) {
      api.calls.push(payload.id);
      if (api.mode === 'offline') throw new TypeError('Failed to fetch');
      if (api.mode === 'refuse') throw { message: 'Field visit access denied', code: '42501' };
      const result = api.saved.has(payload.id) ? 'unchanged' : 'submitted';
      api.saved.set(payload.id, payload);
      if (api.mode === 'lost-reply') { api.mode = 'ok'; throw new TypeError('Failed to fetch'); }
      return { result, visit: { ...payload, status: 'submitted' } };
    },
    async listVisits() { if (api.mode === 'offline') throw new TypeError('Failed to fetch'); return [...api.saved.values()].map(v => ({ ...v, status: 'submitted' })); }
  };
  return api;
}

// ---------------------------------------------------------------------------
// Validation and error classification
// ---------------------------------------------------------------------------

test('validation gives clear messages and matches the server rules', () => {
  assert.deepEqual(validateVisit(filled(), 'submit'), {});
  assert.deepEqual(validateVisit({ ...emptyVisit(A) }, 'submit'), { business_name: 'Enter the business name.', phone: 'Enter a phone number.' });
  assert.equal(validateVisit({ ...emptyVisit('') , business_name: 'x', phone: '9876543210' }, 'submit').company_id, 'Choose the company this visit is for.');
  assert.equal(validateVisit(filled({ phone: '12' }), 'submit').phone, 'Enter a valid phone number (6 to 15 digits).');
  assert.equal(validateVisit(filled({ estimated_budget: 'about 20k' }), 'submit').estimated_budget, 'Enter the budget as a number, for example 25000.');
  assert.equal(validateVisit(filled({ estimated_budget: '-5' }), 'submit').estimated_budget, 'Enter the budget as a number, for example 25000.');
  assert.equal(validateVisit(filled({ requirements: ['other'], requirement_other: ' ' }), 'submit').requirement_other, 'Say what the other requirement is.');
  assert.equal(validateVisit(filled({ follow_up_date: 'tomorrow' }), 'submit').follow_up_date, 'Choose a valid date.');
  assert.ok(validateVisit(filled({ remarks: 'x'.repeat(2001) }), 'submit').remarks);
  // A draft needs only something to recognise it by.
  assert.deepEqual(validateVisit({ ...emptyVisit(A), business_name: 'Half entered' }, 'draft'), {});
  assert.ok(validateVisit({ ...emptyVisit(A) }, 'draft').business_name);
  assert.deepEqual(['+91 98765 43210', '098765-43210', '9876543210', '0487 2345678'].map(normalizePhone), ['9876543210', '9876543210', '9876543210', '4872345678']);
});

test('errors are sorted into "retry later" and "the server said no"', () => {
  for (const error of [new TypeError('Failed to fetch'), { message: 'canceling statement due to statement timeout', code: '57014' },
    { message: 'deadlock detected', code: '40P01' }, { message: 'Bad gateway', status: 502 }, { message: 'JWT expired', code: 'PGRST301' },
    { message: 'Could not find the function public.save_field_visit(p_visit) in the schema cache', code: 'PGRST202' }]) {
    assert.equal(toFieldSalesError(error).transient, true, error.message);
  }
  for (const error of [{ message: 'Field visit access denied', code: '42501' }, { message: 'A valid phone number is required', code: 'P0001' },
    { message: 'permission denied for function save_field_visit', code: '42501' }]) {
    const classified = toFieldSalesError(error);
    assert.equal(classified.transient, false, error.message);
    assert.equal(classified.message, error.message);
  }
  assert.equal(toFieldSalesError({ message: 'JWT expired', code: 'PGRST301' }).code, 'no_session');
  // The payload never carries identity or status.
  assert.deepEqual(Object.keys(toServerPayload({ ...filled(), status: 'approved', salesperson_id: 'x' })).sort(),
    ['business_name', 'client_created_at', 'company_id', 'contact_person', 'estimated_budget', 'follow_up_date', 'id', 'location', 'phone', 'remarks', 'requirement_other', 'requirements']);
  assert.equal(toServerPayload(filled({ requirements: ['website'], requirement_other: 'left over' })).requirement_other, '');
});

// ---------------------------------------------------------------------------
// Offline outbox
// ---------------------------------------------------------------------------

test('drafts and queued visits survive an application restart', () => {
  const storage = memoryStorage(), api = scriptedApi();
  const store = new FieldVisitStore(U.salesA, storage, api);
  const draft = store.saveDraft(filled({ business_name: 'Draft Shop' }));
  const queued = store.queueForSubmit(filled({ business_name: 'Queued Shop' }));
  assert.deepEqual(store.counts(), { drafts: 1, pending: 1, errors: 0 });

  const afterRestart = new FieldVisitStore(U.salesA, storage, api);      // new instance, same phone storage
  assert.deepEqual(afterRestart.getLocal().map(v => [v.id, v.local_state, v.business_name]).sort(),
    [[draft.id, 'draft', 'Draft Shop'], [queued.id, 'pending', 'Queued Shop']].sort());
  // Editing a draft keeps its id (so it can never become two visits) and its place.
  afterRestart.saveDraft({ ...afterRestart.getLocalById(draft.id), business_name: 'Draft Shop (edited)' });
  assert.equal(afterRestart.getLocal().length, 2);
  assert.equal(afterRestart.getLocalById(draft.id).business_name, 'Draft Shop (edited)');
  // Another user on the same phone sees nothing of this.
  assert.deepEqual(new FieldVisitStore(U.salesB, storage, api).getLocal(), []);
  assert.equal(api.calls.length, 0, 'nothing was sent just by saving');
});

test('offline: visits wait, nothing is lost, and each is sent exactly once when the connection returns', async () => {
  const storage = memoryStorage(), api = scriptedApi();
  const store = new FieldVisitStore(U.salesA, storage, api);
  api.mode = 'offline';
  const first = store.queueForSubmit(filled({ business_name: 'First' }));
  const second = store.queueForSubmit(filled({ business_name: 'Second' }));
  store.saveDraft(filled({ business_name: 'Still a draft' }));

  let summary = await store.sync();
  assert.deepEqual([summary.sent, summary.waiting, summary.failed], [0, 2, 0]);
  assert.match(summary.message, /No connection\. Will retry automatically\./);
  assert.equal(store.getLocalById(first.id).local_state, 'pending');
  assert.match(store.getLocalById(first.id).waiting_reason, /No connection/);
  assert.equal(api.calls.length, 1, 'stops at the first failure instead of hammering the network');

  await store.sync(); await store.sync();                               // still offline
  assert.deepEqual(store.counts(), { drafts: 1, pending: 2, errors: 0 });

  api.mode = 'ok';
  summary = await store.sync();
  assert.deepEqual([summary.sent, summary.waiting, summary.failed], [2, 0, 0]);
  assert.equal(summary.message, '2 visits sent.');
  assert.deepEqual([...api.saved.keys()].sort(), [first.id, second.id].sort());
  assert.deepEqual(api.calls.slice(-2), [first.id, second.id], 'oldest first');
  assert.deepEqual(store.counts(), { drafts: 1, pending: 0, errors: 0 }, 'the draft is untouched: only submitted visits are sent');
  assert.deepEqual(store.getCachedVisits().map(v => v.id).sort(), [first.id, second.id].sort());
  assert.equal((await store.sync()).sent, 0, 'nothing left to send');
});

test('a lost reply is retried with the same id, so the server never receives a second visit', async () => {
  const storage = memoryStorage(), api = scriptedApi();
  const store = new FieldVisitStore(U.salesA, storage, api);
  const visit = store.queueForSubmit(filled());
  api.mode = 'lost-reply';                                              // the server saves, the reply is lost
  assert.equal((await store.sync()).waiting, 1);
  assert.equal(store.getLocalById(visit.id).local_state, 'pending', 'the app cannot know it arrived, so it keeps it');
  assert.equal((await store.sync()).sent, 1);
  assert.deepEqual(api.calls, [visit.id, visit.id]);
  assert.equal(api.saved.size, 1, 'one visit on the server');
  assert.equal(store.getLocal().length, 0);
});

test('several sync triggers at once send each visit once; an edit made during sending is not lost', async () => {
  const storage = memoryStorage(), api = scriptedApi();
  const store = new FieldVisitStore(U.salesA, storage, api);
  store.queueForSubmit(filled());
  const results = await Promise.all([store.sync(), store.sync(), store.sync()]);   // reconnect + timer + button
  assert.equal(api.calls.length, 1);
  assert.ok(results.every(r => r === results[0]));

  // The user edits while the request is in flight.
  const slow = store.queueForSubmit(filled({ business_name: 'Before edit' }));
  const original = api.saveVisit;
  api.saveVisit = async payload => { store.queueForSubmit({ ...store.getLocalById(slow.id), business_name: 'After edit' }); return original(payload); };
  await store.sync();
  api.saveVisit = original;
  assert.equal(store.getLocalById(slow.id)?.business_name, 'After edit', 'the edit is still queued');
  await store.sync();
  assert.equal(api.saved.get(slow.id).business_name, 'After edit');
  assert.equal(store.getLocal().length, 0);
});

test('a visit the server refuses is kept with the reason, can be corrected or retried, and is deleted only on request', async () => {
  const storage = memoryStorage(), api = scriptedApi();
  const store = new FieldVisitStore(U.salesA, storage, api);
  const visit = store.queueForSubmit(filled());
  const later = store.queueForSubmit(filled({ business_name: 'Later one' }));
  api.mode = 'refuse';
  const summary = await store.sync();
  assert.deepEqual([summary.sent, summary.waiting, summary.failed], [0, 0, 2], 'a refusal does not block the visits behind it');
  assert.match(summary.message, /2 visits could not be sent/);
  const refused = store.getLocalById(visit.id);
  assert.deepEqual([refused.local_state, refused.sync_error, refused.business_name], ['error', 'Field visit access denied', 'Corner Store']);
  await store.sync();
  assert.equal(api.calls.length, 2, 'refused visits are not resent automatically');
  assert.equal(new FieldVisitStore(U.salesA, storage, api).getLocalById(visit.id).sync_error, 'Field visit access denied', 'still there after a restart');

  api.mode = 'ok';
  store.retry(visit.id);
  store.queueForSubmit({ ...store.getLocalById(later.id), business_name: 'Later one, corrected' });
  assert.equal((await store.sync()).sent, 2);
  assert.equal(api.saved.get(later.id).business_name, 'Later one, corrected');
  const unwanted = store.saveDraft(filled());
  store.discard(unwanted.id);
  assert.equal(store.getLocal().length, 0);
});

test('if the phone cannot store a visit the app says so instead of pretending it was saved', () => {
  const storage = memoryStorage(), store = new FieldVisitStore(U.salesA, storage, scriptedApi());
  storage.failWrites = true;
  assert.throws(() => store.saveDraft(filled()), error => error instanceof FieldSalesError && /could not save the visit/.test(error.message));
  assert.throws(() => store.queueForSubmit(filled()), /could not save the visit/);
  storage.failWrites = false;
  assert.equal(store.getLocal().length, 0);
});

test('cached access only opens the screens, expires after seven days, and sign-out keeps unsent visits', () => {
  const storage = memoryStorage();
  fieldSalesAccessCache.save(storage, U.salesA, 'sales', [{ id: A, name: 'Company A' }]);
  fieldSalesAccessCache.saveIdentity(storage, { userId: U.salesA, email: EMAIL.salesA });
  assert.deepEqual(fieldSalesAccessCache.load(storage, U.salesA).companies, [{ id: A, name: 'Company A' }]);
  assert.equal(fieldSalesAccessCache.load(storage, U.salesB), null, 'another user has no cached access');
  assert.equal(fieldSalesAccessCache.load(storage, U.salesA, Date.now() + ACCESS_CACHE_MAX_AGE_MS + 1000), null, 'expired');
  const store = new FieldVisitStore(U.salesA, storage, scriptedApi());
  store.queueForSubmit(filled());
  fieldSalesAccessCache.clearIdentity(storage);                         // sign-out
  fieldSalesAccessCache.clear(storage, U.salesA);
  assert.equal(fieldSalesAccessCache.loadIdentity(storage), null);
  assert.equal(new FieldVisitStore(U.salesA, storage, scriptedApi()).counts().pending, 1, 'the unsent visit is still on the phone');
});

// ---------------------------------------------------------------------------
// End to end against the real database functions
// ---------------------------------------------------------------------------

test('end to end: offline draft, sync, office review, correction, conversion to a CRM lead with follow-up, and history', async () => {
  const db = await setup();
  try {
    let currentUser = U.salesA;
    const supabase = fakeSupabase(db, () => currentUser);
    const api = createSupabaseFieldSalesApi(supabase);
    const storage = memoryStorage();
    const date = await tomorrow(db);

    // --- salesperson: companies come from my_field_sales_companies() -------
    assert.deepEqual(await api.companies(), [{ id: A, name: 'Company A' }]);
    const store = new FieldVisitStore(U.salesA, storage, api);

    // --- works offline ------------------------------------------------------
    supabase.state.online = false;
    const visit = store.queueForSubmit(filled({ phone: '90000 12345', follow_up_date: date }));
    store.saveDraft(filled({ business_name: 'Unfinished' }));
    assert.equal((await store.sync()).waiting, 1);
    await asAdmin(db);
    assert.equal(await count(db, 'field_visits'), 0, 'nothing reached the server while offline');

    // --- connection returns; the reply to the first attempt is lost ---------
    supabase.state.online = true;
    supabase.state.failNext = { afterSuccess: new TypeError('Failed to fetch') };
    assert.equal((await store.sync()).waiting, 1);
    assert.equal((await store.sync()).sent, 1);
    await asAdmin(db);
    assert.equal(await count(db, 'field_visits'), 1, 'exactly one visit despite the retry');
    assert.equal(await count(db, 'field_visit_events'), 1, 'and exactly one history entry');
    const stored = await one(db, 'SELECT * FROM field_visits WHERE id = $1', [visit.id]);
    assert.deepEqual([stored.salesperson_id, stored.salesperson_email, stored.company_id, stored.status, stored.phone_normalized],
      [U.salesA, EMAIL.salesA, A, 'submitted', '9000012345']);
    assert.deepEqual(store.counts(), { drafts: 1, pending: 0, errors: 0 });

    // --- a visit for a company the salesperson does not sell for is refused and kept
    const wrong = store.queueForSubmit(filled({ company_id: B, business_name: 'Wrong company' }));
    assert.equal((await store.sync()).failed, 1);
    assert.match(store.getLocalById(wrong.id).sync_error, /access denied/i);
    store.discard(wrong.id);

    // --- salesperson sees only their own visits ----------------------------
    assert.deepEqual((await store.refreshVisits()).map(v => v.id), [visit.id]);
    currentUser = U.salesA2;
    assert.deepEqual(await api.listVisits(), []);
    await assert.rejects(api.review(visit.id, 'approve'), /Only the owner or an admin/);
    await assert.rejects(api.assignees(A), /access denied/i);

    // --- office: list, history, request a correction -----------------------
    currentUser = U.owner;
    const inbox = await api.listVisits(A);
    assert.deepEqual(inbox.map(v => [v.business_name, v.status, v.salesperson_email]), [['Corner Store', 'submitted', EMAIL.salesA]]);
    assert.deepEqual((await api.listVisits(B)).length, 0, 'company filter');
    await assert.rejects(api.review(visit.id, 'request_correction', ''), /note is required/);
    assert.equal((await api.review(visit.id, 'request_correction', 'Phone number looks wrong')).visit.status, 'needs_correction');

    // --- salesperson corrects and resubmits (same id) ----------------------
    currentUser = U.salesA;
    const returned = (await store.refreshVisits()).find(v => v.id === visit.id);
    assert.deepEqual([returned.status, returned.review_note], ['needs_correction', 'Phone number looks wrong']);
    store.queueForSubmit({ ...inputFromVisit(returned), phone: '9000054321' }, returned.status);
    assert.equal((await store.sync()).sent, 1);
    assert.equal(store.getCachedVisits().find(v => v.id === visit.id).status, 'submitted');

    // --- office approves and converts ---------------------------------------
    currentUser = U.admin;
    assert.equal((await api.review(visit.id, 'approve')).visit.status, 'approved');
    assert.deepEqual((await api.assignees(A)).map(a => a.email), [EMAIL.owner, EMAIL.admin, EMAIL.staffA]);
    await assert.rejects(api.convert(visit.id, { assigneeEmail: EMAIL.salesA }), /assignee must be/);
    const converted = await api.convert(visit.id, { assigneeEmail: EMAIL.staffA, followUpDate: date });
    assert.deepEqual([converted.result, converted.mode], ['converted', 'new_lead']);
    assert.equal((await api.convert(visit.id, { assigneeEmail: EMAIL.owner })).result, 'already_converted', 'a second click does nothing');

    await asAdmin(db);
    const lead = await one(db, 'SELECT * FROM leads WHERE id = $1', [converted.lead_id]);
    assert.deepEqual([lead.lead_source, lead.assigned_telecaller_email, lead.company_name, lead.phone, lead.status],
      ['field_visit', EMAIL.staffA, 'Corner Store', '9000054321', 'new']);
    assert.match(lead.source_details, new RegExp(`Field visit by ${EMAIL.salesA} \\[field-visit:${visit.id}\\]`), 'salesperson attribution is kept on the lead');
    const followUp = await one(db, 'SELECT * FROM follow_ups WHERE id = $1', [converted.follow_up_id]);
    assert.deepEqual([followUp.lead_id, followUp.assigned_staff_email, followUp.status], [lead.id, EMAIL.staffA, 'pending']);
    assert.equal(await count(db, 'leads', "lead_source = 'field_visit'"), 1);
    // The CRM timeline for the new lead, in the columns the existing app reads.
    assert.deepEqual((await db.query('SELECT type, performed_by FROM lead_activities WHERE lead_id = $1 ORDER BY type', [lead.id])).rows,
      [{ type: 'Follow-up Scheduled', performed_by: EMAIL.admin }, { type: 'Lead Created', performed_by: EMAIL.admin }]);

    // --- history, as the office and as the salesperson ----------------------
    const history = await api.listEvents(visit.id);
    assert.deepEqual(history.map(e => [e.action, e.actor_email]), [
      ['submitted', EMAIL.salesA], ['correction_requested', EMAIL.owner], ['resubmitted', EMAIL.salesA],
      ['approved', EMAIL.admin], ['converted_new_lead', EMAIL.admin]]);
    assert.equal(history.at(-1).details.lead_number, converted.lead_number);
    currentUser = U.salesA;
    assert.equal((await api.listEvents(visit.id)).length, 5);
    assert.equal((await store.refreshVisits()).find(v => v.id === visit.id).status, 'converted');
    currentUser = U.salesA2;
    assert.equal((await api.listEvents(visit.id)).length, 0, 'another salesperson sees no history');

    // --- duplicate prospect: nothing is created until the office decides ----
    currentUser = U.salesA;
    const duplicate = store.queueForSubmit(filled({ business_name: 'Existing Shop A again', phone: '+91 98765 43210' }));
    await store.sync();
    currentUser = U.owner;
    await api.review(duplicate.id, 'approve');
    const blocked = await api.convert(duplicate.id, {});
    assert.equal(blocked.result, 'duplicates_found');
    assert.deepEqual(blocked.matches.map(m => m.id), [LEAD_A]);
    const linked = await api.convert(duplicate.id, { existingLeadId: LEAD_A });
    assert.deepEqual([linked.result, linked.mode, linked.lead_id], ['converted', 'linked_existing', LEAD_A]);
    await asAdmin(db);
    assert.equal(await count(db, 'leads'), 3, 'two original leads plus the one converted above');

    // --- reject with a reason ------------------------------------------------
    currentUser = U.salesA;
    const junk = store.queueForSubmit(filled({ business_name: 'Not a real business', phone: '9000099999' }));
    await store.sync();
    currentUser = U.owner;
    assert.equal((await api.review(junk.id, 'reject', 'Shop is closed down')).visit.status, 'rejected');
    currentUser = U.salesA;
    const mine = await store.refreshVisits();
    assert.deepEqual(mine.map(v => v.status).sort(), ['converted', 'converted', 'rejected']);
    assert.equal(mine.find(v => v.id === junk.id).review_note, 'Shop is closed down');
    // A rejected visit is locked: resubmitting it changes nothing and is not an error.
    store.queueForSubmit({ ...inputFromVisit(mine.find(v => v.id === junk.id)), remarks: 'please reconsider' });
    assert.equal((await store.sync()).sent, 1);
    await asAdmin(db);
    assert.equal((await one(db, 'SELECT status, remarks FROM field_visits WHERE id = $1', [junk.id])).status, 'rejected');

    // --- signed out: queued visits wait instead of failing ------------------
    currentUser = null;
    const whileSignedOut = new FieldVisitStore(U.salesA, storage, api);
    const waiting = whileSignedOut.queueForSubmit(filled({ business_name: 'Saved while signed out', phone: '9000077777' }));
    const summary = await whileSignedOut.sync();
    assert.deepEqual([summary.waiting, summary.failed], [1, 0]);
    assert.match(summary.message, /Sign in again/);
    currentUser = U.salesA;
    assert.equal((await whileSignedOut.sync()).sent, 1);
    await asAdmin(db);
    assert.equal(await count(db, 'field_visits', `id = '${waiting.id}'`), 1);
  } finally { await db.close(); }
});

test('end to end: an account removed while visits are queued keeps them on the phone with the reason', async () => {
  const db = await setup();
  try {
    const supabase = fakeSupabase(db, () => U.salesA);
    const store = new FieldVisitStore(U.salesA, memoryStorage(), createSupabaseFieldSalesApi(supabase));
    supabase.state.online = false;
    const visit = store.queueForSubmit(filled());
    await store.sync();
    await asAdmin(db);
    await db.query('UPDATE app_members SET active = false WHERE user_id = $1', [U.salesA]);
    supabase.state.online = true;
    const summary = await store.sync();
    assert.deepEqual([summary.sent, summary.failed], [0, 1]);
    assert.deepEqual([store.getLocalById(visit.id).local_state, store.getLocalById(visit.id).business_name], ['error', 'Corner Store']);
    assert.match(store.getLocalById(visit.id).sync_error, /access denied/i);
    await asAdmin(db);
    assert.equal(await count(db, 'field_visits'), 0);
    // Reinstated: retrying sends it.
    await db.query('UPDATE app_members SET active = true WHERE user_id = $1', [U.salesA]);
    store.retry(visit.id);
    assert.equal((await store.sync()).sent, 1);
  } finally { await db.close(); }
});

test('before the database migration is applied the app keeps visits on the phone instead of failing', async () => {
  const db = await setup({ feature: false });
  try {
    const supabase = fakeSupabase(db, () => U.staffA);
    const api = createSupabaseFieldSalesApi(supabase);
    const store = new FieldVisitStore(U.staffA, memoryStorage(), api);
    const visit = store.queueForSubmit(filled());
    const summary = await store.sync();
    assert.deepEqual([summary.waiting, summary.failed], [1, 0]);
    assert.match(summary.message, /not switched on/);
    assert.equal(store.getLocalById(visit.id).local_state, 'pending');
    await assert.rejects(api.companies(), error => error.transient === true && error.code === 'not_installed');
  } finally { await db.close(); }
});
