import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { authActor } from '../../common/auth-identity';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { GoodsReceiptDto, ReceiptAttachmentDto } from './dto/goods-receipt.dto';
import { procurementDatabase, procurementError } from './procurement-errors';

type Tx = Prisma.TransactionClient;
export interface ReceiptUpload { buffer: Buffer; mimetype: string; size: number }

const MAX_ATTACHMENTS = 20;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const person = { select: { id: true, full_name: true } } as const;

const attachmentSelect = {
  id: true, kind: true, batch_id: true, created_at: true, uploaded_by: person,
} satisfies Prisma.goods_receipt_attachmentsSelect;

const receiptSelect = {
  id: true, receipt_code: true, po_id: true, facility_id: true, received_at: true, note: true,
  received_by: person,
  purchase_orders: { select: { po_code: true, status: true } },
  goods_receipt_lines: {
    select: {
      id: true, po_item_id: true, quantity_accepted: true, quantity_rejected: true, reject_reason: true,
      box_uids: true, rejected_box_uids: true,
      batches: { select: { id: true, batch_number: true, production_date: true, expiry_date: true, status: true } },
      purchase_order_items: {
        select: {
          variant_id: true, quantity: true, received_quantity: true, unit_price: true,
          medicines: { select: { medicine_name: true } }, packaging_variants: { select: { unit_name: true } },
        },
      },
    },
    orderBy: { id: 'asc' },
  },
  goods_receipt_attachments: { select: attachmentSelect, orderBy: { id: 'asc' } },
  accounts_payable: { select: { id: true, total_due_amount: true, paid_amount: true, status: true } },
} satisfies Prisma.goods_receiptsSelect;

export type GoodsReceiptDetail = Prisma.goods_receiptsGetPayload<{ select: typeof receiptSelect }>;
export type ReceiptAttachment = Prisma.goods_receipt_attachmentsGetPayload<{ select: typeof attachmentSelect }>;

interface ReceiptLinePayload {
  poItemId: number;
  shipped: boolean;
  missingBoxUids: string[];
  batchNumber: string | null;
  productionDate: string | null;
  expiryDate: string | null;
  certificateCoCq: string | null;
  boxUids: string[];
  ssccCodes: string[];
  rejectedBoxUids: string[];
  /** Secret code of every box whose UID the system issued: HMAC(uid, batch number), as for a factory batch. */
  signatures?: Record<string, string>;
  rejectReason: string | null;
}

const issueUids = (count: number) => Array.from({ length: count }, () => randomUUID());

@Injectable()
export class GoodsReceiptService {
  constructor(private readonly prisma: PrismaService, private readonly cloudinary: CloudinaryService) {}

  /** Records one delivery; resending the same receipt code returns the receipt created the first time. */
  receive(user: CurrentUserPayload, poId: number, dto: GoodsReceiptDto): Promise<GoodsReceiptDetail> {
    const lines: ReceiptLinePayload[] = dto.lines.map(line => {
      const payload: ReceiptLinePayload = {
        poItemId: line.poItemId,
        shipped: line.shipped === true,
        missingBoxUids: (line.missingBoxUids ?? []).map(uid => uid.toLowerCase()),
        batchNumber: line.batchNumber?.trim() ?? null,
        productionDate: line.productionDate ?? null,
        expiryDate: line.expiryDate ?? null,
        certificateCoCq: line.certificateCoCq?.trim() || null,
        boxUids: (line.boxUids ?? []).map(uid => uid.toLowerCase()),
        ssccCodes: (line.ssccCodes ?? []).map(code => code.trim()),
        rejectedBoxUids: (line.rejectedBoxUids ?? []).map(uid => uid.toLowerCase()),
        rejectReason: line.rejectReason?.trim() || null,
      };
      if (line.acceptedQuantity === undefined && line.rejectedQuantity === undefined) return payload;
      // Boxes from an outside manufacturer are counted, not scanned: the system issues their UIDs and secret codes.
      if (payload.shipped || payload.boxUids.length || payload.ssccCodes.length || payload.rejectedBoxUids.length || !payload.batchNumber) {
        throw procurementError('GR_LINE_INVALID');
      }
      payload.boxUids = issueUids(line.acceptedQuantity ?? 0);
      payload.rejectedBoxUids = issueUids(line.rejectedQuantity ?? 0);
      payload.signatures = Object.fromEntries([...payload.boxUids, ...payload.rejectedBoxUids].map(uid => [uid, CryptoUtil.signBox(uid, payload.batchNumber as string)]));
      return payload;
    });
    return procurementDatabase(this.prisma.withPurchaseOrder(authActor(user), async tx => {
      const [row] = await tx.$queryRaw<{ id: number }[]>`
        SELECT public.record_goods_receipt(${poId}::integer, ${dto.receiptCode}::text, ${dto.note?.trim() || null}::text,
          ${JSON.stringify(lines)}::jsonb) AS id`;
      return this.load(tx, poId, row.id);
    }));
  }

