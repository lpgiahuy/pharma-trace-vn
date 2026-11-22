import { Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app-exception';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { PrismaService } from '../../prisma/prisma.service';
import { TraceBox, TraceService } from './trace.service';

const UID = '3f1d6a52-8b1e-4c58-9a46-0d3a6f7b2c11';
const BATCH = 'LOT-2026-01';

process.env.QR_SECRET_KEY = 'test-secret';

const box: TraceBox = {
  uid: UID, medicineName: 'Paracetamol', manufacturer: 'PT Pharma', batchNumber: BATCH,
  productionDate: new Date('2026-01-01'), expiryDate: new Date('2028-01-01'), batchStatus: 'ACTIVE', boxStatus: 'IN_STOCK',
};

function setup() {
  const prisma = { $queryRaw: jest.fn() };
  return { prisma, service: new TraceService(prisma as unknown as PrismaService) };
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

describe('TraceService', () => {
  describe('history', () => {
    it('returns the box with its timeline', async () => {
      const { prisma, service } = setup();
      const timeline = [{ occurredAt: new Date('2026-02-01'), eventType: 'MANUFACTURED', facilityName: null }];
      prisma.$queryRaw.mockResolvedValueOnce([box]).mockResolvedValueOnce(timeline);
      await expect(service.history(UID)).resolves.toEqual({ box, timeline });
    });

    it('rejects an unknown box', async () => {
      const { prisma, service } = setup();
      prisma.$queryRaw.mockResolvedValue([]);
      expect(await failure(service.history(UID))).toBe('TR_BOX_NOT_FOUND');
    });
  });

  describe('verify', () => {
    it('accepts the code issued for the box, in any letter case', async () => {
      const { prisma, service } = setup();
      prisma.$queryRaw.mockResolvedValue([box]);
      const code = CryptoUtil.signBox(UID, BATCH);
      await expect(service.verify({ uid: UID, code })).resolves.toEqual({ uid: UID, valid: true });
      await expect(service.verify({ uid: UID, code: code.toUpperCase() })).resolves.toEqual({ uid: UID, valid: true });
    });

    it('rejects a code issued for another box or batch, and a malformed one', async () => {
      const { prisma, service } = setup();
      prisma.$queryRaw.mockResolvedValue([box]);
      const other = CryptoUtil.signBox('9a2b6c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6c', BATCH);
      const otherBatch = CryptoUtil.signBox(UID, 'LOT-2');
      for (const code of [other, otherBatch, 'abc']) {
        await expect(service.verify({ uid: UID, code })).resolves.toEqual({ uid: UID, valid: false });
      }
    });

    it('rejects an unknown box', async () => {
      const { prisma, service } = setup();
      prisma.$queryRaw.mockResolvedValue([]);
      expect(await failure(service.verify({ uid: UID, code: 'abc' }))).toBe('TR_BOX_NOT_FOUND');
    });
  });

  describe('scan', () => {
    it('returns the outcome recorded by the database', async () => {
      const { prisma, service } = setup();
      const outcome = { scanResult: 'SUSPICIOUS', riskScore: 80, reasons: ['IMPOSSIBLE_TRAVEL'] };
      prisma.$queryRaw.mockResolvedValue([outcome]);
      await expect(service.scan({ uid: UID, latitude: 21.0285, longitude: 105.8542 }, '1.2.3.4', 'agent')).resolves.toEqual(outcome);
    });

    it('maps database errors to API errors', async () => {
      const { prisma, service } = setup();
      prisma.$queryRaw.mockRejectedValueOnce(databaseError('TR_BOX_NOT_FOUND')).mockRejectedValueOnce(databaseError('TR_LOCATION_INVALID'));
      expect(await failure(service.scan({ uid: UID }, '1.2.3.4'))).toBe('TR_BOX_NOT_FOUND');
      expect(await failure(service.scan({ uid: UID, latitude: 21 }, '1.2.3.4'))).toBe('TR_LOCATION_INVALID');
    });
  });
});
