import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from './guards/roles.guard';
import { CustomerController } from '../modules/customer/customer.controller';
import { VoucherController } from '../modules/voucher/voucher.controller';
import { CreateEmployeeDto } from '../modules/employee/dto/create-employee.dto';
import { UpdateEmployeeDto } from '../modules/employee/dto/update-employee.dto';

describe('Pharmacist permissions', () => {
  it.each(['PHARMACIST', 'Pharmacist'])('accepts and stores canonical pharmacist role for %s', async (role) => {
    const dto = plainToInstance(CreateEmployeeDto, {
      email: 'pharmacist@example.test', password: 'TestOnly123!', fullName: 'Test Pharmacist', facilityId: 1, role,
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.role).toBe('PHARMACIST');
    const update = plainToInstance(UpdateEmployeeDto, { role });
    expect(await validate(update)).toHaveLength(0);
    expect(update.role).toBe('PHARMACIST');
  });

  it.each(['UNKNOWN_ROLE', 'CUSTOMER'])('rejects employee writes with %s', async (role) => {
    for (const dto of [plainToInstance(CreateEmployeeDto, { role }), plainToInstance(UpdateEmployeeDto, { role })]) {
      expect((await validate(dto)).some(error => error.property === 'role')).toBe(true);
    }
  });

  function pharmacistCanCall(controller: any, handler: any, role: string) {
    const user = { id: 1, type: 'employee', role };
    const context = {
      getClass: () => controller, getHandler: () => handler,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
    return new RolesGuard(new Reflector()).canActivate(context);
  }

  it.each([
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Inspect handler metadata without invoking the method.
    [VoucherController, VoucherController.prototype.findAll],
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Inspect handler metadata without invoking the method.
    [VoucherController, VoucherController.prototype.findOne],
  ])('grants pharmacists voucher access through %p', (controller, handler) => {
    expect(pharmacistCanCall(controller, handler, 'PHARMACIST')).toBe(true);
    expect(pharmacistCanCall(controller, handler, 'WAREHOUSE_STAFF')).toBe(false);
    expect(pharmacistCanCall(controller, handler, 'UNKNOWN_ROLE')).toBe(false);
  });

  it('denies pharmacists customer management, which is SUPER_ADMIN only', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Inspect handler metadata without invoking the method.
    expect(pharmacistCanCall(CustomerController, CustomerController.prototype.findAll, 'PHARMACIST')).toBe(false);
  });
});
