\set ON_ERROR_STOP on
-- Drug disposals: closed direct writes, warehouse scope, eligible boxes, idempotent codes, manager-only approval and
-- completion, the attachment requirement and the stock, quarantine and ledger effect of completing.
-- Run as owner on a disposable initialized database; every fixture is rolled back.
BEGIN;
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('DP warehouse A', 'CENTRAL_WAREHOUSE') RETURNING id AS a \gset f_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('DP warehouse B', 'BRANCH_WAREHOUSE') RETURNING id AS b \gset f_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('DP staff A', 'WAREHOUSE_STAFF', :f_a) RETURNING id AS staff \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('DP manager A', 'WAREHOUSE_MANAGER', :f_a) RETURNING id AS manager_a \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('DP manager B', 'WAREHOUSE_MANAGER', :f_b) RETURNING id AS manager_b \gset e_
INSERT INTO public.medicines(medicine_name) VALUES ('DP medicine') RETURNING id AS id \gset med_
INSERT INTO public.packaging_variants(medicine_id, unit_name) VALUES (:med_id, 'Box') RETURNING id AS id \gset v_
INSERT INTO public.batches(batch_number, medicine_id, production_date, expiry_date, status, initial_quantity, remaining_quantity)
  VALUES (format('DPE-%s', txid_current()), :med_id, current_date - 400, current_date - 1, 'ACTIVE', 10, 10) RETURNING id AS id \gset expired_
INSERT INTO public.batches(batch_number, medicine_id, production_date, expiry_date, status, initial_quantity, remaining_quantity)
  VALUES (format('DPA-%s', txid_current()), :med_id, current_date - 30, current_date + 365, 'ACTIVE', 10, 10) RETURNING id AS id \gset active_
INSERT INTO public.batches(batch_number, medicine_id, production_date, expiry_date, status, initial_quantity, remaining_quantity)
  VALUES (format('DPR-%s', txid_current()), :med_id, current_date - 30, current_date + 365, 'RECALLED', 10, 10) RETURNING id AS id \gset recalled_
INSERT INTO public.medicine_boxes(batch_id, current_facility_id, status) SELECT :expired_id, :f_a, 'IN_STOCK' FROM generate_series(1, 3);
INSERT INTO public.medicine_boxes(batch_id, current_facility_id, status) SELECT :active_id, :f_a, 'IN_STOCK' FROM generate_series(1, 2);
INSERT INTO public.medicine_boxes(batch_id, current_facility_id, status) SELECT :active_id, :f_a, 'QUARANTINED' FROM generate_series(1, 2);
INSERT INTO public.medicine_boxes(batch_id, current_facility_id, status) VALUES (:recalled_id, :f_a, 'QUARANTINED');
INSERT INTO public.medicine_boxes(batch_id, current_facility_id, status) VALUES (:expired_id, :f_a, 'DESTROYED');
INSERT INTO public.inventories(facility_id, variant_id, stock_quantity, reserved_quantity) VALUES (:f_a, :v_id, 5, 0);
INSERT INTO public.quarantine_balances(facility_id, variant_id, quantity) VALUES (:f_a, :v_id, 3);

CREATE FUNCTION pg_temp.dp_uids(batch integer, box_status text, units integer) RETURNS text LANGUAGE sql AS $$
  SELECT (array_agg(uid))::text FROM (SELECT uid FROM public.medicine_boxes WHERE batch_id = batch AND status = box_status ORDER BY uid LIMIT units) s
$$;
SELECT set_config('test.a', :'f_a', true), set_config('test.b', :'f_b', true), set_config('test.variant', :'v_id', true),
  set_config('test.expired', :'expired_id', true), set_config('test.active', :'active_id', true), set_config('test.recalled', :'recalled_id', true),
  set_config('test.staff', :'e_staff', true), set_config('test.manager_a', :'e_manager_a', true), set_config('test.manager_b', :'e_manager_b', true),
  set_config('test.fresh', pg_temp.dp_uids(:active_id, 'IN_STOCK', 1), true),
  set_config('test.destroyed', pg_temp.dp_uids(:expired_id, 'DESTROYED', 1), true),
  set_config('test.expired_all', pg_temp.dp_uids(:expired_id, 'IN_STOCK', 3), true),
  set_config('test.expired_two', pg_temp.dp_uids(:expired_id, 'IN_STOCK', 2), true),
  set_config('test.quarantined', pg_temp.dp_uids(:active_id, 'QUARANTINED', 1), true),
  set_config('test.recall_box', pg_temp.dp_uids(:recalled_id, 'QUARANTINED', 1), true);
