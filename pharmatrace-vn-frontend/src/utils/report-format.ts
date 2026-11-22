const VND = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });
const INTEGER = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const DAY_MS = 86_400_000;

export const formatVnd = (amount: number) => VND.format(Number.isFinite(amount) ? amount : 0);

export const formatCount = (value: number) => INTEGER.format(Number.isFinite(value) ? value : 0);

export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  for (const [size, suffix] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']] as const) {
    if (abs >= size) return `${sign}${Number((abs / size).toFixed(2))}${suffix}`;
  }
  return `${sign}${Math.round(abs)}`;
}

export function percentChange(current: number, previous: number): number | null {
  return previous === 0 ? null : ((current - previous) / Math.abs(previous)) * 100;
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

export const vietnamToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now);

const addDays = (day: string, days: number) =>
  new Date(Date.parse(day) + days * DAY_MS).toISOString().slice(0, 10);

export function presetRange(preset: RangePreset, today: string): { from: string; to: string } {
  const month = Number(today.slice(5, 7));
  const from = {
    today,
    last7: addDays(today, -6),
    last30: addDays(today, -29),
    thisMonth: `${today.slice(0, 7)}-01`,
    thisQuarter: `${today.slice(0, 4)}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, '0')}-01`,
    thisYear: `${today.slice(0, 4)}-01-01`,
  }[preset];
  return { from, to: today };
}

export const rangeDays = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;

export function bucketLabel(bucket: string, granularity: 'day' | 'month'): string {
  const [year, month, day] = bucket.split('-');
  return granularity === 'month' ? `${month}/${year}` : `${day}/${month}`;
}
