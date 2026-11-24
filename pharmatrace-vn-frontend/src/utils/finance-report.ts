import type {
  CashbookDay,
  CashbookFilters,
  PayableBucket,
  PayableDetail,
  ReceivableBucket,
  ReceivableDetail,
} from '../types/report.types';

const DAY_MS = 86_400_000;
const FINANCE_ROLES = ['SUPERADMIN', 'ADMIN', 'ACCOUNTANT', 'FINANCEMANAGER'];

/** Mirrors FINANCE_READ in the API: the roles that may open debts, the cashbook and the dashboard finance row. */
export const canViewFinance = (role?: string | null) =>
  FINANCE_ROLES.includes((role || '').toUpperCase().replace(/[\s_-]/g, ''));

const SUPPLIER_PAYMENT_ROLES = ['SUPERADMIN', 'FINANCEMANAGER'];

/** Mirrors SUPPLIER_PAYMENT_WRITE in the API: the roles that may record a supplier payment. */
export const canRecordSupplierPayment = (role?: string | null) =>
  SUPPLIER_PAYMENT_ROLES.includes((role || '').toUpperCase().replace(/[\s_-]/g, ''));

export const RECEIVABLE_BUCKETS: { key: ReceivableBucket; label: string }[] = [
  { key: '0_7', label: '0-7 days' },
  { key: '8_15', label: '8-15 days' },
  { key: '16_30', label: '16-30 days' },
  { key: 'GT_30', label: 'Over 30 days' },
];

export const PAYABLE_BUCKETS: { key: PayableBucket; label: string }[] = [
  { key: 'NOT_DUE', label: 'Not due' },
  { key: '1_30', label: '1-30 days overdue' },
  { key: '31_60', label: '31-60 days overdue' },
  { key: 'GT_60', label: 'Over 60 days overdue' },
  { key: 'NO_DUE_DATE', label: 'No due date' },
];

export const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'DEBIT_CARD', label: 'Debit card' },
  { value: 'E_WALLET', label: 'E-wallet' },
] as const;

export const paymentMethodLabel = (method: string) =>
  PAYMENT_METHODS.find(item => item.value === method)?.label ?? method;

const ACRONYMS = new Set(['cod']);

/** Sentence-style label for a stored category such as CUSTOMER_REFUND; known acronyms stay upper case. */
export function categoryLabel(category: string): string {
  const words = category.toLowerCase().split('_').map(word => (ACRONYMS.has(word) ? word.toUpperCase() : word));
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

const OVERDUE_PAYABLE: PayableBucket[] = ['1_30', '31_60', 'GT_60'];

/** Receivables have no due date, so debts older than 30 days count as overdue. */
export function receivableTotals(summary: { bucket: ReceivableBucket; amount: number }[]) {
  return {
    total: sum(summary.map(row => row.amount)),
    overdue: sum(summary.filter(row => row.bucket === 'GT_30').map(row => row.amount)),
  };
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

export function payableTotals(
  summary: { bucket: PayableBucket; amount: number }[],
  details: Pick<PayableDetail, 'bucket' | 'dueDate' | 'amount'>[],
  asOf: string,
) {
  return {
    total: sum(summary.map(row => row.amount)),
    overdue: sum(summary.filter(row => OVERDUE_PAYABLE.includes(row.bucket)).map(row => row.amount)),
    dueNext7Days: sum(details
      .filter(row => row.bucket === 'NOT_DUE' && row.dueDate !== null && daysBetween(asOf, row.dueDate) <= 7)
      .map(row => row.amount)),
  };
}

export interface AgingChartData {
  rows: Record<string, string | number>[];
  parties: string[];
}

const MAX_PARTIES = 5;
export const OTHER_PARTIES = 'Others';

/**
 * One row per bucket, one numeric column per party. Only the largest parties get their own column;
 * the rest are merged into "Others" so a long supplier list does not turn the legend into noise.
 */
export function agingChartData(
  summary: { party: string; bucket: string; amount: number }[],
  buckets: { key: string; label: string }[],
): AgingChartData {
  const totals = new Map<string, number>();
  for (const row of summary) totals.set(row.party, (totals.get(row.party) ?? 0) + row.amount);
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([party]) => party);
  const named = ranked.length > MAX_PARTIES ? ranked.slice(0, MAX_PARTIES - 1) : ranked;
  const parties = ranked.length > MAX_PARTIES ? [...named, OTHER_PARTIES] : named;

  const rows = buckets.map(({ key, label }) => {
    const row: Record<string, string | number> = { bucket: label };
    for (const party of parties) row[party] = 0;
    for (const item of summary.filter(entry => entry.bucket === key)) {
      const column = named.includes(item.party) ? item.party : OTHER_PARTIES;
      row[column] = Number(row[column]) + item.amount;
    }
    return row;
  });
  return { rows, parties };
}

export function filterReceivables(
  details: ReceivableDetail[],
  filters: { party?: string; bucket?: ReceivableBucket; search?: string },
) {
  const search = filters.search?.trim().toLowerCase();
  return details.filter(row =>
    (!filters.party || row.party === filters.party)
    && (!filters.bucket || row.bucket === filters.bucket)
    && (!search || (row.orderCode ?? '').toLowerCase().includes(search)));
}

export function filterPayables(
  details: PayableDetail[],
  filters: { party?: string; bucket?: PayableBucket; search?: string },
) {
  const search = filters.search?.trim().toLowerCase();
  return details.filter(row =>
    (!filters.party || row.supplierName === filters.party)
    && (!filters.bucket || row.bucket === filters.bucket)
    && (!search || (row.poCode ?? '').toLowerCase().includes(search)));
}

export interface CashflowPoint {
  day: string;
  income: number;
  expense: number;
  balance: number;
}

/** The last point's balance is the closing balance of the report: both come from the same running sum in the API. */
export const cashflowData = (days: CashbookDay[]): CashflowPoint[] =>
  days.map(({ day, income, expense, balance }) => ({ day, income, expense, balance }));

export const cashbookFilename = (filters: Pick<CashbookFilters, 'from' | 'to'>) =>
  `cashbook_${filters.from}_${filters.to}.csv`;

const vietnamDateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatVietnamDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : vietnamDateTime.format(date).replace(',', '');
}
