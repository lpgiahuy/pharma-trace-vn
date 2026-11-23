\set ON_ERROR_STOP on
BEGIN;
-- Purchase order lifecycle: create, edit while PENDING, approve, cancel. Receiving goods comes later.
-- A warehouse reads and writes only the purchase orders addressed to it; SUPER_ADMIN reaches every warehouse.
DO $$ BEGIN
  IF to_regprocedure('public.app_role_in_group(text)') IS NULL THEN
    RAISE EXCEPTION 'Install app_role_groups.sql first';
  END IF;
END $$;

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS facility_id integer REFERENCES public.facilities(id);
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS supplier_manufacturer_id integer REFERENCES public.manufacturers(id);
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS approved_by_id integer REFERENCES public.employees(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS closed_reason text;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS expected_at date;
CREATE INDEX IF NOT EXISTS idx_po_facility ON public.purchase_orders(facility_id);

-- received_at used to be filled at creation; it now stays empty until goods are actually received (NV-16).
ALTER TABLE public.purchase_orders ALTER COLUMN received_at DROP DEFAULT;
UPDATE public.purchase_orders SET received_at = NULL WHERE status IS DISTINCT FROM 'RECEIVED' AND received_at IS NOT NULL;

-- The supplier is either a manufacturer or a factory of the company.
ALTER TABLE public.purchase_orders ALTER COLUMN supplier_id DROP NOT NULL;
ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_one_supplier_check;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_one_supplier_check
  CHECK (num_nonnulls(supplier_id, supplier_manufacturer_id) = 1);
ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('PENDING', 'APPROVED', 'SHIPPED', 'REJECTED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'));
-- A factory supplier answers an APPROVED order: it ships the goods (SHIPPED) or turns it down (REJECTED, with a reason).
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS rejected_reason text;
ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_rejected_reason_check;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_rejected_reason_check
  CHECK (rejected_reason IS NULL OR length(btrim(rejected_reason)) BETWEEN 1 AND 500);
ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_cancel_reason_check;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_cancel_reason_check
  CHECK (cancel_reason IS NULL OR length(btrim(cancel_reason)) BETWEEN 1 AND 500);

ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS received_quantity integer NOT NULL DEFAULT 0;
ALTER TABLE public.purchase_order_items DROP CONSTRAINT IF EXISTS purchase_order_items_received_quantity_check;
ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_received_quantity_check
  CHECK (received_quantity >= 0 AND received_quantity <= quantity);

