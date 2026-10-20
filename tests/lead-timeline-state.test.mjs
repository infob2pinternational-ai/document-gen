import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
let source = ts.transpileModule(readFileSync(new URL('../src/hooks/useLeadActivities.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext }
}).outputText;
for (const [path, stub] of Object.entries({
  react: 'export const useEffect = () => {}; export const useMemo = () => {}; export const useSyncExternalStore = () => {};',
  '../services/leadService': 'export const leadService = {};',
  '../services/metricsService': 'export const metricsService = {};'
})) source = source.replaceAll(`'${path}'`, JSON.stringify(moduleUrl(stub)));
const { createLeadTimeline } = await import(moduleUrl(source));
const row = (id, lead = 'lead-a', company = 'company-a') => ({
  id, lead_id: lead, company_id: company, action: 'Note Logged', note: id,
  user_email: 'staff@example.test', created_at: '2026-10-20T10:00:00Z'
});
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(cache = []) {
  const requests = [];
  const service = {
    getLeadActivities: () => cache,
    refreshLeadActivities: (lead, company) => new Promise((resolve, reject) => requests.push({ lead, company, resolve, reject }))
  };
  return { requests, service, setCache: rows => { cache = rows; } };
}

test('initial empty cache is loading until a successful empty response', async () => {
  const { requests, service } = setup();
  const timeline = createLeadTimeline('lead-a', 'company-a', service);
  assert.equal(timeline.getSnapshot().status, 'loading');
  const pending = timeline.refresh(); await tick();
  assert.deepEqual([requests[0].lead, requests[0].company], ['lead-a', 'company-a']);
  assert.equal(timeline.getSnapshot().status, 'loading');
  requests[0].resolve({ status: 'loaded', activities: [] }); await pending;
  assert.deepEqual(timeline.getSnapshot(), { status: 'loaded', activities: [], error: '' });
});

test('initial fetch failure is an error, and retry can load existing records', async () => {
  const { requests, service } = setup();
  const timeline = createLeadTimeline('lead-a', 'company-a', service);
  const first = timeline.refresh(); await tick();
  requests[0].reject(new Error('Temporary connection failure')); await first;
  assert.equal(timeline.getSnapshot().status, 'error');
  assert.match(timeline.getSnapshot().error, /Temporary connection failure/);
  const retry = timeline.refresh(); await tick();
  assert.equal(timeline.getSnapshot().status, 'loading');
  requests[1].resolve({ status: 'loaded', activities: [row('existing')] }); await retry;
  assert.equal(timeline.getSnapshot().status, 'loaded');
  assert.equal(timeline.getSnapshot().activities[0].id, 'existing');
});

test('cached activities survive refresh failures and discarded responses', async () => {
  const { requests, service } = setup([row('cached')]);
  const timeline = createLeadTimeline('lead-a', 'company-a', service);
  for (const discarded of [false, true]) {
    const pending = timeline.refresh(); await tick();
    assert.equal(timeline.getSnapshot().activities[0].id, 'cached');
    const request = requests.at(-1);
    if (discarded) request.resolve({ status: 'discarded' });
    else request.reject(new Error('Offline'));
    await pending;
    assert.equal(timeline.getSnapshot().status, 'error');
    assert.equal(timeline.getSnapshot().activities[0].id, 'cached');
  }
});

for (const [label, nextLead, nextCompany] of [['lead', 'lead-b', 'company-a'], ['company', 'lead-a', 'company-b']]) {
  test(`switching ${label} isolates state from late previous-selection responses`, async () => {
    const { requests, service } = setup([row('private-a')]);
    const oldTimeline = createLeadTimeline('lead-a', 'company-a', service);
    const oldPending = oldTimeline.refresh(); await tick();
    const current = createLeadTimeline(nextLead, nextCompany, service);
    assert.deepEqual(current.getSnapshot().activities, []);
    assert.equal(current.getSnapshot().status, 'loading');
    const newPending = current.refresh(); await tick();
    requests[1].resolve({ status: 'loaded', activities: [row('current', nextLead, nextCompany), row('foreign')] });
    await newPending;
    requests[0].resolve({ status: 'loaded', activities: [row('late-old')] }); await oldPending;
    assert.deepEqual(current.getSnapshot().activities.map(row => row.id), ['current']);
    assert.equal(current.getSnapshot().status, 'loaded');
  });
}

test('duplicate refresh calls share one in-flight request', async () => {
  const { requests, service } = setup();
  const timeline = createLeadTimeline('lead-a', 'company-a', service);
  const first = timeline.refresh();
  assert.equal(timeline.refresh(), first);
  await tick(); assert.equal(requests.length, 1);
  requests[0].resolve({ status: 'loaded', activities: [] }); await first;
});

test('cache notifications add saved notes without fetching or erasing targeted records', async () => {
  const { requests, service, setCache } = setup();
  const timeline = createLeadTimeline('lead-a', 'company-a', service);
  const pending = timeline.refresh(); await tick();
  requests[0].resolve({ status: 'loaded', activities: [row('targeted')] }); await pending;
  setCache([row('new-note'), row('other-company', 'lead-a', 'company-b')]);
  timeline.syncCache();
  setCache([]); timeline.syncCache();
  assert.deepEqual(timeline.getSnapshot().activities.map(row => row.id).sort(), ['new-note', 'targeted']);
  assert.equal(requests.length, 1);
  assert.equal(timeline.getSnapshot().status, 'loaded');
});

test('a discarded empty request never becomes a successful empty timeline', async () => {
  const { requests, service } = setup();
  const timeline = createLeadTimeline('lead-a', 'company-a', service);
  const pending = timeline.refresh(); await tick();
  requests[0].resolve({ status: 'discarded' }); await pending;
  assert.equal(timeline.getSnapshot().status, 'error');
  assert.match(timeline.getSnapshot().error, /retry/i);
});
