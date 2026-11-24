\set ON_ERROR_STOP on
-- Recall collection started by a warehouse manager back to the facility that started the recall (here the factory),
-- a factory as the destination of the administrator collection, and factory receipt.
-- Run as postgres on a database initialized from master (with recall_collection_scope.sql). Rolls back everything it creates.
BEGIN;
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('RCS warehouse', 'CENTRAL_WAREHOUSE') RETURNING id AS w \gset f_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('RCS branch', 'BRANCH_WAREHOUSE') RETURNING id AS o \gset f_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('RCS empty warehouse', 'BRANCH_WAREHOUSE') RETURNING id AS e \gset f_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('RCS factory', 'FACTORY') RETURNING id AS f \gset f_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('RCS pharmacy', 'PHARMACY') RETURNING id AS p \gset f_
INSERT INTO public.employees(full_name, role) VALUES ('RCS admin', 'SUPER_ADMIN') RETURNING id AS sa \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('RCS manager', 'WAREHOUSE_MANAGER', :f_w) RETURNING id AS wm \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('RCS staff', 'WAREHOUSE_STAFF', :f_w) RETURNING id AS ws \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('RCS branch manager', 'WAREHOUSE_MANAGER', :f_o) RETURNING id AS om \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('RCS empty manager', 'WAREHOUSE_MANAGER', :f_e) RETURNING id AS em \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('RCS factory staff', 'FACTORY_WAREHOUSE_STAFF', :f_f) RETURNING id AS fs \gset e_
INSERT INTO public.medicines(medicine_name) VALUES ('RCS medicine') RETURNING id AS id \gset med_
INSERT INTO public.packaging_variants(medicine_id, unit_name) VALUES (:med_id, 'Box') RETURNING id AS id \gset v_
INSERT INTO public.batches(batch_number, medicine_id, production_date, expiry_date, status, manufacturer_source_facility_id)
  VALUES (format('RCS-%s', txid_current()), :med_id, current_date - 1, current_date + 365, 'ACTIVE', :f_f) RETURNING id AS id \gset batch_
INSERT INTO public.medicine_boxes(batch_id, current_facility_id, status) SELECT :batch_id, :f_w, 'IN_STOCK' FROM generate_series(1, 4);
INSERT INTO public.medicine_boxes(batch_id, current_facility_id, status) SELECT :batch_id, :f_o, 'IN_STOCK' FROM generate_series(1, 2);
-- A second batch, recalled by the administrator: it has no facility of origin.
INSERT INTO public.batches(batch_number, medicine_id, production_date, expiry_date, status)
  VALUES (format('RCS-ADM-%s', txid_current()), :med_id, current_date - 1, current_date + 365, 'ACTIVE') RETURNING id AS id \gset admin_batch_
INSERT INTO public.medicine_boxes(batch_id, current_facility_id, status) VALUES (:admin_batch_id, :f_w, 'IN_STOCK');
INSERT INTO public.inventories(facility_id, variant_id, stock_quantity, reserved_quantity) VALUES (:f_w, :v_id, 5, 0), (:f_o, :v_id, 2, 0);
-- A dispatched transfer of another type to the factory, which factory staff must not be able to receive.
INSERT INTO public.internal_transfers(transfer_code, transfer_type, from_facility_id, to_facility_id, status, items)
  VALUES (format('RCS-REP-%s', txid_current()), 'REPLENISHMENT', :f_w, :f_f, 'DISPATCHED', '[]') RETURNING id AS rep \gset t_
SELECT set_config('test.w', :'f_w', true), set_config('test.o', :'f_o', true), set_config('test.e', :'f_e', true),
  set_config('test.f', :'f_f', true), set_config('test.p', :'f_p', true), set_config('test.sa', :'e_sa', true),
  set_config('test.wm', :'e_wm', true), set_config('test.ws', :'e_ws', true), set_config('test.om', :'e_om', true),
  set_config('test.em', :'e_em', true), set_config('test.fs', :'e_fs', true), set_config('test.none', '', true),
  set_config('test.variant', :'v_id', true), set_config('test.batch', :'batch_id', true), set_config('test.rep', :'t_rep', true),
  set_config('test.admin_batch', :'admin_batch_id', true);

