\set ON_ERROR_STOP on
BEGIN;
-- Goods receipts against purchase orders. A purchase order is received in one or more receipts; each receipt
-- adds sellable stock, quarantines rejected boxes, advances the order status and records a payable.
-- Errors raised with ERRCODE 22023 carry a GR_* or PO_* code that the API maps to a user-facing message.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install goods receipt controls as a trusted superuser';
  END IF;
  IF to_regprocedure('public.po_in_scope(integer)') IS NULL OR to_regclass('public.quarantine_movements') IS NULL THEN
    RAISE EXCEPTION 'Install purchase_orders.sql and quarantine_balances.sql first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.goods_receipts (
  id serial PRIMARY KEY,
  receipt_code varchar(50) NOT NULL UNIQUE,
  po_id integer NOT NULL REFERENCES public.purchase_orders(id),
  facility_id integer NOT NULL REFERENCES public.facilities(id),
  received_by_id integer NOT NULL REFERENCES public.employees(id),
  received_at timestamptz NOT NULL DEFAULT now(),
  note text CHECK (length(btrim(note)) BETWEEN 1 AND 1000)
);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_po ON public.goods_receipts(po_id);

CREATE TABLE IF NOT EXISTS public.goods_receipt_lines (
  id serial PRIMARY KEY,
  receipt_id integer NOT NULL REFERENCES public.goods_receipts(id) ON DELETE CASCADE,
  po_item_id integer NOT NULL REFERENCES public.purchase_order_items(id),
  batch_id integer NOT NULL REFERENCES public.batches(id),
  quantity_accepted integer NOT NULL CHECK (quantity_accepted >= 0),
  quantity_rejected integer NOT NULL CHECK (quantity_rejected >= 0),
  reject_reason text,
  box_uids uuid[] NOT NULL DEFAULT '{}',
  rejected_box_uids uuid[] NOT NULL DEFAULT '{}',
  UNIQUE (receipt_id, po_item_id, batch_id),
  CHECK (quantity_accepted + quantity_rejected > 0),
  CHECK (cardinality(box_uids) = quantity_accepted AND cardinality(rejected_box_uids) = quantity_rejected),
  CHECK ((quantity_rejected = 0) = (reject_reason IS NULL)),
  CHECK (reject_reason IS NULL OR length(btrim(reject_reason)) BETWEEN 1 AND 300)
);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_lines_receipt ON public.goods_receipt_lines(receipt_id);

CREATE TABLE IF NOT EXISTS public.goods_receipt_attachments (
  id serial PRIMARY KEY,
  receipt_id integer NOT NULL REFERENCES public.goods_receipts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('PHOTO','DELIVERY_NOTE','CO_CQ')),
  batch_id integer REFERENCES public.batches(id),
  image_reference text NOT NULL,
  uploaded_by_id integer NOT NULL REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_attachments_receipt ON public.goods_receipt_attachments(receipt_id);

ALTER TABLE public.inventory_logs ADD COLUMN IF NOT EXISTS batch_id integer REFERENCES public.batches(id);
ALTER TABLE public.accounts_payable ADD COLUMN IF NOT EXISTS goods_receipt_id integer UNIQUE REFERENCES public.goods_receipts(id);

ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_closed_reason_check;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_closed_reason_check
  CHECK (closed_reason IS NULL OR length(btrim(closed_reason)) BETWEEN 1 AND 500);

