import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { authActor } from '../../../common/auth-identity';
import { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { CryptoUtil } from '../../../common/utils/crypto.util';
import { WH_MANAGER, warehouseScope } from '../../../common/warehouse-roles';
import { PrismaService } from '../../../prisma/prisma.service';
import { Page, pagination } from '../inventory/warehouse-inventory.service';
import { warehouseDatabase, warehouseError } from '../warehouse-errors';
import { FraudAlertQueryDto, ScanBoxDto } from './dto/traceability.dto';

type Tx = Prisma.TransactionClient;

export type ScanReason = 'UNKNOWN_UID' | 'SIGNATURE_MISMATCH' | 'NOT_AT_WAREHOUSE' | 'BOX_STATUS_UNEXPECTED';

export interface ScanFacts {
  uid: string;
  batchNumber: string | null;
  signature: string | null;
  status: string;
  facilityId: number | null;
  batchStatus: string | null;
  expiryDate: Date | null;
  medicineName: string | null;
  ssccCode: string | null;
}

export type ScanBox = Omit<ScanFacts, 'signature'>;

export interface ScanResult {
  uid: string;
  verdict: 'NO_ANOMALY_FOUND' | 'NEEDS_INVESTIGATION';
  reasons: ScanReason[];
  box: ScanBox | null;
  message: string;
}

export interface BoxTimelineEvent {
  occurredAt: Date | null;
  eventType: string;
  facilityId: number | null;
  actorId: number | null;
  reference: string | null;
  detail: string | null;
}

export interface CartonBox { uid: string; status: string; facilityId: number | null }

export interface CartonDetail {
  id: number;
  sscc: string;
  status: string;
  facilityId: number | null;
  batchNumber: string | null;
  medicineName: string | null;
  boxes: CartonBox[];
}

export interface FraudAlert {
  id: number;
  uid: string | null;
  scannedCode: string | null;
  fraudType: string;
  severity: string | null;
  description: string | null;
  facilityId: number | null;
  resolutionStatus: string | null;
  createdAt: Date | null;
  reportedById: number | null;
  resolvedById: number | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
}

interface CartonRow {
  id: number;
  sscc: string;
  status: string;
  facilityId: number | null;
  batchNumber: string | null;
  medicineName: string | null;
  boxUid: string | null;
  boxStatus: string | null;
  boxFacilityId: number | null;
}

const UNEXPECTED_BOX_STATUSES = ['DESTROYED', 'MISSING'];

const ALERT_COLUMNS = Prisma.sql`a.id, a.uid::text AS uid, a.scanned_code AS "scannedCode", a.fraud_type AS "fraudType", a.severity_level AS severity,
  a.description, a.facility_id AS "facilityId", a.resolution_status AS "resolutionStatus", a.created_at AS "createdAt",
  a.reported_by_id AS "reportedById", a.resolved_by_id AS "resolvedById", a.resolved_at AS "resolvedAt", a.resolution_note AS "resolutionNote"`;

function signatureMatches(uid: string, batchNumber: string | null, signature: string | null): boolean {
  return signature !== null && batchNumber !== null && CryptoUtil.verifyBoxSignature(uid, batchNumber, signature);
}

export function findScanAnomalies(facts: ScanFacts | undefined, facilityId: number | null, presentedSignature?: string): ScanReason[] {
  if (!facts) return ['UNKNOWN_UID'];
  const reasons: ScanReason[] = [];
  const presentedValid = presentedSignature === undefined || signatureMatches(facts.uid, facts.batchNumber, presentedSignature);
  if (!signatureMatches(facts.uid, facts.batchNumber, facts.signature) || !presentedValid) reasons.push('SIGNATURE_MISMATCH');
  if (facilityId !== null && facts.facilityId !== facilityId) reasons.push('NOT_AT_WAREHOUSE');
  if (UNEXPECTED_BOX_STATUSES.includes(facts.status)) reasons.push('BOX_STATUS_UNEXPECTED');
  return reasons;
}

function visibleBox(facts: ScanFacts | undefined, facilityId: number | null): ScanBox | null {
  if (!facts || (facilityId !== null && facts.facilityId !== facilityId)) return null;
  const { signature: _signature, ...box } = facts;
  return box;
}

@Injectable()
export class TraceabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async scan(user: CurrentUserPayload, dto: ScanBoxDto): Promise<ScanResult> {
    const facilityId = warehouseScope(user, dto);
    const uid = dto.uid.toLowerCase();
    return warehouseDatabase(this.prisma.withTraceability(authActor(user), async tx => {
      const [facts] = await tx.$queryRaw<ScanFacts[]>`
        SELECT uid::text AS uid, batch_number AS "batchNumber", signature, status, facility_id AS "facilityId", batch_status AS "batchStatus",
          expiry_date AS "expiryDate", medicine_name AS "medicineName", sscc_code AS "ssccCode"
        FROM public.scan_box_facts(${uid}::uuid)`;
      const reasons = findScanAnomalies(facts, facilityId, dto.signature);
      if (reasons.length > 0) await tx.$executeRaw`SELECT public.record_scan_anomaly(${uid}::uuid, ${reasons}::text[])`;
      return {
        uid,
        verdict: reasons.length > 0 ? 'NEEDS_INVESTIGATION' : 'NO_ANOMALY_FOUND',
        reasons,
        box: visibleBox(facts, facilityId),
        message: reasons.length > 0
          ? 'Needs investigation. An alert was opened for a manager to review.'
          : 'No anomaly found. This scan does not prove the box is authentic.',
      };
    }));
  }

  async history(user: CurrentUserPayload, uid: string): Promise<BoxTimelineEvent[]> {
    const events = await this.prisma.withTraceability(authActor(user), tx => tx.$queryRaw<BoxTimelineEvent[]>`
      SELECT occurred_at AS "occurredAt", event_type AS "eventType", facility_id AS "facilityId", actor_id AS "actorId", reference, detail
      FROM public.box_history(${uid.toLowerCase()}::uuid)`);
    if (events.length === 0) throw warehouseError('TR_BOX_NOT_FOUND');
    return events;
  }

  carton(user: CurrentUserPayload, sscc: string): Promise<CartonDetail> {
    return this.prisma.withTraceability(authActor(user), tx => this.loadCarton(tx, sscc));
  }

  unpack(user: CurrentUserPayload, sscc: string): Promise<CartonDetail> {
    return warehouseDatabase(this.prisma.withTraceability(authActor(user), async tx => {
      await tx.$executeRaw`SELECT public.unpack_carton(${sscc}::text)`;
      return this.loadCarton(tx, sscc);
    }));
  }

  async alerts(user: CurrentUserPayload, query: FraudAlertQueryDto): Promise<Page<FraudAlert>> {
    const facilityId = warehouseScope(user, query, WH_MANAGER);
    const status = query.status ?? null;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return this.prisma.withTraceability(authActor(user), async tx => {
      const [[total], items] = await Promise.all([
        tx.$queryRaw<{ total: number }[]>`
          SELECT count(*)::integer AS total FROM public.fraud_alerts a
          WHERE (${facilityId}::integer IS NULL OR a.facility_id = ${facilityId}::integer) AND (${status}::text IS NULL OR a.resolution_status = ${status}::text)`,
        tx.$queryRaw<FraudAlert[]>`
          SELECT ${ALERT_COLUMNS} FROM public.fraud_alerts a
          WHERE (${facilityId}::integer IS NULL OR a.facility_id = ${facilityId}::integer) AND (${status}::text IS NULL OR a.resolution_status = ${status}::text)
          ORDER BY a.id DESC OFFSET ${(page - 1) * limit} LIMIT ${limit}`,
      ]);
      return { items, pagination: pagination(total.total, page, limit) };
    });
  }

  resolve(user: CurrentUserPayload, id: number, note: string): Promise<FraudAlert> {
    return warehouseDatabase(this.prisma.withTraceability(authActor(user), async tx => {
      await tx.$executeRaw`SELECT public.resolve_fraud_alert(${id}::integer, ${note.trim()}::text)`;
      const [alert] = await tx.$queryRaw<FraudAlert[]>`SELECT ${ALERT_COLUMNS} FROM public.fraud_alerts a WHERE a.id = ${id}`;
      return alert;
    }));
  }

  private async loadCarton(tx: Tx, sscc: string): Promise<CartonDetail> {
    const rows = await tx.$queryRaw<CartonRow[]>`
      SELECT carton_id AS id, sscc_code AS sscc, status, facility_id AS "facilityId", batch_number AS "batchNumber", medicine_name AS "medicineName",
        box_uid::text AS "boxUid", box_status AS "boxStatus", box_facility_id AS "boxFacilityId"
      FROM public.carton_overview(${sscc}::text)`;
    if (rows.length === 0) throw warehouseError('TR_CARTON_NOT_FOUND');
    const { id, status, facilityId, batchNumber, medicineName } = rows[0];
    const boxes = rows.flatMap(row => row.boxUid && row.boxStatus ? [{ uid: row.boxUid, status: row.boxStatus, facilityId: row.boxFacilityId }] : []);
    return { id, sscc: rows[0].sscc, status, facilityId, batchNumber, medicineName, boxes };
  }
}
