import { PrismaService } from '../../../prisma/prisma.service';
import { AdminOrderService } from '../../order/admin-order.service';
import { FulfillmentService } from './fulfillment.service';

const MED = 5;
const OTHER_MED = 6;
const uid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const staff = { type: 'employee', id: 12, role: 'WAREHOUSE_STAFF', facilityId: 3 };
const manager = { ...staff, id: 13, role: 'WAREHOUSE_MANAGER' };

interface Box { uid: string; status: string; current_facility_id: number; medicine_batches: { medicine_id: number } }

function setup(boxes: Box[], options: { unsellable?: string[]; packed?: { order_item_id: number }[]; inOtherPackage?: string } = {}) {
  const order = {
    id: 1,
    order_code: 'ORD-1',
    export_facility_id: 3,
    order_items: [{ id: 10, medicine_id: MED, unit_name: 'Box', quantity: 2, assigned_uids: [uid(1)] }],
  };
  const tx = {
    order_packages: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({
        id: 7, package_code: data.package_code, order_id: data.order_id, status: 'PACKED',
        order_package_items: data.order_package_items.create.map((item: { box_uid: string }) => ({ box_uid: item.box_uid })),
      })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 7, package_code: 'PKG-000001', order_id: 1, status: 'VOID', order_package_items: [] }),
    },
    order_package_items: {
      findFirst: jest.fn().mockResolvedValue(options.inOtherPackage ? { box_uid: options.inOtherPackage } : null),
      findMany: jest.fn().mockResolvedValue(options.packed ?? []),
      updateMany: jest.fn(),
    },
    medicine_boxes: { findMany: jest.fn().mockResolvedValue(boxes) },
    orders: { findUnique: jest.fn().mockResolvedValue({ order_status: 'PROCESSING' }), findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue((options.unsellable ?? []).map(value => ({ uid: value }))),
  };
  const prisma = { withOrder: jest.fn((_operation: string, run: (client: typeof tx) => unknown) => run(tx)) };
  const orders = {
    lockPackableOrder: jest.fn().mockResolvedValue(order),
    packLockedOrder: jest.fn().mockResolvedValue('TRK-1'),
  };
  const service = new FulfillmentService(prisma as unknown as PrismaService, orders as unknown as AdminOrderService);
  return { service, tx, orders, prisma };
}

const box = (n: number, overrides: Partial<Box> = {}): Box =>
  ({ uid: uid(n), status: 'IN_STOCK', current_facility_id: 3, medicine_batches: { medicine_id: MED }, ...overrides });
const pack = (service: FulfillmentService, uids: string[], packageCode = 'PKG-000001') =>
  service.addPackage(staff, 1, { packageCode, boxUids: uids });

