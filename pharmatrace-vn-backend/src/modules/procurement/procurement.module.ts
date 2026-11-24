import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { GoodsReceiptController } from './goods-receipt.controller';
import { GoodsReceiptService } from './goods-receipt.service';
import { PurchaseOrderController } from './purchase-order.controller';
import { PurchaseOrderService } from './purchase-order.service';

/** Purchase orders and goods receipts of the warehouse portal (/warehouse/purchase-orders). */
@Module({
  imports: [PrismaModule, CloudinaryModule],
  controllers: [PurchaseOrderController, GoodsReceiptController],
  providers: [PurchaseOrderService, GoodsReceiptService],
})
export class ProcurementModule {}
