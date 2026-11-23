\set ON_ERROR_STOP on
-- Source stock a requester may ask for: free quantity, boxes of held batches excluded, nothing for outsiders.
-- Run as owner on a disposable initialized database; every fixture is rolled back.
BEGIN;
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('TS factory','FACTORY') RETURNING id AS f \gset f_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('TS warehouse','CENTRAL_WAREHOUSE') RETURNING id AS w \gset f_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('TS factory staff','ts-f@example.test','FACTORY_WAREHOUSE_STAFF','ACTIVE',:f_f) RETURNING id AS fs \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('TS warehouse manager','ts-m@example.test','WAREHOUSE_MANAGER','ACTIVE',:f_w) RETURNING id AS wm \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('TS warehouse staff','ts-s@example.test','WAREHOUSE_STAFF','ACTIVE',:f_w) RETURNING id AS ws \gset e_
INSERT INTO public.medicines(medicine_name) VALUES ('TS medicine') RETURNING id AS id \gset med_
INSERT INTO public.packaging_variants(medicine_id,unit_name) VALUES (:med_id,'Box') RETURNING id AS id \gset vb_
INSERT INTO public.packaging_variants(medicine_id,unit_name) VALUES (:med_id,'Blister') RETURNING id AS id \gset vp_
SELECT set_config('test.f',:'f_f',true), set_config('test.w',:'f_w',true), set_config('test.vb',:'vb_id',true), set_config('test.vp',:'vp_id',true),
  set_config('test.fs',:'e_fs',true), set_config('test.wm',:'e_wm',true), set_config('test.ws',:'e_ws',true);

SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_type','employee',true), set_config('app.current_user_role','FACTORY_WAREHOUSE_STAFF',true),
  set_config('app.current_user_id',:'e_fs',true), set_config('app.current_unit_id',:'f_f',true);
DO $$
DECLARE box_cartons jsonb; pack_cartons jsonb;
BEGIN
  box_cartons := jsonb_build_array(jsonb_build_object('sscc','TS-SSCC-1','boxes',(SELECT jsonb_agg(jsonb_build_object('uid',gen_random_uuid(),'signature','s')) FROM generate_series(1,5))));
  pack_cartons := jsonb_build_array(jsonb_build_object('sscc','TS-SSCC-2','boxes',(SELECT jsonb_agg(jsonb_build_object('uid',gen_random_uuid(),'signature','s')) FROM generate_series(1,3))));
  PERFORM public.record_factory_batch(current_setting('test.f')::int, current_setting('test.vb')::int, 'TS-LOT-BOX', '2026-01-01', '2030-01-01', NULL, box_cartons);
  PERFORM public.record_factory_batch(current_setting('test.f')::int, current_setting('test.vp')::int, 'TS-LOT-PACK', '2026-01-01', '2030-01-01', NULL, pack_cartons);
END $$;
-- Hold the Blister batch: only Box stays free.
UPDATE public.batches SET status = 'ON_HOLD' WHERE batch_number = 'TS-LOT-PACK';

SELECT set_config('app.current_user_role','WAREHOUSE_MANAGER',true), set_config('app.current_user_id',:'e_wm',true), set_config('app.current_unit_id',:'f_w',true);
DO $$
DECLARE rows integer; free integer;
BEGIN
  SELECT count(*), max(available) INTO rows, free FROM public.transfer_source_stock(current_setting('test.f')::int);
  IF rows <> 1 OR free <> 5 THEN RAISE EXCEPTION 'Expected only the 5 free Box units, got % rows and %', rows, free; END IF;
  IF (SELECT variant_id FROM public.transfer_source_stock(current_setting('test.f')::int)) <> current_setting('test.vb')::int THEN
    RAISE EXCEPTION 'The held Blister batch must not be offered';
  END IF;
  BEGIN PERFORM public.transfer_source_stock(current_setting('test.w')::int); RAISE EXCEPTION 'Own facility accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'ST_SOURCE_INVALID' THEN RAISE; END IF; END;
END $$;

-- Warehouse staff are not requesters.
SELECT set_config('app.current_user_role','WAREHOUSE_STAFF',true), set_config('app.current_user_id',:'e_ws',true);
DO $$ BEGIN
  PERFORM public.transfer_source_stock(current_setting('test.f')::int);
  RAISE EXCEPTION 'Warehouse staff must not read source stock';
EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'ST_FORBIDDEN' THEN RAISE; END IF; END $$;
DO $$ BEGIN RAISE NOTICE 'PASS transfer source stock'; END $$;
ROLLBACK;
