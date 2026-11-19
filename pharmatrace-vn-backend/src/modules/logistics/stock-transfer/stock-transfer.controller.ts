import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { WH_ALL } from '../../../common/warehouse-roles';
import { WarehouseFacilityQueryDto } from '../../warehouse/inventory/dto/warehouse-inventory-query.dto';
import { CreateStockTransferRequestDto, StockTransferDecisionDto } from './dto/stock-transfer.dto';
import { StockTransferService } from './stock-transfer.service';

const MANAGERS = ['WAREHOUSE_MANAGER', 'STORE_MANAGER'];

@ApiTags('Logistics - Stock Transfers')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('logistics/stock-transfers')
export class StockTransferController {
  constructor(private readonly stockTransfers: StockTransferService) {}

  @Get()
  @Roles(...WH_ALL, 'STORE_MANAGER', 'PHARMACIST')
  @ApiOperation({ summary: 'List stock transfer requests from or to your facility' })
  async list(@CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.stockTransfers.list(user) };
  }

  @Post()
  @Roles(...MANAGERS)
  @ApiOperation({ summary: 'Request stock for your facility from another facility' })
  async create(@Body() dto: CreateStockTransferRequestDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.stockTransfers.create(user, dto) };
  }

  @Post(':id/approve')
  @Roles(...MANAGERS)
  @ApiOperation({ summary: 'Approve as the sending facility manager: reserves stock and creates the transfer' })
  async approve(@Param('id', ParseIntPipe) id: number, @Body() dto: StockTransferDecisionDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.stockTransfers.decide(user, id, 'APPROVE', dto.note) };
  }

  @Post(':id/reject')
  @Roles(...MANAGERS)
  @ApiOperation({ summary: 'Reject as the sending facility manager' })
  async reject(@Param('id', ParseIntPipe) id: number, @Body() dto: StockTransferDecisionDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.stockTransfers.decide(user, id, 'REJECT', dto.note) };
  }

  @Post(':id/cancel')
  @Roles(...MANAGERS)
  @ApiOperation({ summary: 'Cancel before dispatch; releases reserved stock' })
  async cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: StockTransferDecisionDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.stockTransfers.decide(user, id, 'CANCEL', dto.note) };
  }
}

@ApiTags('Warehouse - Transfers')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WH_ALL)
@Controller('warehouse')
export class WarehouseTransfersController {
  constructor(private readonly stockTransfers: StockTransferService) {}

  @Get('transfers')
  @ApiOperation({ summary: 'List outgoing and incoming transfers of the warehouse' })
  async list(@Query() query: WarehouseFacilityQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.stockTransfers.warehouseTransfers(user, query) };
  }
}
