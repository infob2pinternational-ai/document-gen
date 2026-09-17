import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
async function loadSource(path, replacements) {
  let { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.React }
  });
  for (const [specifier, replacement] of Object.entries(replacements)) {
    outputText = outputText.replace(`'${specifier}'`, JSON.stringify(replacement));
  }
  return import(moduleUrl(outputText.replaceAll('import.meta.env.DEV', 'false')));
}

const config = {
  layout: 'stacked', themeColor: '#2563eb', selectedOptionId: 'van',
  options: [{
    id: 'van', name: 'LED Van', heading: 'LED Van Package', description: '',
    columns: [
      { id: 'qty', name: 'Days', type: 'number', visible: true, width: 100 },
      { id: 'rate', name: 'Daily Rate', type: 'currency', visible: true, width: 100 },
      { id: 'amount', name: 'Amount', type: 'currency', visible: true, width: 100 }
    ],
    rows: [{ qty: 4, rate: 20000, amount: 80000 }],
    sumColumnId: 'amount', showTotal: true, totalValue: 80000, totalLabel: 'Total'
  }]
};
const { ComparisonPreview } = await loadSource('../src/components/comparison/ComparisonPreview.tsx', {
  react: pathToFileURL(require.resolve('react')).href,
  'lucide-react': pathToFileURL(require.resolve('lucide-react')).href,
  './ComparisonService': moduleUrl('export const ComparisonService = { getComparisonData() { throw new Error("Private data must not be used"); } };')
});

for (const type of ['comparison_quotation', 'comparison_invoice']) {
  test(`anonymous ${type} renders saved columns, values and print button`, () => {
    const html = renderToStaticMarkup(React.createElement(ComparisonPreview, {
      document: { id: 'shared-doc', document_type: type, document_number: 'Qt-2026-203', date: '2026-09-17' },
      activeProfile: { name: 'B2P', currency: 'INR' }, isPublicShare: true,
      publicConfig: config, onClose() {}
    }));
    for (const text of ['LED Van Package', 'Daily Rate', '20,000.00', '80,000.00', 'Print / Save as PDF', '₹']) {
      assert.ok(html.includes(text), text);
    }
    assert.match(html, />4<\/td>/);
    assert.ok(html.includes(type === 'comparison_invoice' ? 'Manual Invoice' : 'Quote'));
    assert.doesNotMatch(html, /Document total|Back to Documents/);
  });
}

test('missing public comparison displays an error, never a fabricated normal quotation', () => {
  const html = renderToStaticMarkup(React.createElement(ComparisonPreview, {
    document: { id: 'missing' }, activeProfile: {}, isPublicShare: true, publicConfig: null, onClose() {}
  }));
  assert.match(html, /comparison details could not be loaded/);
  assert.doesNotMatch(html, /Document total|Go Back|80,000/);
});

async function publicService(type, comparisonError = false) {
  const stub = moduleUrl(`
    export const calls = [];
    export const isSupabaseConfigured = () => true;
    export const supabase = { async rpc(name, params) {
      calls.push({ name, params });
      if (name === 'get_public_document') return { data: { document: { id: 'shared-doc', document_type: ${JSON.stringify(type)} }, items: [], profile: { name: 'B2P' } } };
      return ${comparisonError ? '{ error: { message: "RPC unavailable" } }' : JSON.stringify({ data: { comparison: config, currency: 'INR' } })};
    } };
  `);
  const { dbService } = await loadSource('../src/services/db.ts', {
    jszip: moduleUrl('export default class JSZip {}'),
    './supabaseClient': stub,
    './sheetsSyncQueue': moduleUrl('export function enqueueSync() {}')
  });
  return { dbService, calls: (await import(stub)).calls };
}

test('public comparison lookup fetches its saved options and company currency', async () => {
  const { dbService, calls } = await publicService('comparison_quotation');
  const result = await dbService.getPublicDocument({ documentNumber: 'Qt-2026-203' });
  assert.deepEqual(result.comparison, config);
  assert.equal(result.profile.currency, 'INR');
  assert.deepEqual(calls[1], { name: 'get_public_comparison_data', params: { p_document_id: 'shared-doc' } });
});

test('standard quotation does not request comparison data', async () => {
  const { dbService, calls } = await publicService('quotation');
  const result = await dbService.getPublicDocument({ id: 'shared-doc' });
  assert.equal(result.comparison, null);
  assert.equal(calls.length, 1);
});

test('missing comparison RPC preserves document type for the explicit error view', async () => {
  const { dbService } = await publicService('comparison_invoice', true);
  const result = await dbService.getPublicDocument({ id: 'shared-doc' });
  assert.equal(result.document.document_type, 'comparison_invoice');
  assert.equal(result.comparison, null);
});
