\set ON_ERROR_STOP on
-- Warehouse manager access: role groups, own-warehouse scope for orders/transfers, manager-only discrepancy
-- resolution and the read-only warehouse staff roster. Run as owner on a disposable initialized database;
-- every fixture is rolled back (sequence increments are not).
BEGIN;
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('WH access A','WAREHOUSE') RETURNING id AS a \gset f_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('WH access B','WAREHOUSE') RETURNING id AS b \gset f_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('WH access pharmacy','PHARMACY') RETURNING id AS p \gset f_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('WH manager A','wh-manager-a@example.test','WAREHOUSE_MANAGER','ACTIVE',:f_a) RETURNING id AS manager \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('WH staff A','wh-staff-a@example.test','WAREHOUSE_STAFF','ACTIVE',:f_a) RETURNING id AS staff \gset e_
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('WH staff B','wh-staff-b@example.test','WAREHOUSE_STAFF','ACTIVE',:f_b);
INSERT INTO public.employees(full_name,email,role,status,facility_id) VALUES ('Factory staff A','wh-factory-a@example.test','FACTORY_WAREHOUSE_STAFF','ACTIVE',:f_a) RETURNING id AS factory \gset e_
INSERT INTO public.medicines(medicine_name) VALUES ('WH access medicine') RETURNING id AS medicine \gset m_
INSERT INTO public.packaging_variants(medicine_id,unit_name) VALUES (:m_medicine,'box') RETURNING id AS variant \gset m_
INSERT INTO public.orders(order_code,export_facility_id,order_status) VALUES ('WHA-A-'||txid_current(),:f_p,'WAITING_INTERNAL_TRANSFER') RETURNING id AS a \gset o_
INSERT INTO public.orders(order_code,export_facility_id,order_status) VALUES ('WHA-B-'||txid_current(),:f_p,'WAITING_INTERNAL_TRANSFER') RETURNING id AS b \gset o_
INSERT INTO public.internal_transfers(transfer_code,order_id,from_facility_id,to_facility_id,status,items)
  VALUES ('WHA-A-'||txid_current(),:o_a,:f_a,:f_p,'REQUESTED',jsonb_build_array(jsonb_build_object('variantId',:m_variant,'quantity',1))) RETURNING id AS a \gset t_
INSERT INTO public.internal_transfers(transfer_code,order_id,from_facility_id,to_facility_id,status,items)
  VALUES ('WHA-B-'||txid_current(),:o_b,:f_b,:f_p,'REQUESTED',jsonb_build_array(jsonb_build_object('variantId',:m_variant,'quantity',1))) RETURNING id AS b \gset t_
-- Inbound transfer to warehouse A, used for the destination-side discrepancy check.
INSERT INTO public.internal_transfers(transfer_code,order_id,from_facility_id,to_facility_id,status,items)
  VALUES ('WHA-IN-'||txid_current(),:o_b,:f_b,:f_a,'DISPATCHED',jsonb_build_array(jsonb_build_object('variantId',:m_variant,'quantity',1))) RETURNING id AS inbound \gset t_
SELECT set_config('test.a',:'f_a',true), set_config('test.b',:'f_b',true),
  set_config('test.transfer_a',:'t_a',true), set_config('test.transfer_b',:'t_b',true), set_config('test.inbound',:'t_inbound',true);

SET LOCAL ROLE app_user;

-- Role groups
SELECT set_config('app.current_user_type','employee',true), set_config('app.current_user_role','WAREHOUSE_MANAGER',true),
  set_config('app.current_user_id',:'e_manager',true), set_config('app.current_unit_id',:'f_a',true);
DO $$ BEGIN
  IF NOT public.app_role_in_group('WH_MANAGER') OR NOT public.app_role_in_group('WH_ALL') OR public.app_role_in_group('WH_STAFF') THEN
    RAISE EXCEPTION 'Warehouse manager role groups are wrong';
  END IF;
  BEGIN PERFORM public.app_role_in_group('NO_SUCH_GROUP'); RAISE EXCEPTION 'Unknown role group accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM set_config('app.current_user_type', 'customer', true);
  IF public.app_role_in_group('WH_ALL') IS DISTINCT FROM false THEN RAISE EXCEPTION 'Non-employee matched a role group'; END IF;
  PERFORM set_config('app.current_user_type', '', true);
  IF public.app_role_in_group('WH_ALL') IS DISTINCT FROM false THEN RAISE EXCEPTION 'Role group check returned NULL'; END IF;
  PERFORM set_config('app.current_user_type', 'employee', true);
END $$;

