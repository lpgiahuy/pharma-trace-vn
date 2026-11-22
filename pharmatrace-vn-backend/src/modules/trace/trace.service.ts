import { Injectable } from '@nestjs/common';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { PrismaService } from '../../prisma/prisma.service';
import { ScanBoxDto, VerifyBoxDto } from './dto/trace.dto';
import { traceDatabase, traceError } from './trace-errors';

export interface TraceBox {
  uid: string;
  medicineName: string;
  manufacturer: string | null;
  batchNumber: string;
  productionDate: Date;
  expiryDate: Date;
  batchStatus: string;
  boxStatus: string;
  activatedAt: Date | null;
  verifyCount: number;
  flagged: boolean;
}

export interface TraceEvent {
  occurredAt: Date;
  eventType: 'MANUFACTURED' | 'RECEIVED' | 'TRANSFER_DISPATCHED' | 'TRANSFER_RECEIVED' | 'PACKED' | 'HANDED_OVER' | 'DELIVERED' | 'CODE_ACTIVATED';
  facilityName: string | null;
}

export interface TraceHistory {
  box: TraceBox;
  timeline: TraceEvent[];
}

export interface VerifyResult {
  uid: string;
  status: 'FIRST_ACTIVATION' | 'ALREADY_ACTIVATED' | 'INVALID_CODE';
  activatedAt: Date | null;
  verifyCount: number;
  flagged: boolean;
}

export interface ScanOutcome {
  scanResult: 'VALID' | 'FLAGGED';
  reasons: ('IMPOSSIBLE_TRAVEL' | 'EXCESSIVE_SCANS')[];
}

@Injectable()
export class TraceService {
  constructor(private readonly prisma: PrismaService) {}

  async history(uid: string): Promise<TraceHistory> {
    const [box, timeline] = await Promise.all([
      this.findBox(uid),
      this.prisma.$queryRaw<TraceEvent[]>`
        SELECT occurred_at AS "occurredAt", event_type AS "eventType", facility_name AS "facilityName"
        FROM public.public_box_timeline(${uid}::uuid)`,
    ]);
    return { box, timeline };
  }

  async verify(dto: VerifyBoxDto, ip: string): Promise<VerifyResult> {
    const box = await this.findBox(dto.uid);
    const valid = CryptoUtil.verifyBoxSignature(box.uid, box.batchNumber, dto.code.toLowerCase());
    const [entry] = await this.prisma.$queryRaw<{ firstActivation: boolean; activatedAt: Date | null; verifyCount: number; flagged: boolean }[]>`
      SELECT first_activation AS "firstActivation", activated_at AS "activatedAt", verify_count AS "verifyCount", flagged
      FROM public.record_box_verification(${box.uid}::uuid, ${valid}, ${dto.deviceId ?? `ip:${ip}`}::text)`;
    const status = !valid ? 'INVALID_CODE' : entry.firstActivation ? 'FIRST_ACTIVATION' : 'ALREADY_ACTIVATED';
    return { uid: box.uid, status, activatedAt: entry.activatedAt, verifyCount: entry.verifyCount, flagged: entry.flagged };
  }

  async scan(dto: ScanBoxDto, ip: string, userAgent?: string): Promise<ScanOutcome> {
    const [outcome] = await traceDatabase(this.prisma.$queryRaw<ScanOutcome[]>`
      SELECT scan_result AS "scanResult", reasons
      FROM public.record_public_scan(${dto.uid}::uuid, ${dto.latitude ?? null}::double precision,
        ${dto.longitude ?? null}::double precision, ${ip}::text, ${userAgent ?? null}::text)`);
    return outcome;
  }

  private async findBox(uid: string): Promise<TraceBox> {
    const [box] = await this.prisma.$queryRaw<TraceBox[]>`
      SELECT uid::text AS uid, medicine_name AS "medicineName", manufacturer, batch_number AS "batchNumber",
        production_date AS "productionDate", expiry_date AS "expiryDate", batch_status AS "batchStatus", box_status AS "boxStatus",
        activated_at AS "activatedAt", verify_count AS "verifyCount", flagged
      FROM public.public_box_trace(${uid}::uuid)`;
    if (!box) throw traceError('TR_BOX_NOT_FOUND');
    return box;
  }
}
