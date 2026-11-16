\set ON_ERROR_STOP on
-- Warehouse inventory reads: own-facility scope for stock, logs and quarantine, and unchanged access for
-- other flows. Run as owner on a disposable initialized database; every fixture is rolled back.
BEGIN;
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('WH inv A','WAREHOUSE') RETURNING id AS a \gset f_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('WH inv B','WAREHOUSE') RETURNING id AS b \gset f_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('WH inv factory','FACTORY') RETURNING id AS f \gset f_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('Inv staff A','wh-inv-a@example.test','WAREHOUSE_STAFF','ACTIVE',:f_a) RETURNING id AS staff \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('Inv factory','wh-inv-f@example.test','FACTORY_WAREHOUSE_STAFF','ACTIVE',:f_f) RETURNING id AS factory \gset e_
INSERT INTO public.medicines(medicine_name) VALUES ('WH inv medicine') RETURNING id AS medicine \gset m_
INSERT INTO public.packaging_variants(medicine_id,unit_name) VALUES (:m_medicine,'box') RETURNING id AS variant \gset m_
INSERT INTO public.inventories(facility_id,variant_id,stock_quantity) VALUES (:f_a,:m_variant,10),(:f_b,:m_variant,20),(:f_f,:m_variant,30);
INSERT INTO public.inventory_logs(facility_id,variant_id,transaction_type,quantity_changed,previous_quantity,new_quantity)
  VALUES (:f_a,:m_variant,'TEST',1,0,1) RETURNING id AS a \gset l_
INSERT INTO public.inventory_logs(facility_id,variant_id,transaction_type,quantity_changed,previous_quantity,new_quantity)
  VALUES (:f_b,:m_variant,'TEST',1,0,1) RETURNING id AS b \gset l_
INSERT INTO public.quarantine_balances(facility_id,variant_id,quantity) VALUES (:f_a,:m_variant,1),(:f_b,:m_variant,2);
INSERT INTO public.quarantine_movements(origin_type,origin_id,variant_id,action,inventory_log_id)
  VALUES ('SHIPMENT',-1,:m_variant,'IN',:l_a),('SHIPMENT',-2,:m_variant,'IN',:l_b);
SELECT set_config('test.a',:'f_a',true), set_config('test.b',:'f_b',true), set_config('test.f',:'f_f',true),
  set_config('test.variant',:'m_variant',true);

SET LOCAL ROLE app_user;

-- Warehouse staff A in the warehouse read context: own facility only, no writes
SELECT set_config('app.current_user_type','employee',true), set_config('app.current_user_role','WAREHOUSE_STAFF',true),
  set_config('app.current_user_id',:'e_staff',true), set_config('app.current_unit_id',:'f_a',true),
  set_config('app.inventory_operation','warehouse_read',true);
DO $$
DECLARE v int := current_setting('test.variant')::int; facilities int[];
BEGIN
  SELECT array_agg(facility_id ORDER BY facility_id) INTO facilities FROM public.inventories WHERE variant_id = v;
  IF facilities IS DISTINCT FROM ARRAY[current_setting('test.a')::int] THEN RAISE EXCEPTION 'Staff inventory scope is wrong: %', facilities; END IF;
  SELECT array_agg(facility_id) INTO facilities FROM public.inventory_logs WHERE variant_id = v;
  IF facilities IS DISTINCT FROM ARRAY[current_setting('test.a')::int] THEN RAISE EXCEPTION 'Staff log scope is wrong: %', facilities; END IF;
  SELECT array_agg(facility_id) INTO facilities FROM public.quarantine_balances WHERE variant_id = v;
  IF facilities IS DISTINCT FROM ARRAY[current_setting('test.a')::int] THEN RAISE EXCEPTION 'Staff quarantine scope is wrong: %', facilities; END IF;
  IF (SELECT count(*) FROM public.quarantine_movements WHERE variant_id = v) <> 1 THEN RAISE EXCEPTION 'Staff movement scope is wrong'; END IF;
  UPDATE public.inventories SET stock_quantity = 0 WHERE variant_id = v;
  IF FOUND THEN RAISE EXCEPTION 'Warehouse read context changed stock'; END IF;
END $$;

-- Factory staff: own factory only
SELECT set_config('app.current_user_role','FACTORY_WAREHOUSE_STAFF',true), set_config('app.current_user_id',:'e_factory',true),
  set_config('app.current_unit_id',:'f_f',true);
DO $$ BEGIN
  IF (SELECT array_agg(facility_id) FROM public.inventories WHERE variant_id = current_setting('test.variant')::int)
     IS DISTINCT FROM ARRAY[current_setting('test.f')::int] THEN RAISE EXCEPTION 'Factory inventory scope is wrong'; END IF;
END $$;

-- SUPER_ADMIN: every facility
SELECT set_config('app.current_user_role','SUPER_ADMIN',true), set_config('app.current_unit_id','',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.inventories WHERE variant_id = current_setting('test.variant')::int) <> 3
     OR (SELECT count(*) FROM public.quarantine_balances WHERE variant_id = current_setting('test.variant')::int) <> 2 THEN
    RAISE EXCEPTION 'Super admin cannot read every facility';
  END IF;
END $$;

-- Non-warehouse role in the warehouse read context: nothing
SELECT set_config('app.current_user_role','PHARMACIST',true), set_config('app.current_unit_id',:'f_a',true);
DO $$ BEGIN
  IF EXISTS (SELECT FROM public.inventories WHERE variant_id = current_setting('test.variant')::int)
     OR EXISTS (SELECT FROM public.inventory_logs WHERE variant_id = current_setting('test.variant')::int) THEN
    RAISE EXCEPTION 'Non-warehouse role read warehouse stock';
  END IF;
END $$;

-- Other flows keep their access to stock and logs, but quarantine stays closed outside the read context
SELECT set_config('app.inventory_operation','',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.inventories WHERE variant_id = current_setting('test.variant')::int) <> 3
     OR (SELECT count(*) FROM public.inventory_logs WHERE variant_id = current_setting('test.variant')::int) <> 2 THEN
    RAISE EXCEPTION 'Default inventory access changed';
  END IF;
  IF EXISTS (SELECT FROM public.quarantine_balances) OR EXISTS (SELECT FROM public.quarantine_movements) THEN
    RAISE EXCEPTION 'Quarantine readable outside the warehouse read context';
  END IF;
END $$;

ROLLBACK;
\echo 'warehouse_inventory_rls_test passed'
