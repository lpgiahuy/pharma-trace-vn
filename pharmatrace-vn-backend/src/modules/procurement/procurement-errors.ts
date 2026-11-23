import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app-exception';

const { CONFLICT, FORBIDDEN, NOT_FOUND, UNPROCESSABLE_ENTITY } = HttpStatus;

const CATALOG = {
  PO_NOT_FOUND: [NOT_FOUND, 'We could not find this purchase order.'],
  PO_FACILITY_REQUIRED: [UNPROCESSABLE_ENTITY, 'Choose the warehouse that will receive the goods.'],
  PO_PARTIES_INVALID: [UNPROCESSABLE_ENTITY, 'Choose a receiving warehouse and exactly one supplier: a manufacturer or a factory.'],
  PO_LINES_INVALID: [UNPROCESSABLE_ENTITY, 'Each product can appear only once and must exist.'],
  PO_INVALID_TRANSITION: [CONFLICT, 'This action is not available for the purchase order in its current status. Please reload the page.'],
  GR_FORBIDDEN: [FORBIDDEN, 'Only warehouse staff of the receiving warehouse can receive this purchase order.'],
  GR_NOT_FOUND: [NOT_FOUND, 'We could not find this goods receipt.'],
  GR_CODE_INVALID: [UNPROCESSABLE_ENTITY, 'The receipt code must be 6-50 letters, digits, dashes or underscores.'],
  GR_CODE_CONFLICT: [CONFLICT, 'This receipt code is already used by another purchase order.'],
  GR_PO_NOT_RECEIVABLE: [CONFLICT, 'Only approved or partially received purchase orders can receive goods. Please reload the page.'],
  GR_LINES_REQUIRED: [UNPROCESSABLE_ENTITY, 'Add at least one received line.'],
  GR_NOTE_INVALID: [UNPROCESSABLE_ENTITY, 'The note can be at most 1000 characters.'],
  GR_LINE_INVALID: [UNPROCESSABLE_ENTITY, 'Each received line must belong to this purchase order.'],
  GR_LINE_DUPLICATE: [UNPROCESSABLE_ENTITY, 'The same order line and batch can appear only once in a receipt.'],
  GR_LINE_EMPTY: [UNPROCESSABLE_ENTITY, 'Scan at least one box or carton for each received line.'],
  GR_BATCH_INVALID: [UNPROCESSABLE_ENTITY, 'Enter the batch number, production date and expiry date; the production date must be before the expiry date.'],
  GR_BATCH_MEDICINE_MISMATCH: [UNPROCESSABLE_ENTITY, 'This batch number already belongs to another medicine.'],
  GR_BATCH_DATES_MISMATCH: [UNPROCESSABLE_ENTITY, 'This batch already exists with different production or expiry dates.'],
  GR_BOX_INVALID: [UNPROCESSABLE_ENTITY, 'A scanned box code is not a valid box UID.'],
  GR_BOX_DUPLICATE: [UNPROCESSABLE_ENTITY, 'A box was scanned more than once in this receipt.'],
  GR_BOX_WRONG_BATCH: [UNPROCESSABLE_ENTITY, 'A scanned box belongs to another batch.'],
  GR_BOX_UNAVAILABLE: [CONFLICT, 'A scanned box has already been received or is not available.'],
  GR_CARTON_INVALID: [UNPROCESSABLE_ENTITY, 'A scanned carton code is unknown or was scanned twice.'],
  GR_CARTON_WRONG_BATCH: [UNPROCESSABLE_ENTITY, 'A scanned carton belongs to another batch.'],
  GR_BATCH_NOT_FROM_SUPPLIER: [UNPROCESSABLE_ENTITY, 'This batch was not registered by the factory that supplies this order.'],
  GR_SUPPLIER_STOCK_INSUFFICIENT: [CONFLICT, 'The supplying factory does not have enough available stock for these boxes.'],
  GR_CARTON_UNAVAILABLE: [CONFLICT, 'A scanned carton has already been received.'],
  GR_REJECT_REASON_REQUIRED: [UNPROCESSABLE_ENTITY, 'Enter a reason of at most 300 characters for the rejected boxes.'],
  GR_OVER_RECEIPT: [CONFLICT, 'The received quantity is more than what is still open on the purchase order line.'],
  GR_ATTACHMENT_INVALID: [UNPROCESSABLE_ENTITY, 'Please upload a JPG, PNG or WEBP image smaller than 8 MB.'],
  GR_ATTACHMENT_LIMIT: [UNPROCESSABLE_ENTITY, 'A receipt can have at most 20 attachments.'],
  GR_ATTACHMENT_BATCH_INVALID: [UNPROCESSABLE_ENTITY, 'Choose a batch that was received in this receipt.'],
  GR_ATTACHMENT_NOT_FOUND: [NOT_FOUND, 'We could not find this attachment.'],
} as const satisfies Record<string, readonly [HttpStatus, string]>;

export type ProcurementErrorCode = keyof typeof CATALOG;

export function procurementError(code: ProcurementErrorCode, details?: Record<string, unknown>): AppException {
  const [status, message] = CATALOG[code];
  return new AppException(code, message, status, details);
}

function isCatalogCode(code: string): code is ProcurementErrorCode {
  return code in CATALOG;
}

interface DatabaseErrorMeta {
  code?: string;
  message?: string;
  driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } };
}

/** Maps the GR_* / PO_* codes raised by record_goods_receipt() and racing unique keys to procurement errors. */
export async function procurementDatabase<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
    const meta = error.meta as DatabaseErrorMeta | undefined;
    const code = meta?.code ?? meta?.driverAdapterError?.cause?.originalCode;
    const message = meta?.message ?? meta?.driverAdapterError?.cause?.originalMessage ?? error.message;
    const raised = /\b((?:GR|PO)_[A-Z_]+)(?: ([\w.-]+))?/.exec(message);
    if (raised && isCatalogCode(raised[1])) throw procurementError(raised[1], raised[2] ? { value: raised[2] } : undefined);
    if (code === '23505') {
      if (message.includes('receipt_code')) throw procurementError('GR_CODE_CONFLICT');
      if (message.includes('medicine_boxes')) throw procurementError('GR_BOX_UNAVAILABLE');
    }
    if (code === '42501') throw procurementError('GR_FORBIDDEN');
    throw error;
  }
}
