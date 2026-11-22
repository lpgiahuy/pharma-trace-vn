import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FINANCE_READ, SUPPLIER_PAYMENT_WRITE } from '../../common/report-roles';
import { RecordSupplierPaymentDto } from './dto/supplier-payment.dto';
import { ReportService } from './report.service';

@ApiTags('Admin - Finance')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/finance/payables')
export class PayableController {
  constructor(private readonly reports: ReportService) {}

  @Post(':id/payments')
  @Roles(...SUPPLIER_PAYMENT_WRITE)
  @ApiOperation({ summary: 'Record a supplier payment: pays the payable down and writes a cashbook expense' })
  async record(@Param('id', ParseIntPipe) id: number, @Body() body: RecordSupplierPaymentDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.reports.recordSupplierPayment(user, id, body) };
  }

  @Get(':id/payments')
  @Roles(...FINANCE_READ)
  @ApiOperation({ summary: 'Payments recorded against one payable, newest first' })
  async history(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.reports.payablePayments(user, id) };
  }
}
