\set ON_ERROR_STOP on
-- Stock counts and adjustments: closed direct writes, warehouse scope, idempotent codes, approval against the
-- units on hand at approval time, and the reserved-stock floor.
-- Run as owner on a disposable initialized database; every fixture is rolled back.
BEGIN;
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('SC WH A','CENTRAL_WAREHOUSE') RETURNING id AS a \gset f_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('SC WH B','BRANCH_WAREHOUSE') RETURNING id AS b \gset f_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('SC staff A','sc-a-s@example.test','WAREHOUSE_STAFF','ACTIVE',:f_a) RETURNING id AS staff_a \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('SC manager A','sc-a-m@example.test','WAREHOUSE_MANAGER','ACTIVE',:f_a) RETURNING id AS manager_a \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('SC manager B','sc-b-m@example.test','WAREHOUSE_MANAGER','ACTIVE',:f_b) RETURNING id AS manager_b \gset e_
INSERT INTO public.medicines(medicine_name) VALUES ('SC medicine') RETURNING id AS id \gset med_
INSERT INTO public.packaging_variants(medicine_id,unit_name) VALUES (:med_id,'box') RETURNING id AS id \gset v_
INSERT INTO public.batches(batch_number,medicine_id,production_date,expiry_date,status)
  VALUES ('SC-BATCH-1',:med_id,current_date-30,current_date+365,'ACTIVE') RETURNING id AS id \gset b_
INSERT INTO public.medicine_boxes(batch_id,current_facility_id,status)
  SELECT :b_id,:f_a,CASE WHEN n <= 2 THEN 'RESERVED' ELSE 'IN_STOCK' END FROM generate_series(1,10) n;
INSERT INTO public.inventories(facility_id,medicine_id,variant_id,stock_quantity,reserved_quantity) VALUES (:f_a,:med_id,:v_id,10,2);
SELECT set_config('test.a',:'f_a',true), set_config('test.b',:'f_b',true), set_config('test.batch',:'b_id',true),
  set_config('test.variant',:'v_id',true), set_config('test.medicine',:'med_id',true),
  set_config('test.staff_a',:'e_staff_a',true), set_config('test.manager_a',:'e_manager_a',true), set_config('test.manager_b',:'e_manager_b',true);

SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_type','employee',true), set_config('app.current_user_role','WAREHOUSE_STAFF',true),
  set_config('app.current_user_id',:'e_staff_a',true), set_config('app.current_unit_id',:'f_a',true);

-- Direct writes are closed and staff cannot open counts or adjust stock
DO $$ BEGIN
  BEGIN
    INSERT INTO public.stock_counts(count_code,facility_id,scope,created_by_id)
      VALUES ('SC-DIRECT', current_setting('test.a')::int, 'FULL', current_setting('app.current_user_id')::int);
    RAISE EXCEPTION 'A count was written directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.open_stock_count('SC-STAFF-1', current_setting('test.a')::int, NULL, NULL);
    RAISE EXCEPTION 'Staff opened a count';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.record_stock_adjustment(current_setting('test.a')::int, 'SC-ADJ-STAFF', current_setting('test.batch')::int, -1, 'Staff');
    RAISE EXCEPTION 'Staff adjusted stock';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- A manager of another warehouse cannot open a count for this warehouse
