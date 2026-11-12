import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { authActor } from '../../common/auth-identity';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { warehouseScope } from '../../common/warehouse-roles';
import { PrismaService } from '../../prisma/prisma.service';
import { WarehouseStaffQueryDto } from './dto/warehouse-staff-query.dto';
import { warehouseError } from './warehouse-errors';

const facilitySelect = { id: true, facility_name: true, facility_type: true, address: true } satisfies Prisma.facilitiesSelect;
const employeeSelect = {
  id: true, full_name: true, email: true, role: true, status: true, facility_id: true,
} satisfies Prisma.employeesSelect;

type EmployeeRow = Prisma.employeesGetPayload<{ select: typeof employeeSelect }>;
type FacilityRow = Prisma.facilitiesGetPayload<{ select: typeof facilitySelect }>;

export interface WarehouseFacility {
  id: number;
  name: string;
  type: string;
  address: string | null;
}

export interface WarehouseStaffMember {
  id: number;
  fullName: string;
  email: string;
  role: string;
  status: string;
  facilityId: number | null;
}

export interface WarehouseProfile extends WarehouseStaffMember {
  facility: WarehouseFacility | null;
}

export interface WarehouseStaffPage {
  items: WarehouseStaffMember[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

function toFacility(row: FacilityRow | null): WarehouseFacility | null {
  return row ? { id: row.id, name: row.facility_name, type: row.facility_type, address: row.address ?? null } : null;
}

function toStaffMember(row: EmployeeRow): WarehouseStaffMember {
  return {
    id: row.id,
    fullName: row.full_name ?? '',
    email: row.email ?? '',
    role: row.role ?? '',
    status: row.status ?? 'ACTIVE',
    facilityId: row.facility_id,
  };
}

@Injectable()
export class WarehouseService {
  constructor(private readonly prisma: PrismaService) {}

  /** The signed-in employee and the warehouse they work at. */
  async me(user: CurrentUserPayload): Promise<WarehouseProfile> {
    const actor = authActor(user);
    if (actor.type !== 'employee') throw warehouseError('WAREHOUSE_ACCOUNT_REQUIRED');
    const row = await this.prisma.withAuth(tx => tx.employees.findUnique({
      where: { id: actor.id },
      select: { ...employeeSelect, facilities: { select: facilitySelect } },
    }), { actor });
    if (!row) throw warehouseError('WAREHOUSE_PROFILE_NOT_FOUND');
    return { ...toStaffMember(row), facility: toFacility(row.facilities) };
  }

  /** Read-only roster of the employees at the caller's warehouse (any warehouse for SUPER_ADMIN). */
  async staff(user: CurrentUserPayload, query: WarehouseStaffQueryDto = {}): Promise<WarehouseStaffPage> {
    const facilityId = warehouseScope(user, query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.employeesWhereInput = facilityId === null ? {} : { facility_id: facilityId };
    const [total, rows] = await this.prisma.withWarehouseStaffRead(authActor(user), tx => Promise.all([
      tx.employees.count({ where }),
      tx.employees.findMany({ where, select: employeeSelect, orderBy: [{ full_name: 'asc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit }),
    ]));
    return { items: rows.map(toStaffMember), pagination: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  }
}
