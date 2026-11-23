\set ON_ERROR_STOP on
BEGIN;
-- Named employee role groups shared by RLS policies and security functions.
-- Mirrors pharmatrace-vn-backend/src/common/warehouse-roles.ts and report-roles.ts; change both together.
--   WH_STAFF   : warehouse floor staff
--   WH_MANAGER : warehouse managers (SUPER_ADMIN is always allowed by the callers' own lists)
--   WH_ALL     : WH_STAFF + WH_MANAGER
--   WH_READ    : WH_ALL + FACTORY_WAREHOUSE_STAFF, for read-only inventory and batch views
--   WH_TRANSFER: WH_ALL + FACTORY_WAREHOUSE_STAFF, for stock transfers sent from a factory
--   WH_QUALITY : WH_ALL + FACTORY_WAREHOUSE_STAFF, for drafting disposals and holding batches at a factory
--   FACTORY_INTAKE : FACTORY_WAREHOUSE_STAFF + SUPER_ADMIN, for registering factory batches
--   REPORT_READ    : sales dashboard reports (STORE_MANAGER sees only its own facility)
--   FINANCE_READ   : finance reports
--   STOCK_READ     : stock and expiry alerts (STORE_MANAGER sees only its own facility)
-- FACTORY_WAREHOUSE_STAFF is added per feature, together with the workflows that need it.
CREATE OR REPLACE FUNCTION public.app_role_group(group_name text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE group_name
    WHEN 'WH_STAFF' THEN ARRAY['WAREHOUSE_STAFF']
    WHEN 'WH_MANAGER' THEN ARRAY['WAREHOUSE_MANAGER', 'SUPER_ADMIN']
    WHEN 'WH_ALL' THEN ARRAY['WAREHOUSE_STAFF', 'WAREHOUSE_MANAGER', 'SUPER_ADMIN']
    WHEN 'WH_READ' THEN ARRAY['WAREHOUSE_STAFF', 'WAREHOUSE_MANAGER', 'SUPER_ADMIN', 'FACTORY_WAREHOUSE_STAFF']
    WHEN 'WH_TRANSFER' THEN ARRAY['WAREHOUSE_STAFF', 'WAREHOUSE_MANAGER', 'SUPER_ADMIN', 'FACTORY_WAREHOUSE_STAFF']
    WHEN 'WH_QUALITY' THEN ARRAY['WAREHOUSE_STAFF', 'WAREHOUSE_MANAGER', 'SUPER_ADMIN', 'FACTORY_WAREHOUSE_STAFF']
    WHEN 'FACTORY_INTAKE' THEN ARRAY['FACTORY_WAREHOUSE_STAFF', 'SUPER_ADMIN']
    WHEN 'REPORT_READ' THEN ARRAY['SUPER_ADMIN', 'ADMIN', 'STORE_MANAGER', 'ACCOUNTANT', 'FINANCE_MANAGER']
    WHEN 'FINANCE_READ' THEN ARRAY['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'FINANCE_MANAGER']
    WHEN 'STOCK_READ' THEN ARRAY['SUPER_ADMIN', 'ADMIN', 'STORE_MANAGER']
  END
$$;

-- True when the current request's employee role belongs to the named group. Unknown groups raise, so a typo
-- in a policy fails loudly instead of silently denying (or granting) access.
CREATE OR REPLACE FUNCTION public.app_role_in_group(group_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE members text[] := public.app_role_group(group_name);
BEGIN
  IF members IS NULL THEN
    RAISE EXCEPTION 'Unknown role group %', group_name USING ERRCODE = '22023';
  END IF;
  -- Never NULL: callers use it inside NOT (...) checks, where NULL would silently skip a RAISE.
  RETURN coalesce(current_setting('app.current_user_type', true) = 'employee', false)
    AND coalesce(current_setting('app.current_user_role', true), '') = ANY (members);
END $$;

REVOKE ALL ON FUNCTION public.app_role_group(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_role_in_group(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_role_group(text) TO app_user, auth_runtime;
GRANT EXECUTE ON FUNCTION public.app_role_in_group(text) TO app_user, auth_runtime;
COMMIT;
