import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { StockTransferController, WarehouseTransfersController } from './stock-transfer.controller';
import { StockTransferService } from './stock-transfer.service';

@Module({
  imports: [PrismaModule],
  controllers: [StockTransferController, WarehouseTransfersController],
  providers: [StockTransferService],
})
export class StockTransferModule {}
