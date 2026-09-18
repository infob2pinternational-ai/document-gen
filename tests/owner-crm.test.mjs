import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const asModule = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
async function load(path, replacements = {}) {
  let { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext }
  });
  for (const [from, to] of Object.entries(replacements)) {
    outputText = outputText.replace(`'${from}'`, JSON.stringify(to));
  }
  return import(asModule(outputText));
}
const staff = await load('../src/utils/staffUtils.ts');

test('owner is listed once even when old assignments use the misspelled address', () => {
  const leads = [{ assigned_telecaller_email: 'sarathjohnpanegdan@gmail.com' }];
  const followUps = [{ assigned_staff_email: 'SARATHJOHNPANENGADAN@gmail.com ' }];
  const list = staff.getAvailableStaffList('sarathjohnpanengadan@gmail.com', leads, followUps);
  assert.equal(list.filter(row => row.name === 'Sarath John Panengadan').length, 1);
  assert.equal(list[0].email, 'sarathjohnpanengadan@gmail.com');
  assert.match(list[0].label, /\(You\)/);
  assert.equal(leads[0].assigned_telecaller_email, 'sarathjohnpanegdan@gmail.com');
});

test('staff normalization preserves distinct staff accounts', () => {
  const list = staff.getAvailableStaffList('brutf5354@gmail.com', [
    { assigned_telecaller_email: 'Sivasatheesan33@gmail.com' },
    { assigned_telecaller_email: 'sivasatheesan33@gmail.com ' }
  ]);
  assert.equal(list.filter(row => row.email === 'sivasatheesan33@gmail.com').length, 1);
  assert.equal(list[0].email, 'brutf5354@gmail.com');
  assert.equal(staff.normalizeStaffEmail(null), '');
});

test('known confirmed staff accounts are available before they receive records', () => {
  const list = staff.getAvailableStaffList('fransonputhukkara@gmail.com', [], []);
  assert.deepEqual(
    list.map(row => row.email).sort(),
    [
      'brutf5354@gmail.com',
      'fransonputhukkara@gmail.com',
      'sarathjohnpanengadan@gmail.com',
      'sivasatheesan33@gmail.com'
    ].sort()
  );
  assert.equal(list.filter(row => row.email === 'sarathjohnpanegdan@gmail.com').length, 0);
});

test('CRM hydration ignores obsolete requests and preserves newer local lead edits', async () => {
  const newer = { id: 'lead-1', assigned_telecaller_email: 'sarathjohnpanegdan@gmail.com', updated_at: '2026-09-18T12:00:00Z', status: 'confirmed' };
  const older = { ...newer, updated_at: '2026-09-18T11:00:00Z', status: 'new' };
  const rows = new Map([['docgen_leads', JSON.stringify([newer])]]);
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value) };
  try {
    const { hydrateLeadsFromCloud, leadService } = await load('../src/services/leadService.ts', {
      './metricsService': asModule('export const metricsService = { notifyChange() {} };'),
      './db': asModule(`export const isCloudActive = () => true; export const supabase = { from(table) { return { select() { return { eq() { return Promise.resolve({ data: table === 'leads' ? ${JSON.stringify([older, { id: 'lead-2', status: 'new' }])} : [] }); } }; } }; } };`),
      '../utils/uuid': asModule('export const generateUUID = () => "test-id";'),
      '../utils/staffUtils': asModule(`export const normalizeStaffEmail = ${staff.normalizeStaffEmail.toString()};`)
    });
    const companyId = '11111111-1111-4111-8111-111111111111';
    await hydrateLeadsFromCloud(companyId, () => false);
    assert.equal(rows.get('docgen_leads'), JSON.stringify([newer]));
    await hydrateLeadsFromCloud(companyId);
    const leads = leadService.getLeads();
    assert.equal(leads.length, 2);
    assert.equal(leads.find(row => row.id === 'lead-1').status, 'confirmed');
    assert.equal(leads.find(row => row.id === 'lead-1').assigned_telecaller_email, 'sarathjohnpanengadan@gmail.com');
  } finally {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  }
});

test('CRM hydration replaces stale active-company lead cache with real cloud state', async () => {
  const companyId = '11111111-1111-4111-8111-111111111111';
  const otherCompanyId = '22222222-2222-4222-8222-222222222222';
  const staleCurrent = { id: 'stale-current', company_id: companyId, customer_name: 'Old', phone: '1', updated_at: '2026-09-18T10:00:00Z' };
  const staleDefault = { id: 'stale-default', company_id: 'default', customer_name: 'Default Old', phone: '2', updated_at: '2026-09-18T10:00:00Z' };
  const otherCompany = { id: 'other-company', company_id: otherCompanyId, customer_name: 'Other', phone: '3', updated_at: '2026-09-18T10:00:00Z' };
  const rows = new Map([['docgen_leads', JSON.stringify([staleCurrent, staleDefault, otherCompany])]]);
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value) };
  try {
    const { hydrateLeadsFromCloud } = await load('../src/services/leadService.ts', {
      './metricsService': asModule('export const metricsService = { notifyChange() {} };'),
      './db': asModule('export const isCloudActive = () => true; export const supabase = { from(table) { return { select() { return { eq() { return Promise.resolve({ data: [] }); } }; } }; } };'),
      '../utils/uuid': asModule('export const generateUUID = () => "test-id";'),
      '../utils/staffUtils': asModule(`export const normalizeStaffEmail = ${staff.normalizeStaffEmail.toString()};`)
    });
    await hydrateLeadsFromCloud(companyId);
    const leads = JSON.parse(rows.get('docgen_leads'));
    assert.deepEqual(leads.map(row => row.id), ['other-company']);
  } finally {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  }
});

