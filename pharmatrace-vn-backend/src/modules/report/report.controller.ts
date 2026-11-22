import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { REPORT_READ, STOCK_READ, STOCK_THRESHOLD_WRITE } from '../../common/report-roles';
import {
  ExpiryAlertQueryDto, InventoryThresholdDto, ReportRangeDto, RevenueSeriesDto, StockAlertQueryDto, StockThresholdDto,
} from './dto/report-query.dto';
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

  @Get('stock-alerts')
  @Roles(...STOCK_READ)
  @ApiOperation({ summary: 'Out-of-stock and low-stock inventories by available quantity, with the default threshold' })
  async stockAlerts(@Query() query: StockAlertQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.reports.stockAlerts(user, query) };
  }

  @Get('expiry-alerts')
  @Roles(...STOCK_READ)
  @ApiOperation({ summary: 'Batches with boxes in stock that are expired or expire within the given days' })
  async expiryAlerts(@Query() query: ExpiryAlertQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.reports.expiryAlerts(user, query) };
  }

  @Patch('stock-thresholds/default')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Set the system default minimum stock quantity' })
  async setDefaultThreshold(@Body() body: StockThresholdDto, @CurrentUser() user: CurrentUserPayload) {
    await this.reports.setDefaultThreshold(user, body.quantity);
    return { success: true };
  }

  @Patch('stock-thresholds/:inventoryId')
  @Roles(...STOCK_THRESHOLD_WRITE)
  @ApiOperation({ summary: 'Set the minimum stock quantity of an inventory; null restores the default. Store managers: own facility only' })
  async setInventoryThreshold(
    @Param('inventoryId', ParseIntPipe) inventoryId: number,
    @Body() body: InventoryThresholdDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.reports.setInventoryThreshold(user, inventoryId, body.quantity);
    return { success: true };
  }
}
