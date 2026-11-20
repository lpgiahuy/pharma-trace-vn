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
  PK_ORDER_NOT_FOUND: [NOT_FOUND, 'Order not found at your warehouse.'],
  PK_CODE_TAKEN: [CONFLICT, 'This package code is already used by another order.'],
  PK_BOX_NOT_AT_WAREHOUSE: [UNPROCESSABLE_ENTITY, "This box is not at the order's warehouse."],
  PK_BOX_UNAVAILABLE: [CONFLICT, 'This box is reserved for another order or has already left stock.'],
  PK_BOX_IN_PACKAGE: [CONFLICT, 'This box is already in another package.'],
  PK_BOX_NOT_SELLABLE: [UNPROCESSABLE_ENTITY, 'This box is from a held, recalled or expired batch, or does not meet the minimum shelf life.'],
  PK_BOX_WRONG_PRODUCT: [UNPROCESSABLE_ENTITY, 'This box is not a product of this order.'],
  PK_LINE_FULL: [UNPROCESSABLE_ENTITY, 'All boxes of this order line are already packed.'],
  PK_PACKAGE_NOT_FOUND: [NOT_FOUND, 'Package not found.'],
  HV_FORBIDDEN: [FORBIDDEN, 'You cannot hand over packages of this warehouse.'],
  HV_CODE_INVALID: [UNPROCESSABLE_ENTITY, 'The handover code must be 6-50 letters, digits, dashes or underscores.'],
  HV_CODE_TAKEN: [CONFLICT, 'This handover code is already used by another warehouse.'],
  HV_INPUT_INVALID: [UNPROCESSABLE_ENTITY, 'Enter the carrier and scan between 1 and 200 packages.'],
  HV_PACKAGE_NOT_FOUND: [NOT_FOUND, 'One or more packages were not found at your warehouse.'],
  HV_PACKAGE_NOT_PACKED: [CONFLICT, 'A package was already handed over, voided, or its order was cancelled.'],
  HV_SHIPMENT_NOT_READY: [CONFLICT, 'The shipment of a package is not waiting for pickup.'],
  HV_CARRIER_NOT_CONFIRMED: [CONFLICT, 'Confirm the carrier tracking number of the shipment before handing it over.'],
  HV_CARRIER_MISMATCH: [UNPROCESSABLE_ENTITY, 'A package belongs to a shipment of another carrier.'],
  HV_NOT_FOUND: [NOT_FOUND, 'Handover not found.'],
  PK_PACKAGE_NOT_VOIDABLE: [CONFLICT, 'Only packed packages of orders that are still being packed can be voided.'],
  SC_FORBIDDEN: [FORBIDDEN, 'You cannot count or adjust stock of this warehouse.'],
  SC_FACILITY_REQUIRED: [UNPROCESSABLE_ENTITY, 'Choose the warehouse to count.'],
  SC_NOT_FOUND: [NOT_FOUND, 'Stock count not found.'],
  SC_CODE_INVALID: [UNPROCESSABLE_ENTITY, 'The code must be 6-50 letters, digits, dashes or underscores.'],
  SC_CODE_CONFLICT: [CONFLICT, 'This code is already used by another stock count or adjustment.'],
  SC_SCOPE_INVALID: [UNPROCESSABLE_ENTITY, 'Count the whole warehouse, one medicine or one batch, not a mix.'],
  SC_COUNT_EMPTY: [UNPROCESSABLE_ENTITY, 'There is no stock to count in this scope.'],
  SC_VARIANT_AMBIGUOUS: [UNPROCESSABLE_ENTITY, 'The medicine of this batch must have exactly one stocked packaging at the warehouse.'],
  SC_INVALID_TRANSITION: [CONFLICT, 'This action is not available for the stock count in its current status. Please reload the page.'],
  SC_LINE_INVALID: [UNPROCESSABLE_ENTITY, 'Each counted batch must belong to this count and appear only once.'],
  SC_LINES_UNCOUNTED: [UNPROCESSABLE_ENTITY, 'Enter a counted quantity for every batch before submitting.'],
  SC_REASON_REQUIRED: [UNPROCESSABLE_ENTITY, 'Enter a reason of at most 500 characters.'],
  SC_QUANTITY_INVALID: [UNPROCESSABLE_ENTITY, 'The quantity change cannot be zero.'],
  SC_BELOW_RESERVED: [CONFLICT, 'Stock cannot go below the units reserved for orders or the unreserved boxes on hand.'],
  SC_GAIN_UNKNOWN_BOXES: [CONFLICT, 'Only boxes recorded as missing can be restored. Receive or transfer other boxes in.'],
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
    const raised = /\b((?:FB|HV|SC)_[A-Z_]+)\b/.exec(message)?.[1];
    if (raised && raised in CATALOG) throw warehouseError(raised as WarehouseErrorCode);
    throw error;
  }
}
