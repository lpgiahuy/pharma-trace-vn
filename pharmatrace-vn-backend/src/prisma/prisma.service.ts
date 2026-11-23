import { Injectable, OnModuleInit, OnModuleDestroy, ServiceUnavailableException, ForbiddenException } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { AuthActor, authActor } from '../common/auth-identity';
import { FACTORY_INTAKE, WH_ALL, WH_MANAGER, WH_READ, WH_TRANSFER } from '../common/warehouse-roles';
import { REPORT_READ } from '../common/report-roles';

export type ReviewScope = 'public' | 'customer' | 'staff' | 'moderator' | 'helpful';
export type VoucherScope = 'validate' | 'read' | 'manage' | 'available';
export type OrderOperation = 'read' | 'checkout' | 'cancel' | 'customer_receive' | 'status' | 'pack' | 'transfer_read' | 'dispatch' | 'receive' | 'replace' | 'prescription' | 'loyalty';

export interface AuthContext {
  actor?: AuthActor;
  operation?: 'customer_login' | 'employee_login' | 'register';
  identifier?: string;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required');
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    super({ adapter });
    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }

  async withAuth<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    context: AuthContext = {},
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      if (process.env.AUTH_RLS_ENABLED === 'true') {
        const [role] = await tx.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean; protected: boolean; connection_restricted: boolean }[]>`
          SELECT r.rolsuper, r.rolbypassrls,
            NOT connection.rolsuper AND NOT connection.rolbypassrls AS connection_restricted,
            (SELECT count(*) = 2 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity
                AND c.relowner <> r.oid AND c.relowner <> connection.oid)
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname IN ('customers', 'employees')) AS protected
          FROM pg_roles r JOIN pg_roles connection ON connection.rolname = current_user
          WHERE r.rolname = 'auth_runtime'
        `;
        if (!role || role.rolsuper || role.rolbypassrls || !role.protected || !role.connection_restricted) {
          throw new ServiceUnavailableException('Auth RLS migration is not ready');
        }
        await tx.$executeRaw`SET LOCAL ROLE auth_runtime`;
      }
      const actor = context.actor;
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${actor ? String(actor.id) : ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor?.type || ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor?.role || ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_unit_id', ${actor?.facilityId ? String(actor.facilityId) : ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.auth_operation', ${context.operation || ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.auth_identifier', ${context.identifier || ''}, true)`;
      return operation(tx);
    });
  }

  async withReview<T>(scope: ReviewScope, operation: (tx: Prisma.TransactionClient) => Promise<T>, identity?: AuthActor): Promise<T> {
    const actor = identity ? authActor(identity) : undefined;
    const staffRoles = ['SUPER_ADMIN', 'ADMIN', 'STORE_MANAGER', 'PHARMACIST'];
    if (!['public', 'customer', 'staff', 'moderator', 'helpful'].includes(scope)
      || (scope === 'customer' && (actor?.type !== 'customer' || actor.role !== 'CUSTOMER'))
      || (scope === 'staff' && (actor?.type !== 'employee' || !staffRoles.includes(actor.role)))
      || (scope === 'moderator' && (actor?.type !== 'employee' || !['SUPER_ADMIN', 'ADMIN'].includes(actor.role)))
      || (['public', 'helpful'].includes(scope) && actor)) {
      throw new ForbiddenException('Invalid review access scope');
    }
    return this.$transaction(async (tx) => {
      const [state] = await tx.$queryRaw<{ ready: boolean }[]>`
        SELECT NOT runtime.rolsuper AND NOT runtime.rolbypassrls
          AND (SELECT count(*) = 3 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity
              AND c.relowner <> runtime.oid)
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname IN ('reviews', 'moderation_reports', 'moderation_audit_logs')) AS ready
        FROM pg_roles runtime WHERE runtime.rolname = current_user
      `;
      if (!state?.ready) throw new ServiceUnavailableException('Review RLS setup is not ready');
      await tx.$queryRaw`SELECT set_config('app.review_scope', ${scope}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${actor ? String(actor.id) : ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor?.type || ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor?.role || ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_unit_id', ${actor?.facilityId ? String(actor.facilityId) : ''}, true)`;
      return operation(tx);
    });
  }

  async withArticle<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>, identity?: AuthActor): Promise<T> {
    const actor = identity ? authActor(identity) : undefined;
    return this.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${actor ? String(actor.id) : ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor?.type || ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor?.role || ''}, true)`;
      return operation(tx);
    });
  }

  async prepareVoucher(tx: Prisma.TransactionClient, scope: VoucherScope | 'checkout', code = '', orderId?: number): Promise<void> {
    const [state] = await tx.$queryRaw<{ ready: boolean }[]>`
      SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND c.relrowsecurity AND c.relforcerowsecurity
        AND c.relowner <> r.oid AS ready
      FROM pg_roles r JOIN pg_class c ON c.relname = 'vouchers'
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE r.rolname = current_user
    `;
    if (!state?.ready) throw new ServiceUnavailableException('Voucher RLS setup is not ready');
    await tx.$queryRaw`SELECT set_config('app.voucher_scope', ${scope}, true)`;
    await tx.$queryRaw`SELECT set_config('app.voucher_code', ${code.trim().toUpperCase()}, true)`;
    await tx.$queryRaw`SELECT set_config('app.voucher_order_id', ${orderId ? String(orderId) : ''}, true)`;
  }

  async withCustomerManagement<T>(identity: AuthActor, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const actor = authActor(identity);
    if (actor.type !== 'employee' || !['SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST'].includes(actor.role)) throw new ForbiddenException('Invalid customer management scope');
    return this.$transaction(async tx => {
      const [state] = await tx.$queryRaw<{ ready: boolean }[]>`
        SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND c.relrowsecurity AND c.relforcerowsecurity
          AND c.relowner <> r.oid AS ready
        FROM pg_roles r JOIN pg_class c ON c.relname = 'customers'
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE r.rolname = current_user
      `;
      if (!state?.ready) throw new ServiceUnavailableException('Customer RLS setup is not ready');
      await tx.$queryRaw`SELECT set_config('app.customer_operation', ${'manage'}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${String(actor.id)}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor.type}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor.role}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_unit_id', ${actor.facilityId ? String(actor.facilityId) : ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.order_operation', ${'read'}, true)`;
      return run(tx);
    });
  }

  async withCatalogManagement<T>(identity: AuthActor, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const actor = authActor(identity);
    if (actor.type !== 'employee' || !['SUPER_ADMIN', 'STORE_MANAGER'].includes(actor.role)) throw new ForbiddenException('Invalid catalog management scope');
    return this.$transaction(async tx => {
      const [state] = await tx.$queryRaw<{ ready: boolean }[]>`
        SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND c.relowner <> r.oid) AS ready
        FROM pg_roles r JOIN pg_class c ON c.relname = ANY(ARRAY['medicines','categories','medicine_categories','packaging_variants'])
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE r.rolname = current_user
        GROUP BY r.rolsuper, r.rolbypassrls, r.oid HAVING count(*) = 4
      `;
      if (!state?.ready) throw new ServiceUnavailableException('Catalog RLS setup is not ready');
      await tx.$queryRaw`SELECT set_config('app.catalog_operation', ${'manage'}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${String(actor.id)}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor.type}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor.role}, true)`;
      return run(tx);
    });
  }


  async withEmployeeManagement<T>(identity: AuthActor, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const actor = authActor(identity);
    if (actor.type !== 'employee' || !['SUPER_ADMIN', 'STORE_MANAGER'].includes(actor.role)) throw new ForbiddenException('Invalid employee management scope');
    if (actor.role === 'STORE_MANAGER' && (!Number.isInteger(actor.facilityId) || Number(actor.facilityId) <= 0)) throw new ForbiddenException('Staff account is not assigned to a facility');
    return this.$transaction(async tx => {
      const [state] = await tx.$queryRaw<{ ready: boolean }[]>`
        SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND c.relrowsecurity AND c.relforcerowsecurity
          AND c.relowner <> r.oid AND EXISTS (SELECT FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='employee_facility_management') AS ready
        FROM pg_roles r JOIN pg_class c ON c.relname = 'employees'
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE r.rolname = current_user
      `;
      if (!state?.ready) throw new ServiceUnavailableException('Employee RLS setup is not ready');
      await tx.$queryRaw`SELECT set_config('app.employee_operation', ${'manage'}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${String(actor.id)}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor.type}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor.role}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_unit_id', ${actor.facilityId ? String(actor.facilityId) : ''}, true)`;
      return run(tx);
    });
  }

  /** Read-only access to the staff roster of one warehouse (employee_warehouse_read policy). */
  async withWarehouseStaffRead<T>(identity: AuthActor, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const actor = authActor(identity);
    if (actor.type !== 'employee' || !(WH_MANAGER as readonly string[]).includes(actor.role)) throw new ForbiddenException('Invalid warehouse staff scope');
    if (actor.role !== 'SUPER_ADMIN' && (!Number.isInteger(actor.facilityId) || Number(actor.facilityId) <= 0)) throw new ForbiddenException('Staff account is not assigned to a facility');
    return this.$transaction(async tx => {
      const [state] = await tx.$queryRaw<{ ready: boolean }[]>`
        SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND c.relrowsecurity AND c.relforcerowsecurity
          AND c.relowner <> r.oid AND EXISTS (SELECT FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='employee_warehouse_read') AS ready
        FROM pg_roles r JOIN pg_class c ON c.relname = 'employees'
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE r.rolname = current_user
      `;
      if (!state?.ready) throw new ServiceUnavailableException('Warehouse staff RLS setup is not ready');
      await tx.$queryRaw`SELECT set_config('app.employee_operation', ${'warehouse_read'}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${String(actor.id)}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor.type}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor.role}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_unit_id', ${actor.facilityId ? String(actor.facilityId) : ''}, true)`;
      return run(tx);
    });
  }

  /** Read-only warehouse view of stock, logs and quarantine (warehouse_read policies, own facility only). */
  async withWarehouseRead<T>(identity: AuthActor, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const actor = authActor(identity);
    if (actor.type !== 'employee' || !(WH_READ as readonly string[]).includes(actor.role)) throw new ForbiddenException('Invalid warehouse read scope');
    if (actor.role !== 'SUPER_ADMIN' && (!Number.isInteger(actor.facilityId) || Number(actor.facilityId) <= 0)) throw new ForbiddenException('Staff account is not assigned to a facility');
    return this.$transaction(async tx => {
      const [state] = await tx.$queryRaw<{ ready: boolean }[]>`
        SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND c.relrowsecurity AND c.relowner <> r.oid
          AND EXISTS (SELECT FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='inventory_warehouse_read') AS ready
        FROM pg_roles r JOIN pg_class c ON c.relname = 'inventories'
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE r.rolname = current_user
      `;
      if (!state?.ready) throw new ServiceUnavailableException('Warehouse inventory RLS setup is not ready');
      await tx.$queryRaw`SELECT set_config('app.inventory_operation', ${'warehouse_read'}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${String(actor.id)}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor.type}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor.role}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_unit_id', ${actor.facilityId ? String(actor.facilityId) : ''}, true)`;
      return run(tx);
    });
  }

  /** Batch hold and release by a warehouse manager (batch_status_event_insert policy). */
  async withBatchStatus<T>(identity: AuthActor, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const actor = authActor(identity);
    if (actor.type !== 'employee' || !(WH_MANAGER as readonly string[]).includes(actor.role)) throw new ForbiddenException('Invalid batch status scope');
    return this.$transaction(async tx => {
      const [state] = await tx.$queryRaw<{ ready: boolean }[]>`
        SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND c.relrowsecurity AND c.relowner <> r.oid
          AND EXISTS (SELECT FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='batch_status_event_insert') AS ready
        FROM pg_roles r JOIN pg_class c ON c.relname = 'batch_status_events'
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE r.rolname = current_user
      `;
      if (!state?.ready) throw new ServiceUnavailableException('Batch status RLS setup is not ready');
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${String(actor.id)}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor.type}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor.role}, true)`;
      return run(tx);
    });
  }

  /** Purchase orders of one warehouse: reads for WH_ALL, writes for WH_MANAGER (purchase_order_* policies). */
  async withPurchaseOrder<T>(identity: AuthActor, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const actor = authActor(identity);
    if (actor.type !== 'employee' || !(WH_ALL as readonly string[]).includes(actor.role)) throw new ForbiddenException('Invalid purchase order scope');
    if (actor.role !== 'SUPER_ADMIN' && (!Number.isInteger(actor.facilityId) || Number(actor.facilityId) <= 0)) throw new ForbiddenException('Staff account is not assigned to a facility');
    return this.$transaction(async tx => {
      const [state] = await tx.$queryRaw<{ ready: boolean }[]>`
        SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND c.relrowsecurity AND c.relforcerowsecurity AND c.relowner <> r.oid
          AND EXISTS (SELECT FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='purchase_order_read') AS ready
        FROM pg_roles r JOIN pg_class c ON c.relname = 'purchase_orders'
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE r.rolname = current_user
      `;
      if (!state?.ready) throw new ServiceUnavailableException('Purchase order RLS setup is not ready');
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${String(actor.id)}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor.type}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor.role}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_unit_id', ${actor.facilityId ? String(actor.facilityId) : ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.employee_operation', 'procurement_read', true)`;
      return run(tx);
    });
  }

  /** Stock counts and adjustments of one warehouse: reads for WH_ALL, writes through the stock count functions. */
  async withStockCount<T>(identity: AuthActor, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const actor = authActor(identity);
    if (actor.type !== 'employee' || !(WH_ALL as readonly string[]).includes(actor.role)) throw new ForbiddenException('Invalid stock count scope');
    if (actor.role !== 'SUPER_ADMIN' && (!Number.isInteger(actor.facilityId) || Number(actor.facilityId) <= 0)) throw new ForbiddenException('Staff account is not assigned to a facility');
    return this.$transaction(async tx => {
      const [state] = await tx.$queryRaw<{ ready: boolean }[]>`
        SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND c.relrowsecurity AND c.relforcerowsecurity AND c.relowner <> r.oid
          AND EXISTS (SELECT FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='stock_count_read') AS ready
        FROM pg_roles r JOIN pg_class c ON c.relname = 'stock_counts'
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE r.rolname = current_user
      `;
      if (!state?.ready) throw new ServiceUnavailableException('Stock count RLS setup is not ready');
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${String(actor.id)}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor.type}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor.role}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_unit_id', ${actor.facilityId ? String(actor.facilityId) : ''}, true)`;
      return run(tx);
    });
  }

  /** Drug disposals of one warehouse: reads for WH_ALL, writes through the disposal functions. */
  async withDisposal<T>(identity: AuthActor, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const actor = authActor(identity);
    if (actor.type !== 'employee' || !(WH_ALL as readonly string[]).includes(actor.role)) throw new ForbiddenException('Invalid disposal scope');
    if (actor.role !== 'SUPER_ADMIN' && (!Number.isInteger(actor.facilityId) || Number(actor.facilityId) <= 0)) throw new ForbiddenException('Staff account is not assigned to a facility');
    return this.$transaction(async tx => {
      const [state] = await tx.$queryRaw<{ ready: boolean }[]>`
        SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND c.relrowsecurity AND c.relforcerowsecurity AND c.relowner <> r.oid
          AND EXISTS (SELECT FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='disposal_read') AS ready
        FROM pg_roles r JOIN pg_class c ON c.relname = 'disposals'
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE r.rolname = current_user
      `;
      if (!state?.ready) throw new ServiceUnavailableException('Disposal RLS setup is not ready');
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${String(actor.id)}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor.type}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor.role}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_unit_id', ${actor.facilityId ? String(actor.facilityId) : ''}, true)`;
      return run(tx);
    });
  }

  /** Dashboard reports through the read-only report_* functions; STORE_MANAGER is scoped to its facility in SQL. */
  async withReport<T>(identity: AuthActor, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const actor = authActor(identity);
    if (actor.type !== 'employee' || !(REPORT_READ as readonly string[]).includes(actor.role)) throw new ForbiddenException('Invalid report scope');
    return this.$transaction(async tx => {
      const [role] = await tx.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
        SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
      `;
      if (!role || role.rolsuper || role.rolbypassrls) throw new ServiceUnavailableException('Report access requires an RLS-enabled database role');
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${String(actor.id)}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor.type}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor.role}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_unit_id', ${actor.facilityId ? String(actor.facilityId) : ''}, true)`;
      return run(tx);
    });
  }

  /** Box tracing: scan checks and timelines for WH_ALL, fraud alert reads for WH_MANAGER, writes through the traceability functions. */
  async withTraceability<T>(identity: AuthActor, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const actor = authActor(identity);
    if (actor.type !== 'employee' || !(WH_ALL as readonly string[]).includes(actor.role)) throw new ForbiddenException('Invalid traceability scope');
    if (actor.role !== 'SUPER_ADMIN' && (!Number.isInteger(actor.facilityId) || Number(actor.facilityId) <= 0)) throw new ForbiddenException('Staff account is not assigned to a facility');
    return this.$transaction(async tx => {
      const [state] = await tx.$queryRaw<{ ready: boolean }[]>`
        SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND c.relrowsecurity AND c.relforcerowsecurity AND c.relowner <> r.oid
          AND EXISTS (SELECT FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='fraud_alert_read') AS ready
        FROM pg_roles r JOIN pg_class c ON c.relname = 'fraud_alerts'
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE r.rolname = current_user
      `;
      if (!state?.ready) throw new ServiceUnavailableException('Traceability RLS setup is not ready');
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${String(actor.id)}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor.type}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor.role}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_unit_id', ${actor.facilityId ? String(actor.facilityId) : ''}, true)`;
      return run(tx);
    });
  }

  async withFactoryIntake<T>(identity: AuthActor, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const actor = authActor(identity);
    if (actor.type !== 'employee' || !(FACTORY_INTAKE as readonly string[]).includes(actor.role)) throw new ForbiddenException('Invalid factory intake scope');
    return this.$transaction(async tx => {
      const [state] = await tx.$queryRaw<{ ready: boolean }[]>`
        SELECT NOT r.rolsuper AND NOT r.rolbypassrls
          AND to_regprocedure('public.record_factory_batch(integer,integer,text,date,date,text,jsonb)') IS NOT NULL AS ready
        FROM pg_roles r WHERE r.rolname = current_user
      `;
      if (!state?.ready) throw new ServiceUnavailableException('Factory batch intake setup is not ready');
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${String(actor.id)}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor.type}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor.role}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_unit_id', ${actor.facilityId ? String(actor.facilityId) : ''}, true)`;
      return run(tx);
    });
  }

  async withFacilityManagement<T>(identity: AuthActor, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const actor = authActor(identity);
    if (actor.type !== 'employee' || actor.role !== 'SUPER_ADMIN') throw new ForbiddenException('Invalid facility management scope');
    return this.$transaction(async tx => {
      const [state] = await tx.$queryRaw<{ ready: boolean }[]>`
        SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND c.relrowsecurity AND c.relforcerowsecurity
          AND c.relowner <> r.oid AS ready
        FROM pg_roles r JOIN pg_class c ON c.relname = 'facilities'
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE r.rolname = current_user
      `;
      if (!state?.ready) throw new ServiceUnavailableException('Facility RLS setup is not ready');
      await tx.$queryRaw`SELECT set_config('app.facility_operation', ${'manage'}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${String(actor.id)}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor.type}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor.role}, true)`;
      return run(tx);
    });
  }

  async withVoucher<T>(scope: VoucherScope, run: (tx: Prisma.TransactionClient) => Promise<T>, context: { actor?: AuthActor; code?: string } = {}): Promise<T> {
    const actor = context.actor ? authActor(context.actor) : undefined;
    const roles = scope === 'read' ? ['SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST'] : ['SUPER_ADMIN'];
    const invalidActor = scope === 'validate' ? !!actor || !context.code?.trim()
      : scope === 'available' ? actor?.type !== 'customer' || actor.role !== 'CUSTOMER'
      : actor?.type !== 'employee' || !roles.includes(actor.role);
    if (!['validate', 'read', 'manage', 'available'].includes(scope) || invalidActor) {
      throw new ForbiddenException('Invalid voucher access scope');
    }
    return this.$transaction(async tx => {
      await this.prepareVoucher(tx, scope, context.code);
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${actor ? String(actor.id) : ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor?.type || ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor?.role || ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_unit_id', ${actor?.facilityId ? String(actor.facilityId) : ''}, true)`;
      return run(tx);
    });
  }

  async withOrder<T>(operation: OrderOperation, run: (tx: Prisma.TransactionClient) => Promise<T>, identity?: AuthActor): Promise<T> {
    const actor = identity ? authActor(identity) : undefined;
    const roles: Record<OrderOperation, string[]> = {
      read: ['CUSTOMER', 'SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST', ...WH_ALL, 'ACCOUNTANT', 'FINANCE_MANAGER'],
      checkout: ['CUSTOMER'], cancel: ['CUSTOMER'], customer_receive: ['CUSTOMER'],
      status: ['SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST'],
      pack: ['SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST', ...WH_ALL],
      // Factory staff send stock out (source side only): they read and dispatch transfers but never receive or resolve them.
      transfer_read: ['SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST', ...WH_TRANSFER],
      dispatch: ['SUPER_ADMIN', 'STORE_MANAGER', ...WH_TRANSFER],
      receive: ['SUPER_ADMIN', 'STORE_MANAGER', ...WH_ALL],
      // Discrepancy resolution additionally requires a manager role in the database (resolve_transfer_discrepancy).
      replace: ['SUPER_ADMIN', 'STORE_MANAGER', ...WH_ALL],
      prescription: ['SUPER_ADMIN', 'PHARMACIST'], loyalty: [],
    };
    if (!roles[operation] || (operation === 'loyalty' ? !!actor : !actor || !roles[operation].includes(actor.role))) {
      throw new ForbiddenException('Invalid order access scope');
    }
    if (actor?.type === 'employee' && !['SUPER_ADMIN', 'ACCOUNTANT', 'FINANCE_MANAGER'].includes(actor.role) && (!Number.isInteger(actor.facilityId) || Number(actor.facilityId) <= 0)) {
      throw new ForbiddenException('Staff account is not assigned to a facility.');
    }
    return this.$transaction(async tx => {
      const [state] = await tx.$queryRaw<{ ready: boolean }[]>`
        SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND
          (SELECT count(*) = 5 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND c.relowner <> r.oid)
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname IN ('orders', 'order_items', 'shipments', 'internal_transfers', 'loyalty_point_logs')) AS ready
        FROM pg_roles r WHERE r.rolname = current_user
      `;
      if (!state?.ready) throw new ServiceUnavailableException('Order RLS setup is not ready');
      await tx.$queryRaw`SELECT set_config('app.order_operation', ${operation}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${actor ? String(actor.id) : ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor?.type || ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor?.role || ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_unit_id', ${actor?.facilityId ? String(actor.facilityId) : ''}, true)`;
      return run(tx);
    }, { timeout: 15000 });
  }

  async withActor<T>(
    actor: { id: number; role: string; type: 'customer' | 'employee'; facilityId?: number | null },
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      const [role] = await tx.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
        SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
      `;
      if (!role || role.rolsuper || role.rolbypassrls) {
        throw new ServiceUnavailableException('Actor access requires an RLS-enabled database role');
      }
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${String(actor.id)}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor.role}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor.type}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_unit_id', ${actor.facilityId ? String(actor.facilityId) : ''}, true)`;
      return operation(tx);
    });
  }
}
