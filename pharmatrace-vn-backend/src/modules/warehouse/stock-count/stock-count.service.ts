import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { authActor } from '../../../common/auth-identity';
import { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { WH_MANAGER, warehouseScope } from '../../../common/warehouse-roles';
import { PrismaService } from '../../../prisma/prisma.service';
import { Page, pagination } from '../inventory/warehouse-inventory.service';
import { warehouseDatabase, warehouseError } from '../warehouse-errors';
import {
  OpenStockCountDto, SaveStockCountLinesDto, StockAdjustmentDto, StockCountQueryDto,
} from './dto/stock-count.dto';

type Tx = Prisma.TransactionClient;

export interface StockCountSummary {
  id: number;
  countCode: string;
  facilityId: number;
  scope: string;
  medicineId: number | null;
  batchId: number | null;
  status: string;
  createdById: number;
  createdAt: Date;
}

export interface StockCountListItem extends StockCountSummary { lineCount: number }

export interface StockCountLine {
  batchId: number;
  batchNumber: string;
  medicineName: string;
  variantId: number;
  systemQuantity: number;
  countedQuantity: number | null;
  currentQuantity: number;
  difference: number | null;
  movedSinceOpen: boolean;
}

export interface StockCountEvent {
  action: string;
  fromStatus: string | null;
  toStatus: string;
  actorId: number;
  note: string | null;
  createdAt: Date;
}

export interface StockCountDetail extends StockCountSummary {
  lines: StockCountLine[];
  events: StockCountEvent[];
}

const SUMMARY = Prisma.sql`c.id, c.count_code AS "countCode", c.facility_id AS "facilityId", c.scope, c.medicine_id AS "medicineId",
  c.batch_id AS "batchId", c.status, c.created_by_id AS "createdById", c.created_at AS "createdAt"`;

@Injectable()
export class StockCountService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: CurrentUserPayload, query: StockCountQueryDto): Promise<Page<StockCountListItem>> {
    const facilityId = warehouseScope(user, query);
    const status = query.status ?? null;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return this.prisma.withStockCount(authActor(user), async tx => {
      const [[total], items] = await Promise.all([
        tx.$queryRaw<{ total: number }[]>`
          SELECT count(*)::integer AS total FROM public.stock_counts c
          WHERE (${facilityId}::integer IS NULL OR c.facility_id = ${facilityId}::integer) AND (${status}::text IS NULL OR c.status = ${status}::text)`,
        tx.$queryRaw<StockCountListItem[]>`
          SELECT ${SUMMARY}, (SELECT count(*)::integer FROM public.stock_count_lines l WHERE l.count_id = c.id) AS "lineCount"
          FROM public.stock_counts c
          WHERE (${facilityId}::integer IS NULL OR c.facility_id = ${facilityId}::integer) AND (${status}::text IS NULL OR c.status = ${status}::text)
          ORDER BY c.id DESC OFFSET ${(page - 1) * limit} LIMIT ${limit}`,
      ]);
      return { items, pagination: pagination(total.total, page, limit) };
    });
  }

  detail(user: CurrentUserPayload, id: number): Promise<StockCountDetail> {
    return this.prisma.withStockCount(authActor(user), tx => this.load(tx, id));
  }

  async open(user: CurrentUserPayload, dto: OpenStockCountDto): Promise<StockCountDetail> {
    const facilityId = this.manager(user, dto);
    return warehouseDatabase(this.prisma.withStockCount(authActor(user), async tx => {
      const [row] = await tx.$queryRaw<{ id: number }[]>`
        SELECT public.open_stock_count(${dto.countCode}::text, ${facilityId}::integer, ${dto.medicineId ?? null}::integer, ${dto.batchId ?? null}::integer) AS id`;
      return this.load(tx, row.id);
    }));
  }

  saveLines(user: CurrentUserPayload, id: number, dto: SaveStockCountLinesDto): Promise<StockCountDetail> {
    const batchIds = dto.lines.map(line => line.batchId);
    const quantities = dto.lines.map(line => line.countedQuantity);
    return this.change(user, id, tx => tx.$executeRaw`
      SELECT public.save_stock_count_lines(${id}::integer, ${batchIds}::integer[], ${quantities}::integer[])`);
  }

  submit(user: CurrentUserPayload, id: number): Promise<StockCountDetail> {
    return this.change(user, id, tx => tx.$executeRaw`SELECT public.submit_stock_count(${id}::integer)`);
  }

  cancel(user: CurrentUserPayload, id: number, reason: string): Promise<StockCountDetail> {
    return this.change(user, id, tx => tx.$executeRaw`SELECT public.cancel_stock_count(${id}::integer, ${reason.trim()}::text)`);
  }

  /** Lines whose `movedSinceOpen` is true had stock movements while the count was open; the difference is booked against today's units. */
  approve(user: CurrentUserPayload, id: number): Promise<StockCountDetail> {
    return this.change(user, id, tx => tx.$executeRaw`SELECT public.approve_stock_count(${id}::integer)`);
  }

  async adjust(user: CurrentUserPayload, dto: StockAdjustmentDto): Promise<{ logId: number }> {
    const facilityId = this.manager(user, dto);
    return warehouseDatabase(this.prisma.withStockCount(authActor(user), async tx => {
      const [row] = await tx.$queryRaw<{ id: number }[]>`
        SELECT public.record_stock_adjustment(${facilityId}::integer, ${dto.adjustmentCode}::text, ${dto.batchId}::integer,
          ${dto.quantityChange}::integer, ${dto.reason.trim()}::text) AS id`;
      return { logId: row.id };
    }));
  }

  private manager(user: CurrentUserPayload, dto: { facilityId?: number }): number {
    const facilityId = warehouseScope(user, dto, WH_MANAGER);
    if (facilityId === null) throw warehouseError('SC_FACILITY_REQUIRED');
    return facilityId;
  }

  private change(user: CurrentUserPayload, id: number, run: (tx: Tx) => Promise<unknown>): Promise<StockCountDetail> {
    return warehouseDatabase(this.prisma.withStockCount(authActor(user), async tx => {
      await run(tx);
      return this.load(tx, id);
    }));
  }

  private async load(tx: Tx, id: number): Promise<StockCountDetail> {
    const [count] = await tx.$queryRaw<StockCountSummary[]>`SELECT ${SUMMARY} FROM public.stock_counts c WHERE c.id = ${id}`;
    if (!count) throw warehouseError('SC_NOT_FOUND');
    const [lines, events] = await Promise.all([
      tx.$queryRaw<Omit<StockCountLine, 'movedSinceOpen'>[]>`
        SELECT l.batch_id AS "batchId", b.batch_number AS "batchNumber", m.medicine_name AS "medicineName", l.variant_id AS "variantId",
          l.system_quantity AS "systemQuantity", l.counted_quantity AS "countedQuantity", l.difference,
          coalesce(l.current_quantity, public.stock_count_on_hand(${count.facilityId}::integer, l.batch_id)) AS "currentQuantity"
        FROM public.stock_count_lines l JOIN public.batches b ON b.id = l.batch_id LEFT JOIN public.medicines m ON m.id = b.medicine_id
        WHERE l.count_id = ${id} ORDER BY l.batch_id`,
      tx.$queryRaw<StockCountEvent[]>`
        SELECT action, from_status AS "fromStatus", to_status AS "toStatus", actor_id AS "actorId", note, created_at AS "createdAt"
        FROM public.stock_count_events WHERE count_id = ${id} ORDER BY id`,
    ]);
    return { ...count, lines: lines.map(line => ({ ...line, movedSinceOpen: line.currentQuantity !== line.systemQuantity })), events };
  }
}
