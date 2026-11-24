\set ON_ERROR_STOP on
-- Goods receipts: partial receipts with quarantine and payables, idempotent codes, warehouse scope and finance reads.
-- Run as owner on a disposable initialized database; every fixture is rolled back.
BEGIN;
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('GR WH A','CENTRAL_WAREHOUSE') RETURNING id AS a \gset f_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('GR WH B','BRANCH_WAREHOUSE') RETURNING id AS b \gset f_
INSERT INTO public.manufacturers(name) VALUES ('GR manufacturer') RETURNING id AS id \gset m_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('GR staff A','gr-a-s@example.test','WAREHOUSE_STAFF','ACTIVE',:f_a) RETURNING id AS staff_a \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('GR manager A','gr-a-m@example.test','WAREHOUSE_MANAGER','ACTIVE',:f_a) RETURNING id AS manager_a \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('GR staff B','gr-b-s@example.test','WAREHOUSE_STAFF','ACTIVE',:f_b) RETURNING id AS staff_b \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('GR accountant','gr-acc@example.test','ACCOUNTANT','ACTIVE',:f_a) RETURNING id AS accountant \gset e_
INSERT INTO public.medicines(medicine_name) VALUES ('GR medicine') RETURNING id AS id \gset med_
INSERT INTO public.packaging_variants(medicine_id,unit_name) VALUES (:med_id,'box') RETURNING id AS id \gset v_
INSERT INTO public.purchase_orders(po_code,supplier_manufacturer_id,facility_id,created_by_employee_id,status)
  VALUES ('PO-GR-A',:m_id,:f_a,:e_manager_a,'APPROVED') RETURNING id AS a \gset p_
INSERT INTO public.purchase_order_items(po_id,medicine_id,variant_id,quantity,unit_price) VALUES (:p_a,:med_id,:v_id,100,10) RETURNING id AS a \gset i_
INSERT INTO public.purchase_order_events(po_id,action,to_status,actor_id) VALUES (:p_a,'APPROVED','APPROVED',:e_manager_a);
SELECT set_config('test.a',:'f_a',true), set_config('test.po',:'p_a',true), set_config('test.item',:'i_a',true),
  set_config('test.variant',:'v_id',true);

SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_type','employee',true), set_config('app.current_user_role','WAREHOUSE_STAFF',true),
  set_config('app.current_user_id',:'e_staff_a',true), set_config('app.current_unit_id',:'f_a',true);

-- Direct writes are closed; everything goes through record_goods_receipt()
DO $$ BEGIN
  BEGIN
    INSERT INTO public.goods_receipts(receipt_code,po_id,facility_id,received_by_id)
      VALUES ('GR-DIRECT', current_setting('test.po')::int, current_setting('test.a')::int, current_setting('app.current_user_id')::int);
    RAISE EXCEPTION 'A receipt was written directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.accounts_payable(supplier_name,total_due_amount) VALUES ('Forged', 1);
    RAISE EXCEPTION 'A payable was written directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- 100 ordered: 60 received with 5 rejected, then 40
DO $$
DECLARE po int := current_setting('test.po')::int; item int := current_setting('test.item')::int;
  facility int := current_setting('test.a')::int; variant int := current_setting('test.variant')::int;
  first_receipt int; again int; good jsonb; bad jsonb; rest jsonb; stock int; quarantine int;
