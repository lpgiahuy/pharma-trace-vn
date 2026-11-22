import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { authActor } from '../../common/auth-identity';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { workflowDatabase } from '../../common/workflow-database';
import { PrismaService } from '../../prisma/prisma.service';
import { ExpiryAlertQueryDto, ReportRangeDto, RevenueSeriesDto, StockAlertQueryDto } from './dto/report-query.dto';

type Granularity = 'day' | 'month';
type DbNumber = Prisma.Decimal | bigint | number;

const DAY_MS = 86_400_000;

interface OverviewRow {
  period: string; from: string; to: string; revenue: DbNumber; collected_cash: DbNumber; orders: DbNumber;
  cancelled_orders: DbNumber; new_customers: DbNumber; first_time_buyers: DbNumber; avg_order_value: DbNumber;
}
interface SeriesRow { bucket: string; revenue: DbNumber; refunds: DbNumber; orders: DbNumber; new_customers: DbNumber }
interface StatusRow { status: string; count: DbNumber; amount: DbNumber }
interface StockAlertRow {
  inventory_id: number; facility_id: number; facility_name: string; medicine_id: number; medicine_name: string; variant_id: number;
  unit_name: string; stock_quantity: number; reserved_quantity: number; available: number; min_stock_quantity: number | null;
  threshold: number; level: 'OUT_OF_STOCK' | 'LOW_STOCK';
}
interface ExpiryAlertRow {
  batch_id: number; batch_number: string; medicine_id: number; medicine_name: string; facility_id: number; facility_name: string;
  boxes: DbNumber; expiry_date: string; days_left: number; level: 'EXPIRED' | 'LE_30' | 'D31_90' | 'D91_180'; below_min_shelf_life: boolean;
}

const toNumber = (value: DbNumber): number => Number(value);

function vietnamToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
}

