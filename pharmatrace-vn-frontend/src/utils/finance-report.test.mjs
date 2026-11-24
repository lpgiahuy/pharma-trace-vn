import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PAYABLE_BUCKETS,
  RECEIVABLE_BUCKETS,
  OTHER_PARTIES,
  agingChartData,
  canRecordSupplierPayment,
  canViewFinance,
  cashbookFilename,
  cashflowData,
  categoryLabel,
  filterPayables,
  filterReceivables,
  formatVietnamDateTime,
  payableTotals,
  paymentMethodLabel,
  receivableTotals,
} from './finance-report.ts';

test('only admins and finance roles open the finance pages', () => {
  for (const role of ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'FINANCE_MANAGER', 'Finance Manager', 'super-admin']) {
    assert.equal(canViewFinance(role), true, role);
  }
  for (const role of ['STORE_MANAGER', 'WAREHOUSE_STAFF', 'CUSTOMER', '', null, undefined]) {
    assert.equal(canViewFinance(role), false, String(role));
  }
});

test('only super admins and finance managers record supplier payments', () => {
  for (const role of ['SUPER_ADMIN', 'FINANCE_MANAGER', 'Finance Manager']) assert.equal(canRecordSupplierPayment(role), true, role);
  for (const role of ['ACCOUNTANT', 'ADMIN', 'STORE_MANAGER', '', null, undefined]) assert.equal(canRecordSupplierPayment(role), false, String(role));
});

test('receivable totals treat debts older than 30 days as overdue', () => {
  assert.deepEqual(
    receivableTotals([
      { bucket: '0_7', amount: 100 },
      { bucket: '16_30', amount: 200 },
      { bucket: 'GT_30', amount: 400 },
    ]),
    { total: 700, overdue: 400 },
  );
  assert.deepEqual(receivableTotals([]), { total: 0, overdue: 0 });
});

test('payable totals split overdue and what falls due within 7 days', () => {
  const summary = [
    { bucket: 'NOT_DUE', amount: 900 },
    { bucket: '1_30', amount: 100 },
    { bucket: 'GT_60', amount: 50 },
    { bucket: 'NO_DUE_DATE', amount: 25 },
  ];
  const details = [
    { bucket: 'NOT_DUE', dueDate: '2031-01-31', amount: 100 },
    { bucket: 'NOT_DUE', dueDate: '2031-02-07', amount: 200 },
    { bucket: 'NOT_DUE', dueDate: '2031-02-08', amount: 600 },
    { bucket: '1_30', dueDate: '2031-01-20', amount: 100 },
    { bucket: 'NO_DUE_DATE', dueDate: null, amount: 25 },
  ];
  assert.deepEqual(payableTotals(summary, details, '2031-01-31'), { total: 1075, overdue: 150, dueNext7Days: 300 });
});

test('aging chart data has one row per bucket in bucket order, with zeros for empty buckets', () => {
  const data = agingChartData(
    [
      { party: 'A', bucket: '0_7', amount: 10 },
      { party: 'B', bucket: 'GT_30', amount: 5 },
      { party: 'A', bucket: 'GT_30', amount: 7 },
    ],
    RECEIVABLE_BUCKETS,
  );
  assert.deepEqual(data.parties, ['A', 'B']);
  assert.deepEqual(data.rows, [
    { bucket: '0-7 days', A: 10, B: 0 },
    { bucket: '8-15 days', A: 0, B: 0 },
    { bucket: '16-30 days', A: 0, B: 0 },
    { bucket: 'Over 30 days', A: 7, B: 5 },
  ]);
});

test('aging chart data merges the smallest parties into Others', () => {
  const summary = ['A', 'B', 'C', 'D', 'E', 'F'].map((party, index) => ({ party, bucket: 'NOT_DUE', amount: 60 - index * 10 }));
  const data = agingChartData(summary, PAYABLE_BUCKETS);
  assert.deepEqual(data.parties, ['A', 'B', 'C', 'D', OTHER_PARTIES]);
  assert.equal(data.rows[0][OTHER_PARTIES], 20 + 10);
  const total = data.parties.reduce((sum, party) => sum + Number(data.rows[0][party]), 0);
  assert.equal(total, 60 + 50 + 40 + 30 + 20 + 10);
});

test('detail filters match party, bucket and the order or PO code', () => {
  const receivables = [
    { party: 'GHN', bucket: '0_7', orderCode: 'ORD-1' },
    { party: 'GHN', bucket: 'GT_30', orderCode: 'ORD-2' },
    { party: 'Online orders', bucket: 'GT_30', orderCode: null },
  ];
  assert.equal(filterReceivables(receivables, {}).length, 3);
  assert.equal(filterReceivables(receivables, { party: 'GHN', bucket: 'GT_30' }).length, 1);
  assert.equal(filterReceivables(receivables, { search: ' ord-2 ' }).length, 1);

  const payables = [
    { supplierName: 'S1', bucket: 'NOT_DUE', poCode: 'PO-7' },
    { supplierName: 'S2', bucket: '1_30', poCode: null },
  ];
  assert.equal(filterPayables(payables, { party: 'S2' }).length, 1);
  assert.equal(filterPayables(payables, { search: 'po-7' })[0].supplierName, 'S1');
});

test('the last cashflow point carries the closing balance of the report', () => {
  const report = {
    closing: 550000,
    days: [
      { day: '2031-01-01', income: 300000, expense: 50000, balance: 630000 },
      { day: '2031-01-02', income: 0, expense: 0, balance: 630000 },
      { day: '2031-01-03', income: 0, expense: 80000, balance: 550000 },
    ],
  };
  const points = cashflowData(report.days);
  assert.equal(points.length, 3);
  assert.equal(points.at(-1).balance, report.closing);
});

test('formatting helpers', () => {
  assert.equal(cashbookFilename({ from: '2026-11-01', to: '2026-11-30' }), 'cashbook_2026-11-01_2026-11-30.csv');
  assert.equal(paymentMethodLabel('BANK_TRANSFER'), 'Bank transfer');
  assert.equal(paymentMethodLabel('OTHER'), 'OTHER');
  assert.equal(categoryLabel('CUSTOMER_REFUND'), 'Customer refund');
  assert.equal(categoryLabel('COD'), 'COD');
  assert.equal(categoryLabel('COD_SETTLEMENT'), 'COD settlement');
  assert.equal(formatVietnamDateTime('2026-10-31T17:30:00.000Z'), '01/11/2026 00:30');
  assert.equal(formatVietnamDateTime('not a date'), 'not a date');
});
