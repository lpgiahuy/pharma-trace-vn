import { Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../prisma/prisma.service';
import { PurchaseOrderDto } from './dto/purchase-order.dto';
import { PurchaseOrderService } from './purchase-order.service';

type Run = (tx: unknown) => Promise<unknown>;

interface Fixture { status?: string | null; partiesValid?: boolean; variants?: { id: number; medicine_id: number }[] }

function setup({ status = 'PENDING', partiesValid = true, variants = [{ id: 1, medicine_id: 10 }, { id: 2, medicine_id: 20 }] }: Fixture = {}) {
  const tx = {
    // Calls in order of use: the row lock (status) or the parties check.
    $queryRaw: jest.fn((strings: TemplateStringsArray) => Promise.resolve(
      strings.join('').includes('po_parties_valid') ? [{ valid: partiesValid }]
        : status === null ? [] : [{ status, facility_id: 7 }],
    )),
    purchase_orders: {
      create: jest.fn().mockResolvedValue({ id: 5 }),
      update: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue({ id: 5 }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    purchase_order_items: { deleteMany: jest.fn().mockResolvedValue({}) },
    purchase_order_events: { create: jest.fn().mockResolvedValue({}) },
    packaging_variants: { findMany: jest.fn().mockResolvedValue(variants) },
    facilities: { findMany: jest.fn().mockResolvedValue([]) },
    manufacturers: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const prisma = { withPurchaseOrder: jest.fn((_actor: unknown, run: Run) => run(tx)) };
  return { tx, prisma, service: new PurchaseOrderService(prisma as unknown as PrismaService) };
}

async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try { await promise; } catch (error) { return error instanceof AppException ? error.code : 'OTHER'; }
  return undefined;
}

const manager = { id: 4, role: 'WAREHOUSE_MANAGER', type: 'employee', facilityId: 7 };
const admin = { id: 1, role: 'SUPER_ADMIN', type: 'employee' };
const staff = { id: 5, role: 'WAREHOUSE_STAFF', type: 'employee', facilityId: 7 };
const pharmacist = { id: 6, role: 'PHARMACIST', type: 'employee', facilityId: 7 };

const order: PurchaseOrderDto = {
  supplierManufacturerId: 3, note: '  Quarterly restock ', expectedAt: '2026-12-01',
  lines: [{ variantId: 1, quantity: 10, unitPrice: 1000.5 }, { variantId: 2, quantity: 3, unitPrice: 20 }],
};

describe('PurchaseOrderService.create', () => {
  it('creates a PENDING order at the manager warehouse and computes the total on the server', async () => {
    const { tx, service } = setup();
    await service.create(manager, { ...order, lines: order.lines.map(line => ({ ...line })) });
    const { data } = tx.purchase_orders.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).toMatchObject({
      facility_id: 7, supplier_id: null, supplier_manufacturer_id: 3, created_by_employee_id: 4, note: 'Quarterly restock',
      purchase_order_items: { create: [
        { variant_id: 1, medicine_id: 10, quantity: 10, unit_price: 1000.5 },
        { variant_id: 2, medicine_id: 20, quantity: 3, unit_price: 20 },
      ] },
    });
    expect(data.po_code).toMatch(/^PO-\d{8}-[0-9A-F]{6}$/);
    expect((data.total_amount as Prisma.Decimal).toString()).toBe('10065');
    expect(tx.purchase_order_events.create).toHaveBeenCalledWith({
      data: { po_id: 5, action: 'CREATED', from_status: null, to_status: 'PENDING', actor_id: 4, note: undefined },
    });
  });

  it('ignores a total sent by the client', async () => {
    const { tx, service } = setup();
    await service.create(manager, { ...order, totalAmount: 1 } as PurchaseOrderDto);
    const { data } = tx.purchase_orders.create.mock.calls[0][0] as { data: { total_amount: Prisma.Decimal } };
    expect(data.total_amount.toString()).toBe('10065');
  });

  it('requires SUPER_ADMIN to choose the warehouse', async () => {
    const { prisma, service } = setup();
    expect(await errorCode(service.create(admin, order))).toBe('PO_FACILITY_REQUIRED');
    expect(prisma.withPurchaseOrder).not.toHaveBeenCalled();
    await service.create(admin, { ...order, facilityId: 8 });
    expect(prisma.withPurchaseOrder).toHaveBeenCalled();
  });

  it('rejects another warehouse for a manager', async () => {
    const { prisma, service } = setup();
    expect(await errorCode(service.create(manager, { ...order, facilityId: 8 }))).toBe('WAREHOUSE_FACILITY_FORBIDDEN');
    expect(prisma.withPurchaseOrder).not.toHaveBeenCalled();
  });

  it('rejects warehouse staff', async () => {
    const { service } = setup();
    expect(await errorCode(service.create(staff, order))).toBe('WAREHOUSE_ACCOUNT_REQUIRED');
  });

  it.each([
    ['no supplier', { supplierManufacturerId: undefined }],
    ['two suppliers', { supplierFacilityId: 9 }],
  ])('rejects an order with %s', async (_name, change) => {
    const { tx, service } = setup();
    expect(await errorCode(service.create(manager, { ...order, ...change }))).toBe('PO_PARTIES_INVALID');
    expect(tx.purchase_orders.create).not.toHaveBeenCalled();
  });

  it('rejects a supplier or warehouse the database does not accept', async () => {
    const { tx, service } = setup({ partiesValid: false });
    expect(await errorCode(service.create(manager, order))).toBe('PO_PARTIES_INVALID');
    expect(tx.purchase_orders.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate and unknown products', async () => {
    const duplicate = setup();
    const lines = [order.lines[0], { ...order.lines[0] }];
    expect(await errorCode(duplicate.service.create(manager, { ...order, lines }))).toBe('PO_LINES_INVALID');
    const unknown = setup({ variants: [{ id: 1, medicine_id: 10 }] });
    expect(await errorCode(unknown.service.create(manager, order))).toBe('PO_LINES_INVALID');
    expect(unknown.tx.purchase_orders.create).not.toHaveBeenCalled();
  });
});

describe('PurchaseOrderService.update', () => {
  it('replaces the lines of a PENDING order and records the edit', async () => {
    const { tx, service } = setup();
    await service.update(manager, 5, order);
    expect(tx.purchase_order_items.deleteMany).toHaveBeenCalledWith({ where: { po_id: 5 } });
    expect(tx.purchase_orders.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({ supplier_manufacturer_id: 3, purchase_order_items: { create: expect.any(Array) } }),
    });
    expect(tx.purchase_order_events.create.mock.calls[0][0]).toMatchObject({ data: { action: 'UPDATED', from_status: 'PENDING', to_status: 'PENDING' } });
  });

  it.each(['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'])('refuses to edit a %s order', async status => {
    const { tx, service } = setup({ status });
    expect(await errorCode(service.update(manager, 5, order))).toBe('PO_INVALID_TRANSITION');
    expect(tx.purchase_order_items.deleteMany).not.toHaveBeenCalled();
    expect(tx.purchase_orders.update).not.toHaveBeenCalled();
  });

  it('rejects an unknown or hidden order', async () => {
    const { service } = setup({ status: null });
    expect(await errorCode(service.update(manager, 99, order))).toBe('PO_NOT_FOUND');
  });
});

describe('PurchaseOrderService.approve', () => {
  it('approves a PENDING order and stores who approved it', async () => {
    const { tx, service } = setup();
    await service.approve(manager, 5);
    expect(tx.purchase_orders.update).toHaveBeenCalledWith({
      where: { id: 5 }, data: { status: 'APPROVED', approved_by_id: 4, approved_at: expect.any(Date) },
    });
    expect(tx.purchase_order_events.create.mock.calls[0][0]).toMatchObject({ data: { action: 'APPROVED', from_status: 'PENDING', to_status: 'APPROVED', actor_id: 4 } });
  });

  it.each(['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'])('refuses to approve a %s order', async status => {
    const { tx, service } = setup({ status });
    expect(await errorCode(service.approve(manager, 5))).toBe('PO_INVALID_TRANSITION');
    expect(tx.purchase_orders.update).not.toHaveBeenCalled();
    expect(tx.purchase_order_events.create).not.toHaveBeenCalled();
  });
});

describe('PurchaseOrderService.cancel', () => {
  it.each(['PENDING', 'APPROVED'])('cancels a %s order with a trimmed reason', async status => {
    const { tx, service } = setup({ status });
    await service.cancel(manager, 5, '  Supplier closed ');
    expect(tx.purchase_orders.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { status: 'CANCELLED', cancel_reason: 'Supplier closed' } });
    expect(tx.purchase_order_events.create.mock.calls[0][0]).toMatchObject({
      data: { action: 'CANCELLED', from_status: status, to_status: 'CANCELLED', note: 'Supplier closed' },
    });
  });

  it.each(['PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'])('refuses to cancel a %s order', async status => {
    const { tx, service } = setup({ status });
    expect(await errorCode(service.cancel(manager, 5, 'Too late'))).toBe('PO_INVALID_TRANSITION');
    expect(tx.purchase_orders.update).not.toHaveBeenCalled();
  });
});

describe('PurchaseOrderService.close', () => {
  it('closes a partially received order with a trimmed reason and records it', async () => {
    const { tx, service } = setup({ status: 'PARTIALLY_RECEIVED' });
    await service.close(manager, 5, '  Supplier ran out ');
    expect(tx.purchase_orders.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { status: 'CLOSED', closed_reason: 'Supplier ran out' } });
    expect(tx.purchase_order_events.create).toHaveBeenCalledWith({
      data: { po_id: 5, action: 'CLOSED', from_status: 'PARTIALLY_RECEIVED', to_status: 'CLOSED', actor_id: 4, note: 'Supplier ran out' },
    });
  });

  it.each(['PENDING', 'APPROVED', 'RECEIVED', 'CLOSED', 'CANCELLED'])('refuses to close a %s order', async status => {
    const { tx, service } = setup({ status });
    expect(await errorCode(service.close(manager, 5, 'Short delivery'))).toBe('PO_INVALID_TRANSITION');
    expect(tx.purchase_orders.update).not.toHaveBeenCalled();
  });
});

