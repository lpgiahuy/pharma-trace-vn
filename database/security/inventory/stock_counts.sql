\set ON_ERROR_STOP on
BEGIN;
-- Stock counts and approved stock adjustments. Counts and adjustments are written only by the functions below;
-- app_user can read the count tables of its own warehouse. Errors raised with ERRCODE 22023 carry an SC_* code
-- that the API maps to a user-facing message. inventory_logs.transaction_type has no check constraint, so
-- ADJUSTMENT_GAIN and ADJUSTMENT_LOSS need no schema change.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install stock count controls as a trusted superuser';
  END IF;
  IF to_regprocedure('public.po_in_scope(integer)') IS NULL OR to_regprocedure('public.app_role_in_group(text)') IS NULL THEN
    RAISE EXCEPTION 'Install app_role_groups.sql and purchase_orders.sql first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.stock_counts (
  id serial PRIMARY KEY,
  count_code varchar(50) NOT NULL UNIQUE,
  facility_id integer NOT NULL REFERENCES public.facilities(id),
  scope varchar(10) NOT NULL CHECK (scope IN ('FULL', 'MEDICINE', 'BATCH')),
  medicine_id integer REFERENCES public.medicines(id),
  batch_id integer REFERENCES public.batches(id),
  status varchar(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SUBMITTED', 'APPROVED', 'CANCELLED')),
  created_by_id integer NOT NULL REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (CASE scope WHEN 'FULL' THEN num_nonnulls(medicine_id, batch_id) = 0
    WHEN 'MEDICINE' THEN medicine_id IS NOT NULL AND batch_id IS NULL ELSE batch_id IS NOT NULL AND medicine_id IS NULL END)
);
CREATE INDEX IF NOT EXISTS idx_stock_counts_facility ON public.stock_counts(facility_id);

-- system_quantity is taken when the count opens; current_quantity and difference are set when it is approved.
CREATE TABLE IF NOT EXISTS public.stock_count_lines (
  id serial PRIMARY KEY,
  count_id integer NOT NULL REFERENCES public.stock_counts(id) ON DELETE CASCADE,
  variant_id integer NOT NULL REFERENCES public.packaging_variants(id),
  batch_id integer NOT NULL REFERENCES public.batches(id),
  system_quantity integer NOT NULL CHECK (system_quantity >= 0),
  counted_quantity integer CHECK (counted_quantity >= 0),
  current_quantity integer,
  difference integer,
  UNIQUE (count_id, batch_id)
);

