\set ON_ERROR_STOP on
BEGIN;
-- Stock and expiry alerts for the admin dashboard (STOCK_READ). STORE_MANAGER is always limited to its own facility.
-- Available stock = stock_quantity - reserved_quantity. The low-stock threshold is the inventory's own
-- min_stock_quantity, or the system default when it is NULL.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install stock alerts as a trusted superuser';
  END IF;
  IF to_regprocedure('public.app_role_in_group(text)') IS NULL OR to_regprocedure('public.box_sellable(uuid, date)') IS NULL THEN
    RAISE EXCEPTION 'Install app_role_groups.sql and batch_sellability.sql first';
  END IF;
END $$;

ALTER TABLE public.inventories ADD COLUMN IF NOT EXISTS min_stock_quantity integer CHECK (min_stock_quantity >= 0);
ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS default_min_stock_quantity integer NOT NULL DEFAULT 0
  CHECK (default_min_stock_quantity >= 0);
CREATE INDEX IF NOT EXISTS idx_batches_expiry_date ON public.batches(expiry_date);
CREATE INDEX IF NOT EXISTS idx_medicine_boxes_facility_status ON public.medicine_boxes(current_facility_id, status);

CREATE OR REPLACE FUNCTION public.report_stock_scope(p_facility_id integer) RETURNS integer
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE unit integer := NULLIF(current_setting('app.current_unit_id', true), '')::integer;
BEGIN
  IF NOT public.app_role_in_group('STOCK_READ') OR NULLIF(current_setting('app.current_user_id', true), '') IS NULL THEN
    RAISE EXCEPTION 'Stock alert access denied' USING ERRCODE = '42501';
  END IF;
  IF current_setting('app.current_user_role', true) <> 'STORE_MANAGER' THEN RETURN p_facility_id; END IF;
  IF unit IS NULL THEN RAISE EXCEPTION 'Store manager is not assigned to a facility' USING ERRCODE = '42501'; END IF;
  RETURN unit;
END $$;

CREATE OR REPLACE FUNCTION public.default_min_stock_quantity() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT default_min_stock_quantity FROM public.system_settings
$$;

