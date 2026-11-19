\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('HV warehouse A', 'CENTRAL_WAREHOUSE') RETURNING id AS a \gset f_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('HV warehouse B', 'CENTRAL_WAREHOUSE') RETURNING id AS b \gset f_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('HV staff A', 'WAREHOUSE_STAFF', :f_a) RETURNING id AS staff_a \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('HV staff B', 'WAREHOUSE_STAFF', :f_b) RETURNING id AS staff_b \gset e_
INSERT INTO public.medicines(medicine_name) VALUES ('HV medicine') RETURNING id AS id \gset med_
INSERT INTO public.batches(batch_number, medicine_id, production_date, expiry_date) VALUES (format('HV-%s', txid_current()), :med_id, current_date - 1, current_date + 365) RETURNING id AS id \gset batch_
INSERT INTO public.orders(order_code, export_facility_id, order_status) VALUES (format('HV-1-%s', txid_current()), :f_a, 'PENDING_PICKUP') RETURNING id AS one \gset o_
INSERT INTO public.orders(order_code, export_facility_id, order_status) VALUES (format('HV-2-%s', txid_current()), :f_a, 'PENDING_PICKUP') RETURNING id AS two \gset o_
INSERT INTO public.order_items(order_id, medicine_id, quantity) VALUES (:o_one, :med_id, 2) RETURNING id AS one \gset i_
INSERT INTO public.order_items(order_id, medicine_id, quantity) VALUES (:o_two, :med_id, 1) RETURNING id AS two \gset i_
INSERT INTO public.medicine_boxes(batch_id, current_facility_id, status) VALUES (:batch_id, NULL, 'PACKAGED') RETURNING uid AS one \gset b_
INSERT INTO public.medicine_boxes(batch_id, current_facility_id, status) VALUES (:batch_id, NULL, 'PACKAGED') RETURNING uid AS two \gset b_
INSERT INTO public.medicine_boxes(batch_id, current_facility_id, status) VALUES (:batch_id, NULL, 'PACKAGED') RETURNING uid AS three \gset b_
INSERT INTO public.shipments(order_id, tracking_number, courier_name, carrier_confirmed_at) VALUES (:o_one, format('HV-T1-%s', txid_current()), 'GHN', now());
INSERT INTO public.shipments(order_id, tracking_number, courier_name, carrier_confirmed_at) VALUES (:o_two, format('HV-T2-%s', txid_current()), 'VNPOST', now());
INSERT INTO public.order_packages(package_code, order_id, facility_id, packed_by_id) VALUES ('HV-PKG-1A', :o_one, :f_a, :e_staff_a);
INSERT INTO public.order_packages(package_code, order_id, facility_id, packed_by_id) VALUES ('HV-PKG-1B', :o_one, :f_a, :e_staff_a);
INSERT INTO public.order_packages(package_code, order_id, facility_id, packed_by_id) VALUES ('HV-PKG-2A', :o_two, :f_a, :e_staff_a);
INSERT INTO public.order_package_items(package_id, order_item_id, box_uid) SELECT id, :i_one, :'b_one' FROM public.order_packages WHERE package_code = 'HV-PKG-1A';
INSERT INTO public.order_package_items(package_id, order_item_id, box_uid) SELECT id, :i_one, :'b_two' FROM public.order_packages WHERE package_code = 'HV-PKG-1B';
INSERT INTO public.order_package_items(package_id, order_item_id, box_uid) SELECT id, :i_two, :'b_three' FROM public.order_packages WHERE package_code = 'HV-PKG-2A';
SELECT set_config('test.a', :'f_a', true), set_config('test.order_one', :'o_one', true), set_config('test.box_one', :'b_one', true),
  set_config('test.box_two', :'b_two', true), set_config('test.staff_b', :'e_staff_b', true), set_config('test.b', :'f_b', true);

SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_type', 'employee', true), set_config('app.current_user_role', 'WAREHOUSE_STAFF', true),
  set_config('app.current_user_id', :'e_staff_a', true), set_config('app.current_unit_id', :'f_a', true),
  set_config('app.order_operation', 'pack', true);

