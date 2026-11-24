import assert from 'node:assert/strict';
import test from 'node:test';
import { capToAvailable, findStockIssues } from './cart-stock.ts';

const item = (over = {}) => ({ id: '9-13', medicineName: 'Panadol Extra Red', unitName: 'Box', quantity: 1, availableStock: 97, ...over });

test('reports a line above the available stock with the amounts (C1)', () => {
  const [issue] = findStockIssues([item({ quantity: 500 })]);
  assert.equal(issue.available, 97);
  assert.equal(issue.quantity, 500);
  assert.match(issue.message, /Only 97 of Panadol Extra Red \(Box\) available; you have 500/);
});

test('reports an out-of-stock line differently', () => {
  const [issue] = findStockIssues([item({ availableStock: 0, quantity: 2 })]);
  assert.match(issue.message, /out of stock/);
});

test('does not report lines within the stock, exactly at the stock, or with unknown stock', () => {
  assert.deepEqual(findStockIssues([item({ quantity: 97 }), item({ id: 'b', quantity: 5 })]), []);
  assert.deepEqual(findStockIssues([item({ availableStock: undefined, quantity: 999 }), item({ id: 'c', availableStock: null, quantity: 999 })]), []);
});

test('lists only the problem lines', () => {
  const issues = findStockIssues([item({ id: 'a', quantity: 3 }), item({ id: 'b', quantity: 200 })]);
  assert.deepEqual(issues.map((i) => i.id), ['b']);
});

test('capToAvailable keeps a request within the stock and ignores unknown or empty stock', () => {
  assert.equal(capToAvailable(500, 97), 97);
  assert.equal(capToAvailable(5, 97), 5);
  assert.equal(capToAvailable(5, undefined), 5);
  assert.equal(capToAvailable(5, 0), 5);
});
