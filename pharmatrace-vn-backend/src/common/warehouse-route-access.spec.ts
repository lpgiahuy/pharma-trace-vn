import { ROLES_KEY } from './decorators/roles.decorator';
import { normalizeRole } from './auth-identity';
import { InternalTransferController } from '../modules/logistics/internal-transfer/internal-transfer.controller';
import { LogisticsController } from '../modules/logistics/shipment/logistics.controller';
import { AdminOrderController } from '../modules/order/admin-order.controller';
import { AdminReturnsController } from '../modules/returns/admin-returns.controller';
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

  it('opens the staff roster to managers only', () => {
    const roles = rolesOf(WarehouseController, 'staff');
    expect(roles.has('WAREHOUSE_MANAGER')).toBe(true);
    expect(roles.has('WAREHOUSE_STAFF')).toBe(false);
    expect(rolesOf(WarehouseController, 'me').has('WAREHOUSE_STAFF')).toBe(true);
  });
});
