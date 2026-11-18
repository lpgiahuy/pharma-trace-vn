\set ON_ERROR_STOP on
BEGIN;
-- Purchase order lifecycle: create, edit while PENDING, approve, cancel. Receiving goods comes later.
-- A warehouse reads and writes only the purchase orders addressed to it; SUPER_ADMIN reaches every warehouse.
DO $$ BEGIN
  IF to_regprocedure('public.app_role_in_group(text)') IS NULL THEN
    RAISE EXCEPTION 'Install app_role_groups.sql first';
  END IF;
END $$;

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS facility_id integer REFERENCES public.facilities(id);
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS supplier_manufacturer_id integer REFERENCES public.manufacturers(id);
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS approved_by_id integer REFERENCES public.employees(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS closed_reason text;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS expected_at date;
CREATE INDEX IF NOT EXISTS idx_po_facility ON public.purchase_orders(facility_id);

-- received_at used to be filled at creation; it now stays empty until goods are actually received (NV-16).
ALTER TABLE public.purchase_orders ALTER COLUMN received_at DROP DEFAULT;
UPDATE public.purchase_orders SET received_at = NULL WHERE status IS DISTINCT FROM 'RECEIVED' AND received_at IS NOT NULL;

-- The supplier is either a manufacturer or a factory of the company.
ALTER TABLE public.purchase_orders ALTER COLUMN supplier_id DROP NOT NULL;
ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_one_supplier_check;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_one_supplier_check
  CHECK (num_nonnulls(supplier_id, supplier_manufacturer_id) = 1);
ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('PENDING', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'));
ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_cancel_reason_check;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_cancel_reason_check
  CHECK (cancel_reason IS NULL OR length(btrim(cancel_reason)) BETWEEN 1 AND 500);

ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS received_quantity integer NOT NULL DEFAULT 0;
ALTER TABLE public.purchase_order_items DROP CONSTRAINT IF EXISTS purchase_order_items_received_quantity_check;
ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_received_quantity_check
  CHECK (received_quantity >= 0 AND received_quantity <= quantity);

-- Append-only history of every status change with who did it and why.
CREATE TABLE IF NOT EXISTS public.purchase_order_events (
  id bigserial PRIMARY KEY,
  po_id integer NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  action varchar(30) NOT NULL,
  from_status varchar(50),
  to_status varchar(50) NOT NULL,
  actor_id integer NOT NULL REFERENCES public.employees(id),
  note text CHECK (length(btrim(note)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_events_po ON public.purchase_order_events(po_id);

-- The receiving facility must be a warehouse; the supplier a manufacturer or a FACTORY facility.
CREATE OR REPLACE FUNCTION public.po_parties_valid(receiving integer, supplier_facility integer, manufacturer integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (SELECT FROM public.facilities f WHERE f.id = receiving AND f.facility_type IN ('CENTRAL_WAREHOUSE', 'BRANCH_WAREHOUSE'))
    AND CASE WHEN supplier_facility IS NOT NULL
      THEN EXISTS (SELECT FROM public.facilities f WHERE f.id = supplier_facility AND f.facility_type = 'FACTORY')
      ELSE EXISTS (SELECT FROM public.manufacturers m WHERE m.id = manufacturer) END
$$;
REVOKE ALL ON FUNCTION public.po_parties_valid(integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.po_parties_valid(integer, integer, integer) TO app_user;

CREATE OR REPLACE FUNCTION public.po_in_scope(unit integer) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT current_setting('app.current_user_role', true) = 'SUPER_ADMIN'
    OR unit = nullif(current_setting('app.current_unit_id', true), '')::integer
$$;
REVOKE ALL ON FUNCTION public.po_in_scope(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.po_in_scope(integer) TO app_user;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_orders', 'purchase_order_items', 'purchase_order_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, app_user', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON public.purchase_orders TO app_user;
GRANT SELECT, INSERT, DELETE ON public.purchase_order_items TO app_user;
GRANT SELECT, INSERT ON public.purchase_order_events TO app_user;
GRANT USAGE ON SEQUENCE public.purchase_orders_id_seq, public.purchase_order_items_id_seq, public.purchase_order_events_id_seq TO app_user;

DROP POLICY IF EXISTS purchase_order_read ON public.purchase_orders;
CREATE POLICY purchase_order_read ON public.purchase_orders FOR SELECT TO app_user
  USING (public.app_role_in_group('WH_ALL') AND public.po_in_scope(facility_id));
DROP POLICY IF EXISTS purchase_order_insert ON public.purchase_orders;
CREATE POLICY purchase_order_insert ON public.purchase_orders FOR INSERT TO app_user
  WITH CHECK (public.app_role_in_group('WH_MANAGER') AND public.po_in_scope(facility_id)
    AND created_by_employee_id = nullif(current_setting('app.current_user_id', true), '')::integer
    AND public.po_parties_valid(facility_id, supplier_id, supplier_manufacturer_id));
DROP POLICY IF EXISTS purchase_order_update ON public.purchase_orders;
CREATE POLICY purchase_order_update ON public.purchase_orders FOR UPDATE TO app_user
  USING (public.app_role_in_group('WH_MANAGER') AND public.po_in_scope(facility_id))
  WITH CHECK (public.app_role_in_group('WH_MANAGER') AND public.po_in_scope(facility_id)
    AND public.po_parties_valid(facility_id, supplier_id, supplier_manufacturer_id));

-- The subqueries below run under the caller's own purchase_orders policies.
DROP POLICY IF EXISTS purchase_order_item_read ON public.purchase_order_items;
CREATE POLICY purchase_order_item_read ON public.purchase_order_items FOR SELECT TO app_user
  USING (EXISTS (SELECT FROM public.purchase_orders p WHERE p.id = po_id));
DROP POLICY IF EXISTS purchase_order_item_insert ON public.purchase_order_items;
CREATE POLICY purchase_order_item_insert ON public.purchase_order_items FOR INSERT TO app_user
  WITH CHECK (public.app_role_in_group('WH_MANAGER')
    AND EXISTS (SELECT FROM public.purchase_orders p WHERE p.id = po_id AND p.status = 'PENDING'));
DROP POLICY IF EXISTS purchase_order_item_delete ON public.purchase_order_items;
CREATE POLICY purchase_order_item_delete ON public.purchase_order_items FOR DELETE TO app_user
  USING (public.app_role_in_group('WH_MANAGER')
    AND EXISTS (SELECT FROM public.purchase_orders p WHERE p.id = po_id AND p.status = 'PENDING'));

DROP POLICY IF EXISTS purchase_order_event_read ON public.purchase_order_events;
CREATE POLICY purchase_order_event_read ON public.purchase_order_events FOR SELECT TO app_user
  USING (EXISTS (SELECT FROM public.purchase_orders p WHERE p.id = po_id));
DROP POLICY IF EXISTS purchase_order_event_insert ON public.purchase_order_events;
CREATE POLICY purchase_order_event_insert ON public.purchase_order_events FOR INSERT TO app_user
  WITH CHECK (public.app_role_in_group('WH_MANAGER')
    AND actor_id = nullif(current_setting('app.current_user_id', true), '')::integer
    AND EXISTS (SELECT FROM public.purchase_orders p WHERE p.id = po_id));
COMMIT;
