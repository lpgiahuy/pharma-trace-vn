import { Module } from '@nestjs/common';
import { InternalTransferModule } from './internal-transfer/internal-transfer.module';
import { ShipmentModule } from './shipment/shipment.module';
import { StockTransferModule } from './stock-transfer/stock-transfer.module';

@Module({
  imports: [InternalTransferModule, ShipmentModule, StockTransferModule],
  exports: [InternalTransferModule, ShipmentModule],
})
export class LogisticsModule {}
