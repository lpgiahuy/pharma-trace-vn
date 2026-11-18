\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install factory batch intake as a trusted superuser';
  END IF;
  IF to_regprocedure('public.stock_in_on_hand(integer,integer,integer,integer,integer,text,text,text,integer)') IS NULL
    OR to_regprocedure('public.po_in_scope(integer)') IS NULL
    OR public.app_role_group('FACTORY_INTAKE') IS NULL THEN
    RAISE EXCEPTION 'Install app_role_groups.sql, purchase_orders.sql and goods_receipts.sql first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.record_factory_batch(target_facility integer, target_variant integer, lot_number text,
  produced date, expires date, co_cq text, cartons jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor integer := nullif(current_setting('app.current_user_id', true), '')::integer;
  factory public.facilities%ROWTYPE;
  variant public.packaging_variants%ROWTYPE;
  carton jsonb; carton_id integer; lot integer; units integer := 0;
BEGIN
  IF actor IS NULL OR NOT public.app_role_in_group('FACTORY_INTAKE') THEN
    RAISE EXCEPTION 'FB_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO factory FROM public.facilities WHERE id = target_facility;
  IF NOT FOUND OR factory.facility_type <> 'FACTORY' OR public.po_in_scope(target_facility) IS NOT TRUE THEN
    RAISE EXCEPTION 'FB_FACTORY_REQUIRED' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO variant FROM public.packaging_variants WHERE id = target_variant;
  IF NOT FOUND THEN RAISE EXCEPTION 'FB_VARIANT_INVALID' USING ERRCODE = '22023'; END IF;
  IF nullif(btrim(lot_number), '') IS NULL OR length(lot_number) > 100 OR produced IS NULL OR expires IS NULL OR produced >= expires THEN
    RAISE EXCEPTION 'FB_BATCH_INVALID' USING ERRCODE = '22023';
  END IF;
  IF cartons IS NULL OR jsonb_typeof(cartons) <> 'array' OR jsonb_array_length(cartons) = 0 THEN
    RAISE EXCEPTION 'FB_BOXES_REQUIRED' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.batches(batch_number, medicine_id, manufacturer_source_facility_id, manufacturer_source_facility_name,
      production_date, expiry_date, initial_quantity, remaining_quantity, status, certificate_co_cq)
    VALUES (btrim(lot_number), variant.medicine_id, factory.id, factory.facility_name, produced, expires, 0, 0, 'ACTIVE',
      nullif(btrim(co_cq), ''))
    ON CONFLICT (batch_number) DO NOTHING
    RETURNING id INTO lot;
  IF lot IS NULL THEN RAISE EXCEPTION 'FB_BATCH_EXISTS' USING ERRCODE = '22023'; END IF;

  FOR carton IN SELECT value FROM jsonb_array_elements(cartons) LOOP
    INSERT INTO public.sscc_cartons(sscc_code, batch_id, current_facility_id, status, box_count)
      VALUES (carton->>'sscc', lot, factory.id, 'PACKAGED', jsonb_array_length(carton->'boxes'))
      RETURNING id INTO carton_id;
    INSERT INTO public.medicine_boxes(uid, batch_id, carton_id, current_facility_id, status, signature)
      SELECT (b->>'uid')::uuid, lot, carton_id, factory.id, 'IN_STOCK', b->>'signature'
      FROM jsonb_array_elements(carton->'boxes') b;
    units := units + jsonb_array_length(carton->'boxes');
  END LOOP;

  UPDATE public.batches SET initial_quantity = units, remaining_quantity = units WHERE id = lot;
  PERFORM public.stock_in_on_hand(factory.id, variant.medicine_id, variant.id, lot, units, 'PRODUCTION_IN',
    'FB-' || lot, format('Factory batch %s', btrim(lot_number)), actor);
  RETURN lot;
END $$;
REVOKE ALL ON FUNCTION public.record_factory_batch(integer, integer, text, date, date, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_factory_batch(integer, integer, text, date, date, text, jsonb) TO app_user;
COMMIT;
