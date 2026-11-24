import { Prisma } from '@prisma/client';
import { AppException } from '../../../common/errors/app-exception';
import { CryptoUtil } from '../../../common/utils/crypto.util';
import { PrismaService } from '../../../prisma/prisma.service';
import { ScanFacts, TraceabilityService, findScanAnomalies } from './traceability.service';

type Run = (tx: unknown) => Promise<unknown>;

function setup() {
  const tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn().mockResolvedValue(1) };
  const prisma = { withTraceability: jest.fn((_actor: unknown, run: Run) => run(tx)) };
  return { tx, prisma, service: new TraceabilityService(prisma as unknown as PrismaService) };
}

async function failure(promise: Promise<unknown>): Promise<string | undefined> {
  try { await promise; } catch (error) {
    return error instanceof AppException ? error.code : 'OTHER';
  }
  return undefined;
}

function databaseError(message: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Raw query failed', { code: 'P2010', clientVersion: 'test', meta: { code: '22023', message } });
}

const staff = { id: 5, role: 'WAREHOUSE_STAFF', type: 'employee', facilityId: 7 };
const manager = { id: 6, role: 'WAREHOUSE_MANAGER', type: 'employee', facilityId: 7 };
const admin = { id: 1, role: 'SUPER_ADMIN', type: 'employee' };
const pharmacist = { id: 9, role: 'PHARMACIST', type: 'employee', facilityId: 7 };

const UID = '3f1d6a52-8b1e-4c58-9a46-0d3a6f7b2c11';
const BATCH = 'LOT-2026-01';

process.env.QR_SECRET_KEY = 'test-secret';

function facts(extra: Partial<ScanFacts> = {}): ScanFacts {
  return {
    uid: UID, batchNumber: BATCH, signature: CryptoUtil.signBox(UID, BATCH), status: 'IN_STOCK', facilityId: 7,
    batchStatus: 'ACTIVE', expiryDate: new Date('2027-01-01'), medicineName: 'Paracetamol', ssccCode: '0123', ...extra,
  };
}

describe('findScanAnomalies', () => {
  it('finds nothing for a signed box at the scanning warehouse', () => {
    expect(findScanAnomalies(facts(), 7)).toEqual([]);
  });

  it('flags an unknown uid', () => {
    expect(findScanAnomalies(undefined, 7)).toEqual(['UNKNOWN_UID']);
  });

  it.each([
    ['a missing stored signature', facts({ signature: null }), undefined],
    ['a stored signature of another batch', facts({ signature: CryptoUtil.signBox(UID, 'OTHER') }), undefined],
    ['a presented signature that does not match', facts(), CryptoUtil.signBox(UID, 'OTHER')],
    ['a presented signature of the wrong length', facts(), 'abc'],
  ])('flags %s', (_name, box, presented) => {
    expect(findScanAnomalies(box, 7, presented)).toEqual(['SIGNATURE_MISMATCH']);
  });

  it('accepts a presented signature that matches', () => {
    expect(findScanAnomalies(facts(), 7, CryptoUtil.signBox(UID, BATCH))).toEqual([]);
  });

  it('flags a box that is at another warehouse or in no warehouse', () => {
    expect(findScanAnomalies(facts({ facilityId: 8 }), 7)).toEqual(['NOT_AT_WAREHOUSE']);
    expect(findScanAnomalies(facts({ facilityId: null }), 7)).toEqual(['NOT_AT_WAREHOUSE']);
  });

  it('does not check the warehouse when SUPER_ADMIN scans without choosing one', () => {
    expect(findScanAnomalies(facts({ facilityId: 8 }), null)).toEqual([]);
  });

  it.each(['DESTROYED', 'MISSING'])('flags a %s box that was scanned', status => {
    expect(findScanAnomalies(facts({ status }), 7)).toEqual(['BOX_STATUS_UNEXPECTED']);
  });

  it('does not treat a recalled or expired batch as fraud', () => {
    expect(findScanAnomalies(facts({ batchStatus: 'RECALLED' }), 7)).toEqual([]);
    expect(findScanAnomalies(facts({ batchStatus: 'EXPIRED' }), 7)).toEqual([]);
  });

  it('reports every anomaly of one scan', () => {
    expect(findScanAnomalies(facts({ signature: null, facilityId: 8, status: 'DESTROYED' }), 7))
      .toEqual(['SIGNATURE_MISMATCH', 'NOT_AT_WAREHOUSE', 'BOX_STATUS_UNEXPECTED']);
  });
});