BEGIN
  good := (SELECT jsonb_agg(gen_random_uuid()) FROM generate_series(1, 55));
  bad := (SELECT jsonb_agg(gen_random_uuid()) FROM generate_series(1, 5));
  rest := (SELECT jsonb_agg(gen_random_uuid()) FROM generate_series(1, 40));
  first_receipt := public.record_goods_receipt(po, 'GR-TEST-0001', 'First delivery', jsonb_build_array(jsonb_build_object(
    'poItemId', item, 'batchNumber', 'GR-LOT-1', 'productionDate', '2026-01-01', 'expiryDate', '2028-01-01',
    'boxUids', good, 'rejectedBoxUids', bad, 'rejectReason', 'Crushed boxes')));
  IF (SELECT status FROM public.purchase_orders WHERE id = po) <> 'PARTIALLY_RECEIVED' THEN
    RAISE EXCEPTION 'First receipt did not mark the order partially received';
  END IF;
  again := public.record_goods_receipt(po, 'GR-TEST-0001', NULL, jsonb_build_array(jsonb_build_object('poItemId', item)));
  IF again <> first_receipt OR (SELECT count(*) FROM public.goods_receipts WHERE po_id = po) <> 1 THEN
    RAISE EXCEPTION 'A repeated receipt code created a second receipt';
  END IF;

  BEGIN
    PERFORM public.record_goods_receipt(po, 'GR-TEST-OVER', NULL, jsonb_build_array(jsonb_build_object(
      'poItemId', item, 'batchNumber', 'GR-LOT-1', 'productionDate', '2026-01-01', 'expiryDate', '2028-01-01',
      'boxUids', (SELECT jsonb_agg(gen_random_uuid()) FROM generate_series(1, 41)))));
    RAISE EXCEPTION 'A receipt above the ordered quantity was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE 'GR_OVER_RECEIPT%' THEN RAISE; END IF;
  END;

  -- New boxes keep the secret code the API issued with them, so the receiving warehouse can print their labels
  PERFORM public.record_goods_receipt(po, 'GR-TEST-0002', NULL, jsonb_build_array(jsonb_build_object(
    'poItemId', item, 'batchNumber', 'GR-LOT-1', 'productionDate', '2026-01-01', 'expiryDate', '2028-01-01', 'boxUids', rest,
    'signatures', (SELECT jsonb_object_agg(u, 'secret-' || u) FROM jsonb_array_elements_text(rest) AS t(u)))));
  IF (SELECT count(*) FROM public.medicine_boxes WHERE uid::text = ANY (ARRAY(SELECT jsonb_array_elements_text(rest))) AND signature = 'secret-' || uid::text) <> 40 THEN
    RAISE EXCEPTION 'The secret codes of the new boxes were not stored';
  END IF;

  SELECT stock_quantity INTO stock FROM public.inventories WHERE facility_id = facility AND variant_id = variant;
  SELECT quantity INTO quarantine FROM public.quarantine_balances WHERE facility_id = facility AND variant_id = variant;
  IF stock <> 95 OR quarantine <> 5 THEN RAISE EXCEPTION 'Stock % and quarantine % do not match 95 and 5', stock, quarantine; END IF;
  IF (SELECT status FROM public.purchase_orders WHERE id = po) <> 'RECEIVED'
     OR (SELECT received_at FROM public.purchase_orders WHERE id = po) IS NULL
     OR (SELECT received_quantity FROM public.purchase_order_items WHERE id = item) <> 100 THEN
    RAISE EXCEPTION 'Second receipt did not complete the order';
  END IF;
  IF (SELECT count(*) FROM public.medicine_boxes WHERE current_facility_id = facility AND status = 'QUARANTINED') <> 5
     OR (SELECT count(*) FROM public.medicine_boxes WHERE current_facility_id = facility AND status = 'IN_STOCK') <> 95 THEN
    RAISE EXCEPTION 'Boxes were not placed at the receiving warehouse';
  END IF;
  PERFORM set_config('app.inventory_operation', 'warehouse_read', true);
  IF (SELECT count(*) FROM public.inventory_logs WHERE facility_id = facility AND transaction_type = 'PURCHASE_IN') <> 2
     OR (SELECT count(*) FROM public.quarantine_movements WHERE origin_type = 'PO_RECEIPT' AND origin_id = first_receipt) <> 1 THEN
    RAISE EXCEPTION 'Stock and quarantine movements were not logged';
  END IF;
  PERFORM set_config('app.inventory_operation', '', true);
  IF (SELECT count(*) FROM public.purchase_order_events WHERE po_id = po AND action = 'GOODS_RECEIVED') <> 2 THEN
    RAISE EXCEPTION 'Receipts were not recorded in the order history';
  END IF;
END $$;

