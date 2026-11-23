\set ON_ERROR_STOP on
-- Goods receipt of a purchase order whose supplier is a factory: boxes the factory registered are taken out of its stock.
-- Run as owner on a disposable initialized database; every fixture is rolled back.
BEGIN;
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('FR factory','FACTORY') RETURNING id AS f \gset f_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('FR other factory','FACTORY') RETURNING id AS g \gset f_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('FR warehouse','CENTRAL_WAREHOUSE') RETURNING id AS w \gset f_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('FR factory staff','fr-f@example.test','FACTORY_WAREHOUSE_STAFF','ACTIVE',:f_f) RETURNING id AS fs \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('FR warehouse staff','fr-w@example.test','WAREHOUSE_STAFF','ACTIVE',:f_w) RETURNING id AS ws \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('FR warehouse manager','fr-m@example.test','WAREHOUSE_MANAGER','ACTIVE',:f_w) RETURNING id AS wm \gset e_
INSERT INTO public.medicines(medicine_name) VALUES ('FR medicine') RETURNING id AS id \gset med_
INSERT INTO public.packaging_variants(medicine_id,unit_name) VALUES (:med_id,'box') RETURNING id AS id \gset v_
INSERT INTO public.purchase_orders(po_code,supplier_id,facility_id,created_by_employee_id,status)
  VALUES ('PO-FR-1',:f_f,:f_w,:e_wm,'APPROVED') RETURNING id AS id \gset p_
INSERT INTO public.purchase_order_items(po_id,medicine_id,variant_id,quantity,unit_price) VALUES (:p_id,:med_id,:v_id,12,10) RETURNING id AS id \gset i_
INSERT INTO public.purchase_order_events(po_id,action,to_status,actor_id) VALUES (:p_id,'APPROVED','APPROVED',:e_wm);
SELECT set_config('test.f',:'f_f',true), set_config('test.g',:'f_g',true), set_config('test.w',:'f_w',true), set_config('test.po',:'p_id',true),
  set_config('test.item',:'i_id',true), set_config('test.variant',:'v_id',true), set_config('test.fs',:'e_fs',true), set_config('test.ws',:'e_ws',true);

-- The factory registers a batch of 10 boxes in two cartons of 5, through the real intake function.
SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_type','employee',true), set_config('app.current_user_role','FACTORY_WAREHOUSE_STAFF',true),
  set_config('app.current_user_id',:'e_fs',true), set_config('app.current_unit_id',:'f_f',true);
DO $$
DECLARE cartons jsonb;
BEGIN
  cartons := jsonb_build_array(
    jsonb_build_object('sscc', 'FR-SSCC-1', 'boxes', (SELECT jsonb_agg(jsonb_build_object('uid', gen_random_uuid(), 'signature', 's')) FROM generate_series(1, 5))),
    jsonb_build_object('sscc', 'FR-SSCC-2', 'boxes', (SELECT jsonb_agg(jsonb_build_object('uid', gen_random_uuid(), 'signature', 's')) FROM generate_series(1, 5))));
  PERFORM public.record_factory_batch(current_setting('test.f')::int, current_setting('test.variant')::int, 'FR-LOT-1', '2026-01-01', '2030-01-01', NULL, cartons);
END $$;

SELECT set_config('app.current_user_role','WAREHOUSE_STAFF',true), set_config('app.current_user_id',:'e_ws',true), set_config('app.current_unit_id',:'f_w',true);

