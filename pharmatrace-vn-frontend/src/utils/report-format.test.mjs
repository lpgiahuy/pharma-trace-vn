import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bucketLabel,
  formatCompact,
  formatCount,
  formatVnd,
  percentChange,
  presetRange,
  rangeDays,
  vietnamToday,
} from './report-format.ts';

const plain = (text) => text.replace(/ /g, ' ');

test('formats full VND amounts with vi-VN grouping', () => {
  assert.equal(plain(formatVnd(1250000)), '1.250.000 ₫');
  assert.equal(plain(formatVnd(0)), '0 ₫');
  assert.equal(plain(formatVnd(Number.NaN)), '0 ₫');
  assert.equal(formatCount(12345), '12.345');
});

test('formats short axis amounts', () => {
  assert.equal(formatCompact(950), '950');
  assert.equal(formatCompact(12500), '12.5K');
  assert.equal(formatCompact(1250000), '1.25M');
  assert.equal(formatCompact(3400000000), '3.4B');
  assert.equal(formatCompact(2000000), '2M');
  assert.equal(formatCompact(-1500000), '-1.5M');
  assert.equal(formatCompact(Number.POSITIVE_INFINITY), '0');
});

test('compares with the previous period and skips an empty one', () => {
  assert.equal(percentChange(150, 100), 50);
  assert.equal(percentChange(50, 100), -50);
  assert.equal(percentChange(10, 0), null);
  assert.equal(percentChange(0, 0), null);
});

test('resolves range presets ending today', () => {
  const today = '2026-11-22';
  assert.deepEqual(presetRange('today', today), { from: today, to: today });
  assert.deepEqual(presetRange('last7', today), { from: '2026-11-16', to: today });
  assert.deepEqual(presetRange('last30', today), { from: '2026-10-24', to: today });
  assert.deepEqual(presetRange('thisMonth', today), { from: '2026-11-01', to: today });
  assert.deepEqual(presetRange('thisQuarter', today), { from: '2026-10-01', to: today });
  assert.deepEqual(presetRange('thisYear', today), { from: '2026-01-01', to: today });
});

test('handles quarter, month and year boundaries', () => {
  assert.deepEqual(presetRange('thisQuarter', '2026-03-31'), { from: '2026-01-01', to: '2026-03-31' });
  assert.deepEqual(presetRange('thisQuarter', '2026-04-01'), { from: '2026-04-01', to: '2026-04-01' });
  assert.deepEqual(presetRange('last7', '2026-01-03'), { from: '2025-12-28', to: '2026-01-03' });
  assert.deepEqual(presetRange('last30', '2024-03-01'), { from: '2024-02-01', to: '2024-03-01' });
});

test('counts inclusive range days and labels buckets', () => {
  assert.equal(rangeDays('2026-11-22', '2026-11-22'), 1);
  assert.equal(rangeDays('2026-01-01', '2026-12-31'), 365);
  assert.equal(bucketLabel('2026-11-05', 'day'), '05/11');
  assert.equal(bucketLabel('2026-11-01', 'month'), '11/2026');
});

test('reads today in Vietnam time', () => {
  assert.equal(vietnamToday(new Date('2026-11-21T17:30:00Z')), '2026-11-22');
  assert.equal(vietnamToday(new Date('2026-11-21T16:59:00Z')), '2026-11-21');
});
