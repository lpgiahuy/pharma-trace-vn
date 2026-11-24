import { Prisma } from '@prisma/client';
import { AppException } from '../../../common/errors/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { StockCountService } from './stock-count.service';

type Run = (tx: unknown) => Promise<unknown>;

function setup() {
  const tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn().mockResolvedValue(1) };
  const prisma = { withStockCount: jest.fn((_actor: unknown, run: Run) => run(tx)) };
  return { tx, prisma, service: new StockCountService(prisma as unknown as PrismaService) };
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
const admin = { id: 1, role: 'SUPER_ADMIN', type: 'employee', facilityId: null };

const summary = { id: 12, countCode: 'SC-20261120-0001', facilityId: 7, scope: 'BATCH', medicineId: null, batchId: 3, status: 'SUBMITTED', createdById: 6, createdAt: new Date() };
const line = { batchId: 3, batchNumber: 'LOT-1', medicineName: 'Paracetamol', variantId: 9, systemQuantity: 10, countedQuantity: 7, difference: null, currentQuantity: 10 };

function loadsDetail(tx: ReturnType<typeof setup>['tx'], lines = [line]) {
  tx.$queryRaw.mockResolvedValueOnce([summary]).mockResolvedValueOnce(lines).mockResolvedValueOnce([]);
}

describe('StockCountService.open', () => {
  it('opens the count in the manager warehouse and returns it', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([{ id: 12 }]);
    loadsDetail(tx);
    const detail = await service.open(manager, { countCode: 'SC-20261120-0001', batchId: 3 });
    expect(detail).toMatchObject({ id: 12, countCode: 'SC-20261120-0001', lines: [{ batchId: 3 }] });
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['SC-20261120-0001', 7, null, 3]);
  });

  it('requires SUPER_ADMIN to choose the warehouse', async () => {
    const { prisma, service } = setup();
    expect(await failure(service.open(admin, { countCode: 'SC-20261120-0001' }))).toBe('SC_FACILITY_REQUIRED');
    expect(prisma.withStockCount).not.toHaveBeenCalled();
  });

  it.each([
    ['warehouse staff', staff, {}, 'WAREHOUSE_ACCOUNT_REQUIRED'],
    ['a manager choosing another warehouse', manager, { facilityId: 8 }, 'WAREHOUSE_FACILITY_FORBIDDEN'],
  ])('rejects %s', async (_name, user, extra, code) => {
    const { prisma, service } = setup();
    expect(await failure(service.open(user, { countCode: 'SC-20261120-0001', ...extra }))).toBe(code);
    expect(prisma.withStockCount).not.toHaveBeenCalled();
  });

  it('maps the code raised by the database', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockRejectedValueOnce(databaseError('SC_COUNT_EMPTY'));
    expect(await failure(service.open(manager, { countCode: 'SC-20261120-0001' }))).toBe('SC_COUNT_EMPTY');
  });
});

describe('StockCountService.detail', () => {
  it('flags lines whose units on hand changed since the count opened', async () => {
    const { tx, service } = setup();
    loadsDetail(tx, [line, { ...line, batchId: 4, currentQuantity: 8 }]);
    const detail = await service.detail(manager, 12);
    expect(detail.lines.map(l => l.movedSinceOpen)).toEqual([false, true]);
  });

  it('reports a count that is hidden or missing as not found', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect(await failure(service.detail(staff, 99))).toBe('SC_NOT_FOUND');
  });
});

describe('StockCountService.list', () => {
  it('lists the counts of the staff warehouse with pagination', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([{ total: 41 }]).mockResolvedValueOnce([{ ...summary, lineCount: 2 }]);
    const page = await service.list(staff, { status: 'SUBMITTED', page: 2, limit: 20 });
    expect(page.pagination).toEqual({ total: 41, page: 2, limit: 20, totalPages: 3 });
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual([7, 7, 'SUBMITTED', 'SUBMITTED']);
  });

  it('refuses a facility other than the staff warehouse', async () => {
    const { service } = setup();
    expect(await failure(service.list(staff, { facilityId: 8 }))).toBe('WAREHOUSE_FACILITY_FORBIDDEN');
  });
});

describe('StockCountService transitions', () => {
  it('sends counted quantities as parallel arrays', async () => {
    const { tx, service } = setup();
    loadsDetail(tx);
    await service.saveLines(staff, 12, { lines: [{ batchId: 3, countedQuantity: 7 }, { batchId: 4, countedQuantity: 0 }] });
    expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual([12, [3, 4], [7, 0]]);
  });

  it('submits, approves and cancels through the database functions and reloads the count', async () => {
    const { tx, service } = setup();
    for (const act of [
      () => service.submit(staff, 12), () => service.approve(manager, 12), () => service.cancel(manager, 12, '  Wrong shelf '),
    ]) {
      loadsDetail(tx);
      await expect(act()).resolves.toMatchObject({ id: 12 });
    }
    expect(tx.$executeRaw.mock.calls.map(call => call.slice(1))).toEqual([[12], [12], [12, 'Wrong shelf']]);
  });

  it.each(['SC_INVALID_TRANSITION', 'SC_LINES_UNCOUNTED', 'SC_BELOW_RESERVED', 'SC_NOT_FOUND'])('maps %s from the database', async code => {
    const { tx, service } = setup();
    tx.$executeRaw.mockRejectedValueOnce(databaseError(code));
    expect(await failure(service.approve(manager, 12))).toBe(code);
  });

  it('does not map errors it does not know', async () => {
    const { tx, service } = setup();
    tx.$executeRaw.mockRejectedValueOnce(databaseError('connection reset'));
    expect(await failure(service.submit(staff, 12))).toBe('OTHER');
  });
});

describe('StockCountService.adjust', () => {
  const dto = { adjustmentCode: 'ADJ-20261120-0001', batchId: 3, quantityChange: -2, reason: '  Crushed pallet ' };

  it('books the signed change with the trimmed reason and returns the ledger row', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([{ id: 55 }]);
    await expect(service.adjust(manager, dto)).resolves.toEqual({ logId: 55 });
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual([7, 'ADJ-20261120-0001', 3, -2, 'Crushed pallet']);
  });

  it.each([
    ['warehouse staff', staff, 'WAREHOUSE_ACCOUNT_REQUIRED'],
    ['SUPER_ADMIN without a warehouse', admin, 'SC_FACILITY_REQUIRED'],
  ])('rejects %s', async (_name, user, code) => {
    const { prisma, service } = setup();
    expect(await failure(service.adjust(user, dto))).toBe(code);
    expect(prisma.withStockCount).not.toHaveBeenCalled();
  });

  it.each(['SC_BELOW_RESERVED', 'SC_GAIN_UNKNOWN_BOXES', 'SC_CODE_CONFLICT', 'SC_VARIANT_AMBIGUOUS'])('maps %s from the database', async code => {
    const { tx, service } = setup();
    tx.$queryRaw.mockRejectedValueOnce(databaseError(code));
    expect(await failure(service.adjust(manager, dto))).toBe(code);
  });
});
