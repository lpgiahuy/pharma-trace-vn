import { AppException } from './errors/app-exception';
import { isWarehouseRole, warehouseScope, WH_ALL, WH_MANAGER, WH_STAFF } from './warehouse-roles';

function code(run: () => unknown): string | undefined {
  try { run(); } catch (error) { return error instanceof AppException ? error.code : 'OTHER'; }
  return undefined;
}

describe('Warehouse role groups', () => {
  it('keeps factory warehouse staff out of every group until features grant it', () => {
    for (const group of [WH_STAFF, WH_MANAGER, WH_ALL]) expect(group).not.toContain('FACTORY_WAREHOUSE_STAFF');
  });

  it('builds WH_ALL from staff and managers', () => {
    expect([...WH_ALL].sort()).toEqual([...WH_STAFF, ...WH_MANAGER].sort());
  });

  it('matches legacy role spellings to the same group', () => {
    expect(isWarehouseRole('WarehouseManager', WH_MANAGER)).toBe(true);
    expect(isWarehouseRole('WAREHOUSE_STAFF', WH_MANAGER)).toBe(false);
    expect(isWarehouseRole('STORE_MANAGER')).toBe(false);
    expect(isWarehouseRole(undefined)).toBe(false);
  });
});

describe('warehouseScope', () => {
  const manager = { role: 'WAREHOUSE_MANAGER', type: 'employee', facilityId: 7 };

  it('returns the warehouse from the token', () => {
    expect(warehouseScope(manager)).toBe(7);
    expect(warehouseScope({ ...manager, role: 'WAREHOUSE_STAFF' }, { facilityId: 7 })).toBe(7);
  });

  it('rejects a warehouse employee asking for another warehouse', () => {
    expect(code(() => warehouseScope(manager, { facilityId: 8 }))).toBe('WAREHOUSE_FACILITY_FORBIDDEN');
  });

  it('rejects a warehouse employee without an assigned warehouse', () => {
    expect(code(() => warehouseScope({ ...manager, facilityId: null }))).toBe('WAREHOUSE_FACILITY_REQUIRED');
    expect(code(() => warehouseScope({ ...manager, facilityId: 0 }))).toBe('WAREHOUSE_FACILITY_REQUIRED');
  });

  it('lets SUPER_ADMIN pick any warehouse or see all of them', () => {
    const admin = { role: 'SUPER_ADMIN', type: 'employee', facilityId: null };
    expect(warehouseScope(admin, { facilityId: 8 })).toBe(8);
    expect(warehouseScope(admin)).toBeNull();
  });

  it.each([
    ['a store manager', { role: 'STORE_MANAGER', type: 'employee', facilityId: 7 }],
    ['factory warehouse staff', { role: 'FACTORY_WAREHOUSE_STAFF', type: 'employee', facilityId: 7 }],
    ['a customer token carrying a warehouse role', { role: 'WAREHOUSE_MANAGER', type: 'customer', facilityId: 7 }],
    ['a missing identity', undefined],
  ])('rejects %s', (_label, user) => {
    expect(code(() => warehouseScope(user))).toBe('WAREHOUSE_ACCOUNT_REQUIRED');
  });
});
