import { ROLES_KEY } from './decorators/roles.decorator';
import { normalizeRole } from './auth-identity';
import { InternalTransferController } from '../modules/logistics/internal-transfer/internal-transfer.controller';
import { LogisticsController } from '../modules/logistics/shipment/logistics.controller';
import { AdminOrderController } from '../modules/order/admin-order.controller';
import { AdminReturnsController } from '../modules/returns/admin-returns.controller';
import { GoodsReceiptController } from '../modules/procurement/goods-receipt.controller';
import { PurchaseOrderController } from '../modules/procurement/purchase-order.controller';
import { WarehouseController } from '../modules/warehouse/warehouse.controller';

type Handler = (...args: never[]) => unknown;

function rolesOf(controller: { prototype: object }, method: string): Set<string> {
  const handler = (controller.prototype as Record<string, Handler>)[method];
  const roles = Reflect.getMetadata(ROLES_KEY, handler) as string[] | undefined;
  if (!roles) throw new Error(`${method} has no @Roles`);
  return new Set(roles.map((role) => normalizeRole(role) ?? role));
}

const managerRoutes: [string, { prototype: object }, string[]][] = [
  ['transfers', InternalTransferController, ['transfers', 'transfer', 'cancelTransfer', 'dispatch', 'transportStaff', 'halt', 'receive', 'receiveReturn', 'rejectDamaged', 'resolveDiscrepancy']],
  ['shipments', LogisticsController, ['shipments', 'shipment', 'updateShipment', 'receiveReturn']],
  ['orders', AdminOrderController, ['getAllOrders', 'getOrderById', 'resolution', 'getAvailableBoxes', 'packOrder']],
  ['returns', AdminReturnsController, ['list', 'detail', 'addAttachment', 'attachment', 'rejectReceipt', 'receive']],
];

describe('Warehouse route access', () => {
  describe.each(managerRoutes)('%s', (_area, controller, methods) => {
    it.each(methods)('%s admits WAREHOUSE_MANAGER but not FACTORY_WAREHOUSE_STAFF', (method) => {
      const roles = rolesOf(controller, method);
      expect(roles.has('WAREHOUSE_MANAGER')).toBe(true);
      expect(roles.has('FACTORY_WAREHOUSE_STAFF')).toBe(false);
    });
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
});
