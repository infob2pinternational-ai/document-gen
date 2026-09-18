import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const { outputText } = ts.transpileModule(readFileSync(new URL('../src/utils/dashboardStats.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext }
});
const { computeDashboardStats, bookingsOnDate, localDateKey } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('invoice value includes approved comparison invoices, excludes rejected and foreign documents', () => {
  const doc = (document_type, status, total, company_id = 'A') => ({ document_type, status, total, company_id });
  const stats = computeDashboardStats([
    doc('invoice', 'approved', 100), doc('comparison_invoice', 'approved', 200),
    doc('non_tax_invoice', 'approved', '50'), doc('invoice', 'rejected', 900),
    doc('invoice', 'approved', 999, 'B'), doc('quotation', 'pending_approval', 80),
    doc('comparison_quotation', 'approved', 120), doc('invoice', 'approved', 'invalid')
  ], 'A');
  assert.equal(stats.revenue, 350);
  assert.equal(stats.outstanding, 80);
  assert.equal(stats.quoteCount, 2);
});

test('fleet occupancy includes both boundary dates but excludes past, future and cancelled bookings', () => {
  const booking = (id, start_date, end_date, status = 'CONFIRMED') => ({ id, start_date, end_date, status });
  assert.deepEqual(bookingsOnDate([
    booking('past', '2026-09-16', '2026-09-17'),
    booking('future', '2026-09-19', '2026-09-20'),
    booking('start', '2026-09-18', '2026-09-19'),
    booking('end', '2026-09-17', '2026-09-18', 'TENTATIVE'),
    booking('cancelled', '2026-09-18', '2026-09-18', 'CANCELLED')
  ], '2026-09-18').map(row => row.id), ['start', 'end']);
});

test('local date key uses the browser calendar date', () => {
  assert.equal(localDateKey(new Date(2026, 8, 18, 0, 1)), '2026-09-18');
});
