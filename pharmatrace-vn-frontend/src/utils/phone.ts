/**
 * Customer phone numbers are stored in local Vietnamese form: a leading 0 and 10 digits (e.g. 0909123456).
 * Spaces, dots and dashes typed between digits are ignored, and a +84 / 84 prefix is converted to the leading 0.
 * Keep in sync with normalizeVietnamPhone in the backend (src/common/phone.ts).
 */
export function normalizeVietnamPhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const compact = raw.trim().replace(/[\s.-]/g, '');
  const international = /^(?:\+84|84)(\d{9})$/.exec(compact);
  if (international) return `0${international[1]}`;
  return /^0\d{9}$/.test(compact) ? compact : null;
}

export const PHONE_ERROR_MESSAGE = 'Enter a Vietnamese mobile number with 10 digits, e.g. 0909 123 456';
