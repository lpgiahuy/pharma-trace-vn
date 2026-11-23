\set ON_ERROR_STOP on
-- A factory supplier ships an APPROVED purchase order by scanning boxes (which are reserved for the order) or rejects it
-- with a reason. The warehouse then receives exactly the boxes that were shipped; an ended order releases the rest.
-- Run as owner on a disposable initialized database; every fixture is rolled back.
BEGIN;
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('SR factory','FACTORY') RETURNING id AS f \gset f_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('SR other factory','FACTORY') RETURNING id AS g \gset f_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('SR warehouse','CENTRAL_WAREHOUSE') RETURNING id AS w \gset f_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('SR factory staff','sr-f@example.test','FACTORY_WAREHOUSE_STAFF','ACTIVE',:f_f) RETURNING id AS fs \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('SR other staff','sr-g@example.test','FACTORY_WAREHOUSE_STAFF','ACTIVE',:f_g) RETURNING id AS gs \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('SR warehouse staff','sr-w@example.test','WAREHOUSE_STAFF','ACTIVE',:f_w) RETURNING id AS ws \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('SR warehouse manager','sr-m@example.test','WAREHOUSE_MANAGER','ACTIVE',:f_w) RETURNING id AS wm \gset e_
INSERT INTO public.medicines(medicine_name) VALUES ('SR medicine') RETURNING id AS id \gset med_
INSERT INTO public.packaging_variants(medicine_id,unit_name) VALUES (:med_id,'box') RETURNING id AS id \gset v_
-- PO-SR-1 is shipped by carton, PO-SR-2 is rejected, PO-SR-3 is still PENDING, PO-SR-4 is shipped and then cancelled.
INSERT INTO public.purchase_orders(po_code,supplier_id,facility_id,created_by_employee_id,status) VALUES ('PO-SR-1',:f_f,:f_w,:e_wm,'APPROVED') RETURNING id AS a \gset p_
INSERT INTO public.purchase_orders(po_code,supplier_id,facility_id,created_by_employee_id,status) VALUES ('PO-SR-2',:f_f,:f_w,:e_wm,'APPROVED') RETURNING id AS b \gset p_
INSERT INTO public.purchase_orders(po_code,supplier_id,facility_id,created_by_employee_id,status) VALUES ('PO-SR-3',:f_f,:f_w,:e_wm,'PENDING') RETURNING id AS c \gset p_
INSERT INTO public.purchase_orders(po_code,supplier_id,facility_id,created_by_employee_id,status) VALUES ('PO-SR-4',:f_f,:f_w,:e_wm,'APPROVED') RETURNING id AS d \gset p_
INSERT INTO public.purchase_orders(po_code,supplier_id,facility_id,created_by_employee_id,status) VALUES ('PO-SR-5',:f_f,:f_w,:e_wm,'APPROVED') RETURNING id AS e \gset p_
INSERT INTO public.purchase_order_items(po_id,medicine_id,variant_id,quantity,unit_price) VALUES (:p_a,:med_id,:v_id,5,10) RETURNING id AS a \gset i_
INSERT INTO public.purchase_order_items(po_id,medicine_id,variant_id,quantity,unit_price) VALUES (:p_b,:med_id,:v_id,5,10) RETURNING id AS b \gset i_
INSERT INTO public.purchase_order_items(po_id,medicine_id,variant_id,quantity,unit_price) VALUES (:p_c,:med_id,:v_id,5,10) RETURNING id AS c \gset i_
INSERT INTO public.purchase_order_items(po_id,medicine_id,variant_id,quantity,unit_price) VALUES (:p_d,:med_id,:v_id,5,10) RETURNING id AS d \gset i_
INSERT INTO public.purchase_order_items(po_id,medicine_id,variant_id,quantity,unit_price) VALUES (:p_e,:med_id,:v_id,5,10) RETURNING id AS e \gset i_
SELECT set_config('test.f',:'f_f',true), set_config('test.w',:'f_w',true), set_config('test.variant',:'v_id',true),
  set_config('test.pa',:'p_a',true), set_config('test.pb',:'p_b',true), set_config('test.pc',:'p_c',true), set_config('test.pd',:'p_d',true),
  set_config('test.pe',:'p_e',true), set_config('test.ie',:'i_e',true), set_config('test.ia',:'i_a',true), set_config('test.ic',:'i_c',true), set_config('test.id',:'i_d',true),
  set_config('test.fs',:'e_fs',true), set_config('test.gs',:'e_gs',true), set_config('test.ws',:'e_ws',true);

