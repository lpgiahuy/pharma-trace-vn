\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('ST warehouse', 'CENTRAL_WAREHOUSE') RETURNING id AS w \gset f_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('ST pharmacy', 'PHARMACY') RETURNING id AS p \gset f_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('ST other pharmacy', 'PHARMACY') RETURNING id AS o \gset f_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('ST warehouse manager', 'WAREHOUSE_MANAGER', :f_w) RETURNING id AS wm \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('ST warehouse staff', 'WAREHOUSE_STAFF', :f_w) RETURNING id AS ws \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('ST pharmacy manager', 'STORE_MANAGER', :f_p) RETURNING id AS pm \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('ST other manager', 'STORE_MANAGER', :f_o) RETURNING id AS om \gset e_
INSERT INTO public.medicines(medicine_name) VALUES ('ST medicine') RETURNING id AS id \gset med_
INSERT INTO public.packaging_variants(medicine_id, unit_name) VALUES (:med_id, 'Box') RETURNING id AS id \gset v_
INSERT INTO public.batches(batch_number, medicine_id, production_date, expiry_date, status)
  VALUES (format('ST-%s', txid_current()), :med_id, current_date - 1, current_date + 365, 'ACTIVE') RETURNING id AS id \gset batch_
INSERT INTO public.medicine_boxes(batch_id, current_facility_id, status) SELECT :batch_id, :f_w, 'IN_STOCK' FROM generate_series(1, 3);
INSERT INTO public.inventories(facility_id, variant_id, stock_quantity, reserved_quantity) VALUES (:f_w, :v_id, 3, 0);
INSERT INTO public.orders(order_code, export_facility_id, order_status) VALUES (format('ST-%s', txid_current()), :f_p, 'PENDING') RETURNING id AS id \gset o_
SELECT set_config('test.w', :'f_w', true), set_config('test.p', :'f_p', true), set_config('test.o', :'f_o', true),
  set_config('test.wm', :'e_wm', true), set_config('test.ws', :'e_ws', true), set_config('test.pm', :'e_pm', true), set_config('test.om', :'e_om', true),
  set_config('test.variant', :'v_id', true), set_config('test.batch', :'batch_id', true), set_config('test.order', :'o_id', true);

