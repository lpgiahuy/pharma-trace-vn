import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WH_ALL, WH_MANAGER } from '../../common/warehouse-roles';
import { WarehouseStaffQueryDto } from './dto/warehouse-staff-query.dto';
import { WarehouseService } from './warehouse.service';

@ApiTags('Warehouse - Staff')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly warehouse: WarehouseService) {}

  @Get('me')
  @Roles(...WH_ALL)
  @ApiOperation({ summary: 'Get the signed-in warehouse employee and the warehouse they work at' })
  async me(@CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.warehouse.me(user) };
  }

  @Get('staff')
  @Roles(...WH_MANAGER)
  @ApiOperation({ summary: 'List the employees of your warehouse (read-only). SUPER_ADMIN may pass facilityId.' })
  async staff(@Query() query: WarehouseStaffQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, ...await this.warehouse.staff(user, query) };
  }
}