describe('TraceabilityService.scan', () => {
  it('reports no anomaly without claiming the box is authentic and opens no alert', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([facts()]);
    const result = await service.scan(staff, { uid: UID.toUpperCase() });
    expect(result).toMatchObject({ uid: UID, verdict: 'NO_ANOMALY_FOUND', reasons: [], box: { status: 'IN_STOCK', batchNumber: BATCH } });
    expect(result.message).toContain('does not prove');
    expect(result.message.toLowerCase()).not.toMatch(/genuine|verified/);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual([UID]);
  });

  it('never returns the stored signature', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([facts()]);
    const result = await service.scan(staff, { uid: UID });
    expect(result.box).not.toHaveProperty('signature');
  });

  it('opens an alert and asks for investigation when the signature does not match', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([facts({ signature: 'forged' })]);
    const result = await service.scan(staff, { uid: UID });
    expect(result).toMatchObject({ verdict: 'NEEDS_INVESTIGATION', reasons: ['SIGNATURE_MISMATCH'] });
    expect(tx.$executeRaw.mock.calls[0][0].join('')).toContain('record_scan_anomaly');
    expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual([UID, ['SIGNATURE_MISMATCH']]);
  });

  it('opens an alert for an unknown uid and returns no box', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([]);
    const result = await service.scan(staff, { uid: UID });
    expect(result).toMatchObject({ verdict: 'NEEDS_INVESTIGATION', reasons: ['UNKNOWN_UID'], box: null });
    expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual([UID, ['UNKNOWN_UID']]);
  });

  it('hides the details of a box that belongs to another warehouse', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([facts({ facilityId: 8 })]);
    const result = await service.scan(staff, { uid: UID });
    expect(result).toMatchObject({ verdict: 'NEEDS_INVESTIGATION', reasons: ['NOT_AT_WAREHOUSE'], box: null });
  });

  it('lets SUPER_ADMIN scan any warehouse and shows the box', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([facts({ facilityId: 8 })]);
    expect(await service.scan(admin, { uid: UID })).toMatchObject({ verdict: 'NO_ANOMALY_FOUND', box: { facilityId: 8 } });
  });

  it.each([
    ['an account outside the warehouse roles', pharmacist, {}, 'WAREHOUSE_ACCOUNT_REQUIRED'],
    ['another warehouse', staff, { facilityId: 8 }, 'WAREHOUSE_FACILITY_FORBIDDEN'],
  ])('rejects %s', async (_name, user, extra, code) => {
    const { prisma, service } = setup();
    expect(await failure(service.scan(user, { uid: UID, ...extra }))).toBe(code);
    expect(prisma.withTraceability).not.toHaveBeenCalled();
  });
});

describe('TraceabilityService.history', () => {
  it('returns the events in the order the database gives them', async () => {
    const { tx, service } = setup();
    const events = [
      { occurredAt: new Date('2026-10-01'), eventType: 'CREATED', facilityId: null, actorId: null, reference: BATCH, detail: null },
      { occurredAt: new Date('2026-10-02'), eventType: 'RECEIVED', facilityId: 7, actorId: 5, reference: 'GR-1', detail: null },
    ];
    tx.$queryRaw.mockResolvedValueOnce(events);
    expect(await service.history(staff, UID.toUpperCase())).toEqual(events);
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual([UID]);
  });

  it('reports a box that is unknown or outside the warehouse scope as not found', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect(await failure(service.history(staff, UID))).toBe('TR_BOX_NOT_FOUND');
  });
});