CREATE OR REPLACE FUNCTION public.report_stock_alerts(p_facility_id integer DEFAULT NULL)
RETURNS TABLE (inventory_id integer, facility_id integer, facility_name varchar, medicine_id integer, medicine_name varchar,
  variant_id integer, unit_name varchar, stock_quantity integer, reserved_quantity integer, available integer,
  min_stock_quantity integer, threshold integer, level text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
#variable_conflict use_column
DECLARE scope integer := public.report_stock_scope(p_facility_id);
BEGIN
  RETURN QUERY
  SELECT i.id, i.facility_id, f.facility_name, m.id, m.medicine_name, i.variant_id, v.unit_name, i.stock_quantity,
    coalesce(i.reserved_quantity, 0), s.available, i.min_stock_quantity, s.threshold,
    CASE WHEN s.available <= 0 THEN 'OUT_OF_STOCK' ELSE 'LOW_STOCK' END
  FROM public.inventories i
  JOIN public.facilities f ON f.id = i.facility_id
  JOIN public.packaging_variants v ON v.id = i.variant_id
  JOIN public.medicines m ON m.id = v.medicine_id
  CROSS JOIN LATERAL (SELECT i.stock_quantity - coalesce(i.reserved_quantity, 0) AS available,
    coalesce(i.min_stock_quantity, public.default_min_stock_quantity()) AS threshold) s
  WHERE (scope IS NULL OR i.facility_id = scope) AND s.available <= s.threshold
  ORDER BY 13 DESC, s.available, m.medicine_name, f.facility_name;
END $$;

-- Boxes physically at a facility (IN_STOCK, MANUFACTURED or RESERVED) grouped by batch. Expired batches are always
-- listed; the others are listed when they expire within p_within_days.
CREATE OR REPLACE FUNCTION public.report_expiry_alerts(p_facility_id integer DEFAULT NULL, p_within_days integer DEFAULT 180)
RETURNS TABLE (batch_id integer, batch_number varchar, medicine_id integer, medicine_name varchar, facility_id integer,
  facility_name varchar, boxes bigint, expiry_date date, days_left integer, level text, below_min_shelf_life boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
#variable_conflict use_column
DECLARE scope integer := public.report_stock_scope(p_facility_id); today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
BEGIN
  IF p_within_days IS NULL OR p_within_days < 1 THEN
    RAISE EXCEPTION 'within_days must be at least 1' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT x.batch_id, x.batch_number, x.medicine_id, x.medicine_name, x.facility_id, x.facility_name, x.boxes, x.expiry_date, x.days_left,
    CASE WHEN x.days_left < 0 THEN 'EXPIRED' WHEN x.days_left <= 30 THEN 'LE_30' WHEN x.days_left <= 90 THEN 'D31_90' ELSE 'D91_180' END,
    x.days_left >= 0 AND x.days_left < x.min_shelf_life
  FROM (
    SELECT b.id AS batch_id, b.batch_number, m.id AS medicine_id, m.medicine_name, f.id AS facility_id, f.facility_name,
      count(*) AS boxes, b.expiry_date, b.expiry_date - today AS days_left,
      coalesce(m.min_remaining_shelf_life_days, public.default_min_shelf_life_days(), 0) AS min_shelf_life
    FROM public.medicine_boxes bx
    JOIN public.batches b ON b.id = bx.batch_id
    JOIN public.medicines m ON m.id = b.medicine_id
    JOIN public.facilities f ON f.id = bx.current_facility_id
    WHERE bx.status IN ('IN_STOCK', 'MANUFACTURED', 'RESERVED')
      AND (scope IS NULL OR f.id = scope) AND b.expiry_date <= today + p_within_days
    GROUP BY b.id, b.batch_number, m.id, m.medicine_name, m.min_remaining_shelf_life_days, f.id, f.facility_name, b.expiry_date
  ) x
  ORDER BY x.days_left, x.medicine_name, x.facility_name;
END $$;

DROP FUNCTION IF EXISTS public.set_default_min_stock_quantity(integer);
-- Only SUPER_ADMIN changes the system default.
CREATE OR REPLACE FUNCTION public.set_default_min_stock_quantity(p_quantity integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
    OR current_setting('app.current_user_role', true) IS DISTINCT FROM 'SUPER_ADMIN'
    OR nullif(current_setting('app.current_user_id', true), '') IS NULL THEN
    RAISE EXCEPTION 'Super administrator approval is required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.system_settings SET default_min_stock_quantity = p_quantity, updated_at = now();
END $$;

-- SUPER_ADMIN may change any inventory, STORE_MANAGER only the inventories of its own facility.
-- A NULL quantity makes the inventory use the system default again.
CREATE OR REPLACE FUNCTION public.set_inventory_min_stock_quantity(p_inventory_id integer, p_quantity integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE role text := current_setting('app.current_user_role', true);
BEGIN
  IF current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
    OR role IS NULL OR role NOT IN ('SUPER_ADMIN', 'STORE_MANAGER')
    OR nullif(current_setting('app.current_user_id', true), '') IS NULL THEN
    RAISE EXCEPTION 'Only super administrators and store managers can change stock thresholds' USING ERRCODE = '42501';
  END IF;
  UPDATE public.inventories SET min_stock_quantity = p_quantity
    WHERE id = p_inventory_id
      AND (role = 'SUPER_ADMIN' OR facility_id = nullif(current_setting('app.current_unit_id', true), '')::integer);
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory not found' USING ERRCODE = 'P0002'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.report_stock_scope(integer), public.default_min_stock_quantity(),
  public.report_stock_alerts(integer), public.report_expiry_alerts(integer, integer),
  public.set_default_min_stock_quantity(integer), public.set_inventory_min_stock_quantity(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.default_min_stock_quantity(), public.report_stock_alerts(integer),
  public.report_expiry_alerts(integer, integer), public.set_default_min_stock_quantity(integer),
  public.set_inventory_min_stock_quantity(integer, integer) TO app_user;
COMMIT;
