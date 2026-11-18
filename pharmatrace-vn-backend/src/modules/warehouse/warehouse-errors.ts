import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app-exception';

const { CONFLICT, FORBIDDEN, NOT_FOUND, UNPROCESSABLE_ENTITY } = HttpStatus;

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
  FB_FORBIDDEN: [FORBIDDEN, 'Only factory warehouse staff can register factory batches.'],
  FB_FACTORY_REQUIRED: [FORBIDDEN, 'Batches can only be registered at your own factory.'],
  FB_VARIANT_INVALID: [UNPROCESSABLE_ENTITY, 'Choose an existing product packaging.'],
  FB_BATCH_INVALID: [UNPROCESSABLE_ENTITY, 'Enter the batch number, production date and expiry date; the production date must be before the expiry date.'],
  FB_BATCH_EXISTS: [CONFLICT, 'A batch with this number already exists.'],
  FB_BATCH_TOO_LARGE: [UNPROCESSABLE_ENTITY, 'This batch has more boxes than the allowed maximum.'],
} as const satisfies Record<string, readonly [HttpStatus, string]>;

export type WarehouseErrorCode = keyof typeof CATALOG;

export function warehouseError(code: WarehouseErrorCode, details?: Record<string, unknown>): AppException {
  const [status, message] = CATALOG[code];
  return new AppException(code, message, status, details);
}

interface DatabaseErrorMeta {
  message?: string;
  driverAdapterError?: { cause?: { originalMessage?: string } };
}

export async function warehouseDatabase<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
    const meta = error.meta as DatabaseErrorMeta | undefined;
    const message = meta?.message ?? meta?.driverAdapterError?.cause?.originalMessage ?? error.message;
    const raised = /\b(FB_[A-Z_]+)\b/.exec(message)?.[1];
    if (raised && raised in CATALOG) throw warehouseError(raised as WarehouseErrorCode);
    throw error;
  }
}
