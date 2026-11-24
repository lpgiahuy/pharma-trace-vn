import { Prisma } from '@prisma/client';
import { AppException } from '../../../common/errors/app-exception';
import { CryptoUtil } from '../../../common/utils/crypto.util';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateFactoryBatchDto } from './dto/factory-batch.dto';
import { FactoryBatchService } from './factory-batch.service';

interface Carton { sscc: string; boxes: { uid: string; signature: string }[] }
type Run = (tx: unknown) => Promise<unknown>;

function setup() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 31 }]),
    batches: { findFirst: jest.fn() },
  };
  const prisma = {
    withFactoryIntake: jest.fn((_actor: unknown, run: Run) => run(tx)),
    withWarehouseRead: jest.fn((_actor: unknown, run: Run) => run(tx)),
  };
  return { tx, prisma, service: new FactoryBatchService(prisma as unknown as PrismaService) };
}

async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try { await promise; } catch (error) { return error instanceof AppException ? error.code : 'OTHER'; }
  return undefined;
}

const staff = { id: 8, role: 'FACTORY_WAREHOUSE_STAFF', type: 'employee', facilityId: 4 };
const admin = { id: 1, role: 'SUPER_ADMIN', type: 'employee' };
const warehouseStaff = { id: 5, role: 'WAREHOUSE_STAFF', type: 'employee', facilityId: 7 };

const dto = (extra: Partial<CreateFactoryBatchDto> = {}): CreateFactoryBatchDto => ({
  variantId: 12, batchNumber: ' LOT-1 ', productionDate: '2026-11-01', expiryDate: '2028-11-01', boxCount: 25, boxesPerCarton: 10, ...extra,
});

function sentCartons(tx: { $queryRaw: jest.Mock }): Carton[] {
  return JSON.parse(tx.$queryRaw.mock.calls[0].at(-1) as string) as Carton[];
}

describe('FactoryBatchService.create', () => {
  const original = { key: process.env.QR_SECRET_KEY, max: process.env.FACTORY_BATCH_MAX_BOXES };
  beforeEach(() => { process.env.QR_SECRET_KEY = 'test-signing-key'; delete process.env.FACTORY_BATCH_MAX_BOXES; });
  afterAll(() => {
    if (original.key === undefined) delete process.env.QR_SECRET_KEY; else process.env.QR_SECRET_KEY = original.key;
    if (original.max === undefined) delete process.env.FACTORY_BATCH_MAX_BOXES; else process.env.FACTORY_BATCH_MAX_BOXES = original.max;
  });

  it('packs boxes into full cartons plus a remainder carton', async () => {
    const { tx, service } = setup();
    await expect(service.create(staff, dto())).resolves.toEqual({ id: 31, batchNumber: 'LOT-1', boxCount: 25, cartonCount: 3 });
    const cartons = sentCartons(tx);
    expect(cartons.map(carton => carton.boxes.length)).toEqual([10, 10, 5]);
    expect(cartons.flatMap(carton => carton.boxes).length).toBe(25);
  });

  it('gives every box a unique uid and a signature that verifies against the batch number', async () => {
    const { tx, service } = setup();
    await service.create(staff, dto());
    const boxes = sentCartons(tx).flatMap(carton => carton.boxes);
    expect(new Set(boxes.map(box => box.uid)).size).toBe(25);
    expect(boxes.every(box => CryptoUtil.verifyBoxSignature(box.uid, 'LOT-1', box.signature))).toBe(true);
  });

  it('gives every carton a unique 18-digit SSCC with a valid GS1 check digit', async () => {
    const { tx, service } = setup();
    await service.create(staff, dto());
    const codes = sentCartons(tx).map(carton => carton.sscc);
    expect(new Set(codes).size).toBe(3);
    for (const code of codes) {
      expect(code).toMatch(/^\d{18}$/);
      const sum = [...code.slice(0, 17)].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
      expect(Number(code[17])).toBe((10 - (sum % 10)) % 10);
    }
  });

  it('creates one short carton when the boxes fit in one', async () => {
    const { tx, service } = setup();
    await service.create(staff, dto({ boxCount: 3, boxesPerCarton: 24 }));
    expect(sentCartons(tx).map(carton => carton.boxes.length)).toEqual([3]);
  });

  it('registers the batch at the factory of the token', async () => {
    const { tx, service } = setup();
    await service.create(staff, dto({ certificateCoCq: ' CQ-9 ' }));
    const values = tx.$queryRaw.mock.calls[0].slice(1);
    expect(values.slice(0, 6)).toEqual([4, 12, 'LOT-1', '2026-11-01', '2028-11-01', 'CQ-9']);
  });

  it('lets SUPER_ADMIN choose the factory', async () => {
    const { tx, service } = setup();
    await service.create(admin, dto({ facilityId: 9 }));
    expect(tx.$queryRaw.mock.calls[0][1]).toBe(9);
  });

  it('rejects another factory for factory staff', async () => {
    const { prisma, service } = setup();
    expect(await errorCode(service.create(staff, dto({ facilityId: 5 })))).toBe('WAREHOUSE_FACILITY_FORBIDDEN');
    expect(prisma.withFactoryIntake).not.toHaveBeenCalled();
  });

  it('rejects warehouse staff', async () => {
    const { prisma, service } = setup();
    expect(await errorCode(service.create(warehouseStaff, dto()))).toBe('WAREHOUSE_ACCOUNT_REQUIRED');
    expect(prisma.withFactoryIntake).not.toHaveBeenCalled();
  });

  it('rejects a batch above the default maximum before touching the database', async () => {
    const { prisma, service } = setup();
    expect(await errorCode(service.create(staff, dto({ boxCount: 10001 })))).toBe('FB_BATCH_TOO_LARGE');
    expect(prisma.withFactoryIntake).not.toHaveBeenCalled();
  });

  it('honours the configured maximum', async () => {
    process.env.FACTORY_BATCH_MAX_BOXES = '20';
    const { service } = setup();
    expect(await errorCode(service.create(staff, dto({ boxCount: 21 })))).toBe('FB_BATCH_TOO_LARGE');
    expect(await errorCode(service.create(staff, dto({ boxCount: 20 })))).toBeUndefined();
  });
});

