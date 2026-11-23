import { AppException } from '../../../common/errors/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { availableStock } from '../../order/helpers/order.helper';
import { WarehouseInventoryService } from './warehouse-inventory.service';

type Run = (tx: unknown) => Promise<unknown>;

function inventoryRow(facility: number, stock: number, reserved: number | null) {
  return {
    facility_id: facility, variant_id: 11, stock_quantity: stock, reserved_quantity: reserved, updated_at: null,
    packaging_variants: { unit_name: 'Box', medicine: { id: 5, medicine_name: 'Paracetamol' } },
  };
}

function setup(rows: { inventories?: unknown[]; quarantine?: unknown[]; boxes?: unknown[]; batch?: unknown } = {}) {
  const tx = {
    inventories: {
      count: jest.fn().mockResolvedValue(rows.inventories?.length ?? 0),
      findMany: jest.fn().mockResolvedValue(rows.inventories ?? []),
    },
    batches: {
      count: jest.fn().mockResolvedValue(2),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(rows.batch ?? null),
    },
    medicine_boxes: { groupBy: jest.fn().mockResolvedValue(rows.boxes ?? []) },
    internal_transfers: { count: jest.fn().mockResolvedValue(3) },
    orders: { count: jest.fn().mockResolvedValue(4) },
    $queryRaw: jest.fn().mockResolvedValue(rows.quarantine ?? []),
  };
  const prisma = {
    withWarehouseRead: jest.fn((_actor: unknown, run: Run) => run(tx)),
    withOrder: jest.fn((_op: string, run: Run) => run(tx)),
  };
  return { tx, prisma, service: new WarehouseInventoryService(prisma as unknown as PrismaService) };
}

async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try { await promise; } catch (error) { return error instanceof AppException ? error.code : 'OTHER'; }
  return undefined;
}

const staff = { id: 4, role: 'WAREHOUSE_STAFF', type: 'employee', facilityId: 7 };
const factory = { id: 6, role: 'FACTORY_WAREHOUSE_STAFF', type: 'employee', facilityId: 9 };
const pharmacist = { id: 8, role: 'PHARMACIST', type: 'employee', facilityId: 7 };

describe('WarehouseInventoryService.inventory', () => {
  it('reports the same available units as checkout, plus quarantine', async () => {
    const rows = [inventoryRow(7, 10, 3), inventoryRow(7, 2, 5), inventoryRow(7, 4, null)];
    const { service, tx } = setup({ inventories: rows, quarantine: [{ facility_id: 7, variant_id: 11, quantity: 2 }] });
    const page = await service.inventory(staff, {});
    expect(page.items.map(i => i.available)).toEqual(rows.map(availableStock));
    expect(page.items.map(i => i.available)).toEqual([7, 0, 4]);
    expect(page.items[0]).toMatchObject({ stock: 10, reserved: 3, quarantine: 2, medicineName: 'Paracetamol', unitName: 'Box' });
    expect(tx.inventories.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { facility_id: 7 } }));
  });

  it('reports the in-stock boxes of batches on hold per product', async () => {
    const { service, tx } = setup({ inventories: [inventoryRow(7, 10, 0)] });
    tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ facility_id: 7, variant_id: 11, held: 4 }]);
    const [item] = (await service.inventory(staff, {})).items;
    expect(item).toMatchObject({ stock: 10, available: 10, held: 4 });
  });

  it('reports no held boxes when no batch is on hold', async () => {
    const { service } = setup({ inventories: [inventoryRow(7, 10, 0)] });
    expect((await service.inventory(staff, {})).items[0].held).toBe(0);
  });

  it('lets factory staff read their own factory', async () => {
    const { service, tx } = setup();
    await service.inventory(factory, {});
    expect(tx.inventories.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { facility_id: 9 } }));
  });

  it('rejects another warehouse and non-warehouse roles before touching the database', async () => {
    const { service, prisma } = setup();
    expect(await errorCode(service.inventory(staff, { facilityId: 8 }))).toBe('WAREHOUSE_FACILITY_FORBIDDEN');
    expect(await errorCode(service.inventory(pharmacist, {}))).toBe('WAREHOUSE_ACCOUNT_REQUIRED');
    expect(prisma.withWarehouseRead).not.toHaveBeenCalled();
  });
});

