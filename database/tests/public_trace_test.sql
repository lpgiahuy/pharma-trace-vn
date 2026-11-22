\set ON_ERROR_STOP on
-- Public trace: consumer-safe box summary and timeline, scan logging with impossible travel and excessive rescan
-- alerts, input validation and the admin-only radar counters.
-- Run as owner on a disposable initialized database; every fixture is rolled back.
BEGIN;
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('PT warehouse A', 'CENTRAL_WAREHOUSE') RETURNING id AS a \gset f_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('PT warehouse B', 'BRANCH_WAREHOUSE') RETURNING id AS b \gset f_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('PT admin', 'SUPER_ADMIN', NULL) RETURNING id AS admin \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('PT manager', 'WAREHOUSE_MANAGER', :f_a) RETURNING id AS manager \gset e_
INSERT INTO public.medicines(medicine_name, manufacturer) VALUES ('PT medicine', 'PT Pharma') RETURNING id AS id \gset med_
INSERT INTO public.batches(batch_number, medicine_id, production_date, expiry_date, status, initial_quantity, remaining_quantity)
  VALUES (format('PT-%s', txid_current()), :med_id, current_date - 60, current_date + 365, 'ACTIVE', 10, 10) RETURNING id AS id \gset batch_
INSERT INTO public.medicine_boxes(batch_id, current_facility_id, status, created_at) VALUES (:batch_id, :f_a, 'IN_STOCK', now() - interval '3 days') RETURNING uid AS far \gset b_
INSERT INTO public.medicine_boxes(batch_id, current_facility_id, status) VALUES (:batch_id, :f_a, 'IN_STOCK') RETURNING uid AS slow \gset b_
INSERT INTO public.medicine_boxes(batch_id, current_facility_id, status) VALUES (:batch_id, :f_a, 'IN_STOCK') RETURNING uid AS busy \gset b_
INSERT INTO public.medicine_boxes(batch_id, current_facility_id, status) VALUES (:batch_id, :f_a, 'IN_STOCK') RETURNING uid AS entry \gset b_
INSERT INTO public.packaging_variants(medicine_id, unit_name) VALUES (:med_id, 'Box') RETURNING id AS id \gset v_
INSERT INTO public.internal_transfers(transfer_code, order_id, transfer_type, from_facility_id, to_facility_id, status)
  VALUES ('PT-TRF-1', NULL, 'REPLENISHMENT', :f_a, :f_b, 'RECEIVED') RETURNING id AS id \gset t_
INSERT INTO public.transfer_custody(transfer_id, variant_id, quantity, outstanding, box_uids, handed_over_at, received_at)
  VALUES (:t_id, :v_id, 1, 0, ARRAY[:'b_far']::uuid[], now() - interval '2 days', now() - interval '1 day');
INSERT INTO public.orders(order_code, export_facility_id, order_status) VALUES (format('PT-1-%s', txid_current()), :f_b, 'PROCESSING') RETURNING id AS id \gset o_
INSERT INTO public.order_items(order_id, medicine_id, variant_id, quantity) VALUES (:o_id, :med_id, :v_id, 1) RETURNING id AS id \gset i_
INSERT INTO public.shipments(order_id, tracking_number, courier_name, actual_delivery_at)
  VALUES (:o_id, format('PT-T-%s', txid_current()), 'GHN', now() - interval '4 hours');
INSERT INTO public.order_packages(package_code, order_id, facility_id, packed_by_id, packed_at)
  VALUES ('PT-PKG-1', :o_id, :f_b, :e_manager, now() - interval '20 hours') RETURNING id AS id \gset p_
INSERT INTO public.order_package_items(package_id, order_item_id, box_uid) VALUES (:p_id, :i_id, :'b_far');
INSERT INTO public.carrier_handovers(handover_code, facility_id, courier_name, handed_over_by_id, handed_over_at)
  VALUES ('PT-HV-1', :f_b, 'GHN', :e_manager, now() - interval '10 hours') RETURNING id AS id \gset h_
INSERT INTO public.carrier_handover_packages(handover_id, package_id) VALUES (:h_id, :p_id);

SELECT set_config('test.far', :'b_far', true), set_config('test.slow', :'b_slow', true), set_config('test.busy', :'b_busy', true), set_config('test.entry', :'b_entry', true),
  set_config('test.admin', :'e_admin', true), set_config('test.manager', :'e_manager', true);

