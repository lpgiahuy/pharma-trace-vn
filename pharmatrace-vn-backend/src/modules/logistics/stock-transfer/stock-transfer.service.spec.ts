import { Prisma } from '@prisma/client';
import { AppException } from '../../../common/errors/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { StockTransferService } from './stock-transfer.service';

const pharmacyManager = { type: 'employee', id: 7, role: 'STORE_MANAGER', facilityId: 5 };
const factoryStaff = { type: 'employee', id: 9, role: 'FACTORY_WAREHOUSE_STAFF', facilityId: 2 };
const warehouseStaff = { type: 'employee', id: 8, role: 'WAREHOUSE_STAFF', facilityId: 3 };

function setup(queryRaw: jest.Mock = jest.fn().mockResolvedValue([{ id: 11 }])) {
  const tx = {
    $queryRaw: queryRaw,
    stock_transfer_requests: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 11, status: 'REQUESTED' }) },
    internal_transfers: { findMany: jest.fn().mockResolvedValue([]) },
  };
  type Run = (client: typeof tx) => unknown;
  const prisma = {
    withActor: jest.fn((_actor: unknown, operation: Run) => operation(tx)),
    withOrder: jest.fn((_operation: string, operation: Run) => operation(tx)),
  };
  return { service: new StockTransferService(prisma as unknown as PrismaService), tx, prisma };
}

function databaseError(message: string) {
  return new Prisma.PrismaClientKnownRequestError('raw query failed', { code: 'P2010', clientVersion: 'test', meta: { message } });
}

describe('StockTransferService', () => {
  it('creates the request for the caller facility as destination', async () => {
    const { service, tx, prisma } = setup();
    await expect(service.create(pharmacyManager, { requestCode: 'STQ-000001', fromFacilityId: 3, lines: [{ variantId: 2, quantity: 20 }] }))
      .resolves.toMatchObject({ id: 11 });
    expect(prisma.withActor).toHaveBeenCalledWith(expect.objectContaining({ id: 7, facilityId: 5 }), expect.any(Function));
    const values = tx.$queryRaw.mock.calls[0].slice(1);
    expect(values).toEqual(['STQ-000001', 3, 5, '[{"variantId":2,"quantity":20}]', null]);
  });

  it('lets factory staff send stock to a warehouse through send_factory_transfer', async () => {
    const { service, tx, prisma } = setup();
    await expect(service.send(factoryStaff, { requestCode: 'FTS-000001', toFacilityId: 3, lines: [{ variantId: 2, quantity: 20 }], reason: 'Weekly supply' }))
      .resolves.toMatchObject({ id: 11 });
    expect(prisma.withActor).toHaveBeenCalledWith(expect.objectContaining({ id: 9, facilityId: 2, role: 'FACTORY_WAREHOUSE_STAFF' }), expect.any(Function));
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['FTS-000001', 3, '[{"variantId":2,"quantity":20}]', 'Weekly supply']);
  });

  it.each([
    ['ST_FORBIDDEN', 403],
    ['ST_DESTINATION_INVALID', 422],
    ['ST_STOCK_INSUFFICIENT', 409],
  ])('maps %s raised while sending to HTTP %s', async (code, status) => {
    const { service } = setup(jest.fn().mockRejectedValue(databaseError(`ERROR: ${code}`)));
    const error = await service.send(factoryStaff, { requestCode: 'FTS-000002', toFacilityId: 3, lines: [{ variantId: 2, quantity: 1 }] }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code });
    expect((error as AppException).getStatus()).toBe(status);
  });

  it.each([
    ['ST_SOURCE_MANAGER_REQUIRED', 403],
    ['ST_NOT_FOUND', 404],
    ['ST_STOCK_INSUFFICIENT', 409],
    ['ST_INVALID_STATUS', 409],
  ])('maps %s raised by the database to HTTP %s', async (code, status) => {
    const { service } = setup(jest.fn().mockRejectedValue(databaseError(`ERROR: ${code}`)));
    const error = await service.decide(pharmacyManager, 11, 'APPROVE').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppException);
    expect(error).toMatchObject({ code });
    expect((error as AppException).getStatus()).toBe(status);
  });

  it('lists only the transfers of the caller warehouse and refuses another warehouse', async () => {
    const { service, tx } = setup();
    await service.warehouseTransfers(warehouseStaff, {});
    expect(tx.internal_transfers.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ from_facility_id: 3 }, { to_facility_id: 3 }] },
    }));
    expect(() => service.warehouseTransfers(warehouseStaff, { facilityId: 4 })).toThrow(AppException);
  });
});
