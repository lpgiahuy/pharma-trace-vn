import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { WH_ALL, WH_MANAGER } from '../../../common/warehouse-roles';
import { FraudAlertQueryDto, ResolveFraudAlertDto, ScanBoxDto, SsccParamDto } from './dto/traceability.dto';
import { TraceabilityService } from './traceability.service';

@ApiTags('Warehouse - Traceability')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WH_ALL)
@Controller('warehouse')
export class TraceabilityController {
  constructor(private readonly traceability: TraceabilityService) {}

  @Post('scan')
  @ApiOperation({ summary: 'Check a scanned box. A clean result never proves the box is authentic; anomalies need investigation.' })
  async scan(@Body() dto: ScanBoxDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.traceability.scan(user, dto) };
  }

  @Get('boxes/:uid/history')
  @ApiOperation({ summary: 'Timeline of one box from creation to disposal, oldest first' })
  async history(@Param('uid', ParseUUIDPipe) uid: string, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.traceability.history(user, uid) };
  }

  @Get('cartons/:sscc')
  @ApiOperation({ summary: 'One carton of your warehouse with its boxes' })
  async carton(@Param() params: SsccParamDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.traceability.carton(user, params.sscc) };
  }

  @Post('cartons/:sscc/unpack')
  @ApiOperation({ summary: 'Unpack a packaged carton so its boxes are handled one by one' })
  async unpack(@Param() params: SsccParamDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.traceability.unpack(user, params.sscc) };
  }

  @Get('fraud-alerts')
  @Roles(...WH_MANAGER)
  @ApiOperation({ summary: 'Fraud alerts raised by scans of your warehouse' })
  async alerts(@Query() query: FraudAlertQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, ...await this.traceability.alerts(user, query) };
  }

  @Patch('fraud-alerts/:id/resolve')
  @Roles(...WH_MANAGER)
  @ApiOperation({ summary: 'Resolve a fraud alert after investigating it' })
  async resolve(@Param('id', ParseIntPipe) id: number, @Body() dto: ResolveFraudAlertDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.traceability.resolve(user, id, dto.note) };
  }
}
