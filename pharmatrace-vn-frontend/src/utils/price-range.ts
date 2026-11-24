export interface PriceRangeResult {
  min: number | null;
  max: number | null;
  /** English message for the user when the range cannot be applied. */
  error: string | null;
}

const toAmount = (text: string): number | null => {
  const digits = text.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const value = parseInt(digits, 10);
  return Number.isFinite(value) ? value : null;
};

/**
 * Reads the two price boxes. Empty boxes mean "no bound"; the minimum may equal the maximum but not exceed it.
 */
export function parsePriceRange(minText: string, maxText: string): PriceRangeResult {
  const min = toAmount(minText);
  const max = toAmount(maxText);
  if (min !== null && max !== null && min > max) {
    return { min, max, error: 'Minimum price cannot be greater than maximum price.' };
  }
  return { min, max, error: null };
}
