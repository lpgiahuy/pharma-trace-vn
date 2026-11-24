import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { WH_ALL, WH_MANAGER } from '../../../common/warehouse-roles';
import {
  OpenStockCountDto, SaveStockCountLinesDto, StockAdjustmentDto, StockCountQueryDto, StockCountReasonDto,
} from './dto/stock-count.dto';
import { StockCountService } from './stock-count.service';

@ApiTags('Warehouse - Stock Counts')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WH_ALL)
@Controller('warehouse')
export class StockCountController {
  constructor(private readonly counts: StockCountService) {}

  @Get('stock-counts')
  @ApiOperation({ summary: 'Stock counts of your warehouse' })
  async list(@Query() query: StockCountQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, ...await this.counts.list(user, query) };
  }

  @Post('stock-counts')
  @Roles(...WH_MANAGER)
  @ApiOperation({ summary: 'Open a count of the whole warehouse, one medicine or one batch' })
  async open(@Body() dto: OpenStockCountDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.counts.open(user, dto) };
  }

  @Get('stock-counts/:id')
  @ApiOperation({ summary: 'One stock count with its lines and event history' })
  async detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.counts.detail(user, id) };
  }

  @Put('stock-counts/:id/lines')
  @ApiOperation({ summary: 'Enter or replace the counted quantity of batches while the count is open' })
  async saveLines(@Param('id', ParseIntPipe) id: number, @Body() dto: SaveStockCountLinesDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.counts.saveLines(user, id, dto) };
  }

  @Post('stock-counts/:id/submit')
  @ApiOperation({ summary: 'Submit a fully counted stock count for approval' })
  async submit(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.counts.submit(user, id) };
  }

  @Post('stock-counts/:id/approve')
  @Roles(...WH_MANAGER)
  @ApiOperation({ summary: 'Approve a submitted count and book the differences against the units on hand now' })
  async approve(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.counts.approve(user, id) };
  }

  @Post('stock-counts/:id/cancel')
  @Roles(...WH_MANAGER)
  @ApiOperation({ summary: 'Cancel an open or submitted count' })
  async cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: StockCountReasonDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.counts.cancel(user, id, dto.reason) };
  }

  @Post('inventory/adjustments')
  @Roles(...WH_MANAGER)
  @ApiOperation({ summary: 'Add or remove units of one batch with a reason' })
  async adjust(@Body() dto: StockAdjustmentDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.counts.adjust(user, dto) };
  }
}
