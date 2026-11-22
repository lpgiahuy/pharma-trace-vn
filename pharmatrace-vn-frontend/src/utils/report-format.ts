const VND = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });
const INTEGER = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const DAY_MS = 86_400_000;

/** Full amount with vi-VN grouping, e.g. 1.250.000 ₫. */
export function formatVnd(amount: number): string {
  return VND.format(Number.isFinite(amount) ? amount : 0);
}

/** Whole number with vi-VN grouping, e.g. 12.345. */
export function formatCount(value: number): string {
  return INTEGER.format(Number.isFinite(value) ? value : 0);
}

/** Short axis label: 950, 12.5K, 1.25M, 3.4B. */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const units: [number, string][] = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [size, suffix] of units) {
    if (abs >= size) return `${sign}${Number((abs / size).toFixed(2))}${suffix}`;
  }
  return `${sign}${Math.round(abs)}`;
}

/** Change in percent against the previous period; null when there is nothing to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export type RangePreset = 'today' | 'last7' | 'last30' | 'thisMonth' | 'thisQuarter' | 'thisYear';

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'thisQuarter', label: 'This quarter' },
  { value: 'thisYear', label: 'This year' },
];

export function vietnamToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now);
}

function addDays(day: string, days: number): string {
  return new Date(Date.parse(day) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Resolves a preset to an inclusive YYYY-MM-DD range ending today. */
export function presetRange(preset: RangePreset, today: string): { from: string; to: string } {
  const year = today.slice(0, 4);
  const month = Number(today.slice(5, 7));
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'thisMonth':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'thisQuarter': {
      const first = Math.floor((month - 1) / 3) * 3 + 1;
      return { from: `${year}-${String(first).padStart(2, '0')}-01`, to: today };
    }
    case 'thisYear':
      return { from: `${year}-01-01`, to: today };
  }
}

/** Number of days in an inclusive range. */
export function rangeDays(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
}

/** Daily series are capped at 366 days by the API. */
export const MAX_DAILY_DAYS = 366;

/** Axis label for a bucket start: 05/11 for days, 11/2026 for months. */
export function bucketLabel(bucket: string, granularity: 'day' | 'month'): string {
  const [year, month, day] = bucket.split('-');
  return granularity === 'month' ? `${month}/${year}` : `${day}/${month}`;
}
