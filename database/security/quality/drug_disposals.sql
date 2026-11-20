\set ON_ERROR_STOP on
BEGIN;
-- Disposal of expired, quarantined and recalled boxes. Disposals are written only by the functions below; app_user can
-- read the disposals of its own warehouse. Completing a disposal needs an attachment (the disposal record) and moves
-- the boxes to DESTROYED, reducing on-hand stock for expired boxes and quarantine for quarantined and recalled ones.
-- Errors raised with a DP_* code are mapped by the API.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install drug disposals as a trusted superuser';
  END IF;
  IF to_regprocedure('public.stock_count_variant(integer,integer)') IS NULL OR to_regclass('public.batch_recalls') IS NULL THEN
    RAISE EXCEPTION 'Install stock_counts.sql and batch_recalls.sql first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.disposals (
  id serial PRIMARY KEY,
  disposal_code varchar(50) NOT NULL UNIQUE,
  facility_id integer NOT NULL REFERENCES public.facilities(id),
  status varchar(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'COMPLETED', 'CANCELLED')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  created_by_id integer NOT NULL REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by_id integer REFERENCES public.employees(id),
  approved_at timestamptz,
  completed_by_id integer REFERENCES public.employees(id),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_disposals_facility ON public.disposals(facility_id);

CREATE TABLE IF NOT EXISTS public.disposal_items (
  id serial PRIMARY KEY,
  disposal_id integer NOT NULL REFERENCES public.disposals(id),
  box_uid uuid NOT NULL REFERENCES public.medicine_boxes(uid),
  batch_id integer NOT NULL REFERENCES public.batches(id),
  source varchar(10) NOT NULL CHECK (source IN ('EXPIRED', 'QUARANTINE', 'RECALL')),
  UNIQUE (disposal_id, box_uid)
);
CREATE INDEX IF NOT EXISTS idx_disposal_items_box ON public.disposal_items(box_uid);