describe('TraceabilityService cartons', () => {
  const rows = [
    { id: 3, sscc: '0123', status: 'PACKAGED', facilityId: 7, batchNumber: BATCH, medicineName: 'Paracetamol', boxUid: UID, boxStatus: 'IN_STOCK', boxFacilityId: 7 },
    { id: 3, sscc: '0123', status: 'PACKAGED', facilityId: 7, batchNumber: BATCH, medicineName: 'Paracetamol', boxUid: null, boxStatus: null, boxFacilityId: null },
  ];

  it('groups the rows of one carton and skips empty box rows', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce(rows);
    expect(await service.carton(staff, '0123')).toEqual({
      id: 3, sscc: '0123', status: 'PACKAGED', facilityId: 7, batchNumber: BATCH, medicineName: 'Paracetamol',
      boxes: [{ uid: UID, status: 'IN_STOCK', facilityId: 7 }],
    });
  });

  it('reports an unknown carton as not found', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect(await failure(service.carton(staff, '0123'))).toBe('TR_CARTON_NOT_FOUND');
  });

  it('unpacks through the database function and returns the carton', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([{ ...rows[0], status: 'UNPACKED' }]);
    expect(await service.unpack(staff, '0123')).toMatchObject({ status: 'UNPACKED' });
    expect(tx.$executeRaw.mock.calls[0][0].join('')).toContain('unpack_carton');
    expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual(['0123']);
  });

  it.each(['TR_CARTON_NOT_FOUND', 'TR_CARTON_NOT_UNPACKABLE', 'TR_CARTON_INCOMPLETE', 'TR_FORBIDDEN'])('maps the database error %s', async code => {
    const { tx, service } = setup();
    tx.$executeRaw.mockRejectedValueOnce(databaseError(code));
    expect(await failure(service.unpack(staff, '0123'))).toBe(code);
  });
});

describe('TraceabilityService fraud alerts', () => {
  const alert = { id: 4, uid: UID, fraudType: 'SIGNATURE_MISMATCH', resolutionStatus: 'UNRESOLVED' };

  it('lists the alerts of the manager warehouse with paging', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([{ total: 41 }]).mockResolvedValueOnce([alert]);
    const page = await service.alerts(manager, { status: 'UNRESOLVED', page: 2, limit: 20 });
    expect(page).toEqual({ items: [alert], pagination: { total: 41, page: 2, limit: 20, totalPages: 3 } });
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual([7, 7, 'UNRESOLVED', 'UNRESOLVED']);
  });

  it.each([
    ['warehouse staff', staff, {}, 'WAREHOUSE_ACCOUNT_REQUIRED'],
    ['a manager asking for another warehouse', manager, { facilityId: 8 }, 'WAREHOUSE_FACILITY_FORBIDDEN'],
  ])('refuses the list to %s', async (_name, user, query, code) => {
    const { prisma, service } = setup();
    expect(await failure(service.alerts(user, query))).toBe(code);
    expect(prisma.withTraceability).not.toHaveBeenCalled();
  });

  it('lets SUPER_ADMIN list every warehouse', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
    await service.alerts(admin, {});
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual([null, null, null, null]);
  });

  it('resolves with the trimmed note and returns the alert', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([{ ...alert, resolutionStatus: 'RESOLVED' }]);
    expect(await service.resolve(manager, 4, ' Checked the label ')).toMatchObject({ id: 4, resolutionStatus: 'RESOLVED' });
    expect(tx.$executeRaw.mock.calls[0][0].join('')).toContain('resolve_fraud_alert');
    expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual([4, 'Checked the label']);
  });

  it.each(['TR_ALERT_NOT_FOUND', 'TR_NOTE_REQUIRED', 'TR_FORBIDDEN'])('maps the database error %s', async code => {
    const { tx, service } = setup();
    tx.$executeRaw.mockRejectedValueOnce(databaseError(code));
    expect(await failure(service.resolve(manager, 4, 'Checked'))).toBe(code);
  });
});
