\set ON_ERROR_STOP on
-- Run as postgres on a database initialized from master. Rolls back everything it creates.
BEGIN;
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('FT factory', 'FACTORY') RETURNING id AS f \gset f_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('FT other factory', 'FACTORY') RETURNING id AS g \gset f_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('FT warehouse', 'CENTRAL_WAREHOUSE') RETURNING id AS w \gset f_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('FT pharmacy', 'PHARMACY') RETURNING id AS p \gset f_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('FT factory staff', 'FACTORY_WAREHOUSE_STAFF', :f_f) RETURNING id AS fs \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('FT other factory staff', 'FACTORY_WAREHOUSE_STAFF', :f_g) RETURNING id AS gs \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('FT warehouse staff', 'WAREHOUSE_STAFF', :f_w) RETURNING id AS ws \gset e_
INSERT INTO public.medicines(medicine_name) VALUES ('FT medicine') RETURNING id AS id \gset med_
INSERT INTO public.medicines(medicine_name) VALUES ('FT other medicine') RETURNING id AS id \gset med2_
INSERT INTO public.packaging_variants(medicine_id, unit_name) VALUES (:med_id, 'Box') RETURNING id AS id \gset v_
INSERT INTO public.packaging_variants(medicine_id, unit_name) VALUES (:med2_id, 'Box') RETURNING id AS id \gset v2_
SELECT set_config('test.f', :'f_f', true), set_config('test.g', :'f_g', true), set_config('test.w', :'f_w', true), set_config('test.p', :'f_p', true),
  set_config('test.fs', :'e_fs', true), set_config('test.gs', :'e_gs', true), set_config('test.ws', :'e_ws', true),
  set_config('test.variant', :'v_id', true), set_config('test.variant2', :'v2_id', true);

