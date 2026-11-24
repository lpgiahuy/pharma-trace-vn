\set ON_ERROR_STOP on
-- Run as postgres on a database initialized from master. Rolls back everything it creates.
-- A recall collection must dispatch by carton even when a carton lost a box to a sale before the recall.
BEGIN;
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('RCC factory', 'FACTORY') RETURNING id AS f \gset f_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('RCC warehouse', 'CENTRAL_WAREHOUSE') RETURNING id AS w \gset f_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('RCC factory staff', 'FACTORY_WAREHOUSE_STAFF', :f_f) RETURNING id AS fs \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('RCC admin', 'SUPER_ADMIN', :f_f) RETURNING id AS ad \gset e_
INSERT INTO public.medicines(medicine_name) VALUES ('RCC medicine') RETURNING id AS id \gset med_
INSERT INTO public.packaging_variants(medicine_id, unit_name) VALUES (:med_id, 'Box') RETURNING id AS id \gset v_
SELECT set_config('test.f', :'f_f', true), set_config('test.w', :'f_w', true), set_config('test.fs', :'e_fs', true),
  set_config('test.ad', :'e_ad', true), set_config('test.variant', :'v_id', true);

CREATE FUNCTION pg_temp.rcc_as(role text, employee text, unit text, operation text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.current_user_type', 'employee', true), set_config('app.current_user_role', role, true),
    set_config('app.current_user_id', current_setting('test.' || employee), true),
    set_config('app.current_unit_id', current_setting('test.' || unit), true), set_config('app.order_operation', operation, true);
END $$;
CREATE FUNCTION pg_temp.rcc_expect(expected text, statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected % but the statement succeeded: %', expected, statement;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE expected || '%' THEN RAISE; END IF;
END $$;

-- Factory stock: two cartons of 3 boxes through the real intake function.
SET LOCAL ROLE app_user;
SELECT pg_temp.rcc_as('FACTORY_WAREHOUSE_STAFF', 'fs', 'f', 'none');
DO $$
DECLARE cartons jsonb; lot integer;
BEGIN
  cartons := jsonb_build_array(
    jsonb_build_object('sscc', 'RCC-SSCC-1', 'boxes', (SELECT jsonb_agg(jsonb_build_object('uid', gen_random_uuid(), 'signature', 's')) FROM generate_series(1, 3))),
    jsonb_build_object('sscc', 'RCC-SSCC-2', 'boxes', (SELECT jsonb_agg(jsonb_build_object('uid', gen_random_uuid(), 'signature', 's')) FROM generate_series(1, 3))));
  lot := public.record_factory_batch(current_setting('test.f')::int, current_setting('test.variant')::int, 'RCC-LOT-' || txid_current(), '2026-01-01', '2030-01-01', NULL, cartons);
  PERFORM set_config('test.lot', lot::text, true);
END $$;

-- One box of carton 1 is sold (packed for an order) before the recall.
RESET ROLE;
UPDATE public.medicine_boxes SET status = 'PACKAGED' WHERE uid = (
  SELECT b.uid FROM public.medicine_boxes b JOIN public.sscc_cartons c ON c.id = b.carton_id
  WHERE c.sscc_code = 'RCC-SSCC-1' ORDER BY b.uid LIMIT 1);

SET LOCAL ROLE app_user;
SELECT pg_temp.rcc_as('SUPER_ADMIN', 'ad', 'f', 'none');
SELECT public.create_batch_recall('RCC-' || txid_current(), 'carton test', 'LEVEL_2', NULL, ARRAY[current_setting('test.lot')::int]) AS recall \gset
SELECT public.collect_batch_recall(:recall, current_setting('test.w')::int) AS collected \gset
SELECT id AS transfer FROM public.internal_transfers WHERE from_facility_id = current_setting('test.f')::int AND transfer_type = 'RECALL_COLLECTION' \gset

DO $$
BEGIN
  IF (SELECT count(*) FROM public.medicine_boxes WHERE status = 'RESERVED' AND current_facility_id = current_setting('test.f')::int) <> 5 THEN
    RAISE EXCEPTION 'The collection must reserve the 5 boxes that were still in stock';
  END IF;
END $$;

SELECT pg_temp.rcc_as('FACTORY_WAREHOUSE_STAFF', 'fs', 'f', 'dispatch');
DO $$
DECLARE uids uuid[]; t integer := (SELECT id FROM public.internal_transfers WHERE from_facility_id = current_setting('test.f')::int AND transfer_type = 'RECALL_COLLECTION');
BEGIN
  -- The carton that lost a box dispatches the 2 it still holds; the full carton dispatches its 3.
  uids := public.expand_dispatch_cartons(t, current_setting('test.variant')::int, ARRAY['RCC-SSCC-1']);
  IF cardinality(uids) <> 2 THEN RAISE EXCEPTION 'Carton 1 should expand to 2 boxes, got %', cardinality(uids); END IF;
  uids := public.expand_dispatch_cartons(t, current_setting('test.variant')::int, ARRAY['RCC-SSCC-1', 'RCC-SSCC-2']);
  IF cardinality(uids) <> 5 THEN RAISE EXCEPTION 'Both cartons should expand to 5 boxes, got %', cardinality(uids); END IF;
END $$;

-- A box this collection took that is no longer reserved at the factory makes its carton incomplete.
RESET ROLE;
UPDATE public.medicine_boxes SET status = 'QUARANTINED' WHERE uid = (
  SELECT b.uid FROM public.medicine_boxes b JOIN public.sscc_cartons c ON c.id = b.carton_id
  WHERE c.sscc_code = 'RCC-SSCC-2' AND b.status = 'RESERVED' ORDER BY b.uid LIMIT 1);
SET LOCAL ROLE app_user;
SELECT pg_temp.rcc_as('FACTORY_WAREHOUSE_STAFF', 'fs', 'f', 'dispatch');
SELECT pg_temp.rcc_expect('Carton RCC-SSCC-2 is incomplete', format('SELECT public.expand_dispatch_cartons(%s, %s, ARRAY[%L])',
  :transfer, current_setting('test.variant'), 'RCC-SSCC-2'));
ROLLBACK;
\echo recall_collection_carton_test passed
