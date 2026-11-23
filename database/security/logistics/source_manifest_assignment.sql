\set ON_ERROR_STOP on
BEGIN;
CREATE OR REPLACE FUNCTION public.prepare_dispatch_manifest(target integer, manifest jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t public.internal_transfers%ROWTYPE; ord public.orders%ROWTYPE; item public.order_items%ROWTYPE;
  line jsonb; scanned uuid[]; changed integer;
BEGIN
  SELECT * INTO t FROM public.internal_transfers WHERE id=target;
  IF t.order_id IS NOT NULL THEN SELECT * INTO ord FROM public.orders WHERE id=t.order_id FOR UPDATE; END IF;
  SELECT * INTO t FROM public.internal_transfers WHERE id=target FOR UPDATE;
  IF current_setting('app.order_operation',true) IS DISTINCT FROM 'dispatch'
    OR current_setting('app.current_user_type',true) IS DISTINCT FROM 'employee'
    OR nullif(current_setting('app.current_user_id',true),'') IS NULL
    OR NOT (coalesce(current_setting('app.current_user_role',true),'') IN ('SUPER_ADMIN','STORE_MANAGER') OR public.app_role_in_group('WH_TRANSFER'))
    OR public.order_staff(t.from_facility_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Source handoff is not authorized' USING ERRCODE='42501';
  END IF;
  IF t.id IS NULL OR t.status<>'REQUESTED' OR jsonb_typeof(manifest) IS DISTINCT FROM 'array'
    OR (t.order_id IS NOT NULL AND (ord.order_status<>'WAITING_INTERNAL_TRANSFER'
      OR coalesce(ord.prescription_review_status,'APPROVED')<>'APPROVED')) THEN
    RAISE EXCEPTION 'Transfer is not ready for source handoff' USING ERRCODE='22023';
  END IF;
  -- Stock transfers reserved quantities only; the scanned boxes are reserved here.
  -- Recall collections already reserved the recalled boxes they carry.
  FOR line IN SELECT value FROM jsonb_array_elements(manifest) WHERE t.order_id IS NULL LOOP
    SELECT array_agg(value::uuid) INTO scanned FROM jsonb_array_elements_text(line->'boxUids');
    UPDATE public.medicine_boxes b SET status='RESERVED'
      WHERE b.uid=ANY(scanned) AND b.current_facility_id=t.from_facility_id
        AND EXISTS (SELECT FROM public.batches batch JOIN jsonb_array_elements(t.items) i ON (i->>'medicineId')::integer=batch.medicine_id
          WHERE batch.id=b.batch_id AND i->>'variantId'=line->>'variantId')
        AND CASE WHEN t.transfer_type='RECALL_COLLECTION'
          THEN b.status='RESERVED' AND EXISTS (SELECT FROM public.batch_recall_events e
            WHERE e.transfer_id=t.id AND e.action='COLLECT' AND b.uid=ANY(e.box_uids))
          ELSE b.status='IN_STOCK' AND public.box_sellable(b.uid, current_date) END;
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>coalesce(cardinality(scanned),0) THEN RAISE EXCEPTION 'Scanned packages are unavailable, ineligible or belong to another medicine' USING ERRCODE='22023'; END IF;
  END LOOP;
  FOR line IN SELECT value FROM jsonb_array_elements(manifest) WHERE t.order_id IS NOT NULL LOOP
    SELECT * INTO item FROM public.order_items WHERE order_id=t.order_id
      AND variant_id=(line->>'variantId')::integer AND source_facility_id=t.from_facility_id FOR UPDATE;
    IF item.id IS NULL OR item.inventory_reserved IS NOT TRUE OR item.quantity IS DISTINCT FROM (line->>'quantity')::integer
      OR jsonb_typeof(line->'boxUids') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Scanned line does not match the source reservation' USING ERRCODE='22023';
    END IF;
    IF cardinality(item.assigned_uids)=0 AND jsonb_array_length(line->'boxUids')>0 THEN
      SELECT array_agg(value::uuid) INTO scanned FROM jsonb_array_elements_text(line->'boxUids');
      IF cardinality(scanned)<>item.quantity OR cardinality(scanned)<>(SELECT count(DISTINCT uid) FROM unnest(scanned) uid) THEN
        RAISE EXCEPTION 'Scan one unique UID for each reserved unit' USING ERRCODE='22023';
      END IF;
      UPDATE public.medicine_boxes b SET status='RESERVED'
        WHERE b.uid=ANY(scanned) AND b.current_facility_id=t.from_facility_id AND b.status='IN_STOCK'
          AND EXISTS (SELECT FROM public.batches batch WHERE batch.id=b.batch_id AND batch.medicine_id=item.medicine_id)
          AND public.box_sellable(b.uid, current_date);
      GET DIAGNOSTICS changed=ROW_COUNT;
      IF changed<>item.quantity THEN RAISE EXCEPTION 'Scanned packages are unavailable, ineligible or belong to another medicine' USING ERRCODE='22023'; END IF;
      UPDATE public.order_items SET assigned_uids=scanned WHERE id=item.id;
    ELSIF EXISTS (SELECT FROM unnest(item.assigned_uids) uid WHERE NOT public.box_sellable(uid, current_date)) THEN
      RAISE EXCEPTION 'A reserved package belongs to a held, recalled or expired batch, or lacks the minimum shelf life. Replace it before dispatch.' USING ERRCODE='22023';
    END IF;
  END LOOP;
  -- The existing validator checks completeness and exact agreement with every transfer line.
  PERFORM public.record_transfer_manifest(target,manifest);
END $$;
REVOKE ALL ON FUNCTION public.prepare_dispatch_manifest(integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_dispatch_manifest(integer,jsonb) TO app_user;
COMMIT;
