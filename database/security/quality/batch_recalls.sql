\set ON_ERROR_STOP on
BEGIN;
-- Batch recalls run by SUPER_ADMIN. Creating a recall marks its batches RECALLED (box_sellable() then refuses them)
-- and quarantines their unreserved boxes at every facility. Collection releases a facility's held boxes into a
-- reserved RECALL_COLLECTION transfer, which follows the normal dispatch and receipt workflow; the received boxes
-- are quarantined again at the destination. Errors raised with an RC_* code are mapped by the API.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install batch recalls as a trusted superuser';
  END IF;
  IF to_regprocedure('public.box_sellable(uuid,date)') IS NULL OR to_regclass('public.stock_transfer_requests') IS NULL
    OR to_regclass('public.transfer_custody') IS NULL OR to_regclass('public.batch_status_events') IS NULL THEN
    RAISE EXCEPTION 'Install batch_sellability.sql, in_transit_custody.sql and stock_transfers.sql first';
  END IF;
END $$;

ALTER TABLE public.quarantine_movements DROP CONSTRAINT IF EXISTS quarantine_movements_origin_type_check;
ALTER TABLE public.quarantine_movements ADD CONSTRAINT quarantine_movements_origin_type_check
  CHECK (origin_type IN ('SHIPMENT','TRANSFER','TRANSFER_RETURN','RMA','PO_RECEIPT','RECALL'));
ALTER TABLE public.quarantine_movements DROP CONSTRAINT IF EXISTS quarantine_movements_action_check;
ALTER TABLE public.quarantine_movements ADD CONSTRAINT quarantine_movements_action_check
  CHECK (action IN ('IN','RESTOCK','FAILED_QA','COLLECT'));

