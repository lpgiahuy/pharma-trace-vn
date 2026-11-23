import { Injectable } from '@nestjs/common';
import { randomInt, randomUUID } from 'crypto';
import { authActor } from '../../../common/auth-identity';
import { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { CryptoUtil } from '../../../common/utils/crypto.util';
import { FACTORY_INTAKE, warehouseScope } from '../../../common/warehouse-roles';
import { PrismaService } from '../../../prisma/prisma.service';
import { warehouseDatabase, warehouseError } from '../warehouse-errors';
import { CreateFactoryBatchDto, FactoryFacilityQueryDto, VoidFactoryBatchDto } from './dto/factory-batch.dto';

interface CartonPayload {
  sscc: string;
  boxes: { uid: string; signature: string }[];
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

  async labels(user: CurrentUserPayload, batchId: number, query: FactoryFacilityQueryDto): Promise<string> {
    const facilityId = warehouseScope(user, query, FACTORY_INTAKE);
    const batch = await this.prisma.withWarehouseRead(authActor(user), tx => tx.batches.findFirst({
      where: { id: batchId, ...(facilityId === null ? {} : { manufacturer_source_facility_id: facilityId }) },
      select: {
        medicine_boxes: { select: { uid: true, signature: true, sscc_cartons: { select: { sscc_code: true } } }, orderBy: [{ carton_id: 'asc' }, { uid: 'asc' }] },
      },
    }));
    if (!batch) throw warehouseError('WAREHOUSE_BATCH_NOT_FOUND');
    // secret_code is printed under the scratch layer. Customers type it at /trace and it is checked against
    // HMAC(uid, batch number) (CryptoUtil.verifyBoxSignature), which is what record_factory_batch stores in signature.
    return ['sscc,uid,secret_code', ...batch.medicine_boxes.map(box => `${box.sscc_cartons?.sscc_code ?? ''},${box.uid},${box.signature ?? ''}`)].join('\n');
  }
}