CREATE OR REPLACE FUNCTION pg_temp.hv_expect(expected text, ref text, courier text, codes text[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.record_carrier_handover(ref, current_setting('test.a')::int, courier, 'Driver', '0900000000', '51A-00000', NULL, codes);
  RAISE EXCEPTION 'Expected % but the handover was accepted', expected;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> expected THEN RAISE; END IF;
END $$;

SELECT pg_temp.hv_expect('HV_CARRIER_MISMATCH', 'HV-TEST-BAD1', 'GHN', ARRAY['HV-PKG-2A']);
SELECT pg_temp.hv_expect('HV_PACKAGE_NOT_FOUND', 'HV-TEST-BAD2', 'GHN', ARRAY['HV-PKG-1A', 'HV-PKG-MISSING']);

DO $$
DECLARE handover integer;
BEGIN
  handover := public.record_carrier_handover('HV-TEST-1', current_setting('test.a')::int, 'ghn', 'Driver', '0900000000', '51A-00000', NULL, ARRAY['HV-PKG-1A']);
  IF handover <> public.record_carrier_handover('HV-TEST-1', current_setting('test.a')::int, 'GHN', NULL, NULL, NULL, NULL, ARRAY['HV-PKG-1A']) THEN
    RAISE EXCEPTION 'Resending a handover code created a second handover';
  END IF;
  IF (SELECT shipping_status FROM public.shipments WHERE order_id = current_setting('test.order_one')::int) <> 'PENDING_PICKUP' THEN
    RAISE EXCEPTION 'A partly handed over order left PENDING_PICKUP';
  END IF;
  IF (SELECT status FROM public.medicine_boxes WHERE uid = current_setting('test.box_one')::uuid) <> 'PACKAGED' THEN
    RAISE EXCEPTION 'A box of an unfinished handover left PACKAGED';
  END IF;
END $$;
SELECT pg_temp.hv_expect('HV_PACKAGE_NOT_PACKED', 'HV-TEST-BAD3', 'GHN', ARRAY['HV-PKG-1A']);

DO $$ BEGIN
  PERFORM public.record_carrier_handover('HV-TEST-2', current_setting('test.a')::int, 'GHN', NULL, NULL, NULL, NULL, ARRAY['HV-PKG-1B']);
  IF (SELECT shipping_status FROM public.shipments WHERE order_id = current_setting('test.order_one')::int) <> 'PICKED_UP'
     OR (SELECT order_status FROM public.orders WHERE id = current_setting('test.order_one')::int) <> 'PICKED_UP'
     OR (SELECT picked_up_at FROM public.shipments WHERE order_id = current_setting('test.order_one')::int) IS NULL THEN
    RAISE EXCEPTION 'The last package did not mark the order as picked up';
  END IF;
  IF (SELECT count(*) FROM public.medicine_boxes WHERE uid IN (current_setting('test.box_one')::uuid, current_setting('test.box_two')::uuid) AND status = 'IN_TRANSIT') <> 2 THEN
    RAISE EXCEPTION 'The boxes of the order are not in transit';
  END IF;
END $$;

SELECT set_config('app.current_user_id', current_setting('test.staff_b'), true), set_config('app.current_unit_id', current_setting('test.b'), true);
DO $$ BEGIN
  IF EXISTS (SELECT FROM public.carrier_handovers) OR EXISTS (SELECT FROM public.carrier_handover_packages) THEN
    RAISE EXCEPTION 'Handovers of another warehouse are visible';
  END IF;
  BEGIN
    PERFORM public.record_carrier_handover('HV-TEST-3', current_setting('test.a')::int, 'VNPOST', NULL, NULL, NULL, NULL, ARRAY['HV-PKG-2A']);
    RAISE EXCEPTION 'Staff of another warehouse handed over a package';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.carrier_handovers(handover_code, facility_id, courier_name, handed_over_by_id)
      VALUES ('HV-TEST-DIRECT', current_setting('test.b')::int, 'GHN', current_setting('test.staff_b')::int);
    RAISE EXCEPTION 'A handover was written without the function';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

RESET ROLE;
UPDATE public.orders SET order_status = 'CANCELLED' WHERE id = (SELECT order_id FROM public.order_packages WHERE package_code = 'HV-PKG-2A');
SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_id', :'e_staff_a', true), set_config('app.current_unit_id', :'f_a', true);
SELECT pg_temp.hv_expect('HV_PACKAGE_NOT_PACKED', 'HV-TEST-BAD4', 'VNPOST', ARRAY['HV-PKG-2A']);
ROLLBACK;