CREATE FUNCTION pg_temp.rcs_expect(expected text, statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected % but the statement succeeded: %', expected, statement;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE expected || '%' THEN RAISE; END IF;
END $$;
CREATE FUNCTION pg_temp.rcs_as(role text, employee text, unit text, operation text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.current_user_type', 'employee', true), set_config('app.current_user_role', role, true),
    set_config('app.current_user_id', current_setting('test.' || employee), true),
    set_config('app.current_unit_id', current_setting('test.' || unit), true), set_config('app.order_operation', operation, true);
END $$;
CREATE FUNCTION pg_temp.rcs_collect(destination text, note text DEFAULT NULL) RETURNS TABLE(transfer_id integer, to_facility_id integer, created boolean)
LANGUAGE sql AS $$
  SELECT c.transfer_id, c.to_facility_id, c.created FROM public.collect_recall_from_facility(current_setting('test.recall')::integer,
    nullif(current_setting('test.' || destination), '')::integer, note) c
$$;

SET LOCAL ROLE app_user;
DO $$ BEGIN
  PERFORM pg_temp.rcs_as('FACTORY_WAREHOUSE_STAFF', 'fs', 'f', 'none');
  PERFORM set_config('test.recall', public.create_batch_recall('RCS-' || txid_current(), 'Contamination', 'LEVEL_1', NULL,
    ARRAY[current_setting('test.batch')::integer])::text, true);
  PERFORM pg_temp.rcs_as('SUPER_ADMIN', 'sa', 'none', 'none');
  PERFORM set_config('test.admin_recall', public.create_batch_recall('RCS-ADM-' || txid_current(), 'Contamination', 'LEVEL_2', NULL,
    ARRAY[current_setting('test.admin_batch')::integer])::text, true);
  PERFORM pg_temp.rcs_expect('RC_DESTINATION_INVALID', format('SELECT public.collect_batch_recall(%s, %s)', current_setting('test.recall'), current_setting('test.p')));
END $$;

-- Who may collect, and where to
DO $$
DECLARE c record;
BEGIN
  PERFORM pg_temp.rcs_as('WAREHOUSE_STAFF', 'ws', 'w', 'none');
  PERFORM pg_temp.rcs_expect('RC_COLLECT_FORBIDDEN', 'SELECT * FROM pg_temp.rcs_collect(''f'')');
  PERFORM pg_temp.rcs_as('SUPER_ADMIN', 'sa', 'w', 'none');
  PERFORM pg_temp.rcs_expect('RC_COLLECT_FORBIDDEN', 'SELECT * FROM pg_temp.rcs_collect(''f'')');
  -- A manager whose session names another warehouse than their own is refused.
  PERFORM pg_temp.rcs_as('WAREHOUSE_MANAGER', 'wm', 'o', 'none');
  PERFORM pg_temp.rcs_expect('RC_COLLECT_FORBIDDEN', 'SELECT * FROM pg_temp.rcs_collect(''f'')');

  PERFORM pg_temp.rcs_as('WAREHOUSE_STAFF', 'ws', 'w', 'none');
  PERFORM pg_temp.rcs_expect('RC_COLLECT_FORBIDDEN', 'SELECT * FROM public.recall_collection_origin(' || current_setting('test.recall') || ')');

  PERFORM pg_temp.rcs_as('WAREHOUSE_MANAGER', 'wm', 'w', 'none');
  IF (SELECT facility_id FROM public.recall_collection_origin(current_setting('test.recall')::integer)) <> current_setting('test.f')::integer THEN
    RAISE EXCEPTION 'The origin of a factory recall is not the factory';
  END IF;
  -- Only back to the facility that started the recall; a recall the administrator started has none.
  PERFORM pg_temp.rcs_expect('RC_DESTINATION_NOT_ORIGIN', 'SELECT * FROM pg_temp.rcs_collect(''o'')');
  PERFORM pg_temp.rcs_expect('RC_ORIGIN_UNKNOWN', 'SELECT * FROM public.recall_collection_origin(' || current_setting('test.admin_recall') || ')');
  PERFORM pg_temp.rcs_expect('RC_ORIGIN_UNKNOWN', format('SELECT * FROM public.collect_recall_from_facility(%s, %s, NULL)',
    current_setting('test.admin_recall'), current_setting('test.f')));
  PERFORM pg_temp.rcs_expect('RC_DESTINATION_INVALID', 'SELECT * FROM pg_temp.rcs_collect(''w'')');
  PERFORM pg_temp.rcs_expect('RC_DESTINATION_INVALID', 'SELECT * FROM pg_temp.rcs_collect(''p'')');
  PERFORM pg_temp.rcs_expect('RC_DESTINATION_INVALID', 'SELECT * FROM pg_temp.rcs_collect(''none'')');
  PERFORM pg_temp.rcs_expect('RC_NOTE_TOO_LONG', format('SELECT * FROM pg_temp.rcs_collect(''f'', %L)', repeat('x', 501)));

  SELECT * INTO c FROM pg_temp.rcs_collect('f', 'Back to the factory');
  IF c.created IS NOT TRUE OR c.to_facility_id <> current_setting('test.f')::integer THEN RAISE EXCEPTION 'Collection to the factory was not created'; END IF;
  PERFORM set_config('test.transfer', c.transfer_id::text, true);
  IF (SELECT count(*) FROM pg_temp.rcs_collect('f') WHERE transfer_id = c.transfer_id AND created IS FALSE) <> 1 THEN
    RAISE EXCEPTION 'A second call created another open collection transfer';
  END IF;

  PERFORM pg_temp.rcs_as('WAREHOUSE_MANAGER', 'em', 'e', 'none');
  PERFORM pg_temp.rcs_expect('RC_NOTHING_TO_COLLECT', 'SELECT * FROM pg_temp.rcs_collect(''f'')');
END $$;

RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.internal_transfers WHERE transfer_type = 'RECALL_COLLECTION' AND from_facility_id = current_setting('test.w')::integer) <> 1
    OR (SELECT notes FROM public.internal_transfers WHERE id = current_setting('test.transfer')::integer) NOT LIKE '%: Back to the factory' THEN
    RAISE EXCEPTION 'Collection transfer is wrong';
  END IF;
  -- Only the caller's warehouse was collected: the branch still holds its two boxes in quarantine.
  IF (SELECT count(*) FROM public.medicine_boxes WHERE current_facility_id = current_setting('test.w')::integer AND status = 'RESERVED') <> 4
    OR (SELECT count(*) FROM public.medicine_boxes WHERE current_facility_id = current_setting('test.o')::integer AND status = 'QUARANTINED') <> 2 THEN
    RAISE EXCEPTION 'Collection moved boxes of another facility';
  END IF;
END $$;

-- The administrator may now collect into the factory as well; only the branch is left.
SET LOCAL ROLE app_user;
DO $$ BEGIN
  PERFORM pg_temp.rcs_as('SUPER_ADMIN', 'sa', 'none', 'none');
  IF public.collect_batch_recall(current_setting('test.recall')::integer, current_setting('test.f')::integer) <> 1
    OR public.collect_batch_recall(current_setting('test.recall')::integer, current_setting('test.f')::integer) <> 0 THEN
    RAISE EXCEPTION 'Administrator collection into the factory did not take only the remaining facility';
  END IF;
END $$;

-- Dispatch from the warehouse, receipt at the factory
DO $$
DECLARE uids uuid[];
BEGIN
  PERFORM pg_temp.rcs_as('WAREHOUSE_MANAGER', 'wm', 'w', 'dispatch');
  -- The manager who created the collection hands it over, not any other employee of the warehouse.
  IF ARRAY(SELECT id FROM public.transfer_transport_staff(current_setting('test.transfer')::integer))
    IS DISTINCT FROM ARRAY[current_setting('test.wm')::integer] THEN
    RAISE EXCEPTION 'Only the manager who created the collection may hand it over';
  END IF;
  PERFORM pg_temp.rcs_as('WAREHOUSE_MANAGER', 'om', 'o', 'dispatch');
  IF NOT EXISTS (SELECT FROM public.transfer_transport_staff((SELECT t.id FROM public.internal_transfers t
      WHERE t.transfer_type = 'RECALL_COLLECTION' AND t.from_facility_id = current_setting('test.o')::integer)) s
    WHERE s.id = current_setting('test.om')::integer) THEN
    RAISE EXCEPTION 'A collection the administrator created must offer the employees of the source';
  END IF;
  PERFORM pg_temp.rcs_as('WAREHOUSE_MANAGER', 'wm', 'w', 'dispatch');
  SELECT array_agg(uid) INTO uids FROM public.medicine_boxes WHERE batch_id = current_setting('test.batch')::integer AND current_facility_id = current_setting('test.w')::integer;
  PERFORM public.prepare_dispatch_manifest(current_setting('test.transfer')::integer,
    jsonb_build_array(jsonb_build_object('variantId', current_setting('test.variant')::integer, 'quantity', 4, 'boxUids', to_jsonb(uids))));
  UPDATE public.internal_transfers SET status = 'DISPATCHED', transport_mode = 'INTERNAL', transport_employee_id = current_setting('test.wm')::integer,
    transport_employee_name = 'RCS manager', dispatched_at = now() WHERE id = current_setting('test.transfer')::integer;

  PERFORM pg_temp.rcs_as('FACTORY_WAREHOUSE_STAFF', 'fs', 'f', 'receive');
  PERFORM pg_temp.rcs_expect('Transfer custody receipt is not authorized',
    format('SELECT public.consume_transfer_custody(%s, %s, 1)', current_setting('test.rep'), current_setting('test.variant')));
  -- The same steps the API takes when it confirms a clean receipt.
  PERFORM public.consume_transfer_custody(current_setting('test.transfer')::integer, current_setting('test.variant')::integer, 4);
  UPDATE public.medicine_boxes SET status = 'IN_STOCK', current_facility_id = current_setting('test.f')::integer
    WHERE uid IN (SELECT unnest(box_uids) FROM public.transfer_custody WHERE transfer_id = current_setting('test.transfer')::integer)
      AND current_facility_id IS NULL AND status = 'IN_TRANSIT';
  INSERT INTO public.inventories(facility_id, variant_id, stock_quantity, reserved_quantity)
    VALUES (current_setting('test.f')::integer, current_setting('test.variant')::integer, 4, 0);
  UPDATE public.internal_transfers SET status = 'RECEIVED', received_at = now(), updated_at = now() WHERE id = current_setting('test.transfer')::integer;
END $$;

RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.medicine_boxes WHERE current_facility_id = current_setting('test.f')::integer AND status = 'QUARANTINED') <> 4
    OR EXISTS (SELECT FROM public.medicine_boxes WHERE current_facility_id = current_setting('test.f')::integer AND status = 'IN_STOCK')
    OR (SELECT ARRAY[i.stock_quantity, q.quantity] FROM public.inventories i JOIN public.quarantine_balances q USING (facility_id, variant_id)
        WHERE i.facility_id = current_setting('test.f')::integer AND i.variant_id = current_setting('test.variant')::integer) <> ARRAY[0, 4] THEN
    RAISE EXCEPTION 'Recall stock received at the factory was not quarantined';
  END IF;
END $$;

-- Closing waits for the branch collection, whatever the destination type.
SET LOCAL ROLE app_user;
DO $$ BEGIN
  PERFORM pg_temp.rcs_as('SUPER_ADMIN', 'sa', 'none', 'none');
  PERFORM pg_temp.rcs_expect('RC_COLLECTION_OPEN', format('SELECT public.close_batch_recall(%s, ''Done'')', current_setting('test.recall')));
END $$;
RESET ROLE;
UPDATE public.internal_transfers SET status = 'RECEIVED' WHERE transfer_type = 'RECALL_COLLECTION' AND from_facility_id = :f_o;
SET LOCAL ROLE app_user;
DO $$ BEGIN
  PERFORM pg_temp.rcs_as('SUPER_ADMIN', 'sa', 'none', 'none');
  PERFORM public.close_batch_recall(current_setting('test.recall')::integer, 'Done');
  PERFORM pg_temp.rcs_as('WAREHOUSE_MANAGER', 'om', 'o', 'none');
  PERFORM pg_temp.rcs_expect('RC_NOT_ACTIVE', 'SELECT * FROM pg_temp.rcs_collect(''f'')');
END $$;
ROLLBACK;
\echo recall_collection_scope_test passed
