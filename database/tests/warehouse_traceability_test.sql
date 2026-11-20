\set ON_ERROR_STOP on
-- Warehouse traceability: the box timeline across the whole lifecycle in order, its warehouse scope, scan facts,
-- scan anomaly alerts (deduplicated, manager-only reads, manager resolution) and carton unpacking.
-- Run as owner on a disposable initialized database; every fixture is rolled back.
BEGIN;
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('TR warehouse A', 'CENTRAL_WAREHOUSE') RETURNING id AS a \gset f_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('TR warehouse B', 'BRANCH_WAREHOUSE') RETURNING id AS b \gset f_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('TR warehouse C', 'BRANCH_WAREHOUSE') RETURNING id AS c \gset f_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('TR staff A', 'WAREHOUSE_STAFF', :f_a) RETURNING id AS staff_a \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('TR manager A', 'WAREHOUSE_MANAGER', :f_a) RETURNING id AS manager_a \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('TR staff B', 'WAREHOUSE_STAFF', :f_b) RETURNING id AS staff_b \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('TR manager B', 'WAREHOUSE_MANAGER', :f_b) RETURNING id AS manager_b \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('TR staff C', 'WAREHOUSE_STAFF', :f_c) RETURNING id AS staff_c \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('TR admin', 'SUPER_ADMIN', NULL) RETURNING id AS admin \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('TR pharmacist A', 'PHARMACIST', :f_a) RETURNING id AS pharmacist \gset e_
INSERT INTO public.medicines(medicine_name) VALUES ('TR medicine') RETURNING id AS id \gset med_
INSERT INTO public.packaging_variants(medicine_id, unit_name) VALUES (:med_id, 'Box') RETURNING id AS id \gset v_
INSERT INTO public.batches(batch_number, medicine_id, production_date, expiry_date, status, initial_quantity, remaining_quantity)
  VALUES (format('TR-%s', txid_current()), :med_id, current_date - 60, current_date + 365, 'RECALLED', 10, 10) RETURNING id AS id \gset batch_
INSERT INTO public.medicine_boxes(batch_id, current_facility_id, status, created_at) VALUES (:batch_id, :f_a, 'DESTROYED', now() - interval '30 days') RETURNING uid AS life \gset b_
INSERT INTO public.medicine_boxes(batch_id, current_facility_id, status) VALUES (:batch_id, :f_a, 'IN_STOCK') RETURNING uid AS plain \gset b_

-- Lifecycle records of box "life", inserted out of order on purpose
INSERT INTO public.disposals(disposal_code, facility_id, status, reason, created_by_id, completed_by_id, completed_at)
  VALUES ('TR-DSP-1', :f_b, 'COMPLETED', 'Recalled stock', :e_manager_b, :e_manager_b, now() - interval '20 days') RETURNING id AS id \gset d_
INSERT INTO public.disposal_items(disposal_id, box_uid, batch_id, source) VALUES (:d_id, :'b_life', :batch_id, 'RECALL');
INSERT INTO public.disposal_events(disposal_id, action, from_status, to_status, actor_id, created_at) VALUES
  (:d_id, 'COMPLETED', 'APPROVED', 'COMPLETED', :e_manager_b, now() - interval '20 days'),
  (:d_id, 'CREATED', NULL, 'DRAFT', :e_staff_b, now() - interval '22 days'),
  (:d_id, 'ATTACHMENT_ADDED', 'DRAFT', 'DRAFT', :e_staff_b, now() - interval '21 days'),
  (:d_id, 'APPROVED', 'DRAFT', 'APPROVED', :e_manager_b, now() - interval '21 days' + interval '1 hour');
INSERT INTO public.batch_recalls(recall_code, reason, severity, created_by) VALUES ('TR-RCL-1', 'Contamination', 'LEVEL_1', :e_admin) RETURNING id AS id \gset r_
INSERT INTO public.batch_recall_events(recall_id, action, facility_id, batch_id, box_uids, actor_id, created_at)
  VALUES (:r_id, 'COLLECT', :f_b, :batch_id, ARRAY[:'b_life']::uuid[], :e_staff_b, now() - interval '23 days');
