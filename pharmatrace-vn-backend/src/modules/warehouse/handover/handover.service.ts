import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { authActor } from '../../../common/auth-identity';
import { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { warehouseScope } from '../../../common/warehouse-roles';
import { PrismaService } from '../../../prisma/prisma.service';
import { WarehouseFacilityQueryDto } from '../inventory/dto/warehouse-inventory-query.dto';
import { warehouseDatabase, warehouseError } from '../warehouse-errors';
import { CreateHandoverDto } from './dto/handover.dto';

export interface PendingPackage {
  packageCode: string;
  orderCode: string;
  recipientName: string | null;
  boxCount: number;
  carrierConfirmed: boolean;
}

export interface PendingCarrier {
  courierName: string;
  packages: PendingPackage[];
}

export interface HandoverDetail {
  id: number;
  handoverCode: string;
  courierName: string;
  driverName: string | null;
  driverPhone: string | null;
  vehiclePlate: string | null;
  note: string | null;
  handedOverAt: Date;
  handedOverBy: string | null;
  facilityName: string | null;
  packages: { packageCode: string; orderCode: string; recipientName: string | null; boxCount: number }[];
}

const DETAIL_SELECT = {
  id: true, handover_code: true, courier_name: true, driver_name: true, driver_phone: true, vehicle_plate: true,
  note: true, handed_over_at: true,
  facility: { select: { facility_name: true } },
  handed_over_by: { select: { full_name: true } },
  packages: {
    select: {
      package: {
        select: {
          package_code: true,
          orders: { select: { order_code: true, recipient_name: true } },
          _count: { select: { order_package_items: { where: { voided_at: null } } } },
        },
      },
    },
    orderBy: { package_id: 'asc' },
  },
} satisfies Prisma.carrier_handoversSelect;

function toDetail(row: Prisma.carrier_handoversGetPayload<{ select: typeof DETAIL_SELECT }>): HandoverDetail {
  return {
    id: row.id,
    handoverCode: row.handover_code,
    courierName: row.courier_name,
    driverName: row.driver_name,
    driverPhone: row.driver_phone,
    vehiclePlate: row.vehicle_plate,
    note: row.note,
    handedOverAt: row.handed_over_at,
    handedOverBy: row.handed_over_by.full_name,
    facilityName: row.facility.facility_name,
    packages: row.packages.map(({ package: pkg }) => ({
      packageCode: pkg.package_code,
      orderCode: pkg.orders.order_code,
      recipientName: pkg.orders.recipient_name,
      boxCount: pkg._count.order_package_items,
    })),
  };
}

@Injectable()
export class HandoverService {
  constructor(private readonly prisma: PrismaService) {}

  async pending(user: CurrentUserPayload, query: WarehouseFacilityQueryDto): Promise<PendingCarrier[]> {
    const facilityId = warehouseScope(user, query);
    const rows = await this.prisma.withOrder('read', tx => tx.order_packages.findMany({
      where: {
        status: 'PACKED',
        ...(facilityId === null ? {} : { facility_id: facilityId }),
        orders: { order_status: 'PENDING_PICKUP', shipments: { is: { shipping_status: 'PENDING_PICKUP' } } },
      },
      select: {
        package_code: true,
        orders: { select: { order_code: true, recipient_name: true, shipments: { select: { courier_name: true, carrier_confirmed_at: true } } } },
        _count: { select: { order_package_items: { where: { voided_at: null } } } },
      },
      orderBy: { id: 'asc' },
      take: 500,
    }), authActor(user));

    const byCarrier = new Map<string, PendingPackage[]>();
    for (const row of rows) {
      const shipment = row.orders.shipments;
      if (!shipment) continue;
      const list = byCarrier.get(shipment.courier_name) ?? [];
      list.push({
        packageCode: row.package_code,
        orderCode: row.orders.order_code,
        recipientName: row.orders.recipient_name,
        boxCount: row._count.order_package_items,
        carrierConfirmed: shipment.carrier_confirmed_at !== null,
      });
      byCarrier.set(shipment.courier_name, list);
    }
    return [...byCarrier].map(([courierName, packages]) => ({ courierName, packages }));
  }

  async create(user: CurrentUserPayload, dto: CreateHandoverDto): Promise<HandoverDetail> {
    const facilityId = warehouseScope(user, dto);
    if (facilityId === null) throw warehouseError('WAREHOUSE_FACILITY_REQUIRED');
    return warehouseDatabase(this.prisma.withOrder('pack', async tx => {
      const [created] = await tx.$queryRaw<{ id: number }[]>`
        SELECT public.record_carrier_handover(${dto.handoverCode}, ${facilityId}, ${dto.courierName}, ${dto.driverName ?? null},
          ${dto.driverPhone ?? null}, ${dto.vehiclePlate ?? null}, ${dto.note ?? null}, ${dto.packageCodes}::text[]) AS id`;
      return toDetail(await tx.carrier_handovers.findUniqueOrThrow({ where: { id: created.id }, select: DETAIL_SELECT }));
    }, authActor(user)));
  }

  async list(user: CurrentUserPayload, query: WarehouseFacilityQueryDto): Promise<HandoverDetail[]> {
    const facilityId = warehouseScope(user, query);
    const rows = await this.prisma.withOrder('read', tx => tx.carrier_handovers.findMany({
      where: facilityId === null ? {} : { facility_id: facilityId },
      select: DETAIL_SELECT,
      orderBy: { handed_over_at: 'desc' },
      take: 100,
    }), authActor(user));
    return rows.map(toDetail);
  }

  async detail(user: CurrentUserPayload, id: number): Promise<HandoverDetail> {
    const facilityId = warehouseScope(user);
    const row = await this.prisma.withOrder('read', tx => tx.carrier_handovers.findFirst({
      where: { id, ...(facilityId === null ? {} : { facility_id: facilityId }) },
      select: DETAIL_SELECT,
    }), authActor(user));
    if (!row) throw warehouseError('HV_NOT_FOUND');
    return toDetail(row);
  }
}
