import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportService, reportRange } from './report.service';

type Run = (tx: unknown) => Promise<unknown>;

function setup() {
  const tx = { $queryRaw: jest.fn() };
  const prisma = { withReport: jest.fn((_actor: unknown, run: Run) => run(tx)) };
  return { tx, prisma, service: new ReportService(prisma as unknown as PrismaService) };
}

const manager = { id: 4, role: 'STORE_MANAGER', type: 'employee', facilityId: 2 };
const decimal = (value: string) => new Prisma.Decimal(value);

describe('reportRange', () => {
  it('defaults to the last 30 days ending today', () => {
    expect(reportRange({}, 'day', '2026-11-22')).toEqual({ from: '2026-10-24', to: '2026-11-22' });
  });

  it('rejects from after to', () => {
    expect(() => reportRange({ from: '2026-11-02', to: '2026-11-01' }, 'day')).toThrow(BadRequestException);
  });

  it('allows 366 days and 36 months, not more', () => {
    expect(reportRange({ from: '2024-01-01', to: '2024-12-31' }, 'day')).toEqual({ from: '2024-01-01', to: '2024-12-31' });
    expect(() => reportRange({ from: '2024-01-01', to: '2025-01-01' }, 'day')).toThrow('at most 366 days');
    expect(reportRange({ from: '2024-01-15', to: '2026-12-01' }, 'month')).toEqual({ from: '2024-01-15', to: '2026-12-01' });
    expect(() => reportRange({ from: '2024-01-15', to: '2027-01-01' }, 'month')).toThrow('at most 36 months');
  });
});

describe('ReportService', () => {
  it('maps the overview periods and NUMERIC/bigint values to numbers', async () => {
    const { tx, prisma, service } = setup();
    const row = {
      from: '2026-11-01', to: '2026-11-30', revenue: decimal('1700000.00'), collected_cash: decimal('1000000.00'), orders: 4n,
      cancelled_orders: 1n, new_customers: 2n, first_time_buyers: 2n, avg_order_value: decimal('566666.67'),
    };
    tx.$queryRaw.mockResolvedValueOnce([{ ...row, period: 'current' }, { ...row, period: 'previous', from: '2026-10-02', to: '2026-10-31' }]);
    const data = await service.overview(manager, { from: '2026-11-01', to: '2026-11-30', facilityId: 9 });
    expect(data.current).toEqual({
      from: '2026-11-01', to: '2026-11-30', revenue: 1700000, collectedCash: 1000000, orders: 4, cancelledOrders: 1,
      newCustomers: 2, firstTimeBuyers: 2, avgOrderValue: 566666.67,
    });
    expect(data.previous).toMatchObject({ from: '2026-10-02', to: '2026-10-31' });
    expect(prisma.withReport.mock.calls[0][0]).toMatchObject({ id: 4, role: 'STORE_MANAGER', facilityId: 2 });
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['2026-11-01', '2026-11-30', 9]);
  });

  it('passes the granularity and maps every bucket', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([{ bucket: '2026-11-01', revenue: decimal('0'), refunds: decimal('0'), orders: 0n, new_customers: 0n }]);
    const data = await service.revenue(manager, { from: '2026-11-01', to: '2026-11-30', granularity: 'month' });
    expect(data).toEqual({
      from: '2026-11-01', to: '2026-11-30', granularity: 'month',
      buckets: [{ bucket: '2026-11-01', revenue: 0, refunds: 0, orders: 0, newCustomers: 0 }],
    });
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['2026-11-01', '2026-11-30', 'month', null]);
  });

  it('maps order status rows', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([{ status: 'DELIVERED', count: 3n, amount: decimal('1250000.50') }]);
    await expect(service.orderStatus(manager, { from: '2026-11-01', to: '2026-11-01' }))
      .resolves.toEqual({ from: '2026-11-01', to: '2026-11-01', statuses: [{ status: 'DELIVERED', count: 3, amount: 1250000.5 }] });
  });

  it('turns a database role denial into 403', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Raw query failed', { code: 'P2010', clientVersion: 'test', meta: { code: '42501' } }));
    await expect(service.orderStatus(manager, {})).rejects.toBeInstanceOf(ForbiddenException);
  });
});
