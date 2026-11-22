import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { REPORT_READ } from '../../common/report-roles';
import { ReportRangeDto, RevenueSeriesDto } from './dto/report-query.dto';
import { ReportService } from './report.service';

@ApiTags('Admin - Reports')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...REPORT_READ)
@Controller('admin/reports')
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Sales KPIs for the range and the previous period of the same length' })
  async overview(@Query() query: ReportRangeDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.reports.overview(user, query) };
  }

  @Get('revenue')
  @ApiOperation({ summary: 'Revenue, refunds, orders and new customers per day or month; empty buckets are 0' })
  async revenue(@Query() query: RevenueSeriesDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.reports.revenue(user, query) };
  }

  @Get('order-status')
  @ApiOperation({ summary: 'Order count and amount per order status' })
  async orderStatus(@Query() query: ReportRangeDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.reports.orderStatus(user, query) };
  }
}
