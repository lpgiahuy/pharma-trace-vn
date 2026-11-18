import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PurchaseOrderController } from './purchase-order.controller';
import { PurchaseOrderService } from './purchase-order.service';

/** Purchase orders of the warehouse portal (/warehouse/purchase-orders). */
@Module({
  imports: [PrismaModule],
  controllers: [PurchaseOrderController],
  providers: [PurchaseOrderService],
})
export class ProcurementModule {}