CREATE FUNCTION pg_temp.pt_expect(expected text, statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected % but the statement succeeded: %', expected, statement;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE expected || '%' THEN RAISE; END IF;
END $$;
CREATE FUNCTION pg_temp.pt_as(role text, employee text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.current_user_type', CASE WHEN role = '' THEN '' ELSE 'employee' END, true), set_config('app.current_user_role', role, true),
    set_config('app.current_user_id', CASE WHEN employee = '' THEN '' ELSE current_setting('test.' || employee) END, true), set_config('app.current_unit_id', '', true);
END $$;

SET LOCAL ROLE app_user;

-- Summary and timeline are public and expose nothing for an unknown box
DO $$
DECLARE trace record;
BEGIN
  PERFORM pg_temp.pt_as('', '');
  SELECT * INTO trace FROM public.public_box_trace(current_setting('test.far')::uuid);
  IF trace.medicine_name <> 'PT medicine' OR trace.manufacturer <> 'PT Pharma' OR trace.batch_status <> 'ACTIVE' OR trace.box_status <> 'IN_STOCK'
    OR trace.activated_at IS NOT NULL OR trace.verify_count <> 0 THEN
    RAISE EXCEPTION 'The public summary is wrong';
  END IF;
  IF EXISTS (SELECT FROM public.public_box_trace('00000000-0000-4000-8000-000000000001')) THEN RAISE EXCEPTION 'An unknown uid returned a summary'; END IF;
  IF (SELECT string_agg(event_type, ',' ORDER BY occurred_at) FROM public.public_box_timeline(current_setting('test.far')::uuid))
    <> 'MANUFACTURED,TRANSFER_DISPATCHED,TRANSFER_RECEIVED,PACKED,HANDED_OVER,DELIVERED' THEN
    RAISE EXCEPTION 'The public timeline is wrong';
  END IF;
  IF (SELECT string_agg(coalesce(facility_name, '-'), ',' ORDER BY occurred_at) FROM public.public_box_timeline(current_setting('test.far')::uuid))
    <> '-,PT warehouse A,PT warehouse B,PT warehouse B,PT warehouse B,-' THEN
    RAISE EXCEPTION 'The timeline events have the wrong warehouses';
  END IF;
  IF EXISTS (SELECT FROM public.public_box_timeline('00000000-0000-4000-8000-000000000001')) THEN RAISE EXCEPTION 'An unknown uid returned a timeline'; END IF;
END $$;

-- Input validation
DO $$
BEGIN
  PERFORM pg_temp.pt_as('', '');
  PERFORM pg_temp.pt_expect('TR_LOCATION_INVALID', format('SELECT * FROM public.record_public_scan(%L, 21.0, NULL, NULL, NULL)', current_setting('test.far')));
  PERFORM pg_temp.pt_expect('TR_LOCATION_INVALID', format('SELECT * FROM public.record_public_scan(%L, 91, 105, NULL, NULL)', current_setting('test.far')));
  PERFORM pg_temp.pt_expect('TR_LOCATION_INVALID', format('SELECT * FROM public.record_public_scan(%L, 21, 181, NULL, NULL)', current_setting('test.far')));
  PERFORM pg_temp.pt_expect('TR_BOX_NOT_FOUND', 'SELECT * FROM public.record_public_scan(''00000000-0000-4000-8000-000000000001'', NULL, NULL, NULL, NULL)');
  PERFORM pg_temp.pt_expect('permission denied', 'INSERT INTO public.fraud_alerts(fraud_type) VALUES (''X'')');
END $$;

-- Activation: an invalid entry changes nothing, the first valid entry activates, later ones only count
DO $$
DECLARE entry record; first_time timestamptz;
BEGIN
  PERFORM pg_temp.pt_as('', '');
  PERFORM pg_temp.pt_expect('permission denied', 'SELECT * FROM public.box_activations');
  PERFORM pg_temp.pt_expect('permission denied', 'SELECT * FROM public.box_code_entries');
  PERFORM pg_temp.pt_expect('TR_BOX_NOT_FOUND', 'SELECT * FROM public.record_box_verification(''00000000-0000-4000-8000-000000000001'', true, ''dev-a'')');
  SELECT * INTO entry FROM public.record_box_verification(current_setting('test.slow')::uuid, false, 'dev-a');
  IF entry.first_activation OR entry.activated_at IS NOT NULL OR entry.verify_count <> 0 THEN RAISE EXCEPTION 'An invalid entry activated the box'; END IF;
  SELECT * INTO entry FROM public.record_box_verification(current_setting('test.slow')::uuid, true, 'dev-a');
  IF NOT entry.first_activation OR entry.activated_at IS NULL OR entry.verify_count <> 1 THEN RAISE EXCEPTION 'The first valid entry did not activate'; END IF;
  first_time := entry.activated_at;
  SELECT * INTO entry FROM public.record_box_verification(current_setting('test.slow')::uuid, true, 'dev-a');
  IF entry.first_activation OR entry.activated_at <> first_time OR entry.verify_count <> 2 THEN RAISE EXCEPTION 'A second valid entry changed the activation'; END IF;
  SELECT * INTO entry FROM public.record_box_verification(current_setting('test.slow')::uuid, false, 'dev-a');
  IF entry.first_activation OR entry.activated_at <> first_time OR entry.verify_count <> 2 THEN RAISE EXCEPTION 'An invalid entry changed the activation'; END IF;
  IF (SELECT activated_at FROM public.public_box_trace(current_setting('test.slow')::uuid)) <> first_time
    OR (SELECT verify_count FROM public.public_box_trace(current_setting('test.slow')::uuid)) <> 2 THEN
    RAISE EXCEPTION 'The public summary hides the activation or its entry count';
  END IF;
  IF (SELECT activated_at FROM public.public_box_trace(current_setting('test.far')::uuid)) IS NOT NULL THEN RAISE EXCEPTION 'Another box was activated'; END IF;
  IF (SELECT count(*) FROM public.public_box_timeline(current_setting('test.slow')::uuid) WHERE event_type = 'CODE_ACTIVATED' AND occurred_at = first_time) <> 1 THEN
    RAISE EXCEPTION 'The activation is not on the timeline';
  END IF;
  IF EXISTS (SELECT FROM public.public_box_timeline(current_setting('test.far')::uuid) WHERE event_type = 'CODE_ACTIVATED') THEN
    RAISE EXCEPTION 'Another box has an activation on its timeline';
  END IF;
END $$;

-- Radar counters need a super administrator
DO $$
BEGIN
  PERFORM pg_temp.pt_as('', '');
  PERFORM pg_temp.pt_expect('TR_FORBIDDEN', 'SELECT * FROM public.fraud_scan_stats()');
  PERFORM pg_temp.pt_as('WAREHOUSE_MANAGER', 'manager');
  PERFORM pg_temp.pt_expect('TR_FORBIDDEN', 'SELECT * FROM public.fraud_scan_stats()');
  PERFORM pg_temp.pt_as('SUPER_ADMIN', 'admin');
  PERFORM set_config('test.base_scans', (SELECT scans_24h FROM public.fraud_scan_stats())::text, true);
  PERFORM set_config('test.base_suspicious', (SELECT suspicious_24h FROM public.fraud_scan_stats())::text, true);
END $$;

-- Impossible travel flags the box and every later scan until an administrator resolves the alert
DO $$
DECLARE scan record; alert record;
BEGIN
  PERFORM pg_temp.pt_as('', '');
  SELECT * INTO scan FROM public.record_public_scan(current_setting('test.far')::uuid, 21.0285, 105.8542, '1.2.3.4', 'agent');
  IF scan.scan_result <> 'VALID' OR cardinality(scan.reasons) <> 0 THEN RAISE EXCEPTION 'A first scan was flagged'; END IF;
  IF (SELECT flagged FROM public.public_box_trace(current_setting('test.far')::uuid)) THEN RAISE EXCEPTION 'A box with one scan is flagged'; END IF;
  SELECT * INTO scan FROM public.record_public_scan(current_setting('test.far')::uuid, 10.8231, 106.6297, '1.2.3.4', 'agent');
  IF scan.scan_result <> 'FLAGGED' OR scan.reasons <> ARRAY['IMPOSSIBLE_TRAVEL'] THEN RAISE EXCEPTION 'The jump was not flagged'; END IF;
  IF NOT (SELECT flagged FROM public.public_box_trace(current_setting('test.far')::uuid)) THEN RAISE EXCEPTION 'The summary does not show the flag'; END IF;
  SELECT * INTO scan FROM public.record_public_scan(current_setting('test.far')::uuid, 21.0285, 105.8542, '1.2.3.4', 'agent');
  IF scan.scan_result <> 'FLAGGED' OR scan.reasons <> ARRAY['IMPOSSIBLE_TRAVEL'] THEN RAISE EXCEPTION 'The jump back was not flagged'; END IF;
  IF (SELECT count(*) FROM public.qr_scan_logs WHERE uid = current_setting('test.far')::uuid AND ip_address = '1.2.3.4' AND user_agent = 'agent') <> 3 THEN
    RAISE EXCEPTION 'The scans were not logged';
  END IF;
  PERFORM pg_temp.pt_as('', '');
  IF (SELECT count(*) FROM public.fraud_alerts) <> 0 THEN RAISE EXCEPTION 'The public read fraud alerts'; END IF;
  PERFORM pg_temp.pt_as('SUPER_ADMIN', 'admin');
  SELECT * INTO alert FROM public.fraud_alerts WHERE uid = current_setting('test.far')::uuid AND fraud_type = 'IMPOSSIBLE_TRAVEL';
  IF (SELECT count(*) FROM public.fraud_alerts WHERE uid = current_setting('test.far')::uuid) <> 1 THEN RAISE EXCEPTION 'The alert was duplicated'; END IF;
  IF alert.severity_level <> 'CRITICAL' OR alert.distance_km NOT BETWEEN 1100 AND 1200 OR alert.calculated_speed_kmh <= 1000
    OR alert.latitude_1 <> 21.0285 OR alert.longitude_2 <> 106.6297 OR alert.scanned_code <> current_setting('test.far') THEN
    RAISE EXCEPTION 'The alert details are wrong: %', alert;
  END IF;
  PERFORM public.resolve_fraud_alert(alert.id, 'Checked with the distributor');
  PERFORM pg_temp.pt_as('', '');
  IF (SELECT flagged FROM public.public_box_trace(current_setting('test.far')::uuid)) THEN RAISE EXCEPTION 'Resolving the alert did not clear the flag'; END IF;
  SELECT * INTO scan FROM public.record_public_scan(current_setting('test.far')::uuid, 21.0285, 105.8542, '1.2.3.4', 'agent');
  IF scan.scan_result <> 'VALID' THEN RAISE EXCEPTION 'A scan after the resolution was flagged'; END IF;
END $$;

-- Plausible travel: the same jump three hours later is fine
DO $$
DECLARE scan record;
BEGIN
  PERFORM pg_temp.pt_as('', '');
  PERFORM public.record_public_scan(current_setting('test.slow')::uuid, 21.0285, 105.8542, NULL, NULL);
  UPDATE public.qr_scan_logs SET scanned_at = scanned_at - interval '3 hours' WHERE uid = current_setting('test.slow')::uuid;
  SELECT * INTO scan FROM public.record_public_scan(current_setting('test.slow')::uuid, 10.8231, 106.6297, NULL, NULL);
  IF scan.scan_result <> 'VALID' THEN RAISE EXCEPTION 'A plausible trip was flagged'; END IF;
END $$;

-- Excessive scans: the tenth scan within a minute flags the box, without coordinates
DO $$
DECLARE scan record; i integer;
BEGIN
  PERFORM pg_temp.pt_as('', '');
  FOR i IN 1..9 LOOP
    SELECT * INTO scan FROM public.record_public_scan(current_setting('test.busy')::uuid, NULL, NULL, NULL, NULL);
    IF scan.scan_result <> 'VALID' THEN RAISE EXCEPTION 'Scan % was flagged', i; END IF;
  END LOOP;
  SELECT * INTO scan FROM public.record_public_scan(current_setting('test.busy')::uuid, NULL, NULL, NULL, NULL);
  IF scan.scan_result <> 'FLAGGED' OR scan.reasons <> ARRAY['EXCESSIVE_SCANS'] THEN RAISE EXCEPTION 'The tenth scan was not flagged'; END IF;
  PERFORM pg_temp.pt_as('SUPER_ADMIN', 'admin');
  IF (SELECT severity_level FROM public.fraud_alerts WHERE uid = current_setting('test.busy')::uuid AND fraud_type = 'EXCESSIVE_SCANS') <> 'CRITICAL' THEN
    RAISE EXCEPTION 'The excessive scan alert is missing';
  END IF;
END $$;

-- A code entered from a second device and wrong entries raise a WARNING for the administrator but never flag the box
DO $$
DECLARE scan record; entry record; i integer;
BEGIN
  PERFORM pg_temp.pt_as('', '');
  SELECT * INTO entry FROM public.record_box_verification(current_setting('test.slow')::uuid, true, 'dev-b');
  IF entry.flagged THEN RAISE EXCEPTION 'A second device flagged the box'; END IF;
  SELECT * INTO scan FROM public.record_public_scan(current_setting('test.slow')::uuid, NULL, NULL, NULL, NULL);
  IF scan.scan_result <> 'VALID' THEN RAISE EXCEPTION 'A second device made the scan fail'; END IF;

  FOR i IN 1..4 LOOP PERFORM public.record_box_verification(current_setting('test.entry')::uuid, false, 'dev-c'); END LOOP;
  PERFORM pg_temp.pt_as('SUPER_ADMIN', 'admin');
  IF EXISTS (SELECT FROM public.fraud_alerts WHERE uid = current_setting('test.entry')::uuid) THEN RAISE EXCEPTION 'Four wrong entries opened an alert'; END IF;
  PERFORM pg_temp.pt_as('', '');
  SELECT * INTO entry FROM public.record_box_verification(current_setting('test.entry')::uuid, false, 'dev-c');
  IF entry.flagged THEN RAISE EXCEPTION 'Wrong entries flagged the box'; END IF;

  PERFORM pg_temp.pt_as('SUPER_ADMIN', 'admin');
  IF (SELECT severity_level FROM public.fraud_alerts WHERE uid = current_setting('test.slow')::uuid AND fraud_type = 'CODE_REUSED') <> 'WARNING'
    OR (SELECT severity_level FROM public.fraud_alerts WHERE uid = current_setting('test.entry')::uuid AND fraud_type = 'CODE_GUESSING') <> 'WARNING' THEN
    RAISE EXCEPTION 'The code alerts are missing or have the wrong severity';
  END IF;
END $$;

-- Code burst: the tenth valid entry within a minute flags the box
DO $$
DECLARE entry record; i integer;
BEGIN
  PERFORM pg_temp.pt_as('', '');
  FOR i IN 1..9 LOOP
    SELECT * INTO entry FROM public.record_box_verification(current_setting('test.entry')::uuid, true, 'dev-a');
    IF entry.flagged THEN RAISE EXCEPTION 'Entry % flagged the box', i; END IF;
  END LOOP;
  SELECT * INTO entry FROM public.record_box_verification(current_setting('test.entry')::uuid, true, 'dev-a');
  IF NOT entry.flagged THEN RAISE EXCEPTION 'The tenth entry did not flag the box'; END IF;
  IF NOT (SELECT flagged FROM public.public_box_trace(current_setting('test.entry')::uuid)) THEN RAISE EXCEPTION 'The summary does not show the burst flag'; END IF;
  PERFORM pg_temp.pt_as('SUPER_ADMIN', 'admin');
  IF (SELECT severity_level FROM public.fraud_alerts WHERE uid = current_setting('test.entry')::uuid AND fraud_type = 'CODE_BURST') <> 'CRITICAL' THEN
    RAISE EXCEPTION 'The burst alert is missing';
  END IF;
END $$;

-- Radar counters: 4 + 3 + 10 scans were added and 3 of them (2 jumps and the tenth rescan) were flagged
DO $$
BEGIN
  PERFORM pg_temp.pt_as('SUPER_ADMIN', 'admin');
  IF (SELECT scans_24h FROM public.fraud_scan_stats()) - current_setting('test.base_scans')::integer <> 17 THEN RAISE EXCEPTION 'The scan counter is wrong'; END IF;
  IF (SELECT suspicious_24h FROM public.fraud_scan_stats()) - current_setting('test.base_suspicious')::integer <> 3 THEN RAISE EXCEPTION 'The flagged counter is wrong'; END IF;
END $$;
ROLLBACK;
