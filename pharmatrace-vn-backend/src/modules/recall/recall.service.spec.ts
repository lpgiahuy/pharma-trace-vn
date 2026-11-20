import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app-exception';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminRecallController, WarehouseRecallController } from './recall.controller';
import { RecallService } from './recall.service';

type Run = (tx: unknown) => Promise<unknown>;

function setup() {
  const tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn().mockResolvedValue(1) };
  const prisma = { withActor: jest.fn((_actor: unknown, run: Run) => run(tx)) };
  return { tx, prisma, service: new RecallService(prisma as unknown as PrismaService) };
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

const admin = { id: 1, role: 'SUPER_ADMIN', type: 'employee' };
const manager = { id: 6, role: 'WAREHOUSE_MANAGER', type: 'employee', facilityId: 7 };
const summary = { id: 4, recallCode: 'RCL-20261120-01', status: 'ACTIVE', batchCount: 1 };
const dto = { recallCode: 'RCL-20261120-01', reason: ' Contamination ', severity: 'LEVEL_1' as const, batchIds: [3] };

function loadsDetail(tx: ReturnType<typeof setup>['tx']) {
  tx.$queryRaw.mockResolvedValueOnce([summary]).mockResolvedValueOnce([{ batchId: 3 }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
}

function allows(controller: { prototype: object }, handler: string, role: string): boolean {
  const context = {
    getHandler: () => (controller.prototype as Record<string, unknown>)[handler], getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 1, role, type: 'employee' } }) }),
  } as unknown as ExecutionContext;
  return new RolesGuard(new Reflector()).canActivate(context);
}

describe('Recall routes', () => {
  it('lets only SUPER_ADMIN manage recalls', () => {
    expect(allows(AdminRecallController, 'create', 'SUPER_ADMIN')).toBe(true);
    expect(allows(AdminRecallController, 'create', 'WAREHOUSE_MANAGER')).toBe(false);
    expect(allows(AdminRecallController, 'create', 'STORE_MANAGER')).toBe(false);
  });

  it('shows recall tasks to warehouse roles and pharmacy managers', () => {
    for (const role of ['WAREHOUSE_STAFF', 'WAREHOUSE_MANAGER', 'SUPER_ADMIN', 'STORE_MANAGER']) expect(allows(WarehouseRecallController, 'tasks', role)).toBe(true);
    expect(allows(WarehouseRecallController, 'tasks', 'PHARMACIST')).toBe(false);
  });
});

describe('RecallService.create', () => {
  it('creates the recall in the database and returns it', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([{ id: 4 }]);
    loadsDetail(tx);
    expect(await service.create(admin, dto)).toMatchObject({ id: 4, batches: [{ batchId: 3 }] });
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['RCL-20261120-01', 'Contamination', 'LEVEL_1', null, [3]]);
  });

  it.each(['RC_FORBIDDEN', 'RC_BATCH_RECALLED', 'RC_CODE_TAKEN'])('maps %s raised by the database', async code => {
    const { tx, service } = setup();
    tx.$queryRaw.mockRejectedValueOnce(databaseError(code));
    expect(await failure(service.create(manager, dto))).toBe(code);
  });
});

describe('RecallService.detail', () => {
  it('reports a recall the caller cannot read as not found', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect(await failure(service.detail(manager, 4))).toBe('RC_NOT_FOUND');
  });
});

describe('RecallService.collect and close', () => {
  it('collects to the chosen warehouse and returns the recall', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([{ created: 2 }]);
    loadsDetail(tx);
    await service.collect(admin, 4, { destinationFacilityId: 9 });
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual([4, 9]);
  });

  it('refuses to close while a collection transfer is open', async () => {
    const { tx, service } = setup();
    tx.$executeRaw.mockRejectedValueOnce(databaseError('RC_COLLECTION_OPEN'));
    expect(await failure(service.close(admin, 4, { note: 'Done' }))).toBe('RC_COLLECTION_OPEN');
  });
});

describe('RecallService.impact', () => {
  it('counts every box once by location', async () => {
    const { tx, service } = setup();
    loadsDetail(tx);
    tx.$queryRaw.mockResolvedValueOnce(['FACILITY', 'FACILITY', 'IN_TRANSIT', 'DELIVERED'].map((location, i) => ({ uid: `u${i}`, location })));
    const impact = await service.impact(admin, 4);
    expect(impact.totalBoxes).toBe(4);
    expect(impact.byLocation).toEqual({ FACILITY: 2, IN_TRANSIT: 1, DELIVERED: 1, OTHER: 0 });
  });
});

describe('RecallService.tasks', () => {
  it('reads the tasks of the caller facility', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([]);
    await service.tasks(manager, {});
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual([7]);
  });

  it('requires a facility for accounts other than SUPER_ADMIN', async () => {
    const { prisma, service } = setup();
    expect(await failure(service.tasks({ id: 8, role: 'STORE_MANAGER', type: 'employee' }, {}))).toBe('RC_FACILITY_REQUIRED');
    expect(prisma.withActor).not.toHaveBeenCalled();
  });
});