describe('PurchaseOrderService reads', () => {
  it('lists the own warehouse for staff and filters by status', async () => {
    const { tx, service } = setup();
    await service.list(staff, { status: 'APPROVED', page: 2, limit: 10 });
    expect(tx.purchase_orders.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { facility_id: 7, status: 'APPROVED' }, skip: 10, take: 10 }));
  });

  it('lets SUPER_ADMIN list every warehouse or pick one', async () => {
    const { tx, service } = setup();
    await service.list(admin, {});
    expect(tx.purchase_orders.count).toHaveBeenLastCalledWith({ where: {} });
    await service.list(admin, { facilityId: 8 });
    expect(tx.purchase_orders.count).toHaveBeenLastCalledWith({ where: { facility_id: 8 } });
  });

  it('rejects another warehouse and non-warehouse roles', async () => {
    const { service } = setup();
    expect(await errorCode(service.list(staff, { facilityId: 8 }))).toBe('WAREHOUSE_FACILITY_FORBIDDEN');
    expect(await errorCode(service.list(pharmacist, {}))).toBe('WAREHOUSE_ACCOUNT_REQUIRED');
  });

  it('offers warehouses, factories, manufacturers and products to staff', async () => {
    const { tx, service } = setup();
    tx.facilities.findMany.mockResolvedValueOnce([{ id: 7 }]).mockResolvedValueOnce([{ id: 9 }]);
    tx.manufacturers.findMany.mockResolvedValue([{ id: 3 }]);
    tx.packaging_variants.findMany.mockResolvedValue([{ id: 1 }]);
    await expect(service.options(staff, 'para')).resolves.toEqual({
      warehouses: [{ id: 7 }], manufacturers: [{ id: 3 }], factories: [{ id: 9 }], variants: [{ id: 1 }],
    });
    expect(tx.packaging_variants.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { medicine: { medicine_name: { contains: 'para', mode: 'insensitive' } } }, take: 20,
    }));
  });

  it('reports a missing order', async () => {
    const { tx, service } = setup();
    tx.purchase_orders.findFirst.mockResolvedValue(null);
    expect(await errorCode(service.detail(staff, 99))).toBe('PO_NOT_FOUND');
  });
});
