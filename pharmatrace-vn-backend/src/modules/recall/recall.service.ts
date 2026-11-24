import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { authActor, normalizeRole } from '../../common/auth-identity';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { WarehouseFacilityQueryDto } from '../warehouse/inventory/dto/warehouse-inventory-query.dto';
import { CloseRecallDto, CollectFromFacilityDto, CollectRecallDto, CreateRecallDto } from './dto/recall.dto';
import { recallDatabase, recallError } from './recall-errors';

type Tx = Prisma.TransactionClient;

export interface RecallSummary {
  id: number;
  recallCode: string;
  reason: string;
  severity: string;
  documentUrl: string | null;
  status: string;
  createdBy: number;
  createdAt: Date;
  closedBy: number | null;
  closedAt: Date | null;
  batchCount: number;
}

export interface RecallDetail extends RecallSummary {
  batches: { batchId: number; batchNumber: string; medicineName: string; expiryDate: Date; boxCount: number }[];
  transfers: { id: number; transferCode: string; fromFacilityId: number; toFacilityId: number; status: string }[];
  events: { action: string; facilityId: number | null; batchId: number | null; boxCount: number; transferId: number | null; actorId: number; note: string | null; createdAt: Date }[];
}

export interface RecallImpactBox {
  uid: string;
  batchId: number;
  batchNumber: string;
  boxStatus: string;
  location: 'FACILITY' | 'IN_TRANSIT' | 'DELIVERED' | 'OTHER';
  facilityId: number | null;
  facilityName: string | null;
  orderId: number | null;
  orderCode: string | null;
  orderStatus: string | null;
  customerId: number | null;
  customerName: string | null;
}

export interface RecallImpact {
  totalBoxes: number;
  byLocation: Record<RecallImpactBox['location'], number>;
  boxes: RecallImpactBox[];
}

export interface CollectionTransfer {
  transferId: number;
  transferCode: string;
  toFacilityId: number;
  /** False when an open collection transfer of this recall from this warehouse already existed and was returned. */
  created: boolean;
}

export interface CollectionDestination {
  facilityId: number;
  facilityName: string;
}

export interface RecallTask {
  recallId: number;
  recallCode: string;
  severity: string;
  kind: 'QUARANTINED_STOCK' | 'COLLECTION_TRANSFER' | 'ORDER_TO_RESOLVE';
  facilityId: number;
  batchId: number | null;
  batchNumber: string | null;
  quantity: number | null;
  transferId: number | null;
  transferCode: string | null;
  transferStatus: string | null;
  orderId: number | null;
  orderCode: string | null;
}

const SUMMARY = Prisma.sql`r.id, r.recall_code AS "recallCode", r.reason, r.severity, r.document_url AS "documentUrl", r.status,
  r.created_by AS "createdBy", r.created_at AS "createdAt", r.closed_by AS "closedBy", r.closed_at AS "closedAt",
  (SELECT count(*)::integer FROM public.batch_recall_batches rb WHERE rb.recall_id = r.id) AS "batchCount"`;

@Injectable()
export class RecallService {
  constructor(private readonly prisma: PrismaService) {}

  list(user: CurrentUserPayload): Promise<RecallSummary[]> {
    return this.prisma.withActor(authActor(user), tx => tx.$queryRaw<RecallSummary[]>`
      SELECT ${SUMMARY} FROM public.batch_recalls r ORDER BY r.id DESC LIMIT 200`);
  }

  detail(user: CurrentUserPayload, id: number): Promise<RecallDetail> {
    return this.prisma.withActor(authActor(user), tx => this.load(tx, id));
  }

  create(user: CurrentUserPayload, dto: CreateRecallDto): Promise<RecallDetail> {
    return recallDatabase(this.prisma.withActor(authActor(user), async tx => {
      const [row] = await tx.$queryRaw<{ id: number }[]>`
        SELECT public.create_batch_recall(${dto.recallCode}, ${dto.reason.trim()}, ${dto.severity}, ${dto.documentUrl ?? null}::text,
          ${dto.batchIds}::integer[]) AS id`;
      return this.load(tx, row.id);
    }));
  }

  /**
   * Factory staff recall batches their own factory made. The database refuses any other batch. Collecting the stock and
   * closing the recall stay with the super administrator, who sees the recall in the admin list; the manager of a warehouse
   * holding recalled stock may also collect it (collectFromFacility).
   */
  createForFactory(user: CurrentUserPayload, dto: CreateRecallDto): Promise<{ id: number; recallCode: string }> {
    if (!Number.isInteger(Number(user.facilityId)) || Number(user.facilityId) <= 0) throw recallError('RC_FACILITY_REQUIRED');
    return recallDatabase(this.prisma.withActor(authActor(user), async tx => {
      const [row] = await tx.$queryRaw<{ id: number }[]>`
        SELECT public.create_batch_recall(${dto.recallCode}, ${dto.reason.trim()}, ${dto.severity}, ${dto.documentUrl ?? null}::text,
          ${dto.batchIds}::integer[]) AS id`;
      return { id: row.id, recallCode: dto.recallCode };
    }));
  }

  collect(user: CurrentUserPayload, id: number, dto: CollectRecallDto): Promise<RecallDetail> {
    return this.change(user, id, tx => tx.$queryRaw`SELECT public.collect_batch_recall(${id}::integer, ${dto.destinationFacilityId}::integer)`);
  }

