\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install carrier handovers as a trusted superuser';
  END IF;
  IF to_regclass('public.order_packages') IS NULL THEN
    RAISE EXCEPTION 'Install order_packages.sql first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.carrier_handovers (
  id serial PRIMARY KEY,
  handover_code varchar(50) NOT NULL UNIQUE,
  facility_id integer NOT NULL REFERENCES public.facilities(id),
  courier_name varchar(100) NOT NULL,
  driver_name varchar(100),
  driver_phone varchar(30),
  vehicle_plate varchar(20),
  note text CHECK (length(note) <= 1000),
  handed_over_by_id integer NOT NULL REFERENCES public.employees(id),
  handed_over_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_carrier_handovers_facility ON public.carrier_handovers(facility_id, handed_over_at DESC);

CREATE TABLE IF NOT EXISTS public.carrier_handover_packages (
  handover_id integer NOT NULL REFERENCES public.carrier_handovers(id),
  package_id integer NOT NULL UNIQUE REFERENCES public.order_packages(id),
  PRIMARY KEY (handover_id, package_id)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['carrier_handovers', 'carrier_handover_packages'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, app_user', t);
    EXECUTE format('GRANT SELECT ON public.%I TO app_user', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS carrier_handover_read ON public.carrier_handovers;
CREATE POLICY carrier_handover_read ON public.carrier_handovers FOR SELECT TO app_user
  USING (public.order_staff(facility_id));
DROP POLICY IF EXISTS carrier_handover_package_read ON public.carrier_handover_packages;
CREATE POLICY carrier_handover_package_read ON public.carrier_handover_packages FOR SELECT TO app_user
  USING (EXISTS (SELECT FROM public.carrier_handovers h WHERE h.id = handover_id));

-- Records a handover in one transaction. An order moves to PICKED_UP once all its active packages are handed over.
CREATE OR REPLACE FUNCTION public.record_carrier_handover(handover_ref text, target_facility integer, courier text,
  driver text, phone text, plate text, handover_note text, package_codes text[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor integer := nullif(current_setting('app.current_user_id', true), '')::integer;
  courier_code text := upper(btrim(courier));
  previous public.carrier_handovers%ROWTYPE;
  pkg public.order_packages%ROWTYPE;
  ship public.shipments%ROWTYPE;
  handover integer; order_ref integer; order_status_now text; seen integer;
BEGIN
  IF actor IS NULL OR current_setting('app.order_operation', true) IS DISTINCT FROM 'pack'
     OR NOT public.app_role_in_group('WH_ALL') OR public.order_staff(target_facility) IS NOT TRUE THEN
    RAISE EXCEPTION 'HV_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF handover_ref IS NULL OR handover_ref !~ '^[A-Za-z0-9][A-Za-z0-9_-]{5,49}$' THEN
    RAISE EXCEPTION 'HV_CODE_INVALID' USING ERRCODE = '22023';
  END IF;
  IF courier_code IS NULL OR courier_code = '' OR length(courier_code) > 100
     OR coalesce(array_length(package_codes, 1), 0) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'HV_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO previous FROM public.carrier_handovers WHERE handover_code = handover_ref;
  IF FOUND THEN
    IF previous.facility_id <> target_facility THEN RAISE EXCEPTION 'HV_CODE_TAKEN' USING ERRCODE = '22023'; END IF;
    RETURN previous.id;
  END IF;

  FOR order_ref IN SELECT DISTINCT order_id FROM public.order_packages
    WHERE package_code = ANY(package_codes) AND facility_id = target_facility ORDER BY order_id LOOP
    PERFORM 1 FROM public.orders WHERE id = order_ref FOR UPDATE;
    PERFORM 1 FROM public.shipments WHERE order_id = order_ref FOR UPDATE;
  END LOOP;

  INSERT INTO public.carrier_handovers(handover_code, facility_id, courier_name, driver_name, driver_phone,
      vehicle_plate, note, handed_over_by_id)
    VALUES (handover_ref, target_facility, courier_code, nullif(btrim(driver), ''), nullif(btrim(phone), ''),
      nullif(btrim(plate), ''), nullif(btrim(handover_note), ''), actor)
    RETURNING id INTO handover;

  seen := 0;
  FOR pkg IN SELECT * FROM public.order_packages WHERE package_code = ANY(package_codes) AND facility_id = target_facility ORDER BY id LOOP
    seen := seen + 1;
    IF pkg.status <> 'PACKED' THEN RAISE EXCEPTION 'HV_PACKAGE_NOT_PACKED' USING ERRCODE = '22023'; END IF;
    SELECT * INTO ship FROM public.shipments WHERE order_id = pkg.order_id;
    SELECT o.order_status INTO order_status_now FROM public.orders o WHERE o.id = pkg.order_id;
    IF NOT FOUND OR order_status_now <> 'PENDING_PICKUP' OR ship.shipping_status IS DISTINCT FROM 'PENDING_PICKUP' THEN
      RAISE EXCEPTION 'HV_SHIPMENT_NOT_READY' USING ERRCODE = '22023';
    END IF;
    IF ship.carrier_confirmed_at IS NULL THEN RAISE EXCEPTION 'HV_CARRIER_NOT_CONFIRMED' USING ERRCODE = '22023'; END IF;
    IF ship.courier_name <> courier_code THEN RAISE EXCEPTION 'HV_CARRIER_MISMATCH' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.carrier_handover_packages(handover_id, package_id) VALUES (handover, pkg.id);
    UPDATE public.order_packages SET status = 'HANDED_OVER' WHERE id = pkg.id;
  END LOOP;
  IF seen <> (SELECT count(DISTINCT c) FROM unnest(package_codes) c) THEN
    RAISE EXCEPTION 'HV_PACKAGE_NOT_FOUND' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.logistics_reason', 'Carrier handover ' || handover_ref, true);
  FOR order_ref IN SELECT DISTINCT p.order_id FROM public.carrier_handover_packages hp
    JOIN public.order_packages p ON p.id = hp.package_id WHERE hp.handover_id = handover ORDER BY 1 LOOP
    CONTINUE WHEN EXISTS (SELECT FROM public.order_packages WHERE order_id = order_ref AND status = 'PACKED');
    UPDATE public.shipments SET shipping_status = 'PICKED_UP', picked_up_at = now(), updated_at = now() WHERE order_id = order_ref;
    UPDATE public.orders SET order_status = 'PICKED_UP' WHERE id = order_ref;
    UPDATE public.medicine_boxes SET status = 'IN_TRANSIT' WHERE uid IN (
      SELECT i.box_uid FROM public.order_package_items i JOIN public.order_packages p ON p.id = i.package_id
      WHERE p.order_id = order_ref AND p.status = 'HANDED_OVER' AND i.voided_at IS NULL);
  END LOOP;
  RETURN handover;
END $$;
REVOKE ALL ON FUNCTION public.record_carrier_handover(text, integer, text, text, text, text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_carrier_handover(text, integer, text, text, text, text, text, text[]) TO app_user;
COMMIT;
