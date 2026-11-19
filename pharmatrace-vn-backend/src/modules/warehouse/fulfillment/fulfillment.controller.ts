import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { WH_ALL, WH_MANAGER } from '../../../common/warehouse-roles';
import { WarehouseFacilityQueryDto } from '../inventory/dto/warehouse-inventory-query.dto';
import { CompletePackingDto, CreatePackageDto, VoidPackageDto } from './dto/fulfillment.dto';
import { FulfillmentService } from './fulfillment.service';

@ApiTags('Warehouse - Fulfillment')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('warehouse')
export class FulfillmentController {
  constructor(private readonly fulfillment: FulfillmentService) {}

  @Get('fulfillment/queue')
  @Roles(...WH_ALL)
  @ApiOperation({ summary: 'List orders of the warehouse that are ready to pack, with packing progress' })
  async queue(@Query() query: WarehouseFacilityQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.fulfillment.queue(user, query) };
  }

  @Get('orders/:id/pick-list')
  @Roles(...WH_ALL)
  @ApiOperation({ summary: 'Suggest sellable boxes to pick for each unpacked order line, by FEFO' })
  async pickList(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.fulfillment.pickList(user, id) };
  }

  @Post('orders/:id/packages')
  @Roles(...WH_ALL)
  @ApiOperation({ summary: 'Pack scanned boxes of an order into a package' })
  async addPackage(@Param('id', ParseIntPipe) id: number, @Body() dto: CreatePackageDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.fulfillment.addPackage(user, id, dto) };
  }

  @Post('orders/:id/packing/complete')
  @Roles(...WH_ALL)
  @ApiOperation({ summary: 'Complete packing: take packed boxes out of stock and create the shipment' })
  async completePacking(@Param('id', ParseIntPipe) id: number, @Body() dto: CompletePackingDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.fulfillment.completePacking(user, id, dto) };
  }

  @Post('packages/:id/void')
  @Roles(...WH_MANAGER)
  @ApiOperation({ summary: 'Void a package before packing is completed so its boxes can be packed again' })
  async voidPackage(@Param('id', ParseIntPipe) id: number, @Body() dto: VoidPackageDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.fulfillment.voidPackage(user, id, dto) };
  }

  @Get('packages/:id/label')
  @Roles(...WH_ALL)
  @ApiOperation({ summary: 'Get the shipping label data of a package' })
  async label(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.fulfillment.label(user, id) };
  }
}
