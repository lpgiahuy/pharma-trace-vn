import assert from 'node:assert/strict';
import test from 'node:test';
import { assessTrace, isFlagged } from './trace-status.ts';
import { applyVerification } from './trace-owner.ts';

const now = new Date('2026-11-22T00:00:00Z');
const ACTIVATED = '2026-11-01T00:00:00Z';
const box = { uid: 'u', medicineName: 'M', manufacturer: null, batchNumber: 'B', productionDate: '2026-01-01', expiryDate: '2028-01-01', batchStatus: 'ACTIVE', boxStatus: 'IN_STOCK', activatedAt: null, verifyCount: 0, flagged: false };
const activatedBox = (verifyCount = 1) => ({ ...box, activatedAt: ACTIVATED, verifyCount });
const verify = (status, verifyCount = 1, flagged = false) => ({ uid: 'u', status, activatedAt: ACTIVATED, verifyCount, flagged });
const scan = scanResult => ({ scanResult, reasons: [] });
const mine = count => ({ activatedAt: ACTIVATED, count });

test('asks for the secret code when nothing else is known', () => {
  assert.deepEqual(assessTrace(box, undefined, scan('VALID'), undefined, now), ['code_required']);
});

test('reports a first activation as authentic', () => {
  assert.deepEqual(assessTrace(box, verify('FIRST_ACTIVATION'), scan('VALID'), mine(1), now), ['authentic']);
});

test('warns about a box activated by someone else or on another device', () => {
  assert.deepEqual(assessTrace(activatedBox(), undefined, undefined, undefined, now), ['activated_before']);
  assert.deepEqual(assessTrace(box, verify('ALREADY_ACTIVATED', 2), undefined, undefined, now), ['already_activated']);
});

test('reassures the person who activated the box on this device', () => {
  assert.deepEqual(assessTrace(activatedBox(1), undefined, undefined, mine(1), now), ['activated_by_you']);
  assert.deepEqual(assessTrace(box, verify('ALREADY_ACTIVATED', 3), undefined, mine(3), now), ['activated_by_you']);
});

test('warns when the code was entered more often than this device did', () => {
  assert.deepEqual(assessTrace(activatedBox(2), undefined, undefined, mine(1), now), ['used_by_others']);
  assert.deepEqual(assessTrace(box, verify('ALREADY_ACTIVATED', 4), undefined, mine(2), now), ['used_by_others']);
});

test('ignores a remembered activation that does not match the box', () => {
  assert.deepEqual(assessTrace(activatedBox(1), undefined, undefined, { activatedAt: '2026-01-01T00:00:00Z', count: 1 }, now), ['activated_before']);
});

test('flags a box as counterfeit from the box, a code entry or a scan', () => {
  assert.equal(isFlagged(box, undefined, scan('VALID')), false);
  assert.equal(isFlagged({ ...box, flagged: true }), true);
  assert.equal(isFlagged(box, verify('ALREADY_ACTIVATED', 10, true)), true);
  assert.equal(isFlagged(box, undefined, scan('FLAGGED')), true);
  assert.deepEqual(assessTrace({ ...box, flagged: true }, undefined, undefined, undefined, now), ['counterfeit']);
});

test('puts the counterfeit warning before every other finding', () => {
  const recalled = { ...box, batchStatus: 'RECALLED', expiryDate: '2026-01-01' };
  assert.deepEqual(assessTrace(recalled, verify('FIRST_ACTIVATION'), scan('FLAGGED'), mine(1), now), ['counterfeit', 'recalled', 'expired', 'authentic']);
  assert.deepEqual(assessTrace(box, verify('INVALID_CODE'), scan('FLAGGED'), undefined, now), ['counterfeit', 'invalid_code']);
});

test('remembers the first activation and counts later entries only for the same activation', () => {
  assert.deepEqual(applyVerification(undefined, verify('FIRST_ACTIVATION')), mine(1));
  assert.deepEqual(applyVerification(mine(1), verify('ALREADY_ACTIVATED', 2)), mine(2));
  assert.equal(applyVerification(undefined, verify('ALREADY_ACTIVATED', 2)), undefined);
  assert.deepEqual(applyVerification({ activatedAt: '2026-01-01T00:00:00Z', count: 1 }, verify('ALREADY_ACTIVATED', 2)), { activatedAt: '2026-01-01T00:00:00Z', count: 1 });
  assert.deepEqual(applyVerification(mine(2), verify('INVALID_CODE', 2)), mine(2));
});
