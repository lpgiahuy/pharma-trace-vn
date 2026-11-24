import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { authActor } from '../../../common/auth-identity';
import { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { AVAILABLE_BOX_STATUSES, findUnsellableUids, isBoxUnit } from '../../../common/inventory/box.helper';
import { warehouseScope } from '../../../common/warehouse-roles';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminOrderService } from '../../order/admin-order.service';
import { WarehouseFacilityQueryDto } from '../inventory/dto/warehouse-inventory-query.dto';
import { warehouseError } from '../warehouse-errors';
import { CompletePackingDto, CreatePackageDto, VoidPackageDto } from './dto/fulfillment.dto';

const ACTIVE_PACKAGE_ITEM = { voided_at: null, order_packages: { status: 'PACKED' } } satisfies Prisma.order_package_itemsWhereInput;
const PACKAGE_INCLUDE = { order_package_items: { select: { box_uid: true } } } satisfies Prisma.order_packagesInclude;

export interface QueueOrder {
  id: number;
  orderCode: string;
  orderStatus: string | null;
  recipientName: string | null;
  createdAt: Date | null;
  requiredBoxes: number;
  packedBoxes: number;
  packageCount: number;
}

export interface PickSuggestion {
  uid: string;
  batchNumber: string;
  expiryDate: Date;
}

export interface PickLine {
  orderItemId: number;
  medicineName: string | null;
  quantity: number;
  packedQuantity: number;
  suggestions: PickSuggestion[];
}

export interface PackageSummary {
  id: number;
  packageCode: string;
  orderId: number;
  status: string;
  boxUids: string[];
}

export interface PackageLabel {
  packageCode: string;
  status: string;
  orderCode: string;
  facilityName: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  shippingAddress: string | null;
  boxCount: number;
  weightG: number | null;
  dimensions: string | null;
  packedAt: Date;
  trackingNumber: string | null;
  courierName: string | null;
  codAmount: number | null;
}

function toSummary(pkg: Prisma.order_packagesGetPayload<{ include: typeof PACKAGE_INCLUDE }>): PackageSummary {
  return {
    id: pkg.id,
    packageCode: pkg.package_code,
    orderId: pkg.order_id,
    status: pkg.status,
    boxUids: pkg.order_package_items.map(item => item.box_uid),
  };
}

@Injectable()
export class FulfillmentService {
  constructor(private readonly prisma: PrismaService, private readonly orders: AdminOrderService) {}

  async queue(user: CurrentUserPayload, query: WarehouseFacilityQueryDto): Promise<QueueOrder[]> {
    const facilityId = warehouseScope(user, query);
    const rows = await this.prisma.withOrder('read', tx => tx.orders.findMany({
      where: {
        ...(facilityId === null ? {} : { export_facility_id: facilityId }),
        order_status: { in: ['PENDING', 'PROCESSING'] },
        shipments: { is: null },
        AND: [
          { OR: [{ prescription_review_status: null }, { prescription_review_status: 'APPROVED' }] },
          { OR: [{ payment_method: null }, { payment_method: { notIn: ['BANK_TRANSFER', 'E_WALLET'] } }, { payment_status: 'PAID' }] },
        ],
      },
      select: {
        id: true, order_code: true, order_status: true, recipient_name: true, created_at: true,
        order_items: { select: { quantity: true, unit_name: true } },
        order_packages: { where: { status: 'PACKED' }, select: { _count: { select: { order_package_items: true } } } },
      },
      orderBy: { created_at: 'asc' },
      take: 200,
    }), authActor(user));
    return rows.map(order => ({
      id: order.id,
      orderCode: order.order_code,
      orderStatus: order.order_status,
      recipientName: order.recipient_name,
      createdAt: order.created_at,
      requiredBoxes: order.order_items.filter(item => isBoxUnit(item.unit_name)).reduce((sum, item) => sum + item.quantity, 0),
      packedBoxes: order.order_packages.reduce((sum, pkg) => sum + pkg._count.order_package_items, 0),
      packageCount: order.order_packages.length,
    }));
  }

