import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePriceRange } from './price-range.ts';

test('blocks a minimum above the maximum (10000 > 5000)', () => {
  const result = parsePriceRange('10000', '5000');
  assert.equal(result.error, 'Minimum price cannot be greater than maximum price.');
});

test('accepts equal bounds, one-sided bounds, zero and empty boxes', () => {
  assert.deepEqual(parsePriceRange('5000', '5000'), { min: 5000, max: 5000, error: null });
  assert.deepEqual(parsePriceRange('5000', ''), { min: 5000, max: null, error: null });
  assert.deepEqual(parsePriceRange('', '5000'), { min: null, max: 5000, error: null });
  assert.deepEqual(parsePriceRange('0', '100'), { min: 0, max: 100, error: null });
  assert.deepEqual(parsePriceRange('', ''), { min: null, max: null, error: null });
});

test('ignores non-digit characters, so a negative sign never produces a negative bound', () => {
  assert.deepEqual(parsePriceRange('-5', 'abc'), { min: 5, max: null, error: null });
});
