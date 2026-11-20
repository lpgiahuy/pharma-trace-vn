import { Prisma } from '@prisma/client';
import sharp from 'sharp';
import { AppException } from '../../../common/errors/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';
import { DisposalService } from './disposal.service';

type Run = (tx: unknown) => Promise<unknown>;

function setup() {
  const tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn().mockResolvedValue(1) };
  const prisma = { withDisposal: jest.fn((_actor: unknown, run: Run) => run(tx)) };
  const cloudinary = {
    uploadPrivateImage: jest.fn().mockResolvedValue({ publicId: 'pharmatrace/disposals/record-1' }),
    deletePrivateImage: jest.fn().mockResolvedValue(undefined),
    downloadPrivateImage: jest.fn().mockResolvedValue(Buffer.from('image')),
  };
  return { tx, prisma, cloudinary, service: new DisposalService(prisma as unknown as PrismaService, cloudinary as unknown as CloudinaryService) };
}

async function failure(promise: Promise<unknown>): Promise<string | undefined> {
  try { await promise; } catch (error) {
    return error instanceof AppException ? error.code : 'OTHER';
  }
  return undefined;
}

function databaseError(message: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Raw query failed', { code: 'P2010', clientVersion: 'test', meta: { code: '22023', message } });
}

const staff = { id: 5, role: 'WAREHOUSE_STAFF', type: 'employee', facilityId: 7 };
const manager = { id: 6, role: 'WAREHOUSE_MANAGER', type: 'employee', facilityId: 7 };
const admin = { id: 1, role: 'SUPER_ADMIN', type: 'employee' };
const nurse = { id: 9, role: 'PHARMACIST', type: 'employee', facilityId: 7 };

const BOX = '3f1d6a52-8b1e-4c58-9a46-0d3a6f7b2c11';
const summary = {
  id: 12, disposalCode: 'DSP-20261120-0001', facilityId: 7, status: 'DRAFT', reason: 'Expired', createdById: 5, createdAt: new Date(),
  approvedById: null, approvedAt: null, completedById: null, completedAt: null,
};

function loadsDetail(tx: ReturnType<typeof setup>['tx']) {
  tx.$queryRaw.mockResolvedValueOnce([summary]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
}

async function pngUpload() {
  const buffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } }).png().toBuffer();
  return { buffer, mimetype: 'image/png', size: buffer.length };
}

describe('DisposalService.create', () => {
  it('drafts the disposal at the warehouse of the employee and returns it', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([{ id: 12 }]);
    loadsDetail(tx);
    const detail = await service.create(staff, { disposalCode: 'DSP-20261120-0001', reason: ' Expired ', boxUids: [BOX] });
    expect(detail).toMatchObject({ id: 12, disposalCode: 'DSP-20261120-0001', items: [] });
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['DSP-20261120-0001', 7, 'Expired', [BOX]]);
  });

  it('requires SUPER_ADMIN to choose the warehouse', async () => {
    const { prisma, service } = setup();
    expect(await failure(service.create(admin, { disposalCode: 'DSP-20261120-0001', reason: 'Expired', boxUids: [BOX] }))).toBe('DP_FACILITY_REQUIRED');
    expect(prisma.withDisposal).not.toHaveBeenCalled();
  });

  it.each([
    ['an account outside the warehouse roles', nurse, {}, 'WAREHOUSE_ACCOUNT_REQUIRED'],
    ['another warehouse', staff, { facilityId: 8 }, 'WAREHOUSE_FACILITY_FORBIDDEN'],
  ])('rejects %s', async (_name, user, extra, code) => {
    const { prisma, service } = setup();
    expect(await failure(service.create(user, { disposalCode: 'DSP-20261120-0001', reason: 'Expired', boxUids: [BOX], ...extra }))).toBe(code);
    expect(prisma.withDisposal).not.toHaveBeenCalled();
  });

  it.each([
    ['DP_BOX_NOT_ELIGIBLE', 'DP_BOX_NOT_ELIGIBLE'],
    ['DP_CODE_CONFLICT', 'DP_CODE_CONFLICT'],
  ])('maps the database error %s', async (raised, code) => {
    const { tx, service } = setup();
    tx.$queryRaw.mockRejectedValueOnce(databaseError(raised));
    expect(await failure(service.create(staff, { disposalCode: 'DSP-20261120-0001', reason: 'Expired', boxUids: [BOX] }))).toBe(code);
  });
});

