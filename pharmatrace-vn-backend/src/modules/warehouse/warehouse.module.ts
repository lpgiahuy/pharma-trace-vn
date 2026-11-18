import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FactoryBatchController } from './factory/factory-batch.controller';
import { FactoryBatchService } from './factory/factory-batch.service';
import { BatchStatusService } from './inventory/batch-status.service';
import { WarehouseInventoryController } from './inventory/warehouse-inventory.controller';
import { WarehouseInventoryService } from './inventory/warehouse-inventory.service';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';

/** Warehouse portal API (/warehouse/*). Later warehouse features register their controllers here. */
@Module({
  imports: [PrismaModule],
  controllers: [WarehouseController, WarehouseInventoryController, FactoryBatchController],
  providers: [WarehouseService, WarehouseInventoryService, BatchStatusService, FactoryBatchService],
})
export class WarehouseModule {}