-- Another warehouse sees nothing and cannot receive
SELECT set_config('app.current_user_id',:'e_staff_b',true), set_config('app.current_unit_id',:'f_b',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.goods_receipts WHERE po_id = current_setting('test.po')::int) <> 0
     OR (SELECT count(*) FROM public.goods_receipt_lines l JOIN public.purchase_order_items i ON i.id = l.po_item_id
       WHERE i.po_id = current_setting('test.po')::int) <> 0
     OR (SELECT count(*) FROM public.accounts_payable WHERE po_id = current_setting('test.po')::int) <> 0 THEN
    RAISE EXCEPTION 'Warehouse B reads receipts of warehouse A';
  END IF;
  BEGIN
    PERFORM public.record_goods_receipt(current_setting('test.po')::int, 'GR-TEST-B', NULL, '[]');
    RAISE EXCEPTION 'Warehouse B received goods for warehouse A';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'PO_NOT_FOUND' THEN RAISE; END IF;
  END;
END $$;

-- Warehouse staff do not read payables; the manager of the receiving warehouse does
SELECT set_config('app.current_user_id',:'e_staff_a',true), set_config('app.current_unit_id',:'f_a',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.goods_receipts WHERE po_id = current_setting('test.po')::int) <> 2 THEN
    RAISE EXCEPTION 'Warehouse A cannot read its receipts';
  END IF;
  IF (SELECT count(*) FROM public.accounts_payable WHERE po_id = current_setting('test.po')::int) <> 0 THEN
    RAISE EXCEPTION 'Warehouse staff read payables';
  END IF;
END $$;
-- Staff read the names of the employees who acted on their orders, only inside purchase order requests
SELECT set_config('test.manager',:'e_manager_a',true), set_config('test.staff_b',:'e_staff_b',true),
  set_config('test.accountant',:'e_accountant',true);
DO $$ BEGIN
  IF EXISTS (SELECT FROM public.employees WHERE id = current_setting('test.manager')::int) THEN
    RAISE EXCEPTION 'Staff read another employee outside purchase order requests';
  END IF;
  PERFORM set_config('app.employee_operation', 'procurement_read', true);
  IF (SELECT count(*) FROM public.employees WHERE id IN (current_setting('test.manager')::int, current_setting('app.current_user_id')::int)) <> 2 THEN
    RAISE EXCEPTION 'Staff cannot read the employees who acted on their orders';
  END IF;
  IF EXISTS (SELECT FROM public.employees WHERE id IN (current_setting('test.staff_b')::int, current_setting('test.accountant')::int)) THEN
    RAISE EXCEPTION 'Staff read employees unrelated to their orders';
  END IF;
END $$;
SELECT set_config('app.current_user_id',:'e_staff_b',true), set_config('app.current_unit_id',:'f_b',true);
DO $$ BEGIN
  IF EXISTS (SELECT FROM public.employees WHERE id = current_setting('test.manager')::int) THEN
    RAISE EXCEPTION 'Warehouse B read an employee who acted only on warehouse A orders';
  END IF;
  PERFORM set_config('app.employee_operation', '', true);
END $$;
SELECT set_config('app.current_user_id',:'e_staff_a',true), set_config('app.current_unit_id',:'f_a',true);
SELECT set_config('app.current_user_role','WAREHOUSE_MANAGER',true), set_config('app.current_user_id',:'e_manager_a',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.accounts_payable WHERE po_id = current_setting('test.po')::int) <> 2 THEN
    RAISE EXCEPTION 'Warehouse manager cannot read the payables of the warehouse';
  END IF;
END $$;

-- Finance reads both payables with the accepted amounts; a pharmacist reads none
SELECT set_config('app.current_user_role','ACCOUNTANT',true), set_config('app.current_user_id',:'e_accountant',true);
DO $$ BEGIN
  IF (SELECT array_agg(total_due_amount ORDER BY id) FROM public.accounts_payable WHERE po_id = current_setting('test.po')::int)
     IS DISTINCT FROM ARRAY[550.00, 400.00]::numeric[] THEN
    RAISE EXCEPTION 'Finance does not see the expected payables';
  END IF;
  IF (SELECT count(*) FROM public.goods_receipts) <> 0 THEN RAISE EXCEPTION 'Finance reads goods receipts'; END IF;
END $$;
SELECT set_config('app.current_user_role','PHARMACIST',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.accounts_payable WHERE po_id = current_setting('test.po')::int) <> 0 THEN
    RAISE EXCEPTION 'Pharmacist reads payables';
  END IF;
  BEGIN
    PERFORM public.record_goods_receipt(current_setting('test.po')::int, 'GR-TEST-PH', NULL, '[]');
    RAISE EXCEPTION 'Pharmacist recorded a receipt';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