INSERT INTO public.orders(order_code, export_facility_id, order_status) VALUES (format('TR-1-%s', txid_current()), :f_b, 'PROCESSING') RETURNING id AS id \gset o_
INSERT INTO public.order_items(order_id, medicine_id, variant_id, quantity) VALUES (:o_id, :med_id, :v_id, 1) RETURNING id AS id \gset i_
INSERT INTO public.shipments(order_id, tracking_number, courier_name) VALUES (:o_id, format('TR-T-%s', txid_current()), 'GHN') RETURNING id AS id \gset s_
INSERT INTO public.shipment_return_items(shipment_id, variant_id, quantity, box_uids, received_by, received_at)
  VALUES (:s_id, :v_id, 1, ARRAY[:'b_life']::uuid[], :e_staff_b, now() - interval '24 days');
INSERT INTO public.order_packages(package_code, order_id, facility_id, packed_by_id, packed_at) VALUES ('TR-PKG-1', :o_id, :f_b, :e_staff_b, now() - interval '26 days') RETURNING id AS id \gset p_
INSERT INTO public.order_package_items(package_id, order_item_id, box_uid) VALUES (:p_id, :i_id, :'b_life');
INSERT INTO public.carrier_handovers(handover_code, facility_id, courier_name, handed_over_by_id, handed_over_at)
  VALUES ('TR-HV-1', :f_b, 'GHN', :e_staff_b, now() - interval '25 days') RETURNING id AS id \gset h_
INSERT INTO public.carrier_handover_packages(handover_id, package_id) VALUES (:h_id, :p_id);
INSERT INTO public.internal_transfers(transfer_code, order_id, transfer_type, from_facility_id, to_facility_id, status)
  VALUES ('TR-TRF-1', NULL, 'REPLENISHMENT', :f_a, :f_b, 'RECEIVED') RETURNING id AS id \gset t_
INSERT INTO public.transfer_custody(transfer_id, variant_id, quantity, outstanding, box_uids, handed_over_at, received_at)
  VALUES (:t_id, :v_id, 1, 0, ARRAY[:'b_life']::uuid[], now() - interval '28 days', now() - interval '27 days');
INSERT INTO public.sscc_cartons(sscc_code, batch_id, current_facility_id, status, box_count) VALUES ('TR-SSCC-LIFE', :batch_id, :f_a, 'UNPACKED', 1) RETURNING id AS id \gset c_
UPDATE public.medicine_boxes SET carton_id = :c_id WHERE uid = :'b_life';
INSERT INTO public.carton_events(carton_id, action, facility_id, actor_id, created_at) VALUES (:c_id, 'UNPACKED', :f_a, :e_staff_a, now() - interval '29 days' + interval '12 hours');
INSERT INTO public.purchase_orders(po_code, supplier_id, facility_id, status) VALUES ('TR-PO-1', :f_c, :f_a, 'RECEIVED') RETURNING id AS id \gset po_
INSERT INTO public.purchase_order_items(po_id, medicine_id, variant_id, quantity, unit_price, received_quantity) VALUES (:po_id, :med_id, :v_id, 1, 1, 1) RETURNING id AS id \gset poi_
INSERT INTO public.goods_receipts(receipt_code, po_id, facility_id, received_by_id, received_at) VALUES ('TR-GR-1', :po_id, :f_a, :e_staff_a, now() - interval '29 days') RETURNING id AS id \gset gr_
INSERT INTO public.goods_receipt_lines(receipt_id, po_item_id, batch_id, quantity_accepted, quantity_rejected, box_uids)
  VALUES (:gr_id, :poi_id, :batch_id, 1, 0, ARRAY[:'b_life']::uuid[]);
INSERT INTO public.qr_scan_logs(uid, scan_result, scanned_at) VALUES (:'b_life', 'VALID', now() - interval '10 days');

-- Cartons for the unpack checks
INSERT INTO public.sscc_cartons(sscc_code, batch_id, current_facility_id, status, box_count) VALUES ('TR-SSCC-OK', :batch_id, :f_a, 'PACKAGED', 2) RETURNING id AS id \gset k_ok_
INSERT INTO public.medicine_boxes(batch_id, carton_id, current_facility_id, status) SELECT :batch_id, :k_ok_id, :f_a, 'IN_STOCK' FROM generate_series(1, 2);
INSERT INTO public.sscc_cartons(sscc_code, batch_id, current_facility_id, status, box_count) VALUES ('TR-SSCC-SPLIT', :batch_id, :f_a, 'PACKAGED', 2) RETURNING id AS id \gset k_split_
INSERT INTO public.medicine_boxes(batch_id, carton_id, current_facility_id, status) VALUES (:batch_id, :k_split_id, :f_a, 'IN_STOCK'), (:batch_id, :k_split_id, :f_b, 'IN_STOCK');
INSERT INTO public.sscc_cartons(sscc_code, batch_id, current_facility_id, status, box_count) VALUES ('TR-SSCC-SHIPPED', :batch_id, :f_a, 'SHIPPED', 1);

