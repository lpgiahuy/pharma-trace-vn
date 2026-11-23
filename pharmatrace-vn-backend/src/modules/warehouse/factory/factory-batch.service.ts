import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt, randomUUID } from 'crypto';
import { authActor } from '../../../common/auth-identity';
import { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { CryptoUtil } from '../../../common/utils/crypto.util';
import { FACTORY_INTAKE, WH_ALL, isWarehouseRole, warehouseScope } from '../../../common/warehouse-roles';
import { PrismaService } from '../../../prisma/prisma.service';
import { warehouseDatabase, warehouseError } from '../warehouse-errors';
import { CreateFactoryBatchDto, FactoryFacilityQueryDto, ProductionReportQueryDto, VoidFactoryBatchDto } from './dto/factory-batch.dto';

interface CartonPayload {
  sscc: string;
  boxes: { uid: string; signature: string }[];
}

export interface ProductionReport {
  from: string;
  to: string;
  groupBy: 'day' | 'month';
  totals: { batches: number; boxes: number; voidedBatches: number; recalledBatches: number; heldBatches: number };
  periods: { period: string; batches: number; boxes: number }[];
  medicines: { medicineId: number | null; medicineName: string | null; batches: number; boxes: number }[];
}

export interface FactoryBatchSummary {
  id: number;
  batchNumber: string;
  boxCount: number;
  cartonCount: number;
}

function newSscc(): string {
  const digits = Array.from({ length: 17 }, () => randomInt(10));
  const sum = digits.reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return `${digits.join('')}${(10 - (sum % 10)) % 10}`;
}

function buildCartons(batchNumber: string, boxCount: number, boxesPerCarton: number): CartonPayload[] {
  const cartons: CartonPayload[] = [];
  for (let left = boxCount; left > 0; left -= boxesPerCarton) {
    const boxes = Array.from({ length: Math.min(boxesPerCarton, left) }, () => {
      const uid = randomUUID();
      return { uid, signature: CryptoUtil.signBox(uid, batchNumber) };
    });
    cartons.push({ sscc: newSscc(), boxes });
  }
  return cartons;
}

@Injectable()
export class FactoryBatchService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: CurrentUserPayload, dto: CreateFactoryBatchDto): Promise<FactoryBatchSummary> {
    const facilityId = warehouseScope(user, dto, FACTORY_INTAKE);
    const maxBoxes = Number(process.env.FACTORY_BATCH_MAX_BOXES || 10000);
    if (dto.boxCount > maxBoxes) throw warehouseError('FB_BATCH_TOO_LARGE', { maxBoxes });
    const batchNumber = dto.batchNumber.trim();
    const cartons = buildCartons(batchNumber, dto.boxCount, dto.boxesPerCarton);
    return await warehouseDatabase(this.prisma.withFactoryIntake(authActor(user), async tx => {
      const [row] = await tx.$queryRaw<{ id: number }[]>`
        SELECT public.record_factory_batch(${facilityId}::integer, ${dto.variantId}::integer, ${batchNumber}::text,
          ${dto.productionDate}::date, ${dto.expiryDate}::date, ${dto.certificateCoCq?.trim() || null}::text,
          ${JSON.stringify(cartons)}::jsonb) AS id`;
      return { id: row.id, batchNumber, boxCount: dto.boxCount, cartonCount: cartons.length };
    }));
  }

  /** Voids a batch registered by mistake while all its boxes are still untouched at the factory (void_factory_batch). */
  async void(user: CurrentUserPayload, batchId: number, dto: VoidFactoryBatchDto): Promise<{ id: number }> {
    warehouseScope(user, {}, FACTORY_INTAKE);
    return await warehouseDatabase(this.prisma.withFactoryIntake(authActor(user), async tx => {
      const [row] = await tx.$queryRaw<{ id: number }[]>`SELECT public.void_factory_batch(${batchId}::integer, ${dto.reason.trim()}::text) AS id`;
      return { id: row.id };
    }));
  }

  /**
   * What the factory produced between two production dates, per day or month and per medicine. Voided batches are not
   * production: they are counted apart. Recalled and held batches still count as produced.
   */
  async productionReport(user: CurrentUserPayload, query: ProductionReportQueryDto): Promise<ProductionReport> {
    const facilityId = warehouseScope(user, query, FACTORY_INTAKE);
    const groupBy = query.groupBy ?? 'month';
    const to = query.to ?? new Date().toISOString().slice(0, 10);
    const from = query.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - (groupBy === 'day' ? 29 : 365) * 86_400_000).toISOString().slice(0, 10);
    if (from > to) throw warehouseError('FB_REPORT_RANGE_INVALID');
    const scope = Prisma.sql`b.production_date BETWEEN ${from}::date AND ${to}::date
      AND (${facilityId}::integer IS NULL OR b.manufacturer_source_facility_id = ${facilityId}::integer)`;
    return this.prisma.withWarehouseRead(authActor(user), async tx => {
      const [totals] = await tx.$queryRaw<ProductionReport['totals'][]>`
        SELECT count(*) FILTER (WHERE b.status <> 'VOIDED')::integer AS batches,
          coalesce(sum(b.initial_quantity) FILTER (WHERE b.status <> 'VOIDED'), 0)::integer AS boxes,
          count(*) FILTER (WHERE b.status = 'VOIDED')::integer AS "voidedBatches",
          count(*) FILTER (WHERE b.status = 'RECALLED')::integer AS "recalledBatches",
          count(*) FILTER (WHERE b.status = 'ON_HOLD')::integer AS "heldBatches"
        FROM public.batches b WHERE ${scope}`;
      const periods = await tx.$queryRaw<ProductionReport['periods']>`
        SELECT to_char(date_trunc(${groupBy}::text, b.production_date::timestamp), 'YYYY-MM-DD') AS period,
          count(*)::integer AS batches, sum(b.initial_quantity)::integer AS boxes
        FROM public.batches b WHERE ${scope} AND b.status <> 'VOIDED' GROUP BY 1 ORDER BY 1`;
      const medicines = await tx.$queryRaw<ProductionReport['medicines']>`
        SELECT b.medicine_id AS "medicineId", m.medicine_name::text AS "medicineName", count(*)::integer AS batches, sum(b.initial_quantity)::integer AS boxes
        FROM public.batches b LEFT JOIN public.medicines m ON m.id = b.medicine_id
        WHERE ${scope} AND b.status <> 'VOIDED' GROUP BY 1, 2 ORDER BY boxes DESC, 2`;
      return { from, to, groupBy, totals, periods, medicines };
    });
  }

  /**
   * Label data for the first unit that holds a batch: the factory that made it, or the warehouse that received it from an
   * outside manufacturer (the batch has no source factory and a goods receipt at that warehouse).
   */
  async labels(user: CurrentUserPayload, batchId: number, query: FactoryFacilityQueryDto): Promise<string> {
    const receiving = !isWarehouseRole(user.role, FACTORY_INTAKE) && isWarehouseRole(user.role, WH_ALL);
    const facilityId = warehouseScope(user, query, receiving ? WH_ALL : FACTORY_INTAKE);
    const batch = await this.prisma.withWarehouseRead(authActor(user), tx => tx.batches.findFirst({
      where: receiving
        ? { id: batchId, manufacturer_source_facility_id: null, goods_receipt_lines: { some: { goods_receipts: { facility_id: facilityId as number } } } }
        : { id: batchId, ...(facilityId === null ? {} : { manufacturer_source_facility_id: facilityId }) },
      select: {
        medicine_boxes: {
          where: receiving ? { current_facility_id: facilityId, status: { not: 'QUARANTINED' } } : undefined,
          select: { uid: true, signature: true, sscc_cartons: { select: { sscc_code: true } } },
          orderBy: [{ carton_id: 'asc' }, { uid: 'asc' }],
        },
      },
    }));
    if (!batch) throw warehouseError('WAREHOUSE_BATCH_NOT_FOUND');
    // secret_code is printed under the scratch layer. Customers type it at /trace and it is checked against
    // HMAC(uid, batch number) (CryptoUtil.verifyBoxSignature), which is what record_factory_batch stores in signature.
    return ['sscc,uid,secret_code', ...batch.medicine_boxes.map(box => `${box.sscc_cartons?.sscc_code ?? ''},${box.uid},${box.signature ?? ''}`)].join('\n');
  }
}
