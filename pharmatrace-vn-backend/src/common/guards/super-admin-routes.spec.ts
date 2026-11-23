import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { CustomerController } from '../../modules/customer/customer.controller';
import { ProductController } from '../../modules/product/product.controller';

const guard = new RolesGuard(new Reflector());

function canCall(controller: any, method: string, role: string): boolean {
  const context = {
    getHandler: () => controller.prototype[method],
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user: { role, type: 'employee' } }) }),
  } as unknown as ExecutionContext;
  return guard.canActivate(context) as boolean;
}

const OTHER_STAFF = ['STORE_MANAGER', 'PHARMACIST', 'ADMIN', 'WAREHOUSE_STAFF'];

describe('A6: customer management is SUPER_ADMIN only', () => {
  const methods = ['findAll', 'findOne', 'updateStatus', 'getCustomerOrders'];
  it.each(methods)('%s allows SUPER_ADMIN', method => {
    expect(canCall(CustomerController, method, 'SUPER_ADMIN')).toBe(true);
  });
  it.each(methods.flatMap(m => OTHER_STAFF.map(r => [m, r])))('%s denies %s', (method, role) => {
    expect(canCall(CustomerController, method, role)).toBe(false);
  });
});

describe('A7: medicine writes are SUPER_ADMIN only', () => {
  const writes = Object.getOwnPropertyNames(ProductController.prototype).filter(name =>
    Reflect.getMetadata('path', (ProductController.prototype as any)[name])?.toString().startsWith('admin/products'),
  );
  it('finds the admin write endpoints', () => {
    expect(writes.length).toBeGreaterThanOrEqual(5);
  });
  it.each(writes)('%s allows SUPER_ADMIN', method => {
    expect(canCall(ProductController, method, 'SUPER_ADMIN')).toBe(true);
  });
  it.each(writes.flatMap(m => OTHER_STAFF.map(r => [m, r])))('%s denies %s', (method, role) => {
    expect(canCall(ProductController, method, role)).toBe(false);
  });
});
