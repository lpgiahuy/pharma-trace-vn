import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FINANCE_READ, REPORT_READ, STOCK_READ, STOCK_THRESHOLD_WRITE } from '../../common/report-roles';
import {
  AgingQueryDto, CashbookExportQueryDto, CashbookQueryDto, ExpiryAlertQueryDto, InventoryThresholdDto, ReportRangeDto, RevenueSeriesDto,
  StockAlertQueryDto, StockThresholdDto,
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

  @Get('receivables')
  @Roles(...FINANCE_READ)
  @ApiOperation({ summary: 'Open courier COD and unpaid delivered online orders by age: 0-7, 8-15, 16-30 and over 30 days' })
  async receivables(@Query() query: AgingQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.reports.receivables(user, query) };
  }

  @Get('payables')
  @Roles(...FINANCE_READ)
  @ApiOperation({ summary: 'Supplier payables by due date: not due, 1-30, 31-60, over 60 days overdue, and no due date' })
  async payables(@Query() query: AgingQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.reports.payables(user, query) };
  }

  @Get('cashbook')
  @Roles(...FINANCE_READ)
  @ApiOperation({ summary: 'Opening and closing balance, daily income and expense, and a page of cashbook entries' })
  async cashbook(@Query() query: CashbookQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.reports.cashbook(user, query) };
  }

  @Get('cashbook/export')
  @Roles(...FINANCE_READ)
  @ApiOperation({ summary: 'Every cashbook entry of the range as a CSV file (UTF-8 with BOM)' })
  async cashbookExport(@Query() query: CashbookExportQueryDto, @CurrentUser() user: CurrentUserPayload) {
    const { filename, csv } = await this.reports.cashbookCsv(user, query);
    return new StreamableFile(Buffer.from(csv, 'utf8'), { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="${filename}"` });
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
