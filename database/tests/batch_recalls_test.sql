\set ON_ERROR_STOP on
-- Batch recalls: SUPER_ADMIN only, quarantine at every facility, impact covering every box, facility tasks,
-- collection through the normal transfer workflow and quarantine again at the destination.
-- Run as owner on a disposable initialized database; every fixture is rolled back.
BEGIN;
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('RC warehouse', 'CENTRAL_WAREHOUSE') RETURNING id AS w \gset f_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('RC pharmacy', 'PHARMACY') RETURNING id AS p \gset f_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('RC destination', 'BRANCH_WAREHOUSE') RETURNING id AS d \gset f_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('RC admin', 'SUPER_ADMIN', NULL) RETURNING id AS sa \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('RC warehouse manager', 'WAREHOUSE_MANAGER', :f_w) RETURNING id AS wm \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('RC pharmacy manager', 'STORE_MANAGER', :f_p) RETURNING id AS pm \gset e_
INSERT INTO public.medicines(medicine_name) VALUES ('RC medicine') RETURNING id AS id \gset med_
INSERT INTO public.packaging_variants(medicine_id, unit_name) VALUES (:med_id, 'Box') RETURNING id AS id \gset v_
INSERT INTO public.batches(batch_number, medicine_id, production_date, expiry_date, status)
  VALUES (format('RC-%s', txid_current()), :med_id, current_date - 1, current_date + 365, 'ACTIVE') RETURNING id AS id \gset batch_
INSERT INTO public.medicine_boxes(batch_id, current_facility_id, status) SELECT :batch_id, :f_w, 'IN_STOCK' FROM generate_series(1, 6);
INSERT INTO public.medicine_boxes(batch_id, current_facility_id, status) SELECT :batch_id, :f_w, 'RESERVED' FROM generate_series(1, 2);
INSERT INTO public.medicine_boxes(batch_id, current_facility_id, status) SELECT :batch_id, :f_p, 'IN_STOCK' FROM generate_series(1, 3);
INSERT INTO public.medicine_boxes(batch_id, current_facility_id, status) VALUES (:batch_id, NULL, 'DELIVERED');
INSERT INTO public.inventories(facility_id, variant_id, stock_quantity, reserved_quantity) VALUES (:f_w, :v_id, 8, 2), (:f_p, :v_id, 3, 0);
INSERT INTO public.orders(order_code, export_facility_id, order_status) VALUES (format('RC-%s', txid_current()), :f_w, 'PROCESSING') RETURNING id AS id \gset o_
INSERT INTO public.order_items(order_id, medicine_id, variant_id, quantity, inventory_reserved, assigned_uids)
  SELECT :o_id, :med_id, :v_id, 2, true, array_agg(uid) FROM public.medicine_boxes WHERE batch_id = :batch_id AND status = 'RESERVED';
SELECT set_config('test.w', :'f_w', true), set_config('test.p', :'f_p', true), set_config('test.d', :'f_d', true),
  set_config('test.sa', :'e_sa', true), set_config('test.wm', :'e_wm', true), set_config('test.pm', :'e_pm', true),
  set_config('test.none', '', true), set_config('test.variant', :'v_id', true), set_config('test.batch', :'batch_id', true);

