import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OrderModule } from '../order/order.module';
import { FactoryBatchController } from './factory/factory-batch.controller';
import { FactoryBatchService } from './factory/factory-batch.service';
import { FulfillmentController } from './fulfillment/fulfillment.controller';
import { FulfillmentService } from './fulfillment/fulfillment.service';
import { HandoverController } from './handover/handover.controller';
import { HandoverService } from './handover/handover.service';
import { BatchStatusService } from './inventory/batch-status.service';
import { WarehouseInventoryController } from './inventory/warehouse-inventory.controller';
import { WarehouseInventoryService } from './inventory/warehouse-inventory.service';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';

/** Warehouse portal API (/warehouse/*). Later warehouse features register their controllers here. */
@Module({
  imports: [PrismaModule, OrderModule],
  controllers: [WarehouseController, WarehouseInventoryController, FactoryBatchController, FulfillmentController, HandoverController],
  providers: [WarehouseService, WarehouseInventoryService, BatchStatusService, FactoryBatchService, FulfillmentService, HandoverService],
})
export class WarehouseModule {}
