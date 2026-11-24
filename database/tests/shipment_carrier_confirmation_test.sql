\set ON_ERROR_STOP on
-- Who may confirm the carrier and tracking number of a shipment (public.confirm_shipment_carrier). Rolls back.
BEGIN;
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('SC warehouse A', 'CENTRAL_WAREHOUSE') RETURNING id AS a \gset f_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('SC warehouse B', 'CENTRAL_WAREHOUSE') RETURNING id AS b \gset f_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('SC pharmacy', 'PHARMACY') RETURNING id AS p \gset f_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('SC staff A', 'WAREHOUSE_STAFF', :f_a) RETURNING id AS staff_a \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('SC manager A', 'WAREHOUSE_MANAGER', :f_a) RETURNING id AS manager_a \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('SC staff B', 'WAREHOUSE_STAFF', :f_b) RETURNING id AS staff_b \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('SC store manager', 'STORE_MANAGER', :f_p) RETURNING id AS store \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('SC factory staff', 'FACTORY_WAREHOUSE_STAFF', :f_a) RETURNING id AS factory \gset e_
INSERT INTO public.orders(order_code, export_facility_id, order_status) VALUES (format('SC-A-%s', txid_current()), :f_a, 'PENDING_PICKUP') RETURNING id AS a \gset o_
INSERT INTO public.orders(order_code, export_facility_id, order_status) VALUES (format('SC-B-%s', txid_current()), :f_b, 'PENDING_PICKUP') RETURNING id AS b \gset o_
INSERT INTO public.orders(order_code, export_facility_id, order_status) VALUES (format('SC-P-%s', txid_current()), :f_p, 'PENDING_PICKUP') RETURNING id AS p \gset o_
INSERT INTO public.orders(order_code, export_facility_id, order_status) VALUES (format('SC-X-%s', txid_current()), :f_a, 'PICKED_UP') RETURNING id AS x \gset o_
INSERT INTO public.shipments(order_id, tracking_number, courier_name) VALUES (:o_a, format('TRK-SC-A-%s', txid_current()), 'INTERNAL') RETURNING id AS a \gset s_
INSERT INTO public.shipments(order_id, tracking_number, courier_name) VALUES (:o_b, format('TRK-SC-B-%s', txid_current()), 'INTERNAL') RETURNING id AS b \gset s_
INSERT INTO public.shipments(order_id, tracking_number, courier_name) VALUES (:o_p, format('TRK-SC-P-%s', txid_current()), 'INTERNAL') RETURNING id AS p \gset s_
INSERT INTO public.shipments(order_id, tracking_number, courier_name, shipping_status) VALUES (:o_x, format('TRK-SC-X-%s', txid_current()), 'GHN', 'PICKED_UP') RETURNING id AS x \gset s_
SELECT set_config('test.s_a', :'s_a', true), set_config('test.s_b', :'s_b', true), set_config('test.s_p', :'s_p', true),
  set_config('test.s_x', :'s_x', true), set_config('test.tx', txid_current()::text, true);

SET LOCAL ROLE app_user;
CREATE FUNCTION pg_temp.sc_as(role_name text, actor integer, unit integer, op text DEFAULT 'carrier') RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('app.current_user_type', 'employee', true), set_config('app.current_user_role', role_name, true),
    set_config('app.current_user_id', actor::text, true), set_config('app.current_unit_id', unit::text, true),
    set_config('app.order_operation', op, true);
