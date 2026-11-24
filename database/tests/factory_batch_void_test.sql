\set ON_ERROR_STOP on
-- Run as postgres on a database initialized from master. Rolls back everything it creates.
BEGIN;
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('FV factory A','FACTORY') RETURNING id AS a \gset f_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('FV factory B','FACTORY') RETURNING id AS b \gset f_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('FV warehouse','CENTRAL_WAREHOUSE') RETURNING id AS w \gset f_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('FV staff A','fv-a@example.test','FACTORY_WAREHOUSE_STAFF','ACTIVE',:f_a) RETURNING id AS staff_a \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('FV staff B','fv-b@example.test','FACTORY_WAREHOUSE_STAFF','ACTIVE',:f_b) RETURNING id AS staff_b \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('FV warehouse staff','fv-w@example.test','WAREHOUSE_STAFF','ACTIVE',:f_w) RETURNING id AS staff_w \gset e_
INSERT INTO public.medicines(medicine_name) VALUES ('FV medicine') RETURNING id AS id \gset med_
INSERT INTO public.packaging_variants(medicine_id,unit_name) VALUES (:med_id,'box') RETURNING id AS id \gset v_
SELECT set_config('test.a',:'f_a',true), set_config('test.variant',:'v_id',true),
  set_config('test.staff_a',:'e_staff_a',true), set_config('test.staff_b',:'e_staff_b',true), set_config('test.staff_w',:'e_staff_w',true),
  set_config('test.f_b',:'f_b',true), set_config('test.f_w',:'f_w',true), set_config('test.f_a',:'f_a',true);

SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_type','employee',true), set_config('app.current_user_role','FACTORY_WAREHOUSE_STAFF',true),
  set_config('app.current_user_id',:'e_staff_a',true), set_config('app.current_unit_id',:'f_a',true);

DO $$
DECLARE
  factory int := current_setting('test.a')::int; variant int := current_setting('test.variant')::int;
  lot int; second_lot int; cartons jsonb; code text;
BEGIN
  cartons := jsonb_build_array(
    jsonb_build_object('sscc', 'FV-SSCC-1', 'boxes', (SELECT jsonb_agg(jsonb_build_object('uid', gen_random_uuid(), 'signature', 'sig')) FROM generate_series(1, 6))),
    jsonb_build_object('sscc', 'FV-SSCC-2', 'boxes', (SELECT jsonb_agg(jsonb_build_object('uid', gen_random_uuid(), 'signature', 'sig')) FROM generate_series(1, 4))));
  lot := public.record_factory_batch(factory, variant, 'FV-LOT-1', '2026-01-01', '2028-01-01', NULL, cartons);

  -- A reason is required.
  BEGIN PERFORM public.void_factory_batch(lot, '  '); RAISE EXCEPTION 'A blank reason was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN GET STACKED DIAGNOSTICS code = MESSAGE_TEXT; IF code <> 'FB_VOID_REASON_REQUIRED' THEN RAISE; END IF; END;

  -- Staff of another factory cannot void it.
  PERFORM set_config('app.current_user_id', current_setting('test.staff_b'), true);
  PERFORM set_config('app.current_unit_id', current_setting('test.f_b'), true);
  BEGIN PERFORM public.void_factory_batch(lot, 'wrong factory'); RAISE EXCEPTION 'Another factory voided the batch';
  EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '42501' THEN NULL; END;

  -- Warehouse staff cannot void a factory batch.
  PERFORM set_config('app.current_user_role', 'WAREHOUSE_STAFF', true);
  PERFORM set_config('app.current_user_id', current_setting('test.staff_w'), true);
  PERFORM set_config('app.current_unit_id', current_setting('test.f_w'), true);
  BEGIN PERFORM public.void_factory_batch(lot, 'not factory staff'); RAISE EXCEPTION 'Warehouse staff voided the batch';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;

  -- The owning factory can void an untouched batch.
  PERFORM set_config('app.current_user_role', 'FACTORY_WAREHOUSE_STAFF', true);
  PERFORM set_config('app.current_user_id', current_setting('test.staff_a'), true);
  PERFORM set_config('app.current_unit_id', current_setting('test.f_a'), true);
  PERFORM public.void_factory_batch(lot, 'registered with the wrong box count');

  IF (SELECT status FROM public.batches WHERE id = lot) <> 'VOIDED'
     OR (SELECT remaining_quantity FROM public.batches WHERE id = lot) <> 0 THEN
    RAISE EXCEPTION 'The batch was not voided';
  END IF;
  IF (SELECT count(*) FROM public.medicine_boxes WHERE batch_id = lot AND status = 'VOIDED' AND current_facility_id IS NULL) <> 10
     OR (SELECT count(*) FROM public.sscc_cartons WHERE batch_id = lot AND status = 'VOIDED' AND current_facility_id IS NULL) <> 2 THEN
    RAISE EXCEPTION 'Boxes and cartons were not taken out of the factory';
  END IF;
  IF (SELECT stock_quantity FROM public.inventories WHERE facility_id = factory AND variant_id = variant) <> 0 THEN
    RAISE EXCEPTION 'Factory stock was not reversed';
  END IF;
  IF (SELECT count(*) FROM public.inventory_logs WHERE batch_id = lot AND transaction_type = 'PRODUCTION_VOID' AND quantity_changed = -10) <> 1 THEN
    RAISE EXCEPTION 'The reversal was not logged';
  END IF;
  IF (SELECT count(*) FROM public.batch_status_events WHERE batch_id = lot AND to_status = 'VOIDED' AND reason LIKE '%wrong box count%') <> 1 THEN
    RAISE EXCEPTION 'The void was not audited';
  END IF;

  -- Voiding twice is refused.
  BEGIN PERFORM public.void_factory_batch(lot, 'again'); RAISE EXCEPTION 'A voided batch was voided again';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;

  -- A batch with a box that already left the factory cannot be voided.
  cartons := jsonb_build_array(
    jsonb_build_object('sscc', 'FV-SSCC-3', 'boxes', (SELECT jsonb_agg(jsonb_build_object('uid', gen_random_uuid(), 'signature', 'sig')) FROM generate_series(1, 3))));
  second_lot := public.record_factory_batch(factory, variant, 'FV-LOT-2', '2026-01-01', '2028-01-01', NULL, cartons);
  PERFORM set_config('test.second', second_lot::text, true);
END $$;

RESET ROLE;
UPDATE public.medicine_boxes SET status = 'IN_TRANSIT'
  WHERE uid = (SELECT uid FROM public.medicine_boxes WHERE batch_id = current_setting('test.second')::int ORDER BY uid LIMIT 1);

SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_type','employee',true), set_config('app.current_user_role','FACTORY_WAREHOUSE_STAFF',true),
  set_config('app.current_user_id',current_setting('test.staff_a'),true), set_config('app.current_unit_id',current_setting('test.f_a'),true);
DO $$
BEGIN
  BEGIN PERFORM public.void_factory_batch(current_setting('test.second')::int, 'a box already left');
    RAISE EXCEPTION 'A batch with a box outside the factory was voided';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  RAISE NOTICE 'PASS factory batch void';
END $$;
ROLLBACK;
