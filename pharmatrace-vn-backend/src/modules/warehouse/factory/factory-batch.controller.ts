import { Body, Controller, Get, Header, Param, ParseIntPipe, Post, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { FACTORY_INTAKE, WH_ALL } from '../../../common/warehouse-roles';
import { CreateFactoryBatchDto, FactoryFacilityQueryDto, ProductionReportQueryDto, VoidFactoryBatchDto } from './dto/factory-batch.dto';
import { FactoryBatchService } from './factory-batch.service';

@ApiTags('Warehouse - Factory Batches')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...FACTORY_INTAKE)
@Controller('warehouse/batches')
export class FactoryBatchController {
  constructor(private readonly batches: FactoryBatchService) {}

  @Post()
  @ApiOperation({ summary: 'Register a finished-goods batch with signed boxes and SSCC cartons and add it to factory stock' })
  async create(@Body() dto: CreateFactoryBatchDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.batches.create(user, dto) };
  }

  @Post(':id/void')
  @ApiOperation({ summary: 'Void a factory batch registered by mistake while all its boxes are still untouched at the factory' })
  async void(@Param('id', ParseIntPipe) id: number, @Body() dto: VoidFactoryBatchDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.batches.void(user, id, dto) };
  }

  @Get(':id/labels')
  @Roles(...FACTORY_INTAKE, ...WH_ALL)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Download the box UIDs, SSCC codes and secret codes of a batch as CSV for label printing: the factory that made it, or the warehouse that received it from an outside manufacturer' })
  async labels(@Param('id', ParseIntPipe) id: number, @Query() query: FactoryFacilityQueryDto, @CurrentUser() user: CurrentUserPayload) {
    const csv = await this.batches.labels(user, id, query);
    return new StreamableFile(Buffer.from(csv), { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="batch-${id}-labels.csv"` });
  }
}

@ApiTags('Warehouse - Factory Reports')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...FACTORY_INTAKE)
@Controller('warehouse/factory-reports')
export class FactoryReportController {
  constructor(private readonly batches: FactoryBatchService) {}

  @Get('production')
  @ApiOperation({ summary: 'Batches and boxes the factory produced between two production dates, per day or month and per medicine' })
  async production(@Query() query: ProductionReportQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.batches.productionReport(user, query) };
  }
}
