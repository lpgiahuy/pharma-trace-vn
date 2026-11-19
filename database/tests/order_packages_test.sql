\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('PK warehouse A', 'CENTRAL_WAREHOUSE') RETURNING id AS a \gset f_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('PK warehouse B', 'CENTRAL_WAREHOUSE') RETURNING id AS b \gset f_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('PK staff A', 'WAREHOUSE_STAFF', :f_a) RETURNING id AS staff_a \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('PK manager A', 'WAREHOUSE_MANAGER', :f_a) RETURNING id AS manager_a \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('PK staff B', 'WAREHOUSE_STAFF', :f_b) RETURNING id AS staff_b \gset e_
INSERT INTO public.medicines(medicine_name) VALUES ('PK medicine') RETURNING id AS id \gset med_
INSERT INTO public.batches(batch_number, medicine_id, expiry_date) VALUES (format('PK-%s', txid_current()), :med_id, current_date + 365) RETURNING id AS id \gset batch_
INSERT INTO public.orders(order_code, export_facility_id, order_status) VALUES (format('PK-1-%s', txid_current()), :f_a, 'PROCESSING') RETURNING id AS one \gset o_
INSERT INTO public.orders(order_code, export_facility_id, order_status) VALUES (format('PK-2-%s', txid_current()), :f_a, 'PROCESSING') RETURNING id AS two \gset o_
INSERT INTO public.order_items(order_id, medicine_id, quantity) VALUES (:o_one, :med_id, 2) RETURNING id AS one \gset i_
INSERT INTO public.order_items(order_id, medicine_id, quantity) VALUES (:o_two, :med_id, 1) RETURNING id AS two \gset i_
INSERT INTO public.medicine_boxes(batch_id, current_facility_id) VALUES (:batch_id, :f_a) RETURNING uid AS one \gset b_
INSERT INTO public.medicine_boxes(batch_id, current_facility_id) VALUES (:batch_id, :f_a) RETURNING uid AS two \gset b_
SELECT set_config('test.a', :'f_a', true), set_config('test.b', :'f_b', true), set_config('test.staff_a', :'e_staff_a', true),
  set_config('test.manager_a', :'e_manager_a', true), set_config('test.staff_b', :'e_staff_b', true),
  set_config('test.order_one', :'o_one', true), set_config('test.order_two', :'o_two', true),
  set_config('test.item_one', :'i_one', true), set_config('test.item_two', :'i_two', true),
  set_config('test.box_one', :'b_one', true), set_config('test.box_two', :'b_two', true);

SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_type', 'employee', true), set_config('app.current_user_role', 'WAREHOUSE_STAFF', true),
  set_config('app.current_user_id', :'e_staff_a', true), set_config('app.current_unit_id', :'f_a', true),
  set_config('app.order_operation', 'pack', true);

DO $$
DECLARE pkg integer; other integer;
BEGIN
  INSERT INTO public.order_packages(package_code, order_id, facility_id, packed_by_id)
    VALUES ('PK-TEST-1', current_setting('test.order_one')::int, current_setting('test.a')::int, current_setting('test.staff_a')::int)
    RETURNING id INTO pkg;
  INSERT INTO public.order_package_items(package_id, order_item_id, box_uid)
    VALUES (pkg, current_setting('test.item_one')::int, current_setting('test.box_one')::uuid);

  INSERT INTO public.order_packages(package_code, order_id, facility_id, packed_by_id)
    VALUES ('PK-TEST-2', current_setting('test.order_two')::int, current_setting('test.a')::int, current_setting('test.staff_a')::int)
    RETURNING id INTO other;
  BEGIN
    INSERT INTO public.order_package_items(package_id, order_item_id, box_uid)
      VALUES (other, current_setting('test.item_two')::int, current_setting('test.box_one')::uuid);
    RAISE EXCEPTION 'A box was placed in two active packages';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.order_package_items(package_id, order_item_id, box_uid)
      VALUES (other, current_setting('test.item_one')::int, current_setting('test.box_two')::uuid);
    RAISE EXCEPTION 'A package took an item of another order';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.order_packages(package_code, order_id, facility_id, packed_by_id)
      VALUES ('PK-TEST-3', current_setting('test.order_one')::int, current_setting('test.b')::int, current_setting('test.staff_a')::int);
    RAISE EXCEPTION 'A package was recorded at another warehouse';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.order_packages SET status = 'VOID', void_reason = 'Wrong box', voided_by_id = current_setting('test.staff_a')::int, voided_at = now()
      WHERE id = pkg;
    RAISE EXCEPTION 'Warehouse staff voided a package';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('app.current_user_role', 'WAREHOUSE_MANAGER', true), set_config('app.current_user_id', current_setting('test.manager_a'), true);
DO $$
DECLARE pkg integer := (SELECT id FROM public.order_packages WHERE package_code = 'PK-TEST-2');
BEGIN
  UPDATE public.order_packages SET status = 'VOID', void_reason = 'Wrong box', voided_by_id = current_setting('test.manager_a')::int, voided_at = now()
    WHERE id = pkg;
  IF (SELECT status FROM public.order_packages WHERE id = pkg) <> 'VOID' THEN
    RAISE EXCEPTION 'The manager could not void a package';
  END IF;
END $$;

SELECT set_config('app.current_user_role', 'WAREHOUSE_STAFF', true), set_config('app.current_user_id', current_setting('test.staff_b'), true),
  set_config('app.current_unit_id', current_setting('test.b'), true);
DO $$ BEGIN
  IF EXISTS (SELECT FROM public.order_packages) OR EXISTS (SELECT FROM public.order_package_items) THEN
    RAISE EXCEPTION 'Packages of another warehouse are visible';
  END IF;
END $$;

RESET ROLE;
UPDATE public.orders SET order_status = 'CANCELLED' WHERE id = current_setting('test.order_one')::int;
DO $$ BEGIN
  IF (SELECT status FROM public.order_packages WHERE package_code = 'PK-TEST-1') <> 'VOID'
     OR EXISTS (SELECT FROM public.order_package_items WHERE box_uid = current_setting('test.box_one')::uuid AND voided_at IS NULL) THEN
    RAISE EXCEPTION 'Cancelling the order did not free its packed boxes';
  END IF;
END $$;
ROLLBACK;
