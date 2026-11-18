\set ON_ERROR_STOP on
-- Purchase orders: warehouse scope, manager-only writes, PENDING-only item changes and supplier validation.
-- Run as owner on a disposable initialized database; every fixture is rolled back.
BEGIN;
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('PO WH A','CENTRAL_WAREHOUSE') RETURNING id AS a \gset f_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('PO WH B','BRANCH_WAREHOUSE') RETURNING id AS b \gset f_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('PO factory','FACTORY') RETURNING id AS factory \gset f_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('PO pharmacy','PHARMACY') RETURNING id AS pharmacy \gset f_
INSERT INTO public.manufacturers(name) VALUES ('PO manufacturer') RETURNING id AS id \gset m_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('PO manager A','po-a-m@example.test','WAREHOUSE_MANAGER','ACTIVE',:f_a) RETURNING id AS manager_a \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('PO staff A','po-a-s@example.test','WAREHOUSE_STAFF','ACTIVE',:f_a) RETURNING id AS staff_a \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('PO manager B','po-b-m@example.test','WAREHOUSE_MANAGER','ACTIVE',:f_b) RETURNING id AS manager_b \gset e_
INSERT INTO public.medicines(medicine_name) VALUES ('PO medicine') RETURNING id AS id \gset med_
INSERT INTO public.packaging_variants(medicine_id,unit_name) VALUES (:med_id,'box') RETURNING id AS id \gset v_
INSERT INTO public.purchase_orders(po_code,supplier_manufacturer_id,facility_id,created_by_employee_id,status)
  VALUES ('PO-RLS-A',:m_id,:f_a,:e_manager_a,'PENDING') RETURNING id AS a \gset p_
INSERT INTO public.purchase_orders(po_code,supplier_manufacturer_id,facility_id,created_by_employee_id,status)
  VALUES ('PO-RLS-A-APPROVED',:m_id,:f_a,:e_manager_a,'APPROVED') RETURNING id AS approved \gset p_
INSERT INTO public.purchase_orders(po_code,supplier_manufacturer_id,facility_id,created_by_employee_id,status)
  VALUES ('PO-RLS-B',:m_id,:f_b,:e_manager_b,'PENDING') RETURNING id AS b \gset p_
INSERT INTO public.purchase_order_items(po_id,medicine_id,variant_id,quantity,unit_price)
  VALUES (:p_a,:med_id,:v_id,10,5),(:p_approved,:med_id,:v_id,10,5),(:p_b,:med_id,:v_id,10,5);
INSERT INTO public.purchase_order_events(po_id,action,to_status,actor_id) VALUES (:p_a,'CREATED','PENDING',:e_manager_a),(:p_b,'CREATED','PENDING',:e_manager_b);
SELECT set_config('test.a',:'f_a',true), set_config('test.b',:'f_b',true), set_config('test.factory',:'f_factory',true),
  set_config('test.pharmacy',:'f_pharmacy',true), set_config('test.manufacturer',:'m_id',true),
  set_config('test.po_a',:'p_a',true), set_config('test.po_approved',:'p_approved',true), set_config('test.po_b',:'p_b',true),
  set_config('test.variant',:'v_id',true), set_config('test.medicine',:'med_id',true),
  set_config('test.manager_a',:'e_manager_a',true), set_config('test.manager_b',:'e_manager_b',true);

-- Constraints that hold for every writer
DO $$ BEGIN
  BEGIN
    UPDATE public.purchase_order_items SET received_quantity = 11 WHERE po_id = current_setting('test.po_a')::int;
    RAISE EXCEPTION 'Received quantity above the ordered quantity was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.purchase_orders SET supplier_id = current_setting('test.factory')::int WHERE id = current_setting('test.po_a')::int;
    RAISE EXCEPTION 'Two suppliers on one order were accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.purchase_orders SET status = 'SHIPPED' WHERE id = current_setting('test.po_a')::int;
    RAISE EXCEPTION 'Unknown status was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT received_at FROM public.purchase_orders WHERE id = current_setting('test.po_a')::int) IS NOT NULL THEN
    RAISE EXCEPTION 'received_at is filled before goods are received';
  END IF;
END $$;

SET LOCAL ROLE app_user;

-- Warehouse staff A: reads own warehouse only, writes nothing
SELECT set_config('app.current_user_type','employee',true), set_config('app.current_user_role','WAREHOUSE_STAFF',true),
  set_config('app.current_user_id',:'e_staff_a',true), set_config('app.current_unit_id',:'f_a',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.purchase_orders WHERE id IN (current_setting('test.po_a')::int, current_setting('test.po_b')::int)) <> 1
     OR (SELECT count(*) FROM public.purchase_order_items WHERE po_id = current_setting('test.po_b')::int) <> 0
     OR (SELECT count(*) FROM public.purchase_order_items WHERE po_id = current_setting('test.po_a')::int) <> 1
     OR (SELECT count(*) FROM public.purchase_order_events WHERE po_id = current_setting('test.po_b')::int) <> 0
     OR (SELECT count(*) FROM public.purchase_order_events WHERE po_id = current_setting('test.po_a')::int) <> 1 THEN
    RAISE EXCEPTION 'Staff scope is wrong';
  END IF;
  UPDATE public.purchase_orders SET note = 'x' WHERE id = current_setting('test.po_a')::int;
  IF FOUND THEN RAISE EXCEPTION 'Staff changed a purchase order'; END IF;
  BEGIN
    INSERT INTO public.purchase_orders(po_code,supplier_manufacturer_id,facility_id,created_by_employee_id)
      VALUES ('PO-RLS-STAFF', current_setting('test.manufacturer')::int, current_setting('test.a')::int, current_setting('test.manager_a')::int);
    RAISE EXCEPTION 'Staff created a purchase order';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- Warehouse manager A
