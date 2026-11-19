\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('FB factory A','FACTORY') RETURNING id AS a \gset f_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('FB factory B','FACTORY') RETURNING id AS b \gset f_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('FB warehouse','CENTRAL_WAREHOUSE') RETURNING id AS w \gset f_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('FB staff A','fb-a@example.test','FACTORY_WAREHOUSE_STAFF','ACTIVE',:f_a) RETURNING id AS staff_a \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('FB staff B','fb-b@example.test','FACTORY_WAREHOUSE_STAFF','ACTIVE',:f_b) RETURNING id AS staff_b \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('FB warehouse staff','fb-w@example.test','WAREHOUSE_STAFF','ACTIVE',:f_w) RETURNING id AS staff_w \gset e_
INSERT INTO public.medicines(medicine_name) VALUES ('FB medicine') RETURNING id AS id \gset med_
INSERT INTO public.packaging_variants(medicine_id,unit_name) VALUES (:med_id,'box') RETURNING id AS id \gset v_
SELECT set_config('test.a',:'f_a',true), set_config('test.b',:'f_b',true), set_config('test.w',:'f_w',true),
  set_config('test.variant',:'v_id',true), set_config('test.staff_w',:'e_staff_w',true);

SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_type','employee',true), set_config('app.current_user_role','FACTORY_WAREHOUSE_STAFF',true),
  set_config('app.current_user_id',:'e_staff_a',true), set_config('app.current_unit_id',:'f_a',true);

DO $$
DECLARE
  factory int := current_setting('test.a')::int; variant int := current_setting('test.variant')::int;
  lot int; cartons jsonb;
BEGIN
  cartons := jsonb_build_array(
    jsonb_build_object('sscc', 'FB-SSCC-1', 'boxes', (SELECT jsonb_agg(jsonb_build_object('uid', gen_random_uuid(), 'signature', 'sig')) FROM generate_series(1, 10))),
    jsonb_build_object('sscc', 'FB-SSCC-2', 'boxes', (SELECT jsonb_agg(jsonb_build_object('uid', gen_random_uuid(), 'signature', 'sig')) FROM generate_series(1, 10))),
    jsonb_build_object('sscc', 'FB-SSCC-3', 'boxes', (SELECT jsonb_agg(jsonb_build_object('uid', gen_random_uuid(), 'signature', 'sig')) FROM generate_series(1, 5))));
  lot := public.record_factory_batch(factory, variant, 'FB-LOT-1', '2026-01-01', '2028-01-01', 'CO-1', cartons);

  IF (SELECT initial_quantity FROM public.batches WHERE id = lot) <> 25
     OR (SELECT remaining_quantity FROM public.batches WHERE id = lot) <> 25
     OR (SELECT manufacturer_source_facility_id FROM public.batches WHERE id = lot) <> factory THEN
    RAISE EXCEPTION 'The batch does not carry the produced quantity';
  END IF;
  IF (SELECT count(*) FROM public.sscc_cartons WHERE batch_id = lot AND current_facility_id = factory) <> 3
     OR (SELECT array_agg(box_count ORDER BY id) FROM public.sscc_cartons WHERE batch_id = lot) IS DISTINCT FROM ARRAY[10, 10, 5] THEN
    RAISE EXCEPTION 'Cartons were not created with their box counts';
  END IF;
  IF (SELECT count(*) FROM public.medicine_boxes WHERE batch_id = lot AND current_facility_id = factory AND status = 'IN_STOCK'
        AND signature = 'sig' AND carton_id IS NOT NULL) <> 25 THEN
    RAISE EXCEPTION 'Boxes were not created in stock at the factory';
  END IF;
  IF (SELECT stock_quantity FROM public.inventories WHERE facility_id = factory AND variant_id = variant) <> 25 THEN
    RAISE EXCEPTION 'Factory stock was not increased';
  END IF;
  PERFORM set_config('app.inventory_operation', 'warehouse_read', true);
  IF (SELECT count(*) FROM public.inventory_logs WHERE facility_id = factory AND batch_id = lot
        AND transaction_type = 'PRODUCTION_IN' AND quantity_changed = 25 AND previous_quantity = 0 AND new_quantity = 25) <> 1 THEN
    RAISE EXCEPTION 'The production was not logged';
  END IF;
  PERFORM set_config('app.inventory_operation', '', true);

  BEGIN
    PERFORM public.record_factory_batch(factory, variant, 'FB-LOT-1', '2026-01-01', '2028-01-01', NULL, cartons);
    RAISE EXCEPTION 'A repeated batch number was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'FB_BATCH_EXISTS' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.record_factory_batch(factory, variant, 'FB-LOT-2', '2028-01-01', '2026-01-01', NULL, cartons);
    RAISE EXCEPTION 'A batch expiring before its production was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'FB_BATCH_INVALID' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.record_factory_batch(current_setting('test.b')::int, variant, 'FB-LOT-3', '2026-01-01', '2028-01-01', NULL, cartons);
    RAISE EXCEPTION 'Factory A staff registered a batch at factory B';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'FB_FACTORY_REQUIRED' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.record_factory_batch(factory, variant, 'FB-LOT-4', '2026-01-01', '2028-01-01', NULL, '[]');
    RAISE EXCEPTION 'A batch without boxes was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'FB_BOXES_REQUIRED' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT FROM public.batches WHERE batch_number IN ('FB-LOT-2', 'FB-LOT-3', 'FB-LOT-4')) THEN
    RAISE EXCEPTION 'A rejected batch left rows behind';
  END IF;
END $$;

SELECT set_config('app.current_user_role','WAREHOUSE_STAFF',true), set_config('app.current_user_id',current_setting('test.staff_w'),true),
  set_config('app.current_unit_id',current_setting('test.w'),true);
DO $$ BEGIN
  BEGIN
    PERFORM public.record_factory_batch(current_setting('test.w')::int, current_setting('test.variant')::int, 'FB-LOT-5',
      '2026-01-01', '2028-01-01', NULL, '[]');
    RAISE EXCEPTION 'Warehouse staff registered a factory batch';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
