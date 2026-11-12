import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../prisma/prisma.service';
import { WarehouseService } from './warehouse.service';

type Run = (tx: unknown) => Promise<unknown>;

function setup(rows: { me?: unknown; staff?: unknown[]; total?: number } = {}) {
  const tx = {
    employees: {
      findUnique: jest.fn().mockResolvedValue(rows.me ?? null),
      findMany: jest.fn().mockResolvedValue(rows.staff ?? []),
      count: jest.fn().mockResolvedValue(rows.total ?? 0),
    },
  };
  const prisma = {
    withAuth: jest.fn((run: Run) => run(tx)),
    withWarehouseStaffRead: jest.fn((_actor: unknown, run: Run) => run(tx)),
  };
  return { tx, prisma, service: new WarehouseService(prisma as unknown as PrismaService) };
}

async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try { await promise; } catch (error) { return error instanceof AppException ? error.code : 'OTHER'; }
  return undefined;
}

const manager = { id: 4, role: 'WAREHOUSE_MANAGER', type: 'employee', facilityId: 7 };

describe('WarehouseService.me', () => {
  it('returns the employee profile with the assigned warehouse', async () => {
    const { service, prisma } = setup({ me: {
      id: 4, full_name: 'Manager', email: 'm@example.test', role: 'WAREHOUSE_MANAGER', status: 'ACTIVE', facility_id: 7,
      facilities: { id: 7, facility_name: 'Central warehouse', facility_type: 'WAREHOUSE', address: null },
    } });
    await expect(service.me(manager)).resolves.toEqual({
      id: 4, fullName: 'Manager', email: 'm@example.test', role: 'WAREHOUSE_MANAGER', status: 'ACTIVE', facilityId: 7,
      facility: { id: 7, name: 'Central warehouse', type: 'WAREHOUSE', address: null },
    });
    expect(prisma.withAuth).toHaveBeenCalledWith(expect.any(Function), { actor: expect.objectContaining({ id: 4, role: 'WAREHOUSE_MANAGER' }) });
  });

  it('reports a missing profile', async () => {
    expect(await errorCode(setup().service.me(manager))).toBe('WAREHOUSE_PROFILE_NOT_FOUND');
  });
});

describe('WarehouseService.staff', () => {
  it('lists only the caller\'s warehouse', async () => {
    const { service, tx } = setup({ total: 1, staff: [{ id: 5, full_name: 'Staff', email: 's@example.test', role: 'WAREHOUSE_STAFF', status: 'ACTIVE', facility_id: 7 }] });
    const page = await service.staff(manager, {});
    expect(page.items).toEqual([{ id: 5, fullName: 'Staff', email: 's@example.test', role: 'WAREHOUSE_STAFF', status: 'ACTIVE', facilityId: 7 }]);
    expect(page.pagination).toEqual({ total: 1, page: 1, limit: 20, totalPages: 1 });
    expect(tx.employees.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { facility_id: 7 } }));
    expect(tx.employees.findMany.mock.calls[0][0].select).not.toHaveProperty('password_hash');
  });

  it('rejects a manager asking for another warehouse before touching the database', async () => {
    const { service, prisma } = setup();
    expect(await errorCode(service.staff(manager, { facilityId: 8 }))).toBe('WAREHOUSE_FACILITY_FORBIDDEN');
    expect(prisma.withWarehouseStaffRead).not.toHaveBeenCalled();
  });

  it('lets SUPER_ADMIN choose a warehouse', async () => {
    const { service, tx } = setup();
    await service.staff({ id: 1, role: 'SUPER_ADMIN', type: 'employee' }, { facilityId: 8, page: 2, limit: 10 });
    expect(tx.employees.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { facility_id: 8 }, skip: 10, take: 10 }));
  });

  it('passes the caller\'s real role to the RLS helper, the second gate after the route guard', async () => {
    const { service, prisma } = setup();
    await service.staff({ id: 5, role: 'WAREHOUSE_STAFF', type: 'employee', facilityId: 7 }, {});
    // The route guard stops staff first; the RLS helper is the second gate and receives the real role.
    expect(prisma.withWarehouseStaffRead).toHaveBeenCalledWith(expect.objectContaining({ role: 'WAREHOUSE_STAFF' }), expect.any(Function));
  });
});
