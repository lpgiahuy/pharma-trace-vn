\set ON_ERROR_STOP on
BEGIN;
-- Named employee role groups shared by RLS policies and security functions.
-- Mirrors pharmatrace-vn-backend/src/common/warehouse-roles.ts; change both together.
--   WH_STAFF   : warehouse floor staff
--   WH_MANAGER : warehouse managers (SUPER_ADMIN is always allowed by the callers' own lists)
--   WH_ALL     : WH_STAFF + WH_MANAGER
--   WH_READ    : WH_ALL + FACTORY_WAREHOUSE_STAFF, for read-only inventory and batch views
--   FACTORY_INTAKE : FACTORY_WAREHOUSE_STAFF + SUPER_ADMIN, for registering factory batches
-- FACTORY_WAREHOUSE_STAFF is added per feature, together with the workflows that need it.
CREATE OR REPLACE FUNCTION public.app_role_group(group_name text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE group_name
    WHEN 'WH_STAFF' THEN ARRAY['WAREHOUSE_STAFF']
    WHEN 'WH_MANAGER' THEN ARRAY['WAREHOUSE_MANAGER', 'SUPER_ADMIN']
    WHEN 'WH_ALL' THEN ARRAY['WAREHOUSE_STAFF', 'WAREHOUSE_MANAGER', 'SUPER_ADMIN']
    WHEN 'WH_READ' THEN ARRAY['WAREHOUSE_STAFF', 'WAREHOUSE_MANAGER', 'SUPER_ADMIN', 'FACTORY_WAREHOUSE_STAFF']
    WHEN 'FACTORY_INTAKE' THEN ARRAY['FACTORY_WAREHOUSE_STAFF', 'SUPER_ADMIN']
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
