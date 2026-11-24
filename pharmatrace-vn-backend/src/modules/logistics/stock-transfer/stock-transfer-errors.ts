import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../../../common/errors/app-exception';

const { CONFLICT, FORBIDDEN, NOT_FOUND, UNPROCESSABLE_ENTITY } = HttpStatus;

const CATALOG = {
  ST_FORBIDDEN: [FORBIDDEN, 'Only a manager of the facility that needs the stock can request it.'],
  ST_CODE_TAKEN: [CONFLICT, 'This request code is already used by another facility.'],
  ST_SOURCE_INVALID: [UNPROCESSABLE_ENTITY, 'Choose another existing facility to send the stock.'],
  ST_DESTINATION_INVALID: [UNPROCESSABLE_ENTITY, 'Choose an existing warehouse to receive the stock.'],
  ST_LINES_INVALID: [UNPROCESSABLE_ENTITY, 'Each line needs an existing product packaging, once, with a positive quantity.'],
  ST_NOT_FOUND: [NOT_FOUND, 'Stock transfer request not found at your facility.'],
  ST_SOURCE_MANAGER_REQUIRED: [FORBIDDEN, 'Only a manager of the sending facility can approve or reject this request.'],
  ST_NOTE_REQUIRED: [UNPROCESSABLE_ENTITY, 'Enter a reason of 1-500 characters.'],
  ST_INVALID_STATUS: [CONFLICT, 'This request can no longer be changed this way. Reload the page.'],
  ST_STOCK_INSUFFICIENT: [CONFLICT, 'The sending facility does not have enough available stock for this request.'],
} as const satisfies Record<string, readonly [HttpStatus, string]>;

export type StockTransferErrorCode = keyof typeof CATALOG;

export function stockTransferError(code: StockTransferErrorCode): AppException {
  const [status, message] = CATALOG[code];
  return new AppException(code, message, status);
}

export async function stockTransferDatabase<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
    const meta = error.meta as { message?: string; driverAdapterError?: { cause?: { originalMessage?: string } } } | undefined;
    const message = meta?.message ?? meta?.driverAdapterError?.cause?.originalMessage ?? error.message;
    const raised = /\b(ST_[A-Z_]+)\b/.exec(message)?.[1];
    if (raised && raised in CATALOG) throw stockTransferError(raised as StockTransferErrorCode);
    throw error;
  }
}