  /** Boxes to pick for each unpacked line: this order's reserved boxes first, then other sellable boxes by FEFO. */
  async pickList(user: CurrentUserPayload, orderId: number): Promise<PickLine[]> {
    const facilityId = warehouseScope(user);
    return this.prisma.withOrder('read', async tx => {
      const order = await tx.orders.findFirst({
        where: { id: orderId, ...(facilityId === null ? {} : { export_facility_id: facilityId }) },
        select: {
          export_facility_id: true,
          order_items: {
            select: {
              id: true, medicine_id: true, medicine_name: true, unit_name: true, quantity: true, assigned_uids: true,
              order_package_items: { where: ACTIVE_PACKAGE_ITEM, select: { id: true } },
            },
            orderBy: { id: 'asc' },
          },
        },
      });
      if (!order) throw warehouseError('PK_ORDER_NOT_FOUND');

      const lines: PickLine[] = [];
      for (const item of order.order_items.filter(line => isBoxUnit(line.unit_name))) {
        const missing = item.quantity - item.order_package_items.length;
        const suggestions = missing <= 0 ? [] : await tx.$queryRaw<PickSuggestion[]>`
          SELECT b.uid::text AS uid, batch.batch_number AS "batchNumber", batch.expiry_date AS "expiryDate"
          FROM public.medicine_boxes b JOIN public.batches batch ON batch.id = b.batch_id
          WHERE b.current_facility_id = ${order.export_facility_id} AND batch.medicine_id = ${item.medicine_id}
            AND (b.status = ANY(${AVAILABLE_BOX_STATUSES}::text[])
              OR (b.status = 'RESERVED' AND b.uid::text = ANY(${item.assigned_uids}::text[])))
            AND NOT EXISTS (SELECT FROM public.order_package_items i WHERE i.box_uid = b.uid AND i.voided_at IS NULL)
            AND public.box_sellable(b.uid, current_date)
          ORDER BY b.status = 'RESERVED' DESC, batch.expiry_date, b.created_at
          LIMIT ${missing}`;
        lines.push({
          orderItemId: item.id,
          medicineName: item.medicine_name,
          quantity: item.quantity,
          packedQuantity: item.order_package_items.length,
          suggestions,
        });
      }
      return lines;
    }, authActor(user));
  }

  async packages(user: CurrentUserPayload, orderId: number): Promise<PackageSummary[]> {
    const facilityId = warehouseScope(user);
    const rows = await this.prisma.withOrder('read', tx => tx.order_packages.findMany({
      where: { order_id: orderId, status: 'PACKED', ...(facilityId === null ? {} : { facility_id: facilityId }) },
      include: PACKAGE_INCLUDE,
      orderBy: { id: 'asc' },
    }), authActor(user));
    return rows.map(toSummary);
  }

  async addPackage(user: CurrentUserPayload, orderId: number, dto: CreatePackageDto): Promise<PackageSummary> {
    return this.prisma.withOrder('pack', async tx => {
      const order = await this.orders.lockPackableOrder(tx, orderId, user);
      const existing = await tx.order_packages.findUnique({ where: { package_code: dto.packageCode }, include: PACKAGE_INCLUDE });
      if (existing) {
        if (existing.order_id !== orderId) throw warehouseError('PK_CODE_TAKEN');
        return toSummary(existing);
      }

      const boxes = await tx.medicine_boxes.findMany({
        where: { uid: { in: dto.boxUids } },
        select: { uid: true, status: true, current_facility_id: true, medicine_batches: { select: { medicine_id: true } } },
      });
      const boxByUid = new Map(boxes.map(box => [box.uid, box]));
      const reservedUids = new Set(order.order_items.flatMap(item => item.assigned_uids));
      for (const uid of dto.boxUids) {
        const box = boxByUid.get(uid);
        if (box?.current_facility_id !== order.export_facility_id) throw warehouseError('PK_BOX_NOT_AT_WAREHOUSE', { uid });
        const free = AVAILABLE_BOX_STATUSES.includes(box.status ?? '') || (box.status === 'RESERVED' && reservedUids.has(uid));
        if (!free) throw warehouseError('PK_BOX_UNAVAILABLE', { uid });
      }
      const packedElsewhere = await tx.order_package_items.findFirst({ where: { box_uid: { in: dto.boxUids }, voided_at: null }, select: { box_uid: true } });
      if (packedElsewhere) throw warehouseError('PK_BOX_IN_PACKAGE', { uid: packedElsewhere.box_uid });
      const unsellable = await findUnsellableUids(tx, dto.boxUids);
      if (unsellable.length > 0) throw warehouseError('PK_BOX_NOT_SELLABLE', { uids: unsellable });

      const packed = await tx.order_package_items.findMany({
        where: { voided_at: null, order_packages: { order_id: orderId, status: 'PACKED' } },
        select: { order_item_id: true },
      });
      const remaining = new Map(order.order_items.filter(item => isBoxUnit(item.unit_name)).map(item =>
        [item.id, item.quantity - packed.filter(row => row.order_item_id === item.id).length]));
      const items = dto.boxUids.map(uid => {
        const medicineId = boxByUid.get(uid)?.medicine_batches?.medicine_id;
        const lines = order.order_items.filter(item => item.medicine_id === medicineId && remaining.has(item.id));
        if (lines.length === 0) throw warehouseError('PK_BOX_WRONG_PRODUCT', { uid });
        const line = lines.find(item => (remaining.get(item.id) ?? 0) > 0);
        if (!line) throw warehouseError('PK_LINE_FULL', { uid });
        remaining.set(line.id, (remaining.get(line.id) ?? 0) - 1);
        return { order_item_id: line.id, box_uid: uid };
      });

      return toSummary(await tx.order_packages.create({
        data: {
          package_code: dto.packageCode,
          order_id: orderId,
          facility_id: order.export_facility_id,
          packed_by_id: user.id,
          weight_g: dto.weightG,
          dimensions: dto.dimensions?.trim() || null,
          order_package_items: { create: items },
        },
        include: PACKAGE_INCLUDE,
      }));
    }, authActor(user));
  }

