import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { authActor } from '../../common/auth-identity';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { WH_MANAGER, warehouseScope } from '../../common/warehouse-roles';
import { PrismaService } from '../../prisma/prisma.service';
import { Page, pagination } from '../warehouse/inventory/warehouse-inventory.service';
import { PurchaseOrderDto, PurchaseOrderQueryDto } from './dto/purchase-order.dto';
import { procurementError } from './procurement-errors';

type Tx = Prisma.TransactionClient;

const partiesSelect = {
  facility: { select: { id: true, facility_name: true } },
  supplier: { select: { id: true, facility_name: true } },
  supplier_manufacturer: { select: { id: true, name: true } },
} satisfies Prisma.purchase_ordersSelect;

const listSelect = {
  id: true, po_code: true, status: true, total_amount: true, expected_at: true, created_at: true,
  ...partiesSelect,
  _count: { select: { purchase_order_items: true } },
} satisfies Prisma.purchase_ordersSelect;

const detailSelect = {
  id: true, po_code: true, status: true, total_amount: true, note: true, expected_at: true, received_at: true,
  created_at: true, approved_at: true, cancel_reason: true, closed_reason: true,
  ...partiesSelect,
  employees: { select: { id: true, full_name: true } },
  approved_by: { select: { id: true, full_name: true } },
  purchase_order_items: {
    select: {
      id: true, variant_id: true, quantity: true, received_quantity: true, unit_price: true, total_price: true,
      medicines: { select: { medicine_name: true } }, packaging_variants: { select: { unit_name: true } },
    },
    orderBy: { id: 'asc' },
  },
  purchase_order_events: {
    select: { action: true, from_status: true, to_status: true, note: true, created_at: true, actor: { select: { id: true, full_name: true } } },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.purchase_ordersSelect;

export type PurchaseOrderListItem = Prisma.purchase_ordersGetPayload<{ select: typeof listSelect }>;
export type PurchaseOrderDetail = Prisma.purchase_ordersGetPayload<{ select: typeof detailSelect }>;

export interface PurchaseOrderOptions {
  warehouses: { id: number; facility_name: string }[];
  manufacturers: { id: number; name: string }[];
  factories: { id: number; facility_name: string }[];
  variants: { id: number; unit_name: string; medicine: { medicine_name: string } }[];
}

interface PreparedOrder {
  data: Pick<Prisma.purchase_ordersUncheckedCreateInput, 'supplier_id' | 'supplier_manufacturer_id' | 'expected_at' | 'note' | 'total_amount'>;
  items: Prisma.purchase_order_itemsUncheckedCreateWithoutPurchase_ordersInput[];
}

/** Facility types that can receive goods; po_parties_valid() applies the same rule in the database. */
const WAREHOUSE_TYPES = ['CENTRAL_WAREHOUSE', 'BRANCH_WAREHOUSE'];

function newPoCode(): string {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `PO-${day}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

@Injectable()
export class PurchaseOrderService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: CurrentUserPayload, query: PurchaseOrderQueryDto): Promise<Page<PurchaseOrderListItem>> {
    const facilityId = warehouseScope(user, query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.purchase_ordersWhereInput = {
      ...(facilityId === null ? {} : { facility_id: facilityId }),
      ...(query.status ? { status: query.status } : {}),
    };
    return this.prisma.withPurchaseOrder(authActor(user), async tx => {
      const [total, items] = await Promise.all([
        tx.purchase_orders.count({ where }),
        tx.purchase_orders.findMany({ where, select: listSelect, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
      ]);
      return { items, pagination: pagination(total, page, limit) };
    });
  }

  detail(user: CurrentUserPayload, id: number): Promise<PurchaseOrderDetail> {
    return this.prisma.withPurchaseOrder(authActor(user), tx => this.load(tx, id));
  }

  options(user: CurrentUserPayload, search?: string): Promise<PurchaseOrderOptions> {
    return this.prisma.withPurchaseOrder(authActor(user), async tx => {
      const [warehouses, manufacturers, factories, variants] = await Promise.all([
        tx.facilities.findMany({ where: { facility_type: { in: WAREHOUSE_TYPES } }, select: { id: true, facility_name: true }, orderBy: { facility_name: 'asc' } }),
        tx.manufacturers.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        tx.facilities.findMany({ where: { facility_type: 'FACTORY' }, select: { id: true, facility_name: true }, orderBy: { facility_name: 'asc' } }),
        tx.packaging_variants.findMany({
          where: search ? { medicine: { medicine_name: { contains: search, mode: 'insensitive' } } } : {},
          select: { id: true, unit_name: true, medicine: { select: { medicine_name: true } } },
          orderBy: { id: 'asc' }, take: 20,
        }),
      ]);
      return { warehouses, manufacturers, factories, variants };
    });
  }

  async create(user: CurrentUserPayload, dto: PurchaseOrderDto): Promise<PurchaseOrderDetail> {
    const facilityId = warehouseScope(user, { facilityId: dto.facilityId }, WH_MANAGER);
    if (facilityId === null) throw procurementError('PO_FACILITY_REQUIRED');
    const actor = authActor(user);
    return this.prisma.withPurchaseOrder(actor, async tx => {
      const { data, items } = await this.prepare(tx, facilityId, dto);
      const po = await tx.purchase_orders.create({
        data: { ...data, po_code: newPoCode(), facility_id: facilityId, created_by_employee_id: actor.id, purchase_order_items: { create: items } },
        select: { id: true },
      });
      await this.record(tx, po.id, 'CREATED', null, 'PENDING', actor.id);
      return this.load(tx, po.id);
    });
  }

  /** Only a PENDING order can be edited; supplier, date, note and lines are replaced as a whole. */
  update(user: CurrentUserPayload, id: number, dto: PurchaseOrderDto): Promise<PurchaseOrderDetail> {
    const actor = authActor(user);
    return this.prisma.withPurchaseOrder(actor, async tx => {
      const po = await this.lock(tx, id, ['PENDING']);
      const { data, items } = await this.prepare(tx, po.facility_id, dto);
      await tx.purchase_order_items.deleteMany({ where: { po_id: id } });
      await tx.purchase_orders.update({ where: { id }, data: { ...data, purchase_order_items: { create: items } } });
      await this.record(tx, id, 'UPDATED', 'PENDING', 'PENDING', actor.id);
      return this.load(tx, id);
    });
  }

  approve(user: CurrentUserPayload, id: number): Promise<PurchaseOrderDetail> {
    const actor = authActor(user);
    return this.prisma.withPurchaseOrder(actor, async tx => {
      await this.lock(tx, id, ['PENDING']);
      await tx.purchase_orders.update({ where: { id }, data: { status: 'APPROVED', approved_by_id: actor.id, approved_at: new Date() } });
      await this.record(tx, id, 'APPROVED', 'PENDING', 'APPROVED', actor.id);
      return this.load(tx, id);
    });
  }

  /** PENDING and APPROVED orders have received nothing yet; any later status cannot be cancelled. */
  cancel(user: CurrentUserPayload, id: number, reason: string): Promise<PurchaseOrderDetail> {
    const actor = authActor(user);
    const note = reason.trim();
    return this.prisma.withPurchaseOrder(actor, async tx => {
      const po = await this.lock(tx, id, ['PENDING', 'APPROVED']);
      await tx.purchase_orders.update({ where: { id }, data: { status: 'CANCELLED', cancel_reason: note } });
      await this.record(tx, id, 'CANCELLED', po.status, 'CANCELLED', actor.id, note);
      return this.load(tx, id);
    });
  }

  private async load(tx: Tx, id: number): Promise<PurchaseOrderDetail> {
    const po = await tx.purchase_orders.findFirst({ where: { id }, select: detailSelect });
    if (!po) throw procurementError('PO_NOT_FOUND');
    return po;
  }

  /** Locks the order row and requires one of the given statuses. RLS hides orders of other warehouses. */
  private async lock(tx: Tx, id: number, allowed: string[]): Promise<{ status: string; facility_id: number | null }> {
    const [po] = await tx.$queryRaw<{ status: string; facility_id: number | null }[]>`
      SELECT status, facility_id FROM public.purchase_orders WHERE id = ${id} FOR UPDATE`;
    if (!po) throw procurementError('PO_NOT_FOUND');
    if (!allowed.includes(po.status)) throw procurementError('PO_INVALID_TRANSITION');
    return po;
  }

  /** Checks supplier and products, and computes the total from the lines. */
  private async prepare(tx: Tx, facilityId: number | null, dto: PurchaseOrderDto): Promise<PreparedOrder> {
    const supplierFacilityId = dto.supplierFacilityId ?? null;
    const manufacturerId = dto.supplierManufacturerId ?? null;
    const [parties] = await tx.$queryRaw<{ valid: boolean }[]>`
      SELECT public.po_parties_valid(${facilityId}::integer, ${supplierFacilityId}::integer, ${manufacturerId}::integer) AS valid`;
    if ((supplierFacilityId === null) === (manufacturerId === null) || !parties?.valid) throw procurementError('PO_PARTIES_INVALID');

    const variantIds = dto.lines.map(line => line.variantId);
    const variants = await tx.packaging_variants.findMany({ where: { id: { in: variantIds } }, select: { id: true, medicine_id: true } });
    if (new Set(variantIds).size !== variantIds.length || variants.length !== variantIds.length) throw procurementError('PO_LINES_INVALID');
    const medicineByVariant = new Map(variants.map(variant => [variant.id, variant.medicine_id]));

    const items = dto.lines.map(line => ({
      variant_id: line.variantId, medicine_id: medicineByVariant.get(line.variantId) as number, quantity: line.quantity, unit_price: line.unitPrice,
    }));
    const total = dto.lines.reduce((sum, line) => sum.add(new Prisma.Decimal(line.unitPrice).mul(line.quantity)), new Prisma.Decimal(0));
    return {
      data: {
        supplier_id: supplierFacilityId, supplier_manufacturer_id: manufacturerId, total_amount: total,
        expected_at: dto.expectedAt ? new Date(dto.expectedAt) : null, note: dto.note?.trim() || null,
      },
      items,
    };
  }

  private async record(tx: Tx, poId: number, action: string, from: string | null, to: string, actorId: number, note?: string): Promise<void> {
    await tx.purchase_order_events.create({ data: { po_id: poId, action, from_status: from, to_status: to, actor_id: actorId, note } });
  }
}
