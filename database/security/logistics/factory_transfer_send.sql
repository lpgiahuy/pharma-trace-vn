\set ON_ERROR_STOP on
-- Two helpers for the sending side of a factory stock transfer:
--   * send_factory_transfer(): factory staff start a transfer to a warehouse themselves. The request is created and
--     approved in one step (the sender is the approver), stock is reserved and the usual internal transfer is made.
--     Dispatch with a scanned manifest and the warehouse's scanned receipt are unchanged.
--   * expand_dispatch_cartons(): turns scanned SSCC carton codes into the box UIDs of one dispatch manifest line, so
--     the sender can scan a carton instead of every box. Receiving at the destination stays per box.
-- Apply as a trusted superuser after stock_transfers.sql and source_manifest_assignment.sql.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install factory transfer sending as a trusted superuser';
  END IF;
  IF to_regprocedure('public.decide_stock_transfer_request(integer,text,text)') IS NULL
    OR to_regprocedure('public.prepare_dispatch_manifest(integer,jsonb)') IS NULL
    OR public.app_role_group('WH_TRANSFER') IS NULL THEN
    RAISE EXCEPTION 'Install app_role_groups.sql, stock_transfers.sql and source_manifest_assignment.sql first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.send_factory_transfer(code text, destination integer, request_lines jsonb, note text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor integer := nullif(current_setting('app.current_user_id', true), '')::integer;
  source integer := nullif(current_setting('app.current_unit_id', true), '')::integer;
  existing public.stock_transfer_requests%ROWTYPE; normalized jsonb; created integer;
BEGIN
  IF actor IS NULL OR source IS NULL OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
    OR current_setting('app.current_user_role', true) IS DISTINCT FROM 'FACTORY_WAREHOUSE_STAFF'
    OR NOT EXISTS (SELECT FROM public.facilities WHERE id = source AND facility_type = 'FACTORY') THEN
    RAISE EXCEPTION 'ST_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO existing FROM public.stock_transfer_requests WHERE request_code = code;
  IF FOUND THEN
    IF existing.from_facility_id <> source THEN RAISE EXCEPTION 'ST_CODE_TAKEN' USING ERRCODE = '23505'; END IF;
    RETURN existing.id;
  END IF;
  IF destination IS NULL OR destination = source
    OR NOT EXISTS (SELECT FROM public.facilities WHERE id = destination AND facility_type IN ('CENTRAL_WAREHOUSE', 'BRANCH_WAREHOUSE')) THEN
    RAISE EXCEPTION 'ST_DESTINATION_INVALID' USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('variantId', v.id, 'medicineId', v.medicine_id, 'quantity', (l->>'quantity')::integer, 'unitName', v.unit_name) ORDER BY v.id)
    INTO normalized
    FROM jsonb_array_elements(request_lines) l JOIN public.packaging_variants v ON v.id = (l->>'variantId')::integer
    WHERE (l->>'quantity')::integer > 0;
  IF normalized IS NULL OR jsonb_array_length(normalized) <> jsonb_array_length(request_lines)
    OR (SELECT count(DISTINCT value->>'variantId') FROM jsonb_array_elements(normalized)) <> jsonb_array_length(normalized) THEN
    RAISE EXCEPTION 'ST_LINES_INVALID' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.stock_transfer_requests(request_code, from_facility_id, to_facility_id, lines, reason, requested_by)
    VALUES (code, source, destination, normalized, nullif(btrim(note), ''), actor) RETURNING id INTO created;
  INSERT INTO public.stock_transfer_request_events(request_id, action, to_status, actor_id, note)
    VALUES (created, 'CREATE', 'REQUESTED', actor, nullif(btrim(note), ''));
  -- The sender approves its own request: this reserves the factory stock and creates the internal transfer.
  PERFORM public.decide_stock_transfer_request(created, 'APPROVE', note);
  RETURN created;
