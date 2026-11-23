import { ROLES_KEY } from './decorators/roles.decorator';
import { normalizeRole } from './auth-identity';
import { InternalTransferController } from '../modules/logistics/internal-transfer/internal-transfer.controller';
import { StockTransferController } from '../modules/logistics/stock-transfer/stock-transfer.controller';
import { LogisticsController } from '../modules/logistics/shipment/logistics.controller';
import { AdminOrderController } from '../modules/order/admin-order.controller';
import { AdminReturnsController } from '../modules/returns/admin-returns.controller';
import { GoodsReceiptController } from '../modules/procurement/goods-receipt.controller';
import { PurchaseOrderController } from '../modules/procurement/purchase-order.controller';
import { FactoryBatchController } from '../modules/warehouse/factory/factory-batch.controller';
import { FulfillmentController } from '../modules/warehouse/fulfillment/fulfillment.controller';
import { WarehouseController } from '../modules/warehouse/warehouse.controller';

type Handler = (...args: never[]) => unknown;

function rolesOf(controller: { prototype: object }, method: string): Set<string> {
  const handler = (controller.prototype as Record<string, Handler>)[method];
  const roles = Reflect.getMetadata(ROLES_KEY, handler) as string[] | undefined;
  if (!roles) throw new Error(`${method} has no @Roles`);
  return new Set(roles.map((role) => normalizeRole(role) ?? role));
}

const managerRoutes: [string, { prototype: object }, string[]][] = [
  ['transfers', InternalTransferController, ['cancelTransfer', 'receive', 'rejectDamaged', 'resolveDiscrepancy']],
  ['shipments', LogisticsController, ['shipments', 'shipment', 'updateShipment', 'receiveReturn']],
  ['orders', AdminOrderController, ['getAllOrders', 'getOrderById', 'resolution', 'getAvailableBoxes', 'packOrder']],
  ['returns', AdminReturnsController, ['list', 'detail', 'addAttachment', 'attachment', 'rejectReceipt', 'receive']],
  ['fulfillment', FulfillmentController, ['queue', 'pickList', 'addPackage', 'completePacking', 'voidPackage', 'label']],
];

describe('Warehouse route access', () => {
  describe.each(managerRoutes)('%s', (_area, controller, methods) => {
    it.each(methods)('%s admits WAREHOUSE_MANAGER but not FACTORY_WAREHOUSE_STAFF', (method) => {
      const roles = rolesOf(controller, method);
      expect(roles.has('WAREHOUSE_MANAGER')).toBe(true);
      expect(roles.has('FACTORY_WAREHOUSE_STAFF')).toBe(false);
    });
  });

  // The factory sends stock out: it joins the source side of a transfer, never the receiving or resolving side.
  it.each(['transfers', 'transfer', 'dispatch', 'transportStaff', 'halt', 'receiveReturn'])('transfers %s admits WAREHOUSE_MANAGER and FACTORY_WAREHOUSE_STAFF', (method) => {
    const roles = rolesOf(InternalTransferController, method);
    expect(roles.has('WAREHOUSE_MANAGER')).toBe(true);
    expect(roles.has('FACTORY_WAREHOUSE_STAFF')).toBe(true);
  });

  it.each(['list', 'approve', 'reject', 'cancel'])('stock transfer %s admits FACTORY_WAREHOUSE_STAFF', (method) => {
    expect(rolesOf(StockTransferController, method).has('FACTORY_WAREHOUSE_STAFF')).toBe(true);
  });

  it('lets only factory staff start a transfer from a factory', () => {
    expect([...rolesOf(StockTransferController, 'send')]).toEqual(['FACTORY_WAREHOUSE_STAFF']);
  });

  it('does not let factory staff create stock transfer requests', () => {
    expect(rolesOf(StockTransferController, 'create').has('FACTORY_WAREHOUSE_STAFF')).toBe(false);
  });

  it('lets only managers void packages', () => {
    expect(rolesOf(FulfillmentController, 'voidPackage').has('WAREHOUSE_STAFF')).toBe(false);
    expect(rolesOf(FulfillmentController, 'addPackage').has('WAREHOUSE_STAFF')).toBe(true);
  });

  it('keeps discrepancy resolution away from warehouse staff', () => {
    expect(rolesOf(InternalTransferController, 'resolveDiscrepancy').has('WAREHOUSE_STAFF')).toBe(false);
  });

  it('keeps manager-only and reviewer routes closed to warehouse managers', () => {
    expect(rolesOf(InternalTransferController, 'reroute').has('WAREHOUSE_MANAGER')).toBe(false);
    expect(rolesOf(LogisticsController, 'updateCarrier').has('WAREHOUSE_MANAGER')).toBe(false);
    expect(rolesOf(AdminOrderController, 'updateOrderStatus').has('WAREHOUSE_MANAGER')).toBe(false);
    for (const method of ['approve', 'inspect', 'approveRefund', 'close']) {
      expect(rolesOf(AdminReturnsController, method).has('WAREHOUSE_MANAGER')).toBe(false);
    }
  });

  it('lets warehouse staff read purchase orders but only managers change them', () => {
    // Read routes inherit the class-level roles.
    const readers = Reflect.getMetadata(ROLES_KEY, PurchaseOrderController) as string[];
    expect(readers).toContain('WAREHOUSE_STAFF');
    expect(readers).not.toContain('FACTORY_WAREHOUSE_STAFF');
    for (const method of ['create', 'update', 'approve', 'cancel', 'close']) {
      const roles = rolesOf(PurchaseOrderController, method);
      expect(roles.has('WAREHOUSE_MANAGER')).toBe(true);
      expect(roles.has('WAREHOUSE_STAFF')).toBe(false);
    }
  });

  it('lets every warehouse role receive goods but not factory staff', () => {
    const roles = new Set(Reflect.getMetadata(ROLES_KEY, GoodsReceiptController) as string[]);
    expect(['WAREHOUSE_STAFF', 'WAREHOUSE_MANAGER', 'SUPER_ADMIN'].every(role => roles.has(role))).toBe(true);
    expect(roles.has('FACTORY_WAREHOUSE_STAFF')).toBe(false);
  });

  it('opens the staff roster to managers only', () => {
    const roles = rolesOf(WarehouseController, 'staff');
    expect(roles.has('WAREHOUSE_MANAGER')).toBe(true);
    expect(roles.has('WAREHOUSE_STAFF')).toBe(false);
    expect(rolesOf(WarehouseController, 'me').has('WAREHOUSE_STAFF')).toBe(true);
  });

  it('opens factory batch intake, voiding and labels to factory staff and SUPER_ADMIN only', () => {
    const roles = new Set(Reflect.getMetadata(ROLES_KEY, FactoryBatchController) as string[]);
    expect([...roles].sort()).toEqual(['FACTORY_WAREHOUSE_STAFF', 'SUPER_ADMIN']);
  });
});