test('office hydration replaces stale active-company dashboard cache with real cloud state', async () => {
  const companyId = '11111111-1111-4111-8111-111111111111';
  const otherCompanyId = '22222222-2222-4222-8222-222222222222';
  const rows = new Map([
    ['docgen_bookings', JSON.stringify([
      { id: 'stale-booking', company_id: companyId },
      { id: 'other-booking', company_id: otherCompanyId }
    ])],
    ['docgen_follow_ups', JSON.stringify([
      { id: 'stale-follow', company_id: companyId },
      { id: 'other-follow', company_id: otherCompanyId }
    ])],
    ['docgen_crm_quotations', JSON.stringify([
      { id: 'stale-quote', company_id: companyId },
      { id: 'other-quote', company_id: otherCompanyId }
    ])]
  ]);
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value) };
  try {
    const { hydrateCrmFromCloud } = await load('../src/services/officeService.ts', {
      './metricsService': asModule('export const metricsService = { notifyChange() {} };'),
      './leadService': asModule('export const leadService = { getActiveCompany() { return null; }, addLeadActivity() {} }; export async function hydrateLeadsFromCloud() {}'),
      './db': asModule(`const data = {
        resources: [{ id: 'resource-1' }],
        bookings: [],
        follow_ups: [],
        crm_quotations: []
      };
      export const isCloudActive = () => true;
      export const supabase = { from(table) { return { select() { const result = { data: data[table] || [] }; return table === 'resources' ? Promise.resolve(result) : { eq() { return Promise.resolve(result); } }; } }; } };`),
      '../utils/uuid': asModule('export const generateUUID = () => "test-id";'),
      '../utils/staffUtils': asModule(`export const normalizeStaffEmail = ${staff.normalizeStaffEmail.toString()};`)
    });
    await hydrateCrmFromCloud(companyId);
    assert.deepEqual(JSON.parse(rows.get('docgen_bookings')).map(row => row.id), ['other-booking']);
    assert.deepEqual(JSON.parse(rows.get('docgen_follow_ups')).map(row => row.id), ['other-follow']);
    assert.deepEqual(JSON.parse(rows.get('docgen_crm_quotations')).map(row => row.id), ['other-quote']);
  } finally {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  }
});

test('owner refresh is scoped, avoids overlapping reads and stops after cleanup', async () => {
  const reactUrl = asModule('export let effect; export function useEffect(fn) { effect = fn; }');
  const officeUrl = asModule('export let handler; export function setHandler(fn) { handler = fn; } export function hydrateCrmFromCloud(...args) { return handler(...args); }');
  const react = await import(reactUrl);
  const office = await import(officeUrl);
  const { useCrmRefresh } = await load('../src/hooks/useCrmRefresh.ts', {
    react: reactUrl, '../services/officeService': officeUrl
  });
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const listeners = new Map();
  let tick;
  let intervalCleared = false;
  globalThis.window = {
    setInterval(fn, ms) { assert.equal(ms, 30000); tick = fn; return 7; },
    clearInterval(id) { assert.equal(id, 7); intervalCleared = true; },
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); }
  };
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); }
  };
  let cleanup;
  try {
    useCrmRefresh('staff', 'company-A', false);
    assert.equal(react.effect(), undefined);
    assert.equal(tick, undefined);
    useCrmRefresh(undefined, 'company-A', true);
    assert.equal(react.effect(), undefined);
    const calls = [];
    let finish;
    office.setHandler((...args) => {
      calls.push(args);
      return new Promise(resolve => { finish = resolve; });
    });
    useCrmRefresh('owner', 'company-A', true);
    cleanup = react.effect();
    const pending = tick();
    await listeners.get('focus')();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'company-A');
    assert.equal(calls[0][1](), true);
    finish();
    await pending;
    document.visibilityState = 'hidden';
    await tick();
    assert.equal(calls.length, 1);
    document.visibilityState = 'visible';
    const next = listeners.get('visibilitychange')();
    assert.equal(calls.length, 2);
    cleanup();
    assert.equal(calls[1][1](), false);
    assert.equal(listeners.size, 0);
    assert.equal(intervalCleared, true);
    finish();
    await next;
    await tick();
    assert.equal(calls.length, 2);
  } finally {
    cleanup?.();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
