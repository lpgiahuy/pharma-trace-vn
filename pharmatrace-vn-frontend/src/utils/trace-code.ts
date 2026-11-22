const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET_CODE = /^[0-9a-f]{64}$/i;

export interface TraceCode {
  uid?: string;
  code?: string;
}

export function readTraceCode(text: string): TraceCode | null {
  const value = text.trim();
  if (UUID.test(value)) return { uid: value.toLowerCase() };
  if (SECRET_CODE.test(value)) return { code: value.toLowerCase() };
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    const fragment = new URLSearchParams(url.hash.slice(1));
    const uid = fragment.get('uid') ?? url.searchParams.get('uid') ?? '';
    const code = fragment.get('code') ?? url.searchParams.get('code') ?? undefined;
    return UUID.test(uid) ? { uid: uid.toLowerCase(), code } : null;
  } catch {
    return null;
  }
}
