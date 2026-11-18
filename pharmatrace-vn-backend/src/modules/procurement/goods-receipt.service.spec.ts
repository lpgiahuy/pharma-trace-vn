import { Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { GoodsReceiptDto } from './dto/goods-receipt.dto';
import { GoodsReceiptService, ReceiptUpload } from './goods-receipt.service';

type Run = (tx: unknown) => Promise<unknown>;

jest.mock('sharp', () => () => ({
  rotate: () => ({ resize: () => ({ webp: () => ({ toBuffer: () => Promise.resolve(Buffer.from('webp')) }) }) }),
}));

function setup() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 12 }]),
    goods_receipts: { findFirst: jest.fn().mockResolvedValue({ id: 12, po_id: 5 }) },
    goods_receipt_attachments: {
      create: jest.fn().mockResolvedValue({ id: 3 }),
      findFirst: jest.fn().mockResolvedValue({ image_reference: 'private/1' }),
    },
  };
  const prisma = { withPurchaseOrder: jest.fn((_actor: unknown, run: Run) => run(tx)) };
  const cloudinary = {
    uploadPrivateImage: jest.fn().mockResolvedValue({ publicId: 'private/1' }),
    deletePrivateImage: jest.fn().mockResolvedValue(undefined),
    downloadPrivateImage: jest.fn().mockResolvedValue(Buffer.from('image')),
  };
  const service = new GoodsReceiptService(prisma as unknown as PrismaService, cloudinary as unknown as CloudinaryService);
  return { tx, prisma, cloudinary, service };
}

async function failure(promise: Promise<unknown>): Promise<{ code?: string; details?: Record<string, unknown> }> {
  try { await promise; } catch (error) {
    return error instanceof AppException ? { code: error.code, details: error.details } : { code: 'OTHER' };
  }
  return {};
}

function databaseError(code: string, message: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Raw query failed', { code: 'P2010', clientVersion: 'test', meta: { code, message } });
}

const staff = { id: 5, role: 'WAREHOUSE_STAFF', type: 'employee', facilityId: 7 };
const box = '0F8FAD5B-D9CB-469F-A165-70867728950E';

const dto: GoodsReceiptDto = {
  receiptCode: 'GR-20261118-0001',
  note: '  Morning truck ',
  lines: [{
    poItemId: 31, batchNumber: ' LOT-1 ', productionDate: '2026-01-01', expiryDate: '2028-01-01',
    boxUids: [box], rejectedBoxUids: [], ssccCodes: [' SSCC-1 '], rejectReason: '  ',
  }],
};

describe('GoodsReceiptService.receive', () => {
  it('sends normalized lines to record_goods_receipt and returns the stored receipt', async () => {
    const { tx, service } = setup();
    await expect(service.receive(staff, 5, dto)).resolves.toEqual({ id: 12, po_id: 5 });
    const values = tx.$queryRaw.mock.calls[0].slice(1) as unknown[];
    expect(values.slice(0, 3)).toEqual([5, 'GR-20261118-0001', 'Morning truck']);
    expect(JSON.parse(values[3] as string)).toEqual([{
      poItemId: 31, batchNumber: 'LOT-1', productionDate: '2026-01-01', expiryDate: '2028-01-01', certificateCoCq: null,
      boxUids: [box.toLowerCase()], ssccCodes: ['SSCC-1'], rejectedBoxUids: [], rejectReason: null,
    }]);
    expect(tx.goods_receipts.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 12, po_id: 5 } }));
  });

  it.each([
    ['GR_OVER_RECEIPT', 'GR_OVER_RECEIPT', undefined],
    ['GR_PO_NOT_RECEIVABLE', 'GR_PO_NOT_RECEIVABLE', undefined],
    [`GR_BOX_WRONG_BATCH ${box.toLowerCase()}`, 'GR_BOX_WRONG_BATCH', { value: box.toLowerCase() }],
    ['GR_BATCH_MEDICINE_MISMATCH LOT-1', 'GR_BATCH_MEDICINE_MISMATCH', { value: 'LOT-1' }],
    ['PO_NOT_FOUND', 'PO_NOT_FOUND', undefined],
  ])('maps the database error %s', async (message, code, details) => {
    const { tx, service } = setup();
    tx.$queryRaw.mockRejectedValue(databaseError('22023', message));
    expect(await failure(service.receive(staff, 5, dto))).toEqual({ code, details });
  });

  it('maps racing duplicates of the receipt code and of new boxes', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockRejectedValueOnce(databaseError('23505', 'duplicate key value violates unique constraint "goods_receipts_receipt_code_key"'));
    expect((await failure(service.receive(staff, 5, dto))).code).toBe('GR_CODE_CONFLICT');
    tx.$queryRaw.mockRejectedValueOnce(databaseError('23505', 'duplicate key value violates unique constraint "medicine_boxes_pkey"'));
    expect((await failure(service.receive(staff, 5, dto))).code).toBe('GR_BOX_UNAVAILABLE');
    tx.$queryRaw.mockRejectedValueOnce(databaseError('42501', 'GR_FORBIDDEN'));
    expect((await failure(service.receive(staff, 5, dto))).code).toBe('GR_FORBIDDEN');
  });

  it('passes unrelated errors through', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockRejectedValue(new Error('connection lost'));
    await expect(service.receive(staff, 5, dto)).rejects.toThrow('connection lost');
  });
});

