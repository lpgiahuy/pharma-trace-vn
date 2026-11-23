import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WH_ALL, WH_MANAGER, WH_READ } from '../../common/warehouse-roles';
import { ClosePurchaseOrderDto } from './dto/goods-receipt.dto';
import { CancelPurchaseOrderDto, PurchaseOrderDto, PurchaseOrderOptionsQueryDto, PurchaseOrderQueryDto } from './dto/purchase-order.dto';
import { PurchaseOrderService } from './purchase-order.service';

@ApiTags('Warehouse - Purchase Orders')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WH_ALL)
@Controller('warehouse/purchase-orders')
export class PurchaseOrderController {
  constructor(private readonly purchaseOrders: PurchaseOrderService) {}

  @Get()
  @Roles(...WH_READ)
  @ApiOperation({ summary: 'Purchase orders addressed to your warehouse, or asking your factory for stock' })
  async list(@Query() query: PurchaseOrderQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, ...await this.purchaseOrders.list(user, query) };
  }

  @Get('options')
  @ApiOperation({ summary: 'Suppliers and products to pick from when writing a purchase order' })
  async options(@Query() query: PurchaseOrderOptionsQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.purchaseOrders.options(user, query.search) };
  }

  @Get(':id')
  @Roles(...WH_READ)
  @ApiOperation({ summary: 'One purchase order with its lines and event history' })
  async detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.purchaseOrders.detail(user, id) };
  }

  @Post()
  @Roles(...WH_MANAGER)
  @ApiOperation({ summary: 'Create a purchase order in PENDING status' })
  async create(@Body() dto: PurchaseOrderDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.purchaseOrders.create(user, dto) };
  }

  @Patch(':id')
  @Roles(...WH_MANAGER)
  @ApiOperation({ summary: 'Replace supplier, date, note and lines of a PENDING purchase order' })
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: PurchaseOrderDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.purchaseOrders.update(user, id, dto) };
  }

  @Post(':id/approve')
  @Roles(...WH_MANAGER)
  @ApiOperation({ summary: 'Approve a PENDING purchase order' })
  async approve(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.purchaseOrders.approve(user, id) };
  }

  @Post(':id/cancel')
  @Roles(...WH_MANAGER)
  @ApiOperation({ summary: 'Cancel a purchase order that has not received any goods yet' })
  async cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: CancelPurchaseOrderDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.purchaseOrders.cancel(user, id, dto.reason) };
  }

  @Post(':id/close')
  @Roles(...WH_MANAGER)
  @ApiOperation({ summary: 'Close a partially received purchase order; the open quantity will not be delivered' })
  async close(@Param('id', ParseIntPipe) id: number, @Body() dto: ClosePurchaseOrderDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.purchaseOrders.close(user, id, dto.reason) };
  }
}