CREATE FUNCTION pg_temp.ft_as(role text, employee text, unit text, operation text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.current_user_type', 'employee', true), set_config('app.current_user_role', role, true),
    set_config('app.current_user_id', current_setting('test.' || employee), true),
    set_config('app.current_unit_id', current_setting('test.' || unit), true), set_config('app.order_operation', operation, true);
END $$;
CREATE FUNCTION pg_temp.ft_expect(expected text, statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected % but the statement succeeded: %', expected, statement;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE expected || '%' THEN RAISE; END IF;
END $$;

-- Factory stock: two cartons of 3 boxes through the real intake function.
SET LOCAL ROLE app_user;
SELECT pg_temp.ft_as('FACTORY_WAREHOUSE_STAFF', 'fs', 'f', 'none');
DO $$
DECLARE cartons jsonb; lot integer;
BEGIN
  cartons := jsonb_build_array(
    jsonb_build_object('sscc', 'FT-SSCC-1', 'boxes', (SELECT jsonb_agg(jsonb_build_object('uid', gen_random_uuid(), 'signature', 's')) FROM generate_series(1, 3))),
    jsonb_build_object('sscc', 'FT-SSCC-2', 'boxes', (SELECT jsonb_agg(jsonb_build_object('uid', gen_random_uuid(), 'signature', 's')) FROM generate_series(1, 3))));
  lot := public.record_factory_batch(current_setting('test.f')::int, current_setting('test.variant')::int, 'FT-LOT-' || txid_current(), '2026-01-01', '2030-01-01', NULL, cartons);
END $$;

-- Only factory staff of a factory send; others and unknown destinations are refused.
SELECT pg_temp.ft_expect('ST_FORBIDDEN', format('SELECT public.send_factory_transfer(%L, %s, %L, NULL)', 'FT-X1', current_setting('test.w'),
  jsonb_build_array(jsonb_build_object('variantId', current_setting('test.variant')::int, 'quantity', 1))))
  FROM (SELECT pg_temp.ft_as('WAREHOUSE_STAFF', 'ws', 'w', 'none')) s;
SELECT pg_temp.ft_as('FACTORY_WAREHOUSE_STAFF', 'fs', 'f', 'none');
SELECT pg_temp.ft_expect('ST_DESTINATION_INVALID', format('SELECT public.send_factory_transfer(%L, %s, %L, NULL)', 'FT-X2', current_setting('test.p'),
  jsonb_build_array(jsonb_build_object('variantId', current_setting('test.variant')::int, 'quantity', 1))));
SELECT pg_temp.ft_expect('ST_LINES_INVALID', format('SELECT public.send_factory_transfer(%L, %s, %L, NULL)', 'FT-X3', current_setting('test.w'),
  jsonb_build_array(jsonb_build_object('variantId', 0, 'quantity', 1))));
SELECT pg_temp.ft_expect('ST_STOCK_INSUFFICIENT', format('SELECT public.send_factory_transfer(%L, %s, %L, NULL)', 'FT-X4', current_setting('test.w'),
  jsonb_build_array(jsonb_build_object('variantId', current_setting('test.variant')::int, 'quantity', 7))));

-- A valid send creates an approved request, reserves stock and makes the transfer; resending the code is idempotent.
SELECT public.send_factory_transfer('FT-SEND-1', current_setting('test.w')::int,
  jsonb_build_array(jsonb_build_object('variantId', current_setting('test.variant')::int, 'quantity', 3)), 'Weekly supply') AS request \gset
DO $$
DECLARE r public.stock_transfer_requests%ROWTYPE; t public.internal_transfers%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.stock_transfer_requests WHERE request_code = 'FT-SEND-1';
  SELECT * INTO t FROM public.internal_transfers WHERE request_id = r.id;
  IF r.status <> 'APPROVED' OR r.from_facility_id <> current_setting('test.f')::int OR r.to_facility_id <> current_setting('test.w')::int THEN
    RAISE EXCEPTION 'The request was not created and approved: %', r.status;
  END IF;
  IF t.id IS NULL OR t.status <> 'REQUESTED' OR t.transfer_type <> 'REPLENISHMENT' OR t.order_id IS NOT NULL THEN
    RAISE EXCEPTION 'The internal transfer was not created';
  END IF;
  IF (SELECT reserved_quantity FROM public.inventories WHERE facility_id = r.from_facility_id AND variant_id = current_setting('test.variant')::int) <> 3 THEN
    RAISE EXCEPTION 'Factory stock was not reserved';
  END IF;
  IF public.send_factory_transfer('FT-SEND-1', r.to_facility_id, r.lines, NULL) <> r.id THEN RAISE EXCEPTION 'Resending the code created another request'; END IF;
  PERFORM set_config('test.transfer', t.id::text, true);
END $$;

-- Carton expansion.
SELECT pg_temp.ft_as('FACTORY_WAREHOUSE_STAFF', 'fs', 'f', 'dispatch');
DO $$
DECLARE uids uuid[]; transfer integer := current_setting('test.transfer')::int; variant integer := current_setting('test.variant')::int;
BEGIN
  uids := public.expand_dispatch_cartons(transfer, variant, ARRAY['FT-SSCC-1', 'FT-SSCC-2']);
  IF cardinality(uids) <> 6 THEN RAISE EXCEPTION 'Cartons were not expanded to their boxes: %', cardinality(uids); END IF;
END $$;
SELECT pg_temp.ft_expect('Scan between 1 and 100 different cartons', format('SELECT public.expand_dispatch_cartons(%s, %s, ARRAY[%L, %L])',
  current_setting('test.transfer'), current_setting('test.variant'), 'FT-SSCC-1', 'FT-SSCC-1'));
SELECT pg_temp.ft_expect('Carton FT-NOPE is not at the source facility', format('SELECT public.expand_dispatch_cartons(%s, %s, ARRAY[%L])',
  current_setting('test.transfer'), current_setting('test.variant'), 'FT-NOPE'));
SELECT pg_temp.ft_expect('Carton line does not belong to this transfer', format('SELECT public.expand_dispatch_cartons(%s, %s, ARRAY[%L])',
  current_setting('test.transfer'), current_setting('test.variant2'), 'FT-SSCC-1'));
-- Another factory's staff and the receiving warehouse cannot expand them.
SELECT pg_temp.ft_expect('Transfer not found at the source facility', format('SELECT public.expand_dispatch_cartons(%s, %s, ARRAY[%L])',
  current_setting('test.transfer'), current_setting('test.variant'), 'FT-SSCC-1'))
  FROM (SELECT pg_temp.ft_as('FACTORY_WAREHOUSE_STAFF', 'gs', 'g', 'dispatch')) s;
SELECT pg_temp.ft_expect('Transfer not found at the source facility', format('SELECT public.expand_dispatch_cartons(%s, %s, ARRAY[%L])',
  current_setting('test.transfer'), current_setting('test.variant'), 'FT-SSCC-1'))
  FROM (SELECT pg_temp.ft_as('WAREHOUSE_STAFF', 'ws', 'w', 'dispatch')) s;
-- Outside the dispatch operation nothing is expanded.
SELECT pg_temp.ft_expect('Carton expansion is not authorized', format('SELECT public.expand_dispatch_cartons(%s, %s, ARRAY[%L])',
  current_setting('test.transfer'), current_setting('test.variant'), 'FT-SSCC-1'))
  FROM (SELECT pg_temp.ft_as('FACTORY_WAREHOUSE_STAFF', 'fs', 'f', 'none')) s;
DO $$ BEGIN RAISE NOTICE 'PASS factory transfer send and carton expansion'; END $$;
ROLLBACK;
