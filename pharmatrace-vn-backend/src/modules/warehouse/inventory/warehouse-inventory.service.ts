import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { authActor } from '../../../common/auth-identity';
import { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { AVAILABLE_BOX_STATUSES } from '../../../common/inventory/box.helper';
import { WH_ALL, WH_READ, isWarehouseRole, warehouseScope } from '../../../common/warehouse-roles';
import { PrismaService } from '../../../prisma/prisma.service';
import { availableStock } from '../../order/helpers/order.helper';
import { warehouseError } from '../warehouse-errors';
import {
  WarehouseBatchQueryDto, WarehouseFacilityQueryDto, WarehouseInventoryLogQueryDto, WarehouseInventoryQueryDto,
} from './dto/warehouse-inventory-query.dto';

type Tx = Prisma.TransactionClient;

const inventorySelect = {
  facility_id: true, variant_id: true, stock_quantity: true, reserved_quantity: true, updated_at: true,
  packaging_variants: { select: { unit_name: true, medicine: { select: { id: true, medicine_name: true } } } },
} satisfies Prisma.inventoriesSelect;

const batchSelect = {
  id: true, batch_number: true, production_date: true, expiry_date: true, status: true,
  medicines: { select: { id: true, medicine_name: true } },
} satisfies Prisma.batchesSelect;

type InventoryRow = Prisma.inventoriesGetPayload<{ select: typeof inventorySelect }>;
type BatchRow = Prisma.batchesGetPayload<{ select: typeof batchSelect }>;

export interface InventoryItem {
  facilityId: number | null;
  variantId: number | null;
  medicineId: number | null;
  medicineName: string;
  unitName: string;
  stock: number;
  reserved: number;
  available: number;
  quarantine: number;
  updatedAt: Date | null;
}

export interface BatchItem {
  id: number;
  batchNumber: string;
  medicineId: number | null;
  medicineName: string;
  productionDate: Date;
  expiryDate: Date;
  status: string | null;
  boxesInStock: number;
}

export interface Pagination { total: number; page: number; limit: number; totalPages: number }
export interface Page<T> { items: T[]; pagination: Pagination }

export function pagination(total: number, page: number, limit: number): Pagination {
  return { total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
}

function toInventoryItem(row: InventoryRow, quarantine: Map<string, number>): InventoryItem {
  return {
    facilityId: row.facility_id,
    variantId: row.variant_id,
    medicineId: row.packaging_variants?.medicine.id ?? null,
    medicineName: row.packaging_variants?.medicine.medicine_name ?? '',
    unitName: row.packaging_variants?.unit_name ?? '',
    stock: row.stock_quantity,
    reserved: row.reserved_quantity ?? 0,
    available: availableStock(row),
    quarantine: quarantine.get(`${row.facility_id}:${row.variant_id}`) ?? 0,
    updatedAt: row.updated_at,
  };
}

function toBatchItem(row: BatchRow, boxesInStock: number): BatchItem {
  return {
    id: row.id,
    batchNumber: row.batch_number,
    medicineId: row.medicines?.id ?? null,
    medicineName: row.medicines?.medicine_name ?? '',
    productionDate: row.production_date,
    expiryDate: row.expiry_date,
    status: row.status,
    boxesInStock,
  };
}

/** Boxes at the given warehouse (any warehouse when none is set), whatever their status. */
function boxesAtWhere(facilityId: number | null): Prisma.medicine_boxesWhereInput {
  return facilityId === null ? { current_facility_id: { not: null } } : { current_facility_id: facilityId };
}

/** Boxes at the warehouse that can still be picked (not reserved, in transit or sold). */
function boxesInStockWhere(facilityId: number | null): Prisma.medicine_boxesWhereInput {
  return { status: { in: AVAILABLE_BOX_STATUSES }, ...boxesAtWhere(facilityId) };
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

async function quarantineByKey(tx: Tx, variantIds: number[]): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();
  const rows = await tx.$queryRaw<{ facility_id: number; variant_id: number; quantity: number }[]>`
    SELECT facility_id, variant_id, quantity FROM public.quarantine_balances WHERE variant_id = ANY(${variantIds}::integer[])`;
  return new Map(rows.map(r => [`${r.facility_id}:${r.variant_id}`, r.quantity]));
}

@Injectable()
export class WarehouseInventoryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Stock per variant with the same available figure checkout uses. */
  async inventory(user: CurrentUserPayload, query: WarehouseInventoryQueryDto): Promise<Page<InventoryItem>> {
    const facilityId = warehouseScope(user, query, WH_READ);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.inventoriesWhereInput = {
      ...(facilityId === null ? {} : { facility_id: facilityId }),
      ...(query.variantId ? { variant_id: query.variantId } : {}),
      ...(query.search ? { packaging_variants: { medicine: { medicine_name: { contains: query.search, mode: 'insensitive' } } } } : {}),
    };
    return this.prisma.withWarehouseRead(authActor(user), async tx => {
      const [total, rows] = await Promise.all([
        tx.inventories.count({ where }),
        tx.inventories.findMany({ where, select: inventorySelect, orderBy: [{ variant_id: 'asc' }, { facility_id: 'asc' }], skip: (page - 1) * limit, take: limit }),
      ]);
      const quarantine = await quarantineByKey(tx, rows.flatMap(r => (r.variant_id === null ? [] : [r.variant_id])));
      return { items: rows.map(r => toInventoryItem(r, quarantine)), pagination: pagination(total, page, limit) };
    });
  }

  /** One variant's stock and its in-stock boxes per batch, earliest expiry first. */
  async inventoryDetail(user: CurrentUserPayload, variantId: number, query: WarehouseFacilityQueryDto) {
    const facilityId = warehouseScope(user, query, WH_READ);
    return this.prisma.withWarehouseRead(authActor(user), async tx => {
      const rows = await tx.inventories.findMany({
        where: { variant_id: variantId, ...(facilityId === null ? {} : { facility_id: facilityId }) },
        select: inventorySelect, orderBy: { facility_id: 'asc' },
      });
      const medicineId = rows[0]?.packaging_variants?.medicine.id;
      if (medicineId === undefined) throw warehouseError('WAREHOUSE_INVENTORY_NOT_FOUND');
      const quarantine = await quarantineByKey(tx, [variantId]);
      const counts = await tx.medicine_boxes.groupBy({
        by: ['batch_id'], where: { ...boxesInStockWhere(facilityId), medicine_batches: { medicine_id: medicineId } }, _count: { _all: true },
      });
      const boxes = new Map(counts.map(c => [c.batch_id, c._count._all]));
      const batches = await tx.batches.findMany({
        where: { id: { in: [...boxes.keys()].filter((id): id is number => id !== null) } }, select: batchSelect, orderBy: { expiry_date: 'asc' },
      });
      return { stock: rows.map(r => toInventoryItem(r, quarantine)), batches: batches.map(b => toBatchItem(b, boxes.get(b.id) ?? 0)) };
    });
  }

  async logs(user: CurrentUserPayload, query: WarehouseInventoryLogQueryDto) {
    const facilityId = warehouseScope(user, query, WH_READ);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const to = query.to ? new Date(query.to) : undefined;
    to?.setUTCDate(to.getUTCDate() + 1);
    const where: Prisma.inventory_logsWhereInput = {
      ...(facilityId === null ? {} : { facility_id: facilityId }),
      ...(query.type ? { transaction_type: query.type } : {}),
      ...(query.variantId ? { variant_id: query.variantId } : {}),
      ...(query.referenceCode ? { reference_code: { contains: query.referenceCode, mode: 'insensitive' } } : {}),
      ...(query.from || to ? { created_at: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(to ? { lt: to } : {}) } } : {}),
    };
    return this.prisma.withWarehouseRead(authActor(user), async tx => {
      const [total, rows] = await Promise.all([
        tx.inventory_logs.count({ where }),
        tx.inventory_logs.findMany({
          where, orderBy: [{ created_at: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit,
          include: { medicines: { select: { medicine_name: true } } },
        }),
      ]);
      const items = rows.map(r => ({
        id: r.id, facilityId: r.facility_id, medicineId: r.medicine_id, medicineName: r.medicines?.medicine_name ?? '',
        variantId: r.variant_id, stockBucket: r.stock_bucket, type: r.transaction_type, quantityChanged: r.quantity_changed,
        previousQuantity: r.previous_quantity, newQuantity: r.new_quantity, referenceCode: r.reference_code, note: r.note,
        performedById: r.performed_by_id, createdAt: r.created_at,
      }));
      return { items, pagination: pagination(total, page, limit) };
    });
  }

  /** Quarantine balances and the latest 100 quarantine movements. */
  async quarantine(user: CurrentUserPayload, query: WarehouseFacilityQueryDto) {
    const facilityId = warehouseScope(user, query, WH_READ);
    return this.prisma.withWarehouseRead(authActor(user), async tx => {
      const balances = await tx.$queryRaw<{ facilityId: number; variantId: number; medicineName: string; unitName: string; quantity: number }[]>`
        SELECT q.facility_id AS "facilityId", q.variant_id AS "variantId", m.medicine_name AS "medicineName",
          v.unit_name AS "unitName", q.quantity
        FROM public.quarantine_balances q
        JOIN public.packaging_variants v ON v.id = q.variant_id JOIN public.medicines m ON m.id = v.medicine_id
        WHERE q.quantity > 0 AND (${facilityId}::integer IS NULL OR q.facility_id = ${facilityId}::integer)
        ORDER BY m.medicine_name, q.facility_id`;
      const movements = await tx.$queryRaw<{
        originType: string; originId: number; variantId: number; action: string; quantityChanged: number;
        referenceCode: string | null; facilityId: number | null; createdAt: Date | null;
      }[]>`
        SELECT qm.origin_type AS "originType", qm.origin_id AS "originId", qm.variant_id AS "variantId", qm.action,
          l.quantity_changed AS "quantityChanged", l.reference_code AS "referenceCode", l.facility_id AS "facilityId", l.created_at AS "createdAt"
        FROM public.quarantine_movements qm JOIN public.inventory_logs l ON l.id = qm.inventory_log_id
        WHERE ${facilityId}::integer IS NULL OR l.facility_id = ${facilityId}::integer
        ORDER BY l.created_at DESC, l.id DESC LIMIT 100`;
      return { balances, movements };
    });
  }

  /** Batches with boxes at the warehouse; `days` keeps only those expiring within that many days. */
  async batches(user: CurrentUserPayload, query: WarehouseBatchQueryDto): Promise<Page<BatchItem>> {
    const facilityId = warehouseScope(user, query, WH_READ);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const boxWhere = boxesInStockWhere(facilityId);
    const where: Prisma.batchesWhereInput = {
      medicine_boxes: { some: boxesAtWhere(facilityId) },
      ...(query.days ? { expiry_date: { lte: daysFromNow(query.days) } } : {}),
      ...(query.search ? { OR: [
        { batch_number: { contains: query.search, mode: 'insensitive' } },
        { medicines: { medicine_name: { contains: query.search, mode: 'insensitive' } } },
      ] } : {}),
    };
    return this.prisma.withWarehouseRead(authActor(user), async tx => {
      const [total, rows] = await Promise.all([
        tx.batches.count({ where }),
        tx.batches.findMany({
          where, select: { ...batchSelect, _count: { select: { medicine_boxes: { where: boxWhere } } } },
          orderBy: [{ expiry_date: 'asc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit,
        }),
      ]);
      return { items: rows.map(r => toBatchItem(r, r._count.medicine_boxes)), pagination: pagination(total, page, limit) };
    });
  }

  /** One batch with its box counts by status at the warehouse. */
  async batch(user: CurrentUserPayload, id: number, query: WarehouseFacilityQueryDto) {
    const facilityId = warehouseScope(user, query, WH_READ);
    return this.prisma.withWarehouseRead(authActor(user), async tx => {
      const [row, counts] = await Promise.all([
        tx.batches.findUnique({ where: { id }, select: { ...batchSelect, initial_quantity: true, remaining_quantity: true, certificate_co_cq: true, hold_reason: true, held_at: true } }),
        tx.medicine_boxes.groupBy({
          by: ['status'], where: { batch_id: id, ...boxesAtWhere(facilityId) }, _count: { _all: true },
        }),
      ]);
      if (!row || (facilityId !== null && counts.length === 0)) throw warehouseError('WAREHOUSE_BATCH_NOT_FOUND');
      const boxes = counts.map(c => ({ status: c.status, count: c._count._all }));
      const inStock = boxes.filter(b => AVAILABLE_BOX_STATUSES.includes(b.status ?? '')).reduce((sum, b) => sum + b.count, 0);
      return {
        ...toBatchItem(row, inStock),
        initialQuantity: row.initial_quantity, remainingQuantity: row.remaining_quantity, certificate: row.certificate_co_cq, boxes,
        holdReason: row.hold_reason, heldAt: row.held_at,
      };
    });
  }

  /**
   * Overview counts. Transfers awaiting dispatch and orders awaiting packing are only for warehouses that
   * fulfil orders, so they are null for factory staff.
   */
  async dashboard(user: CurrentUserPayload, query: WarehouseFacilityQueryDto) {
    const facilityId = warehouseScope(user, query, WH_READ);
    const actor = authActor(user);
    const scoped = facilityId === null ? {} : { facility_id: facilityId };
    const stock = await this.prisma.withWarehouseRead(actor, async tx => {
      const [rows, [quarantine], expiringBatches] = await Promise.all([
        tx.inventories.findMany({ where: scoped, select: { stock_quantity: true, reserved_quantity: true } }),
        tx.$queryRaw<{ units: number }[]>`
          SELECT coalesce(sum(quantity), 0)::integer AS units FROM public.quarantine_balances
          WHERE ${facilityId}::integer IS NULL OR facility_id = ${facilityId}::integer`,
        tx.batches.count({ where: { medicine_boxes: { some: boxesAtWhere(facilityId) }, expiry_date: { lte: daysFromNow(30) } } }),
      ]);
      return {
        stockUnits: rows.reduce((sum, r) => sum + r.stock_quantity, 0),
        availableUnits: rows.reduce((sum, r) => sum + availableStock(r), 0),
        quarantineUnits: quarantine?.units ?? 0,
        expiringBatches,
      };
    });
    if (!isWarehouseRole(user.role, WH_ALL)) return { ...stock, pendingTransfers: null, ordersToPack: null };
    const [pendingTransfers, ordersToPack] = await Promise.all([
      this.prisma.withOrder('transfer_read', tx => tx.internal_transfers.count({
        where: { status: 'REQUESTED', ...(facilityId === null ? {} : { from_facility_id: facilityId }) },
      }), actor),
      this.prisma.withOrder('read', tx => tx.orders.count({
        where: { order_status: { in: ['PENDING', 'PROCESSING'] }, shipments: { is: null }, ...(facilityId === null ? {} : { export_facility_id: facilityId }) },
      }), actor),
    ]);
    return { ...stock, pendingTransfers, ordersToPack };
  }
}