-- Append-only history of every status change with who did it and why.
CREATE TABLE IF NOT EXISTS public.purchase_order_events (
  id bigserial PRIMARY KEY,
  po_id integer NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  action varchar(30) NOT NULL,
  from_status varchar(50),
  to_status varchar(50) NOT NULL,
  actor_id integer NOT NULL REFERENCES public.employees(id),
  note text CHECK (length(btrim(note)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_events_po ON public.purchase_order_events(po_id);

-- The receiving facility must be a warehouse; the supplier a manufacturer or a FACTORY facility.
CREATE OR REPLACE FUNCTION public.po_parties_valid(receiving integer, supplier_facility integer, manufacturer integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (SELECT FROM public.facilities f WHERE f.id = receiving AND f.facility_type IN ('CENTRAL_WAREHOUSE', 'BRANCH_WAREHOUSE'))
    AND CASE WHEN supplier_facility IS NOT NULL
      THEN EXISTS (SELECT FROM public.facilities f WHERE f.id = supplier_facility AND f.facility_type = 'FACTORY')
      ELSE EXISTS (SELECT FROM public.manufacturers m WHERE m.id = manufacturer) END
$$;
REVOKE ALL ON FUNCTION public.po_parties_valid(integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.po_parties_valid(integer, integer, integer) TO app_user;

CREATE OR REPLACE FUNCTION public.po_in_scope(unit integer) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT current_setting('app.current_user_role', true) = 'SUPER_ADMIN'
    OR unit = nullif(current_setting('app.current_unit_id', true), '')::integer
$$;
REVOKE ALL ON FUNCTION public.po_in_scope(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.po_in_scope(integer) TO app_user;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_orders', 'purchase_order_items', 'purchase_order_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, app_user', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON public.purchase_orders TO app_user;
GRANT SELECT, INSERT, DELETE ON public.purchase_order_items TO app_user;
GRANT SELECT, INSERT ON public.purchase_order_events TO app_user;
GRANT USAGE ON SEQUENCE public.purchase_orders_id_seq, public.purchase_order_items_id_seq, public.purchase_order_events_id_seq TO app_user;

DROP POLICY IF EXISTS purchase_order_read ON public.purchase_orders;
CREATE POLICY purchase_order_read ON public.purchase_orders FOR SELECT TO app_user
  USING ((public.app_role_in_group('WH_ALL') AND public.po_in_scope(facility_id))
    -- A factory reads, never changes, the approved orders that ask it for stock (not drafts).
    OR (current_setting('app.current_user_role', true) = 'FACTORY_WAREHOUSE_STAFF'
      AND supplier_id = nullif(current_setting('app.current_unit_id', true), '')::integer
      AND status <> 'PENDING'));
DROP POLICY IF EXISTS purchase_order_insert ON public.purchase_orders;
CREATE POLICY purchase_order_insert ON public.purchase_orders FOR INSERT TO app_user
  WITH CHECK (public.app_role_in_group('WH_MANAGER') AND public.po_in_scope(facility_id)
    AND created_by_employee_id = nullif(current_setting('app.current_user_id', true), '')::integer
    AND public.po_parties_valid(facility_id, supplier_id, supplier_manufacturer_id));
DROP POLICY IF EXISTS purchase_order_update ON public.purchase_orders;
CREATE POLICY purchase_order_update ON public.purchase_orders FOR UPDATE TO app_user
  USING (public.app_role_in_group('WH_MANAGER') AND public.po_in_scope(facility_id))
  WITH CHECK (public.app_role_in_group('WH_MANAGER') AND public.po_in_scope(facility_id)
    AND public.po_parties_valid(facility_id, supplier_id, supplier_manufacturer_id));

-- The subqueries below run under the caller's own purchase_orders policies.
DROP POLICY IF EXISTS purchase_order_item_read ON public.purchase_order_items;
CREATE POLICY purchase_order_item_read ON public.purchase_order_items FOR SELECT TO app_user
  USING (EXISTS (SELECT FROM public.purchase_orders p WHERE p.id = po_id));
DROP POLICY IF EXISTS purchase_order_item_insert ON public.purchase_order_items;
CREATE POLICY purchase_order_item_insert ON public.purchase_order_items FOR INSERT TO app_user
  WITH CHECK (public.app_role_in_group('WH_MANAGER')
    AND EXISTS (SELECT FROM public.purchase_orders p WHERE p.id = po_id AND p.status = 'PENDING'));
DROP POLICY IF EXISTS purchase_order_item_delete ON public.purchase_order_items;
CREATE POLICY purchase_order_item_delete ON public.purchase_order_items FOR DELETE TO app_user
  USING (public.app_role_in_group('WH_MANAGER')
    AND EXISTS (SELECT FROM public.purchase_orders p WHERE p.id = po_id AND p.status = 'PENDING'));

DROP POLICY IF EXISTS purchase_order_event_read ON public.purchase_order_events;
CREATE POLICY purchase_order_event_read ON public.purchase_order_events FOR SELECT TO app_user
  USING (EXISTS (SELECT FROM public.purchase_orders p WHERE p.id = po_id));
DROP POLICY IF EXISTS purchase_order_event_insert ON public.purchase_order_events;
CREATE POLICY purchase_order_event_insert ON public.purchase_order_events FOR INSERT TO app_user
  WITH CHECK (public.app_role_in_group('WH_MANAGER')
    AND actor_id = nullif(current_setting('app.current_user_id', true), '')::integer
    AND EXISTS (SELECT FROM public.purchase_orders p WHERE p.id = po_id));

-- The supplying factory rejects an APPROVED order. Factory staff have no write policy on purchase orders, so the
-- change goes through this function, which only accepts staff of the supplier factory. Shipping has its own
-- function below because it must reserve the boxes that are sent.
CREATE OR REPLACE FUNCTION public.supplier_respond_purchase_order(target integer, decision text, response_note text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor integer := nullif(current_setting('app.current_user_id', true), '')::integer;
  unit integer := nullif(current_setting('app.current_unit_id', true), '')::integer;
  po public.purchase_orders%ROWTYPE;
  answer text := nullif(btrim(response_note), '');
  next_status text;
BEGIN
  IF actor IS NULL OR unit IS NULL OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
    OR current_setting('app.current_user_role', true) IS DISTINCT FROM 'FACTORY_WAREHOUSE_STAFF' THEN
    RAISE EXCEPTION 'PO_SUPPLIER_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO po FROM public.purchase_orders WHERE id = target FOR UPDATE;
  IF NOT FOUND OR po.supplier_id IS DISTINCT FROM unit THEN RAISE EXCEPTION 'PO_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF po.status <> 'APPROVED' THEN RAISE EXCEPTION 'PO_INVALID_TRANSITION' USING ERRCODE = '22023'; END IF;
  IF decision IS DISTINCT FROM 'REJECT' THEN RAISE EXCEPTION 'PO_INVALID_TRANSITION' USING ERRCODE = '22023'; END IF;
  IF answer IS NULL OR length(answer) > 500 THEN RAISE EXCEPTION 'PO_REJECT_REASON_REQUIRED' USING ERRCODE = '22023'; END IF;

  next_status := 'REJECTED';
  UPDATE public.purchase_orders SET status = next_status, rejected_reason = answer WHERE id = target;
  INSERT INTO public.purchase_order_events(po_id, action, from_status, to_status, actor_id, note)
    VALUES (target, 'REJECTED', 'APPROVED', next_status, actor, answer);
  RETURN next_status;
END $$;
REVOKE ALL ON FUNCTION public.supplier_respond_purchase_order(integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.supplier_respond_purchase_order(integer, text, text) TO app_user;

-- Boxes the supplying factory scanned when it shipped an order. They stay RESERVED at the factory until the
-- warehouse receives them (receipt deletes the row) or the order ends (the trigger below releases them).
CREATE TABLE IF NOT EXISTS public.purchase_order_boxes (
  box_uid uuid PRIMARY KEY,
  po_id integer NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  po_item_id integer NOT NULL REFERENCES public.purchase_order_items(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_boxes_po ON public.purchase_order_boxes(po_id);
ALTER TABLE public.purchase_order_boxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_boxes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_order_boxes FROM PUBLIC, app_user;
GRANT SELECT ON public.purchase_order_boxes TO app_user;
DROP POLICY IF EXISTS purchase_order_box_read ON public.purchase_order_boxes;
CREATE POLICY purchase_order_box_read ON public.purchase_order_boxes FOR SELECT TO app_user
  USING (EXISTS (SELECT FROM public.purchase_orders p WHERE p.id = po_id));

-- The supplying factory ships an APPROVED order by scanning the boxes (or whole cartons) it sends. manifest:
-- [{ poItemId, boxUids[], ssccCodes[] }], one entry per order line, each with exactly the ordered quantity. The boxes
-- must be in stock at the factory, come from its own batches and match the line's medicine and packaging.
CREATE OR REPLACE FUNCTION public.supplier_ship_purchase_order(target integer, manifest jsonb, response_note text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor integer := nullif(current_setting('app.current_user_id', true), '')::integer;
  unit integer := nullif(current_setting('app.current_unit_id', true), '')::integer;
  po public.purchase_orders%ROWTYPE;
  answer text := nullif(btrim(response_note), '');
  item public.purchase_order_items%ROWTYPE;
  entry jsonb; carton public.sscc_cartons%ROWTYPE; box record;
  scanned uuid[]; carton_boxes uuid[]; carton_codes text[]; cartons_found integer; boxes_found integer; units integer; first_variant integer;
BEGIN
  IF actor IS NULL OR unit IS NULL OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
    OR current_setting('app.current_user_role', true) IS DISTINCT FROM 'FACTORY_WAREHOUSE_STAFF' THEN
    RAISE EXCEPTION 'PO_SUPPLIER_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO po FROM public.purchase_orders WHERE id = target FOR UPDATE;
  IF NOT FOUND OR po.supplier_id IS DISTINCT FROM unit THEN RAISE EXCEPTION 'PO_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF po.status <> 'APPROVED' THEN RAISE EXCEPTION 'PO_INVALID_TRANSITION' USING ERRCODE = '22023'; END IF;
  IF answer IS NOT NULL AND length(answer) > 500 THEN RAISE EXCEPTION 'PO_REJECT_REASON_REQUIRED' USING ERRCODE = '22023'; END IF;

  -- One manifest entry for every line of the order, each naming a different line.
  IF manifest IS NULL OR jsonb_typeof(manifest) <> 'array'
    OR EXISTS (SELECT FROM jsonb_array_elements(manifest) e WHERE jsonb_typeof(e) <> 'object' OR jsonb_typeof(e->'poItemId') IS DISTINCT FROM 'number')
    OR (SELECT count(DISTINCT e->>'poItemId') FROM jsonb_array_elements(manifest) e) <> jsonb_array_length(manifest)
    OR jsonb_array_length(manifest) <> (SELECT count(*) FROM public.purchase_order_items i WHERE i.po_id = target)
    OR EXISTS (SELECT FROM jsonb_array_elements(manifest) e WHERE NOT EXISTS (
      SELECT FROM public.purchase_order_items i WHERE i.po_id = target AND i.id = (e->>'poItemId')::integer)) THEN
    RAISE EXCEPTION 'PO_SHIP_MANIFEST_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.purchase_order_items WHERE po_id = target ORDER BY id FOR UPDATE;

  FOR item IN SELECT * FROM public.purchase_order_items WHERE po_id = target ORDER BY id LOOP
    IF item.variant_id IS NULL THEN RAISE EXCEPTION 'PO_SHIP_MANIFEST_INVALID' USING ERRCODE = '22023'; END IF;
    SELECT e INTO entry FROM jsonb_array_elements(manifest) e WHERE (e->>'poItemId')::integer = item.id;
    scanned := public.goods_receipt_uuid_list(entry->'boxUids');

    IF entry->'ssccCodes' IS NOT NULL AND (jsonb_typeof(entry->'ssccCodes') <> 'array'
      OR EXISTS (SELECT FROM jsonb_array_elements(entry->'ssccCodes') v WHERE jsonb_typeof(v) <> 'string')) THEN
      RAISE EXCEPTION 'GR_CARTON_INVALID' USING ERRCODE = '22023';
    END IF;
    carton_codes := ARRAY(SELECT jsonb_array_elements_text(coalesce(entry->'ssccCodes', '[]')));
    cartons_found := 0;
    FOR carton IN SELECT c.* FROM public.sscc_cartons c WHERE c.sscc_code = ANY (carton_codes) ORDER BY c.id FOR UPDATE LOOP
      cartons_found := cartons_found + 1;
      IF carton.current_facility_id IS DISTINCT FROM po.supplier_id OR carton.status = 'VOIDED' THEN
        RAISE EXCEPTION 'GR_CARTON_UNAVAILABLE %', carton.sscc_code USING ERRCODE = '22023';
      END IF;
      SELECT array_agg(b.uid ORDER BY b.uid) INTO carton_boxes FROM public.medicine_boxes b
        WHERE b.carton_id = carton.id AND b.current_facility_id = po.supplier_id AND b.status = 'IN_STOCK';
      IF coalesce(cardinality(carton_boxes), 0) <> carton.box_count THEN
        RAISE EXCEPTION 'GR_CARTON_UNAVAILABLE %', carton.sscc_code USING ERRCODE = '22023';
      END IF;
      scanned := scanned || carton_boxes;
    END LOOP;
    IF cartons_found <> cardinality(carton_codes) OR cardinality(carton_codes) <> (SELECT count(DISTINCT c) FROM unnest(carton_codes) c) THEN
      RAISE EXCEPTION 'GR_CARTON_INVALID' USING ERRCODE = '22023';
    END IF;

    units := cardinality(scanned);
    IF units <> (SELECT count(DISTINCT s.uid) FROM unnest(scanned) AS s(uid)) THEN RAISE EXCEPTION 'GR_BOX_DUPLICATE' USING ERRCODE = '22023'; END IF;
    IF units <> item.quantity THEN RAISE EXCEPTION 'PO_SHIP_QUANTITY_MISMATCH' USING ERRCODE = '22023'; END IF;

    boxes_found := 0;
    FOR box IN SELECT b.uid, b.current_facility_id, b.status, b.batch_id, bt.medicine_id, bt.manufacturer_source_facility_id, bt.status AS batch_status
        FROM public.medicine_boxes b JOIN public.batches bt ON bt.id = b.batch_id
        WHERE b.uid = ANY (scanned) ORDER BY b.uid FOR UPDATE OF b LOOP
      boxes_found := boxes_found + 1;
      IF box.current_facility_id IS DISTINCT FROM po.supplier_id OR box.status IS DISTINCT FROM 'IN_STOCK' THEN
        RAISE EXCEPTION 'GR_BOX_UNAVAILABLE %', box.uid USING ERRCODE = '22023';
      END IF;
      IF box.medicine_id IS DISTINCT FROM item.medicine_id OR box.manufacturer_source_facility_id IS DISTINCT FROM po.supplier_id
        OR box.batch_status IS DISTINCT FROM 'ACTIVE' THEN
        RAISE EXCEPTION 'GR_BATCH_NOT_FROM_SUPPLIER' USING ERRCODE = '22023';
      END IF;
      SELECT l.variant_id INTO first_variant FROM public.inventory_logs l
        WHERE l.batch_id = box.batch_id AND l.transaction_type IN ('PRODUCTION_IN', 'PURCHASE_IN') ORDER BY l.id LIMIT 1;
      IF first_variant IS NOT NULL AND first_variant <> item.variant_id THEN
        RAISE EXCEPTION 'PO_SHIP_WRONG_PACKAGING' USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF boxes_found <> units THEN RAISE EXCEPTION 'GR_BOX_UNAVAILABLE' USING ERRCODE = '22023'; END IF;

    UPDATE public.inventories SET reserved_quantity = coalesce(reserved_quantity, 0) + units, updated_at = now()
      WHERE facility_id = po.supplier_id AND variant_id = item.variant_id AND stock_quantity - coalesce(reserved_quantity, 0) >= units;
    IF NOT FOUND THEN RAISE EXCEPTION 'GR_SUPPLIER_STOCK_INSUFFICIENT' USING ERRCODE = '22023'; END IF;
    UPDATE public.medicine_boxes SET status = 'RESERVED' WHERE uid = ANY (scanned);
    INSERT INTO public.purchase_order_boxes(box_uid, po_id, po_item_id) SELECT s.uid, target, item.id FROM unnest(scanned) AS s(uid);
  END LOOP;

  UPDATE public.purchase_orders SET status = 'SHIPPED' WHERE id = target;
  INSERT INTO public.purchase_order_events(po_id, action, from_status, to_status, actor_id, note)
    VALUES (target, 'SHIPPED', 'APPROVED', 'SHIPPED', actor, answer);
  RETURN 'SHIPPED';
END $$;
REVOKE ALL ON FUNCTION public.supplier_ship_purchase_order(integer, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.supplier_ship_purchase_order(integer, jsonb, text) TO app_user;

-- When an order ends with boxes still reserved (cancelled, or closed short), they go back into the factory's stock.
CREATE OR REPLACE FUNCTION public.release_purchase_order_boxes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.supplier_id IS NOT NULL THEN
    UPDATE public.inventories inv SET reserved_quantity = greatest(0, coalesce(inv.reserved_quantity, 0) - r.units), updated_at = now()
      FROM (SELECT i.variant_id, count(*)::integer AS units FROM public.purchase_order_boxes b
              JOIN public.purchase_order_items i ON i.id = b.po_item_id WHERE b.po_id = NEW.id GROUP BY i.variant_id) r
      WHERE inv.facility_id = NEW.supplier_id AND inv.variant_id = r.variant_id;
    UPDATE public.medicine_boxes SET status = 'IN_STOCK'
      WHERE uid IN (SELECT box_uid FROM public.purchase_order_boxes WHERE po_id = NEW.id)
        AND status = 'RESERVED' AND current_facility_id = NEW.supplier_id;
    DELETE FROM public.purchase_order_boxes WHERE po_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.release_purchase_order_boxes() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_release_purchase_order_boxes ON public.purchase_orders;
CREATE TRIGGER trg_release_purchase_order_boxes AFTER UPDATE OF status ON public.purchase_orders
  FOR EACH ROW WHEN (NEW.status IN ('CANCELLED', 'CLOSED') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.release_purchase_order_boxes();
COMMIT;