describe('FulfillmentService packages', () => {
  it('packs scanned boxes against the matching order line', async () => {
    const { service, tx } = setup([box(1, { status: 'RESERVED' }), box(2)]);
    await expect(pack(service, [uid(1), uid(2)])).resolves.toMatchObject({ id: 7, boxUids: [uid(1), uid(2)] });
    expect(tx.order_packages.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        package_code: 'PKG-000001', order_id: 1, facility_id: 3, packed_by_id: 12,
        order_package_items: { create: [{ order_item_id: 10, box_uid: uid(1) }, { order_item_id: 10, box_uid: uid(2) }] },
      }),
    }));
  });

  it.each([
    ['a box of another product', [box(1, { medicine_batches: { medicine_id: OTHER_MED } })], {}, 'PK_BOX_WRONG_PRODUCT'],
    ['a box from a held batch or below minimum shelf life', [box(1)], { unsellable: [uid(1)] }, 'PK_BOX_NOT_SELLABLE'],
    ['a box at another warehouse', [box(1, { current_facility_id: 4 })], {}, 'PK_BOX_NOT_AT_WAREHOUSE'],
    ['an unknown box', [], {}, 'PK_BOX_NOT_AT_WAREHOUSE'],
    ['a box reserved for another order', [box(1, { uid: uid(3), status: 'RESERVED' })], {}, 'PK_BOX_UNAVAILABLE'],
    ['a box already in another package', [box(1)], { inOtherPackage: uid(1) }, 'PK_BOX_IN_PACKAGE'],
    ['a box beyond the line quantity', [box(1)], { packed: [{ order_item_id: 10 }, { order_item_id: 10 }] }, 'PK_LINE_FULL'],
  ])('rejects %s', async (_case, boxes, options, code) => {
    const { service, tx } = setup(boxes, options);
    const scanned = boxes[0]?.uid ?? uid(1);
    await expect(pack(service, [scanned])).rejects.toMatchObject({ code });
    expect(tx.order_packages.create).not.toHaveBeenCalled();
  });

  it('returns the existing package when the same code is sent again', async () => {
    const { service, tx } = setup([box(1)]);
    tx.order_packages.findUnique.mockResolvedValue({ id: 7, package_code: 'PKG-000001', order_id: 1, status: 'PACKED', order_package_items: [{ box_uid: uid(1) }] });
    await expect(pack(service, [uid(1)])).resolves.toMatchObject({ id: 7, boxUids: [uid(1)] });
    expect(tx.order_packages.create).not.toHaveBeenCalled();
  });

  it('rejects a package code used by another order', async () => {
    const { service, tx } = setup([box(1)]);
    tx.order_packages.findUnique.mockResolvedValue({ id: 8, package_code: 'PKG-000001', order_id: 2, status: 'PACKED', order_package_items: [] });
    await expect(pack(service, [uid(1)])).rejects.toMatchObject({ code: 'PK_CODE_TAKEN' });
  });

  it('does not pack an order that the shared pack checks refuse', async () => {
    const { service, tx, orders } = setup([box(1)]);
    orders.lockPackableOrder.mockRejectedValue(new Error('Only orders with status PENDING or PROCESSING can be packed.'));
    await expect(pack(service, [uid(1)])).rejects.toThrow(/PENDING or PROCESSING/);
    expect(tx.order_packages.create).not.toHaveBeenCalled();
  });
});

describe('FulfillmentService completion and void', () => {
  it('completes packing with the boxes of all active packages', async () => {
    const { service, tx, orders } = setup([]);
    tx.order_package_items.findMany.mockResolvedValue([{ box_uid: uid(1) }, { box_uid: uid(2) }]);
    await expect(service.completePacking(staff, 1, { courierName: 'GHN' })).resolves.toEqual({ orderId: 1, trackingNumber: 'TRK-1' });
    expect(orders.packLockedOrder).toHaveBeenCalledWith(tx, expect.objectContaining({ id: 1 }), [uid(1), uid(2)], { courierName: 'GHN' }, staff);
  });

  it('voids a package and frees its boxes', async () => {
    const { service, tx } = setup([]);
    tx.order_packages.findUnique.mockResolvedValue({ order_id: 1 });
    await expect(service.voidPackage(manager, 7, { reason: ' Wrong box ' })).resolves.toMatchObject({ status: 'VOID' });
    expect(tx.order_packages.updateMany).toHaveBeenCalledWith({
      where: { id: 7, status: 'PACKED' },
      data: expect.objectContaining({ status: 'VOID', void_reason: 'Wrong box', voided_by_id: 13 }),
    });
    expect(tx.order_package_items.updateMany).toHaveBeenCalledWith({ where: { package_id: 7, voided_at: null }, data: { voided_at: expect.any(Date) } });
  });

  it('does not void a package once packing is completed', async () => {
    const { service, tx } = setup([]);
    tx.order_packages.findUnique.mockResolvedValue({ order_id: 1 });
    tx.orders.findUnique.mockResolvedValue({ order_status: 'PENDING_PICKUP' });
    await expect(service.voidPackage(manager, 7, { reason: 'Wrong box' })).rejects.toMatchObject({ code: 'PK_PACKAGE_NOT_VOIDABLE' });
    expect(tx.order_packages.updateMany).not.toHaveBeenCalled();
  });

  it('lists the packing queue of the staff warehouse only', async () => {
    const { service, tx } = setup([]);
    await service.queue(staff, {});
    expect(tx.orders.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ export_facility_id: 3, order_status: { in: ['PENDING', 'PROCESSING'] } }),
    }));
    await expect(service.queue(staff, { facilityId: 4 })).rejects.toMatchObject({ code: 'WAREHOUSE_FACILITY_FORBIDDEN' });
  });

  it('lists the packed packages of an order at the staff warehouse only', async () => {
    const { service, tx } = setup([]);
    await service.packages(staff, 1);
    expect(tx.order_packages.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { order_id: 1, status: 'PACKED', facility_id: 3 },
    }));
  });
});
