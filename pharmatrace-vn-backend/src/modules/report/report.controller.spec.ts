import { ArgumentMetadata, ExecutionContext, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  AgingQueryDto, CashbookExportQueryDto, CashbookQueryDto, ExpiryAlertQueryDto, InventoryThresholdDto, ReportRangeDto, RevenueSeriesDto,
  StockThresholdDto,
} from './dto/report-query.dto';
import { ReportController } from './report.controller';

const handlers = ['overview', 'revenue', 'orderStatus'] as const;
const stockReadHandlers = ['stockAlerts', 'expiryAlerts'] as const;
const financeHandlers = ['receivables', 'payables', 'cashbook', 'cashbookExport'] as const;
type Handler = (typeof handlers)[number] | (typeof stockReadHandlers)[number] | (typeof financeHandlers)[number]
  | 'setDefaultThreshold' | 'setInventoryThreshold';

function context(handler: Handler, user: { role: string; type: string }): ExecutionContext {
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

describe('ReportController stock roles', () => {
  const guard = new RolesGuard(new Reflector());
  const allowed = (handler: Handler, role: string) => guard.canActivate(context(handler, { role, type: 'employee' }));

  it.each(stockReadHandlers)('%s allows admins and store managers only', handler => {
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'STORE_MANAGER']) expect(allowed(handler, role)).toBe(true);
    for (const role of ['ACCOUNTANT', 'FINANCE_MANAGER', 'WAREHOUSE_STAFF', 'PHARMACIST']) expect(allowed(handler, role)).toBe(false);
  });

  it('lets only super admins change the default threshold', () => {
    expect(allowed('setDefaultThreshold', 'SUPER_ADMIN')).toBe(true);
    for (const role of ['ADMIN', 'STORE_MANAGER', 'ACCOUNTANT']) expect(allowed('setDefaultThreshold', role)).toBe(false);
  });

  it('lets super admins and store managers change an inventory threshold', () => {
    for (const role of ['SUPER_ADMIN', 'STORE_MANAGER']) expect(allowed('setInventoryThreshold', role)).toBe(true);
    for (const role of ['ADMIN', 'ACCOUNTANT', 'WAREHOUSE_STAFF']) expect(allowed('setInventoryThreshold', role)).toBe(false);
  });
});

describe('ReportController finance roles', () => {
  const guard = new RolesGuard(new Reflector());
  const allowed = (handler: Handler, role: string, type = 'employee') => guard.canActivate(context(handler, { role, type }));

  it.each(financeHandlers)('%s allows admins and finance roles only', handler => {
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'FINANCE_MANAGER']) expect(allowed(handler, role)).toBe(true);
    for (const role of ['STORE_MANAGER', 'WAREHOUSE_STAFF', 'PHARMACIST']) expect(allowed(handler, role)).toBe(false);
    expect(allowed(handler, 'CUSTOMER', 'customer')).toBe(false);
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

  it('accepts withinDays up to 180 with a facility', async () => {
    await expect(validate(ExpiryAlertQueryDto, { facilityId: '2', withinDays: '90' })).resolves.toEqual({ facilityId: 2, withinDays: 90 });
    await expect(validate(ExpiryAlertQueryDto, { withinDays: '181' })).rejects.toBeDefined();
    await expect(validate(ExpiryAlertQueryDto, { withinDays: '0' })).rejects.toBeDefined();
  });

  it('accepts a threshold of 0 or more, and null only for an inventory', async () => {
    const body = (metatype: ArgumentMetadata['metatype'], value: unknown) => pipe.transform(value, { type: 'body', metatype });
    await expect(body(StockThresholdDto, { quantity: 0 })).resolves.toEqual({ quantity: 0 });
    await expect(body(StockThresholdDto, { quantity: -1 })).rejects.toBeDefined();
    await expect(body(StockThresholdDto, { quantity: null })).rejects.toBeDefined();
    await expect(body(InventoryThresholdDto, { quantity: null })).resolves.toEqual({ quantity: null });
    await expect(body(InventoryThresholdDto, { quantity: 12 })).resolves.toEqual({ quantity: 12 });
    await expect(body(InventoryThresholdDto, {})).rejects.toBeDefined();
    await expect(body(InventoryThresholdDto, { quantity: 1.5 })).rejects.toBeDefined();
  });
});

describe('Finance query DTOs', () => {
  it('accepts an optional asOf day only', async () => {
    await expect(validate(AgingQueryDto, {})).resolves.toEqual({});
    await expect(validate(AgingQueryDto, { asOf: '2026-11-30' })).resolves.toEqual({ asOf: '2026-11-30' });
    await expect(validate(AgingQueryDto, { asOf: '2026-02-30' })).rejects.toBeDefined();
    await expect(validate(AgingQueryDto, { from: '2026-11-01' })).rejects.toBeDefined();
  });

  it('accepts cashbook filters and paging', async () => {
    await expect(validate(CashbookQueryDto, { from: '2026-11-01', to: '2026-11-30', paymentMethod: 'CASH', type: 'INCOME', category: 'COD', page: '2', pageSize: '50' }))
      .resolves.toEqual({ from: '2026-11-01', to: '2026-11-30', paymentMethod: 'CASH', type: 'INCOME', category: 'COD', page: 2, pageSize: 50 });
  });

  it.each([
    [CashbookQueryDto, { paymentMethod: 'CHEQUE' }],
    [CashbookQueryDto, { type: 'TRANSFER' }],
    [CashbookQueryDto, { page: '0' }],
    [CashbookQueryDto, { pageSize: '101' }],
    [CashbookQueryDto, { category: 'x'.repeat(51) }],
    [CashbookQueryDto, { facilityId: '3' }],
    [CashbookExportQueryDto, { page: '1' }],
  ])('rejects %j on %p', async (metatype, query) => {
    await expect(validate(metatype, query)).rejects.toBeDefined();
  });
});
