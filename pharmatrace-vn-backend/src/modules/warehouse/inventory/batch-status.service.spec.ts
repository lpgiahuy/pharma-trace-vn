import { AppException } from '../../../common/errors/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { BatchStatusService } from './batch-status.service';

type Run = (tx: unknown) => Promise<unknown>;

function setup(status: string | null, boxesAtWarehouse = 2) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue(status === null ? [] : [{ status }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    medicine_boxes: { count: jest.fn().mockResolvedValue(boxesAtWarehouse) },
    batches: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    withBatchStatus: jest.fn((_actor: unknown, run: Run) => run(tx)),
    $executeRaw: jest.fn().mockResolvedValue(3),
  };
  return { tx, prisma, service: new BatchStatusService(prisma as unknown as PrismaService) };
}

async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try { await promise; } catch (error) { return error instanceof AppException ? error.code : 'OTHER'; }
  return undefined;
}

const manager = { id: 4, role: 'WAREHOUSE_MANAGER', type: 'employee', facilityId: 7 };
const admin = { id: 1, role: 'SUPER_ADMIN', type: 'employee' };
const staff = { id: 5, role: 'WAREHOUSE_STAFF', type: 'employee', facilityId: 7 };

describe('BatchStatusService.hold', () => {
  it('puts an active batch at the manager warehouse on hold and records the reason', async () => {
    const { tx, service } = setup('ACTIVE');
    await expect(service.hold(manager, 10, '  Damaged cartons ')).resolves.toEqual({ id: 10, status: 'ON_HOLD' });
    expect(tx.medicine_boxes.count).toHaveBeenCalledWith({ where: { batch_id: 10, current_facility_id: 7 } });
    expect(tx.batches.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { status: 'ON_HOLD', hold_reason: 'Damaged cartons', held_by_id: 4, held_at: expect.any(Date) },
    });
    expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual([10, 'ACTIVE', 'ON_HOLD', 'Damaged cartons', 4]);
  });

  it('lets SUPER_ADMIN hold a batch at any warehouse', async () => {
    const { tx, service } = setup('ACTIVE', 0);
    await service.hold(admin, 10, 'Quality alert');
    expect(tx.medicine_boxes.count).not.toHaveBeenCalled();
    expect(tx.batches.update).toHaveBeenCalled();
  });

  it('rejects a batch with no boxes at the manager warehouse', async () => {
    const { tx, service } = setup('ACTIVE', 0);
    expect(await errorCode(service.hold(manager, 10, 'Damaged'))).toBe('WAREHOUSE_BATCH_NOT_FOUND');
    expect(tx.batches.update).not.toHaveBeenCalled();
  });

  it('rejects an unknown batch', async () => {
    const { service } = setup(null);
    expect(await errorCode(service.hold(manager, 99, 'Damaged'))).toBe('WAREHOUSE_BATCH_NOT_FOUND');
  });

  it.each(['ON_HOLD', 'RECALLED', 'EXPIRED'])('rejects holding a %s batch', async status => {
    const { tx, service } = setup(status);
    expect(await errorCode(service.hold(manager, 10, 'Damaged'))).toBe('WAREHOUSE_BATCH_NOT_ACTIVE');
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('rejects warehouse staff', async () => {
    const { prisma, service } = setup('ACTIVE');
    expect(await errorCode(service.hold(staff, 10, 'Damaged'))).toBe('WAREHOUSE_ACCOUNT_REQUIRED');
    expect(prisma.withBatchStatus).not.toHaveBeenCalled();
  });
});

describe('BatchStatusService.release', () => {
  it('returns a held batch to active, clears the hold and records the reason', async () => {
    const { tx, service } = setup('ON_HOLD');
    await expect(service.release(manager, 10, 'Inspection passed')).resolves.toEqual({ id: 10, status: 'ACTIVE' });
    expect(tx.batches.update).toHaveBeenCalledWith({
      where: { id: 10 }, data: { status: 'ACTIVE', hold_reason: null, held_by_id: null, held_at: null },
    });
    expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual([10, 'ON_HOLD', 'ACTIVE', 'Inspection passed', 4]);
  });

  it.each(['ACTIVE', 'RECALLED', 'EXPIRED'])('rejects releasing a %s batch', async status => {
    const { tx, service } = setup(status);
    expect(await errorCode(service.release(manager, 10, 'Inspection passed'))).toBe('WAREHOUSE_BATCH_NOT_ON_HOLD');
    expect(tx.batches.update).not.toHaveBeenCalled();
  });
});

describe('BatchStatusService.expireBatches', () => {
  it('expires active and held batches past their expiry date in Vietnam time', async () => {
    const { prisma, service } = setup('ACTIVE');
    await expect(service.expireBatches()).resolves.toBe(3);
    const sql = (prisma.$executeRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toContain("status IN ('ACTIVE', 'ON_HOLD')");
    expect(sql).toContain("expiry_date <= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date");
  });
});
