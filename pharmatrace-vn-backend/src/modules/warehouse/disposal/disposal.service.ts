import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import sharp from 'sharp';
import { authActor } from '../../../common/auth-identity';
import { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { WH_QUALITY, warehouseScope } from '../../../common/warehouse-roles';
import { PrismaService } from '../../../prisma/prisma.service';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';
import { Page, pagination } from '../inventory/warehouse-inventory.service';
import { warehouseDatabase, warehouseError } from '../warehouse-errors';
import { CreateDisposalDto, DisposalCandidateQueryDto, DisposalQueryDto } from './dto/disposal.dto';

type Tx = Prisma.TransactionClient;
type Upload = { buffer: Buffer; mimetype: string; size: number };

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface DisposalSummary {
  id: number;
  disposalCode: string;
  facilityId: number;
  status: string;
  reason: string;
  createdById: number;
  createdAt: Date;
  approvedById: number | null;
  approvedAt: Date | null;
  completedById: number | null;
  completedAt: Date | null;
}

export interface DisposalListItem extends DisposalSummary { itemCount: number }

export interface DisposalCandidate {
  boxUid: string;
  batchId: number;
  batchNumber: string;
  medicineName: string | null;
  expiryDate: Date;
  source: string;
}

export interface DisposalItem {
  boxUid: string;
  batchId: number;
  batchNumber: string;
  medicineName: string | null;
  source: string;
}

export interface DisposalAttachment { id: number; uploadedById: number; createdAt: Date }

export interface DisposalEvent {
  action: string;
  fromStatus: string | null;
  toStatus: string;
  actorId: number;
  note: string | null;
  createdAt: Date;
}

export interface DisposalDetail extends DisposalSummary {
  items: DisposalItem[];
  attachments: DisposalAttachment[];
  events: DisposalEvent[];
}

const SUMMARY = Prisma.sql`d.id, d.disposal_code AS "disposalCode", d.facility_id AS "facilityId", d.status, d.reason,
  d.created_by_id AS "createdById", d.created_at AS "createdAt", d.approved_by_id AS "approvedById", d.approved_at AS "approvedAt",
  d.completed_by_id AS "completedById", d.completed_at AS "completedAt"`;

@Injectable()
export class DisposalService {
  constructor(private readonly prisma: PrismaService, private readonly cloudinary: CloudinaryService) {}

  async candidates(user: CurrentUserPayload, query: DisposalCandidateQueryDto): Promise<Page<DisposalCandidate>> {
    const facilityId = this.facility(user, query);
    const source = query.source ?? null;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return this.prisma.withDisposal(authActor(user), async tx => {
      const [[total], items] = await Promise.all([
        tx.$queryRaw<{ total: number }[]>`
          SELECT count(*)::integer AS total FROM public.disposal_candidates(${facilityId}::integer) c WHERE (${source}::text IS NULL OR c.source = ${source}::text)`,
        tx.$queryRaw<DisposalCandidate[]>`
          SELECT c.box_uid::text AS "boxUid", c.batch_id AS "batchId", c.batch_number AS "batchNumber", c.medicine_name AS "medicineName",
            c.expiry_date AS "expiryDate", c.source
          FROM public.disposal_candidates(${facilityId}::integer) c WHERE (${source}::text IS NULL OR c.source = ${source}::text)
          OFFSET ${(page - 1) * limit} LIMIT ${limit}`,
      ]);
      return { items, pagination: pagination(total.total, page, limit) };
    });
  }

  async list(user: CurrentUserPayload, query: DisposalQueryDto): Promise<Page<DisposalListItem>> {
    const facilityId = warehouseScope(user, query, WH_QUALITY);
    const status = query.status ?? null;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return this.prisma.withDisposal(authActor(user), async tx => {
      const [[total], items] = await Promise.all([
        tx.$queryRaw<{ total: number }[]>`
          SELECT count(*)::integer AS total FROM public.disposals d
          WHERE (${facilityId}::integer IS NULL OR d.facility_id = ${facilityId}::integer) AND (${status}::text IS NULL OR d.status = ${status}::text)`,
        tx.$queryRaw<DisposalListItem[]>`
          SELECT ${SUMMARY}, (SELECT count(*)::integer FROM public.disposal_items i WHERE i.disposal_id = d.id) AS "itemCount"
          FROM public.disposals d
          WHERE (${facilityId}::integer IS NULL OR d.facility_id = ${facilityId}::integer) AND (${status}::text IS NULL OR d.status = ${status}::text)
          ORDER BY d.id DESC OFFSET ${(page - 1) * limit} LIMIT ${limit}`,
      ]);
      return { items, pagination: pagination(total.total, page, limit) };
    });
  }

  detail(user: CurrentUserPayload, id: number): Promise<DisposalDetail> {
    return this.prisma.withDisposal(authActor(user), tx => this.load(tx, id));
  }

  async create(user: CurrentUserPayload, dto: CreateDisposalDto): Promise<DisposalDetail> {
    const facilityId = this.facility(user, dto);
    return warehouseDatabase(this.prisma.withDisposal(authActor(user), async tx => {
      const [row] = await tx.$queryRaw<{ id: number }[]>`
        SELECT public.create_disposal(${dto.disposalCode}::text, ${facilityId}::integer, ${dto.reason.trim()}::text, ${dto.boxUids}::uuid[]) AS id`;
      return this.load(tx, row.id);
    }));
  }

  async addAttachment(user: CurrentUserPayload, id: number, file: Upload | undefined): Promise<DisposalDetail> {
    const image = await this.normalizeImage(file);
    const uploaded = await this.cloudinary.uploadPrivateImage(image, 'pharmatrace/disposals');
    try {
      return await this.change(user, id, tx => tx.$executeRaw`SELECT public.add_disposal_attachment(${id}::integer, ${uploaded.publicId}::text)`);
    } catch (error) {
      await this.cloudinary.deletePrivateImage(uploaded.publicId);
      throw error;
    }
  }

  async attachment(user: CurrentUserPayload, id: number, attachmentId: number): Promise<Buffer> {
    const reference = await this.prisma.withDisposal(authActor(user), async tx => {
      const [row] = await tx.$queryRaw<{ reference: string }[]>`
        SELECT a.image_reference AS reference FROM public.disposal_attachments a WHERE a.id = ${attachmentId} AND a.disposal_id = ${id}`;
      return row?.reference;
    });
    if (!reference) throw warehouseError('DP_ATTACHMENT_NOT_FOUND');
    return this.cloudinary.downloadPrivateImage(reference);
  }

  approve(user: CurrentUserPayload, id: number): Promise<DisposalDetail> {
    return this.change(user, id, tx => tx.$executeRaw`SELECT public.approve_disposal(${id}::integer)`);
  }

  complete(user: CurrentUserPayload, id: number): Promise<DisposalDetail> {
    return this.change(user, id, tx => tx.$executeRaw`SELECT public.complete_disposal(${id}::integer)`);
  }

  cancel(user: CurrentUserPayload, id: number, reason: string): Promise<DisposalDetail> {
    return this.change(user, id, tx => tx.$executeRaw`SELECT public.cancel_disposal(${id}::integer, ${reason.trim()}::text)`);
  }

  private facility(user: CurrentUserPayload, query: { facilityId?: number }): number {
    const facilityId = warehouseScope(user, query, WH_QUALITY);
    if (facilityId === null) throw warehouseError('DP_FACILITY_REQUIRED');
    return facilityId;
  }

  private change(user: CurrentUserPayload, id: number, run: (tx: Tx) => Promise<unknown>): Promise<DisposalDetail> {
    return warehouseDatabase(this.prisma.withDisposal(authActor(user), async tx => {
      await run(tx);
      return this.load(tx, id);
    }));
  }

  private async load(tx: Tx, id: number): Promise<DisposalDetail> {
    const [disposal] = await tx.$queryRaw<DisposalSummary[]>`SELECT ${SUMMARY} FROM public.disposals d WHERE d.id = ${id}`;
    if (!disposal) throw warehouseError('DP_NOT_FOUND');
    const [items, attachments, events] = await Promise.all([
      tx.$queryRaw<DisposalItem[]>`
        SELECT i.box_uid::text AS "boxUid", i.batch_id AS "batchId", b.batch_number AS "batchNumber", m.medicine_name AS "medicineName", i.source
        FROM public.disposal_items i JOIN public.batches b ON b.id = i.batch_id LEFT JOIN public.medicines m ON m.id = b.medicine_id
        WHERE i.disposal_id = ${id} ORDER BY i.id`,
      tx.$queryRaw<DisposalAttachment[]>`
        SELECT id, uploaded_by_id AS "uploadedById", created_at AS "createdAt" FROM public.disposal_attachments WHERE disposal_id = ${id} ORDER BY id`,
      tx.$queryRaw<DisposalEvent[]>`
        SELECT action, from_status AS "fromStatus", to_status AS "toStatus", actor_id AS "actorId", note, created_at AS "createdAt"
        FROM public.disposal_events WHERE disposal_id = ${id} ORDER BY id`,
    ]);
    return { ...disposal, items, attachments, events };
  }

  private async normalizeImage(file: Upload | undefined): Promise<Buffer> {
    if (!file?.buffer?.length || file.size > MAX_IMAGE_BYTES || !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      throw warehouseError('DP_ATTACHMENT_INVALID');
    }
    try {
      return await sharp(file.buffer, { limitInputPixels: 40_000_000 }).rotate()
        .resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    } catch {
      throw warehouseError('DP_ATTACHMENT_INVALID');
    }
  }
}
