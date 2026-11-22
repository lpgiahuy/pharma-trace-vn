import { ExecutionContext, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RecordSupplierPaymentDto } from './dto/supplier-payment.dto';
import { PayableController } from './payable.controller';

type Handler = 'record' | 'history';

function context(handler: Handler, role: string, type = 'employee'): ExecutionContext {
  return {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Inspect handler metadata without invoking the method.
    getHandler: () => PayableController.prototype[handler],
    getClass: () => PayableController,
    switchToHttp: () => ({ getRequest: () => ({ user: { role, type } }) }),
  } as unknown as ExecutionContext;
}

describe('PayableController roles', () => {
  const guard = new RolesGuard(new Reflector());
  const allowed = (handler: Handler, role: string, type = 'employee') => guard.canActivate(context(handler, role, type));

  it('lets only super admins and finance managers record a payment', () => {
    for (const role of ['SUPER_ADMIN', 'FINANCE_MANAGER']) expect(allowed('record', role)).toBe(true);
    for (const role of ['ACCOUNTANT', 'ADMIN', 'STORE_MANAGER', 'WAREHOUSE_STAFF']) expect(allowed('record', role)).toBe(false);
    expect(allowed('record', 'CUSTOMER', 'customer')).toBe(false);
  });

  it('lets admins and finance roles read the history', () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'FINANCE_MANAGER']) expect(allowed('history', role)).toBe(true);
    for (const role of ['STORE_MANAGER', 'WAREHOUSE_STAFF']) expect(allowed('history', role)).toBe(false);
  });
});

describe('RecordSupplierPaymentDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const validate = (value: unknown) => pipe.transform(value, { type: 'body', metatype: RecordSupplierPaymentDto });

  it('accepts a payment and trims the reference', async () => {
    await expect(validate({ amount: 1250000.5, paymentMethod: 'BANK_TRANSFER', reference: '  FT123 ' }))
      .resolves.toEqual({ amount: 1250000.5, paymentMethod: 'BANK_TRANSFER', reference: 'FT123' });
  });

  it.each([
    [{ amount: 0, paymentMethod: 'CASH', reference: 'R1' }],
    [{ amount: -10, paymentMethod: 'CASH', reference: 'R1' }],
    [{ amount: 10.005, paymentMethod: 'CASH', reference: 'R1' }],
    [{ amount: '100', paymentMethod: 'CASH', reference: 'R1' }],
    [{ amount: 100, paymentMethod: 'CHEQUE', reference: 'R1' }],
    [{ amount: 100, paymentMethod: 'CASH', reference: '   ' }],
    [{ amount: 100, paymentMethod: 'CASH', reference: 'x'.repeat(101) }],
    [{ amount: 100, paymentMethod: 'CASH' }],
    [{ amount: 100, paymentMethod: 'CASH', reference: 'R1', status: 'PAID' }],
  ])('rejects %j', async body => {
    await expect(validate(body)).rejects.toBeDefined();
  });
});