SELECT set_config('test.expired_last', (SELECT array_agg(u)::text FROM (SELECT unnest(current_setting('test.expired_all')::uuid[]) EXCEPT SELECT unnest(current_setting('test.expired_two')::uuid[])) s(u)), true);
SELECT set_config('test.first_set', (SELECT array_agg(u)::text FROM (SELECT unnest(current_setting('test.expired_two')::uuid[]) UNION ALL SELECT unnest(current_setting('test.quarantined')::uuid[]) UNION ALL SELECT unnest(current_setting('test.recall_box')::uuid[])) s(u)), true);

CREATE FUNCTION pg_temp.dp_expect(expected text, statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected % but the statement succeeded: %', expected, statement;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE expected || '%' THEN RAISE; END IF;
END $$;
CREATE FUNCTION pg_temp.dp_as(role text, employee text, unit text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.current_user_type', 'employee', true), set_config('app.current_user_role', role, true),
    set_config('app.current_user_id', current_setting('test.' || employee), true), set_config('app.current_unit_id', current_setting('test.' || unit), true);
END $$;
CREATE FUNCTION pg_temp.dp_draft(code text, boxes text) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.create_disposal(%L, %s, %L, %L::uuid[])', code, current_setting('test.a'), 'Expired and failed stock', boxes)
$$;

SET LOCAL ROLE app_user;
DO $$
DECLARE candidates text := format('SELECT count(*) FROM public.disposal_candidates(%s)', current_setting('test.a')); total integer;
BEGIN
  PERFORM pg_temp.dp_as('WAREHOUSE_STAFF', 'staff', 'a');
  PERFORM pg_temp.dp_expect('permission denied', format('INSERT INTO public.disposals(disposal_code, facility_id, reason, created_by_id) VALUES (''DP-DIRECT'', %s, ''x'', %s)',
    current_setting('test.a'), current_setting('test.staff')));
  EXECUTE candidates INTO total;
  IF total <> 6 THEN RAISE EXCEPTION 'Candidates are not 3 expired and 3 quarantined boxes: %', total; END IF;
  IF (SELECT count(*) FROM public.disposal_candidates(current_setting('test.a')::integer) WHERE source = 'EXPIRED') <> 3
    OR (SELECT count(*) FROM public.disposal_candidates(current_setting('test.a')::integer) WHERE source = 'QUARANTINE') <> 2
    OR (SELECT count(*) FROM public.disposal_candidates(current_setting('test.a')::integer) WHERE source = 'RECALL') <> 1 THEN
    RAISE EXCEPTION 'Candidate sources are wrong';
  END IF;
  PERFORM pg_temp.dp_expect('DP_BOX_NOT_ELIGIBLE', pg_temp.dp_draft('DP-FRESH-1', current_setting('test.fresh')));
  PERFORM pg_temp.dp_expect('DP_BOX_NOT_ELIGIBLE', pg_temp.dp_draft('DP-DESTROYED-1', current_setting('test.destroyed')));
  PERFORM pg_temp.dp_expect('DP_CODE_INVALID', pg_temp.dp_draft('bad code', current_setting('test.expired_two')));
  PERFORM pg_temp.dp_expect('DP_BOXES_INVALID', pg_temp.dp_draft('DP-EMPTY-1', '{}'));
  PERFORM pg_temp.dp_expect('DP_REASON_REQUIRED', format('SELECT public.create_disposal(''DP-BLANK-1'', %s, '' '', %L::uuid[])', current_setting('test.a'), current_setting('test.expired_two')));

  PERFORM pg_temp.dp_as('WAREHOUSE_MANAGER', 'manager_b', 'b');
  PERFORM pg_temp.dp_expect('DP_FORBIDDEN', pg_temp.dp_draft('DP-OTHER-1', current_setting('test.expired_two')));
  EXECUTE candidates INTO total;
  IF total <> 0 THEN RAISE EXCEPTION 'Warehouse B sees candidates of warehouse A'; END IF;
END $$;

-- Staff draft a disposal of 2 expired, 1 quarantined and 1 recalled box; a repeated code returns the same draft
DO $$
DECLARE disposal integer; again integer;
BEGIN
  PERFORM pg_temp.dp_as('WAREHOUSE_STAFF', 'staff', 'a');
  disposal := public.create_disposal('DP-CODE-1', current_setting('test.a')::integer, 'Expired and failed stock', current_setting('test.first_set')::uuid[]);
  again := public.create_disposal('DP-CODE-1', current_setting('test.a')::integer, 'Expired and failed stock', current_setting('test.first_set')::uuid[]);
  IF disposal <> again OR (SELECT count(*) FROM public.disposal_items WHERE disposal_id = disposal) <> 4 THEN RAISE EXCEPTION 'A repeated code created a second disposal'; END IF;
  IF (SELECT count(*) FROM public.disposal_items WHERE disposal_id = disposal AND source = 'EXPIRED') <> 2
    OR (SELECT count(*) FROM public.disposal_items WHERE disposal_id = disposal AND source = 'QUARANTINE') <> 1
    OR (SELECT count(*) FROM public.disposal_items WHERE disposal_id = disposal AND source = 'RECALL') <> 1 THEN
    RAISE EXCEPTION 'Disposal item sources are wrong';
  END IF;
  PERFORM set_config('test.disposal', disposal::text, true);
  PERFORM pg_temp.dp_expect('DP_CODE_CONFLICT', pg_temp.dp_draft('DP-CODE-1', current_setting('test.expired_last')));
  PERFORM pg_temp.dp_expect('DP_BOX_NOT_ELIGIBLE', pg_temp.dp_draft('DP-CODE-OTHER', current_setting('test.expired_two')));
  IF (SELECT count(*) FROM public.disposal_candidates(current_setting('test.a')::integer)) <> 2 THEN RAISE EXCEPTION 'Boxes of an open disposal are still candidates'; END IF;
  PERFORM pg_temp.dp_expect('DP_FORBIDDEN', format('SELECT public.approve_disposal(%s)', disposal));
  PERFORM pg_temp.dp_expect('DP_FORBIDDEN', format('SELECT public.complete_disposal(%s)', disposal));
  PERFORM pg_temp.dp_expect('DP_FORBIDDEN', format('SELECT public.cancel_disposal(%s, ''No'')', disposal));
END $$;

-- Only a manager of the warehouse approves; completing needs approval and an attachment
DO $$
DECLARE disposal integer := current_setting('test.disposal')::integer;
BEGIN
  PERFORM pg_temp.dp_as('WAREHOUSE_MANAGER', 'manager_b', 'b');
  PERFORM pg_temp.dp_expect('DP_NOT_FOUND', format('SELECT public.approve_disposal(%s)', disposal));
  PERFORM pg_temp.dp_as('WAREHOUSE_MANAGER', 'manager_a', 'a');
  PERFORM pg_temp.dp_expect('DP_INVALID_TRANSITION', format('SELECT public.complete_disposal(%s)', disposal));
  PERFORM public.approve_disposal(disposal);
  PERFORM pg_temp.dp_expect('DP_INVALID_TRANSITION', format('SELECT public.approve_disposal(%s)', disposal));
  PERFORM pg_temp.dp_expect('DP_ATTACHMENT_REQUIRED', format('SELECT public.complete_disposal(%s)', disposal));
  PERFORM pg_temp.dp_as('WAREHOUSE_STAFF', 'staff', 'a');
  FOR n IN 1..5 LOOP PERFORM public.add_disposal_attachment(disposal, 'pharmatrace/disposals/record-' || n); END LOOP;
  PERFORM pg_temp.dp_expect('DP_ATTACHMENT_LIMIT', format('SELECT public.add_disposal_attachment(%s, ''pharmatrace/disposals/record-6'')', disposal));
END $$;

DO $$
DECLARE disposal integer := current_setting('test.disposal')::integer;
BEGIN
  PERFORM pg_temp.dp_as('WAREHOUSE_MANAGER', 'manager_a', 'a');
  PERFORM public.complete_disposal(disposal);
  PERFORM public.complete_disposal(disposal);
  PERFORM pg_temp.dp_expect('DP_INVALID_TRANSITION', format('SELECT public.cancel_disposal(%s, ''Too late'')', disposal));
  PERFORM pg_temp.dp_expect('DP_INVALID_TRANSITION', format('SELECT public.add_disposal_attachment(%s, ''pharmatrace/disposals/late'')', disposal));
  PERFORM pg_temp.dp_expect('DP_BOX_NOT_ELIGIBLE', pg_temp.dp_draft('DP-AGAIN-1', current_setting('test.expired_two')));
  PERFORM pg_temp.dp_expect('DP_BOX_NOT_ELIGIBLE', pg_temp.dp_draft('DP-AGAIN-2', current_setting('test.destroyed')));
END $$;

RESET ROLE;
DO $$
DECLARE disposal integer := current_setting('test.disposal')::integer;
BEGIN
  IF (SELECT count(*) FROM public.medicine_boxes WHERE uid = ANY (current_setting('test.first_set')::uuid[]) AND status = 'DESTROYED') <> 4 THEN
    RAISE EXCEPTION 'The boxes were not destroyed';
  END IF;
  IF (SELECT stock_quantity FROM public.inventories WHERE facility_id = current_setting('test.a')::integer) <> 3 THEN RAISE EXCEPTION 'On-hand stock did not drop by the 2 expired boxes'; END IF;
  IF (SELECT quantity FROM public.quarantine_balances WHERE facility_id = current_setting('test.a')::integer) <> 1 THEN RAISE EXCEPTION 'Quarantine did not drop by the 2 held boxes'; END IF;
  IF (SELECT array_agg(remaining_quantity ORDER BY id) FROM public.batches WHERE id IN (current_setting('test.expired')::integer, current_setting('test.active')::integer, current_setting('test.recalled')::integer))
    <> ARRAY[8, 9, 9] THEN RAISE EXCEPTION 'Batch remaining quantities are wrong'; END IF;
  IF (SELECT count(*) FROM public.inventory_logs WHERE reference_code = 'DP-CODE-1' AND transaction_type = 'DISPOSAL') <> 3
    OR NOT EXISTS (SELECT FROM public.inventory_logs WHERE reference_code = 'DP-CODE-1' AND stock_bucket = 'ON_HAND' AND batch_id = current_setting('test.expired')::integer
      AND quantity_changed = -2 AND previous_quantity = 5 AND new_quantity = 3 AND performed_by_id = current_setting('test.manager_a')::integer)
    OR NOT EXISTS (SELECT FROM public.inventory_logs WHERE reference_code = 'DP-CODE-1' AND stock_bucket = 'QUARANTINE' AND batch_id = current_setting('test.active')::integer
      AND quantity_changed = -1 AND previous_quantity = 3 AND new_quantity = 2)
    OR NOT EXISTS (SELECT FROM public.inventory_logs WHERE reference_code = 'DP-CODE-1' AND stock_bucket = 'QUARANTINE' AND batch_id = current_setting('test.recalled')::integer
      AND quantity_changed = -1 AND previous_quantity = 2 AND new_quantity = 1) THEN
    RAISE EXCEPTION 'The disposal is not in the ledger exactly once per batch and bucket';
  END IF;
  IF (SELECT array_agg(action::text ORDER BY id) FROM public.disposal_events WHERE disposal_id = disposal)
    <> ARRAY['CREATED', 'APPROVED', 'ATTACHMENT_ADDED', 'ATTACHMENT_ADDED', 'ATTACHMENT_ADDED', 'ATTACHMENT_ADDED', 'ATTACHMENT_ADDED', 'COMPLETED']
    THEN RAISE EXCEPTION 'The disposal events are incomplete'; END IF;
END $$;

-- A cancelled draft frees its box; a box that changed state after the draft fails completion
SET LOCAL ROLE app_user;
DO $$
DECLARE draft integer; cancelled integer;
BEGIN
  PERFORM pg_temp.dp_as('WAREHOUSE_STAFF', 'staff', 'a');
  cancelled := public.create_disposal('DP-CODE-2', current_setting('test.a')::integer, 'Expired', current_setting('test.expired_last')::uuid[]);
  PERFORM pg_temp.dp_as('WAREHOUSE_MANAGER', 'manager_a', 'a');
  PERFORM public.cancel_disposal(cancelled, 'Wrong shelf');
  PERFORM pg_temp.dp_expect('DP_REASON_REQUIRED', format('SELECT public.cancel_disposal(%s, '' '')', cancelled));
  PERFORM pg_temp.dp_as('WAREHOUSE_STAFF', 'staff', 'a');
  draft := public.create_disposal('DP-CODE-3', current_setting('test.a')::integer, 'Expired', current_setting('test.expired_last')::uuid[]);
  PERFORM public.add_disposal_attachment(draft, 'pharmatrace/disposals/record-a');
  PERFORM pg_temp.dp_as('WAREHOUSE_MANAGER', 'manager_a', 'a');
  PERFORM public.approve_disposal(draft);
  PERFORM set_config('test.draft', draft::text, true);
END $$;
RESET ROLE;
UPDATE public.medicine_boxes SET status = 'RESERVED' WHERE uid = ANY (current_setting('test.expired_last')::uuid[]);
SET LOCAL ROLE app_user;
DO $$
BEGIN
  PERFORM pg_temp.dp_as('WAREHOUSE_MANAGER', 'manager_a', 'a');
  PERFORM pg_temp.dp_expect('DP_BOX_CHANGED', format('SELECT public.complete_disposal(%s)', current_setting('test.draft')));
END $$;
ROLLBACK;
