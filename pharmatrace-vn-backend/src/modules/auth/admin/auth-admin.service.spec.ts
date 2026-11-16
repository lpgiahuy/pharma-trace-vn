import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AppException } from '../../../common/errors/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthAdminService } from './auth-admin.service';

describe('Admin portal login', () => {
  const password = 'correct-password';
  const passwordHash = bcrypt.hashSync(password, 4);
  const tx = { employees: { findFirst: jest.fn() } };
  const prisma = { withAuth: jest.fn((operation: (client: typeof tx) => unknown) => operation(tx)) };
  const jwt = { sign: jest.fn(() => 'signed-token') };
  const service = new AuthAdminService(prisma as unknown as PrismaService, jwt as unknown as JwtService);

  const employee = (role: string) => ({
    id: 7, full_name: 'Test Employee', email: 'employee@example.test', role, job_title: null,
    status: 'ACTIVE', facility_id: 3, facilities: null, created_at: new Date(), password_hash: passwordHash,
  });

  beforeEach(() => jest.clearAllMocks());

  it.each(['WAREHOUSE_STAFF', 'WAREHOUSE_MANAGER', 'FACTORY_WAREHOUSE_STAFF'])(
    'sends %s to the Warehouse portal without issuing a token',
    async (role) => {
      tx.employees.findFirst.mockResolvedValue(employee(role));
      const error: unknown = await service.loginStaff({ email: 'employee@example.test', password }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).code).toBe('USE_WAREHOUSE_PORTAL');
      expect((error as AppException).getStatus()).toBe(403);
      expect(jwt.sign).not.toHaveBeenCalled();
    },
  );

  it.each(['SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST'])('signs in %s', async (role) => {
    tx.employees.findFirst.mockResolvedValue(employee(role));
    await expect(service.loginStaff({ email: 'employee@example.test', password }))
      .resolves.toMatchObject({ accessToken: 'signed-token', user: { role } });
  });

  it('does not reveal a warehouse account when the password is wrong', async () => {
    tx.employees.findFirst.mockResolvedValue(employee('WAREHOUSE_STAFF'));
    await expect(service.loginStaff({ email: 'employee@example.test', password: 'wrong-password' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });
});
