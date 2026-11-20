import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminRecallController, WarehouseRecallController } from './recall.controller';
import { RecallService } from './recall.service';

@Module({
  imports: [PrismaModule],
  controllers: [AdminRecallController, WarehouseRecallController],
  providers: [RecallService],
})
export class RecallModule {}
