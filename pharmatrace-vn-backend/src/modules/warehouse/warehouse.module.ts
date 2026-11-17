import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { WarehouseInventoryController } from './inventory/warehouse-inventory.controller';
import { WarehouseInventoryService } from './inventory/warehouse-inventory.service';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';

/** Warehouse portal API (/warehouse/*). Later warehouse features register their controllers here. */
@Module({
  imports: [PrismaModule],
  controllers: [WarehouseController, WarehouseInventoryController],
  providers: [WarehouseService, WarehouseInventoryService],
})
export class WarehouseModule {}
