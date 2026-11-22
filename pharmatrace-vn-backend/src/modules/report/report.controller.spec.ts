import { ArgumentMetadata, ExecutionContext, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ReportRangeDto, RevenueSeriesDto } from './dto/report-query.dto';
import { ReportController } from './report.controller';

const handlers = ['overview', 'revenue', 'orderStatus'] as const;

function context(handler: (typeof handlers)[number], user: { role: string; type: string }): ExecutionContext {
  return {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Inspect handler metadata without invoking the method.
    getHandler: () => ReportController.prototype[handler],
    getClass: () => ReportController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validate = (metatype: ArgumentMetadata['metatype'], value: Record<string, string>) => pipe.transform(value, { type: 'query', metatype });

describe('ReportController roles', () => {
  const guard = new RolesGuard(new Reflector());

  it.each(handlers)('%s allows admins, store managers and finance roles', handler => {
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'STORE_MANAGER', 'ACCOUNTANT', 'FINANCE_MANAGER']) {
      expect(guard.canActivate(context(handler, { role, type: 'employee' }))).toBe(true);
    }
  });

  it.each(handlers)('%s denies warehouse staff, pharmacists and customers', handler => {
    expect(guard.canActivate(context(handler, { role: 'WAREHOUSE_STAFF', type: 'employee' }))).toBe(false);
    expect(guard.canActivate(context(handler, { role: 'PHARMACIST', type: 'employee' }))).toBe(false);
    expect(guard.canActivate(context(handler, { role: 'CUSTOMER', type: 'customer' }))).toBe(false);
  });
});

describe('Report query DTOs', () => {
  it('accepts a range, facility and granularity', async () => {
    await expect(validate(RevenueSeriesDto, { from: '2026-11-01', to: '2026-11-30', facilityId: '3', granularity: 'month' }))
      .resolves.toEqual({ from: '2026-11-01', to: '2026-11-30', facilityId: 3, granularity: 'month' });
  });

  it.each([
    [{ from: '2026-11-1' }],
    [{ to: '2026-02-30' }],
    [{ facilityId: '0' }],
    [{ granularity: 'week' }],
    [{ status: 'PAID' }],
  ])('rejects %j', async query => {
    await expect(validate(RevenueSeriesDto, query)).rejects.toBeDefined();
  });

  it('does not accept granularity on the plain range', async () => {
    await expect(validate(ReportRangeDto, { granularity: 'day' })).rejects.toBeDefined();
  });
});
