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
}

export interface TraceEvent {
  occurredAt: Date;
  eventType: 'MANUFACTURED' | 'RECEIVED' | 'TRANSFER_RECEIVED';
  facilityName: string | null;
}

export interface TraceHistory {
  box: TraceBox;
  timeline: TraceEvent[];
}

export interface VerifyResult {
  uid: string;
  valid: boolean;
}

export interface ScanOutcome {
  scanResult: 'VALID' | 'SUSPICIOUS';
  riskScore: number;
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

  async verify(dto: VerifyBoxDto): Promise<VerifyResult> {
    const box = await this.findBox(dto.uid);
    return { uid: box.uid, valid: CryptoUtil.verifyBoxSignature(box.uid, box.batchNumber, dto.code.toLowerCase()) };
  }

  async scan(dto: ScanBoxDto, ip: string, userAgent?: string): Promise<ScanOutcome> {
    const [outcome] = await traceDatabase(this.prisma.$queryRaw<ScanOutcome[]>`
      SELECT scan_result AS "scanResult", risk_score AS "riskScore", reasons
      FROM public.record_public_scan(${dto.uid}::uuid, ${dto.latitude ?? null}::double precision,
        ${dto.longitude ?? null}::double precision, ${ip}::text, ${userAgent ?? null}::text)`);
    return outcome;
  }

  private async findBox(uid: string): Promise<TraceBox> {
    const [box] = await this.prisma.$queryRaw<TraceBox[]>`
      SELECT uid::text AS uid, medicine_name AS "medicineName", manufacturer, batch_number AS "batchNumber",
        production_date AS "productionDate", expiry_date AS "expiryDate", batch_status AS "batchStatus", box_status AS "boxStatus"
      FROM public.public_box_trace(${uid}::uuid)`;
    if (!box) throw traceError('TR_BOX_NOT_FOUND');
    return box;
  }
}
