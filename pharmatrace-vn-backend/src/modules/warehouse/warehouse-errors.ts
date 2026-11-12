import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception';

const { FORBIDDEN, NOT_FOUND } = HttpStatus;

const CATALOG = {
  WAREHOUSE_ACCOUNT_REQUIRED: [FORBIDDEN, 'A warehouse employee account is required.'],
  WAREHOUSE_FACILITY_REQUIRED: [FORBIDDEN, 'Your account is not assigned to a warehouse.'],
  WAREHOUSE_FACILITY_FORBIDDEN: [FORBIDDEN, 'You can only access data of your own warehouse.'],
  WAREHOUSE_PROFILE_NOT_FOUND: [NOT_FOUND, 'We could not find your employee profile.'],
} as const satisfies Record<string, readonly [HttpStatus, string]>;

export type WarehouseErrorCode = keyof typeof CATALOG;

export function warehouseError(code: WarehouseErrorCode): AppException {
  const [status, message] = CATALOG[code];
  return new AppException(code, message, status);
}
