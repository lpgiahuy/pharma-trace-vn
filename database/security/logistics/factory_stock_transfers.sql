\set ON_ERROR_STOP on
-- Existing databases only: lets FACTORY_WAREHOUSE_STAFF act as the sending side of a stock transfer.
-- A fresh database gets the same rules from app_role_groups.sql, order_rls.sql, stock_transfers.sql and the
-- logistics scripts. order_rls.sql cannot be re-applied to a live database (it would roll back older function
-- bodies), so this script carries only the two objects that were not safe to re-run:
--   * public.order_operation_allowed(): the 'dispatch' operation accepts the WH_TRANSFER group
--   * policy transfer_read on internal_transfers: factory staff may read transfers of their own facility
-- Apply as a trusted superuser, after app_role_groups.sql (which defines WH_TRANSFER). Also re-apply, in this
-- order: security/logistics/logistics_rls.sql, transfer_manifest.sql, source_manifest_assignment.sql, stock_transfers.sql.
BEGIN;
CREATE OR REPLACE FUNCTION public.order_operation_allowed() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
    SELECT CASE
      WHEN public.order_job() THEN true
      WHEN current_setting('app.order_operation', true) IN ('checkout', 'cancel') THEN
        public.order_customer(NULLIF(current_setting('app.current_user_id', true), '')::integer)
      WHEN current_setting('app.current_user_type', true) = 'employee' THEN
        CASE current_setting('app.order_operation', true)
          WHEN 'status' THEN current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST')
          WHEN 'pack' THEN (current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST') OR public.app_role_in_group('WH_ALL'))
          WHEN 'dispatch' THEN (current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER') OR public.app_role_in_group('WH_TRANSFER'))
          WHEN 'receive' THEN (current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER') OR public.app_role_in_group('WH_ALL'))
          WHEN 'replace' THEN (current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER') OR public.app_role_in_group('WH_ALL'))
          WHEN 'prescription' THEN current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'PHARMACIST')
          ELSE false END
      ELSE false END
$$;

ALTER POLICY transfer_read ON public.internal_transfers USING (
    ((public.order_staff(from_facility_id) OR public.order_staff(to_facility_id))
      AND (current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST') OR public.app_role_in_group('WH_TRANSFER')))
    OR EXISTS (SELECT FROM public.orders o WHERE o.id = order_id AND (public.order_customer(o.customer_id) OR public.order_staff(o.export_facility_id))));
COMMIT;