/** Defaults to the last 30 days; daily ranges are capped at 366 days, monthly ones at 36 months. */
export function reportRange(query: ReportRangeDto, granularity: Granularity, today = vietnamToday()) {
  const to = query.to ?? today;
  const from = query.from ?? new Date(Date.parse(to) - 29 * DAY_MS).toISOString().slice(0, 10);
  if (from > to) throw new BadRequestException('from must not be after to');
  const days = (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;
  const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
  if (granularity === 'day' && days > 366) throw new BadRequestException('A daily report covers at most 366 days');
  if (granularity === 'month' && months > 36) throw new BadRequestException('A monthly report covers at most 36 months');
  return { from, to };
}

@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(user: CurrentUserPayload, query: ReportRangeDto) {
    const { from, to } = reportRange(query, 'month');
    const rows = await workflowDatabase(this.prisma.withReport(authActor(user), tx => tx.$queryRaw<OverviewRow[]>`
      SELECT period, period_from::text AS "from", period_to::text AS "to", revenue, collected_cash, orders, cancelled_orders,
        new_customers, first_time_buyers, avg_order_value
      FROM public.report_sales_overview(${from}::date, ${to}::date, ${query.facilityId ?? null}::integer)`));
    return Object.fromEntries(rows.map(row => [row.period, {
      from: row.from,
      to: row.to,
      revenue: toNumber(row.revenue),
      collectedCash: toNumber(row.collected_cash),
      orders: toNumber(row.orders),
      cancelledOrders: toNumber(row.cancelled_orders),
      newCustomers: toNumber(row.new_customers),
      firstTimeBuyers: toNumber(row.first_time_buyers),
      avgOrderValue: toNumber(row.avg_order_value),
    }]));
  }

  async revenue(user: CurrentUserPayload, query: RevenueSeriesDto) {
    const granularity = query.granularity ?? 'day';
    const { from, to } = reportRange(query, granularity);
    const rows = await workflowDatabase(this.prisma.withReport(authActor(user), tx => tx.$queryRaw<SeriesRow[]>`
      SELECT bucket::text AS bucket, revenue, refunds, orders, new_customers
      FROM public.report_revenue_series(${from}::date, ${to}::date, ${granularity}, ${query.facilityId ?? null}::integer)`));
    return {
      from, to, granularity,
      buckets: rows.map(row => ({
        bucket: row.bucket,
        revenue: toNumber(row.revenue),
        refunds: toNumber(row.refunds),
        orders: toNumber(row.orders),
        newCustomers: toNumber(row.new_customers),
      })),
    };
  }

  async orderStatus(user: CurrentUserPayload, query: ReportRangeDto) {
    const { from, to } = reportRange(query, 'month');
    const rows = await workflowDatabase(this.prisma.withReport(authActor(user), tx => tx.$queryRaw<StatusRow[]>`
      SELECT status, count, amount FROM public.report_order_status(${from}::date, ${to}::date, ${query.facilityId ?? null}::integer)`));
    return { from, to, statuses: rows.map(row => ({ status: row.status, count: toNumber(row.count), amount: toNumber(row.amount) })) };
  }

  async stockAlerts(user: CurrentUserPayload, query: StockAlertQueryDto) {
    const { rows, defaultThreshold } = await workflowDatabase(this.prisma.withReport(authActor(user), async tx => ({
      rows: await tx.$queryRaw<StockAlertRow[]>`
        SELECT inventory_id, facility_id, facility_name, medicine_id, medicine_name, variant_id, unit_name, stock_quantity,
          reserved_quantity, available, min_stock_quantity, threshold, level
        FROM public.report_stock_alerts(${query.facilityId ?? null}::integer)`,
      defaultThreshold: (await tx.$queryRaw<{ value: number }[]>`SELECT public.default_min_stock_quantity() AS value`)[0].value,
    })));
    return {
      defaultThreshold,
      items: rows.map(row => ({
        inventoryId: row.inventory_id,
        facilityId: row.facility_id,
        facilityName: row.facility_name,
        medicineId: row.medicine_id,
        medicineName: row.medicine_name,
        variantId: row.variant_id,
        unitName: row.unit_name,
        stockQuantity: row.stock_quantity,
        reservedQuantity: row.reserved_quantity,
        available: row.available,
        minStockQuantity: row.min_stock_quantity,
        threshold: row.threshold,
        level: row.level,
      })),
    };
  }

  async expiryAlerts(user: CurrentUserPayload, query: ExpiryAlertQueryDto) {
    const rows = await workflowDatabase(this.prisma.withReport(authActor(user), tx => tx.$queryRaw<ExpiryAlertRow[]>`
      SELECT batch_id, batch_number, medicine_id, medicine_name, facility_id, facility_name, boxes, expiry_date::text AS expiry_date,
        days_left, level, below_min_shelf_life
      FROM public.report_expiry_alerts(${query.facilityId ?? null}::integer, ${query.withinDays ?? 180}::integer)`));
    return {
      items: rows.map(row => ({
        batchId: row.batch_id,
        batchNumber: row.batch_number,
        medicineId: row.medicine_id,
        medicineName: row.medicine_name,
        facilityId: row.facility_id,
        facilityName: row.facility_name,
        boxes: toNumber(row.boxes),
        expiryDate: row.expiry_date,
        daysLeft: row.days_left,
        level: row.level,
        belowMinShelfLife: row.below_min_shelf_life,
      })),
    };
  }

  async setDefaultThreshold(user: CurrentUserPayload, quantity: number) {
    await workflowDatabase(this.prisma.withReport(authActor(user), tx =>
      tx.$executeRaw`SELECT public.set_default_min_stock_quantity(${quantity}::integer)`));
  }

  async setInventoryThreshold(user: CurrentUserPayload, inventoryId: number, quantity: number | null) {
    await workflowDatabase(this.prisma.withReport(authActor(user), tx =>
      tx.$executeRaw`SELECT public.set_inventory_min_stock_quantity(${inventoryId}::integer, ${quantity}::integer)`));
  }
}
