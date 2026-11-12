import { warehouseError } from '../modules/warehouse/warehouse-errors';
import { normalizeRole } from './auth-identity';

/**
 * Warehouse role groups, mirrored in the database by public.app_role_group() in
 * database/security/access/app_role_groups.sql. Change both together.
 *
 * FACTORY_WAREHOUSE_STAFF is intentionally not a member yet: it is added per feature, together with the
 * workflows that need it (inventory reads, factory batch intake, non-order stock transfers).
 */
export const WH_STAFF = ['WAREHOUSE_STAFF'] as const;
export const WH_MANAGER = ['WAREHOUSE_MANAGER', 'SUPER_ADMIN'] as const;
export const WH_ALL = [...WH_STAFF, ...WH_MANAGER] as const;

export type WarehouseRole = (typeof WH_ALL)[number];

export function isWarehouseRole(role: string | undefined, group: readonly string[] = WH_ALL): boolean {
  const normalized = normalizeRole(role);
  return normalized !== undefined && group.includes(normalized);
}

interface ScopeUser {
  role?: string;
  type?: string;
  facilityId?: number | null;
}

/**
 * Resolves which warehouse a request may read or change.
 * - Warehouse staff and managers always get the warehouse from their token; passing another facilityId is refused.
 * - SUPER_ADMIN may pick any warehouse with ?facilityId=, or gets null (all warehouses) without it.
 */
export function warehouseScope(user: ScopeUser | undefined, query: { facilityId?: number } = {}): number | null {
  if (!user || user.type !== 'employee' || !isWarehouseRole(user.role)) throw warehouseError('WAREHOUSE_ACCOUNT_REQUIRED');
  const requested = query.facilityId;
  if (normalizeRole(user.role) === 'SUPER_ADMIN') return requested ?? null;
  const own = Number(user.facilityId);
  if (!Number.isInteger(own) || own <= 0) throw warehouseError('WAREHOUSE_FACILITY_REQUIRED');
  if (requested !== undefined && requested !== own) throw warehouseError('WAREHOUSE_FACILITY_FORBIDDEN');
  return own;
}