describe('DisposalService approval, completion and cancellation', () => {
  it.each([
    ['approve', (service: DisposalService) => service.approve(manager, 12), 'approve_disposal'],
    ['complete', (service: DisposalService) => service.complete(manager, 12), 'complete_disposal'],
    ['cancel', (service: DisposalService) => service.cancel(manager, 12, ' Wrong shelf '), 'cancel_disposal'],
  ])('%s calls the database function and returns the disposal', async (_name, run, fn) => {
    const { tx, service } = setup();
    loadsDetail(tx);
    expect(await run(service)).toMatchObject({ id: 12 });
    expect(tx.$executeRaw.mock.calls[0][0].join('')).toContain(fn);
  });

  it('passes the trimmed cancellation reason', async () => {
    const { tx, service } = setup();
    loadsDetail(tx);
    await service.cancel(manager, 12, ' Wrong shelf ');
    expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual([12, 'Wrong shelf']);
  });

  it('refuses completion without an attachment', async () => {
    const { tx, service } = setup();
    tx.$executeRaw.mockRejectedValueOnce(databaseError('DP_ATTACHMENT_REQUIRED'));
    expect(await failure(service.complete(manager, 12))).toBe('DP_ATTACHMENT_REQUIRED');
  });

  it.each(['DP_FORBIDDEN', 'DP_INVALID_TRANSITION', 'DP_BOX_CHANGED'])('maps %s', async raised => {
    const { tx, service } = setup();
    tx.$executeRaw.mockRejectedValueOnce(databaseError(raised));
    expect(await failure(service.approve(staff, 12))).toBe(raised);
  });

  it('reports a disposal that is not visible to the warehouse', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect(await failure(service.detail(staff, 99))).toBe('DP_NOT_FOUND');
  });
});

describe('DisposalService.addAttachment', () => {
  it('stores a converted private image and attaches it', async () => {
    const { tx, cloudinary, service } = setup();
    loadsDetail(tx);
    const detail = await service.addAttachment(staff, 12, await pngUpload());
    expect(detail.id).toBe(12);
    expect(cloudinary.uploadPrivateImage).toHaveBeenCalledWith(expect.any(Buffer), 'pharmatrace/disposals');
    expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual([12, 'pharmatrace/disposals/record-1']);
  });

  it.each([
    ['a missing file', undefined],
    ['a PDF', { buffer: Buffer.from('%PDF'), mimetype: 'application/pdf', size: 4 }],
    ['a file over 8 MB', { buffer: Buffer.from('x'), mimetype: 'image/png', size: 9 * 1024 * 1024 }],
    ['an image that cannot be decoded', { buffer: Buffer.from('not an image'), mimetype: 'image/png', size: 12 }],
  ])('rejects %s before uploading', async (_name, file) => {
    const { cloudinary, service } = setup();
    expect(await failure(service.addAttachment(staff, 12, file))).toBe('DP_ATTACHMENT_INVALID');
    expect(cloudinary.uploadPrivateImage).not.toHaveBeenCalled();
  });

  it('removes the uploaded image when the database refuses it', async () => {
    const { tx, cloudinary, service } = setup();
    tx.$executeRaw.mockRejectedValueOnce(databaseError('DP_ATTACHMENT_LIMIT'));
    expect(await failure(service.addAttachment(staff, 12, await pngUpload()))).toBe('DP_ATTACHMENT_LIMIT');
    expect(cloudinary.deletePrivateImage).toHaveBeenCalledWith('pharmatrace/disposals/record-1');
  });
});

describe('DisposalService.attachment', () => {
  it('downloads the image of an attachment of the disposal', async () => {
    const { tx, cloudinary, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([{ reference: 'pharmatrace/disposals/record-1' }]);
    expect((await service.attachment(staff, 12, 3)).toString()).toBe('image');
    expect(cloudinary.downloadPrivateImage).toHaveBeenCalledWith('pharmatrace/disposals/record-1');
  });

  it('reports an unknown attachment', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect(await failure(service.attachment(staff, 12, 3))).toBe('DP_ATTACHMENT_NOT_FOUND');
  });
});

describe('DisposalService.candidates and list', () => {
  it('lists the candidate boxes of the warehouse with paging', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([{ total: 45 }]).mockResolvedValueOnce([{ boxUid: BOX, source: 'EXPIRED' }]);
    const page = await service.candidates(staff, { source: 'EXPIRED', page: 2, limit: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.pagination).toEqual({ total: 45, page: 2, limit: 20, totalPages: 3 });
    expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual([7, 'EXPIRED', 'EXPIRED', 20, 20]);
  });

  it('requires SUPER_ADMIN to choose the warehouse for candidates', async () => {
    const { service } = setup();
    expect(await failure(service.candidates(admin, {}))).toBe('DP_FACILITY_REQUIRED');
  });

  it('refuses a manager listing another warehouse', async () => {
    const { prisma, service } = setup();
    expect(await failure(service.list(manager, { facilityId: 8 }))).toBe('WAREHOUSE_FACILITY_FORBIDDEN');
    expect(prisma.withDisposal).not.toHaveBeenCalled();
  });

  it('lets SUPER_ADMIN list all warehouses', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
    const page = await service.list(admin, {});
    expect(page.pagination.total).toBe(0);
    expect(tx.$queryRaw.mock.calls[1].slice(2, 6)).toEqual([null, null, null, null]);
  });
});
