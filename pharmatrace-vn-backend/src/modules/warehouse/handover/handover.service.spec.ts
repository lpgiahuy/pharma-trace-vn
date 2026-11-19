import { Prisma } from '@prisma/client';
import { AppException } from '../../../common/errors/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { HandoverService } from './handover.service';

const staff = { type: 'employee', id: 12, role: 'WAREHOUSE_STAFF', facilityId: 3 };
const admin = { ...staff, id: 1, role: 'SUPER_ADMIN', facilityId: undefined };

const handoverRow = {
  id: 9, handover_code: 'HOV-000001', courier_name: 'GHN', driver_name: 'Driver', driver_phone: null, vehicle_plate: null,
  note: null, handed_over_at: new Date('2026-11-19T10:00:00Z'),
  facility: { facility_name: 'Central' }, handed_over_by: { full_name: 'Staff' },
  packages: [{ package: { package_code: 'PKG-1', orders: { order_code: 'ORD-1', recipient_name: 'An' }, _count: { order_package_items: 2 } } }],
};

function setup(queryRaw: jest.Mock = jest.fn().mockResolvedValue([{ id: 9 }])) {
  const tx = {
    order_packages: { findMany: jest.fn().mockResolvedValue([]) },
    carrier_handovers: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(handoverRow),
      findFirst: jest.fn().mockResolvedValue(handoverRow),
      findMany: jest.fn().mockResolvedValue([handoverRow]),
    },
    $queryRaw: queryRaw,
  };
  const prisma = { withOrder: jest.fn((_operation: string, run: (client: typeof tx) => unknown) => run(tx)) };
  return { service: new HandoverService(prisma as unknown as PrismaService), tx, prisma };
}

const dto = { handoverCode: 'HOV-000001', courierName: 'GHN', packageCodes: ['PKG-1'] };

function databaseError(message: string) {
  return new Prisma.PrismaClientKnownRequestError('raw query failed', { code: 'P2010', clientVersion: 'test', meta: { message } });
}

describe('HandoverService', () => {
  it('groups pending packages by carrier and flags unconfirmed carriers', async () => {
    const { service, tx } = setup();
    const row = (code: string, courier: string, confirmed: boolean) => ({
      package_code: code,
      orders: { order_code: `ORD-${code}`, recipient_name: 'An', shipments: { courier_name: courier, carrier_confirmed_at: confirmed ? new Date() : null } },
      _count: { order_package_items: 1 },
    });
    tx.order_packages.findMany.mockResolvedValue([row('A', 'GHN', true), row('B', 'VNPOST', false), row('C', 'GHN', true)]);
    const result = await service.pending(staff, {});
    expect(result.map(carrier => [carrier.courierName, carrier.packages.map(pkg => pkg.packageCode)])).toEqual([['GHN', ['A', 'C']], ['VNPOST', ['B']]]);
    expect(result[1].packages[0].carrierConfirmed).toBe(false);
    expect(tx.order_packages.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ facility_id: 3, status: 'PACKED' }) }));
  });

  it('records a handover in the own warehouse with the pack operation', async () => {
    const { service, prisma, tx } = setup();
    await expect(service.create(staff, dto)).resolves.toMatchObject({ id: 9, courierName: 'GHN', packages: [{ packageCode: 'PKG-1', boxCount: 2 }] });
    expect(prisma.withOrder).toHaveBeenCalledWith('pack', expect.any(Function), expect.anything());
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['HOV-000001', 3, 'GHN', null, null, null, null, ['PKG-1']]);
  });

  it('asks a super admin to choose the warehouse', async () => {
    const { service } = setup();
    await expect(service.create(admin, dto)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'WAREHOUSE_FACILITY_REQUIRED' }) });
    await expect(service.create(admin, { ...dto, facilityId: 4 })).resolves.toMatchObject({ id: 9 });
  });

  it('rejects another warehouse for staff', async () => {
    const { service } = setup();
    await expect(service.create(staff, { ...dto, facilityId: 4 })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'WAREHOUSE_FACILITY_FORBIDDEN' }) });
  });

  it.each([
    ['HV_CARRIER_MISMATCH'],
    ['HV_PACKAGE_NOT_PACKED'],
    ['HV_CARRIER_NOT_CONFIRMED'],
    ['HV_SHIPMENT_NOT_READY'],
  ])('maps the database rejection %s to its error code', async code => {
    const { service } = setup(jest.fn().mockRejectedValue(databaseError(code)));
    const error = await service.create(staff, dto).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).getResponse()).toMatchObject({ code });
  });

  it('returns not found for a handover outside the warehouse', async () => {
    const { service, tx } = setup();
    tx.carrier_handovers.findFirst.mockResolvedValue(null);
    await expect(service.detail(staff, 99)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'HV_NOT_FOUND' }) });
    expect(tx.carrier_handovers.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 99, facility_id: 3 } }));
  });
});
