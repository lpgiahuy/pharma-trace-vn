\set ON_ERROR_STOP on
-- Factory staff quality actions: hold events, recalling own batches and drafting disposals. Run as owner on an initialized
-- disposable database; every fixture is rolled back.
BEGIN;
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('FQ factory','FACTORY') RETURNING id AS f \gset f_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('FQ other factory','FACTORY') RETURNING id AS g \gset f_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('FQ warehouse','CENTRAL_WAREHOUSE') RETURNING id AS w \gset f_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('FQ factory staff','fq-f@example.test','FACTORY_WAREHOUSE_STAFF','ACTIVE',:f_f) RETURNING id AS fs \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('FQ other staff','fq-g@example.test','FACTORY_WAREHOUSE_STAFF','ACTIVE',:f_g) RETURNING id AS gs \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('FQ warehouse staff','fq-w@example.test','WAREHOUSE_STAFF','ACTIVE',:f_w) RETURNING id AS ws \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('FQ factory manager','fq-m@example.test','WAREHOUSE_MANAGER','ACTIVE',:f_f) RETURNING id AS wm \gset e_
INSERT INTO public.medicines(medicine_name) VALUES ('FQ medicine') RETURNING id AS id \gset med_
INSERT INTO public.packaging_variants(medicine_id,unit_name) VALUES (:med_id,'box') RETURNING id AS id \gset v_
SELECT set_config('test.f',:'f_f',true), set_config('test.g',:'f_g',true), set_config('test.w',:'f_w',true), set_config('test.variant',:'v_id',true),
  set_config('test.fs',:'e_fs',true), set_config('test.gs',:'e_gs',true), set_config('test.ws',:'e_ws',true), set_config('test.wm',:'e_wm',true);

