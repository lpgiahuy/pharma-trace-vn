import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { authActor } from '../../../common/auth-identity';
import { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { WH_TRANSFER, warehouseScope } from '../../../common/warehouse-roles';
import { PrismaService } from '../../../prisma/prisma.service';
import { WarehouseFacilityQueryDto } from '../../warehouse/inventory/dto/warehouse-inventory-query.dto';
import { CreateStockTransferRequestDto, SendFactoryTransferDto } from './dto/stock-transfer.dto';
import { stockTransferDatabase } from './stock-transfer-errors';

const FACILITY = { select: { id: true, facility_name: true, facility_type: true } } as const;

const REQUEST_SELECT = {
  id: true, request_code: true, status: true, lines: true, reason: true, requested_by: true,
  decided_by: true, decided_at: true, decision_note: true, created_at: true,
  from_facility: FACILITY, to_facility: FACILITY,
  transfer: { select: { id: true, transfer_code: true, status: true } },
  events: { select: { action: true, from_status: true, to_status: true, actor_id: true, note: true, created_at: true }, orderBy: { id: 'asc' } },
} satisfies Prisma.stock_transfer_requestsSelect;

export type StockTransferRequest = Prisma.stock_transfer_requestsGetPayload<{ select: typeof REQUEST_SELECT }>;

export type StockTransferDecision = 'APPROVE' | 'REJECT' | 'CANCEL';

@Injectable()
export class StockTransferService {
  constructor(private readonly prisma: PrismaService) {}

  list(user: CurrentUserPayload): Promise<StockTransferRequest[]> {
    return this.prisma.withActor(authActor(user), tx => tx.stock_transfer_requests.findMany({
      select: REQUEST_SELECT, orderBy: { created_at: 'desc' }, take: 200,
    }));
  }

  create(user: CurrentUserPayload, dto: CreateStockTransferRequestDto): Promise<StockTransferRequest> {
    return stockTransferDatabase(this.prisma.withActor(authActor(user), async tx => {
      const [row] = await tx.$queryRaw<{ id: number }[]>`SELECT public.create_stock_transfer_request(${dto.requestCode}, ${dto.fromFacilityId}::integer,
        ${user.facilityId ?? null}::integer, ${JSON.stringify(dto.lines)}::jsonb, ${dto.reason ?? null}::text) AS id`;
      return tx.stock_transfer_requests.findUniqueOrThrow({ where: { id: row.id }, select: REQUEST_SELECT });
    }));
  }

  /** Factory staff start a transfer to a warehouse: the request is created and approved in one step (send_factory_transfer). */
  send(user: CurrentUserPayload, dto: SendFactoryTransferDto): Promise<StockTransferRequest> {
    return stockTransferDatabase(this.prisma.withActor(authActor(user), async tx => {
      const [row] = await tx.$queryRaw<{ id: number }[]>`SELECT public.send_factory_transfer(${dto.requestCode}, ${dto.toFacilityId}::integer,
        ${JSON.stringify(dto.lines)}::jsonb, ${dto.reason ?? null}::text) AS id`;
      return tx.stock_transfer_requests.findUniqueOrThrow({ where: { id: row.id }, select: REQUEST_SELECT });
    }));
  }

  /** Products another facility holds and the quantity free to move, for the request form (transfer_source_stock). */
  sourceStock(user: CurrentUserPayload, sourceFacilityId: number): Promise<{ variantId: number; medicineName: string; unitName: string; available: number }[]> {
    return stockTransferDatabase(this.prisma.withActor(authActor(user), tx => tx.$queryRaw`
      SELECT variant_id AS "variantId", medicine_name AS "medicineName", unit_name AS "unitName", available
      FROM public.transfer_source_stock(${sourceFacilityId}::integer)`));
  }

  decide(user: CurrentUserPayload, id: number, decision: StockTransferDecision, note?: string): Promise<StockTransferRequest> {
    return stockTransferDatabase(this.prisma.withActor(authActor(user), async tx => {
      await tx.$queryRaw`SELECT public.decide_stock_transfer_request(${id}::integer, ${decision}::text, ${note ?? null}::text)`;
      return tx.stock_transfer_requests.findUniqueOrThrow({ where: { id }, select: REQUEST_SELECT });
    }));
  }

  warehouseTransfers(user: CurrentUserPayload, query: WarehouseFacilityQueryDto) {
    const facilityId = warehouseScope(user, query, WH_TRANSFER);
    return this.prisma.withOrder('transfer_read', tx => tx.internal_transfers.findMany({
      where: facilityId === null ? {} : { OR: [{ from_facility_id: facilityId }, { to_facility_id: facilityId }] },
      include: { from_facility: FACILITY, to_facility: FACILITY },
      orderBy: { created_at: 'desc' },
      take: 200,
    }), authActor(user));
  }
}
