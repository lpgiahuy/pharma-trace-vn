import type { VerifyResult } from '@/services/trace.service';

export interface OwnRecord {
  activatedAt: string;
  count: number;
}

const KEY = 'pharma_trace_verified';
const DEVICE_KEY = 'pharma_trace_device';

export function applyVerification(existing: OwnRecord | undefined, result: VerifyResult): OwnRecord | undefined {
  if (!result.activatedAt) return existing;
  if (result.status === 'FIRST_ACTIVATION') return { activatedAt: result.activatedAt, count: 1 };
  if (result.status === 'ALREADY_ACTIVATED' && existing?.activatedAt === result.activatedAt) return { ...existing, count: existing.count + 1 };
  return existing;
}

function readAll(): Record<string, OwnRecord> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, OwnRecord>;
  } catch {
    return {};
  }
}

export function readOwn(uid: string): OwnRecord | undefined {
  return readAll()[uid];
}

export function rememberVerification(uid: string, result: VerifyResult): OwnRecord | undefined {
  const all = readAll();
  const next = applyVerification(all[uid], result);
  if (next && next !== all[uid]) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...all, [uid]: next }));
    } catch {
      // Private browsing can block storage; the box is then treated as verified elsewhere.
    }
  }
  return next;
}

export function getDeviceId(): string | undefined {
  try {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (stored) return stored;
    const created = globalThis.crypto?.randomUUID?.();
    if (created) localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return undefined;
  }
}
