import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthUserService } from './auth-user.service';

describe('customer login by phone number (A3)', () => {
  const hash = bcrypt.hashSync('secret123', 4);
  const customer = { id: 7, full_name: 'Test', email: 'test@example.com', phone_number: '0909123456', password_hash: hash, status: 'ACTIVE' };
  const findFirst = jest.fn();
  const withAuth = jest.fn((run: (tx: unknown) => unknown, _context: unknown) => run({ customers: { findFirst } }));
  const service = new AuthUserService({ withAuth } as never, { sign: jest.fn().mockReturnValue('token') } as never);

  beforeEach(() => { jest.clearAllMocks(); findFirst.mockResolvedValue(customer); });

  it.each(['0909123456', '0909 123 456', '+84 909 123 456', '84909123456'])('looks up %p by the stored local number', async (typed) => {
    await expect(service.loginCustomer({ identifier: typed, password: 'secret123' })).resolves.toMatchObject({ accessToken: 'token' });
    expect(findFirst.mock.calls[0][0].where.OR[0]).toEqual({ phone_number: '0909123456' });
    // Row-level security compares the phone with this exact value, so it must be the normalised one.
    expect(withAuth.mock.calls[0][1]).toEqual({ operation: 'customer_login', identifier: '0909123456' });
  });

  it('still logs in by email, lower-cased', async () => {
    await service.loginCustomer({ identifier: ' Test@Example.com ', password: 'secret123' });
    expect(findFirst.mock.calls[0][0].where.OR[1]).toEqual({ email: 'test@example.com' });
    expect(withAuth.mock.calls[0][1]).toEqual({ operation: 'customer_login', identifier: 'test@example.com' });
  });

  it('rejects a wrong password', async () => {
    await expect(service.loginCustomer({ identifier: '0909123456', password: 'wrong-pass' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