SELECT set_config('test.a', :'f_a', true), set_config('test.b', :'f_b', true), set_config('test.c', :'f_c', true),
  set_config('test.none', '', true), set_config('test.life', :'b_life', true), set_config('test.plain', :'b_plain', true),
  set_config('test.staff_a', :'e_staff_a', true), set_config('test.manager_a', :'e_manager_a', true),
  set_config('test.staff_b', :'e_staff_b', true), set_config('test.manager_b', :'e_manager_b', true),
  set_config('test.staff_c', :'e_staff_c', true), set_config('test.admin', :'e_admin', true), set_config('test.pharmacist', :'e_pharmacist', true);

CREATE FUNCTION pg_temp.tr_expect(expected text, statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected % but the statement succeeded: %', expected, statement;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE expected || '%' THEN RAISE; END IF;
END $$;
CREATE FUNCTION pg_temp.tr_as(role text, employee text, unit text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.current_user_type', 'employee', true), set_config('app.current_user_role', role, true),
    set_config('app.current_user_id', current_setting('test.' || employee), true), set_config('app.current_unit_id', current_setting('test.' || unit), true);
END $$;

SET LOCAL ROLE app_user;

-- Scan facts: known box, unknown box, wrong role
DO $$
DECLARE facts record;
BEGIN
  PERFORM pg_temp.tr_as('WAREHOUSE_STAFF', 'staff_b', 'b');
  SELECT * INTO facts FROM public.scan_box_facts(current_setting('test.plain')::uuid);
  IF facts.uid IS NULL OR facts.status <> 'IN_STOCK' OR facts.facility_id <> current_setting('test.a')::integer OR facts.batch_status <> 'RECALLED' THEN
    RAISE EXCEPTION 'Scan facts of a box at another warehouse are wrong';
  END IF;
  IF EXISTS (SELECT FROM public.scan_box_facts('00000000-0000-4000-8000-000000000001')) THEN RAISE EXCEPTION 'An unknown uid returned facts'; END IF;
  PERFORM pg_temp.tr_as('PHARMACIST', 'pharmacist', 'a');
  IF EXISTS (SELECT FROM public.scan_box_facts(current_setting('test.plain')::uuid)) THEN RAISE EXCEPTION 'A pharmacist read scan facts'; END IF;
END $$;

-- Anomaly alerts: no direct writes, deduplicated, reasons validated, manager-only reads
DO $$
DECLARE unknown uuid := '00000000-0000-4000-8000-000000000002';
BEGIN
  PERFORM pg_temp.tr_as('WAREHOUSE_STAFF', 'staff_a', 'a');
  PERFORM pg_temp.tr_expect('permission denied', 'INSERT INTO public.fraud_alerts(fraud_type) VALUES (''X'')');
  PERFORM pg_temp.tr_expect('TR_REASON_INVALID', format('SELECT public.record_scan_anomaly(%L, ARRAY[''NOPE''])', current_setting('test.plain')));
  PERFORM pg_temp.tr_expect('TR_REASON_INVALID', format('SELECT public.record_scan_anomaly(%L, ARRAY[]::text[])', current_setting('test.plain')));
  PERFORM public.record_scan_anomaly(current_setting('test.plain')::uuid, ARRAY['SIGNATURE_MISMATCH']);
  PERFORM public.record_scan_anomaly(current_setting('test.plain')::uuid, ARRAY['SIGNATURE_MISMATCH']);
  PERFORM public.record_scan_anomaly(unknown, ARRAY['UNKNOWN_UID']);
  IF (SELECT count(*) FROM public.fraud_alerts) <> 0 THEN RAISE EXCEPTION 'Warehouse staff read fraud alerts'; END IF;
  PERFORM pg_temp.tr_as('PHARMACIST', 'pharmacist', 'a');
  PERFORM pg_temp.tr_expect('TR_FORBIDDEN', format('SELECT public.record_scan_anomaly(%L, ARRAY[''UNKNOWN_UID''])', unknown));
  PERFORM pg_temp.tr_as('WAREHOUSE_MANAGER', 'manager_a', 'a');
  IF (SELECT count(*) FROM public.fraud_alerts) <> 2 THEN RAISE EXCEPTION 'Repeated scans opened duplicate alerts or the manager cannot read them'; END IF;
  IF NOT EXISTS (SELECT FROM public.fraud_alerts WHERE uid IS NULL AND scanned_code = unknown::text AND fraud_type = 'UNKNOWN_UID' AND facility_id = current_setting('test.a')::integer) THEN
    RAISE EXCEPTION 'The unknown uid alert was not recorded';
  END IF;
  IF NOT EXISTS (SELECT FROM public.fraud_alerts WHERE uid = current_setting('test.plain')::uuid AND facility_id = current_setting('test.a')::integer
    AND reported_by_id = current_setting('test.staff_a')::integer) THEN RAISE EXCEPTION 'The signature alert has no warehouse or reporter'; END IF;
END $$;

-- Alert scope and resolution
DO $$
DECLARE alert integer;
BEGIN
  PERFORM pg_temp.tr_as('WAREHOUSE_MANAGER', 'manager_a', 'a');
  SELECT id INTO alert FROM public.fraud_alerts WHERE uid = current_setting('test.plain')::uuid;
  PERFORM pg_temp.tr_as('WAREHOUSE_MANAGER', 'manager_b', 'b');
  IF (SELECT count(*) FROM public.fraud_alerts) <> 0 THEN RAISE EXCEPTION 'Warehouse B reads alerts of warehouse A'; END IF;
  PERFORM pg_temp.tr_expect('TR_ALERT_NOT_FOUND', format('SELECT public.resolve_fraud_alert(%s, ''Checked'')', alert));
  PERFORM pg_temp.tr_as('WAREHOUSE_STAFF', 'staff_a', 'a');
  PERFORM pg_temp.tr_expect('TR_FORBIDDEN', format('SELECT public.resolve_fraud_alert(%s, ''Checked'')', alert));
  PERFORM pg_temp.tr_as('WAREHOUSE_MANAGER', 'manager_a', 'a');
  PERFORM pg_temp.tr_expect('TR_NOTE_REQUIRED', format('SELECT public.resolve_fraud_alert(%s, '' '')', alert));
  PERFORM pg_temp.tr_expect('TR_ALERT_NOT_FOUND', 'SELECT public.resolve_fraud_alert(-1, ''Checked'')');
  PERFORM public.resolve_fraud_alert(alert, 'Box compared with the label, printing fault');
  PERFORM public.resolve_fraud_alert(alert, 'Second call changes nothing');
  IF (SELECT resolution_note FROM public.fraud_alerts WHERE id = alert) <> 'Box compared with the label, printing fault'
    OR (SELECT resolved_by_id FROM public.fraud_alerts WHERE id = alert) <> current_setting('test.manager_a')::integer THEN
    RAISE EXCEPTION 'Resolving twice changed the first resolution';
  END IF;
  PERFORM public.record_scan_anomaly(current_setting('test.life')::uuid, ARRAY['BOX_STATUS_UNEXPECTED']);
  PERFORM public.resolve_fraud_alert((SELECT id FROM public.fraud_alerts WHERE uid = current_setting('test.life')::uuid), 'Destroyed box found on the shelf, investigated');
END $$;

-- The timeline of a box that went through the whole lifecycle is in order
DO $$
DECLARE actual text; expected text := 'CREATED,RECEIVED,CARTON_UNPACKED,TRANSFER_DISPATCHED,TRANSFER_RECEIVED,PACKED,HANDED_OVER,RETURNED,RECALL_COLLECT,DISPOSAL_CREATED,DISPOSAL_APPROVED,DESTROYED,PUBLIC_SCAN,FRAUD_ALERT,FRAUD_ALERT_RESOLVED';
BEGIN
  PERFORM pg_temp.tr_as('WAREHOUSE_STAFF', 'staff_a', 'a');
  SELECT string_agg(event_type, ',' ORDER BY ordinality) INTO actual FROM public.box_history(current_setting('test.life')::uuid) WITH ORDINALITY;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Timeline order is wrong: %', actual; END IF;
  IF (SELECT reference FROM public.box_history(current_setting('test.life')::uuid) WHERE event_type = 'DESTROYED') <> 'TR-DSP-1'
    OR (SELECT detail FROM public.box_history(current_setting('test.life')::uuid) WHERE event_type = 'TRANSFER_RECEIVED') <> 'RECEIVED' THEN
    RAISE EXCEPTION 'Timeline references are wrong';
  END IF;
END $$;

-- Timeline scope: current or past warehouses and the admin see it; others, other roles and unknown boxes get nothing
DO $$
BEGIN
  PERFORM pg_temp.tr_as('WAREHOUSE_MANAGER', 'manager_b', 'b');
  IF (SELECT count(*) FROM public.box_history(current_setting('test.life')::uuid)) <> 15 THEN RAISE EXCEPTION 'A warehouse in the box history cannot read it'; END IF;
  PERFORM pg_temp.tr_as('WAREHOUSE_STAFF', 'staff_c', 'c');
  IF EXISTS (SELECT FROM public.box_history(current_setting('test.life')::uuid)) THEN RAISE EXCEPTION 'A warehouse outside the box history read it'; END IF;
  PERFORM pg_temp.tr_as('PHARMACIST', 'pharmacist', 'a');
  IF EXISTS (SELECT FROM public.box_history(current_setting('test.life')::uuid)) THEN RAISE EXCEPTION 'A pharmacist read a box history'; END IF;
  PERFORM pg_temp.tr_as('SUPER_ADMIN', 'admin', 'none');
  IF (SELECT count(*) FROM public.box_history(current_setting('test.life')::uuid)) <> 15 THEN RAISE EXCEPTION 'The admin cannot read a box history'; END IF;
  IF EXISTS (SELECT FROM public.box_history('00000000-0000-4000-8000-000000000003')) THEN RAISE EXCEPTION 'An unknown box has a history'; END IF;
END $$;

-- Cartons: scope, overview, unpack rules and idempotence
DO $$
BEGIN
  PERFORM pg_temp.tr_as('WAREHOUSE_STAFF', 'staff_a', 'a');
  IF (SELECT count(*) FROM public.carton_overview('TR-SSCC-OK') WHERE box_uid IS NOT NULL) <> 2 THEN RAISE EXCEPTION 'The carton overview misses boxes'; END IF;
  PERFORM pg_temp.tr_as('WAREHOUSE_STAFF', 'staff_b', 'b');
  IF EXISTS (SELECT FROM public.carton_overview('TR-SSCC-OK')) THEN RAISE EXCEPTION 'Warehouse B sees a carton of warehouse A'; END IF;
  PERFORM pg_temp.tr_expect('TR_CARTON_NOT_FOUND', 'SELECT public.unpack_carton(''TR-SSCC-OK'')');
  PERFORM pg_temp.tr_expect('TR_CARTON_NOT_FOUND', 'SELECT public.unpack_carton(''TR-SSCC-NONE'')');
  PERFORM pg_temp.tr_as('PHARMACIST', 'pharmacist', 'a');
  PERFORM pg_temp.tr_expect('TR_FORBIDDEN', 'SELECT public.unpack_carton(''TR-SSCC-OK'')');
  PERFORM pg_temp.tr_as('WAREHOUSE_STAFF', 'staff_a', 'a');
  PERFORM pg_temp.tr_expect('TR_CARTON_NOT_UNPACKABLE', 'SELECT public.unpack_carton(''TR-SSCC-SHIPPED'')');
  PERFORM pg_temp.tr_expect('TR_CARTON_INCOMPLETE', 'SELECT public.unpack_carton(''TR-SSCC-SPLIT'')');
  PERFORM public.unpack_carton('TR-SSCC-OK');
  PERFORM public.unpack_carton('TR-SSCC-OK');
  IF (SELECT status FROM public.carton_overview('TR-SSCC-OK') LIMIT 1) <> 'UNPACKED' THEN RAISE EXCEPTION 'The carton was not unpacked'; END IF;
  IF (SELECT count(*) FROM public.carton_events WHERE carton_id = (SELECT carton_id FROM public.carton_overview('TR-SSCC-OK') LIMIT 1)) <> 1 THEN
    RAISE EXCEPTION 'Unpacking twice recorded two events';
  END IF;
  IF (SELECT count(*) FROM public.carton_overview('TR-SSCC-OK') WHERE box_uid IS NOT NULL) <> 2 THEN RAISE EXCEPTION 'Unpacking detached the boxes'; END IF;
END $$;
ROLLBACK;
