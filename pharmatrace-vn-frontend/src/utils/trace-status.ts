import type { ScanOutcome, TraceBox, VerifyResult } from '@/services/trace.service';
import type { OwnRecord } from '@/utils/trace-owner';

export type StatusKey =
  | 'counterfeit' | 'recalled' | 'expired' | 'invalid_code' | 'used_by_others' | 'already_activated' | 'activated_before'
  | 'activated_by_you' | 'authentic' | 'code_required';

const PRIORITY: StatusKey[] = [
  'counterfeit', 'recalled', 'expired', 'invalid_code', 'used_by_others', 'already_activated', 'activated_before', 'activated_by_you', 'authentic',
];

export function isFlagged(box: TraceBox, verification?: VerifyResult, scan?: ScanOutcome): boolean {
  return box.flagged || verification?.flagged === true || scan?.scanResult === 'FLAGGED';
}

export function assessTrace(box: TraceBox, verification?: VerifyResult, scan?: ScanOutcome, own?: OwnRecord, now = new Date()): StatusKey[] {
  const found = new Set<StatusKey>();
  if (box.batchStatus === 'RECALLED') found.add('recalled');
  if (new Date(box.expiryDate) < now) found.add('expired');
  if (verification?.status === 'INVALID_CODE') found.add('invalid_code');
  if (verification?.status === 'FIRST_ACTIVATION') found.add('authentic');
  if (isFlagged(box, verification, scan)) found.add('counterfeit');

  const previouslyActivated = verification?.status === 'ALREADY_ACTIVATED' || (!verification && box.activatedAt);
  if (previouslyActivated) {
    const activatedAt = verification?.activatedAt ?? box.activatedAt;
    const entries = verification?.verifyCount ?? box.verifyCount;
    const mine = own && own.activatedAt === activatedAt ? own : undefined;
    if (!mine) found.add(verification ? 'already_activated' : 'activated_before');
    else found.add(entries > mine.count ? 'used_by_others' : 'activated_by_you');
  }

  const statuses = PRIORITY.filter(key => found.has(key));
  return statuses.length > 0 ? statuses : ['code_required'];
}
