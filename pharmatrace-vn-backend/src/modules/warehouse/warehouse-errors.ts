import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception';

const { CONFLICT, FORBIDDEN, NOT_FOUND } = HttpStatus;

const CATALOG = {
  WAREHOUSE_ACCOUNT_REQUIRED: [FORBIDDEN, 'A warehouse employee account is required.'],
  WAREHOUSE_FACILITY_REQUIRED: [FORBIDDEN, 'Your account is not assigned to a warehouse.'],
  WAREHOUSE_FACILITY_FORBIDDEN: [FORBIDDEN, 'You can only access data of your own warehouse.'],
  WAREHOUSE_PROFILE_NOT_FOUND: [NOT_FOUND, 'We could not find your employee profile.'],
  WAREHOUSE_INVENTORY_NOT_FOUND: [NOT_FOUND, 'This product has no stock record at your warehouse.'],
  WAREHOUSE_BATCH_NOT_FOUND: [NOT_FOUND, 'This batch has no boxes at your warehouse.'],
  WAREHOUSE_BATCH_NOT_ACTIVE: [CONFLICT, 'Only active batches can be put on hold.'],
  WAREHOUSE_BATCH_NOT_ON_HOLD: [CONFLICT, 'Only batches on hold can be released.'],
  USE_WAREHOUSE_PORTAL: [FORBIDDEN, 'Warehouse accounts sign in at the Warehouse portal.'],
} as const satisfies Record<string, readonly [HttpStatus, string]>;

export type WarehouseErrorCode = keyof typeof CATALOG;

export function warehouseError(code: WarehouseErrorCode): AppException {
  const [status, message] = CATALOG[code];
  return new AppException(code, message, status);
}
