import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OrderModule } from '../order/order.module';
import { DisposalController } from './disposal/disposal.controller';
import { DisposalService } from './disposal/disposal.service';
import { FactoryBatchController } from './factory/factory-batch.controller';
import { FactoryBatchService } from './factory/factory-batch.service';
import { FulfillmentController } from './fulfillment/fulfillment.controller';
import { FulfillmentService } from './fulfillment/fulfillment.service';
import { HandoverController } from './handover/handover.controller';
import { HandoverService } from './handover/handover.service';
import { BatchStatusService } from './inventory/batch-status.service';
import { WarehouseInventoryController } from './inventory/warehouse-inventory.controller';
import { WarehouseInventoryService } from './inventory/warehouse-inventory.service';
import { StockCountController } from './stock-count/stock-count.controller';
import { StockCountService } from './stock-count/stock-count.service';
import { TraceabilityController } from './traceability/traceability.controller';
import { TraceabilityService } from './traceability/traceability.service';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';

/** Warehouse portal API (/warehouse/*). Later warehouse features register their controllers here. */
@Module({
  imports: [PrismaModule, OrderModule],
  controllers: [WarehouseController, WarehouseInventoryController, FactoryBatchController, FulfillmentController, HandoverController, StockCountController, DisposalController, TraceabilityController],
  providers: [WarehouseService, WarehouseInventoryService, BatchStatusService, FactoryBatchService, FulfillmentService, HandoverService, StockCountService, DisposalService, TraceabilityService],
})
export class WarehouseModule {}
