import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportService, reportRange, toCsv } from './report.service';

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

  it('maps stock alerts and the default threshold', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([{
      inventory_id: 7, facility_id: 2, facility_name: 'Store 2', medicine_id: 5, medicine_name: 'Paracetamol', variant_id: 9,
      unit_name: 'Box', stock_quantity: 8, reserved_quantity: 5, available: 3, min_stock_quantity: null, threshold: 4, level: 'LOW_STOCK',
    }]).mockResolvedValueOnce([{ value: 4 }]);
    const data = await service.stockAlerts(manager, { facilityId: 9 });
    expect(data.defaultThreshold).toBe(4);
    expect(data.items).toEqual([{
      inventoryId: 7, facilityId: 2, facilityName: 'Store 2', medicineId: 5, medicineName: 'Paracetamol', variantId: 9, unitName: 'Box',
      stockQuantity: 8, reservedQuantity: 5, available: 3, minStockQuantity: null, threshold: 4, level: 'LOW_STOCK',
    }]);
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual([9]);
  });

  it('maps expiry alerts and defaults to 180 days', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([{
      batch_id: 3, batch_number: 'B-1', medicine_id: 5, medicine_name: 'Paracetamol', facility_id: 2, facility_name: 'Store 2', boxes: 12n,
      expiry_date: '2026-11-23', days_left: 1, level: 'LE_30', below_min_shelf_life: true,
    }]);
    await expect(service.expiryAlerts(manager, {})).resolves.toEqual({
      items: [{
        batchId: 3, batchNumber: 'B-1', medicineId: 5, medicineName: 'Paracetamol', facilityId: 2, facilityName: 'Store 2', boxes: 12,
        expiryDate: '2026-11-23', daysLeft: 1, level: 'LE_30', belowMinShelfLife: true,
      }],
    });
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual([null, 180]);
  });

  it('passes thresholds to the database functions', async () => {
    const { tx, service } = setup();
    const executeRaw = jest.fn().mockResolvedValue(0);
    Object.assign(tx, { $executeRaw: executeRaw });
    await service.setDefaultThreshold(manager, 6);
    await service.setInventoryThreshold(manager, 7, null);
    expect(executeRaw.mock.calls[0].slice(1)).toEqual([6]);
    expect(executeRaw.mock.calls[1].slice(1)).toEqual([7, null]);
  });

  it('turns an unknown inventory into 404', async () => {
    const { tx, service } = setup();
    Object.assign(tx, { $executeRaw: jest.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Raw query failed', { code: 'P2010', clientVersion: 'test', meta: { code: 'P0002' } })) });
    await expect(service.setInventoryThreshold(manager, 99, 1)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('splits the receivables into summary and detail rows', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([
      { row_type: 'SUMMARY', party_name: 'GHN', bucket: '8_15', row_count: 2n, amount: decimal('600.00'), shipment_id: null, order_id: null, order_code: null, doc_date: null, age_days: null },
      { row_type: 'DETAIL', party_name: 'GHN', bucket: '8_15', row_count: 1n, amount: decimal('200.00'), shipment_id: 4, order_id: 9, order_code: 'ORD-9', doc_date: '2026-11-14', age_days: 8 },
    ]);
    await expect(service.receivables(manager, { asOf: '2026-11-22' })).resolves.toEqual({
      asOf: '2026-11-22',
      summary: [{ party: 'GHN', bucket: '8_15', count: 2, amount: 600 }],
      details: [{ party: 'GHN', bucket: '8_15', amount: 200, shipmentId: 4, orderId: 9, orderCode: 'ORD-9', documentDate: '2026-11-14', ageDays: 8 }],
    });
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['2026-11-22']);
  });

  it('splits the payables into summary and detail rows', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([
      { row_type: 'SUMMARY', supplier_id: 3, supplier_name: 'Supplier', bucket: 'NO_DUE_DATE', row_count: 1n, amount: decimal('12800.00'), ap_id: null, po_id: null, po_code: null, due_date: null, days_overdue: null },
      { row_type: 'DETAIL', supplier_id: 3, supplier_name: 'Supplier', bucket: 'NO_DUE_DATE', row_count: 1n, amount: decimal('12800.00'), ap_id: 5, po_id: 8, po_code: 'PO-8', due_date: null, days_overdue: null },
    ]);
    const data = await service.payables(manager, {});
    expect(data.summary).toEqual([{ supplierId: 3, supplierName: 'Supplier', bucket: 'NO_DUE_DATE', count: 1, amount: 12800 }]);
    expect(data.details).toEqual([{ supplierId: 3, supplierName: 'Supplier', bucket: 'NO_DUE_DATE', amount: 12800, payableId: 5, poId: 8, poCode: 'PO-8', dueDate: null, daysOverdue: null }]);
    expect(tx.$queryRaw.mock.calls[0][1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('maps the cashbook balances, days and the requested page', async () => {
    const { tx, service } = setup();
    tx.$queryRaw
      .mockResolvedValueOnce([
        { row_type: 'SUMMARY', day: null, opening: decimal('380000.00'), income: decimal('300000.00'), expense: decimal('130000.00'), closing: decimal('550000.00'), entry_count: 41n },
        { row_type: 'DAY', day: '2026-11-01', opening: decimal('380000.00'), income: decimal('300000.00'), expense: decimal('50000.00'), closing: decimal('630000.00'), entry_count: null },
      ])
      .mockResolvedValueOnce([{
        id: 1, transaction_code: 'COD-SHIP-1', transaction_date: new Date('2026-10-31T17:30:00Z'), transaction_type: 'INCOME', category: 'COD', amount: decimal('300000.00'),
        payment_method: 'CASH', party_name: null, note: null, order_id: 9, order_code: 'ORD-9', po_id: null, po_code: null,
      }])
      .mockResolvedValueOnce([{ category: 'COD' }, { category: 'CUSTOMER_REFUND' }]);
    const data = await service.cashbook(manager, { from: '2026-11-01', to: '2026-11-03', paymentMethod: 'CASH', type: 'INCOME', category: 'COD', page: 3, pageSize: 20 });
    expect(data).toMatchObject({
      opening: 380000, totalIncome: 300000, totalExpense: 130000, closing: 550000, total: 41, page: 3, pageSize: 20,
      categories: ['COD', 'CUSTOMER_REFUND'],
      days: [{ day: '2026-11-01', income: 300000, expense: 50000, balance: 630000 }],
      entries: [{ code: 'COD-SHIP-1', date: '2026-10-31T17:30:00.000Z', type: 'INCOME', amount: 300000, orderCode: 'ORD-9', poCode: null }],
    });
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['2026-11-01', '2026-11-03', 'CASH', 'INCOME', 'COD']);
    expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual(['2026-11-01', '2026-11-03', 'CASH', 'INCOME', 20, 40, 'COD']);
  });

  it('exports every entry as CSV with a BOM, Vietnam time and escaped cells', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([{
      id: 1, transaction_code: 'REF-1', transaction_date: new Date('2026-10-31T17:30:00Z'), transaction_type: 'EXPENSE', category: 'CUSTOMER_REFUND', amount: decimal('50000.50'),
      payment_method: 'BANK_TRANSFER', party_name: 'Nguyễn, "Văn" A', note: 'line1\nline2', order_id: null, order_code: null, po_id: null, po_code: null,
    }]);
    const { filename, csv } = await service.cashbookCsv(manager, { from: '2026-11-01', to: '2026-11-30' });
    expect(filename).toBe('cashbook_2026-11-01_2026-11-30.csv');
    expect(csv).toBe(
      '\uFEFFDate,Code,Type,Category,Payment method,Party,Amount,Order,Purchase order,Note\r\n'
      + '2026-11-01 00:30:00,REF-1,EXPENSE,CUSTOMER_REFUND,BANK_TRANSFER,"Nguyễn, ""Văn"" A",50000.5,,,"line1\nline2"\r\n',
    );
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['2026-11-01', '2026-11-30', null, null, null, 0, null]);
  });

  it('turns a finance denial into 403', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Raw query failed', { code: 'P2010', clientVersion: 'test', meta: { code: '42501' } }));
    await expect(service.payables(manager, {})).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('toCsv', () => {
  it('starts with a BOM, ends rows with CRLF and leaves plain cells alone', () => {
    expect(toCsv([['a', 1, null]])).toBe('\uFEFFa,1,\r\n');
  });

  it('quotes commas, quotes and line breaks', () => {
    expect(toCsv([['a,b', 'say "hi"', 'x\r\ny']])).toBe('\uFEFF"a,b","say ""hi""","x\r\ny"\r\n');
  });

  it('neutralises text that Excel would run as a formula', () => {
    expect(toCsv([['=SUM(A1)', '+1', '-2', '@x', 'ok']])).toBe("\uFEFF'=SUM(A1),'+1,'-2,'@x,ok\r\n");
  });
});
