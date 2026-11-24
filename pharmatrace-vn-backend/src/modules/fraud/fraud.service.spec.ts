import { PrismaService } from '../../prisma/prisma.service';
import { FraudRadarAlert, FraudService } from './fraud.service';

type Run = (tx: unknown) => Promise<unknown>;

const admin = { id: 1, role: 'SUPER_ADMIN', type: 'employee' };

describe('FraudService', () => {
  it('merges the scan counters, the alert counters and the latest alerts', async () => {
    const alert = { id: 3, fraudType: 'IMPOSSIBLE_TRAVEL', severity: 'CRITICAL', speedKmh: 4000 } as FraudRadarAlert;
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ scans24h: 40, suspicious24h: 5 }])
        .mockResolvedValueOnce([{ openAlerts: 2, criticalAlerts: 1 }])
        .mockResolvedValueOnce([alert]),
    };
    const prisma = { withTraceability: jest.fn((_actor: unknown, run: Run) => run(tx)) };
    const service = new FraudService(prisma as unknown as PrismaService);

    await expect(service.report(admin)).resolves.toEqual({ scans24h: 40, suspicious24h: 5, openAlerts: 2, criticalAlerts: 1, alerts: [alert] });
    expect(prisma.withTraceability).toHaveBeenCalledWith(expect.objectContaining({ id: 1, role: 'SUPER_ADMIN' }), expect.any(Function));
  });
});
