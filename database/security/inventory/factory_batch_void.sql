\set ON_ERROR_STOP on
-- Voids a factory batch registered by mistake. Allowed only while every box is still untouched in the factory:
-- no box has been scanned, reserved, packed, transferred, received or disposed of. The batch row stays as VOIDED so
-- printed labels fail verification and the history stays auditable; stock, boxes and cartons are taken out of stock.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install factory batch void as a trusted superuser';
  END IF;
  IF to_regprocedure('public.record_factory_batch(integer,integer,text,date,date,text,jsonb)') IS NULL
    OR to_regclass('public.batch_status_events') IS NULL THEN
    RAISE EXCEPTION 'Install factory_batch_intake.sql and batch_sellability.sql first';
  END IF;
END $$;

ALTER TABLE public.batches DROP CONSTRAINT IF EXISTS chk_batch_status;
ALTER TABLE public.batches ADD CONSTRAINT chk_batch_status CHECK (status IN ('ACTIVE','ON_HOLD','RECALLED','EXPIRED','VOIDED'));

CREATE OR REPLACE FUNCTION public.void_factory_batch(target_batch integer, void_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor integer := nullif(current_setting('app.current_user_id', true), '')::integer;
  lot public.batches%ROWTYPE;
  factory public.facilities%ROWTYPE;
  units integer; variant public.packaging_variants%ROWTYPE; balance integer; reason text := nullif(btrim(void_reason), '');
BEGIN
  IF actor IS NULL OR NOT public.app_role_in_group('FACTORY_INTAKE') THEN
    RAISE EXCEPTION 'FB_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF reason IS NULL OR length(reason) > 500 THEN RAISE EXCEPTION 'FB_VOID_REASON_REQUIRED' USING ERRCODE = '22023'; END IF;

  SELECT * INTO lot FROM public.batches WHERE id = target_batch FOR UPDATE;
  IF NOT FOUND OR lot.manufacturer_source_facility_id IS NULL THEN RAISE EXCEPTION 'FB_BATCH_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  SELECT * INTO factory FROM public.facilities WHERE id = lot.manufacturer_source_facility_id;
  IF factory.facility_type IS DISTINCT FROM 'FACTORY' OR public.po_in_scope(factory.id) IS NOT TRUE THEN
    RAISE EXCEPTION 'FB_FACTORY_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF lot.status IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'FB_VOID_NOT_ALLOWED' USING ERRCODE = '22023'; END IF;

  -- Everything produced must still be at the factory, in stock and untouched.
  SELECT count(*) INTO units FROM public.medicine_boxes WHERE batch_id = lot.id;
  IF units = 0 OR units <> coalesce(lot.initial_quantity, -1) OR units <> coalesce(lot.remaining_quantity, -1)
    OR EXISTS (SELECT FROM public.medicine_boxes b WHERE b.batch_id = lot.id
        AND (b.current_facility_id IS DISTINCT FROM factory.id OR b.status IS DISTINCT FROM 'IN_STOCK'))
    OR EXISTS (SELECT FROM public.sscc_cartons c WHERE c.batch_id = lot.id AND c.current_facility_id IS DISTINCT FROM factory.id)
    OR EXISTS (SELECT FROM public.box_activations a JOIN public.medicine_boxes b ON b.uid = a.uid WHERE b.batch_id = lot.id)
    OR EXISTS (SELECT FROM public.box_code_entries e JOIN public.medicine_boxes b ON b.uid = e.uid WHERE b.batch_id = lot.id)
    OR EXISTS (SELECT FROM public.qr_scan_logs q JOIN public.medicine_boxes b ON b.uid = q.uid WHERE b.batch_id = lot.id)
    OR EXISTS (SELECT FROM public.order_package_items i JOIN public.medicine_boxes b ON b.uid = i.box_uid WHERE b.batch_id = lot.id)
    OR EXISTS (SELECT FROM public.disposal_items d WHERE d.batch_id = lot.id)
    OR EXISTS (SELECT FROM public.goods_receipt_lines g WHERE g.batch_id = lot.id)
    OR EXISTS (SELECT FROM public.purchase_order_items p WHERE p.batch_id = lot.id)
    OR EXISTS (SELECT FROM public.inventory_logs l WHERE l.batch_id = lot.id AND l.transaction_type <> 'PRODUCTION_IN') THEN
    RAISE EXCEPTION 'FB_VOID_NOT_ALLOWED' USING ERRCODE = '22023';
  END IF;

  SELECT v.* INTO variant FROM public.inventory_logs l JOIN public.packaging_variants v ON v.id = l.variant_id
    WHERE l.batch_id = lot.id AND l.transaction_type = 'PRODUCTION_IN' ORDER BY l.id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'FB_VOID_NOT_ALLOWED' USING ERRCODE = '22023'; END IF;

  -- Stock that is reserved or already taken elsewhere cannot be removed.
  UPDATE public.inventories SET stock_quantity = stock_quantity - units, updated_at = now()
    WHERE facility_id = factory.id AND variant_id = variant.id
      AND stock_quantity - coalesce(reserved_quantity, 0) >= units
    RETURNING stock_quantity INTO balance;
  IF NOT FOUND THEN RAISE EXCEPTION 'FB_VOID_NOT_ALLOWED' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.inventory_logs(facility_id, medicine_id, variant_id, batch_id, stock_bucket, transaction_type,
      quantity_changed, previous_quantity, new_quantity, reference_code, note, performed_by_id)
    VALUES (factory.id, variant.medicine_id, variant.id, lot.id, 'ON_HAND', 'PRODUCTION_VOID',
      -units, balance + units, balance, 'FBV-' || lot.id, format('Voided factory batch %s: %s', lot.batch_number, reason), actor);

  UPDATE public.medicine_boxes SET status = 'VOIDED', current_facility_id = NULL WHERE batch_id = lot.id;
  UPDATE public.sscc_cartons SET status = 'VOIDED', current_facility_id = NULL WHERE batch_id = lot.id;
  UPDATE public.batches SET status = 'VOIDED', remaining_quantity = 0 WHERE id = lot.id;
  INSERT INTO public.batch_status_events(batch_id, from_status, to_status, reason, actor_id)
    VALUES (lot.id, 'ACTIVE', 'VOIDED', reason, actor);
  RETURN lot.id;
END $$;
REVOKE ALL ON FUNCTION public.void_factory_batch(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_factory_batch(integer, text) TO app_user;
COMMIT;