ALTER TABLE public.quarantine_movements DROP CONSTRAINT IF EXISTS quarantine_movements_origin_type_check;
ALTER TABLE public.quarantine_movements ADD CONSTRAINT quarantine_movements_origin_type_check
  CHECK (origin_type IN ('SHIPMENT','TRANSFER','TRANSFER_RETURN','RMA','PO_RECEIPT'));

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['goods_receipts', 'goods_receipt_lines', 'goods_receipt_attachments', 'accounts_payable'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, app_user', t);
  END LOOP;
END $$;
GRANT SELECT ON public.goods_receipts, public.goods_receipt_lines, public.accounts_payable TO app_user;
GRANT SELECT, INSERT ON public.goods_receipt_attachments TO app_user;
GRANT USAGE ON SEQUENCE public.goods_receipt_attachments_id_seq TO app_user;

DROP POLICY IF EXISTS goods_receipt_read ON public.goods_receipts;
CREATE POLICY goods_receipt_read ON public.goods_receipts FOR SELECT TO app_user
  USING (public.app_role_in_group('WH_ALL') AND public.po_in_scope(facility_id));
DROP POLICY IF EXISTS goods_receipt_line_read ON public.goods_receipt_lines;
CREATE POLICY goods_receipt_line_read ON public.goods_receipt_lines FOR SELECT TO app_user
  USING (EXISTS (SELECT FROM public.goods_receipts r WHERE r.id = receipt_id));
DROP POLICY IF EXISTS goods_receipt_attachment_read ON public.goods_receipt_attachments;
CREATE POLICY goods_receipt_attachment_read ON public.goods_receipt_attachments FOR SELECT TO app_user
  USING (EXISTS (SELECT FROM public.goods_receipts r WHERE r.id = receipt_id));
DROP POLICY IF EXISTS goods_receipt_attachment_insert ON public.goods_receipt_attachments;
CREATE POLICY goods_receipt_attachment_insert ON public.goods_receipt_attachments FOR INSERT TO app_user
  WITH CHECK (uploaded_by_id = nullif(current_setting('app.current_user_id', true), '')::integer
    AND EXISTS (SELECT FROM public.goods_receipts r WHERE r.id = receipt_id));

-- Finance reads every payable; a warehouse manager reads the payables of the orders addressed to the warehouse.
-- Payables are written only by record_goods_receipt().
DROP POLICY IF EXISTS accounts_payable_read ON public.accounts_payable;
CREATE POLICY accounts_payable_read ON public.accounts_payable FOR SELECT TO app_user
  USING (current_setting('app.current_user_type', true) = 'employee'
    AND (coalesce(current_setting('app.current_user_role', true), '') IN ('SUPER_ADMIN','ACCOUNTANT','FINANCE_MANAGER')
      OR (public.app_role_in_group('WH_MANAGER') AND EXISTS (SELECT FROM public.purchase_orders p WHERE p.id = po_id))));

CREATE OR REPLACE FUNCTION public.goods_receipt_uuid_list(items jsonb) RETURNS uuid[]
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
BEGIN
  IF items IS NULL THEN RETURN '{}'; END IF;
  IF jsonb_typeof(items) <> 'array' OR EXISTS (SELECT FROM jsonb_array_elements(items) v
    WHERE jsonb_typeof(v) <> 'string' OR v #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'GR_BOX_INVALID' USING ERRCODE = '22023';
  END IF;
  RETURN ARRAY(SELECT (v #>> '{}')::uuid FROM jsonb_array_elements(items) v);
END $$;
REVOKE ALL ON FUNCTION public.goods_receipt_uuid_list(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.goods_receipt_date(value text) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
BEGIN
  RETURN CASE WHEN value ~ '^\d{4}-\d{2}-\d{2}$' THEN value::date END;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.goods_receipt_date(text) FROM PUBLIC;

-- Receives goods for one purchase order in a single transaction. The order row lock serializes receipts of the
-- same order; a repeated receipt code returns the receipt it already created.
-- lines: [{ poItemId, batchNumber, productionDate, expiryDate, certificateCoCq?, boxUids[], ssccCodes[],
--          rejectedBoxUids[], rejectReason? }]
CREATE OR REPLACE FUNCTION public.record_goods_receipt(target_po integer, receipt_ref text, receipt_note text, receipt_lines jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor integer := nullif(current_setting('app.current_user_id', true), '')::integer;
  po public.purchase_orders%ROWTYPE;
  previous_receipt public.goods_receipts%ROWTYPE;
  item public.purchase_order_items%ROWTYPE;
  lot public.batches%ROWTYPE;
  carton public.sscc_cartons%ROWTYPE;
  entry jsonb; box record; quarantined record;
  receipt integer; log_id integer;
  lot_number text; produced date; expires date; reason text; supplier text; next_status text;
  accepted uuid[]; rejected uuid[]; scanned uuid[]; seen uuid[] := '{}'; carton_ids integer[];
  units integer; balance integer; amount numeric := 0;
BEGIN
  IF actor IS NULL OR NOT public.app_role_in_group('WH_ALL') THEN
    RAISE EXCEPTION 'GR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF receipt_ref IS NULL OR receipt_ref !~ '^[A-Za-z0-9][A-Za-z0-9_-]{5,49}$' THEN
    RAISE EXCEPTION 'GR_CODE_INVALID' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO po FROM public.purchase_orders WHERE id = target_po FOR UPDATE;
  IF NOT FOUND OR public.po_in_scope(po.facility_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'PO_NOT_FOUND' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO previous_receipt FROM public.goods_receipts WHERE receipt_code = receipt_ref;
  IF FOUND THEN
    IF previous_receipt.po_id <> target_po THEN RAISE EXCEPTION 'GR_CODE_CONFLICT' USING ERRCODE = '22023'; END IF;
    RETURN previous_receipt.id;
  END IF;

  IF po.status NOT IN ('APPROVED','PARTIALLY_RECEIVED') THEN
    RAISE EXCEPTION 'GR_PO_NOT_RECEIVABLE' USING ERRCODE = '22023';
  END IF;
  IF receipt_lines IS NULL OR jsonb_typeof(receipt_lines) <> 'array' OR jsonb_array_length(receipt_lines) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'GR_LINES_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF receipt_note IS NOT NULL AND length(btrim(receipt_note)) > 1000 THEN
    RAISE EXCEPTION 'GR_NOTE_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.purchase_order_items WHERE po_id = target_po ORDER BY id FOR UPDATE;

  INSERT INTO public.goods_receipts(receipt_code, po_id, facility_id, received_by_id, note)
    VALUES (receipt_ref, target_po, po.facility_id, actor, nullif(btrim(receipt_note), ''))
    RETURNING id INTO receipt;

  FOR entry IN SELECT value FROM jsonb_array_elements(receipt_lines) LOOP
    IF jsonb_typeof(entry) <> 'object' OR jsonb_typeof(entry->'poItemId') <> 'number' THEN
      RAISE EXCEPTION 'GR_LINE_INVALID' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO item FROM public.purchase_order_items WHERE id = (entry->>'poItemId')::integer AND po_id = target_po;
    IF NOT FOUND OR item.variant_id IS NULL THEN RAISE EXCEPTION 'GR_LINE_INVALID' USING ERRCODE = '22023'; END IF;

    lot_number := nullif(btrim(entry->>'batchNumber'), '');
    produced := public.goods_receipt_date(entry->>'productionDate');
    expires := public.goods_receipt_date(entry->>'expiryDate');
    IF lot_number IS NULL OR length(lot_number) > 100 OR produced IS NULL OR expires IS NULL OR produced >= expires THEN
      RAISE EXCEPTION 'GR_BATCH_INVALID' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.batches(batch_number, medicine_id, manufacturer_id, manufacturer_source_facility_id, manufacturer_source_facility_name,
        production_date, expiry_date, initial_quantity, remaining_quantity, status, certificate_co_cq)
      VALUES (lot_number, item.medicine_id, po.supplier_manufacturer_id, po.supplier_id,
        (SELECT f.facility_name FROM public.facilities f WHERE f.id = po.supplier_id),
        produced, expires, 0, 0, 'ACTIVE', nullif(btrim(entry->>'certificateCoCq'), ''))
      ON CONFLICT (batch_number) DO NOTHING;
    SELECT * INTO lot FROM public.batches WHERE batch_number = lot_number FOR UPDATE;
    IF lot.medicine_id IS DISTINCT FROM item.medicine_id THEN
      RAISE EXCEPTION 'GR_BATCH_MEDICINE_MISMATCH %', lot_number USING ERRCODE = '22023';
    END IF;
    IF lot.production_date <> produced OR lot.expiry_date <> expires THEN
      RAISE EXCEPTION 'GR_BATCH_DATES_MISMATCH %', lot_number USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT FROM public.goods_receipt_lines l WHERE l.receipt_id = receipt AND l.po_item_id = item.id AND l.batch_id = lot.id) THEN
      RAISE EXCEPTION 'GR_LINE_DUPLICATE' USING ERRCODE = '22023';
    END IF;

    accepted := public.goods_receipt_uuid_list(entry->'boxUids');
    rejected := public.goods_receipt_uuid_list(entry->'rejectedBoxUids');
    carton_ids := '{}';
    IF entry->'ssccCodes' IS NOT NULL AND (jsonb_typeof(entry->'ssccCodes') <> 'array'
      OR EXISTS (SELECT FROM jsonb_array_elements(entry->'ssccCodes') v WHERE jsonb_typeof(v) <> 'string')) THEN
      RAISE EXCEPTION 'GR_CARTON_INVALID' USING ERRCODE = '22023';
    END IF;
    FOR carton IN SELECT c.* FROM public.sscc_cartons c
        WHERE c.sscc_code = ANY (ARRAY(SELECT jsonb_array_elements_text(coalesce(entry->'ssccCodes', '[]'))))
        ORDER BY c.id FOR UPDATE LOOP
      IF carton.batch_id IS DISTINCT FROM lot.id THEN
        RAISE EXCEPTION 'GR_CARTON_WRONG_BATCH %', carton.sscc_code USING ERRCODE = '22023';
      END IF;
      IF carton.current_facility_id IS NOT NULL THEN
        RAISE EXCEPTION 'GR_CARTON_UNAVAILABLE %', carton.sscc_code USING ERRCODE = '22023';
      END IF;
      carton_ids := carton_ids || carton.id;
      accepted := accepted || ARRAY(SELECT b.uid FROM public.medicine_boxes b WHERE b.carton_id = carton.id ORDER BY b.uid);
    END LOOP;
    IF cardinality(carton_ids) <> (SELECT count(DISTINCT s.code) FROM jsonb_array_elements_text(coalesce(entry->'ssccCodes', '[]')) AS s(code)) THEN
      RAISE EXCEPTION 'GR_CARTON_INVALID' USING ERRCODE = '22023';
    END IF;

    scanned := accepted || rejected;
    units := cardinality(scanned);
    IF units = 0 THEN RAISE EXCEPTION 'GR_LINE_EMPTY' USING ERRCODE = '22023'; END IF;
    IF units <> (SELECT count(DISTINCT s.uid) FROM unnest(scanned) AS s(uid)) OR scanned && seen THEN
      RAISE EXCEPTION 'GR_BOX_DUPLICATE' USING ERRCODE = '22023';
    END IF;
    seen := seen || scanned;

    reason := nullif(btrim(entry->>'rejectReason'), '');
    IF cardinality(rejected) = 0 THEN
      reason := NULL;
    ELSIF reason IS NULL OR length(reason) > 300 THEN
      RAISE EXCEPTION 'GR_REJECT_REASON_REQUIRED' USING ERRCODE = '22023';
    END IF;

    -- A box already known to the system must belong to the declared batch and must not be held by any facility yet.
    FOR box IN SELECT b.uid, b.batch_id, b.current_facility_id, b.status FROM public.medicine_boxes b
        WHERE b.uid = ANY (scanned) ORDER BY b.uid FOR UPDATE LOOP
      IF box.batch_id IS DISTINCT FROM lot.id THEN
        RAISE EXCEPTION 'GR_BOX_WRONG_BATCH %', box.uid USING ERRCODE = '22023';
      END IF;
      IF box.current_facility_id IS NOT NULL OR coalesce(box.status, 'MANUFACTURED') NOT IN ('MANUFACTURED','IN_STOCK') THEN
        RAISE EXCEPTION 'GR_BOX_UNAVAILABLE %', box.uid USING ERRCODE = '22023';
      END IF;
    END LOOP;

    UPDATE public.purchase_order_items SET received_quantity = received_quantity + units
      WHERE id = item.id AND received_quantity + units <= quantity;
    IF NOT FOUND THEN RAISE EXCEPTION 'GR_OVER_RECEIPT' USING ERRCODE = '22023'; END IF;

    UPDATE public.medicine_boxes SET current_facility_id = po.facility_id,
        status = CASE WHEN uid = ANY (rejected) THEN 'QUARANTINED' ELSE 'IN_STOCK' END
      WHERE uid = ANY (scanned);
    INSERT INTO public.medicine_boxes(uid, batch_id, current_facility_id, status)
      SELECT s.uid, lot.id, po.facility_id, CASE WHEN s.uid = ANY (rejected) THEN 'QUARANTINED' ELSE 'IN_STOCK' END
      FROM unnest(scanned) AS s(uid) WHERE NOT EXISTS (SELECT FROM public.medicine_boxes b WHERE b.uid = s.uid);
    UPDATE public.sscc_cartons SET current_facility_id = po.facility_id WHERE id = ANY (carton_ids);
    UPDATE public.batches SET initial_quantity = initial_quantity + units,
        remaining_quantity = remaining_quantity + cardinality(accepted)
      WHERE id = lot.id;

    INSERT INTO public.goods_receipt_lines(receipt_id, po_item_id, batch_id, quantity_accepted, quantity_rejected, reject_reason, box_uids, rejected_box_uids)
      VALUES (receipt, item.id, lot.id, cardinality(accepted), cardinality(rejected), reason, accepted, rejected);

    IF cardinality(accepted) > 0 THEN
      INSERT INTO public.inventories(facility_id, medicine_id, variant_id, stock_quantity, reserved_quantity)
        VALUES (po.facility_id, item.medicine_id, item.variant_id, 0, 0)
        ON CONFLICT ON CONSTRAINT uq_facility_inventory DO NOTHING;
      UPDATE public.inventories SET stock_quantity = stock_quantity + cardinality(accepted), updated_at = now()
        WHERE facility_id = po.facility_id AND variant_id = item.variant_id
        RETURNING stock_quantity INTO balance;
      INSERT INTO public.inventory_logs(facility_id, medicine_id, variant_id, batch_id, stock_bucket, transaction_type,
          quantity_changed, previous_quantity, new_quantity, reference_code, note, performed_by_id)
        VALUES (po.facility_id, item.medicine_id, item.variant_id, lot.id, 'ON_HAND', 'PURCHASE_IN',
          cardinality(accepted), balance - cardinality(accepted), balance, receipt_ref,
          format('%s, batch %s', po.po_code, lot.batch_number), actor);
      amount := amount + cardinality(accepted) * item.unit_price;
    END IF;
  END LOOP;

  FOR quarantined IN
    SELECT i.variant_id, i.medicine_id, sum(l.quantity_rejected)::integer AS units,
      CASE WHEN count(DISTINCT l.batch_id) = 1 THEN min(l.batch_id) END AS batch_id
    FROM public.goods_receipt_lines l JOIN public.purchase_order_items i ON i.id = l.po_item_id
    WHERE l.receipt_id = receipt AND l.quantity_rejected > 0
    GROUP BY i.variant_id, i.medicine_id
  LOOP
    INSERT INTO public.quarantine_balances(facility_id, variant_id, quantity) VALUES (po.facility_id, quarantined.variant_id, 0)
      ON CONFLICT DO NOTHING;
    UPDATE public.quarantine_balances SET quantity = quantity + quarantined.units
      WHERE facility_id = po.facility_id AND variant_id = quarantined.variant_id
      RETURNING quantity INTO balance;
    INSERT INTO public.inventory_logs(facility_id, medicine_id, variant_id, batch_id, stock_bucket, transaction_type,
        quantity_changed, previous_quantity, new_quantity, reference_code, note, performed_by_id)
      VALUES (po.facility_id, quarantined.medicine_id, quarantined.variant_id, quarantined.batch_id, 'QUARANTINE', 'QUARANTINE_IN',
        quarantined.units, balance - quarantined.units, balance, receipt_ref,
        format('IN: %s units rejected at receipt', quarantined.units), actor)
      RETURNING id INTO log_id;
    INSERT INTO public.quarantine_movements(origin_type, origin_id, variant_id, action, inventory_log_id)
      VALUES ('PO_RECEIPT', receipt, quarantined.variant_id, 'IN', log_id);
  END LOOP;

  next_status := CASE WHEN EXISTS (SELECT FROM public.purchase_order_items WHERE po_id = target_po AND received_quantity < quantity)
    THEN 'PARTIALLY_RECEIVED' ELSE 'RECEIVED' END;
  UPDATE public.purchase_orders SET status = next_status, received_at = CASE WHEN next_status = 'RECEIVED' THEN now() END
    WHERE id = target_po;
  INSERT INTO public.purchase_order_events(po_id, action, from_status, to_status, actor_id, note)
    VALUES (target_po, 'GOODS_RECEIVED', po.status, next_status, actor, 'Receipt ' || receipt_ref);

  IF amount > 0 THEN
    supplier := coalesce((SELECT f.facility_name FROM public.facilities f WHERE f.id = po.supplier_id),
      (SELECT m.name FROM public.manufacturers m WHERE m.id = po.supplier_manufacturer_id));
    INSERT INTO public.accounts_payable(supplier_name, supplier_id, po_id, goods_receipt_id, total_due_amount)
      VALUES (supplier, po.supplier_id, target_po, receipt, amount);
  END IF;
  RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION public.record_goods_receipt(integer, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_goods_receipt(integer, text, text, jsonb) TO app_user;
COMMIT;