END $$;
REVOKE ALL ON FUNCTION public.send_factory_transfer(text, integer, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_factory_transfer(text, integer, jsonb, text) TO app_user;

CREATE OR REPLACE FUNCTION public.expand_dispatch_cartons(target integer, line_variant integer, carton_codes text[])
RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  t public.internal_transfers%ROWTYPE; item jsonb; carton public.sscc_cartons%ROWTYPE; code text; found_uids uuid[]; uids uuid[] := '{}';
  box_variant integer; expected integer;
BEGIN
  IF current_setting('app.order_operation', true) IS DISTINCT FROM 'dispatch'
    OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
    OR nullif(current_setting('app.current_user_id', true), '') IS NULL
    OR NOT (coalesce(current_setting('app.current_user_role', true), '') IN ('SUPER_ADMIN', 'STORE_MANAGER') OR public.app_role_in_group('WH_TRANSFER')) THEN
    RAISE EXCEPTION 'Carton expansion is not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.internal_transfers WHERE id = target;
  IF NOT FOUND OR t.status <> 'REQUESTED' OR public.order_staff(t.from_facility_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Transfer not found at the source facility' USING ERRCODE = '42501';
  END IF;
  SELECT value INTO item FROM jsonb_array_elements(t.items) WHERE (value->>'variantId')::integer = line_variant;
  IF item IS NULL THEN RAISE EXCEPTION 'Carton line does not belong to this transfer' USING ERRCODE = '22023'; END IF;
  IF carton_codes IS NULL OR cardinality(carton_codes) = 0 OR cardinality(carton_codes) > 100
    OR cardinality(carton_codes) <> (SELECT count(DISTINCT c) FROM unnest(carton_codes) c) THEN
    RAISE EXCEPTION 'Scan between 1 and 100 different cartons' USING ERRCODE = '22023';
  END IF;
  FOREACH code IN ARRAY carton_codes LOOP
    SELECT * INTO carton FROM public.sscc_cartons WHERE sscc_code = btrim(code);
    IF NOT FOUND OR carton.current_facility_id IS DISTINCT FROM t.from_facility_id OR carton.status = 'VOIDED' THEN
      RAISE EXCEPTION 'Carton % is not at the source facility', code USING ERRCODE = '22023';
    END IF;
    IF t.transfer_type = 'RECALL_COLLECTION' THEN
      -- A recall collection reserves its boxes when it is created and leaves sold or packed boxes behind, so a carton
      -- is complete when every box this collection took from it is still reserved here, not when it holds box_count.
      SELECT count(*), array_agg(b.uid ORDER BY b.uid) FILTER (WHERE b.status = 'RESERVED' AND b.current_facility_id = t.from_facility_id)
        INTO expected, found_uids
        FROM public.medicine_boxes b
        WHERE b.carton_id = carton.id AND b.uid IN (
          SELECT unnest(e.box_uids) FROM public.batch_recall_events e WHERE e.transfer_id = t.id AND e.action = 'COLLECT');
    ELSE
      SELECT array_agg(b.uid ORDER BY b.uid) INTO found_uids FROM public.medicine_boxes b
        WHERE b.carton_id = carton.id AND b.current_facility_id = t.from_facility_id AND b.status = 'IN_STOCK';
      expected := carton.box_count;
    END IF;
    IF coalesce(cardinality(found_uids), 0) = 0 OR cardinality(found_uids) <> expected THEN
      RAISE EXCEPTION 'Carton % is incomplete or has boxes that are reserved, moved or unavailable', code USING ERRCODE = '22023';
    END IF;
    -- Every box of the carton must be the medicine and packaging of this line.
    IF EXISTS (SELECT FROM public.batches batch WHERE batch.id = carton.batch_id AND batch.medicine_id IS DISTINCT FROM (item->>'medicineId')::integer) THEN
      RAISE EXCEPTION 'Carton % holds a different medicine than this line', code USING ERRCODE = '22023';
    END IF;
    SELECT l.variant_id INTO box_variant FROM public.inventory_logs l
      WHERE l.batch_id = carton.batch_id AND l.transaction_type IN ('PRODUCTION_IN', 'PURCHASE_IN') ORDER BY l.id LIMIT 1;
    IF box_variant IS NOT NULL AND box_variant <> line_variant THEN
      RAISE EXCEPTION 'Carton % holds a different packaging than this line', code USING ERRCODE = '22023';
    END IF;
    uids := uids || found_uids;
  END LOOP;
  RETURN uids;
END $$;
REVOKE ALL ON FUNCTION public.expand_dispatch_cartons(integer, integer, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expand_dispatch_cartons(integer, integer, text[]) TO app_user;
COMMIT;
