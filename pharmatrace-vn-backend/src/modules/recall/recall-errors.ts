import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app-exception';

const { CONFLICT, FORBIDDEN, NOT_FOUND, UNPROCESSABLE_ENTITY } = HttpStatus;

const CATALOG = {
  RC_FORBIDDEN: [FORBIDDEN, 'Only a super administrator can manage recalls, and facilities only see their own recall tasks.'],
  RC_CODE_INVALID: [UNPROCESSABLE_ENTITY, 'The recall code must be 6-30 letters, digits, dashes or underscores.'],
  RC_CODE_TAKEN: [CONFLICT, 'This recall code is already used for other batches.'],
  RC_BATCH_INVALID: [UNPROCESSABLE_ENTITY, 'Choose existing batches, each once.'],
  RC_BATCH_RECALLED: [CONFLICT, 'One of these batches is already recalled.'],
  RC_VARIANT_AMBIGUOUS: [UNPROCESSABLE_ENTITY, 'A facility must stock exactly one packaging of the recalled medicine.'],
  RC_STOCK_MISMATCH: [CONFLICT, "A facility's stock record does not match its boxes. Count the stock and try again."],
  RC_NOT_FOUND: [NOT_FOUND, 'Recall not found.'],
  RC_NOT_ACTIVE: [CONFLICT, 'This recall is closed.'],
  RC_DESTINATION_INVALID: [UNPROCESSABLE_ENTITY, 'Choose a central or branch warehouse to collect the stock.'],
  RC_NOTE_REQUIRED: [UNPROCESSABLE_ENTITY, 'Enter a note of 1-500 characters.'],
  RC_COLLECTION_OPEN: [CONFLICT, 'Receive or finish every collection transfer before closing the recall.'],
  RC_FACILITY_REQUIRED: [FORBIDDEN, 'Your account is not assigned to a facility.'],
} as const satisfies Record<string, readonly [HttpStatus, string]>;

export type RecallErrorCode = keyof typeof CATALOG;

export function recallError(code: RecallErrorCode): AppException {
  const [status, message] = CATALOG[code];
  return new AppException(code, message, status);
}

export async function recallDatabase<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
    const meta = error.meta as { message?: string; driverAdapterError?: { cause?: { originalMessage?: string } } } | undefined;
    const message = meta?.message ?? meta?.driverAdapterError?.cause?.originalMessage ?? error.message;
    const raised = /\b(RC_[A-Z_]+)\b/.exec(message)?.[1];
    if (raised && raised in CATALOG) throw recallError(raised as RecallErrorCode);
    throw error;
  }
}