  /** Where a warehouse manager may send the recalled stock: only the facility that started the recall. */
  async collectionDestination(user: CurrentUserPayload, id: number): Promise<CollectionDestination> {
    if (!Number.isInteger(Number(user.facilityId)) || Number(user.facilityId) <= 0) throw recallError('RC_FACILITY_REQUIRED');
    const [destination] = await recallDatabase(this.prisma.withActor(authActor(user), tx => tx.$queryRaw<CollectionDestination[]>`
      SELECT facility_id AS "facilityId", facility_name AS "facilityName" FROM public.recall_collection_origin(${id}::integer)`));
    return destination;
  }

  /**
   * A warehouse manager collects the recalled stock of their own warehouse, back to the facility that started the recall. The source is the facility of the signed-in
   * account (the database reads it from the session), never a value of the request. Calling it again while the
   * transfer is open returns that transfer.
   */
  async collectFromFacility(user: CurrentUserPayload, id: number, dto: CollectFromFacilityDto): Promise<CollectionTransfer> {
    if (!Number.isInteger(Number(user.facilityId)) || Number(user.facilityId) <= 0) throw recallError('RC_FACILITY_REQUIRED');
    if (dto.toFacilityId === Number(user.facilityId)) throw recallError('RC_DESTINATION_INVALID');
    const [transfer] = await recallDatabase(this.prisma.withActor(authActor(user), tx => tx.$queryRaw<CollectionTransfer[]>`
      SELECT transfer_id AS "transferId", transfer_code AS "transferCode", to_facility_id AS "toFacilityId", created
      FROM public.collect_recall_from_facility(${id}::integer, ${dto.toFacilityId}::integer, ${dto.note?.trim() || null}::text)`));
    return transfer;
  }

  close(user: CurrentUserPayload, id: number, dto: CloseRecallDto): Promise<RecallDetail> {
    return this.change(user, id, tx => tx.$executeRaw`SELECT public.close_batch_recall(${id}::integer, ${dto.note.trim()}::text)`);
  }

  impact(user: CurrentUserPayload, id: number): Promise<RecallImpact> {
    return recallDatabase(this.prisma.withActor(authActor(user), async tx => {
      await this.load(tx, id);
      const boxes = await tx.$queryRaw<RecallImpactBox[]>`
        SELECT uid::text AS uid, batch_id AS "batchId", batch_number AS "batchNumber", box_status AS "boxStatus", location,
          facility_id AS "facilityId", facility_name AS "facilityName", order_id AS "orderId", order_code AS "orderCode",
          order_status AS "orderStatus", customer_id AS "customerId", customer_name AS "customerName"
        FROM public.batch_recall_impact(${id}::integer)`;
      const byLocation = { FACILITY: 0, IN_TRANSIT: 0, DELIVERED: 0, OTHER: 0 };
      for (const box of boxes) byLocation[box.location] += 1;
      return { totalBoxes: boxes.length, byLocation, boxes };
    }));
  }

  async tasks(user: CurrentUserPayload, query: WarehouseFacilityQueryDto): Promise<RecallTask[]> {
    const facilityId = query.facilityId ?? user.facilityId ?? null;
    if (facilityId === null && normalizeRole(user.role) !== 'SUPER_ADMIN') throw recallError('RC_FACILITY_REQUIRED');
    return recallDatabase(this.prisma.withActor(authActor(user), tx => tx.$queryRaw<RecallTask[]>`
      SELECT recall_id AS "recallId", recall_code AS "recallCode", severity, kind, facility_id AS "facilityId", batch_id AS "batchId",
        batch_number AS "batchNumber", quantity, transfer_id AS "transferId", transfer_code AS "transferCode",
        transfer_status AS "transferStatus", order_id AS "orderId", order_code AS "orderCode"
      FROM public.batch_recall_tasks(${facilityId}::integer) ORDER BY recall_id DESC, kind, facility_id`));
  }

  private change(user: CurrentUserPayload, id: number, run: (tx: Tx) => Promise<unknown>): Promise<RecallDetail> {
    return recallDatabase(this.prisma.withActor(authActor(user), async tx => {
      await run(tx);
      return this.load(tx, id);
    }));
  }

  private async load(tx: Tx, id: number): Promise<RecallDetail> {
    const [recall] = await tx.$queryRaw<RecallSummary[]>`SELECT ${SUMMARY} FROM public.batch_recalls r WHERE r.id = ${id}`;
    if (!recall) throw recallError('RC_NOT_FOUND');
    const [batches, transfers, events] = await Promise.all([
      tx.$queryRaw<RecallDetail['batches']>`
        SELECT b.id AS "batchId", b.batch_number AS "batchNumber", m.medicine_name AS "medicineName", b.expiry_date AS "expiryDate",
          (SELECT count(*)::integer FROM public.medicine_boxes x WHERE x.batch_id = b.id) AS "boxCount"
        FROM public.batch_recall_batches rb JOIN public.batches b ON b.id = rb.batch_id JOIN public.medicines m ON m.id = b.medicine_id
        WHERE rb.recall_id = ${id} ORDER BY b.id`,
      tx.$queryRaw<RecallDetail['transfers']>`
        SELECT DISTINCT t.id, t.transfer_code AS "transferCode", t.from_facility_id AS "fromFacilityId", t.to_facility_id AS "toFacilityId", t.status
        FROM public.batch_recall_events e JOIN public.internal_transfers t ON t.id = e.transfer_id
        WHERE e.recall_id = ${id} AND e.action = 'COLLECT' ORDER BY t.id`,
      tx.$queryRaw<RecallDetail['events']>`
        SELECT action, facility_id AS "facilityId", batch_id AS "batchId", cardinality(box_uids) AS "boxCount", transfer_id AS "transferId",
          actor_id AS "actorId", note, created_at AS "createdAt"
        FROM public.batch_recall_events WHERE recall_id = ${id} ORDER BY id`,
    ]);
    return { ...recall, batches, transfers, events };
  }
}
