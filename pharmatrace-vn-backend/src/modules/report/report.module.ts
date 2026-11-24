import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PayableController } from './payable.controller';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';

@Module({
  imports: [PrismaModule],
  controllers: [ReportController, PayableController],
  providers: [ReportService],
})
export class ReportModule {}