SELECT set_config('app.current_user_role','WAREHOUSE_MANAGER',true), set_config('app.current_user_id',:'e_manager_a',true);
DO $$
DECLARE a int := current_setting('test.a')::int; m int := current_setting('test.manufacturer')::int; actor int := current_setting('test.manager_a')::int;
  new_po int;
BEGIN
  IF (SELECT count(*) FROM public.purchase_orders WHERE id IN (current_setting('test.po_a')::int, current_setting('test.po_b')::int)) <> 1 THEN
    RAISE EXCEPTION 'Manager sees another warehouse';
  END IF;
  INSERT INTO public.purchase_orders(po_code,supplier_manufacturer_id,facility_id,created_by_employee_id)
    VALUES ('PO-RLS-NEW', m, a, actor) RETURNING id INTO new_po;
  INSERT INTO public.purchase_order_items(po_id,medicine_id,variant_id,quantity,unit_price)
    VALUES (new_po, current_setting('test.medicine')::int, current_setting('test.variant')::int, 1, 1);
  INSERT INTO public.purchase_order_events(po_id,action,to_status,actor_id) VALUES (new_po,'CREATED','PENDING',actor);
  INSERT INTO public.purchase_orders(po_code,supplier_id,facility_id,created_by_employee_id)
    VALUES ('PO-RLS-FACTORY', current_setting('test.factory')::int, a, actor);

  -- Other warehouse, wrong parties, forged author
  BEGIN
    INSERT INTO public.purchase_orders(po_code,supplier_manufacturer_id,facility_id,created_by_employee_id)
      VALUES ('PO-RLS-OTHER-WH', m, current_setting('test.b')::int, actor);
    RAISE EXCEPTION 'Manager created an order for another warehouse';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.purchase_orders(po_code,supplier_id,facility_id,created_by_employee_id)
      VALUES ('PO-RLS-PHARMACY-SUPPLIER', current_setting('test.pharmacy')::int, a, actor);
    RAISE EXCEPTION 'A pharmacy was accepted as supplier';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.purchase_orders(po_code,supplier_manufacturer_id,facility_id,created_by_employee_id)
      VALUES ('PO-RLS-PHARMACY-RECEIVER', m, current_setting('test.pharmacy')::int, actor);
    RAISE EXCEPTION 'A pharmacy was accepted as receiving facility';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.purchase_orders(po_code,supplier_manufacturer_id,facility_id,created_by_employee_id)
      VALUES ('PO-RLS-FORGED', m, a, current_setting('test.manager_b')::int);
    RAISE EXCEPTION 'Manager created an order in another employee name';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- Edit, approve and item changes
  UPDATE public.purchase_orders SET status = 'APPROVED', approved_by_id = actor, approved_at = now() WHERE id = current_setting('test.po_a')::int;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manager could not approve an order of own warehouse'; END IF;
  UPDATE public.purchase_orders SET status = 'CANCELLED' WHERE id = current_setting('test.po_b')::int;
  IF FOUND THEN RAISE EXCEPTION 'Manager changed an order of another warehouse'; END IF;
  BEGIN
    UPDATE public.purchase_orders SET supplier_id = current_setting('test.pharmacy')::int, supplier_manufacturer_id = NULL
      WHERE id = current_setting('test.po_approved')::int;
    RAISE EXCEPTION 'Manager switched the supplier to a pharmacy';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  DELETE FROM public.purchase_order_items WHERE po_id = current_setting('test.po_approved')::int;
  IF FOUND THEN RAISE EXCEPTION 'Items of an approved order were deleted'; END IF;
  BEGIN
    INSERT INTO public.purchase_order_items(po_id,medicine_id,variant_id,quantity,unit_price)
      VALUES (current_setting('test.po_approved')::int, current_setting('test.medicine')::int, current_setting('test.variant')::int, 1, 1);
    RAISE EXCEPTION 'An item was added to an approved order';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.purchase_order_events(po_id,action,to_status,actor_id) VALUES (current_setting('test.po_b')::int,'APPROVED','APPROVED',actor);
    RAISE EXCEPTION 'Manager wrote an event for another warehouse';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.purchase_order_events(po_id,action,to_status,actor_id) VALUES (current_setting('test.po_a')::int,'APPROVED','APPROVED',current_setting('test.manager_b')::int);
    RAISE EXCEPTION 'Manager wrote an event in another employee name';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.purchase_order_events SET note = 'edited' WHERE po_id = current_setting('test.po_a')::int;
    RAISE EXCEPTION 'Events are not append-only';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- A role outside the warehouse sees and writes nothing
SELECT set_config('app.current_user_role','PHARMACIST',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.purchase_orders) <> 0 OR (SELECT count(*) FROM public.purchase_order_items) <> 0 THEN
    RAISE EXCEPTION 'Pharmacist can read purchase orders';
  END IF;
END $$;

-- SUPER_ADMIN reaches every warehouse
SELECT set_config('app.current_user_role','SUPER_ADMIN',true), set_config('app.current_unit_id','',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.purchase_orders WHERE id IN (current_setting('test.po_a')::int, current_setting('test.po_b')::int)) <> 2 THEN
    RAISE EXCEPTION 'Super admin cannot read every warehouse';
  END IF;
  UPDATE public.purchase_orders SET note = 'admin' WHERE id = current_setting('test.po_b')::int;
  IF NOT FOUND THEN RAISE EXCEPTION 'Super admin cannot change an order'; END IF;
END $$;
ROLLBACK;
