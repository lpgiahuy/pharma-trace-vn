\set ON_ERROR_STOP on
-- Recall collection, extended:
--   * a warehouse manager starts the collection of the recalled stock held at their own warehouse
--     (collect_recall_from_facility). The stock goes back only to the facility that started the recall (the facility of
--     the employee who created it, e.g. the factory). The super administrator still collects every facility at once
--     (collect_batch_recall) to a destination of their choice.
--     Both create the transfer through recall_collect_source(), so the transfer is the same RECALL_COLLECTION transfer and
--     close_batch_recall() keeps working unchanged.
--   * a factory may be the destination of a collection, so recalled stock can go back to where it was made. Other
--     transfer types keep their own destination rules.
--   * factory staff receive the collection transfers sent to their factory, and no other transfer type. The received
--     boxes are quarantined again by hold_received_recall_collection(), whatever the destination type.
--   * a collection transfer a warehouse manager created is dispatched under that manager's responsibility.
-- Apply as a trusted superuser after batch_recalls.sql, factory_quality_actions.sql, in_transit_custody.sql,
-- stock_transfers.sql and order_rls.sql (or factory_stock_transfers.sql). Safe to re-run.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install recall collection scope as a trusted superuser';
  END IF;
  IF to_regprocedure('public.recall_move(integer,text,integer,integer,uuid[],integer)') IS NULL
    OR to_regprocedure('public.recall_creator(integer[])') IS NULL
    OR to_regprocedure('public.consume_transfer_custody(integer,integer,integer)') IS NULL
    OR public.app_role_group('WH_TRANSFER') IS NULL THEN
    RAISE EXCEPTION 'Install batch_recalls.sql, factory_quality_actions.sql, in_transit_custody.sql and app_role_groups.sql first';
  END IF;
END $$;

-- A collection goes to a factory or a central or branch warehouse, never back to its own source.
CREATE OR REPLACE FUNCTION public.recall_collection_destination(destination integer, source integer DEFAULT NULL) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
BEGIN
  IF destination IS NULL OR destination IS NOT DISTINCT FROM source OR NOT EXISTS (SELECT FROM public.facilities
    WHERE id = destination AND facility_type IN ('FACTORY', 'CENTRAL_WAREHOUSE', 'BRANCH_WAREHOUSE')) THEN
    RAISE EXCEPTION 'RC_DESTINATION_INVALID' USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.recall_collection_destination(integer, integer) FROM PUBLIC;

-- Creates the RECALL_COLLECTION transfer of the boxes one facility still holds for a recall and moves them from
-- quarantine to the transfer's reserved stock. Returns NULL when the facility holds nothing. The callers lock the
-- recall and check who may collect.
CREATE OR REPLACE FUNCTION public.recall_collect_source(target integer, code text, source integer, destination integer, note text)
RETURNS integer LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE transfer integer; lines jsonb; lot record;
BEGIN
  SELECT jsonb_agg(jsonb_build_object('variantId', v.id, 'medicineId', v.medicine_id, 'quantity', l.units, 'unitName', v.unit_name) ORDER BY v.id)
    INTO lines
    FROM (SELECT public.recall_variant(source, h.batch_id) AS variant, count(*)::integer AS units
          FROM public.batch_recall_held(target) h WHERE h.facility_id = source GROUP BY 1) l
    JOIN public.packaging_variants v ON v.id = l.variant;
  IF lines IS NULL THEN RETURN NULL; END IF;
  transfer := nextval(pg_get_serial_sequence('public.internal_transfers', 'id'));
  INSERT INTO public.internal_transfers(id, transfer_code, transfer_type, from_facility_id, to_facility_id, status, items, notes)
    VALUES (transfer, 'RCL-' || code || '-' || transfer, 'RECALL_COLLECTION', source, destination, 'REQUESTED', lines,
      'Recall ' || code || coalesce(': ' || nullif(btrim(note), ''), ''));
  FOR lot IN SELECT h.batch_id, array_agg(h.uid) AS uids FROM public.batch_recall_held(target) h WHERE h.facility_id = source GROUP BY 1 LOOP
    PERFORM public.recall_move(target, 'COLLECT', source, lot.batch_id, lot.uids, transfer);
  END LOOP;
  RETURN transfer;
END $$;
REVOKE ALL ON FUNCTION public.recall_collect_source(integer, text, integer, integer, text) FROM PUBLIC;