CREATE FUNCTION pg_temp.fr_expect(expected text, statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected % but the statement succeeded: %', expected, statement;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE expected || '%' THEN RAISE; END IF;
END $$;

DO $$
DECLARE
  po int := current_setting('test.po')::int; item int := current_setting('test.item')::int; factory int := current_setting('test.f')::int;
  warehouse int := current_setting('test.w')::int; variant int := current_setting('test.variant')::int;
  single uuid[]; first_receipt int;
BEGIN
  -- Unknown boxes and unknown batches are never created at receipt when the supplier is a factory.
  PERFORM pg_temp.fr_expect('GR_BOX_UNAVAILABLE', format('SELECT public.record_goods_receipt(%s, %L, NULL, %L)', po, 'FR-RCPT-X1',
    jsonb_build_array(jsonb_build_object('poItemId', item, 'batchNumber', 'FR-LOT-1', 'productionDate', '2026-01-01', 'expiryDate', '2030-01-01',
      'boxUids', jsonb_build_array(gen_random_uuid())))));
  PERFORM pg_temp.fr_expect('GR_BATCH_NOT_FROM_SUPPLIER', format('SELECT public.record_goods_receipt(%s, %L, NULL, %L)', po, 'FR-RCPT-X2',
    jsonb_build_array(jsonb_build_object('poItemId', item, 'batchNumber', 'FR-NOPE', 'productionDate', '2026-01-01', 'expiryDate', '2030-01-01',
      'boxUids', jsonb_build_array(gen_random_uuid())))));

  -- Receive one carton (5 boxes) plus two single boxes, one of them rejected.
  SELECT array_agg(uid ORDER BY uid) INTO single FROM (SELECT uid FROM public.medicine_boxes b JOIN public.sscc_cartons c ON c.id = b.carton_id
    WHERE c.sscc_code = 'FR-SSCC-2' ORDER BY uid LIMIT 2) s;
  first_receipt := public.record_goods_receipt(po, 'FR-RCPT-0001', 'From the factory', jsonb_build_array(jsonb_build_object(
    'poItemId', item, 'batchNumber', 'FR-LOT-1', 'productionDate', '2026-01-01', 'expiryDate', '2030-01-01',
    'ssccCodes', jsonb_build_array('FR-SSCC-1'),
    'boxUids', jsonb_build_array(single[1]), 'rejectedBoxUids', jsonb_build_array(single[2]), 'rejectReason', 'Damaged in transit')));

  IF (SELECT stock_quantity FROM public.inventories WHERE facility_id = factory AND variant_id = variant) <> 3 THEN
    RAISE EXCEPTION 'Factory stock did not go down by the 7 boxes shipped';
  END IF;
  IF (SELECT stock_quantity FROM public.inventories WHERE facility_id = warehouse AND variant_id = variant) <> 6 THEN
    RAISE EXCEPTION 'Warehouse stock should hold the 6 accepted boxes';
  END IF;
  IF (SELECT quantity FROM public.quarantine_balances WHERE facility_id = warehouse AND variant_id = variant) <> 1 THEN
    RAISE EXCEPTION 'The rejected box was not quarantined at the warehouse';
  END IF;
  IF (SELECT count(*) FROM public.medicine_boxes WHERE current_facility_id = warehouse AND status = 'IN_STOCK') <> 6
     OR (SELECT count(*) FROM public.medicine_boxes WHERE current_facility_id = warehouse AND status = 'QUARANTINED') <> 1
     OR (SELECT count(*) FROM public.medicine_boxes WHERE current_facility_id = factory AND status = 'IN_STOCK') <> 3 THEN
    RAISE EXCEPTION 'Boxes were not moved from the factory to the warehouse';
  END IF;
  IF (SELECT current_facility_id FROM public.sscc_cartons WHERE sscc_code = 'FR-SSCC-1') <> warehouse THEN
    RAISE EXCEPTION 'The received carton did not move';
  END IF;
  IF (SELECT count(*) FROM public.inventory_logs WHERE facility_id = factory AND transaction_type = 'PO_SHIPMENT_OUT' AND quantity_changed = -7) <> 1 THEN
    RAISE EXCEPTION 'The factory shipment was not logged';
  END IF;
  -- The factory batch totals were counted at production and stay the same.
  IF (SELECT initial_quantity FROM public.batches WHERE batch_number = 'FR-LOT-1') <> 10 THEN
    RAISE EXCEPTION 'Receipt changed the factory batch quantity';
  END IF;
  IF (SELECT received_quantity FROM public.purchase_order_items WHERE id = item) <> 7
     OR (SELECT status FROM public.purchase_orders WHERE id = po) <> 'PARTIALLY_RECEIVED' THEN
    RAISE EXCEPTION 'The order was not advanced';
  END IF;

  -- Boxes that already left the factory cannot be received again, and a carton that is no longer complete is refused.
  PERFORM pg_temp.fr_expect('GR_BOX_UNAVAILABLE', format('SELECT public.record_goods_receipt(%s, %L, NULL, %L)', po, 'FR-RCPT-X3',
    jsonb_build_array(jsonb_build_object('poItemId', item, 'batchNumber', 'FR-LOT-1', 'productionDate', '2026-01-01', 'expiryDate', '2030-01-01',
      'boxUids', jsonb_build_array(single[1])))));
  PERFORM pg_temp.fr_expect('GR_CARTON_UNAVAILABLE', format('SELECT public.record_goods_receipt(%s, %L, NULL, %L)', po, 'FR-RCPT-X4',
    jsonb_build_array(jsonb_build_object('poItemId', item, 'batchNumber', 'FR-LOT-1', 'productionDate', '2026-01-01', 'expiryDate', '2030-01-01',
      'ssccCodes', jsonb_build_array('FR-SSCC-2')))));
  RAISE NOTICE 'PASS factory purchase order receipt';
END $$;
ROLLBACK;
