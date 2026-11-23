\set ON_ERROR_STOP on
-- What a facility can ask another facility for: the products the source holds that are free to move. A requester
-- cannot read another facility's inventory, so this narrow function returns only product, packaging and a free
-- quantity (stock minus reserved minus boxes of batches on hold). Callable by managers who may create requests.
-- Apply as a trusted superuser after stock_transfers.sql.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install transfer source stock as a trusted superuser';
  END IF;
  IF to_regprocedure('public.stock_transfer_manager(integer)') IS NULL THEN
    RAISE EXCEPTION 'Install stock_transfers.sql first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.transfer_source_stock(source integer)
RETURNS TABLE(variant_id integer, medicine_name text, unit_name text, available integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE unit integer := nullif(current_setting('app.current_unit_id', true), '')::integer;
BEGIN
  IF unit IS NULL OR public.stock_transfer_manager(unit) IS NOT TRUE THEN
    RAISE EXCEPTION 'ST_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF source IS NULL OR source = unit OR NOT EXISTS (SELECT FROM public.facilities WHERE id = source) THEN
    RAISE EXCEPTION 'ST_SOURCE_INVALID' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT v.id, m.medicine_name::text, v.unit_name::text,
      (i.stock_quantity - coalesce(i.reserved_quantity, 0) - coalesce(h.held, 0))::integer
    FROM public.inventories i
    JOIN public.packaging_variants v ON v.id = i.variant_id
    JOIN public.medicines m ON m.id = v.medicine_id
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS held
      FROM public.medicine_boxes b JOIN public.batches lot ON lot.id = b.batch_id
      JOIN LATERAL (SELECT l.variant_id FROM public.inventory_logs l WHERE l.batch_id = lot.id
        AND l.transaction_type IN ('PRODUCTION_IN', 'PURCHASE_IN') ORDER BY l.id LIMIT 1) origin ON origin.variant_id = i.variant_id
      WHERE lot.status = 'ON_HOLD' AND b.current_facility_id = source AND b.status IN ('IN_STOCK', 'MANUFACTURED')
    ) h ON true
    WHERE i.facility_id = source AND i.stock_quantity - coalesce(i.reserved_quantity, 0) - coalesce(h.held, 0) > 0
    ORDER BY m.medicine_name, v.unit_name;
END $$;
REVOKE ALL ON FUNCTION public.transfer_source_stock(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_source_stock(integer) TO app_user;
COMMIT;