CREATE TABLE IF NOT EXISTS public.batch_recalls (
  id serial PRIMARY KEY,
  recall_code varchar(30) NOT NULL UNIQUE,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  severity varchar(10) NOT NULL CHECK (severity IN ('LEVEL_1', 'LEVEL_2', 'LEVEL_3')),
  document_url text CHECK (length(btrim(document_url)) BETWEEN 1 AND 500),
  status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED')),
  created_by integer NOT NULL REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_by integer REFERENCES public.employees(id),
  closed_at timestamptz,
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL AND closed_by IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.batch_recall_batches (
  recall_id integer NOT NULL REFERENCES public.batch_recalls(id),
  batch_id integer NOT NULL REFERENCES public.batches(id),
  PRIMARY KEY (recall_id, batch_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_batch_recall_batches_batch ON public.batch_recall_batches(batch_id);

-- HOLD and COLLECT rows record the exact boxes moved at one facility; COLLECT also names the collection transfer.
CREATE TABLE IF NOT EXISTS public.batch_recall_events (
  id bigserial PRIMARY KEY,
  recall_id integer NOT NULL REFERENCES public.batch_recalls(id),
  action varchar(10) NOT NULL CHECK (action IN ('CREATE', 'HOLD', 'COLLECT', 'CLOSE')),
  facility_id integer REFERENCES public.facilities(id),
  batch_id integer REFERENCES public.batches(id),
  box_uids uuid[] NOT NULL DEFAULT '{}',
  transfer_id integer REFERENCES public.internal_transfers(id),
  actor_id integer NOT NULL REFERENCES public.employees(id),
  note text CHECK (length(btrim(note)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_batch_recall_events_recall ON public.batch_recall_events(recall_id);
CREATE INDEX IF NOT EXISTS idx_batch_recall_events_transfer ON public.batch_recall_events(transfer_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['batch_recalls', 'batch_recall_batches', 'batch_recall_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, app_user', t);
    EXECUTE format('GRANT SELECT ON public.%I TO app_user', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO app_user USING (
      current_setting('app.current_user_type', true) = 'employee' AND current_setting('app.current_user_role', true) = 'SUPER_ADMIN')$p$, t || '_read', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.recall_admin() RETURNS integer
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE actor integer := nullif(current_setting('app.current_user_id', true), '')::integer;
BEGIN
  IF actor IS NULL OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
    OR current_setting('app.current_user_role', true) IS DISTINCT FROM 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'RC_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN actor;
END $$;
REVOKE ALL ON FUNCTION public.recall_admin() FROM PUBLIC;

-- Boxes carry no variant: a batch maps to the one variant of its medicine that the facility stocks.
CREATE OR REPLACE FUNCTION public.recall_variant(target_facility integer, target_batch integer) RETURNS integer
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE variants integer[];
BEGIN
  SELECT array_agg(i.variant_id) INTO variants FROM public.inventories i
    JOIN public.packaging_variants v ON v.id = i.variant_id
    JOIN public.batches b ON b.medicine_id = v.medicine_id
    WHERE i.facility_id = target_facility AND b.id = target_batch;
  IF cardinality(variants) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'RC_VARIANT_AMBIGUOUS' USING ERRCODE = '22023'; END IF;
  RETURN variants[1];
END $$;
REVOKE ALL ON FUNCTION public.recall_variant(integer, integer) FROM PUBLIC;

-- HOLD moves unreserved boxes from on-hand stock into quarantine; COLLECT moves held boxes back as reserved stock
-- of a collection transfer. Both log the on-hand and the quarantine side.
CREATE OR REPLACE FUNCTION public.recall_move(recall integer, move text, target_facility integer, target_batch integer,
  uids uuid[], transfer integer) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  actor integer := nullif(current_setting('app.current_user_id', true), '')::integer;
  units integer := cardinality(uids) * CASE move WHEN 'HOLD' THEN 1 ELSE -1 END;
  variant integer := public.recall_variant(target_facility, target_batch);
  medicine integer; reference text; stock integer; held integer; changed integer; event bigint; log_id integer;
BEGIN
  SELECT recall_code INTO reference FROM public.batch_recalls WHERE id = recall;
  SELECT medicine_id INTO medicine FROM public.batches WHERE id = target_batch;
  UPDATE public.medicine_boxes SET status = CASE move WHEN 'HOLD' THEN 'QUARANTINED' ELSE 'RESERVED' END
    WHERE uid = ANY (uids) AND current_facility_id = target_facility;
  GET DIAGNOSTICS changed = ROW_COUNT;
  UPDATE public.inventories SET stock_quantity = stock_quantity - units,
      reserved_quantity = coalesce(reserved_quantity, 0) + greatest(-units, 0), updated_at = now()
    WHERE facility_id = target_facility AND variant_id = variant AND stock_quantity - units >= coalesce(reserved_quantity, 0) + greatest(-units, 0)
    RETURNING stock_quantity INTO stock;
  IF NOT FOUND OR changed <> cardinality(uids) THEN RAISE EXCEPTION 'RC_STOCK_MISMATCH' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.quarantine_balances(facility_id, variant_id, quantity) VALUES (target_facility, variant, 0) ON CONFLICT DO NOTHING;
  UPDATE public.quarantine_balances SET quantity = quantity + units
    WHERE facility_id = target_facility AND variant_id = variant AND quantity + units >= 0 RETURNING quantity INTO held;
  IF NOT FOUND THEN RAISE EXCEPTION 'RC_STOCK_MISMATCH' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.batch_recall_events(recall_id, action, facility_id, batch_id, box_uids, transfer_id, actor_id)
    VALUES (recall, move, target_facility, target_batch, uids, transfer, actor) RETURNING id INTO event;
  INSERT INTO public.inventory_logs(facility_id, medicine_id, variant_id, batch_id, stock_bucket, transaction_type,
      quantity_changed, previous_quantity, new_quantity, reference_code, note, performed_by_id)
    VALUES (target_facility, medicine, variant, target_batch, 'ON_HAND', CASE move WHEN 'HOLD' THEN 'RECALL_HOLD' ELSE 'RECALL_COLLECT' END,
      -units, stock + units, stock, reference, format('Recall %s: %s', lower(move), abs(units)), actor);
  INSERT INTO public.inventory_logs(facility_id, medicine_id, variant_id, batch_id, stock_bucket, transaction_type,
      quantity_changed, previous_quantity, new_quantity, reference_code, note, performed_by_id)
    VALUES (target_facility, medicine, variant, target_batch, 'QUARANTINE', CASE move WHEN 'HOLD' THEN 'RECALL_HOLD' ELSE 'RECALL_COLLECT' END,
      units, held - units, held, reference, format('Recall %s: %s', lower(move), abs(units)), actor)
    RETURNING id INTO log_id;
  INSERT INTO public.quarantine_movements(origin_type, origin_id, variant_id, action, inventory_log_id)
    VALUES ('RECALL', event::integer, variant, CASE move WHEN 'HOLD' THEN 'IN' ELSE 'COLLECT' END, log_id);
END $$;
REVOKE ALL ON FUNCTION public.recall_move(integer, text, integer, integer, uuid[], integer) FROM PUBLIC;

-- Boxes this recall still holds in quarantine where they were held.
CREATE OR REPLACE FUNCTION public.batch_recall_held(recall integer) RETURNS TABLE(facility_id integer, batch_id integer, uid uuid)
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT b.current_facility_id, b.batch_id, b.uid FROM public.batch_recall_events e
  JOIN public.medicine_boxes b ON b.uid = ANY (e.box_uids) AND b.current_facility_id = e.facility_id AND b.status = 'QUARANTINED'
  WHERE e.recall_id = recall AND e.action = 'HOLD'
$$;
REVOKE ALL ON FUNCTION public.batch_recall_held(integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.create_batch_recall(code text, recall_reason text, recall_severity text, document text, batch_ids integer[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE actor integer := public.recall_admin(); existing public.batch_recalls%ROWTYPE; created integer; lot record;
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

-- Creates one RECALL_COLLECTION transfer per facility that still holds recalled boxes. Calling it again only
-- collects boxes held since the previous call.
CREATE OR REPLACE FUNCTION public.collect_batch_recall(target integer, destination integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE actor integer := public.recall_admin(); r public.batch_recalls%ROWTYPE; source integer; transfer integer; lines jsonb;
  lot record; created integer := 0;
BEGIN
  SELECT * INTO r FROM public.batch_recalls WHERE id = target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RC_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF r.status <> 'ACTIVE' THEN RAISE EXCEPTION 'RC_NOT_ACTIVE' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT FROM public.facilities WHERE id = destination AND facility_type IN ('CENTRAL_WAREHOUSE', 'BRANCH_WAREHOUSE')) THEN
    RAISE EXCEPTION 'RC_DESTINATION_INVALID' USING ERRCODE = '22023';
  END IF;
  FOR source IN SELECT DISTINCT h.facility_id FROM public.batch_recall_held(target) h WHERE h.facility_id <> destination LOOP
    SELECT jsonb_agg(jsonb_build_object('variantId', v.id, 'medicineId', v.medicine_id, 'quantity', l.units, 'unitName', v.unit_name) ORDER BY v.id)
      INTO lines
      FROM (SELECT public.recall_variant(source, h.batch_id) AS variant, count(*)::integer AS units
            FROM public.batch_recall_held(target) h WHERE h.facility_id = source GROUP BY 1) l
      JOIN public.packaging_variants v ON v.id = l.variant;
    transfer := nextval(pg_get_serial_sequence('public.internal_transfers', 'id'));
    INSERT INTO public.internal_transfers(id, transfer_code, transfer_type, from_facility_id, to_facility_id, status, items, notes)
      VALUES (transfer, 'RCL-' || r.recall_code || '-' || transfer, 'RECALL_COLLECTION', source, destination, 'REQUESTED', lines,
        'Recall ' || r.recall_code);
    FOR lot IN SELECT h.batch_id, array_agg(h.uid) AS uids FROM public.batch_recall_held(target) h WHERE h.facility_id = source GROUP BY 1 LOOP
      PERFORM public.recall_move(target, 'COLLECT', source, lot.batch_id, lot.uids, transfer);
    END LOOP;
    created := created + 1;
  END LOOP;
  RETURN created;
END $$;
REVOKE ALL ON FUNCTION public.collect_batch_recall(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.collect_batch_recall(integer, integer) TO app_user;

CREATE OR REPLACE FUNCTION public.close_batch_recall(target integer, note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE actor integer := public.recall_admin(); r public.batch_recalls%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.batch_recalls WHERE id = target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RC_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF r.status = 'CLOSED' THEN RETURN; END IF;
  IF length(btrim(coalesce(note, ''))) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'RC_NOTE_REQUIRED' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT FROM public.batch_recall_events e JOIN public.internal_transfers t ON t.id = e.transfer_id
    WHERE e.recall_id = target AND e.action = 'COLLECT' AND t.status IN ('REQUESTED', 'DISPATCHED', 'RETURN_REQUESTED')) THEN
    RAISE EXCEPTION 'RC_COLLECTION_OPEN' USING ERRCODE = '22023';
  END IF;
  UPDATE public.batch_recalls SET status = 'CLOSED', closed_by = actor, closed_at = now() WHERE id = target;
  INSERT INTO public.batch_recall_events(recall_id, action, actor_id, note) VALUES (target, 'CLOSE', actor, btrim(note));
END $$;
REVOKE ALL ON FUNCTION public.close_batch_recall(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_batch_recall(integer, text) TO app_user;

CREATE OR REPLACE FUNCTION public.hold_received_recall_collection() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE recall integer; lot record;
BEGIN
  IF NEW.transfer_type <> 'RECALL_COLLECTION' OR NEW.status NOT IN ('RECEIVED', 'RECEIVED_WITH_DISCREPANCY')
    OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  SELECT recall_id INTO recall FROM public.batch_recall_events WHERE transfer_id = NEW.id LIMIT 1;
  FOR lot IN
    SELECT b.batch_id, array_agg(b.uid) AS uids FROM public.transfer_custody c
    JOIN public.medicine_boxes b ON b.uid = ANY (c.box_uids) AND b.current_facility_id = NEW.to_facility_id AND b.status = 'IN_STOCK'
    WHERE c.transfer_id = NEW.id GROUP BY 1
  LOOP
    PERFORM public.recall_move(recall, 'HOLD', NEW.to_facility_id, lot.batch_id, lot.uids, NEW.id);
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.hold_received_recall_collection() FROM PUBLIC, app_user;
DROP TRIGGER IF EXISTS hold_received_recall_collection ON public.internal_transfers;
CREATE TRIGGER hold_received_recall_collection AFTER UPDATE ON public.internal_transfers
  FOR EACH ROW EXECUTE FUNCTION public.hold_received_recall_collection();

-- Where every box of the recalled batches is now, and the order it was last assigned to.
CREATE OR REPLACE FUNCTION public.batch_recall_impact(target integer)
RETURNS TABLE(uid uuid, batch_id integer, batch_number text, box_status text, location text, facility_id integer,
  facility_name text, order_id integer, order_code text, order_status text, customer_id integer, customer_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM public.recall_admin();
  RETURN QUERY
    WITH boxes AS (
      SELECT b.* FROM public.medicine_boxes b JOIN public.batch_recall_batches rb ON rb.batch_id = b.batch_id WHERE rb.recall_id = target
    ), assigned AS (
      SELECT DISTINCT ON (u) u AS uid, o.id, o.order_code, o.order_status, o.customer_id
      FROM public.order_items i CROSS JOIN LATERAL unnest(i.assigned_uids) u JOIN public.orders o ON o.id = i.order_id
      WHERE u IN (SELECT boxes.uid FROM boxes) ORDER BY u, o.id DESC
    )
    SELECT b.uid, b.batch_id, lot.batch_number::text, b.status::text,
      CASE WHEN b.status = 'DELIVERED' THEN 'DELIVERED' WHEN b.status = 'IN_TRANSIT' THEN 'IN_TRANSIT'
        WHEN b.current_facility_id IS NOT NULL THEN 'FACILITY' ELSE 'OTHER' END,
      b.current_facility_id, f.facility_name::text, a.id, a.order_code::text, a.order_status::text, a.customer_id, c.full_name::text
    FROM boxes b JOIN public.batches lot ON lot.id = b.batch_id
    LEFT JOIN public.facilities f ON f.id = b.current_facility_id
    LEFT JOIN assigned a ON a.uid = b.uid
    LEFT JOIN public.customers c ON c.id = a.customer_id
    ORDER BY b.batch_id, b.uid;
END $$;
REVOKE ALL ON FUNCTION public.batch_recall_impact(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.batch_recall_impact(integer) TO app_user;

-- Work of active recalls at one facility (all facilities for SUPER_ADMIN with NULL): held stock waiting for
-- collection, collection transfers to send or receive, and unpacked orders holding recalled boxes. Those orders are
-- resolved with the existing box replacement or cancellation flow; they are never cancelled automatically.
CREATE OR REPLACE FUNCTION public.batch_recall_tasks(unit integer)
RETURNS TABLE(recall_id integer, recall_code text, severity text, kind text, facility_id integer, batch_id integer,
  batch_number text, quantity integer, transfer_id integer, transfer_code text, transfer_status text, order_id integer, order_code text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
    OR (current_setting('app.current_user_role', true) = 'STORE_MANAGER' OR public.app_role_in_group('WH_ALL')) IS NOT TRUE
    OR (current_setting('app.current_user_role', true) = 'SUPER_ADMIN' OR unit = nullif(current_setting('app.current_unit_id', true), '')::integer) IS NOT TRUE THEN
    RAISE EXCEPTION 'RC_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT r.id, r.recall_code::text, r.severity::text, 'QUARANTINED_STOCK', h.facility_id, h.batch_id, lot.batch_number::text,
      count(*)::integer, NULL::integer, NULL::text, NULL::text, NULL::integer, NULL::text
    FROM public.batch_recalls r CROSS JOIN LATERAL public.batch_recall_held(r.id) h JOIN public.batches lot ON lot.id = h.batch_id
    WHERE r.status = 'ACTIVE' AND (unit IS NULL OR h.facility_id = unit)
    GROUP BY r.id, h.facility_id, h.batch_id, lot.batch_number
    UNION ALL
    SELECT DISTINCT r.id, r.recall_code::text, r.severity::text, 'COLLECTION_TRANSFER', t.from_facility_id, NULL::integer, NULL::text,
      NULL::integer, t.id, t.transfer_code::text, t.status::text, NULL::integer, NULL::text
    FROM public.batch_recalls r JOIN public.batch_recall_events e ON e.recall_id = r.id AND e.action = 'COLLECT'
    JOIN public.internal_transfers t ON t.id = e.transfer_id
    WHERE r.status = 'ACTIVE' AND t.status IN ('REQUESTED', 'DISPATCHED', 'RETURN_REQUESTED')
      AND (unit IS NULL OR unit IN (t.from_facility_id, t.to_facility_id))
    UNION ALL
    SELECT r.id, r.recall_code::text, r.severity::text, 'ORDER_TO_RESOLVE', b.current_facility_id, b.batch_id, lot.batch_number::text,
      count(*)::integer, NULL::integer, NULL::text, NULL::text, o.id, o.order_code::text
    FROM public.batch_recalls r JOIN public.batch_recall_batches rb ON rb.recall_id = r.id
    JOIN public.medicine_boxes b ON b.batch_id = rb.batch_id AND b.status = 'RESERVED'
    JOIN public.batches lot ON lot.id = b.batch_id
    JOIN public.order_items i ON b.uid = ANY (i.assigned_uids)
    JOIN public.orders o ON o.id = i.order_id AND o.order_status NOT IN ('CANCELLED', 'COMPLETED')
    WHERE r.status = 'ACTIVE' AND (unit IS NULL OR b.current_facility_id = unit)
    GROUP BY r.id, b.current_facility_id, b.batch_id, lot.batch_number, o.id;
END $$;
REVOKE ALL ON FUNCTION public.batch_recall_tasks(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.batch_recall_tasks(integer) TO app_user;
COMMIT;
