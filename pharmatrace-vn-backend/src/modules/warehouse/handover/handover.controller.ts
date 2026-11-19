import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { WH_ALL } from '../../../common/warehouse-roles';
import { WarehouseFacilityQueryDto } from '../inventory/dto/warehouse-inventory-query.dto';
import { CreateHandoverDto } from './dto/handover.dto';
import { HandoverService } from './handover.service';

@ApiTags('Warehouse - Carrier Handover')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WH_ALL)
@Controller('warehouse')
export class HandoverController {
  constructor(private readonly handovers: HandoverService) {}

  @Get('handover/pending')
  @ApiOperation({ summary: 'List packed packages waiting for pickup, grouped by carrier' })
  async pending(@Query() query: WarehouseFacilityQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.handovers.pending(user, query) };
  }

  @Post('handovers')
  @ApiOperation({ summary: 'Hand scanned packages over to a carrier' })
  async create(@Body() dto: CreateHandoverDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.handovers.create(user, dto) };
  }

  @Get('handovers')
  @ApiOperation({ summary: 'List recent handovers of the warehouse' })
  async list(@Query() query: WarehouseFacilityQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.handovers.list(user, query) };
  }

  @Get('handovers/:id')
  @ApiOperation({ summary: 'Get a handover with its packages, for the printed manifest' })
  async detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.handovers.detail(user, id) };
  }
}
