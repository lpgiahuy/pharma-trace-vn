import { Body, Controller, Get, Param, ParseIntPipe, Post, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WH_ALL } from '../../common/warehouse-roles';
import { GoodsReceiptDto, RECEIPT_ATTACHMENT_KINDS, ReceiptAttachmentDto } from './dto/goods-receipt.dto';
import { GoodsReceiptService, ReceiptUpload } from './goods-receipt.service';

@ApiTags('Warehouse - Goods Receipts')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WH_ALL)
@Controller('warehouse/purchase-orders/:id/receipts')
export class GoodsReceiptController {
  constructor(private readonly receipts: GoodsReceiptService) {}

  @Post()
  @ApiOperation({ summary: 'Receive scanned boxes and cartons against an approved purchase order' })
  async receive(@Param('id', ParseIntPipe) id: number, @Body() dto: GoodsReceiptDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.receipts.receive(user, id, dto) };
  }

  @Get(':receiptId')
  @ApiOperation({ summary: 'One goods receipt with its lines, scanned boxes, attachments and payable' })
  async detail(
    @Param('id', ParseIntPipe) id: number, @Param('receiptId', ParseIntPipe) receiptId: number, @CurrentUser() user: CurrentUserPayload,
  ) {
    return { success: true, data: await this.receipts.detail(user, id, receiptId) };
  }

  @Post(':receiptId/attachments')
  @ApiOperation({ summary: 'Attach a photo, delivery note or CO/CQ image to a goods receipt' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object', required: ['file', 'kind'],
      properties: { file: { type: 'string', format: 'binary' }, kind: { type: 'string', enum: [...RECEIPT_ATTACHMENT_KINDS] }, batchId: { type: 'integer' } },
    },
  })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } }))
  async addAttachment(
    @Param('id', ParseIntPipe) id: number, @Param('receiptId', ParseIntPipe) receiptId: number,
    @UploadedFile() file: ReceiptUpload | undefined, @Body() dto: ReceiptAttachmentDto, @CurrentUser() user: CurrentUserPayload,
  ) {
    return { success: true, data: await this.receipts.addAttachment(user, id, receiptId, file, dto) };
  }

  @Get(':receiptId/attachments/:attachmentId')
  @ApiOperation({ summary: 'Download a goods receipt attachment' })
  async attachment(
    @Param('id', ParseIntPipe) id: number, @Param('receiptId', ParseIntPipe) receiptId: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number, @CurrentUser() user: CurrentUserPayload,
  ) {
    return new StreamableFile(await this.receipts.attachment(user, id, receiptId, attachmentId), { type: 'image/webp', disposition: 'inline' });
  }
}
