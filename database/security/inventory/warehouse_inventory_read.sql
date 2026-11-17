\set ON_ERROR_STOP on
BEGIN;
-- Read-only warehouse views of stock, logs and quarantine, scoped to the caller's own facility.
-- The backend sets app.inventory_operation = 'warehouse_read' for these reads. In that mode only the
-- warehouse_read policies apply; every other flow keeps its current unrestricted access through *_default.
DO $$ BEGIN
  IF to_regclass('public.quarantine_movements') IS NULL OR to_regprocedure('public.app_role_in_group(text)') IS NULL THEN
    RAISE EXCEPTION 'Install quarantine_balances.sql and app_role_groups.sql first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.warehouse_read_scope(unit integer) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT current_setting('app.inventory_operation', true) = 'warehouse_read'
    AND NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
    AND public.app_role_in_group('WH_READ')
    AND (current_setting('app.current_user_role', true) = 'SUPER_ADMIN'
      OR unit = NULLIF(current_setting('app.current_unit_id', true), '')::integer)
$$;
REVOKE ALL ON FUNCTION public.warehouse_read_scope(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.warehouse_read_scope(integer) TO app_user;

ALTER TABLE public.inventories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quarantine_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quarantine_movements ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.quarantine_balances, public.quarantine_movements TO app_user;

DROP POLICY IF EXISTS inventory_default ON public.inventories;
CREATE POLICY inventory_default ON public.inventories FOR ALL TO app_user
  USING (current_setting('app.inventory_operation', true) IS DISTINCT FROM 'warehouse_read')
  WITH CHECK (current_setting('app.inventory_operation', true) IS DISTINCT FROM 'warehouse_read');
DROP POLICY IF EXISTS inventory_warehouse_read ON public.inventories;
CREATE POLICY inventory_warehouse_read ON public.inventories FOR SELECT TO app_user
  USING (public.warehouse_read_scope(facility_id));

DROP POLICY IF EXISTS inventory_log_default ON public.inventory_logs;
CREATE POLICY inventory_log_default ON public.inventory_logs FOR ALL TO app_user
  USING (current_setting('app.inventory_operation', true) IS DISTINCT FROM 'warehouse_read')
  WITH CHECK (current_setting('app.inventory_operation', true) IS DISTINCT FROM 'warehouse_read');
DROP POLICY IF EXISTS inventory_log_warehouse_read ON public.inventory_logs;
CREATE POLICY inventory_log_warehouse_read ON public.inventory_logs FOR SELECT TO app_user
  USING (public.warehouse_read_scope(facility_id));

DROP POLICY IF EXISTS quarantine_balance_warehouse_read ON public.quarantine_balances;
CREATE POLICY quarantine_balance_warehouse_read ON public.quarantine_balances FOR SELECT TO app_user
  USING (public.warehouse_read_scope(facility_id));
DROP POLICY IF EXISTS quarantine_movement_warehouse_read ON public.quarantine_movements;
CREATE POLICY quarantine_movement_warehouse_read ON public.quarantine_movements FOR SELECT TO app_user
  USING (EXISTS (SELECT FROM public.inventory_logs l WHERE l.id = inventory_log_id AND public.warehouse_read_scope(l.facility_id)));
COMMIT;