$$;
CREATE FUNCTION pg_temp.sc_expect(expected text, shipment integer, tracking text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.confirm_shipment_carrier(shipment, 'ghn', tracking);
  RAISE EXCEPTION 'Expected % but the carrier was confirmed', expected;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> expected THEN RAISE; END IF;
END $$;

-- Warehouse A staff: sees and confirms the shipment packed by warehouse A.
SELECT pg_temp.sc_as('WAREHOUSE_STAFF', :e_staff_a, :f_a);
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM public.shipments WHERE id = current_setting('test.s_a')::int) THEN
    RAISE EXCEPTION 'Warehouse A cannot read its own shipment';
  END IF;
  IF EXISTS (SELECT FROM public.shipments WHERE id IN (current_setting('test.s_b')::int, current_setting('test.s_p')::int)) THEN
    RAISE EXCEPTION 'Warehouse A reads shipments of another facility';
  END IF;
  PERFORM public.confirm_shipment_carrier(current_setting('test.s_a')::int, ' ghn ', ' SC-GHN-A-' || current_setting('test.tx') || ' ');
  IF NOT EXISTS (SELECT FROM public.shipments WHERE id = current_setting('test.s_a')::int AND courier_name = 'GHN'
      AND tracking_number = 'SC-GHN-A-' || current_setting('test.tx') AND carrier_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'The carrier of warehouse A was not confirmed';
  END IF;
END $$;

-- Warehouse A cannot confirm the shipment of warehouse B or of a pharmacy, nor a shipment already picked up.
SELECT pg_temp.sc_expect('CR_NOT_FOUND', :s_b, 'SC-1');
SELECT pg_temp.sc_expect('CR_NOT_FOUND', :s_p, 'SC-2');
SELECT pg_temp.sc_expect('CR_NOT_PENDING_PICKUP', :s_x, 'SC-3');
-- A blank tracking number is refused; the warehouse manager may confirm too.
SELECT pg_temp.sc_expect('CR_INPUT_INVALID', :s_a, '  ');
SELECT pg_temp.sc_as('WAREHOUSE_MANAGER', :e_manager_a, :f_a);
SELECT public.confirm_shipment_carrier(:s_a, 'GHN', format('SC-GHN-A-%s', txid_current()));

-- The 'carrier' operation writes nothing directly; only the function changes the shipment.
DO $$ DECLARE changed integer; BEGIN
  UPDATE public.shipments SET tracking_number = 'SC-DIRECT' WHERE id = current_setting('test.s_a')::int;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 0 THEN RAISE EXCEPTION 'A shipment was written directly under the carrier operation'; END IF;
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

-- Another operation does not open the function.
SELECT pg_temp.sc_as('WAREHOUSE_STAFF', :e_staff_a, :f_a, 'pack');
SELECT pg_temp.sc_expect('CR_FORBIDDEN', :s_a, 'SC-4');

-- Factory staff are not part of the carrier confirmation, even at a facility that exports the order.
SELECT pg_temp.sc_as('FACTORY_WAREHOUSE_STAFF', :e_factory, :f_a);
SELECT pg_temp.sc_expect('CR_FORBIDDEN', :s_a, 'SC-5');

-- Warehouse B staff confirm their own shipment, never the one of warehouse A.
SELECT pg_temp.sc_as('WAREHOUSE_STAFF', :e_staff_b, :f_b);
SELECT pg_temp.sc_expect('CR_NOT_FOUND', :s_a, 'SC-6');
-- A tracking number another shipment already has is refused.
DO $$ BEGIN
  PERFORM public.confirm_shipment_carrier(current_setting('test.s_b')::int, 'GHN', 'SC-GHN-A-' || current_setting('test.tx'));
  RAISE EXCEPTION 'A duplicate tracking number was accepted';
EXCEPTION WHEN unique_violation THEN NULL; END $$;
SELECT public.confirm_shipment_carrier(:s_b, 'VNPOST', format('SC-VNP-B-%s', txid_current()));

-- The store manager still confirms the shipment of the own pharmacy, and not the one of a warehouse.
SELECT pg_temp.sc_as('STORE_MANAGER', :e_store, :f_p);
SELECT public.confirm_shipment_carrier(:s_p, 'GHTK', format('SC-GHTK-P-%s', txid_current()));
SELECT pg_temp.sc_expect('CR_NOT_FOUND', :s_a, 'SC-7');

-- The confirmation leaves the shipment waiting for pickup; only the handover moves it on.
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.shipments WHERE id IN (current_setting('test.s_a')::int, current_setting('test.s_b')::int, current_setting('test.s_p')::int)
      AND carrier_confirmed_at IS NOT NULL AND shipping_status = 'PENDING_PICKUP') <> 3 THEN
    RAISE EXCEPTION 'Expected three confirmed shipments still waiting for pickup';
  END IF;
  IF NOT EXISTS (SELECT FROM public.logistics_events WHERE shipment_id = current_setting('test.s_a')::int AND reason LIKE 'Carrier updated:%') THEN
    RAISE EXCEPTION 'The carrier change was not recorded in the shipment history';
  END IF;
END $$;
ROLLBACK;
\echo shipment_carrier_confirmation_test passed