describe('GoodsReceiptService.detail', () => {
  it('reports a receipt of another order as missing', async () => {
    const { tx, service } = setup();
    tx.goods_receipts.findFirst.mockResolvedValue(null);
    expect((await failure(service.detail(staff, 5, 99))).code).toBe('GR_NOT_FOUND');
  });
});

describe('GoodsReceiptService attachments', () => {
  const image: ReceiptUpload = { buffer: Buffer.from('jpeg'), mimetype: 'image/jpeg', size: 4 };
  const receipt = { id: 12, goods_receipt_lines: [{ batch_id: 40 }], _count: { goods_receipt_attachments: 0 } };

  it('stores a private image for a batch received in the receipt', async () => {
    const { tx, service, cloudinary } = setup();
    tx.goods_receipts.findFirst.mockResolvedValue(receipt);
    await service.addAttachment(staff, 5, 12, image, { kind: 'CO_CQ', batchId: 40 });
    expect(cloudinary.uploadPrivateImage).toHaveBeenCalledWith(Buffer.from('webp'), 'pharmatrace/goods-receipts');
    expect(tx.goods_receipt_attachments.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { receipt_id: 12, kind: 'CO_CQ', batch_id: 40, image_reference: 'private/1', uploaded_by_id: 5 },
    }));
  });

  it('rejects files that are not small images before uploading', async () => {
    const { service, cloudinary } = setup();
    expect((await failure(service.addAttachment(staff, 5, 12, { ...image, mimetype: 'application/pdf' }, { kind: 'PHOTO' }))).code).toBe('GR_ATTACHMENT_INVALID');
    expect((await failure(service.addAttachment(staff, 5, 12, undefined, { kind: 'PHOTO' }))).code).toBe('GR_ATTACHMENT_INVALID');
    expect(cloudinary.uploadPrivateImage).not.toHaveBeenCalled();
  });

  it.each([
    ['GR_NOT_FOUND', null, undefined],
    ['GR_ATTACHMENT_LIMIT', { ...receipt, _count: { goods_receipt_attachments: 20 } }, undefined],
    ['GR_ATTACHMENT_BATCH_INVALID', receipt, 41],
  ])('removes the uploaded image when the attachment is refused with %s', async (code, found, batchId) => {
    const { tx, service, cloudinary } = setup();
    tx.goods_receipts.findFirst.mockResolvedValue(found);
    expect((await failure(service.addAttachment(staff, 5, 12, image, { kind: 'CO_CQ', batchId }))).code).toBe(code);
    expect(cloudinary.deletePrivateImage).toHaveBeenCalledWith('private/1');
    expect(tx.goods_receipt_attachments.create).not.toHaveBeenCalled();
  });

  it('downloads an attachment only through its receipt and order', async () => {
    const { tx, service, cloudinary } = setup();
    await expect(service.attachment(staff, 5, 12, 3)).resolves.toEqual(Buffer.from('image'));
    expect(tx.goods_receipt_attachments.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 3, receipt_id: 12, goods_receipts: { po_id: 5 } },
    }));
    expect(cloudinary.downloadPrivateImage).toHaveBeenCalledWith('private/1');
    tx.goods_receipt_attachments.findFirst.mockResolvedValue(null);
    expect((await failure(service.attachment(staff, 5, 12, 4))).code).toBe('GR_ATTACHMENT_NOT_FOUND');
  });
});
