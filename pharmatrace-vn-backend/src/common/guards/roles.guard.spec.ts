import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { CustomerGuard } from './customer.guard';

function context(user: unknown) {
  return { getHandler: () => null, getClass: () => null,
    switchToHttp: () => ({ getRequest: () => ({ user }) }) } as unknown as ExecutionContext;
}

describe('Account role boundaries', () => {
  const guard = (roles: string[]) => new RolesGuard({ getAllAndOverride: () => roles } as unknown as Reflector);

  it('does not let ADMIN bypass a SUPER_ADMIN-only endpoint', () => {
    expect(guard(['SUPER_ADMIN']).canActivate(context({ role: 'ADMIN', type: 'employee' }))).toBe(false);
  });

  it('accepts known legacy spellings without granting a different role', () => {
    expect(guard(['STORE_MANAGER']).canActivate(context({ role: 'StoreManager', type: 'employee' }))).toBe(true);
    expect(guard(['PHARMACIST']).canActivate(context({ role: 'StoreManager', type: 'employee' }))).toBe(false);
  });

  it('does not let a super administrator use customer-only routes', () => {
    expect(guard(['CUSTOMER']).canActivate(context({ role: 'SUPER_ADMIN', type: 'employee' }))).toBe(false);
  });

  it('rejects a role paired with the wrong account type', () => {
    expect(guard(['SUPER_ADMIN']).canActivate(context({ role: 'SUPER_ADMIN', type: 'customer' }))).toBe(false);
  });

  it('rejects an employee token on customer routes even when IDs coincide', () => {
    expect(() => new CustomerGuard().canActivate(context({ id: 1, role: 'PHARMACIST', type: 'employee' }))).toThrow();
    expect(new CustomerGuard().canActivate(context({ id: 1, role: 'CUSTOMER', type: 'customer' }))).toBe(true);
  });

  it('lets a warehouse manager use routes opened to warehouse managers', () => {
    expect(guard(['SUPER_ADMIN', 'WAREHOUSE_MANAGER']).canActivate(context({ role: 'WAREHOUSE_MANAGER', type: 'employee' }))).toBe(true);
    expect(guard(['SUPER_ADMIN', 'WAREHOUSE_MANAGER']).canActivate(context({ role: 'WarehouseManager', type: 'employee' }))).toBe(true);
  });

  it('does not treat warehouse staff or store managers as warehouse managers', () => {
    expect(guard(['WAREHOUSE_MANAGER']).canActivate(context({ role: 'WAREHOUSE_STAFF', type: 'employee' }))).toBe(false);
    expect(guard(['WAREHOUSE_MANAGER']).canActivate(context({ role: 'STORE_MANAGER', type: 'employee' }))).toBe(false);
  });

  it('does not let factory warehouse staff use warehouse staff routes', () => {
    expect(guard(['WAREHOUSE_STAFF', 'WAREHOUSE_MANAGER']).canActivate(context({ role: 'FACTORY_WAREHOUSE_STAFF', type: 'employee' }))).toBe(false);
  });

  it('rejects a warehouse manager role on a customer token', () => {
    expect(guard(['WAREHOUSE_MANAGER']).canActivate(context({ role: 'WAREHOUSE_MANAGER', type: 'customer' }))).toBe(false);
  });

  it('rejects a missing identity', () => {
    expect(() => new CustomerGuard().canActivate(context(undefined))).toThrow();
  });
});