CREATE FUNCTION pg_temp.st_expect(expected text, statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected % but the statement succeeded: %', expected, statement;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE expected || '%' THEN RAISE; END IF;
END $$;
CREATE FUNCTION pg_temp.st_as(role text, employee text, unit text, operation text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.current_user_type', 'employee', true), set_config('app.current_user_role', role, true),
    set_config('app.current_user_id', current_setting('test.' || employee), true),
    set_config('app.current_unit_id', current_setting('test.' || unit), true), set_config('app.order_operation', operation, true);
END $$;
CREATE FUNCTION pg_temp.st_request(code text, units integer) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.create_stock_transfer_request(%L, %s, %s, %L, %L)', code, current_setting('test.w'), current_setting('test.p'),
    jsonb_build_array(jsonb_build_object('variantId', current_setting('test.variant')::integer, 'quantity', units)), 'Weekly replenishment')
$$;

-- Only order transfers carry an order.
SELECT pg_temp.st_expect('new row for relation "internal_transfers" violates check constraint', format(
  'INSERT INTO public.internal_transfers(transfer_code, from_facility_id, to_facility_id) VALUES (''ST-CHECK-1'', %s, %s)', :f_w, :f_p));
SELECT pg_temp.st_expect('new row for relation "internal_transfers" violates check constraint', format(
  'INSERT INTO public.internal_transfers(transfer_code, order_id, transfer_type, from_facility_id, to_facility_id) VALUES (''ST-CHECK-2'', %s, ''REPLENISHMENT'', %s, %s)', :o_id, :f_w, :f_p));

SET LOCAL ROLE app_user;
DO $$
DECLARE request integer; transfer public.internal_transfers%ROWTYPE;
BEGIN
  PERFORM pg_temp.st_as('WAREHOUSE_STAFF', 'ws', 'p', 'read');
  PERFORM pg_temp.st_expect('ST_FORBIDDEN', pg_temp.st_request('ST-REQ-1', 2));
  PERFORM pg_temp.st_as('STORE_MANAGER', 'pm', 'p', 'read');
  PERFORM pg_temp.st_expect('ST_LINES_INVALID', pg_temp.st_request('ST-REQ-0', 0));
  EXECUTE pg_temp.st_request('ST-REQ-1', 2) INTO request;
  IF request <> (SELECT public.create_stock_transfer_request('ST-REQ-1', current_setting('test.w')::integer, current_setting('test.p')::integer, '[]', NULL)) THEN
    RAISE EXCEPTION 'Resending a request code created a second request';
  END IF;
  PERFORM set_config('test.request', request::text, true);

  PERFORM pg_temp.st_expect('ST_SOURCE_MANAGER_REQUIRED', format('SELECT public.decide_stock_transfer_request(%s, ''APPROVE'', NULL)', request));
  PERFORM pg_temp.st_as('STORE_MANAGER', 'om', 'o', 'read');
  IF EXISTS (SELECT FROM public.stock_transfer_requests) THEN RAISE EXCEPTION 'Another facility read the request'; END IF;
  PERFORM pg_temp.st_expect('ST_NOT_FOUND', format('SELECT public.decide_stock_transfer_request(%s, ''APPROVE'', NULL)', request));
  PERFORM pg_temp.st_as('WAREHOUSE_STAFF', 'ws', 'w', 'read');
  PERFORM pg_temp.st_expect('ST_NOT_FOUND', format('SELECT public.decide_stock_transfer_request(%s, ''APPROVE'', NULL)', request));

  PERFORM pg_temp.st_as('WAREHOUSE_MANAGER', 'wm', 'w', 'read');
  PERFORM public.decide_stock_transfer_request(request, 'APPROVE', NULL);
  PERFORM public.decide_stock_transfer_request(request, 'APPROVE', NULL);
  SELECT * INTO transfer FROM public.internal_transfers WHERE request_id = request;
  IF transfer.transfer_type <> 'REPLENISHMENT' OR transfer.order_id IS NOT NULL OR transfer.status <> 'REQUESTED' THEN
    RAISE EXCEPTION 'Approval did not create one stock transfer';
  END IF;
  IF (SELECT count(*) FROM public.stock_transfer_request_events WHERE request_id = request) <> 2 THEN RAISE EXCEPTION 'Events were not recorded once per change'; END IF;
  PERFORM set_config('test.transfer', transfer.id::text, true);

  PERFORM pg_temp.st_as('STORE_MANAGER', 'pm', 'p', 'read');
  EXECUTE pg_temp.st_request('ST-REQ-2', 2);
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT reserved_quantity FROM public.inventories WHERE facility_id = current_setting('test.w')::integer AND variant_id = current_setting('test.variant')::integer) <> 2 THEN
    RAISE EXCEPTION 'Approval did not reserve source stock';
  END IF;
END $$;
SET LOCAL ROLE app_user;

-- The second request cannot be approved: one unit is left after the first reservation.
DO $$ BEGIN
  PERFORM pg_temp.st_as('WAREHOUSE_MANAGER', 'wm', 'w', 'read');
  PERFORM pg_temp.st_expect('ST_STOCK_INSUFFICIENT', format('SELECT public.decide_stock_transfer_request(%s, ''APPROVE'', NULL)',
    (SELECT id FROM public.stock_transfer_requests WHERE request_code = 'ST-REQ-2')));
  PERFORM pg_temp.st_expect('ST_NOTE_REQUIRED', format('SELECT public.decide_stock_transfer_request(%s, ''REJECT'', NULL)',
    (SELECT id FROM public.stock_transfer_requests WHERE request_code = 'ST-REQ-2')));
  PERFORM public.decide_stock_transfer_request((SELECT id FROM public.stock_transfer_requests WHERE request_code = 'ST-REQ-2'), 'REJECT', 'Not enough stock');
END $$;