-- SUPER_ADMIN: one RECALL_COLLECTION transfer per facility that still holds recalled boxes. Calling it again only
-- collects boxes held since the previous call. Unchanged except that a factory is now a valid destination.
CREATE OR REPLACE FUNCTION public.collect_batch_recall(target integer, destination integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE actor integer := public.recall_admin(); r public.batch_recalls%ROWTYPE; source integer; created integer := 0;
BEGIN
  SELECT * INTO r FROM public.batch_recalls WHERE id = target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RC_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF r.status <> 'ACTIVE' THEN RAISE EXCEPTION 'RC_NOT_ACTIVE' USING ERRCODE = '22023'; END IF;
  PERFORM public.recall_collection_destination(destination);
  FOR source IN SELECT DISTINCT h.facility_id FROM public.batch_recall_held(target) h WHERE h.facility_id <> destination LOOP
    IF public.recall_collect_source(target, r.recall_code, source, destination, NULL) IS NOT NULL THEN created := created + 1; END IF;
  END LOOP;
  RETURN created;
END $$;
REVOKE ALL ON FUNCTION public.collect_batch_recall(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.collect_batch_recall(integer, integer) TO app_user;

-- The facility that started a recall: the facility of the employee who created it. A recall the super administrator
-- started has none, so only the administrator collects its stock.
CREATE OR REPLACE FUNCTION public.recall_origin(target integer) RETURNS integer
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE origin integer;
BEGIN
  SELECT f.id INTO origin FROM public.batch_recalls r JOIN public.employees e ON e.id = r.created_by
    JOIN public.facilities f ON f.id = e.facility_id AND f.facility_type IN ('FACTORY', 'CENTRAL_WAREHOUSE', 'BRANCH_WAREHOUSE')
    WHERE r.id = target;
  IF origin IS NULL THEN RAISE EXCEPTION 'RC_ORIGIN_UNKNOWN' USING ERRCODE = '22023'; END IF;
  RETURN origin;
END $$;
REVOKE ALL ON FUNCTION public.recall_origin(integer) FROM PUBLIC;

-- WAREHOUSE_MANAGER: where the recalled stock of their warehouse goes, shown before the collection is created.
CREATE OR REPLACE FUNCTION public.recall_collection_origin(target integer) RETURNS TABLE(facility_id integer, facility_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE origin integer;
BEGIN
  IF nullif(current_setting('app.current_user_id', true), '') IS NULL OR nullif(current_setting('app.current_unit_id', true), '') IS NULL
    OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
    OR current_setting('app.current_user_role', true) IS DISTINCT FROM 'WAREHOUSE_MANAGER' THEN
    RAISE EXCEPTION 'RC_COLLECT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT FROM public.batch_recalls WHERE id = target) THEN RAISE EXCEPTION 'RC_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  origin := public.recall_origin(target);
  RETURN QUERY SELECT f.id, f.facility_name::text FROM public.facilities f WHERE f.id = origin;
END $$;
REVOKE ALL ON FUNCTION public.recall_collection_origin(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recall_collection_origin(integer) TO app_user;

-- WAREHOUSE_MANAGER: collects only the recalled stock held at the caller's own warehouse (taken from the session,
-- never from the request), back to the facility that started the recall. Idempotent: while a collection transfer of this recall from this warehouse is still open,
-- that transfer is returned instead of a new one.
CREATE OR REPLACE FUNCTION public.collect_recall_from_facility(target integer, destination integer, note text)
RETURNS TABLE(transfer_id integer, transfer_code text, to_facility_id integer, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
#variable_conflict use_column
DECLARE
  actor integer := nullif(current_setting('app.current_user_id', true), '')::integer;
  source integer := nullif(current_setting('app.current_unit_id', true), '')::integer;
  r public.batch_recalls%ROWTYPE; transfer integer; made boolean := false;
BEGIN
  IF actor IS NULL OR source IS NULL OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
    OR current_setting('app.current_user_role', true) IS DISTINCT FROM 'WAREHOUSE_MANAGER'
    OR NOT EXISTS (SELECT FROM public.employees e WHERE e.id = actor AND e.facility_id = source)
    OR NOT EXISTS (SELECT FROM public.facilities f WHERE f.id = source AND f.facility_type IN ('CENTRAL_WAREHOUSE', 'BRANCH_WAREHOUSE')) THEN
    RAISE EXCEPTION 'RC_COLLECT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(note)) > 500 THEN RAISE EXCEPTION 'RC_NOTE_TOO_LONG' USING ERRCODE = '22023'; END IF;
  SELECT * INTO r FROM public.batch_recalls WHERE id = target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RC_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF r.status <> 'ACTIVE' THEN RAISE EXCEPTION 'RC_NOT_ACTIVE' USING ERRCODE = '22023'; END IF;
  PERFORM public.recall_collection_destination(destination, source);
  IF destination <> public.recall_origin(target) THEN RAISE EXCEPTION 'RC_DESTINATION_NOT_ORIGIN' USING ERRCODE = '22023'; END IF;
  SELECT t.id INTO transfer FROM public.batch_recall_events e JOIN public.internal_transfers t ON t.id = e.transfer_id
    WHERE e.recall_id = target AND e.action = 'COLLECT' AND t.from_facility_id = source
      AND t.status IN ('REQUESTED', 'DISPATCHED', 'RETURN_REQUESTED')
    ORDER BY t.id LIMIT 1;
  IF transfer IS NULL THEN
    transfer := public.recall_collect_source(target, r.recall_code, source, destination, note);
    IF transfer IS NULL THEN RAISE EXCEPTION 'RC_NOTHING_TO_COLLECT' USING ERRCODE = '22023'; END IF;
    made := true;
  END IF;
  RETURN QUERY SELECT t.id, t.transfer_code::text, t.to_facility_id, made FROM public.internal_transfers t WHERE t.id = transfer;
END $$;
REVOKE ALL ON FUNCTION public.collect_recall_from_facility(integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.collect_recall_from_facility(integer, integer, text) TO app_user;

-- Dispatch: like a transfer made from a stock transfer request, a collection transfer a warehouse manager created is
-- handed over by that manager, the only choice. A collection the super administrator created (no employee of the
-- source facility) still offers every active employee of the source. Same as stock_transfers.sql otherwise.
CREATE OR REPLACE FUNCTION public.transfer_transport_staff(target_transfer integer)
RETURNS TABLE(id integer, full_name varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT e.id, e.full_name FROM public.employees e
 JOIN public.internal_transfers t ON t.from_facility_id = e.facility_id
 LEFT JOIN LATERAL (
   SELECT ev.actor_id FROM public.batch_recall_events ev JOIN public.employees c ON c.id = ev.actor_id
   WHERE ev.transfer_id = t.id AND ev.action = 'COLLECT' AND c.facility_id = t.from_facility_id
   ORDER BY ev.id LIMIT 1) collector ON t.transfer_type = 'RECALL_COLLECTION'
 WHERE t.id = target_transfer AND e.status = 'ACTIVE'
 AND (t.request_id IS NULL OR e.id = (SELECT r.decided_by FROM public.stock_transfer_requests r WHERE r.id = t.request_id))
 AND (collector.actor_id IS NULL OR e.id = collector.actor_id)
 AND current_setting('app.order_operation', true) IN ('transfer_read', 'dispatch')
 AND current_setting('app.current_user_type', true) = 'employee'
 AND (current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER') OR public.app_role_in_group('WH_TRANSFER'))
 AND public.order_staff(t.from_facility_id)
 ORDER BY e.full_name, e.id
$$;
REVOKE ALL ON FUNCTION public.transfer_transport_staff(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_transport_staff(integer) TO app_user;

-- Receiving: factory staff join the 'receive' operation (order_write_guard checks it on every transfer write).
-- consume_transfer_custody() below limits them to recall collections sent to their own factory.
-- Keep in step with order_rls.sql and factory_stock_transfers.sql.
CREATE OR REPLACE FUNCTION public.order_operation_allowed() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
    SELECT CASE
      WHEN public.order_job() THEN true
      WHEN current_setting('app.order_operation', true) IN ('checkout', 'cancel') THEN
        public.order_customer(NULLIF(current_setting('app.current_user_id', true), '')::integer)
      WHEN current_setting('app.current_user_type', true) = 'employee' THEN
        CASE current_setting('app.order_operation', true)
          WHEN 'status' THEN current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST')
          WHEN 'pack' THEN (current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST') OR public.app_role_in_group('WH_ALL'))
          WHEN 'dispatch' THEN (current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER') OR public.app_role_in_group('WH_TRANSFER'))
          WHEN 'receive' THEN (current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER', 'FACTORY_WAREHOUSE_STAFF') OR public.app_role_in_group('WH_ALL'))
          WHEN 'replace' THEN (current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER') OR public.app_role_in_group('WH_ALL'))
          WHEN 'prescription' THEN current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'PHARMACIST')
          ELSE false END
      ELSE false END
$$;
REVOKE ALL ON FUNCTION public.order_operation_allowed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.order_operation_allowed() TO app_user;

-- Keep in step with in_transit_custody.sql.
CREATE OR REPLACE FUNCTION public.consume_transfer_custody(target integer, variant integer, units integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t public.internal_transfers%ROWTYPE; remaining integer;
BEGIN
  SELECT * INTO t FROM public.internal_transfers WHERE id=target FOR UPDATE;
  IF current_setting('app.order_operation',true) IS DISTINCT FROM 'receive'
    OR current_setting('app.current_user_type',true) IS DISTINCT FROM 'employee'
    OR NOT (coalesce(current_setting('app.current_user_role',true),'') IN ('SUPER_ADMIN','STORE_MANAGER') OR public.app_role_in_group('WH_ALL')
      OR (current_setting('app.current_user_role',true) = 'FACTORY_WAREHOUSE_STAFF' AND t.transfer_type = 'RECALL_COLLECTION' AND t.status = 'DISPATCHED'))
    OR NOT ((t.status='DISPATCHED' AND public.order_staff(t.to_facility_id))
      OR (t.status='RETURN_REQUESTED' AND public.order_staff(t.from_facility_id))) THEN
    RAISE EXCEPTION 'Transfer custody receipt is not authorized' USING ERRCODE='42501';
  END IF;
  UPDATE public.transfer_custody SET outstanding=0,received_at=now()
    WHERE transfer_id=target AND variant_id=variant AND outstanding=units AND units > 0
    RETURNING outstanding INTO remaining;
  IF NOT FOUND THEN RAISE EXCEPTION 'Custody manifest is missing or already received; reconcile legacy transfers before receipt' USING ERRCODE='22023'; END IF;
  RETURN remaining;
END $$;
REVOKE ALL ON FUNCTION public.consume_transfer_custody(integer,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_transfer_custody(integer,integer,integer) TO app_user;
COMMIT;
