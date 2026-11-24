\set ON_ERROR_STOP on
-- Lets factory staff run the quality actions for the batches their own factory made:
--   * hold / release a batch (the status change itself is a plain update; this opens the audit-event insert to them),
--   * recall a batch: create_batch_recall() also accepts factory staff, only for batches made at their factory,
--   * draft disposals of expired or quarantined boxes at the factory (WH_QUALITY = WH_ALL + factory staff).
-- Factory staff also approve, complete and cancel the disposals of their own factory (DISPOSAL_DECIDE in
-- drug_disposals.sql), since a factory has no warehouse manager. Closing a recall stays with SUPER_ADMIN.
-- Apply as a trusted superuser after app_role_groups.sql, batch_sellability.sql, batch_recalls.sql and drug_disposals.sql.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install factory quality actions as a trusted superuser';
  END IF;
  IF public.app_role_group('WH_QUALITY') IS NULL OR to_regprocedure('public.create_batch_recall(text,text,text,text,integer[])') IS NULL
    OR to_regprocedure('public.create_disposal(text,integer,text,uuid[])') IS NULL THEN
    RAISE EXCEPTION 'Install app_role_groups.sql, batch_recalls.sql and drug_disposals.sql first';
  END IF;
END $$;

-- Hold and release: factory staff may record the event only for a batch made at their own factory.
DROP POLICY IF EXISTS batch_status_event_insert ON public.batch_status_events;
CREATE POLICY batch_status_event_insert ON public.batch_status_events FOR INSERT TO app_user
  WITH CHECK (actor_id = nullif(current_setting('app.current_user_id', true), '')::integer
    AND (public.app_role_in_group('WH_MANAGER')
      OR (current_setting('app.current_user_type', true) = 'employee'
        AND current_setting('app.current_user_role', true) = 'FACTORY_WAREHOUSE_STAFF'
        AND EXISTS (SELECT FROM public.batches b WHERE b.id = batch_id
          AND b.manufacturer_source_facility_id = nullif(current_setting('app.current_unit_id', true), '')::integer))));

-- Recall: the creator is SUPER_ADMIN, or factory staff when every batch was made at their factory.
CREATE OR REPLACE FUNCTION public.recall_creator(batch_ids integer[]) RETURNS integer
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE
  actor integer := nullif(current_setting('app.current_user_id', true), '')::integer;
  unit integer := nullif(current_setting('app.current_unit_id', true), '')::integer;
BEGIN
  IF current_setting('app.current_user_role', true) = 'FACTORY_WAREHOUSE_STAFF' AND current_setting('app.current_user_type', true) = 'employee'
    AND actor IS NOT NULL AND unit IS NOT NULL AND coalesce(cardinality(batch_ids), 0) > 0
    AND NOT EXISTS (SELECT FROM unnest(batch_ids) AS t(bid) WHERE NOT EXISTS (
      SELECT FROM public.batches b WHERE b.id = t.bid AND b.manufacturer_source_facility_id = unit)) THEN
    RETURN actor;
  END IF;
  RETURN public.recall_admin();
END $$;
REVOKE ALL ON FUNCTION public.recall_creator(integer[]) FROM PUBLIC;

DROP POLICY IF EXISTS disposal_read ON public.disposals;
CREATE POLICY disposal_read ON public.disposals FOR SELECT TO app_user
  USING (public.app_role_in_group('WH_QUALITY') AND public.po_in_scope(facility_id));