-- Dispatch: scanned boxes are reserved, then handed to custody with the source stock.
DO $$
DECLARE uids uuid[];
BEGIN
  PERFORM pg_temp.st_as('WAREHOUSE_STAFF', 'ws', 'w', 'dispatch');
  SELECT array_agg(uid) INTO uids FROM (SELECT uid FROM public.medicine_boxes WHERE batch_id = current_setting('test.batch')::integer LIMIT 2) b;
  PERFORM pg_temp.st_expect('Scan one reserved source package', format('SELECT public.prepare_dispatch_manifest(%s, %L)', current_setting('test.transfer'),
    jsonb_build_array(jsonb_build_object('variantId', current_setting('test.variant')::integer, 'quantity', 2, 'boxUids', to_jsonb(uids[1:1])))));
  PERFORM public.prepare_dispatch_manifest(current_setting('test.transfer')::integer,
    jsonb_build_array(jsonb_build_object('variantId', current_setting('test.variant')::integer, 'quantity', 2, 'boxUids', to_jsonb(uids))));
  -- The trail names the store manager who asked and the warehouse manager who approved.
  PERFORM pg_temp.st_as('WAREHOUSE_STAFF', 'ws', 'w', 'transfer_read');
  IF (SELECT array_agg(action || ':' || actor_id ORDER BY action) FROM public.transfer_request_trail(current_setting('test.transfer')::integer))
    IS DISTINCT FROM ARRAY['APPROVE:' || current_setting('test.wm'), 'CREATE:' || current_setting('test.pm')] THEN
    RAISE EXCEPTION 'Request trail does not name the requester and the approver';
  END IF;
  PERFORM pg_temp.st_as('WAREHOUSE_STAFF', 'ws', 'w', 'dispatch');
  -- A requested transfer is handed over by the manager who approved it, and nobody else.
  IF (SELECT array_agg(id) FROM public.transfer_transport_staff(current_setting('test.transfer')::integer)) IS DISTINCT FROM ARRAY[current_setting('test.wm')::integer] THEN
    RAISE EXCEPTION 'Only the approving manager may be the responsible employee';
  END IF;
  PERFORM pg_temp.st_expect('Invalid source transport employee', format(
    'UPDATE public.internal_transfers SET status = ''DISPATCHED'', transport_mode = ''INTERNAL'', transport_employee_id = %s, transport_employee_name = ''ST warehouse staff'', dispatched_at = now() WHERE id = %s',
    current_setting('test.ws'), current_setting('test.transfer')));
  UPDATE public.internal_transfers t SET status = 'DISPATCHED', transport_mode = 'INTERNAL', transport_employee_id = s.id,
    transport_employee_name = s.full_name, dispatched_at = now()
    FROM public.transfer_transport_staff(current_setting('test.transfer')::integer) s WHERE t.id = current_setting('test.transfer')::integer;
  IF (SELECT box_uids FROM public.transfer_custody WHERE transfer_id = current_setting('test.transfer')::integer) IS DISTINCT FROM uids THEN
    RAISE EXCEPTION 'Custody does not hold the scanned boxes';
  END IF;

  PERFORM pg_temp.st_as('STORE_MANAGER', 'pm', 'p', 'receive');
  IF (SELECT count(*) FROM public.medicine_boxes WHERE uid = ANY(uids) AND status = 'IN_TRANSIT') <> 2 THEN
    RAISE EXCEPTION 'Destination cannot see the boxes in transit';
  END IF;
  PERFORM public.record_quarantine_movement('TRANSFER', current_setting('test.transfer')::integer, current_setting('test.variant')::integer, 'IN', 1);
  PERFORM pg_temp.st_as('STORE_MANAGER', 'pm', 'p', 'replace');
  PERFORM pg_temp.st_expect('Stock transfer receipts are final', format('SELECT public.resolve_transfer_discrepancy(%s, ''RESUPPLY'', NULL, ''Test'', NULL)', current_setting('test.transfer')));
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT (stock_quantity, reserved_quantity) FROM public.inventories WHERE facility_id = current_setting('test.w')::integer AND variant_id = current_setting('test.variant')::integer)
    IS DISTINCT FROM (1, 0) THEN RAISE EXCEPTION 'Dispatch did not move the reserved stock into custody'; END IF;
END $$;
ROLLBACK;