describe('WarehouseInventoryService.inventoryDetail', () => {
  it('reports a product without stock at the warehouse', async () => {
    expect(await errorCode(setup().service.inventoryDetail(staff, 11, {}))).toBe('WAREHOUSE_INVENTORY_NOT_FOUND');
  });

  it('counts in-stock boxes per batch of the product at the warehouse', async () => {
    const { service, tx } = setup({ inventories: [inventoryRow(7, 10, 0)], boxes: [{ batch_id: 21, _count: { _all: 6 } }] });
    tx.batches.findMany.mockResolvedValue([{
      id: 21, batch_number: 'B-21', production_date: new Date('2026-01-01'), expiry_date: new Date('2027-01-01'), status: 'ACTIVE',
      medicines: { id: 5, medicine_name: 'Paracetamol' },
    }]);
    const detail = await service.inventoryDetail(staff, 11, {});
    expect(detail.batches).toEqual([expect.objectContaining({ id: 21, batchNumber: 'B-21', boxesInStock: 6 })]);
    expect(tx.medicine_boxes.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ current_facility_id: 7, medicine_batches: { medicine_id: 5 } }),
    }));
  });
});

describe('WarehouseInventoryService.batch', () => {
  it('hides a batch with no boxes at the warehouse', async () => {
    const { service } = setup({ batch: { id: 21 } });
    expect(await errorCode(service.batch(staff, 21, {}))).toBe('WAREHOUSE_BATCH_NOT_FOUND');
  });
});

describe('WarehouseInventoryService batches of a factory', () => {
  it('lists the batches the factory made even when no box is left there', async () => {
    const { tx, service } = setup();
    await service.batches(factory, {});
    const where = tx.batches.count.mock.calls[0][0].where;
    expect(where.AND[0].OR).toEqual([{ manufacturer_source_facility_id: 9 }, expect.objectContaining({ medicine_boxes: expect.anything() })]);
  });

  it('keeps the factory scope when searching', async () => {
    const { tx, service } = setup();
    await service.batches(factory, { search: 'LOT' });
    const where = tx.batches.count.mock.calls[0][0].where;
    expect(where.AND[0].OR).toHaveLength(2);
    expect(where.OR).toHaveLength(2);
  });

  it('keeps listing only batches with boxes at a warehouse', async () => {
    const { tx, service } = setup();
    await service.batches(staff, {});
    const where = tx.batches.count.mock.calls[0][0].where;
    expect(where.AND[0].OR).toBeUndefined();
    expect(where.AND[0].medicine_boxes).toBeDefined();
  });

  it('shows a batch the factory made although all its boxes were shipped', async () => {
    const { service } = setup({ batch: { id: 21, batch_number: 'B-21', production_date: new Date(), expiry_date: new Date(), status: 'ACTIVE', medicines: null,
      manufacturer_source_facility_id: 9, initial_quantity: 5, remaining_quantity: 5, certificate_co_cq: null, hold_reason: null, held_at: null } });
    await expect(service.batch(factory, 21, {})).resolves.toMatchObject({ id: 21, boxes: [] });
  });

  it('still hides another factory batch with no boxes here', async () => {
    const { service } = setup({ batch: { id: 21, manufacturer_source_facility_id: 3 } });
    expect(await errorCode(service.batch(factory, 21, {}))).toBe('WAREHOUSE_BATCH_NOT_FOUND');
  });
});

describe('WarehouseInventoryService.dashboard', () => {
  it('sums stock with the checkout formula and counts warehouse work', async () => {
    const { service, prisma } = setup({ inventories: [inventoryRow(7, 10, 3), inventoryRow(7, 2, 5)], quarantine: [{ units: 1 }] });
    await expect(service.dashboard(staff, {})).resolves.toEqual({
      stockUnits: 12, availableUnits: 7, quarantineUnits: 1, expiringBatches: 2, pendingTransfers: 3, ordersToPack: 4,
    });
    expect(prisma.withOrder).toHaveBeenCalledTimes(2);
  });

  it('skips order work for factory staff', async () => {
    const { service, prisma } = setup();
    await expect(service.dashboard(factory, {})).resolves.toMatchObject({ pendingTransfers: null, ordersToPack: null });
    expect(prisma.withOrder).not.toHaveBeenCalled();
  });
});