-- Manager of warehouse A: own warehouse only
SELECT set_config('app.order_operation','transfer_read',true);
DO $$ BEGIN
  IF NOT public.order_staff(current_setting('test.a')::int) OR public.order_staff(current_setting('test.b')::int) THEN
    RAISE EXCEPTION 'Manager facility scope is wrong';
  END IF;
  IF NOT EXISTS (SELECT FROM public.internal_transfers WHERE id = current_setting('test.transfer_a')::int) THEN
    RAISE EXCEPTION 'Manager cannot read own warehouse transfer';
  END IF;
  IF EXISTS (SELECT FROM public.internal_transfers WHERE id = current_setting('test.transfer_b')::int) THEN
    RAISE EXCEPTION 'Manager read another warehouse transfer';
  END IF;
  IF NOT EXISTS (SELECT FROM public.transfer_transport_staff(current_setting('test.transfer_a')::int)) THEN
    RAISE EXCEPTION 'Manager cannot list transport staff for own transfer';
  END IF;
  IF EXISTS (SELECT FROM public.transfer_transport_staff(current_setting('test.transfer_b')::int)) THEN
    RAISE EXCEPTION 'Manager listed transport staff of another warehouse';
  END IF;
END $$;
SELECT set_config('app.order_operation','dispatch',true);
DO $$ DECLARE n integer; BEGIN
  IF NOT public.order_operation_allowed() THEN RAISE EXCEPTION 'Manager cannot dispatch'; END IF;
  UPDATE public.internal_transfers SET status = status WHERE id = current_setting('test.transfer_b')::int;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'Manager updated another warehouse transfer'; END IF;
END $$;
SELECT set_config('app.order_operation','status',true);
DO $$ BEGIN
  IF public.order_operation_allowed() THEN RAISE EXCEPTION 'Manager gained order status changes'; END IF;
END $$;

-- Discrepancy resolution is manager-only: staff stop at the role gate, managers reach the state check.
SELECT set_config('app.order_operation','replace',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.resolve_transfer_discrepancy(current_setting('test.inbound')::int,'ACCEPT_SHORTAGE',NULL,'Short',NULL);
    RAISE EXCEPTION 'Resolution of a non-discrepancy transfer succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT set_config('app.current_user_role','WAREHOUSE_STAFF',true), set_config('app.current_user_id',:'e_staff',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.resolve_transfer_discrepancy(current_setting('test.inbound')::int,'ACCEPT_SHORTAGE',NULL,'Short',NULL);
    RAISE EXCEPTION 'Warehouse staff resolved a discrepancy';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- Factory warehouse staff gain nothing in this change.
SELECT set_config('app.current_user_role','FACTORY_WAREHOUSE_STAFF',true), set_config('app.current_user_id',:'e_factory',true),
  set_config('app.order_operation','transfer_read',true);
DO $$ BEGIN
  IF public.app_role_in_group('WH_ALL') OR public.order_staff(current_setting('test.a')::int) THEN
    RAISE EXCEPTION 'Factory staff gained warehouse access';
  END IF;
  IF EXISTS (SELECT FROM public.internal_transfers WHERE id = current_setting('test.transfer_a')::int) THEN
    RAISE EXCEPTION 'Factory staff read a transfer';
  END IF;
END $$;

-- Warehouse staff roster: managers read their own warehouse only, read-only; staff read nothing.
SELECT set_config('app.order_operation','',true), set_config('app.employee_operation','warehouse_read',true),
  set_config('app.current_user_role','WAREHOUSE_MANAGER',true), set_config('app.current_user_id',:'e_manager',true);
DO $$ DECLARE n integer; BEGIN
  IF (SELECT count(*) FROM public.employees WHERE email LIKE 'wh-%@example.test') <> 3
    OR EXISTS (SELECT FROM public.employees WHERE facility_id <> current_setting('test.a')::int) THEN
    RAISE EXCEPTION 'Manager roster is not limited to the own warehouse';
  END IF;
  UPDATE public.employees SET full_name = 'Changed' WHERE email = 'wh-staff-a@example.test';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'Roster read allowed an employee update'; END IF;
END $$;
SELECT set_config('app.current_user_role','WAREHOUSE_STAFF',true), set_config('app.current_user_id',:'e_staff',true);
DO $$ BEGIN
  -- auth_employee_select (app_user inherits auth_runtime) already exposes the caller's own row.
  IF EXISTS (SELECT FROM public.employees WHERE id <> current_setting('app.current_user_id')::int) THEN
    RAISE EXCEPTION 'Warehouse staff read the roster';
  END IF;
END $$;
SELECT set_config('app.current_user_role','SUPER_ADMIN',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.employees WHERE email LIKE 'wh-%@example.test') <> 4 THEN
    RAISE EXCEPTION 'Super administrator roster is incomplete';
  END IF;
END $$;
SELECT set_config('app.employee_operation','manage',true), set_config('app.current_user_role','WAREHOUSE_MANAGER',true),
  set_config('app.current_user_id',:'e_manager',true);
DO $$ BEGIN
  IF EXISTS (SELECT FROM public.employees WHERE id <> current_setting('app.current_user_id')::int) THEN
    RAISE EXCEPTION 'Warehouse manager gained employee management';
  END IF;
END $$;

RESET ROLE;
ROLLBACK;
