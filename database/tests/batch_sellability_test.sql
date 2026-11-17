\set ON_ERROR_STOP on
-- box_sellable: batch status, expiry, minimum shelf life and quarantine. Run as owner on a disposable
-- initialized database; every fixture is rolled back.
BEGIN;
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('Sellability WH','WAREHOUSE') RETURNING id AS wh \gset f_
INSERT INTO public.medicines(medicine_name) VALUES ('Sellability medicine') RETURNING id AS id \gset m_
INSERT INTO public.batches(batch_number,medicine_id,production_date,expiry_date,status)
  VALUES ('SELL-OK',:m_id,current_date-10,current_date+365,'ACTIVE') RETURNING id AS ok \gset b_
INSERT INTO public.batches(batch_number,medicine_id,production_date,expiry_date,status)
  VALUES ('SELL-HOLD',:m_id,current_date-10,current_date+365,'ON_HOLD') RETURNING id AS hold \gset b_
INSERT INTO public.batches(batch_number,medicine_id,production_date,expiry_date,status)
  VALUES ('SELL-SHORT',:m_id,current_date-10,current_date+30,'ACTIVE') RETURNING id AS short \gset b_
INSERT INTO public.batches(batch_number,medicine_id,production_date,expiry_date,status)
  VALUES ('SELL-EXP',:m_id,current_date-400,current_date-1,'ACTIVE') RETURNING id AS expired \gset b_
INSERT INTO public.medicine_boxes(batch_id,current_facility_id,status) VALUES (:b_ok,:f_wh,'IN_STOCK') RETURNING uid AS ok \gset x_
INSERT INTO public.medicine_boxes(batch_id,current_facility_id,status) VALUES (:b_ok,:f_wh,'QUARANTINED') RETURNING uid AS quarantined \gset x_
INSERT INTO public.medicine_boxes(batch_id,current_facility_id,status) VALUES (:b_hold,:f_wh,'IN_STOCK') RETURNING uid AS hold \gset x_
INSERT INTO public.medicine_boxes(batch_id,current_facility_id,status) VALUES (:b_short,:f_wh,'IN_STOCK') RETURNING uid AS short \gset x_
INSERT INTO public.medicine_boxes(batch_id,current_facility_id,status) VALUES (:b_expired,:f_wh,'IN_STOCK') RETURNING uid AS expired \gset x_
SELECT set_config('test.ok',:'x_ok',true), set_config('test.quarantined',:'x_quarantined',true),
  set_config('test.hold',:'x_hold',true), set_config('test.short',:'x_short',true),
  set_config('test.expired',:'x_expired',true), set_config('test.medicine',:'m_id',true), set_config('test.wh',:'f_wh',true);

DO $$ BEGIN
  IF (SELECT count(*) FROM public.batches WHERE status IN ('HopLe','ThuHoi')) > 0 THEN RAISE EXCEPTION 'Legacy batch status remains'; END IF;
  BEGIN
    UPDATE public.batches SET status = 'UNKNOWN' WHERE batch_number = 'SELL-OK';
    RAISE EXCEPTION 'Unknown batch status was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

SET LOCAL ROLE app_user;
DO $$
DECLARE m int := current_setting('test.medicine')::int; counted int;
BEGIN
  IF NOT public.box_sellable(current_setting('test.ok')::uuid, current_date) THEN RAISE EXCEPTION 'Active box rejected'; END IF;
  IF public.box_sellable(current_setting('test.quarantined')::uuid, current_date) THEN RAISE EXCEPTION 'Quarantined box accepted'; END IF;
  IF public.box_sellable(current_setting('test.hold')::uuid, current_date) THEN RAISE EXCEPTION 'Held batch accepted'; END IF;
  IF public.box_sellable(current_setting('test.expired')::uuid, current_date) THEN RAISE EXCEPTION 'Expired batch accepted'; END IF;
  IF NOT public.box_sellable(current_setting('test.short')::uuid, current_date) THEN RAISE EXCEPTION '30-day box rejected without a minimum'; END IF;
  SELECT boxes INTO counted FROM public.unsellable_box_counts(ARRAY[m]) WHERE facility_id = current_setting('test.wh')::int;
  IF counted IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'Unsellable unreserved count is %, expected 2', counted; END IF;
  BEGIN
    PERFORM * FROM public.system_settings;
    RAISE EXCEPTION 'app_user read system settings directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- System default of 90 days excludes a box with 30 days left; a medicine override takes precedence.
UPDATE public.system_settings SET default_min_shelf_life_days = 90;
DO $$ BEGIN
  IF public.box_sellable(current_setting('test.short')::uuid, current_date) THEN RAISE EXCEPTION '30-day box accepted with a 90-day default'; END IF;
  IF NOT public.box_sellable(current_setting('test.ok')::uuid, current_date) THEN RAISE EXCEPTION '365-day box rejected with a 90-day default'; END IF;
END $$;
UPDATE public.system_settings SET default_min_shelf_life_days = 0;
UPDATE public.medicines SET min_remaining_shelf_life_days = 90 WHERE id = :m_id;
DO $$ BEGIN
  IF public.box_sellable(current_setting('test.short')::uuid, current_date) THEN RAISE EXCEPTION '30-day box accepted with a 90-day medicine minimum'; END IF;
END $$;
ROLLBACK;
\echo 'batch_sellability_test passed'
