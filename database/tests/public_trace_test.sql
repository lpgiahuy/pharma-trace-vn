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
INSERT INTO public.packaging_variants(medicine_id, unit_name) VALUES (:med_id, 'Box') RETURNING id AS id \gset v_
INSERT INTO public.internal_transfers(transfer_code, order_id, transfer_type, from_facility_id, to_facility_id, status)
  VALUES ('PT-TRF-1', NULL, 'REPLENISHMENT', :f_a, :f_b, 'RECEIVED') RETURNING id AS id \gset t_
INSERT INTO public.transfer_custody(transfer_id, variant_id, quantity, outstanding, box_uids, handed_over_at, received_at)
  VALUES (:t_id, :v_id, 1, 0, ARRAY[:'b_far']::uuid[], now() - interval '2 days', now() - interval '1 day');

SELECT set_config('test.far', :'b_far', true), set_config('test.slow', :'b_slow', true), set_config('test.busy', :'b_busy', true),
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
  IF trace.medicine_name <> 'PT medicine' OR trace.manufacturer <> 'PT Pharma' OR trace.batch_status <> 'ACTIVE' OR trace.box_status <> 'IN_STOCK' THEN
    RAISE EXCEPTION 'The public summary is wrong';
  END IF;
  IF EXISTS (SELECT FROM public.public_box_trace('00000000-0000-4000-8000-000000000001')) THEN RAISE EXCEPTION 'An unknown uid returned a summary'; END IF;
  IF (SELECT string_agg(event_type, ',' ORDER BY occurred_at) FROM public.public_box_timeline(current_setting('test.far')::uuid)) <> 'MANUFACTURED,TRANSFER_RECEIVED' THEN
    RAISE EXCEPTION 'The public timeline is wrong';
  END IF;
  IF (SELECT facility_name FROM public.public_box_timeline(current_setting('test.far')::uuid) WHERE event_type = 'TRANSFER_RECEIVED') <> 'PT warehouse B' THEN
    RAISE EXCEPTION 'The transfer event has no facility';
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

-- Impossible travel: Hanoi then Ho Chi Minh City a moment later; the same jump again does not duplicate the alert
DO $$
DECLARE scan record; alert record;
BEGIN
  PERFORM pg_temp.pt_as('', '');
  SELECT * INTO scan FROM public.record_public_scan(current_setting('test.far')::uuid, 21.0285, 105.8542, '1.2.3.4', 'agent');
  IF scan.scan_result <> 'VALID' OR scan.risk_score <> 0 OR cardinality(scan.reasons) <> 0 THEN RAISE EXCEPTION 'A first scan was flagged'; END IF;
  SELECT * INTO scan FROM public.record_public_scan(current_setting('test.far')::uuid, 10.8231, 106.6297, '1.2.3.4', 'agent');
  IF scan.scan_result <> 'SUSPICIOUS' OR scan.risk_score <> 80 OR scan.reasons <> ARRAY['IMPOSSIBLE_TRAVEL'] THEN RAISE EXCEPTION 'The jump was not flagged'; END IF;
  SELECT * INTO scan FROM public.record_public_scan(current_setting('test.far')::uuid, 21.0285, 105.8542, '1.2.3.4', 'agent');
  IF scan.reasons <> ARRAY['IMPOSSIBLE_TRAVEL'] THEN RAISE EXCEPTION 'The jump back was not flagged'; END IF;
  IF (SELECT count(*) FROM public.qr_scan_logs WHERE uid = current_setting('test.far')::uuid AND ip_address = '1.2.3.4' AND user_agent = 'agent') <> 3 THEN
    RAISE EXCEPTION 'The scans were not logged';
  END IF;
  PERFORM pg_temp.pt_as('', '');
  IF (SELECT count(*) FROM public.fraud_alerts) <> 0 THEN RAISE EXCEPTION 'The public read fraud alerts'; END IF;
  PERFORM pg_temp.pt_as('SUPER_ADMIN', 'admin');
  SELECT * INTO alert FROM public.fraud_alerts WHERE uid = current_setting('test.far')::uuid AND fraud_type = 'IMPOSSIBLE_TRAVEL';
  IF (SELECT count(*) FROM public.fraud_alerts WHERE uid = current_setting('test.far')::uuid) <> 1 THEN RAISE EXCEPTION 'The alert was duplicated'; END IF;
  IF alert.severity_level <> 'CRITICAL' OR alert.distance_km NOT BETWEEN 1100 AND 1200 OR alert.calculated_speed_kmh <= 900
    OR alert.latitude_1 <> 21.0285 OR alert.longitude_2 <> 106.6297 OR alert.scanned_code <> current_setting('test.far') THEN
    RAISE EXCEPTION 'The alert details are wrong: %', alert;
  END IF;
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

-- Excessive scans: the sixth scan within an hour is flagged, without coordinates
DO $$
DECLARE scan record; i integer;
BEGIN
  PERFORM pg_temp.pt_as('', '');
  FOR i IN 1..5 LOOP
    SELECT * INTO scan FROM public.record_public_scan(current_setting('test.busy')::uuid, NULL, NULL, NULL, NULL);
    IF scan.scan_result <> 'VALID' THEN RAISE EXCEPTION 'Scan % was flagged', i; END IF;
  END LOOP;
  SELECT * INTO scan FROM public.record_public_scan(current_setting('test.busy')::uuid, NULL, NULL, NULL, NULL);
  IF scan.scan_result <> 'SUSPICIOUS' OR scan.risk_score <> 50 OR scan.reasons <> ARRAY['EXCESSIVE_SCANS'] THEN RAISE EXCEPTION 'The sixth scan was not flagged'; END IF;
  PERFORM pg_temp.pt_as('SUPER_ADMIN', 'admin');
  IF (SELECT severity_level FROM public.fraud_alerts WHERE uid = current_setting('test.busy')::uuid AND fraud_type = 'EXCESSIVE_SCANS') <> 'WARNING' THEN
    RAISE EXCEPTION 'The excessive scan alert is missing';
  END IF;
END $$;

-- Radar counters: 3 + 2 + 6 scans were added and 3 of them (2 jumps and the sixth rescan) were suspicious
DO $$
BEGIN
  PERFORM pg_temp.pt_as('SUPER_ADMIN', 'admin');
  IF (SELECT scans_24h FROM public.fraud_scan_stats()) - current_setting('test.base_scans')::integer <> 11 THEN RAISE EXCEPTION 'The scan counter is wrong'; END IF;
  IF (SELECT suspicious_24h FROM public.fraud_scan_stats()) - current_setting('test.base_suspicious')::integer <> 3 THEN RAISE EXCEPTION 'The suspicious counter is wrong'; END IF;
END $$;
ROLLBACK;