  async completePacking(user: CurrentUserPayload, orderId: number, dto: CompletePackingDto): Promise<{ orderId: number; trackingNumber: string }> {
    return this.prisma.withOrder('pack', async tx => {
      const order = await this.orders.lockPackableOrder(tx, orderId, user);
      const items = await tx.order_package_items.findMany({
        where: { voided_at: null, order_packages: { order_id: orderId, status: 'PACKED' } },
        select: { box_uid: true },
      });
      const trackingNumber = await this.orders.packLockedOrder(tx, order, items.map(item => item.box_uid), dto, user);
      return { orderId, trackingNumber };
    }, authActor(user));
  }

  async voidPackage(user: CurrentUserPayload, packageId: number, dto: VoidPackageDto): Promise<PackageSummary> {
    return this.prisma.withOrder('pack', async tx => {
      const pkg = await tx.order_packages.findUnique({ where: { id: packageId }, select: { order_id: true } });
      if (!pkg) throw warehouseError('PK_PACKAGE_NOT_FOUND');
      await tx.$queryRaw`SELECT id FROM public.orders WHERE id = ${pkg.order_id} FOR UPDATE`;
      const order = await tx.orders.findUnique({ where: { id: pkg.order_id }, select: { order_status: true } });
      if (!['PENDING', 'PROCESSING'].includes(order?.order_status ?? '')) throw warehouseError('PK_PACKAGE_NOT_VOIDABLE');

      const now = new Date();
      const voided = await tx.order_packages.updateMany({
        where: { id: packageId, status: 'PACKED' },
        data: { status: 'VOID', void_reason: dto.reason.trim(), voided_by_id: user.id, voided_at: now },
      });
      if (voided.count !== 1) throw warehouseError('PK_PACKAGE_NOT_VOIDABLE');
      await tx.order_package_items.updateMany({ where: { package_id: packageId, voided_at: null }, data: { voided_at: now } });
      return toSummary(await tx.order_packages.findUniqueOrThrow({ where: { id: packageId }, include: PACKAGE_INCLUDE }));
    }, authActor(user));
  }

  async label(user: CurrentUserPayload, packageId: number): Promise<PackageLabel> {
    const pkg = await this.prisma.withOrder('read', tx => tx.order_packages.findUnique({
      where: { id: packageId },
      select: {
        package_code: true, status: true, weight_g: true, dimensions: true, packed_at: true,
        facility: { select: { facility_name: true } },
        orders: {
          select: {
            order_code: true, recipient_name: true, recipient_phone: true, shipping_address: true,
            shipments: { select: { tracking_number: true, courier_name: true, cod_amount: true } },
          },
        },
        _count: { select: { order_package_items: { where: { voided_at: null } } } },
      },
    }), authActor(user));
    if (!pkg) throw warehouseError('PK_PACKAGE_NOT_FOUND');
    const shipment = pkg.orders.shipments;
    return {
      packageCode: pkg.package_code,
      status: pkg.status,
      orderCode: pkg.orders.order_code,
      facilityName: pkg.facility.facility_name,
      recipientName: pkg.orders.recipient_name,
      recipientPhone: pkg.orders.recipient_phone,
      shippingAddress: pkg.orders.shipping_address,
      boxCount: pkg._count.order_package_items,
      weightG: pkg.weight_g,
      dimensions: pkg.dimensions,
      packedAt: pkg.packed_at,
      trackingNumber: shipment?.tracking_number ?? null,
      courierName: shipment?.courier_name ?? null,
      codAmount: shipment ? Number(shipment.cod_amount) : null,
    };
  }
}
