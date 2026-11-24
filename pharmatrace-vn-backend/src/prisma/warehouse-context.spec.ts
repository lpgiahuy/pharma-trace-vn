import { AuthActor } from '../common/auth-identity';
import { OrderOperation, PrismaService } from './prisma.service';

function setup() {
  const service = Object.create(PrismaService.prototype) as PrismaService;
  const tx = { $queryRaw: jest.fn().mockResolvedValue([{ ready: true }]) };
  service.$transaction = jest.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)) as unknown as PrismaService['$transaction'];
  const settings = () => tx.$queryRaw.mock.calls.slice(1).map((call: unknown[]) => call[1]);
  return { service, tx, settings };
}

const manager: AuthActor = { id: 4, type: 'employee', role: 'WAREHOUSE_MANAGER', facilityId: 7 };
const factory: AuthActor = { id: 5, type: 'employee', role: 'FACTORY_WAREHOUSE_STAFF', facilityId: 7 };

describe('Order context for warehouse managers', () => {
  it.each(['read', 'pack', 'transfer_read', 'dispatch', 'receive', 'replace'] as OrderOperation[])('allows %s at the own warehouse', async (operation) => {
    const { service, settings } = setup();
    await expect(service.withOrder(operation, () => Promise.resolve('ok'), manager)).resolves.toBe('ok');
    expect(settings()).toEqual([operation, '4', 'employee', 'WAREHOUSE_MANAGER', '7']);
  });

  it.each(['status', 'checkout', 'prescription'] as OrderOperation[])('rejects %s', async (operation) => {
    const { service } = setup();
    const run = jest.fn();
    await expect(service.withOrder(operation, run, manager)).rejects.toThrow('Invalid order access scope');
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects a manager without an assigned warehouse', async () => {
    const { service } = setup();
    await expect(service.withOrder('dispatch', jest.fn(), { ...manager, facilityId: null })).rejects.toThrow('not assigned to a facility');
  });

  it.each(['read', 'replace', 'pack'] as OrderOperation[])('keeps factory warehouse staff out of %s', async (operation) => {
    const { service } = setup();
    await expect(service.withOrder(operation, jest.fn(), factory)).rejects.toThrow('Invalid order access scope');
  });
});

describe('Order context for factory warehouse staff sending stock', () => {
  // receive: recall collections sent back to the factory only, checked by the transfer service and the database.
  it.each(['transfer_read', 'dispatch', 'receive'] as OrderOperation[])('allows %s at the own factory', async (operation) => {
    const { service, settings } = setup();
    await expect(service.withOrder(operation, () => Promise.resolve('ok'), factory)).resolves.toBe('ok');
    expect(settings()).toEqual([operation, '5', 'employee', 'FACTORY_WAREHOUSE_STAFF', '7']);
  });
});

describe('Warehouse staff roster context', () => {
  it('sets a read-only roster operation for a manager at the own warehouse', async () => {
    const { service, settings } = setup();
    await expect(service.withWarehouseStaffRead(manager, () => Promise.resolve('ok'))).resolves.toBe('ok');
    expect(settings()).toEqual(['warehouse_read', '4', 'employee', 'WAREHOUSE_MANAGER', '7']);
  });

  it('lets SUPER_ADMIN read without an assigned warehouse', async () => {
    const { service, settings } = setup();
    await service.withWarehouseStaffRead({ id: 1, type: 'employee', role: 'SUPER_ADMIN' }, () => Promise.resolve('ok'));
    expect(settings()).toEqual(['warehouse_read', '1', 'employee', 'SUPER_ADMIN', '']);
  });

  it.each(['WAREHOUSE_STAFF', 'FACTORY_WAREHOUSE_STAFF', 'STORE_MANAGER'])('rejects %s before querying', async (role) => {
    const { service, tx } = setup();
    const run = jest.fn();
    await expect(service.withWarehouseStaffRead({ id: 2, type: 'employee', role, facilityId: 7 }, run)).rejects.toThrow('Invalid warehouse staff scope');
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects a manager without an assigned warehouse', async () => {
    const { service } = setup();
    await expect(service.withWarehouseStaffRead({ ...manager, facilityId: null }, jest.fn())).rejects.toThrow('not assigned to a facility');
  });

  it('fails closed when the roster policy is missing', async () => {
    const { service, tx } = setup();
    tx.$queryRaw.mockResolvedValue([{ ready: false }]);
    const run = jest.fn();
    await expect(service.withWarehouseStaffRead(manager, run)).rejects.toThrow('Warehouse staff RLS setup is not ready');
    expect(run).not.toHaveBeenCalled();
  });
});