describe('FactoryBatchService.labels', () => {
  it('lists every box with the SSCC of its carton', async () => {
    const { tx, service } = setup();
    tx.batches.findFirst.mockResolvedValue({ medicine_boxes: [
      { uid: 'u-1', signature: 's-1', sscc_cartons: { sscc_code: '100' } }, { uid: 'u-2', signature: 's-2', sscc_cartons: { sscc_code: '100' } },
      { uid: 'u-3', signature: 's-3', sscc_cartons: null },
    ] });
    await expect(service.labels(staff, 31, {})).resolves.toBe('sscc,uid,secret_code\n100,u-1,s-1\n100,u-2,s-2\n,u-3,s-3');
    expect(tx.batches.findFirst.mock.calls[0][0].where).toEqual({ id: 31, manufacturer_source_facility_id: 4 });
  });

  it('rejects a batch of another factory', async () => {
    const { tx, service } = setup();
    tx.batches.findFirst.mockResolvedValue(null);
    expect(await errorCode(service.labels(staff, 31, {}))).toBe('WAREHOUSE_BATCH_NOT_FOUND');
  });

  it('lets SUPER_ADMIN read any batch', async () => {
    const { tx, service } = setup();
    tx.batches.findFirst.mockResolvedValue({ medicine_boxes: [] });
    await service.labels(admin, 31, {});
    expect(tx.batches.findFirst.mock.calls[0][0].where).toEqual({ id: 31 });
  });

  it('lets the receiving warehouse print labels of a batch it took in from an outside manufacturer', async () => {
    const { tx, service } = setup();
    tx.batches.findFirst.mockResolvedValue({ medicine_boxes: [{ uid: 'u-1', signature: 's-1', sscc_cartons: null }] });
    await expect(service.labels(warehouseStaff, 31, {})).resolves.toBe('sscc,uid,secret_code\n,u-1,s-1');
    const call = tx.batches.findFirst.mock.calls[0][0];
    expect(call.where.manufacturer_source_facility_id).toBeNull();
    expect(call.where.goods_receipt_lines.some.goods_receipts.facility_id).toEqual(expect.any(Number));
    expect(call.select.medicine_boxes.where.status).toEqual({ not: 'QUARANTINED' });
  });

  it('does not show warehouse staff the labels of a batch they did not receive from outside', async () => {
    const { tx, service } = setup();
    tx.batches.findFirst.mockResolvedValue(null);
    expect(await errorCode(service.labels(warehouseStaff, 31, {}))).toBe('WAREHOUSE_BATCH_NOT_FOUND');
  });
});

