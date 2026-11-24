import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeVietnamPhone } from './phone.ts';

test('normalises accepted formats to the local form', () => {
  for (const raw of ['0909123456', ' 0909 123 456 ', '0909.123.456', '+84909123456', '84909123456']) {
    assert.equal(normalizeVietnamPhone(raw), '0909123456', raw);
  }
});

test('rejects the reported trailing backtick and other invalid input', () => {
  for (const raw of ['012345678`', '0909abc456', '090912345', '09091234567', '+1909123456', '', '   ']) {
    assert.equal(normalizeVietnamPhone(raw), null, raw);
  }
  assert.equal(normalizeVietnamPhone(undefined), null);
});
