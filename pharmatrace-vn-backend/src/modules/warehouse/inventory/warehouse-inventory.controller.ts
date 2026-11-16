import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { WH_READ } from '../../../common/warehouse-roles';
import {
  WarehouseBatchQueryDto, WarehouseFacilityQueryDto, WarehouseInventoryLogQueryDto, WarehouseInventoryQueryDto,
} from './dto/warehouse-inventory-query.dto';
import { WarehouseInventoryService } from './warehouse-inventory.service';

@ApiTags('Warehouse - Inventory')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WH_READ)
@Controller('warehouse')
export class WarehouseInventoryController {
  constructor(private readonly inventory: WarehouseInventoryService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Stock, quarantine, expiring batch, transfer and packing counts for your warehouse' })
  async dashboard(@Query() query: WarehouseFacilityQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.inventory.dashboard(user, query) };
  }

  @Get('inventory')
  @ApiOperation({ summary: 'Stock, reserved, available and quarantine units per product' })
  async list(@Query() query: WarehouseInventoryQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, ...await this.inventory.inventory(user, query) };
  }

  @Get('inventory/logs')
  @ApiOperation({ summary: 'Stock movement history of your warehouse' })
  async logs(@Query() query: WarehouseInventoryLogQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, ...await this.inventory.logs(user, query) };
  }

  @Get('inventory/:variantId')
  @ApiOperation({ summary: 'One product with its in-stock boxes per batch' })
  async detail(
    @Param('variantId', ParseIntPipe) variantId: number, @Query() query: WarehouseFacilityQueryDto, @CurrentUser() user: CurrentUserPayload,
  ) {
    return { success: true, data: await this.inventory.inventoryDetail(user, variantId, query) };
  }

  @Get('quarantine')
  @ApiOperation({ summary: 'Quarantine balances and the latest quarantine movements' })
  async quarantine(@Query() query: WarehouseFacilityQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.inventory.quarantine(user, query) };
  }

  @Get('batches')
  @ApiOperation({ summary: 'Batches with boxes in stock at your warehouse' })
  async batches(@Query() query: WarehouseBatchQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, ...await this.inventory.batches(user, query) };
  }

  @Get('batches/expiring')
  @ApiOperation({ summary: 'Batches in stock that expire within `days` (default 30), expired ones included' })
  async expiring(@Query() query: WarehouseBatchQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, ...await this.inventory.batches(user, { ...query, days: query.days ?? 30 }) };
  }

  @Get('batches/:id')
  @ApiOperation({ summary: 'One batch with its box counts by status at your warehouse' })
  async batch(@Param('id', ParseIntPipe) id: number, @Query() query: WarehouseFacilityQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.inventory.batch(user, id, query) };
  }
}
