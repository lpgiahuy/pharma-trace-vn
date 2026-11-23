import { BadRequestException } from '@nestjs/common';

/**
 * The boxes of a line that arrived in good condition. Scanning a thousand good boxes is not practical, so staff scan only
 * the exceptions: when no good list is given, every dispatched box that is not listed as damaged or missing is good.
 * The counts are still checked against the inspected quantities afterwards (validateInspectionUids).
 */
export function deriveGoodUids(shipped: string[], goodUids: string[] | undefined, damagedUids: string[] = [], missingUids: string[] = []): string[] {
  if (goodUids !== undefined) return goodUids;
  const excluded = new Set([...damagedUids, ...missingUids]);
  return shipped.filter(uid => !excluded.has(uid));
}

export function validateInspectionUids(assigned: string[], groups: Array<{ quantity: number; uids?: string[] }>, allowMissing = false) {
  const selected = groups.flatMap(group => group.uids || []);
  if (groups.some(group => !Number.isSafeInteger(group.quantity) || group.quantity < 0)) {
    throw new BadRequestException('Inspection quantities must be non-negative integers.');
  }
  if (new Set(assigned).size !== assigned.length || new Set(selected).size !== selected.length ||
      selected.some(uid => !assigned.includes(uid)) ||
      (assigned.length > 0 && groups.some(group => (group.uids || []).length !== group.quantity)) ||
      (!allowMissing && assigned.length > 0 && selected.length !== assigned.length)) {
    throw new BadRequestException('Inspection UID groups must be unique, belong to this order, and match inspected quantities.');
  }
}