CREATE OR REPLACE FUNCTION public.disposal_candidates(target_facility integer)
RETURNS TABLE(box_uid uuid, batch_id integer, batch_number text, medicine_name text, expiry_date date, source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT b.uid, b.batch_id, lot.batch_number::text, m.medicine_name::text, lot.expiry_date,
    CASE WHEN b.status <> 'QUARANTINED' THEN 'EXPIRED' WHEN lot.status = 'RECALLED' THEN 'RECALL' ELSE 'QUARANTINE' END
  FROM public.medicine_boxes b
  JOIN public.batches lot ON lot.id = b.batch_id
  LEFT JOIN public.medicines m ON m.id = lot.medicine_id
  WHERE public.app_role_in_group('WH_QUALITY') AND public.po_in_scope(target_facility) AND b.current_facility_id = target_facility
    AND (b.status = 'QUARANTINED'
      OR (b.status IN ('IN_STOCK', 'MANUFACTURED') AND (lot.status = 'EXPIRED' OR lot.expiry_date <= current_date)))
    AND NOT EXISTS (SELECT FROM public.disposal_items i JOIN public.disposals d ON d.id = i.disposal_id
      WHERE i.box_uid = b.uid AND d.status IN ('DRAFT', 'APPROVED'))
  ORDER BY lot.expiry_date, b.batch_id, b.uid
$$;
REVOKE ALL ON FUNCTION public.disposal_candidates(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.disposal_candidates(integer) TO app_user;

CREATE OR REPLACE FUNCTION public.create_disposal(disposal_ref text, target_facility integer, disposal_reason text, uids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor integer := public.disposal_actor('WH_QUALITY');
  note text := public.disposal_note(disposal_reason);
  previous public.disposals%ROWTYPE; created integer;
BEGIN
  IF target_facility IS NULL OR public.po_in_scope(target_facility) IS NOT TRUE THEN RAISE EXCEPTION 'DP_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF disposal_ref IS NULL OR disposal_ref !~ '^[A-Za-z0-9][A-Za-z0-9_-]{5,49}$' THEN RAISE EXCEPTION 'DP_CODE_INVALID' USING ERRCODE = '22023'; END IF;
  IF coalesce(cardinality(uids), 0) = 0 OR cardinality(uids) <> (SELECT count(DISTINCT u) FROM unnest(uids) u) THEN
    RAISE EXCEPTION 'DP_BOXES_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('disposal:' || disposal_ref));
  SELECT * INTO previous FROM public.disposals WHERE disposal_code = disposal_ref;
  IF FOUND THEN
    IF previous.facility_id <> target_facility OR ARRAY(SELECT box_uid FROM public.disposal_items WHERE disposal_id = previous.id ORDER BY 1)
      IS DISTINCT FROM ARRAY(SELECT u FROM unnest(uids) u ORDER BY 1) THEN
      RAISE EXCEPTION 'DP_CODE_CONFLICT' USING ERRCODE = '22023';
    END IF;
    RETURN previous.id;
  END IF;

  PERFORM 1 FROM public.medicine_boxes WHERE uid = ANY (uids) ORDER BY uid FOR UPDATE;
  IF (SELECT count(*) FROM public.disposal_candidates(target_facility) c WHERE c.box_uid = ANY (uids)) <> cardinality(uids) THEN
    RAISE EXCEPTION 'DP_BOX_NOT_ELIGIBLE' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.disposals(disposal_code, facility_id, reason, created_by_id) VALUES (disposal_ref, target_facility, note, actor)
    RETURNING id INTO created;
  INSERT INTO public.disposal_items(disposal_id, box_uid, batch_id, source)
    SELECT created, c.box_uid, c.batch_id, c.source FROM public.disposal_candidates(target_facility) c WHERE c.box_uid = ANY (uids);
  INSERT INTO public.disposal_events(disposal_id, action, to_status, actor_id, note) VALUES (created, 'CREATED', 'DRAFT', actor, note);
  RETURN created;
END $$;
REVOKE ALL ON FUNCTION public.create_disposal(text, integer, text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_disposal(text, integer, text, uuid[]) TO app_user;

CREATE OR REPLACE FUNCTION public.add_disposal_attachment(target integer, reference text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor integer := public.disposal_actor('WH_QUALITY');
  d public.disposals := public.disposal_lock(target, ARRAY['DRAFT', 'APPROVED']);
  created integer;
BEGIN
  IF (SELECT count(*) FROM public.disposal_attachments WHERE disposal_id = target) >= 5 THEN RAISE EXCEPTION 'DP_ATTACHMENT_LIMIT' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.disposal_attachments(disposal_id, image_reference, uploaded_by_id) VALUES (target, reference, actor) RETURNING id INTO created;
  INSERT INTO public.disposal_events(disposal_id, action, from_status, to_status, actor_id)
    VALUES (target, 'ATTACHMENT_ADDED', d.status, d.status, actor);
  RETURN created;
END $$;
REVOKE ALL ON FUNCTION public.add_disposal_attachment(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_disposal_attachment(integer, text) TO app_user;

CREATE OR REPLACE FUNCTION public.create_batch_recall(code text, recall_reason text, recall_severity text, document text, batch_ids integer[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE actor integer := public.recall_creator(batch_ids); existing public.batch_recalls%ROWTYPE; created integer; lot record;
BEGIN
  IF code IS NULL OR code !~ '^[A-Za-z0-9][A-Za-z0-9_-]{5,29}$' THEN RAISE EXCEPTION 'RC_CODE_INVALID' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('batch_recall:' || code));
  SELECT * INTO existing FROM public.batch_recalls WHERE recall_code = code;
  IF FOUND THEN
    IF ARRAY(SELECT batch_id FROM public.batch_recall_batches WHERE recall_id = existing.id ORDER BY 1)
      IS DISTINCT FROM ARRAY(SELECT DISTINCT unnest(batch_ids) ORDER BY 1) THEN
      RAISE EXCEPTION 'RC_CODE_TAKEN' USING ERRCODE = '22023';
    END IF;
    RETURN existing.id;
  END IF;
  PERFORM 1 FROM public.batches WHERE id = ANY (batch_ids) FOR UPDATE;
  IF coalesce(cardinality(batch_ids), 0) = 0
    OR (SELECT count(*) FROM public.batches WHERE id = ANY (batch_ids)) <> (SELECT count(DISTINCT b) FROM unnest(batch_ids) b) THEN
    RAISE EXCEPTION 'RC_BATCH_INVALID' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT FROM public.batches WHERE id = ANY (batch_ids) AND status = 'RECALLED') THEN
    RAISE EXCEPTION 'RC_BATCH_RECALLED' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.medicine_boxes WHERE batch_id = ANY (batch_ids) FOR UPDATE;

  INSERT INTO public.batch_recalls(recall_code, reason, severity, document_url, created_by)
    VALUES (code, btrim(recall_reason), recall_severity, nullif(btrim(document), ''), actor) RETURNING id INTO created;
  INSERT INTO public.batch_recall_batches(recall_id, batch_id) SELECT DISTINCT created, unnest(batch_ids);
  INSERT INTO public.batch_status_events(batch_id, from_status, to_status, reason, actor_id)
    SELECT id, status, 'RECALLED', 'Recall ' || code, actor FROM public.batches WHERE id = ANY (batch_ids);
  UPDATE public.batches SET status = 'RECALLED' WHERE id = ANY (batch_ids);
  INSERT INTO public.batch_recall_events(recall_id, action, actor_id, note) VALUES (created, 'CREATE', actor, btrim(recall_reason));
  FOR lot IN
    SELECT current_facility_id AS facility, batch_id, array_agg(uid) AS uids FROM public.medicine_boxes
    WHERE batch_id = ANY (batch_ids) AND current_facility_id IS NOT NULL AND status IN ('IN_STOCK', 'MANUFACTURED')
    GROUP BY 1, 2
  LOOP
    PERFORM public.recall_move(created, 'HOLD', lot.facility, lot.batch_id, lot.uids, NULL);
  END LOOP;
  RETURN created;
END $$;
REVOKE ALL ON FUNCTION public.create_batch_recall(text, text, text, text, integer[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_batch_recall(text, text, text, text, integer[]) TO app_user;
COMMIT;
