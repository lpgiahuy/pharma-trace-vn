import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WH_ALL } from '../../common/warehouse-roles';
import { WarehouseFacilityQueryDto } from '../warehouse/inventory/dto/warehouse-inventory-query.dto';
import { CloseRecallDto, CollectRecallDto, CreateRecallDto } from './dto/recall.dto';
import { RecallService } from './recall.service';

@ApiTags('Admin - Recalls')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@Controller('admin/recalls')
export class AdminRecallController {
  constructor(private readonly recalls: RecallService) {}

  @Post()
  @ApiOperation({ summary: 'Recall batches: mark them RECALLED and quarantine their stock at every facility' })
  async create(@Body() dto: CreateRecallDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.recalls.create(user, dto) };
  }

  @Get()
  @ApiOperation({ summary: 'List recalls' })
  async list(@CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.recalls.list(user) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'One recall with its batches, collection transfers and events' })
  async detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.recalls.detail(user, id) };
  }

  @Get(':id/impact')
  @ApiOperation({ summary: 'Where every box of the recalled batches is: facility, in transit or delivered to which customer and order' })
  async impact(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.recalls.impact(user, id) };
  }

  @Post(':id/collect')
  @ApiOperation({ summary: 'Create RECALL_COLLECTION transfers from every facility holding recalled stock to a warehouse' })
  async collect(@Param('id', ParseIntPipe) id: number, @Body() dto: CollectRecallDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.recalls.collect(user, id, dto) };
  }

  @Post(':id/close')
  @ApiOperation({ summary: 'Close a recall once every collection transfer is finished' })
  async close(@Param('id', ParseIntPipe) id: number, @Body() dto: CloseRecallDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.recalls.close(user, id, dto) };
  }
}

@ApiTags('Warehouse - Recalls')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WH_ALL, 'STORE_MANAGER')
@Controller('warehouse/recalls')
export class WarehouseRecallController {
  constructor(private readonly recalls: RecallService) {}

  @Get()
  @ApiOperation({ summary: 'Recall tasks of your facility: stock to collect, collection transfers and orders to resolve' })
  async tasks(@Query() query: WarehouseFacilityQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.recalls.tasks(user, query) };
  }
}
