import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception';

const { CONFLICT, NOT_FOUND, UNPROCESSABLE_ENTITY } = HttpStatus;

const CATALOG = {
  PO_NOT_FOUND: [NOT_FOUND, 'We could not find this purchase order.'],
  PO_FACILITY_REQUIRED: [UNPROCESSABLE_ENTITY, 'Choose the warehouse that will receive the goods.'],
  PO_PARTIES_INVALID: [UNPROCESSABLE_ENTITY, 'Choose a receiving warehouse and exactly one supplier: a manufacturer or a factory.'],
  PO_LINES_INVALID: [UNPROCESSABLE_ENTITY, 'Each product can appear only once and must exist.'],
  PO_INVALID_TRANSITION: [CONFLICT, 'This action is not available for the purchase order in its current status. Please reload the page.'],
} as const satisfies Record<string, readonly [HttpStatus, string]>;

export type ProcurementErrorCode = keyof typeof CATALOG;

export function procurementError(code: ProcurementErrorCode): AppException {
  const [status, message] = CATALOG[code];
  return new AppException(code, message, status);
}