CREATE FUNCTION pg_temp.sr_expect(expected text, statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected % but the statement succeeded: %', expected, statement;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE expected || '%' THEN RAISE; END IF;
END $$;

-- The factory registers a batch of 15 boxes in three cartons of 5, through the real intake function.
SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_type','employee',true), set_config('app.current_user_role','FACTORY_WAREHOUSE_STAFF',true),
  set_config('app.current_user_id',:'e_fs',true), set_config('app.current_unit_id',:'f_f',true);
DO $$
DECLARE cartons jsonb;
BEGIN
  cartons := jsonb_build_array(
    jsonb_build_object('sscc', 'SR-SSCC-1', 'boxes', (SELECT jsonb_agg(jsonb_build_object('uid', gen_random_uuid(), 'signature', 's')) FROM generate_series(1, 5))),
    jsonb_build_object('sscc', 'SR-SSCC-2', 'boxes', (SELECT jsonb_agg(jsonb_build_object('uid', gen_random_uuid(), 'signature', 's')) FROM generate_series(1, 5))),
    jsonb_build_object('sscc', 'SR-SSCC-3', 'boxes', (SELECT jsonb_agg(jsonb_build_object('uid', gen_random_uuid(), 'signature', 's')) FROM generate_series(1, 5))));
  PERFORM public.record_factory_batch(current_setting('test.f')::int, current_setting('test.variant')::int, 'SR-LOT-1', '2026-01-01', '2030-01-01', NULL, cartons);
END $$;

-- Warehouse staff and another factory cannot answer the order.
SELECT set_config('app.current_user_role','WAREHOUSE_STAFF',true), set_config('app.current_user_id',:'e_ws',true), set_config('app.current_unit_id',:'f_w',true);
SELECT pg_temp.sr_expect('PO_SUPPLIER_FORBIDDEN', format('SELECT public.supplier_respond_purchase_order(%s, ''REJECT'', ''No'')', :'p_a'));
SELECT pg_temp.sr_expect('PO_SUPPLIER_FORBIDDEN', format('SELECT public.supplier_ship_purchase_order(%s, ''[]'', NULL)', :'p_a'));
SELECT set_config('app.current_user_role','FACTORY_WAREHOUSE_STAFF',true), set_config('app.current_user_id',:'e_gs',true), set_config('app.current_unit_id',:'f_g',true);
SELECT pg_temp.sr_expect('PO_NOT_FOUND', format('SELECT public.supplier_respond_purchase_order(%s, ''REJECT'', ''No'')', :'p_a'));
SELECT pg_temp.sr_expect('PO_NOT_FOUND', format('SELECT public.supplier_ship_purchase_order(%s, ''[]'', NULL)', :'p_a'));

-- The supplier factory: a reject needs a reason and a PENDING order cannot be answered.
SELECT set_config('app.current_user_id',:'e_fs',true), set_config('app.current_unit_id',:'f_f',true);
SELECT pg_temp.sr_expect('PO_REJECT_REASON_REQUIRED', format('SELECT public.supplier_respond_purchase_order(%s, ''REJECT'', ''  '')', :'p_a'));
SELECT pg_temp.sr_expect('PO_INVALID_TRANSITION', format('SELECT public.supplier_respond_purchase_order(%s, ''REJECT'', ''Out of stock'')', :'p_c'));
SELECT pg_temp.sr_expect('PO_INVALID_TRANSITION', format('SELECT public.supplier_ship_purchase_order(%s, %L, NULL)', :'p_c',
  jsonb_build_array(jsonb_build_object('poItemId', :'i_c'::int, 'ssccCodes', jsonb_build_array('SR-SSCC-1')))));
SELECT public.supplier_respond_purchase_order(:p_b, 'REJECT', 'Out of stock') AS rejected \gset r_

DO $$
DECLARE
  pa int := current_setting('test.pa')::int; ia int := current_setting('test.ia')::int; pd int := current_setting('test.pd')::int; idd int := current_setting('test.id')::int;
  factory int := current_setting('test.f')::int; variant int := current_setting('test.variant')::int; warehouse int := current_setting('test.w')::int;
  one uuid; carton1 uuid[]; carton2 uuid[];
BEGIN
  SELECT array_agg(b.uid ORDER BY b.uid) INTO carton1 FROM public.medicine_boxes b JOIN public.sscc_cartons c ON c.id = b.carton_id WHERE c.sscc_code = 'SR-SSCC-1';
  SELECT array_agg(b.uid ORDER BY b.uid) INTO carton2 FROM public.medicine_boxes b JOIN public.sscc_cartons c ON c.id = b.carton_id WHERE c.sscc_code = 'SR-SSCC-2';
  IF cardinality(carton1) <> 5 THEN RAISE EXCEPTION 'The factory test boxes were not registered'; END IF;

  -- The manifest must cover the order exactly: wrong quantity, unknown line, unknown carton and unknown box are refused.
  PERFORM pg_temp.sr_expect('PO_SHIP_QUANTITY_MISMATCH', format('SELECT public.supplier_ship_purchase_order(%s, %L, NULL)', pa,
    jsonb_build_array(jsonb_build_object('poItemId', ia, 'boxUids', to_jsonb(carton1[1:4])))));
  PERFORM pg_temp.sr_expect('PO_SHIP_QUANTITY_MISMATCH', format('SELECT public.supplier_ship_purchase_order(%s, %L, NULL)', pa,
    jsonb_build_array(jsonb_build_object('poItemId', ia, 'ssccCodes', jsonb_build_array('SR-SSCC-1', 'SR-SSCC-2')))));
  PERFORM pg_temp.sr_expect('PO_SHIP_MANIFEST_INVALID', format('SELECT public.supplier_ship_purchase_order(%s, %L, NULL)', pa, '[]'));
  PERFORM pg_temp.sr_expect('PO_SHIP_MANIFEST_INVALID', format('SELECT public.supplier_ship_purchase_order(%s, %L, NULL)', pa,
    jsonb_build_array(jsonb_build_object('poItemId', ia + 9999, 'ssccCodes', jsonb_build_array('SR-SSCC-1')))));
  PERFORM pg_temp.sr_expect('GR_CARTON_INVALID', format('SELECT public.supplier_ship_purchase_order(%s, %L, NULL)', pa,
    jsonb_build_array(jsonb_build_object('poItemId', ia, 'ssccCodes', jsonb_build_array('SR-NOPE')))));
  PERFORM pg_temp.sr_expect('GR_BOX_UNAVAILABLE', format('SELECT public.supplier_ship_purchase_order(%s, %L, NULL)', pa,
    jsonb_build_array(jsonb_build_object('poItemId', ia, 'boxUids', to_jsonb(ARRAY[carton1[1], carton1[2], carton1[3], carton1[4], gen_random_uuid()])))));

  -- Shipping a whole carton reserves its boxes and the stock for this order.
  PERFORM public.supplier_ship_purchase_order(pa, jsonb_build_array(jsonb_build_object('poItemId', ia, 'ssccCodes', jsonb_build_array('SR-SSCC-1'))), 'On the truck');
  IF (SELECT status FROM public.purchase_orders WHERE id = pa) <> 'SHIPPED'
     OR (SELECT count(*) FROM public.medicine_boxes WHERE uid = ANY (carton1) AND status = 'RESERVED') <> 5
     OR (SELECT count(*) FROM public.purchase_order_boxes WHERE po_id = pa) <> 5
     OR (SELECT reserved_quantity FROM public.inventories WHERE facility_id = factory AND variant_id = variant) <> 5 THEN
    RAISE EXCEPTION 'Shipping did not reserve the carton';
  END IF;
  PERFORM pg_temp.sr_expect('PO_INVALID_TRANSITION', format('SELECT public.supplier_ship_purchase_order(%s, %L, NULL)', pa,
    jsonb_build_array(jsonb_build_object('poItemId', ia, 'ssccCodes', jsonb_build_array('SR-SSCC-2')))));

  -- Loose boxes can be shipped too, and a box reserved for one order cannot be shipped on another.
  PERFORM pg_temp.sr_expect('GR_CARTON_UNAVAILABLE', format('SELECT public.supplier_ship_purchase_order(%s, %L, NULL)', pd,
    jsonb_build_array(jsonb_build_object('poItemId', idd, 'ssccCodes', jsonb_build_array('SR-SSCC-1')))));
  PERFORM pg_temp.sr_expect('GR_BOX_UNAVAILABLE', format('SELECT public.supplier_ship_purchase_order(%s, %L, NULL)', pd,
    jsonb_build_array(jsonb_build_object('poItemId', idd, 'boxUids', to_jsonb(carton1)))));
  PERFORM public.supplier_ship_purchase_order(pd, jsonb_build_array(jsonb_build_object('poItemId', idd, 'boxUids', to_jsonb(carton2))), NULL);
  IF (SELECT reserved_quantity FROM public.inventories WHERE facility_id = factory AND variant_id = variant) <> 10 THEN
    RAISE EXCEPTION 'The second shipment did not reserve its boxes';
  END IF;

  -- Cancelling an order that was shipped but never received puts its boxes back in the factory's stock.
  UPDATE public.purchase_orders SET status = 'CANCELLED', cancel_reason = 'Lost in transit' WHERE id = pd;
  IF (SELECT count(*) FROM public.medicine_boxes WHERE uid = ANY (carton2) AND status = 'IN_STOCK' AND current_facility_id = factory) <> 5
     OR (SELECT reserved_quantity FROM public.inventories WHERE facility_id = factory AND variant_id = variant) <> 5
     OR EXISTS (SELECT FROM public.purchase_order_boxes WHERE po_id = pd) THEN
    RAISE EXCEPTION 'Cancelling did not release the reserved boxes';
  END IF;
  RAISE NOTICE 'PASS supplier ship and reject, part 1';
END $$;

-- The warehouse receives only boxes that were shipped on that order line.
SELECT set_config('app.current_user_role','WAREHOUSE_STAFF',true), set_config('app.current_user_id',:'e_ws',true), set_config('app.current_unit_id',:'f_w',true);
DO $$
DECLARE
  pa int := current_setting('test.pa')::int; ia int := current_setting('test.ia')::int; factory int := current_setting('test.f')::int;
  variant int := current_setting('test.variant')::int; warehouse int := current_setting('test.w')::int;
  carton1 uuid[]; carton3 uuid[];
BEGIN
  PERFORM set_config('app.current_user_role', 'SUPER_ADMIN', true);
  SELECT array_agg(b.uid ORDER BY b.uid) INTO carton3 FROM public.medicine_boxes b JOIN public.sscc_cartons c ON c.id = b.carton_id WHERE c.sscc_code = 'SR-SSCC-3';
  PERFORM set_config('app.current_user_role', 'WAREHOUSE_STAFF', true);
  IF carton3 IS NULL THEN carton3 := ARRAY[gen_random_uuid()]; END IF;

  -- A box the factory did not ship on this order is refused even though it is in the factory's stock.
  PERFORM pg_temp.sr_expect('GR_BOX_UNAVAILABLE', format('SELECT public.record_goods_receipt(%s, %L, NULL, %L)', pa, 'SR-RCPT-X1',
    jsonb_build_array(jsonb_build_object('poItemId', ia, 'batchNumber', 'SR-LOT-1', 'productionDate', '2026-01-01', 'expiryDate', '2030-01-01',
      'boxUids', to_jsonb(carton3[1:1])))));
  -- Receiving the shipped boxes frees the reservation and moves the stock.
  PERFORM public.record_goods_receipt(pa, 'SR-RCPT-0001', NULL, jsonb_build_array(jsonb_build_object(
    'poItemId', ia, 'batchNumber', 'SR-LOT-1', 'productionDate', '2026-01-01', 'expiryDate', '2030-01-01', 'ssccCodes', jsonb_build_array('SR-SSCC-1'))));
  -- The boxes are visible to the warehouse only now that they are at the warehouse.
  SELECT array_agg(b.uid ORDER BY b.uid) INTO carton1 FROM public.medicine_boxes b JOIN public.sscc_cartons c ON c.id = b.carton_id WHERE c.sscc_code = 'SR-SSCC-1';
  IF (SELECT status FROM public.purchase_orders WHERE id = pa) <> 'RECEIVED'
     OR (SELECT count(*) FROM public.medicine_boxes WHERE uid = ANY (carton1) AND status = 'IN_STOCK' AND current_facility_id = warehouse) <> 5
     OR (SELECT stock_quantity FROM public.inventories WHERE facility_id = factory AND variant_id = variant) <> 10
     OR (SELECT reserved_quantity FROM public.inventories WHERE facility_id = factory AND variant_id = variant) <> 0
     OR EXISTS (SELECT FROM public.purchase_order_boxes WHERE po_id = pa) THEN
    RAISE EXCEPTION 'Receiving the shipped carton did not move the stock';
  END IF;
  RAISE NOTICE 'PASS supplier ship and receive';
END $$;


-- Receiving by exception: the factory ships 5 boxes of carton 3; the warehouse reports one damaged and one missing and the
-- other three are received without scanning them again.
SELECT set_config('app.current_user_role','FACTORY_WAREHOUSE_STAFF',true), set_config('app.current_user_id',:'e_fs',true), set_config('app.current_unit_id',:'f_f',true);
DO $$
DECLARE pe int := current_setting('test.pe')::int; ie int := current_setting('test.ie')::int; carton3 uuid[];
BEGIN
  SELECT array_agg(b.uid ORDER BY b.uid) INTO carton3 FROM public.medicine_boxes b JOIN public.sscc_cartons c ON c.id = b.carton_id WHERE c.sscc_code = 'SR-SSCC-3';
  PERFORM public.supplier_ship_purchase_order(pe, jsonb_build_array(jsonb_build_object('poItemId', ie, 'boxUids', to_jsonb(carton3))), NULL);
  PERFORM set_config('test.damaged', carton3[1]::text, true);
  PERFORM set_config('test.missing', carton3[2]::text, true);
END $$;
SELECT set_config('app.current_user_role','WAREHOUSE_STAFF',true), set_config('app.current_user_id',:'e_ws',true), set_config('app.current_unit_id',:'f_w',true);
DO $$
DECLARE
  pe int := current_setting('test.pe')::int; ie int := current_setting('test.ie')::int; factory int := current_setting('test.f')::int;
  variant int := current_setting('test.variant')::int; warehouse int := current_setting('test.w')::int;
  damaged uuid := current_setting('test.damaged')::uuid; missing uuid := current_setting('test.missing')::uuid;
BEGIN
  -- A box that was not shipped on this line cannot be reported as damaged or missing.
  PERFORM pg_temp.sr_expect('GR_BOX_UNAVAILABLE', format('SELECT public.record_goods_receipt(%s, %L, NULL, %L)', pe, 'SR-RCPT-X2',
    jsonb_build_array(jsonb_build_object('poItemId', ie, 'shipped', true, 'rejectedBoxUids', jsonb_build_array(gen_random_uuid()), 'rejectReason', 'Wet'))));
  PERFORM pg_temp.sr_expect('GR_REJECT_REASON_REQUIRED', format('SELECT public.record_goods_receipt(%s, %L, NULL, %L)', pe, 'SR-RCPT-X3',
    jsonb_build_array(jsonb_build_object('poItemId', ie, 'shipped', true, 'rejectedBoxUids', jsonb_build_array(damaged)))));
  PERFORM public.record_goods_receipt(pe, 'SR-RCPT-0002', NULL, jsonb_build_array(jsonb_build_object(
    'poItemId', ie, 'shipped', true, 'rejectedBoxUids', jsonb_build_array(damaged), 'missingBoxUids', jsonb_build_array(missing), 'rejectReason', 'Crushed')));
  IF (SELECT status FROM public.purchase_orders WHERE id = pe) <> 'PARTIALLY_RECEIVED'
     OR (SELECT received_quantity FROM public.purchase_order_items WHERE id = ie) <> 4
     OR (SELECT count(*) FROM public.medicine_boxes WHERE current_facility_id = warehouse AND status = 'IN_STOCK') <> 8
     OR (SELECT count(*) FROM public.medicine_boxes WHERE uid = damaged AND status = 'QUARANTINED' AND current_facility_id = warehouse) <> 1
     OR (SELECT count(*) FROM public.purchase_order_boxes WHERE po_id = pe AND box_uid = missing) <> 1 THEN
    RAISE EXCEPTION 'Receiving by exception did not split the shipment';
  END IF;
  RAISE NOTICE 'PASS receive by exception';
END $$;

-- Closing the order short puts the missing box back in the factory's stock.
RESET ROLE;
UPDATE public.purchase_orders SET status = 'CLOSED', closed_reason = 'One box never arrived' WHERE po_code = 'PO-SR-5';
DO $$
BEGIN
  IF (SELECT status FROM public.medicine_boxes WHERE uid = current_setting('test.missing')::uuid) <> 'IN_STOCK'
     OR (SELECT reserved_quantity FROM public.inventories WHERE facility_id = current_setting('test.f')::int AND variant_id = current_setting('test.variant')::int) <> 0 THEN
    RAISE EXCEPTION 'Closing did not release the missing box';
  END IF;
END $$;


DO $$
BEGIN
  IF (SELECT status FROM public.purchase_orders WHERE po_code = 'PO-SR-2') <> 'REJECTED'
     OR (SELECT rejected_reason FROM public.purchase_orders WHERE po_code = 'PO-SR-2') <> 'Out of stock'
     OR (SELECT count(*) FROM public.purchase_order_events e JOIN public.purchase_orders p ON p.id = e.po_id
         WHERE p.po_code IN ('PO-SR-1', 'PO-SR-2', 'PO-SR-4') AND e.action IN ('SHIPPED', 'REJECTED')) <> 3 THEN
    RAISE EXCEPTION 'The supplier answers were not stored';
  END IF;
END $$;
SELECT 'po_supplier_response_test passed' AS result;
ROLLBACK;
