\set ON_ERROR_STOP on
BEGIN;
-- Internal transfers without an order: an order transfer always has its order, every other type never has one.
ALTER TABLE public.internal_transfers ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE public.internal_transfers ADD COLUMN IF NOT EXISTS transfer_type varchar(30) NOT NULL DEFAULT 'ORDER_FULFILLMENT';
ALTER TABLE public.internal_transfers ADD COLUMN IF NOT EXISTS request_id integer;
ALTER TABLE public.internal_transfers DROP CONSTRAINT IF EXISTS internal_transfers_type_check;
ALTER TABLE public.internal_transfers ADD CONSTRAINT internal_transfers_type_check CHECK (
  transfer_type IN ('ORDER_FULFILLMENT', 'REPLENISHMENT', 'RETURN_TO_WAREHOUSE', 'RECALL_COLLECTION')
  AND (transfer_type = 'ORDER_FULFILLMENT') = (order_id IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS uq_internal_transfers_request ON public.internal_transfers(request_id);

-- The facility that needs stock requests it; a manager of the source facility approves or rejects.
CREATE TABLE IF NOT EXISTS public.stock_transfer_requests (
  id serial PRIMARY KEY,
  request_code varchar(40) NOT NULL UNIQUE,
  from_facility_id integer NOT NULL REFERENCES public.facilities(id),
  to_facility_id integer NOT NULL REFERENCES public.facilities(id),
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) > 0),
  status varchar(20) NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  reason text CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  requested_by integer NOT NULL REFERENCES public.employees(id),
  decided_by integer REFERENCES public.employees(id),
  decided_at timestamptz,
  decision_note text CHECK (length(btrim(decision_note)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_facility_id <> to_facility_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_requests_from ON public.stock_transfer_requests(from_facility_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_requests_to ON public.stock_transfer_requests(to_facility_id);

CREATE TABLE IF NOT EXISTS public.stock_transfer_request_events (
  id bigserial PRIMARY KEY,
  request_id integer NOT NULL REFERENCES public.stock_transfer_requests(id),
  action varchar(20) NOT NULL,
  from_status varchar(20),
  to_status varchar(20) NOT NULL,
  actor_id integer NOT NULL REFERENCES public.employees(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_request_events_request ON public.stock_transfer_request_events(request_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname = 'internal_transfers_request_fk') THEN
    ALTER TABLE public.internal_transfers ADD CONSTRAINT internal_transfers_request_fk
      FOREIGN KEY (request_id) REFERENCES public.stock_transfer_requests(id);
  END IF;
END $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['stock_transfer_requests', 'stock_transfer_request_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, app_user', t);
    EXECUTE format('GRANT SELECT ON public.%I TO app_user', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.stock_transfer_party(unit integer) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT current_setting('app.current_user_type', true) = 'employee'
    AND (coalesce(current_setting('app.current_user_role', true), '') IN ('STORE_MANAGER', 'PHARMACIST') OR public.app_role_in_group('WH_TRANSFER'))
    AND (current_setting('app.current_user_role', true) = 'SUPER_ADMIN' OR unit = nullif(current_setting('app.current_unit_id', true), '')::integer)
$$;
REVOKE ALL ON FUNCTION public.stock_transfer_party(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stock_transfer_party(integer) TO app_user;

DROP POLICY IF EXISTS stock_transfer_request_read ON public.stock_transfer_requests;
CREATE POLICY stock_transfer_request_read ON public.stock_transfer_requests FOR SELECT TO app_user
  USING (public.stock_transfer_party(from_facility_id) OR public.stock_transfer_party(to_facility_id));
DROP POLICY IF EXISTS stock_transfer_request_event_read ON public.stock_transfer_request_events;
CREATE POLICY stock_transfer_request_event_read ON public.stock_transfer_request_events FOR SELECT TO app_user
  USING (EXISTS (SELECT FROM public.stock_transfer_requests r WHERE r.id = request_id));

-- Manager of the given facility, the only role allowed to create (destination) or decide (source) a request.
CREATE OR REPLACE FUNCTION public.stock_transfer_manager(unit integer) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT current_setting('app.current_user_type', true) = 'employee'
    AND coalesce(current_setting('app.current_user_role', true), '') IN ('WAREHOUSE_MANAGER', 'STORE_MANAGER', 'FACTORY_WAREHOUSE_STAFF')
    AND unit = nullif(current_setting('app.current_unit_id', true), '')::integer
$$;
REVOKE ALL ON FUNCTION public.stock_transfer_manager(integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.create_stock_transfer_request(code text, source integer, destination integer, request_lines jsonb, note text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE actor integer := nullif(current_setting('app.current_user_id', true), '')::integer; existing public.stock_transfer_requests%ROWTYPE;
  normalized jsonb; created integer;
BEGIN
  IF actor IS NULL OR public.stock_transfer_manager(destination) IS NOT TRUE THEN
    RAISE EXCEPTION 'ST_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO existing FROM public.stock_transfer_requests WHERE request_code = code;
  IF FOUND THEN
    IF existing.to_facility_id <> destination THEN RAISE EXCEPTION 'ST_CODE_TAKEN' USING ERRCODE = '23505'; END IF;
    RETURN existing.id;
  END IF;
  IF source IS NULL OR source = destination OR NOT EXISTS (SELECT FROM public.facilities WHERE id = source) THEN
    RAISE EXCEPTION 'ST_SOURCE_INVALID' USING ERRCODE = '22023';
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
  RETURN created;
END $$;
REVOKE ALL ON FUNCTION public.create_stock_transfer_request(text, integer, integer, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_stock_transfer_request(text, integer, integer, jsonb, text) TO app_user;

-- APPROVE reserves source stock and creates the internal transfer; dispatch and receipt then use the transfer workflow.
-- CANCEL releases that reservation while the transfer has not been dispatched.
CREATE OR REPLACE FUNCTION public.decide_stock_transfer_request(target integer, decision text, note text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE actor integer := nullif(current_setting('app.current_user_id', true), '')::integer; r public.stock_transfer_requests%ROWTYPE;
  t public.internal_transfers%ROWTYPE; line jsonb; next_status text;
BEGIN
  SELECT * INTO r FROM public.stock_transfer_requests WHERE id = target FOR UPDATE;
  IF NOT FOUND OR actor IS NULL OR NOT (public.stock_transfer_manager(r.from_facility_id) OR public.stock_transfer_manager(r.to_facility_id)) THEN
    RAISE EXCEPTION 'ST_NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  next_status := CASE decision WHEN 'APPROVE' THEN 'APPROVED' WHEN 'REJECT' THEN 'REJECTED' WHEN 'CANCEL' THEN 'CANCELLED' END;
  IF next_status IS NULL OR (decision IN ('APPROVE', 'REJECT') AND NOT public.stock_transfer_manager(r.from_facility_id)) THEN
    RAISE EXCEPTION 'ST_SOURCE_MANAGER_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF r.status = next_status THEN RETURN r.id; END IF;
  IF decision IN ('REJECT', 'CANCEL') AND length(btrim(coalesce(note, ''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'ST_NOTE_REQUIRED' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO t FROM public.internal_transfers WHERE request_id = r.id FOR UPDATE;
  IF NOT (r.status = 'REQUESTED' OR (decision = 'CANCEL' AND r.status = 'APPROVED' AND t.status = 'REQUESTED')) THEN
    RAISE EXCEPTION 'ST_INVALID_STATUS' USING ERRCODE = '22023';
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(r.lines) WHERE decision = 'APPROVE' LOOP
    UPDATE public.inventories SET reserved_quantity = coalesce(reserved_quantity, 0) + (line->>'quantity')::integer, updated_at = now()
      WHERE facility_id = r.from_facility_id AND variant_id = (line->>'variantId')::integer
        AND stock_quantity - coalesce(reserved_quantity, 0) >= (line->>'quantity')::integer;
    IF NOT FOUND THEN RAISE EXCEPTION 'ST_STOCK_INSUFFICIENT' USING ERRCODE = '22023'; END IF;
  END LOOP;
  IF decision = 'APPROVE' THEN
    INSERT INTO public.internal_transfers(transfer_code, transfer_type, request_id, from_facility_id, to_facility_id, status, items, notes)
      SELECT 'STR-' || r.request_code,
        CASE WHEN src.facility_type = 'PHARMACY' AND dst.facility_type IN ('CENTRAL_WAREHOUSE', 'BRANCH_WAREHOUSE') THEN 'RETURN_TO_WAREHOUSE' ELSE 'REPLENISHMENT' END,
        r.id, r.from_facility_id, r.to_facility_id, 'REQUESTED', r.lines, r.reason
      FROM public.facilities src, public.facilities dst WHERE src.id = r.from_facility_id AND dst.id = r.to_facility_id;
  END IF;
  IF decision = 'CANCEL' AND t.id IS NOT NULL THEN
    FOR line IN SELECT value FROM jsonb_array_elements(t.items) LOOP
      UPDATE public.inventories SET reserved_quantity = reserved_quantity - (line->>'quantity')::integer, updated_at = now()
        WHERE facility_id = t.from_facility_id AND variant_id = (line->>'variantId')::integer AND reserved_quantity >= (line->>'quantity')::integer;
      IF NOT FOUND THEN RAISE EXCEPTION 'Source reservation is insufficient' USING ERRCODE = '22023'; END IF;
    END LOOP;
    UPDATE public.internal_transfers SET status = 'CANCELLED', notes = btrim(note), updated_at = now() WHERE id = t.id;
  END IF;
  IF decision = 'CANCEL' THEN
    UPDATE public.stock_transfer_requests SET status = next_status WHERE id = r.id;
  ELSE
    UPDATE public.stock_transfer_requests SET status = next_status, decided_by = actor, decided_at = now(),
      decision_note = nullif(btrim(note), '') WHERE id = r.id;
  END IF;
  INSERT INTO public.stock_transfer_request_events(request_id, action, from_status, to_status, actor_id, note)
    VALUES (r.id, decision, r.status, next_status, actor, nullif(btrim(note), ''));
  RETURN r.id;
END $$;
REVOKE ALL ON FUNCTION public.decide_stock_transfer_request(integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_stock_transfer_request(integer, text, text) TO app_user;

-- Same as logistics_rls.sql, except a transfer made from a stock transfer request is handed over by the
-- manager who approved it: that employee is the only choice. Order transfers still pick any source employee.
CREATE OR REPLACE FUNCTION public.transfer_transport_staff(target_transfer integer)
RETURNS TABLE(id integer, full_name varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT e.id, e.full_name FROM public.employees e
 JOIN public.internal_transfers t ON t.from_facility_id = e.facility_id
 WHERE t.id = target_transfer AND e.status = 'ACTIVE'
 AND (t.request_id IS NULL OR e.id = (SELECT r.decided_by FROM public.stock_transfer_requests r WHERE r.id = t.request_id))
 AND current_setting('app.order_operation', true) IN ('transfer_read', 'dispatch')
 AND current_setting('app.current_user_type', true) = 'employee'
 AND (current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER') OR public.app_role_in_group('WH_TRANSFER'))
 AND public.order_staff(t.from_facility_id)
 ORDER BY e.full_name, e.id
$$;
REVOKE ALL ON FUNCTION public.transfer_transport_staff(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_transport_staff(integer) TO app_user;

-- Who asked for the stock and who approved it. The transfer itself only exists from the approval, so its first
-- history event names the approver; this lets the transfer detail show the real requester. The caller has already
-- checked that the user may see the transfer; this only exposes the two names and times of that one request.
CREATE OR REPLACE FUNCTION public.transfer_request_trail(target_transfer integer)
RETURNS TABLE(action varchar, actor_id integer, actor_name varchar, actor_role varchar, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT ev.action, emp.id, emp.full_name, emp.role, ev.created_at
 FROM public.internal_transfers t
 JOIN public.stock_transfer_request_events ev ON ev.request_id = t.request_id AND ev.action IN ('CREATE', 'APPROVE')
 JOIN public.employees emp ON emp.id = ev.actor_id
 WHERE t.id = target_transfer
 AND current_setting('app.current_user_type', true) = 'employee'
 AND current_setting('app.order_operation', true) = 'transfer_read'
 AND (current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST') OR public.app_role_in_group('WH_TRANSFER'))
 AND (public.order_staff(t.from_facility_id) OR public.order_staff(t.to_facility_id))
 ORDER BY ev.created_at, ev.id
$$;
REVOKE ALL ON FUNCTION public.transfer_request_trail(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_request_trail(integer) TO app_user;
COMMIT;
