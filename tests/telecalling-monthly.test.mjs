import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

const require = createRequire(import.meta.url);
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
function compile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
}
const datesUrl = url(compile('../src/utils/dateUtils.ts'));
const dates = await import(datesUrl);
let source = compile('../src/services/telecallingService.ts');
const stubs = {
  './supabaseClient': `export const isSupabaseConfigured = () => true;
    export const supabase = { from(table) {
      const filters = {}, orders = [];
      return { select() { return this; }, eq(k,v) { filters[k]=v; return this; },
        gte(k,v) { filters.start=v; return this; }, lte(k,v) { filters.end=v; return this; },
        order(k) { orders.push(k); return this; },
        async range(from,to) {
          const state = globalThis.monthlyTest;
          state.requests.push({table,filters,orders,from,to});
          if (state.failAt === from) return {data:null,error:{message:'synthetic failure'}};
          const rows = state.rows.filter(r=>r.company_id===filters.company_id && r.entry_date>=filters.start && r.entry_date<=filters.end);
          return {data:rows.slice(from,from+2),error:null};
        }
      };
    } };`,
  '../types': 'export const isUnresolvedStatus = () => false;',
  './sheetsSyncQueue': 'export const getSyncSettings = () => ({}); export const computeBackoffMs = () => 0;'
};
for (const [path, stub] of Object.entries(stubs)) source = source.replaceAll(`'${path}'`, JSON.stringify(url(stub)));
source = source.replaceAll("'../utils/dateUtils'", JSON.stringify(datesUrl));
const { telecallingService: service } = await import(url(source));
const row = (id, date, status = 'Call Back', company = 'company-a') => ({
  id, company_id: company, entry_date: date, call_status: status, company_name: 'Synthetic Client',
  created_by_email: 'staff@example.test', created_at: date+'T08:00:00Z'
});

test('month boundaries cover leap years and month/year navigation', () => {
  assert.equal(dates.getKolkataMonthRange('2024-02-12').endDate, '2024-02-29');
  assert.equal(dates.getKolkataMonthRange('2026-02-12').endDate, '2026-02-28');
  assert.equal(dates.getKolkataMonthRange('2026-10-20').startDate, '2026-10-01');
  assert.equal(dates.shiftKolkataMonth('2026-12-31', 1), '2027-01-01');
  assert.equal(dates.shiftKolkataMonth('2026-01-15', -1), '2025-12-01');
});

test('monthly report includes every calendar day and the last day, excluding other months', () => {
  const report = service.computePeriodReport([
    row('first','2026-10-01'),row('last','2026-10-31','Appointment Confirmed'),row('outside','2026-11-01')
  ],'2026-10-01','2026-10-31');
  assert.equal(report.totalCalls, 2);
  assert.equal(report.dailyBreakdown.length, 31);
  assert.equal(report.dailyBreakdown[0].dayName, 'Thu');
  assert.equal(report.dailyBreakdown.at(-1).totalCalls, 1);
  assert.equal(report.statusCounts['Appointment Confirmed'], 1);
  assert.equal(report.followUpsCount, 1);
  assert.equal(report.telecallerBreakdown.staff.total, 2);
  assert.equal(service.computePeriodReport([], '2024-02-01', '2024-02-29').dailyBreakdown.length, 29);
});

test('weekly aggregation still includes exactly seven days', () => {
  const report = service.computeWeeklyReport([row('call','2026-10-25')],'2026-10-19','2026-10-25');
  assert.equal(report.dailyBreakdown.length, 7);
  assert.equal(report.dailyBreakdown.at(-1).totalCalls, 1);
});

test('period loading retrieves all capped pages with company and date filters on every page', async () => {
  globalThis.monthlyTest = { rows: [row('1','2026-10-01'),row('2','2026-10-15'),row('3','2026-10-31'),row('foreign','2026-10-12','Call Back','company-b'),row('outside','2026-11-01')], requests: [] };
  const entries = await service.getEntriesForPeriod('company-a','2026-10-01','2026-10-31');
  assert.deepEqual(entries.map(r=>r.id), ['1','2','3']);
  assert.deepEqual(monthlyTest.requests.map(r=>r.from), [0,2,3]);
  for (const request of monthlyTest.requests) {
    assert.deepEqual(request.filters, {company_id:'company-a',start:'2026-10-01',end:'2026-10-31'});
    assert.deepEqual(request.orders, ['entry_date','created_at','id']);
  }
});

test('a later page error rejects the report instead of returning incomplete totals', async () => {
  globalThis.monthlyTest = { rows: [row('1','2026-10-01'),row('2','2026-10-15'),row('3','2026-10-31')], requests: [], failAt: 2 };
  await assert.rejects(service.getEntriesForPeriod('company-a','2026-10-01','2026-10-31'), /synthetic failure/);
});

let modalSource = compile('../src/components/telecalling/TelecallingEditModal.tsx');
for (const path of ['react', 'react/jsx-runtime']) modalSource = modalSource.replaceAll(`"${path}"`, JSON.stringify(pathToFileURL(require.resolve(path)).href)).replaceAll(`'${path}'`, JSON.stringify(pathToFileURL(require.resolve(path)).href));
modalSource = modalSource.replaceAll("'lucide-react'",JSON.stringify(url('export const X=()=>null, Save=X, PhoneCall=X, Building2=X, User=X, Mail=X, MapPin=X, Loader2=X, Phone=X;')))
  .replaceAll("'../../types'",JSON.stringify(url("export const TELECALLING_STATUSES = ['Call Back'];")))
  .replaceAll("'../../services/telecallingService'",JSON.stringify(url('export const telecallingService = {};')));
const { TelecallingEditModal } = await import(url(modalSource));
test('View mode disables record fields and hides Save; Edit retains Save', () => {
  const props = {isOpen:true,entry:row('1','2026-10-20'),onClose(){},onSaved(){}};
  const view = renderToStaticMarkup(React.createElement(TelecallingEditModal,{...props,readOnly:true}));
  assert.match(view, /View Call Record/);
  assert.match(view, /<fieldset disabled=""/);
  assert.doesNotMatch(view, /Save Changes/);
  const edit = renderToStaticMarkup(React.createElement(TelecallingEditModal,props));
  assert.match(edit, /Edit Call Record/);
  assert.match(edit, /Save Changes/);
  assert.doesNotMatch(edit, /<fieldset disabled=""/);
});
