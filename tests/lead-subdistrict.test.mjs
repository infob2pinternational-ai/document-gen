import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const asModule = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;

async function load(path, replacements = {}) {
  let { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    fileName: path,
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext
    }
  });
  for (const [from, to] of Object.entries(replacements)) {
    outputText = outputText.replace(new RegExp(`'${from}'`, 'g'), JSON.stringify(to));
  }
  return import(asModule(outputText));
}

test('all 14 Kerala districts have configured sub-districts in districts.ts', async () => {
  const districtsModule = await load('../src/utils/districts.ts');
  const { KERALA_DISTRICTS, KERALA_SUB_DISTRICTS } = districtsModule;

  assert.ok(KERALA_DISTRICTS);
  assert.equal(KERALA_DISTRICTS.length, 14);
  assert.equal(Object.keys(KERALA_SUB_DISTRICTS).length, 14);

  // Check that every district has at least 3 sub-districts
  for (const dist of KERALA_DISTRICTS) {
    assert.ok(Array.isArray(KERALA_SUB_DISTRICTS[dist]), `Sub-districts missing for ${dist}`);
    assert.ok(KERALA_SUB_DISTRICTS[dist].length >= 3, `Expected at least 3 sub-districts for ${dist}`);
  }

  // Check Thrissur sub-districts
  assert.ok(KERALA_SUB_DISTRICTS['Thrissur'].includes('Chalakudy'));
  assert.ok(KERALA_SUB_DISTRICTS['Thrissur'].includes('Kunnamkulam'));
  assert.ok(KERALA_SUB_DISTRICTS['Thrissur'].includes('Kodungallur'));

  // Check Ernakulam sub-districts
  assert.ok(KERALA_SUB_DISTRICTS['Ernakulam'].includes('Kochi'));
  assert.ok(KERALA_SUB_DISTRICTS['Ernakulam'].includes('Aluva'));
});

test('lead with sub_district is saved and retrieved in local cache and sanitized for cloud', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) { return store.get(key) ?? null; },
    setItem(key, value) { store.set(key, String(value)); }
  };

  const dbUrl = asModule(`
    export const isCloudActive = () => false;
    export const supabase = null;
  `);

  const staff = await load('../src/utils/staffUtils.ts');

  const { leadService } = await load('../src/services/leadService.ts', {
    './metricsService': asModule('export const metricsService = { notifyChange() {} };'),
    './db': dbUrl,
    '../utils/uuid': asModule('export const generateUUID = () => "lead-sub-123";'),
    '../utils/staffUtils': asModule(`export const normalizeStaffEmail = ${staff.normalizeStaffEmail.toString()};`)
  });

  const leadData = {
    customer_name: 'Anand Menon',
    phone: '9847012345',
    location: 'Thrissur',
    sub_district: 'Chalakudy',
    service_required: 'LED Van Advertising'
  };

  const saved = await leadService.saveLead(leadData, 'staff@b2p.com');
  assert.equal(saved.location, 'Thrissur');
  assert.equal(saved.sub_district, 'Chalakudy');

  const retrieved = leadService.getLeadById(saved.id);
  assert.ok(retrieved);
  assert.equal(retrieved.location, 'Thrissur');
  assert.equal(retrieved.sub_district, 'Chalakudy');
});