describe('FactoryBatchService.void', () => {
  it('calls the void function with the trimmed reason inside the factory intake context', async () => {
    const { tx, prisma, service } = setup();
    await expect(service.void(staff, 31, { reason: '  wrong box count ' })).resolves.toEqual({ id: 31 });
    expect(prisma.withFactoryIntake).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual([31, 'wrong box count']);
  });

  it('lets SUPER_ADMIN void a batch', async () => {
    const { service } = setup();
    await expect(service.void(admin, 31, { reason: 'duplicate' })).resolves.toEqual({ id: 31 });
  });

  it('rejects warehouse staff before touching the database', async () => {
    const { prisma, service } = setup();
    expect(await errorCode(service.void(warehouseStaff, 31, { reason: 'x' }))).toBe('WAREHOUSE_ACCOUNT_REQUIRED');
    expect(prisma.withFactoryIntake).not.toHaveBeenCalled();
  });

  it.each([
    ['FB_VOID_NOT_ALLOWED', 'FB_VOID_NOT_ALLOWED'],
    ['FB_VOID_REASON_REQUIRED', 'FB_VOID_REASON_REQUIRED'],
    ['FB_BATCH_NOT_FOUND', 'FB_BATCH_NOT_FOUND'],
  ])('maps the database error %s to an application error', async (raised, code) => {
    const { tx, service } = setup();
    tx.$queryRaw.mockRejectedValue(new Prisma.PrismaClientKnownRequestError(raised, { code: 'P2010', clientVersion: 'test', meta: { message: `ERROR: ${raised}` } }));
    expect(await errorCode(service.void(staff, 31, { reason: 'x' }))).toBe(code);
  });
});

describe('FactoryBatchService.productionReport', () => {
  const totals = { batches: 2, boxes: 300, voidedBatches: 1, recalledBatches: 0, heldBatches: 0 };
  const periods = [{ period: '2026-10-01', batches: 1, boxes: 100 }, { period: '2026-11-01', batches: 1, boxes: 200 }];
  const medicines = [{ medicineId: 3, medicineName: 'Panadol', batches: 2, boxes: 300 }];
  function reportSetup() {
    const result = setup();
    result.tx.$queryRaw.mockReset().mockResolvedValueOnce([totals]).mockResolvedValueOnce(periods).mockResolvedValueOnce(medicines);
    return result;
  }

  it('reports the totals, periods and medicines of the factory of the token', async () => {
    const { tx, service } = reportSetup();
    await expect(service.productionReport(staff, { from: '2026-10-01', to: '2026-11-30', groupBy: 'month' })).resolves.toEqual({
      from: '2026-10-01', to: '2026-11-30', groupBy: 'month', totals, periods, medicines,
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    // The factory is bound into every query; groupBy is bound into the period query.
    const bound = JSON.stringify(tx.$queryRaw.mock.calls.map(call => call.slice(1)));
    expect(bound).toContain('2026-10-01');
    expect(tx.$queryRaw.mock.calls[1].slice(1)).toContain('month');
    expect((tx.$queryRaw.mock.calls[0][1] as Prisma.Sql).values).toEqual(['2026-10-01', '2026-11-30', 4, 4]);
  });

  it('defaults to the last year by month', async () => {
    const { service } = reportSetup();
    const report = await service.productionReport(staff, { to: '2026-11-30' });
    expect(report).toMatchObject({ groupBy: 'month', from: '2025-11-30', to: '2026-11-30' });
  });

  it('defaults to the last 30 days when grouped by day', async () => {
    const { service } = reportSetup();
    expect(await service.productionReport(staff, { to: '2026-11-30', groupBy: 'day' })).toMatchObject({ from: '2026-11-01' });
  });

  it('rejects a reversed range before touching the database', async () => {
    const { prisma, service } = reportSetup();
    expect(await errorCode(service.productionReport(staff, { from: '2026-12-01', to: '2026-11-01' }))).toBe('FB_REPORT_RANGE_INVALID');
    expect(prisma.withWarehouseRead).not.toHaveBeenCalled();
  });

  it('rejects another factory for factory staff and warehouse staff', async () => {
    const { service } = reportSetup();
    expect(await errorCode(service.productionReport(staff, { facilityId: 5 }))).toBe('WAREHOUSE_FACILITY_FORBIDDEN');
    expect(await errorCode(service.productionReport(warehouseStaff, {}))).toBe('WAREHOUSE_ACCOUNT_REQUIRED');
  });

  it('lets SUPER_ADMIN report on all factories or one', async () => {
    const { tx, service } = reportSetup();
    await service.productionReport(admin, { from: '2026-01-01', to: '2026-02-01' });
    expect((tx.$queryRaw.mock.calls[0][1] as Prisma.Sql).values).toEqual(['2026-01-01', '2026-02-01', null, null]);
  });
});