CREATE FUNCTION pg_temp.rc_expect(expected text, statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected % but the statement succeeded: %', expected, statement;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE expected || '%' THEN RAISE; END IF;
END $$;
CREATE FUNCTION pg_temp.rc_as(role text, employee text, unit text, operation text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.current_user_type', 'employee', true), set_config('app.current_user_role', role, true),
    set_config('app.current_user_id', current_setting('test.' || employee), true),
    set_config('app.current_unit_id', current_setting('test.' || unit), true), set_config('app.order_operation', operation, true);
END $$;
CREATE FUNCTION pg_temp.rc_stock(unit text) RETURNS integer[] LANGUAGE sql AS $$
  SELECT ARRAY[i.stock_quantity, i.reserved_quantity, coalesce(q.quantity, 0)] FROM public.inventories i
  LEFT JOIN public.quarantine_balances q ON q.facility_id = i.facility_id AND q.variant_id = i.variant_id
  WHERE i.facility_id = current_setting('test.' || unit)::integer AND i.variant_id = current_setting('test.variant')::integer
$$;

SET LOCAL ROLE app_user;
DO $$
DECLARE recall integer;
BEGIN
  PERFORM pg_temp.rc_as('WAREHOUSE_MANAGER', 'wm', 'w', 'read');
  PERFORM pg_temp.rc_expect('RC_FORBIDDEN', format('SELECT public.create_batch_recall(''RC-CODE-1'', ''Contamination'', ''LEVEL_1'', NULL, ARRAY[%s])', current_setting('test.batch')));
  PERFORM pg_temp.rc_expect('permission denied', 'INSERT INTO public.batch_recalls(recall_code, reason, severity, created_by) VALUES (''RC-DIRECT'', ''x'', ''LEVEL_1'', 1)');

  PERFORM pg_temp.rc_as('SUPER_ADMIN', 'sa', 'none', 'read');
  PERFORM pg_temp.rc_expect('RC_CODE_INVALID', 'SELECT public.create_batch_recall(''bad code'', ''Contamination'', ''LEVEL_1'', NULL, ARRAY[1])');
  recall := public.create_batch_recall('RC-CODE-1', 'Contamination', 'LEVEL_1', NULL, ARRAY[current_setting('test.batch')::integer]);
  IF recall <> public.create_batch_recall('RC-CODE-1', 'Contamination', 'LEVEL_1', NULL, ARRAY[current_setting('test.batch')::integer]) THEN
    RAISE EXCEPTION 'Resending a recall code created a second recall';
  END IF;
  PERFORM pg_temp.rc_expect('RC_CODE_TAKEN', 'SELECT public.create_batch_recall(''RC-CODE-1'', ''Contamination'', ''LEVEL_1'', NULL, ARRAY[-1])');
  PERFORM pg_temp.rc_expect('RC_BATCH_RECALLED', format('SELECT public.create_batch_recall(''RC-CODE-2'', ''Again'', ''LEVEL_2'', NULL, ARRAY[%s])', current_setting('test.batch')));
  PERFORM set_config('test.recall', recall::text, true);

  IF (SELECT count(*) FROM public.batch_recall_impact(recall)) <> 12 THEN RAISE EXCEPTION 'Impact does not list every box of the batch'; END IF;
  IF (SELECT count(*) FROM public.batch_recall_impact(recall) WHERE location = 'DELIVERED') <> 1
    OR (SELECT count(*) FROM public.batch_recall_impact(recall) WHERE order_id IS NOT NULL) <> 2 THEN
    RAISE EXCEPTION 'Impact locations or order links are wrong';
  END IF;

  PERFORM pg_temp.rc_as('WAREHOUSE_MANAGER', 'wm', 'w', 'read');
  IF EXISTS (SELECT FROM public.batch_recalls) THEN RAISE EXCEPTION 'A warehouse manager read recalls directly'; END IF;
  PERFORM pg_temp.rc_expect('RC_FORBIDDEN', 'SELECT public.batch_recall_impact(' || recall || ')');
  PERFORM pg_temp.rc_expect('RC_FORBIDDEN', 'SELECT * FROM public.batch_recall_tasks(' || current_setting('test.p') || ')');
  IF (SELECT quantity FROM public.batch_recall_tasks(current_setting('test.w')::integer) WHERE kind = 'QUARANTINED_STOCK') <> 6
    OR (SELECT count(*) FROM public.batch_recall_tasks(current_setting('test.w')::integer) WHERE kind = 'ORDER_TO_RESOLVE') <> 1 THEN
    RAISE EXCEPTION 'Warehouse tasks are wrong';
  END IF;
  PERFORM pg_temp.rc_as('STORE_MANAGER', 'pm', 'p', 'read');
  IF (SELECT quantity FROM public.batch_recall_tasks(current_setting('test.p')::integer) WHERE kind = 'QUARANTINED_STOCK') <> 3 THEN
    RAISE EXCEPTION 'Pharmacy tasks are wrong';
  END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT status FROM public.batches WHERE id = current_setting('test.batch')::integer) <> 'RECALLED'
    OR EXISTS (SELECT FROM public.medicine_boxes WHERE batch_id = current_setting('test.batch')::integer AND public.box_sellable(uid, current_date)) THEN
    RAISE EXCEPTION 'The recalled batch is still sellable';
  END IF;
  IF pg_temp.rc_stock('w') <> ARRAY[2, 2, 6] OR pg_temp.rc_stock('p') <> ARRAY[0, 0, 3] THEN RAISE EXCEPTION 'Hold did not move stock into quarantine'; END IF;
  IF (SELECT count(*) FROM public.medicine_boxes WHERE batch_id = current_setting('test.batch')::integer AND status = 'RESERVED') <> 2 THEN
    RAISE EXCEPTION 'Reserved order boxes were changed';
  END IF;
  IF (SELECT count(*) FROM public.inventory_logs WHERE batch_id = current_setting('test.batch')::integer AND transaction_type = 'RECALL_HOLD') <> 4 THEN
    RAISE EXCEPTION 'Hold was not logged';
  END IF;
END $$;
SET LOCAL ROLE app_user;

-- Collection, dispatch and receipt
DO $$
DECLARE transfer integer; uids uuid[];
BEGIN
  PERFORM pg_temp.rc_as('SUPER_ADMIN', 'sa', 'none', 'read');
  PERFORM pg_temp.rc_expect('RC_DESTINATION_INVALID', format('SELECT public.collect_batch_recall(%s, %s)', current_setting('test.recall'), current_setting('test.p')));
  IF public.collect_batch_recall(current_setting('test.recall')::integer, current_setting('test.d')::integer) <> 2
    OR public.collect_batch_recall(current_setting('test.recall')::integer, current_setting('test.d')::integer) <> 0 THEN
    RAISE EXCEPTION 'Collection did not create one transfer per holding facility once';
  END IF;
  PERFORM pg_temp.rc_expect('RC_COLLECTION_OPEN', format('SELECT public.close_batch_recall(%s, ''Done'')', current_setting('test.recall')));
  SELECT t.id INTO transfer FROM public.internal_transfers t WHERE t.transfer_type = 'RECALL_COLLECTION' AND t.from_facility_id = current_setting('test.p')::integer;
  PERFORM set_config('test.transfer', transfer::text, true);

  PERFORM pg_temp.rc_as('STORE_MANAGER', 'pm', 'p', 'dispatch');
  SELECT array_agg(uid) INTO uids FROM public.medicine_boxes WHERE batch_id = current_setting('test.batch')::integer AND current_facility_id = current_setting('test.p')::integer;
  PERFORM public.prepare_dispatch_manifest(transfer,
    jsonb_build_array(jsonb_build_object('variantId', current_setting('test.variant')::integer, 'quantity', 3, 'boxUids', to_jsonb(uids))));
  UPDATE public.internal_transfers SET status = 'DISPATCHED', transport_mode = 'INTERNAL', transport_employee_id = current_setting('test.pm')::integer,
    transport_employee_name = 'RC pharmacy manager', dispatched_at = now() WHERE id = transfer;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF pg_temp.rc_stock('w') <> ARRAY[8, 8, 0] OR pg_temp.rc_stock('p') <> ARRAY[0, 0, 0] THEN RAISE EXCEPTION 'Collection or dispatch moved the wrong stock'; END IF;
  UPDATE public.medicine_boxes SET status = 'IN_STOCK', current_facility_id = current_setting('test.d')::integer
    WHERE uid IN (SELECT unnest(box_uids) FROM public.transfer_custody WHERE transfer_id = current_setting('test.transfer')::integer);
  INSERT INTO public.inventories(facility_id, variant_id, stock_quantity, reserved_quantity) VALUES (current_setting('test.d')::integer, current_setting('test.variant')::integer, 3, 0);
  PERFORM set_config('app.current_user_id', current_setting('test.sa'), true);
  UPDATE public.internal_transfers SET status = 'RECEIVED', received_at = now() WHERE id = current_setting('test.transfer')::integer;
  IF pg_temp.rc_stock('d') <> ARRAY[0, 0, 3] THEN RAISE EXCEPTION 'Received recall stock was not quarantined at the destination'; END IF;
END $$;
ROLLBACK;