SELECT set_config('app.current_user_role','WAREHOUSE_MANAGER',true), set_config('app.current_user_id',:'e_manager_b',true), set_config('app.current_unit_id',:'f_b',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.open_stock_count('SC-OTHER-1', current_setting('test.a')::int, NULL, NULL);
    RAISE EXCEPTION 'Warehouse B opened a count for warehouse A';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.open_stock_count('SC-OTHER-2', current_setting('test.b')::int, NULL, NULL);
    RAISE EXCEPTION 'An empty warehouse was counted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'SC_COUNT_EMPTY' THEN RAISE; END IF;
  END;
END $$;

-- Manager A opens a batch count; the same code returns the same count
SELECT set_config('app.current_user_id',:'e_manager_a',true), set_config('app.current_unit_id',:'f_a',true);
DO $$ DECLARE c1 int; c2 int;
BEGIN
  c1 := public.open_stock_count('SC-COUNT-1', current_setting('test.a')::int, NULL, current_setting('test.batch')::int);
  c2 := public.open_stock_count('SC-COUNT-1', current_setting('test.a')::int, NULL, current_setting('test.batch')::int);
  IF c1 <> c2 THEN RAISE EXCEPTION 'A repeated code opened a second count'; END IF;
  IF (SELECT count(*) FROM public.stock_counts WHERE count_code = 'SC-COUNT-1') <> 1 THEN RAISE EXCEPTION 'Duplicate count rows'; END IF;
  IF NOT EXISTS (SELECT FROM public.stock_count_lines WHERE count_id = c1 AND variant_id = current_setting('test.variant')::int
    AND batch_id = current_setting('test.batch')::int AND system_quantity = 10 AND counted_quantity IS NULL) THEN
    RAISE EXCEPTION 'The count line does not hold the units on hand at opening';
  END IF;
  PERFORM set_config('test.count', c1::text, true);
END $$;

-- Staff count the batch; submitting before every line is counted is refused
SELECT set_config('app.current_user_role','WAREHOUSE_STAFF',true), set_config('app.current_user_id',:'e_staff_a',true);
DO $$ DECLARE c int := current_setting('test.count')::int;
BEGIN
  BEGIN
    PERFORM public.submit_stock_count(c);
    RAISE EXCEPTION 'An uncounted count was submitted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'SC_LINES_UNCOUNTED' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.save_stock_count_lines(c, ARRAY[-1], ARRAY[1]);
    RAISE EXCEPTION 'An unknown batch was saved';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'SC_LINE_INVALID' THEN RAISE; END IF;
  END;
  PERFORM public.save_stock_count_lines(c, ARRAY[current_setting('test.batch')::int], ARRAY[7]);
  PERFORM public.submit_stock_count(c);
  BEGIN
    PERFORM public.save_stock_count_lines(c, ARRAY[current_setting('test.batch')::int], ARRAY[8]);
    RAISE EXCEPTION 'A submitted count was edited';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'SC_INVALID_TRANSITION' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.approve_stock_count(c);
    RAISE EXCEPTION 'Staff approved a count';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (SELECT count(*) FROM public.stock_counts) <> 1 THEN RAISE EXCEPTION 'Staff do not read the count of their warehouse'; END IF;
END $$;

-- A box leaves the warehouse while the count is waiting for approval
RESET ROLE;
UPDATE public.medicine_boxes SET status = 'DELIVERED', current_facility_id = NULL
  WHERE uid = (SELECT uid FROM public.medicine_boxes WHERE batch_id = :b_id AND status = 'IN_STOCK' LIMIT 1);
UPDATE public.inventories SET stock_quantity = 9 WHERE facility_id = :f_a AND variant_id = :v_id;
SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_role','WAREHOUSE_MANAGER',true), set_config('app.current_user_id',:'e_manager_a',true);

-- Approval compares with the 9 units on hand now: 2 boxes go missing and the ledger follows
DO $$ DECLARE c int := current_setting('test.count')::int;
BEGIN
  PERFORM public.approve_stock_count(c);
  IF NOT EXISTS (SELECT FROM public.stock_count_lines WHERE count_id = c AND system_quantity = 10 AND counted_quantity = 7
    AND current_quantity = 9 AND difference = -2) THEN RAISE EXCEPTION 'The line does not record the quantities at approval'; END IF;
  IF (SELECT count(*) FROM public.medicine_boxes WHERE batch_id = current_setting('test.batch')::int AND status = 'MISSING') <> 2 THEN
    RAISE EXCEPTION 'The lost boxes are not marked missing';
  END IF;
  IF (SELECT count(*) FROM public.medicine_boxes WHERE batch_id = current_setting('test.batch')::int AND status = 'RESERVED') <> 2 THEN
    RAISE EXCEPTION 'A reserved box was taken';
  END IF;
  IF (SELECT stock_quantity FROM public.inventories WHERE facility_id = current_setting('test.a')::int) <> 7 THEN
    RAISE EXCEPTION 'Stock was not reduced to the counted units';
  END IF;
  IF NOT EXISTS (SELECT FROM public.inventory_logs WHERE reference_code = 'SC-COUNT-1' AND transaction_type = 'ADJUSTMENT_LOSS'
    AND batch_id = current_setting('test.batch')::int AND quantity_changed = -2 AND previous_quantity = 9 AND new_quantity = 7
    AND performed_by_id = current_setting('test.manager_a')::int) THEN RAISE EXCEPTION 'The adjustment is not in the ledger'; END IF;
  IF NOT EXISTS (SELECT FROM public.stock_count_events WHERE count_id = c AND action = 'APPROVED' AND actor_id = current_setting('test.manager_a')::int) THEN
    RAISE EXCEPTION 'The approval is not recorded';
  END IF;
  BEGIN
    PERFORM public.approve_stock_count(c);
    RAISE EXCEPTION 'A count was approved twice';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'SC_INVALID_TRANSITION' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.cancel_stock_count(c, 'Too late');
    RAISE EXCEPTION 'An approved count was cancelled';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'SC_INVALID_TRANSITION' THEN RAISE; END IF;
  END;
END $$;

-- Adjustments never go below the reserved units or restore boxes the system does not know
DO $$
DECLARE log1 int; log2 int; b int := current_setting('test.batch')::int; a int := current_setting('test.a')::int;
BEGIN
  BEGIN
    PERFORM public.record_stock_adjustment(a, 'SC-ADJ-LOW', b, -6, 'Damaged in storage');
    RAISE EXCEPTION 'Stock went below the units on hand and not reserved';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'SC_BELOW_RESERVED' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.record_stock_adjustment(a, 'SC-ADJ-HIGH', b, 3, 'Found boxes');
    RAISE EXCEPTION 'More boxes than the missing ones were restored';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'SC_GAIN_UNKNOWN_BOXES' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.record_stock_adjustment(a, 'SC-ADJ-NOTE', b, 1, '   ');
    RAISE EXCEPTION 'An adjustment without a reason was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'SC_REASON_REQUIRED' THEN RAISE; END IF;
  END;
  log1 := public.record_stock_adjustment(a, 'SC-ADJ-FOUND', b, 2, 'Missing boxes found in the cold room');
  log2 := public.record_stock_adjustment(a, 'SC-ADJ-FOUND', b, 2, 'Missing boxes found in the cold room');
  IF log1 <> log2 THEN RAISE EXCEPTION 'A repeated adjustment code booked twice'; END IF;
  IF (SELECT count(*) FROM public.inventory_logs WHERE reference_code = 'SC-ADJ-FOUND') <> 1 THEN RAISE EXCEPTION 'Duplicate ledger rows'; END IF;
  BEGIN
    PERFORM public.record_stock_adjustment(a, 'SC-ADJ-FOUND', b, 1, 'Another amount');
    RAISE EXCEPTION 'A repeated code was accepted with another quantity';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- Units on hand equal stock, and the ledger adds up from the opening 9 units
  IF (SELECT stock_quantity FROM public.inventories WHERE facility_id = a) <> 9
    OR public.stock_count_on_hand(a, b) <> 9 THEN RAISE EXCEPTION 'Stock and boxes disagree after the adjustments'; END IF;
  IF 9 + (SELECT sum(quantity_changed) FROM public.inventory_logs WHERE batch_id = b AND transaction_type LIKE 'ADJUSTMENT%') <> 9 THEN
    RAISE EXCEPTION 'Opening units plus movements do not equal closing units';
  END IF;
END $$;

-- A manager of another warehouse reads none of it
SELECT set_config('app.current_user_id',:'e_manager_b',true), set_config('app.current_unit_id',:'f_b',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.stock_counts) <> 0 OR (SELECT count(*) FROM public.stock_count_lines) <> 0
    OR (SELECT count(*) FROM public.stock_count_events) <> 0 THEN RAISE EXCEPTION 'Warehouse B reads counts of warehouse A'; END IF;
END $$;
ROLLBACK;
