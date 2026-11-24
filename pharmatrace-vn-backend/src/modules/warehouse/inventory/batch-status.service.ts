import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { authActor, normalizeRole } from '../../../common/auth-identity';
import { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { BATCH_HOLD, warehouseScope } from '../../../common/warehouse-roles';
import { PrismaService } from '../../../prisma/prisma.service';
import { warehouseError } from '../warehouse-errors';

export interface BatchStatusResult { id: number; status: string }

@Injectable()
export class BatchStatusService {
  private readonly logger = new Logger(BatchStatusService.name);

  constructor(private readonly prisma: PrismaService) {}

  hold(user: CurrentUserPayload, id: number, reason: string): Promise<BatchStatusResult> {
    return this.change(user, id, 'ACTIVE', 'ON_HOLD', reason);
  }

  release(user: CurrentUserPayload, id: number, reason: string): Promise<BatchStatusResult> {
    return this.change(user, id, 'ON_HOLD', 'ACTIVE', reason);
  }

  /** Batches past their expiry date (Vietnam time) become EXPIRED. Recalled batches keep their status. */
  @Cron(CronExpression.EVERY_DAY_AT_1AM, { timeZone: 'Asia/Ho_Chi_Minh' })
  async expireBatches(): Promise<number> {
    const expired = await this.prisma.$executeRaw`
      UPDATE public.batches SET status = 'EXPIRED'
      WHERE status IN ('ACTIVE', 'ON_HOLD') AND expiry_date <= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`;
    if (expired) this.logger.log(`Marked ${expired} batch(es) as expired.`);
    return expired;
  }

  /**
   * A manager may change only batches with boxes at their warehouse; factory staff only batches their own factory made;
   * SUPER_ADMIN may change any batch.
   */
  private async change(user: CurrentUserPayload, id: number, from: string, to: string, reason: string): Promise<BatchStatusResult> {
    const facilityId = warehouseScope(user, {}, BATCH_HOLD);
    const atFactory = normalizeRole(user.role) === 'FACTORY_WAREHOUSE_STAFF';
    const actor = authActor(user);
    const note = reason.trim();
    return this.prisma.withBatchStatus(actor, async tx => {
      const [batch] = await tx.$queryRaw<{ status: string | null }[]>`SELECT status FROM public.batches WHERE id = ${id} FOR UPDATE`;
      const atWarehouse = facilityId === null
        || (atFactory ? await tx.batches.count({ where: { id, manufacturer_source_facility_id: facilityId } }) > 0
          : await tx.medicine_boxes.count({ where: { batch_id: id, current_facility_id: facilityId } }) > 0);
      if (!batch || !atWarehouse) throw warehouseError('WAREHOUSE_BATCH_NOT_FOUND');
      if (batch.status !== from) throw warehouseError(to === 'ON_HOLD' ? 'WAREHOUSE_BATCH_NOT_ACTIVE' : 'WAREHOUSE_BATCH_NOT_ON_HOLD');
      const held = to === 'ON_HOLD';
      await tx.batches.update({
        where: { id },
        data: { status: to, hold_reason: held ? note : null, held_by_id: held ? actor.id : null, held_at: held ? new Date() : null },
      });
      await tx.$executeRaw`INSERT INTO public.batch_status_events(batch_id, from_status, to_status, reason, actor_id)
        VALUES (${id}, ${from}, ${to}, ${note}, ${actor.id})`;
      return { id, status: to };
    });
  }
}
