\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install order packages as a trusted superuser';
  END IF;
  IF to_regprocedure('public.order_staff(integer)') IS NULL OR public.app_role_group('WH_MANAGER') IS NULL THEN
    RAISE EXCEPTION 'Install order_rls.sql and app_role_groups.sql first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.order_packages (
  id serial PRIMARY KEY,
  package_code varchar(50) NOT NULL UNIQUE,
  order_id integer NOT NULL REFERENCES public.orders(id),
  facility_id integer NOT NULL REFERENCES public.facilities(id),
  status varchar(20) NOT NULL DEFAULT 'PACKED' CHECK (status IN ('PACKED', 'HANDED_OVER', 'VOID')),
  weight_g integer CHECK (weight_g > 0),
  dimensions varchar(50),
  packed_by_id integer NOT NULL REFERENCES public.employees(id),
  packed_at timestamptz NOT NULL DEFAULT now(),
  void_reason text CHECK (length(btrim(void_reason)) BETWEEN 1 AND 500),
  voided_by_id integer REFERENCES public.employees(id),
  voided_at timestamptz,
  CHECK ((status = 'VOID') = (voided_at IS NOT NULL AND void_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_order_packages_order ON public.order_packages(order_id);

CREATE TABLE IF NOT EXISTS public.order_package_items (
  id serial PRIMARY KEY,
  package_id integer NOT NULL REFERENCES public.order_packages(id),
  order_item_id integer NOT NULL REFERENCES public.order_items(id),
  box_uid uuid NOT NULL REFERENCES public.medicine_boxes(uid),
  voided_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_order_package_items_package ON public.order_package_items(package_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_package_items_active_box ON public.order_package_items(box_uid) WHERE voided_at IS NULL;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['order_packages', 'order_package_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, app_user', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT ON public.order_packages, public.order_package_items TO app_user;
GRANT UPDATE (status, void_reason, voided_by_id, voided_at) ON public.order_packages TO app_user;
GRANT UPDATE (voided_at) ON public.order_package_items TO app_user;
GRANT USAGE ON SEQUENCE public.order_packages_id_seq, public.order_package_items_id_seq TO app_user;

DROP POLICY IF EXISTS order_package_read ON public.order_packages;
CREATE POLICY order_package_read ON public.order_packages FOR SELECT TO app_user
  USING (public.order_staff(facility_id));
DROP POLICY IF EXISTS order_package_insert ON public.order_packages;
CREATE POLICY order_package_insert ON public.order_packages FOR INSERT TO app_user
  WITH CHECK (current_setting('app.order_operation', true) = 'pack' AND public.order_staff(facility_id) AND status = 'PACKED'
    AND packed_by_id = nullif(current_setting('app.current_user_id', true), '')::integer
    AND EXISTS (SELECT FROM public.orders o WHERE o.id = order_id AND o.export_facility_id = facility_id));
DROP POLICY IF EXISTS order_package_void ON public.order_packages;
CREATE POLICY order_package_void ON public.order_packages FOR UPDATE TO app_user
  USING (current_setting('app.order_operation', true) = 'pack' AND public.order_staff(facility_id) AND status = 'PACKED')
  WITH CHECK (status = 'VOID' AND public.app_role_in_group('WH_MANAGER')
    AND voided_by_id = nullif(current_setting('app.current_user_id', true), '')::integer);

DROP POLICY IF EXISTS order_package_item_read ON public.order_package_items;
CREATE POLICY order_package_item_read ON public.order_package_items FOR SELECT TO app_user
  USING (EXISTS (SELECT FROM public.order_packages p WHERE p.id = package_id));
DROP POLICY IF EXISTS order_package_item_insert ON public.order_package_items;
CREATE POLICY order_package_item_insert ON public.order_package_items FOR INSERT TO app_user
  WITH CHECK (current_setting('app.order_operation', true) = 'pack' AND voided_at IS NULL
    AND EXISTS (SELECT FROM public.order_packages p JOIN public.order_items i ON i.order_id = p.order_id
      WHERE p.id = package_id AND i.id = order_item_id AND p.status = 'PACKED' AND public.order_staff(p.facility_id)));
DROP POLICY IF EXISTS order_package_item_void ON public.order_package_items;
CREATE POLICY order_package_item_void ON public.order_package_items FOR UPDATE TO app_user
  USING (current_setting('app.order_operation', true) = 'pack' AND voided_at IS NULL
    AND EXISTS (SELECT FROM public.order_packages p WHERE p.id = package_id AND public.order_staff(p.facility_id)))
  WITH CHECK (voided_at IS NOT NULL AND public.app_role_in_group('WH_MANAGER'));

-- Frees the boxes of a cancelled order whichever path cancelled it (customer, staff or cron).
CREATE OR REPLACE FUNCTION public.void_cancelled_order_packages() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  UPDATE public.order_package_items i SET voided_at = now()
    FROM public.order_packages p
    WHERE p.id = i.package_id AND p.order_id = NEW.id AND p.status = 'PACKED' AND i.voided_at IS NULL;
  UPDATE public.order_packages SET status = 'VOID', voided_at = now(), void_reason = 'Order cancelled'
    WHERE order_id = NEW.id AND status = 'PACKED';
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.void_cancelled_order_packages() FROM PUBLIC;
DROP TRIGGER IF EXISTS void_cancelled_order_packages ON public.orders;
CREATE TRIGGER void_cancelled_order_packages AFTER UPDATE OF order_status ON public.orders
FOR EACH ROW WHEN (NEW.order_status IN ('CANCELLED', 'CANCELED') AND OLD.order_status IS DISTINCT FROM NEW.order_status)
EXECUTE FUNCTION public.void_cancelled_order_packages();
COMMIT;
