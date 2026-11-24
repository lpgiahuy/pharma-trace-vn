import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FraudService } from './fraud.service';

@ApiTags('Admin - Security')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@Controller('admin/security')
export class FraudController {
  constructor(private readonly fraud: FraudService) {}

  @Get('fraud')
  @ApiOperation({ summary: 'Scan counters and the latest fraud alerts, open ones first' })
  async report(@CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.fraud.report(user) };
  }
}