CREATE TABLE IF NOT EXISTS public.disposal_attachments (
  id serial PRIMARY KEY,
  disposal_id integer NOT NULL REFERENCES public.disposals(id),
  image_reference text NOT NULL,
  uploaded_by_id integer NOT NULL REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_disposal_attachments_disposal ON public.disposal_attachments(disposal_id);

CREATE TABLE IF NOT EXISTS public.disposal_events (
  id bigserial PRIMARY KEY,
  disposal_id integer NOT NULL REFERENCES public.disposals(id),
  action varchar(30) NOT NULL,
  from_status varchar(10),
  to_status varchar(10) NOT NULL,
  actor_id integer NOT NULL REFERENCES public.employees(id),
  note text CHECK (length(btrim(note)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_disposal_events_disposal ON public.disposal_events(disposal_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['disposals', 'disposal_items', 'disposal_attachments', 'disposal_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, app_user', t);
    EXECUTE format('GRANT SELECT ON public.%I TO app_user', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS disposal_read ON public.disposals;
CREATE POLICY disposal_read ON public.disposals FOR SELECT TO app_user
  USING (public.app_role_in_group('WH_ALL') AND public.po_in_scope(facility_id));
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['disposal_items', 'disposal_attachments', 'disposal_events'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO app_user USING (EXISTS (SELECT FROM public.disposals d WHERE d.id = disposal_id))',
      t || '_read', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.disposal_actor(role_group text) RETURNS integer
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE actor integer := nullif(current_setting('app.current_user_id', true), '')::integer;
BEGIN
  IF actor IS NULL OR NOT public.app_role_in_group(role_group) THEN RAISE EXCEPTION 'DP_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  RETURN actor;
END $$;
REVOKE ALL ON FUNCTION public.disposal_actor(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.disposal_lock(target integer, allowed text[]) RETURNS public.disposals
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE d public.disposals%ROWTYPE;
BEGIN
  SELECT * INTO d FROM public.disposals WHERE id = target FOR UPDATE;
  IF NOT FOUND OR public.po_in_scope(d.facility_id) IS NOT TRUE THEN RAISE EXCEPTION 'DP_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF NOT d.status = ANY (allowed) THEN RAISE EXCEPTION 'DP_INVALID_TRANSITION' USING ERRCODE = '22023'; END IF;
  RETURN d;
END $$;
REVOKE ALL ON FUNCTION public.disposal_lock(integer, text[]) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.disposal_note(text_value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
BEGIN
  IF text_value IS NULL OR length(btrim(text_value)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'DP_REASON_REQUIRED' USING ERRCODE = '22023'; END IF;
  RETURN btrim(text_value);
END $$;
REVOKE ALL ON FUNCTION public.disposal_note(text) FROM PUBLIC;

-- Boxes of the warehouse that may be disposed of and are not on another open disposal: expired boxes in stock,
-- quarantined boxes, and quarantined boxes of a recalled batch. Empty outside the caller's scope.
CREATE OR REPLACE FUNCTION public.disposal_candidates(target_facility integer)
RETURNS TABLE(box_uid uuid, batch_id integer, batch_number text, medicine_name text, expiry_date date, source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT b.uid, b.batch_id, lot.batch_number::text, m.medicine_name::text, lot.expiry_date,
    CASE WHEN b.status <> 'QUARANTINED' THEN 'EXPIRED' WHEN lot.status = 'RECALLED' THEN 'RECALL' ELSE 'QUARANTINE' END
  FROM public.medicine_boxes b
  JOIN public.batches lot ON lot.id = b.batch_id
  LEFT JOIN public.medicines m ON m.id = lot.medicine_id
  WHERE public.app_role_in_group('WH_ALL') AND public.po_in_scope(target_facility) AND b.current_facility_id = target_facility
    AND (b.status = 'QUARANTINED'
      OR (b.status IN ('IN_STOCK', 'MANUFACTURED') AND (lot.status = 'EXPIRED' OR lot.expiry_date <= current_date)))
    AND NOT EXISTS (SELECT FROM public.disposal_items i JOIN public.disposals d ON d.id = i.disposal_id
      WHERE i.box_uid = b.uid AND d.status IN ('DRAFT', 'APPROVED'))
  ORDER BY lot.expiry_date, b.batch_id, b.uid
$$;
REVOKE ALL ON FUNCTION public.disposal_candidates(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.disposal_candidates(integer) TO app_user;

-- Opens a draft for the scanned boxes. A repeated code with the same boxes returns the disposal it created.
CREATE OR REPLACE FUNCTION public.create_disposal(disposal_ref text, target_facility integer, disposal_reason text, uids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor integer := public.disposal_actor('WH_ALL');
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
  actor integer := public.disposal_actor('WH_ALL');
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

CREATE OR REPLACE FUNCTION public.approve_disposal(target integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE actor integer := public.disposal_actor('WH_MANAGER');
BEGIN
  PERFORM public.disposal_lock(target, ARRAY['DRAFT']);
  UPDATE public.disposals SET status = 'APPROVED', approved_by_id = actor, approved_at = now() WHERE id = target;
  INSERT INTO public.disposal_events(disposal_id, action, from_status, to_status, actor_id) VALUES (target, 'APPROVED', 'DRAFT', 'APPROVED', actor);
END $$;
REVOKE ALL ON FUNCTION public.approve_disposal(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_disposal(integer) TO app_user;

CREATE OR REPLACE FUNCTION public.cancel_disposal(target integer, reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor integer := public.disposal_actor('WH_MANAGER');
  note text := public.disposal_note(reason);
  d public.disposals := public.disposal_lock(target, ARRAY['DRAFT', 'APPROVED']);
BEGIN
  UPDATE public.disposals SET status = 'CANCELLED' WHERE id = target;
  INSERT INTO public.disposal_events(disposal_id, action, from_status, to_status, actor_id, note)
    VALUES (target, 'CANCELLED', d.status, 'CANCELLED', actor, note);
END $$;
REVOKE ALL ON FUNCTION public.cancel_disposal(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_disposal(integer, text) TO app_user;

-- Destroys the boxes of an approved disposal that has an attachment. Completing twice is a no-op.
CREATE OR REPLACE FUNCTION public.complete_disposal(target integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor integer := public.disposal_actor('WH_MANAGER');
  d public.disposals := public.disposal_lock(target, ARRAY['APPROVED', 'COMPLETED']);
  lot record; variant integer; medicine integer; moved integer; balance integer;
BEGIN
  IF d.status = 'COMPLETED' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT FROM public.disposal_attachments WHERE disposal_id = target) THEN RAISE EXCEPTION 'DP_ATTACHMENT_REQUIRED' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.medicine_boxes WHERE uid IN (SELECT box_uid FROM public.disposal_items WHERE disposal_id = target) ORDER BY uid FOR UPDATE;
  FOR lot IN
    SELECT i.batch_id, i.source = 'EXPIRED' AS on_hand, array_agg(i.box_uid) AS uids
    FROM public.disposal_items i WHERE i.disposal_id = target GROUP BY 1, 2 ORDER BY 1, 2
  LOOP
    variant := public.stock_count_variant(d.facility_id, lot.batch_id);
    SELECT medicine_id INTO medicine FROM public.batches WHERE id = lot.batch_id;
    PERFORM 1 FROM public.inventories WHERE facility_id = d.facility_id AND variant_id = variant FOR UPDATE;
    UPDATE public.medicine_boxes SET status = 'DESTROYED'
      WHERE uid = ANY (lot.uids) AND current_facility_id = d.facility_id
        AND status = ANY (CASE WHEN lot.on_hand THEN ARRAY['IN_STOCK', 'MANUFACTURED'] ELSE ARRAY['QUARANTINED'] END);
    GET DIAGNOSTICS moved = ROW_COUNT;
    IF moved <> cardinality(lot.uids) THEN RAISE EXCEPTION 'DP_BOX_CHANGED' USING ERRCODE = '22023'; END IF;
    IF lot.on_hand THEN
      UPDATE public.inventories SET stock_quantity = stock_quantity - moved, updated_at = now()
        WHERE facility_id = d.facility_id AND variant_id = variant AND stock_quantity - moved >= coalesce(reserved_quantity, 0)
        RETURNING stock_quantity INTO balance;
    ELSE
      UPDATE public.quarantine_balances SET quantity = quantity - moved
        WHERE facility_id = d.facility_id AND variant_id = variant AND quantity - moved >= 0
        RETURNING quantity INTO balance;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'DP_STOCK_MISMATCH' USING ERRCODE = '22023'; END IF;
    UPDATE public.batches SET remaining_quantity = greatest(0, remaining_quantity - moved) WHERE id = lot.batch_id;
    INSERT INTO public.inventory_logs(facility_id, medicine_id, variant_id, batch_id, stock_bucket, transaction_type,
        quantity_changed, previous_quantity, new_quantity, reference_code, note, performed_by_id)
      VALUES (d.facility_id, medicine, variant, lot.batch_id, CASE WHEN lot.on_hand THEN 'ON_HAND' ELSE 'QUARANTINE' END, 'DISPOSAL',
        -moved, balance + moved, balance, d.disposal_code, 'Disposal ' || d.disposal_code, actor);
  END LOOP;
  UPDATE public.disposals SET status = 'COMPLETED', completed_by_id = actor, completed_at = now() WHERE id = target;
  INSERT INTO public.disposal_events(disposal_id, action, from_status, to_status, actor_id) VALUES (target, 'COMPLETED', 'APPROVED', 'COMPLETED', actor);
END $$;
REVOKE ALL ON FUNCTION public.complete_disposal(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_disposal(integer) TO app_user;
COMMIT;