CREATE FUNCTION pg_temp.fq_as(role text, employee text, unit text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.current_user_type','employee',true), set_config('app.current_user_role',role,true),
    set_config('app.current_user_id',current_setting('test.'||employee),true), set_config('app.current_unit_id',current_setting('test.'||unit),true);
END $$;
CREATE FUNCTION pg_temp.fq_expect(expected text, statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected % but the statement succeeded: %', expected, statement;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%' || expected || '%' THEN RAISE; END IF;
END $$;

SET LOCAL ROLE app_user;
SELECT pg_temp.fq_as('FACTORY_WAREHOUSE_STAFF','fs','f');
DO $$
DECLARE cartons jsonb;
BEGIN
  cartons := jsonb_build_array(jsonb_build_object('sscc','FQ-SSCC-1','boxes',(SELECT jsonb_agg(jsonb_build_object('uid',gen_random_uuid(),'signature','s')) FROM generate_series(1,4))));
  PERFORM public.record_factory_batch(current_setting('test.f')::int, current_setting('test.variant')::int, 'FQ-LOT-1', '2026-01-01', '2030-01-01', NULL, cartons);
  PERFORM set_config('test.batch', (SELECT id::text FROM public.batches WHERE batch_number = 'FQ-LOT-1'), true);
END $$;

-- Hold events: own factory only.
INSERT INTO public.batch_status_events(batch_id, from_status, to_status, reason, actor_id)
  VALUES (current_setting('test.batch')::int, 'ACTIVE', 'ON_HOLD', 'Lab check', current_setting('test.fs')::int);
SELECT pg_temp.fq_expect('row-level security', format('INSERT INTO public.batch_status_events(batch_id, from_status, to_status, reason, actor_id) VALUES (%s, %L, %L, %L, %s)',
  current_setting('test.batch'), 'ACTIVE', 'ON_HOLD', 'x', current_setting('test.gs')))
  FROM (SELECT pg_temp.fq_as('FACTORY_WAREHOUSE_STAFF','gs','g')) s;
SELECT pg_temp.fq_expect('row-level security', format('INSERT INTO public.batch_status_events(batch_id, from_status, to_status, reason, actor_id) VALUES (%s, %L, %L, %L, %s)',
  current_setting('test.batch'), 'ACTIVE', 'ON_HOLD', 'x', current_setting('test.ws')))
  FROM (SELECT pg_temp.fq_as('WAREHOUSE_STAFF','ws','w')) s;

-- Recall: only the factory that made the batch (or SUPER_ADMIN).
SELECT pg_temp.fq_expect('RC_FORBIDDEN', format('SELECT public.create_batch_recall(%L, %L, %L, NULL, ARRAY[%s])', 'FQ-RCL-X1', 'bad', 'LEVEL_2', current_setting('test.batch')))
  FROM (SELECT pg_temp.fq_as('FACTORY_WAREHOUSE_STAFF','gs','g')) s;
SELECT pg_temp.fq_expect('RC_FORBIDDEN', format('SELECT public.create_batch_recall(%L, %L, %L, NULL, ARRAY[%s])', 'FQ-RCL-X2', 'bad', 'LEVEL_2', current_setting('test.batch')))
  FROM (SELECT pg_temp.fq_as('WAREHOUSE_STAFF','ws','w')) s;
SELECT pg_temp.fq_as('FACTORY_WAREHOUSE_STAFF','fs','f');
SELECT public.create_batch_recall('FQ-RCL-0001', 'Contamination found', 'LEVEL_1', NULL, ARRAY[current_setting('test.batch')::int]) AS recall \gset
DO $$
BEGIN
  IF (SELECT status FROM public.batches WHERE id = current_setting('test.batch')::int) <> 'RECALLED' THEN RAISE EXCEPTION 'The batch was not recalled'; END IF;
  IF (SELECT count(*) FROM public.medicine_boxes WHERE batch_id = current_setting('test.batch')::int AND status = 'QUARANTINED') <> 4 THEN
    RAISE EXCEPTION 'The factory stock of the recalled batch was not quarantined';
  END IF;
END $$;

-- Disposal: factory staff draft it for the quarantined boxes, then approve and complete it themselves (the factory has
-- no warehouse manager). Staff of another factory and warehouse floor staff cannot.
DO $$
DECLARE uids uuid[]; disposal integer;
BEGIN
  SELECT array_agg(box_uid) INTO uids FROM public.disposal_candidates(current_setting('test.f')::int);
  IF coalesce(cardinality(uids), 0) <> 4 THEN RAISE EXCEPTION 'Expected 4 disposal candidates, got %', coalesce(cardinality(uids), 0); END IF;
  disposal := public.create_disposal('FQ-DISP-0001', current_setting('test.f')::int, 'Recalled batch', uids);
  IF NOT EXISTS (SELECT FROM public.disposals WHERE id = disposal AND status = 'DRAFT') THEN RAISE EXCEPTION 'The disposal is not visible to its creator'; END IF;
  PERFORM public.add_disposal_attachment(disposal, 'photo-ref');
  PERFORM set_config('test.disposal', disposal::text, true);
END $$;
SELECT pg_temp.fq_expect('DP_FORBIDDEN', format('SELECT public.create_disposal(%L, %s, %L, ARRAY[gen_random_uuid()])', 'FQ-DISP-0002', current_setting('test.g'), 'x'));
SELECT pg_temp.fq_as('FACTORY_WAREHOUSE_STAFF','gs','g');
SELECT pg_temp.fq_expect('DP_NOT_FOUND', format('SELECT public.approve_disposal(%s)', current_setting('test.disposal')));
SELECT pg_temp.fq_as('WAREHOUSE_STAFF','ws','w');
SELECT pg_temp.fq_expect('DP_FORBIDDEN', format('SELECT public.approve_disposal(%s)', current_setting('test.disposal')));
SELECT pg_temp.fq_as('FACTORY_WAREHOUSE_STAFF','fs','f');
SELECT public.approve_disposal(current_setting('test.disposal')::int);
SELECT public.complete_disposal(current_setting('test.disposal')::int);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.medicine_boxes WHERE batch_id = current_setting('test.batch')::int AND status = 'DESTROYED') <> 4 THEN RAISE EXCEPTION 'The boxes were not destroyed'; END IF;
  RAISE NOTICE 'PASS factory quality actions';
END $$;
ROLLBACK;
