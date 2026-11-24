import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser, CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { DISPOSAL_DECIDE, WH_QUALITY } from '../../../common/warehouse-roles';
import { CreateDisposalDto, DisposalCandidateQueryDto, DisposalQueryDto, DisposalReasonDto } from './dto/disposal.dto';
import { DisposalService } from './disposal.service';

type Upload = { buffer: Buffer; mimetype: string; size: number };

@ApiTags('Warehouse - Disposals')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WH_QUALITY)
@Controller('warehouse/disposals')
export class DisposalController {
  constructor(private readonly disposals: DisposalService) {}

  @Get('candidates')
  @ApiOperation({ summary: 'Expired, quarantined and recalled boxes of your warehouse that can be disposed of' })
  async candidates(@Query() query: DisposalCandidateQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, ...await this.disposals.candidates(user, query) };
  }

  @Get()
  @ApiOperation({ summary: 'Disposals of your warehouse' })
  async list(@Query() query: DisposalQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, ...await this.disposals.list(user, query) };
  }

  @Post()
  @ApiOperation({ summary: 'Draft a disposal from scanned boxes' })
  async create(@Body() dto: CreateDisposalDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.disposals.create(user, dto) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'One disposal with its boxes, attachments and event history' })
  async detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.disposals.detail(user, id) };
  }

  @Post(':id/approve')
  @Roles(...DISPOSAL_DECIDE)
  @ApiOperation({ summary: 'Approve a draft disposal' })
  async approve(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.disposals.approve(user, id) };
  }

  @Post(':id/attachments')
  @ApiOperation({ summary: 'Attach an image of the disposal record (JPG, PNG or WEBP, up to 8 MB)' })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } }))
  async addAttachment(@Param('id', ParseIntPipe) id: number, @UploadedFile() file: Upload | undefined, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.disposals.addAttachment(user, id, file) };
  }

  @Get(':id/attachments/:attachmentId')
  @ApiOperation({ summary: 'Download one attachment image' })
  async attachment(@Param('id', ParseIntPipe) id: number, @Param('attachmentId', ParseIntPipe) attachmentId: number, @CurrentUser() user: CurrentUserPayload) {
    return new StreamableFile(await this.disposals.attachment(user, id, attachmentId), { type: 'image/webp', disposition: 'inline' });
  }

  @Post(':id/complete')
  @Roles(...DISPOSAL_DECIDE)
  @ApiOperation({ summary: 'Complete an approved disposal that has an attachment: the boxes are destroyed and stock or quarantine drops' })
  async complete(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.disposals.complete(user, id) };
  }

  @Post(':id/cancel')
  @Roles(...DISPOSAL_DECIDE)
  @ApiOperation({ summary: 'Cancel a draft or approved disposal' })
  async cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: DisposalReasonDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.disposals.cancel(user, id, dto.reason) };
  }
}