  detail(user: CurrentUserPayload, poId: number, receiptId: number): Promise<GoodsReceiptDetail> {
    return this.prisma.withPurchaseOrder(authActor(user), tx => this.load(tx, poId, receiptId));
  }

  async addAttachment(
    user: CurrentUserPayload, poId: number, receiptId: number, file: ReceiptUpload | undefined, dto: ReceiptAttachmentDto,
  ): Promise<ReceiptAttachment> {
    const actor = authActor(user);
    const image = await this.normalizeImage(file);
    const uploaded = await this.cloudinary.uploadPrivateImage(image, 'pharmatrace/goods-receipts');
    try {
      return await this.prisma.withPurchaseOrder(actor, async tx => {
        const receipt = await tx.goods_receipts.findFirst({
          where: { id: receiptId, po_id: poId },
          select: { id: true, goods_receipt_lines: { select: { batch_id: true } }, _count: { select: { goods_receipt_attachments: true } } },
        });
        if (!receipt) throw procurementError('GR_NOT_FOUND');
        if (receipt._count.goods_receipt_attachments >= MAX_ATTACHMENTS) throw procurementError('GR_ATTACHMENT_LIMIT');
        if (dto.batchId !== undefined && !receipt.goods_receipt_lines.some(line => line.batch_id === dto.batchId)) {
          throw procurementError('GR_ATTACHMENT_BATCH_INVALID');
        }
        return tx.goods_receipt_attachments.create({
          data: { receipt_id: receiptId, kind: dto.kind, batch_id: dto.batchId ?? null, image_reference: uploaded.publicId, uploaded_by_id: actor.id },
          select: attachmentSelect,
        });
      });
    } catch (error) {
      await this.cloudinary.deletePrivateImage(uploaded.publicId);
      throw error;
    }
  }

  async attachment(user: CurrentUserPayload, poId: number, receiptId: number, attachmentId: number): Promise<Buffer> {
    const found = await this.prisma.withPurchaseOrder(authActor(user), tx => tx.goods_receipt_attachments.findFirst({
      where: { id: attachmentId, receipt_id: receiptId, goods_receipts: { po_id: poId } },
      select: { image_reference: true },
    }));
    if (!found) throw procurementError('GR_ATTACHMENT_NOT_FOUND');
    return this.cloudinary.downloadPrivateImage(found.image_reference);
  }

  private async load(tx: Tx, poId: number, receiptId: number): Promise<GoodsReceiptDetail> {
    const receipt = await tx.goods_receipts.findFirst({ where: { id: receiptId, po_id: poId }, select: receiptSelect });
    if (!receipt) throw procurementError('GR_NOT_FOUND');
    return receipt;
  }

  private async normalizeImage(file?: ReceiptUpload): Promise<Buffer> {
    if (!file?.buffer?.length || file.size > MAX_UPLOAD_BYTES || !IMAGE_TYPES.includes(file.mimetype)) {
      throw procurementError('GR_ATTACHMENT_INVALID');
    }
    try {
      return await sharp(file.buffer, { limitInputPixels: 40_000_000 }).rotate()
        .resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    } catch {
      throw procurementError('GR_ATTACHMENT_INVALID');
    }
  }
}