CREATE TABLE IF NOT EXISTS public.stock_count_events (
  id bigserial PRIMARY KEY,
  count_id integer NOT NULL REFERENCES public.stock_counts(id) ON DELETE CASCADE,
  action varchar(30) NOT NULL,
  from_status varchar(20),
  to_status varchar(20) NOT NULL,
  actor_id integer NOT NULL REFERENCES public.employees(id),
  note text CHECK (length(btrim(note)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_count_events_count ON public.stock_count_events(count_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['stock_counts', 'stock_count_lines', 'stock_count_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, app_user', t);
    EXECUTE format('GRANT SELECT ON public.%I TO app_user', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS stock_count_read ON public.stock_counts;
CREATE POLICY stock_count_read ON public.stock_counts FOR SELECT TO app_user
  USING (public.app_role_in_group('WH_ALL') AND public.po_in_scope(facility_id));
DROP POLICY IF EXISTS stock_count_line_read ON public.stock_count_lines;
CREATE POLICY stock_count_line_read ON public.stock_count_lines FOR SELECT TO app_user
  USING (EXISTS (SELECT FROM public.stock_counts c WHERE c.id = count_id));
DROP POLICY IF EXISTS stock_count_event_read ON public.stock_count_events;
CREATE POLICY stock_count_event_read ON public.stock_count_events FOR SELECT TO app_user
  USING (EXISTS (SELECT FROM public.stock_counts c WHERE c.id = count_id));

-- Boxes of a batch that are physically at the warehouse and counted in stock_quantity; 0 outside the caller's scope.
CREATE OR REPLACE FUNCTION public.stock_count_on_hand(target_facility integer, target_batch integer) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT count(*)::integer FROM public.medicine_boxes
  WHERE public.po_in_scope(target_facility) AND current_facility_id = target_facility AND batch_id = target_batch
    AND status IN ('IN_STOCK', 'MANUFACTURED', 'RESERVED', 'PACKAGED')
$$;
REVOKE ALL ON FUNCTION public.stock_count_on_hand(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stock_count_on_hand(integer, integer) TO app_user;

-- Boxes carry no variant, so a batch maps to the one variant of its medicine that the warehouse stocks.
CREATE OR REPLACE FUNCTION public.stock_count_variant(target_facility integer, target_batch integer) RETURNS integer
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE variants integer[];
BEGIN
  SELECT array_agg(i.variant_id) INTO variants FROM public.inventories i
    JOIN public.packaging_variants v ON v.id = i.variant_id
    JOIN public.batches b ON b.medicine_id = v.medicine_id
    WHERE i.facility_id = target_facility AND b.id = target_batch;
  IF cardinality(variants) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'SC_VARIANT_AMBIGUOUS' USING ERRCODE = '22023'; END IF;
  RETURN variants[1];
END $$;
REVOKE ALL ON FUNCTION public.stock_count_variant(integer, integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.stock_count_actor(role_group text) RETURNS integer
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE actor integer := nullif(current_setting('app.current_user_id', true), '')::integer;
BEGIN
  IF actor IS NULL OR NOT public.app_role_in_group(role_group) THEN RAISE EXCEPTION 'SC_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  RETURN actor;
END $$;
REVOKE ALL ON FUNCTION public.stock_count_actor(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.stock_count_reference(code text) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
BEGIN
  IF code IS NULL OR code !~ '^[A-Za-z0-9][A-Za-z0-9_-]{5,49}$' THEN RAISE EXCEPTION 'SC_CODE_INVALID' USING ERRCODE = '22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.stock_count_reference(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.stock_count_reason(reason text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
BEGIN
  IF reason IS NULL OR length(btrim(reason)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'SC_REASON_REQUIRED' USING ERRCODE = '22023'; END IF;
  RETURN btrim(reason);
END $$;
REVOKE ALL ON FUNCTION public.stock_count_reason(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.stock_count_lock(target integer, allowed text[]) RETURNS public.stock_counts
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE cnt public.stock_counts%ROWTYPE;
BEGIN
  SELECT * INTO cnt FROM public.stock_counts WHERE id = target FOR UPDATE;
  IF NOT FOUND OR public.po_in_scope(cnt.facility_id) IS NOT TRUE THEN RAISE EXCEPTION 'SC_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF NOT cnt.status = ANY (allowed) THEN RAISE EXCEPTION 'SC_INVALID_TRANSITION' USING ERRCODE = '22023'; END IF;
  RETURN cnt;
END $$;
REVOKE ALL ON FUNCTION public.stock_count_lock(integer, text[]) FROM PUBLIC;

-- Changes the on-hand units of one batch. A loss marks unreserved boxes MISSING; a gain restores MISSING boxes only,
-- because unknown boxes must come in through a receipt or a transfer. Stock never drops below the reserved units.
CREATE OR REPLACE FUNCTION public.adjust_batch_stock(target_facility integer, target_batch integer, units integer,
  reference text, movement_note text, actor integer) RETURNS integer
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  lot public.batches%ROWTYPE; variant integer := public.stock_count_variant(target_facility, target_batch);
  uids uuid[]; restored integer; balance integer; log_id integer;
BEGIN
  SELECT * INTO lot FROM public.batches WHERE id = target_batch;
  PERFORM 1 FROM public.inventories WHERE facility_id = target_facility AND variant_id = variant FOR UPDATE;
  IF units < 0 THEN
    SELECT array_agg(s.uid) INTO uids FROM (
      SELECT uid FROM public.medicine_boxes
      WHERE current_facility_id = target_facility AND batch_id = target_batch AND status IN ('IN_STOCK', 'MANUFACTURED')
      ORDER BY created_at, uid LIMIT -units FOR UPDATE) s;
    IF cardinality(uids) IS DISTINCT FROM -units THEN RAISE EXCEPTION 'SC_BELOW_RESERVED' USING ERRCODE = '22023'; END IF;
    UPDATE public.medicine_boxes SET status = 'MISSING' WHERE uid = ANY (uids);
  ELSE
    UPDATE public.medicine_boxes SET status = 'IN_STOCK' WHERE uid IN (
      SELECT uid FROM public.medicine_boxes
      WHERE current_facility_id = target_facility AND batch_id = target_batch AND status = 'MISSING'
      ORDER BY created_at, uid LIMIT units FOR UPDATE);
    GET DIAGNOSTICS restored = ROW_COUNT;
    IF restored <> units THEN RAISE EXCEPTION 'SC_GAIN_UNKNOWN_BOXES' USING ERRCODE = '22023'; END IF;
  END IF;
  UPDATE public.inventories SET stock_quantity = stock_quantity + units, updated_at = now()
    WHERE facility_id = target_facility AND variant_id = variant AND stock_quantity + units >= coalesce(reserved_quantity, 0)
    RETURNING stock_quantity INTO balance;
  IF NOT FOUND THEN RAISE EXCEPTION 'SC_BELOW_RESERVED' USING ERRCODE = '22023'; END IF;
  UPDATE public.batches SET remaining_quantity = greatest(0, remaining_quantity + units) WHERE id = target_batch;
  INSERT INTO public.inventory_logs(facility_id, medicine_id, variant_id, batch_id, stock_bucket, transaction_type,
      quantity_changed, previous_quantity, new_quantity, reference_code, note, performed_by_id)
    VALUES (target_facility, lot.medicine_id, variant, target_batch, 'ON_HAND',
      CASE WHEN units < 0 THEN 'ADJUSTMENT_LOSS' ELSE 'ADJUSTMENT_GAIN' END,
      units, balance - units, balance, reference, movement_note, actor)
    RETURNING id INTO log_id;
  RETURN log_id;
END $$;
REVOKE ALL ON FUNCTION public.adjust_batch_stock(integer, integer, integer, text, text, integer) FROM PUBLIC;

-- Opens a count of the whole warehouse, one medicine or one batch. A repeated code returns the count it created.
CREATE OR REPLACE FUNCTION public.open_stock_count(count_ref text, target_facility integer, target_medicine integer, target_batch integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor integer := public.stock_count_actor('WH_MANAGER');
  previous public.stock_counts%ROWTYPE; cnt integer;
BEGIN
  IF target_facility IS NULL OR public.po_in_scope(target_facility) IS NOT TRUE THEN RAISE EXCEPTION 'SC_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  PERFORM public.stock_count_reference(count_ref);
  IF num_nonnulls(target_medicine, target_batch) > 1 THEN RAISE EXCEPTION 'SC_SCOPE_INVALID' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(count_ref));
  SELECT * INTO previous FROM public.stock_counts WHERE count_code = count_ref;
  IF FOUND THEN
    IF previous.facility_id <> target_facility THEN RAISE EXCEPTION 'SC_CODE_CONFLICT' USING ERRCODE = '22023'; END IF;
    RETURN previous.id;
  END IF;

  INSERT INTO public.stock_counts(count_code, facility_id, scope, medicine_id, batch_id, created_by_id)
    VALUES (count_ref, target_facility,
      CASE WHEN target_medicine IS NOT NULL THEN 'MEDICINE' WHEN target_batch IS NOT NULL THEN 'BATCH' ELSE 'FULL' END,
      target_medicine, target_batch, actor)
    RETURNING id INTO cnt;
  INSERT INTO public.stock_count_lines(count_id, variant_id, batch_id, system_quantity)
    SELECT cnt, public.stock_count_variant(target_facility, b.id), b.id, public.stock_count_on_hand(target_facility, b.id)
    FROM public.batches b
    WHERE (target_medicine IS NULL OR b.medicine_id = target_medicine) AND (target_batch IS NULL OR b.id = target_batch)
      AND EXISTS (SELECT FROM public.medicine_boxes x WHERE x.batch_id = b.id AND x.current_facility_id = target_facility
        AND x.status IN ('IN_STOCK', 'MANUFACTURED', 'RESERVED', 'PACKAGED', 'MISSING'))
    ORDER BY b.id;
  IF NOT EXISTS (SELECT FROM public.stock_count_lines WHERE count_id = cnt) THEN RAISE EXCEPTION 'SC_COUNT_EMPTY' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.stock_count_events(count_id, action, to_status, actor_id) VALUES (cnt, 'OPENED', 'OPEN', actor);
  RETURN cnt;
END $$;
REVOKE ALL ON FUNCTION public.open_stock_count(text, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_stock_count(text, integer, integer, integer) TO app_user;

CREATE OR REPLACE FUNCTION public.save_stock_count_lines(target integer, batch_ids integer[], quantities integer[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE saved integer;
BEGIN
  PERFORM public.stock_count_actor('WH_ALL');
  PERFORM public.stock_count_lock(target, ARRAY['OPEN']);
  UPDATE public.stock_count_lines l SET counted_quantity = e.quantity
    FROM unnest(batch_ids, quantities) AS e(batch, quantity) WHERE l.count_id = target AND l.batch_id = e.batch;
  GET DIAGNOSTICS saved = ROW_COUNT;
  IF saved <> cardinality(batch_ids) OR cardinality(batch_ids) <> cardinality(quantities) THEN
    RAISE EXCEPTION 'SC_LINE_INVALID' USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.save_stock_count_lines(integer, integer[], integer[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_stock_count_lines(integer, integer[], integer[]) TO app_user;

CREATE OR REPLACE FUNCTION public.submit_stock_count(target integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE actor integer := public.stock_count_actor('WH_ALL');
BEGIN
  PERFORM public.stock_count_lock(target, ARRAY['OPEN']);
  IF EXISTS (SELECT FROM public.stock_count_lines WHERE count_id = target AND counted_quantity IS NULL) THEN
    RAISE EXCEPTION 'SC_LINES_UNCOUNTED' USING ERRCODE = '22023';
  END IF;
  UPDATE public.stock_counts SET status = 'SUBMITTED' WHERE id = target;
  INSERT INTO public.stock_count_events(count_id, action, from_status, to_status, actor_id) VALUES (target, 'SUBMITTED', 'OPEN', 'SUBMITTED', actor);
END $$;
REVOKE ALL ON FUNCTION public.submit_stock_count(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_stock_count(integer) TO app_user;

CREATE OR REPLACE FUNCTION public.cancel_stock_count(target integer, reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor integer := public.stock_count_actor('WH_MANAGER');
  note text := public.stock_count_reason(reason);
  cnt public.stock_counts := public.stock_count_lock(target, ARRAY['OPEN', 'SUBMITTED']);
BEGIN
  UPDATE public.stock_counts SET status = 'CANCELLED' WHERE id = target;
  INSERT INTO public.stock_count_events(count_id, action, from_status, to_status, actor_id, note)
    VALUES (target, 'CANCELLED', cnt.status, 'CANCELLED', actor, note);
END $$;
REVOKE ALL ON FUNCTION public.cancel_stock_count(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_stock_count(integer, text) TO app_user;

-- Compares each counted number with the units on hand now, not at opening, and books the difference.
CREATE OR REPLACE FUNCTION public.approve_stock_count(target integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor integer := public.stock_count_actor('WH_MANAGER');
  cnt public.stock_counts := public.stock_count_lock(target, ARRAY['SUBMITTED']);
  line public.stock_count_lines%ROWTYPE; on_hand integer;
BEGIN
  PERFORM 1 FROM public.inventories i WHERE i.facility_id = cnt.facility_id
    AND i.variant_id IN (SELECT l.variant_id FROM public.stock_count_lines l WHERE l.count_id = target) ORDER BY i.id FOR UPDATE;
  FOR line IN SELECT * FROM public.stock_count_lines WHERE count_id = target ORDER BY batch_id LOOP
    on_hand := public.stock_count_on_hand(cnt.facility_id, line.batch_id);
    UPDATE public.stock_count_lines SET current_quantity = on_hand, difference = line.counted_quantity - on_hand WHERE id = line.id;
    IF line.counted_quantity <> on_hand THEN
      PERFORM public.adjust_batch_stock(cnt.facility_id, line.batch_id, line.counted_quantity - on_hand,
        cnt.count_code, 'Stock count ' || cnt.count_code, actor);
    END IF;
  END LOOP;
  UPDATE public.stock_counts SET status = 'APPROVED' WHERE id = target;
  INSERT INTO public.stock_count_events(count_id, action, from_status, to_status, actor_id) VALUES (target, 'APPROVED', 'SUBMITTED', 'APPROVED', actor);
END $$;
REVOKE ALL ON FUNCTION public.approve_stock_count(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_stock_count(integer) TO app_user;

-- Single adjustment of one batch with a mandatory reason. A repeated code returns the log row it created.
CREATE OR REPLACE FUNCTION public.record_stock_adjustment(target_facility integer, adjustment_ref text, target_batch integer,
  units integer, reason text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor integer := public.stock_count_actor('WH_MANAGER');
  note text := public.stock_count_reason(reason);
  previous public.inventory_logs%ROWTYPE;
BEGIN
  IF target_facility IS NULL OR public.po_in_scope(target_facility) IS NOT TRUE THEN RAISE EXCEPTION 'SC_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  PERFORM public.stock_count_reference(adjustment_ref);
  IF units IS NULL OR units = 0 THEN RAISE EXCEPTION 'SC_QUANTITY_INVALID' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(adjustment_ref));
  SELECT * INTO previous FROM public.inventory_logs
    WHERE reference_code = adjustment_ref AND transaction_type IN ('ADJUSTMENT_GAIN', 'ADJUSTMENT_LOSS') ORDER BY id LIMIT 1;
  IF FOUND THEN
    IF previous.facility_id <> target_facility OR previous.batch_id IS DISTINCT FROM target_batch OR previous.quantity_changed <> units THEN
      RAISE EXCEPTION 'SC_CODE_CONFLICT' USING ERRCODE = '22023';
    END IF;
    RETURN previous.id;
  END IF;
  RETURN public.adjust_batch_stock(target_facility, target_batch, units, adjustment_ref, note, actor);
END $$;
REVOKE ALL ON FUNCTION public.record_stock_adjustment(integer, text, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_stock_adjustment(integer, text, integer, integer, text) TO app_user;
COMMIT;
