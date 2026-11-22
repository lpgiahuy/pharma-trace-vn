import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app-exception';

const { NOT_FOUND, UNPROCESSABLE_ENTITY } = HttpStatus;

const CATALOG = {
  TR_BOX_NOT_FOUND: [NOT_FOUND, 'No box matches this code.'],
  TR_LOCATION_INVALID: [UNPROCESSABLE_ENTITY, 'Send both a valid latitude and a valid longitude, or neither.'],
} as const satisfies Record<string, readonly [HttpStatus, string]>;

export type TraceErrorCode = keyof typeof CATALOG;

export function traceError(code: TraceErrorCode): AppException {
  const [status, message] = CATALOG[code];
  return new AppException(code, message, status);
}

export async function traceDatabase<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
    const meta = error.meta as { message?: string; driverAdapterError?: { cause?: { originalMessage?: string } } } | undefined;
    const message = meta?.message ?? meta?.driverAdapterError?.cause?.originalMessage ?? error.message;
    const raised = /\b(TR_[A-Z_]+)\b/.exec(message)?.[1];
    if (raised && raised in CATALOG) throw traceError(raised as TraceErrorCode);
    throw error;
  }
}
