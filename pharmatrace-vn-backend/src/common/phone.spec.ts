import { normalizeVietnamPhone } from './phone';

describe('normalizeVietnamPhone', () => {
  it.each([
    ['0909123456', '0909123456'],
    ['  0909123456  ', '0909123456'],
    ['0909 123 456', '0909123456'],
    ['0909.123.456', '0909123456'],
    ['0909-123-456', '0909123456'],
    ['+84909123456', '0909123456'],
    ['84909123456', '0909123456'],
    ['+84 909 123 456', '0909123456'],
  ])('accepts %p as %p', (raw, expected) => {
    expect(normalizeVietnamPhone(raw)).toBe(expected);
  });

  it.each([
    '012345678`',
    '0909abc456',
    '090912345',
    '09091234567',
    '909123456',
    '+1909123456',
    '(0909) 123456',
    '',
    '   ',
  ])('rejects %p', (raw) => {
    expect(normalizeVietnamPhone(raw)).toBeNull();
  });

  it('rejects values that are not strings', () => {
    expect(normalizeVietnamPhone(undefined)).toBeNull();
    expect(normalizeVietnamPhone(909123456)).toBeNull();
  });
});
