\set ON_ERROR_STOP on
BEGIN;
-- Box traceability for warehouses: a box timeline built from the existing event records, scan anomalies that open
-- fraud alerts, carton unpacking and manager resolution of alerts. A scan never proves a box is authentic; it only
-- raises alerts. Errors raised with a TR_* code are mapped by the API.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install warehouse traceability as a trusted superuser';
  END IF;
  IF to_regclass('public.disposal_events') IS NULL OR to_regclass('public.carrier_handovers') IS NULL THEN
    RAISE EXCEPTION 'Install drug_disposals.sql and carrier_handovers.sql first';
  END IF;
END $$;

ALTER TABLE public.fraud_alerts
  ADD COLUMN IF NOT EXISTS facility_id integer REFERENCES public.facilities(id),
  ADD COLUMN IF NOT EXISTS scanned_code text,
  ADD COLUMN IF NOT EXISTS reported_by_id integer REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS resolved_by_id integer REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_note text;
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_facility ON public.fraud_alerts(facility_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fraud_alerts_open_scan
  ON public.fraud_alerts(scanned_code, fraud_type, (coalesce(facility_id, 0)))
  WHERE resolution_status = 'UNRESOLVED' AND scanned_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.carton_events (
  id bigserial PRIMARY KEY,
  carton_id integer NOT NULL REFERENCES public.sscc_cartons(id),
  action varchar(20) NOT NULL CHECK (action IN ('UNPACKED')),
  facility_id integer REFERENCES public.facilities(id),
  actor_id integer NOT NULL REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_carton_events_carton ON public.carton_events(carton_id);

CREATE OR REPLACE FUNCTION public.fraud_alert_in_scope(alert_facility integer, alert_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT public.po_in_scope(alert_facility) IS TRUE
    OR EXISTS (SELECT FROM public.medicine_boxes b WHERE b.uid = alert_uid AND public.po_in_scope(b.current_facility_id) IS TRUE)
$$;
REVOKE ALL ON FUNCTION public.fraud_alert_in_scope(integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fraud_alert_in_scope(integer, uuid) TO app_user;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['fraud_alerts', 'carton_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, app_user', t);
    EXECUTE format('GRANT SELECT ON public.%I TO app_user', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS fraud_alert_read ON public.fraud_alerts;
CREATE POLICY fraud_alert_read ON public.fraud_alerts FOR SELECT TO app_user
  USING (public.app_role_in_group('WH_MANAGER') AND public.fraud_alert_in_scope(facility_id, uid));
DROP POLICY IF EXISTS carton_event_read ON public.carton_events;
CREATE POLICY carton_event_read ON public.carton_events FOR SELECT TO app_user
  USING (public.app_role_in_group('WH_ALL') AND public.po_in_scope(facility_id) IS TRUE);

CREATE OR REPLACE FUNCTION public.trace_actor(role_group text) RETURNS integer
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE actor integer := nullif(current_setting('app.current_user_id', true), '')::integer;
BEGIN
  IF actor IS NULL OR NOT public.app_role_in_group(role_group) THEN RAISE EXCEPTION 'TR_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  RETURN actor;
END $$;
REVOKE ALL ON FUNCTION public.trace_actor(text) FROM PUBLIC;

-- What the scan check needs about one box, whichever warehouse holds it. Empty for an unknown uid.
CREATE OR REPLACE FUNCTION public.scan_box_facts(scanned uuid)
RETURNS TABLE(uid uuid, batch_number text, signature text, status text, facility_id integer, batch_status text,
  expiry_date date, medicine_name text, sscc_code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT b.uid, lot.batch_number::text, b.signature, b.status::text, b.current_facility_id, lot.status::text,
    lot.expiry_date, m.medicine_name::text, c.sscc_code::text
  FROM public.medicine_boxes b
  LEFT JOIN public.batches lot ON lot.id = b.batch_id
  LEFT JOIN public.medicines m ON m.id = lot.medicine_id
  LEFT JOIN public.sscc_cartons c ON c.id = b.carton_id
  WHERE b.uid = scanned AND public.app_role_in_group('WH_ALL')
$$;
REVOKE ALL ON FUNCTION public.scan_box_facts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scan_box_facts(uuid) TO app_user;

-- Opens one alert per reason for a scanned code. A repeated scan of the same code with the same reason adds nothing
-- while that alert is unresolved.
CREATE OR REPLACE FUNCTION public.record_scan_anomaly(scanned uuid, reasons text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor integer := public.trace_actor('WH_ALL');
  unit integer := nullif(current_setting('app.current_unit_id', true), '')::integer;
  known uuid; holder integer;
BEGIN
  IF coalesce(cardinality(reasons), 0) = 0
    OR NOT reasons <@ ARRAY['UNKNOWN_UID', 'SIGNATURE_MISMATCH', 'NOT_AT_WAREHOUSE', 'BOX_STATUS_UNEXPECTED'] THEN
    RAISE EXCEPTION 'TR_REASON_INVALID' USING ERRCODE = '22023';
  END IF;
  SELECT b.uid, b.current_facility_id INTO known, holder FROM public.medicine_boxes b WHERE b.uid = scanned;
  INSERT INTO public.fraud_alerts(uid, fraud_type, description, facility_id, scanned_code, reported_by_id)
    SELECT known, r, 'Flagged by a warehouse scan', coalesce(unit, holder), scanned::text, actor FROM unnest(reasons) r
    ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.record_scan_anomaly(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_scan_anomaly(uuid, text[]) TO app_user;

CREATE OR REPLACE FUNCTION public.resolve_fraud_alert(target integer, note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor integer := public.trace_actor('WH_MANAGER');
  alert public.fraud_alerts%ROWTYPE;
BEGIN
  IF note IS NULL OR length(btrim(note)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'TR_NOTE_REQUIRED' USING ERRCODE = '22023'; END IF;
  SELECT * INTO alert FROM public.fraud_alerts WHERE id = target FOR UPDATE;
  IF NOT FOUND OR public.fraud_alert_in_scope(alert.facility_id, alert.uid) IS NOT TRUE THEN RAISE EXCEPTION 'TR_ALERT_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF alert.resolution_status = 'RESOLVED' THEN RETURN; END IF;
  UPDATE public.fraud_alerts SET resolution_status = 'RESOLVED', resolved_by_id = actor, resolved_at = now(), resolution_note = btrim(note)
    WHERE id = target;
END $$;
REVOKE ALL ON FUNCTION public.resolve_fraud_alert(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_fraud_alert(integer, text) TO app_user;

-- One carton with its boxes. Empty when the carton is unknown or not held by the caller's warehouse.
CREATE OR REPLACE FUNCTION public.carton_overview(code text)
RETURNS TABLE(carton_id integer, sscc_code text, status text, facility_id integer, batch_number text, medicine_name text,
  box_uid uuid, box_status text, box_facility_id integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT c.id, c.sscc_code::text, c.status::text, c.current_facility_id, lot.batch_number::text, m.medicine_name::text,
    b.uid, b.status::text, b.current_facility_id
  FROM public.sscc_cartons c
  LEFT JOIN public.batches lot ON lot.id = c.batch_id
  LEFT JOIN public.medicines m ON m.id = lot.medicine_id
  LEFT JOIN public.medicine_boxes b ON b.carton_id = c.id
  WHERE c.sscc_code = code AND public.app_role_in_group('WH_ALL') AND public.po_in_scope(c.current_facility_id) IS TRUE
  ORDER BY b.uid
$$;
REVOKE ALL ON FUNCTION public.carton_overview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.carton_overview(text) TO app_user;

-- Marks a packaged carton as opened. The boxes keep their carton for lineage. Unpacking twice does nothing.
CREATE OR REPLACE FUNCTION public.unpack_carton(code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor integer := public.trace_actor('WH_ALL');
  carton public.sscc_cartons%ROWTYPE;
BEGIN
  SELECT * INTO carton FROM public.sscc_cartons WHERE sscc_code = code FOR UPDATE;
  IF NOT FOUND OR public.po_in_scope(carton.current_facility_id) IS NOT TRUE THEN RAISE EXCEPTION 'TR_CARTON_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF carton.status = 'UNPACKED' THEN RETURN; END IF;
  IF carton.status IS DISTINCT FROM 'PACKAGED' THEN RAISE EXCEPTION 'TR_CARTON_NOT_UNPACKABLE' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT FROM public.medicine_boxes b WHERE b.carton_id = carton.id AND b.current_facility_id IS DISTINCT FROM carton.current_facility_id) THEN
    RAISE EXCEPTION 'TR_CARTON_INCOMPLETE' USING ERRCODE = '22023';
  END IF;
  UPDATE public.sscc_cartons SET status = 'UNPACKED' WHERE id = carton.id;
  INSERT INTO public.carton_events(carton_id, action, facility_id, actor_id) VALUES (carton.id, 'UNPACKED', carton.current_facility_id, actor);
END $$;
REVOKE ALL ON FUNCTION public.unpack_carton(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unpack_carton(text) TO app_user;

-- Timeline of one box, oldest first, from the receipt, transfer, carton, package, handover, return, recall, disposal,
-- public scan and fraud alert records. Visible to a warehouse that holds the box now or appears in its history.
-- Empty when the box is unknown or outside that scope. step orders events that share a timestamp.
CREATE OR REPLACE FUNCTION public.box_history(target uuid)
RETURNS TABLE(occurred_at timestamptz, event_type text, facility_id integer, actor_id integer, reference text, detail text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH ev(occurred_at, step, event_type, facility_id, actor_id, reference, detail) AS (
    SELECT b.created_at::timestamptz, 1, 'CREATED', NULL::integer, NULL::integer, lot.batch_number::text, NULL::text
      FROM public.medicine_boxes b LEFT JOIN public.batches lot ON lot.id = b.batch_id WHERE b.uid = target
    UNION ALL
    SELECT r.received_at, 2, CASE WHEN target = ANY (l.box_uids) THEN 'RECEIVED' ELSE 'RECEIPT_REJECTED' END, r.facility_id,
      r.received_by_id, r.receipt_code::text, CASE WHEN target = ANY (l.box_uids) THEN NULL ELSE l.reject_reason END
      FROM public.goods_receipt_lines l JOIN public.goods_receipts r ON r.id = l.receipt_id
      WHERE target = ANY (l.box_uids) OR target = ANY (l.rejected_box_uids)
    UNION ALL
    SELECT e.created_at, 3, 'CARTON_UNPACKED', e.facility_id, e.actor_id, c.sscc_code::text, NULL
      FROM public.medicine_boxes b JOIN public.sscc_cartons c ON c.id = b.carton_id
      JOIN public.carton_events e ON e.carton_id = c.id WHERE b.uid = target
    UNION ALL
    SELECT c.handed_over_at, 4, 'TRANSFER_DISPATCHED', t.from_facility_id, NULL, t.transfer_code::text, NULL
      FROM public.transfer_custody c JOIN public.internal_transfers t ON t.id = c.transfer_id WHERE target = ANY (c.box_uids)
    UNION ALL
    SELECT c.received_at, 5, 'TRANSFER_RECEIVED', t.to_facility_id, NULL, t.transfer_code::text, t.status::text
      FROM public.transfer_custody c JOIN public.internal_transfers t ON t.id = c.transfer_id
      WHERE target = ANY (c.box_uids) AND c.received_at IS NOT NULL
    UNION ALL
    SELECT p.packed_at, 6, 'PACKED', p.facility_id, p.packed_by_id, p.package_code::text, NULL
      FROM public.order_package_items i JOIN public.order_packages p ON p.id = i.package_id WHERE i.box_uid = target
    UNION ALL
    SELECT i.voided_at, 7, 'PACKAGE_VOIDED', p.facility_id, p.voided_by_id, p.package_code::text, p.void_reason
      FROM public.order_package_items i JOIN public.order_packages p ON p.id = i.package_id
      WHERE i.box_uid = target AND i.voided_at IS NOT NULL
    UNION ALL
    SELECT h.handed_over_at, 8, 'HANDED_OVER', h.facility_id, h.handed_over_by_id, h.handover_code::text, h.courier_name::text
      FROM public.order_package_items i JOIN public.carrier_handover_packages hp ON hp.package_id = i.package_id
      JOIN public.carrier_handovers h ON h.id = hp.handover_id WHERE i.box_uid = target
    UNION ALL
    SELECT r.received_at, 9, 'RETURNED', o.export_facility_id, r.received_by, s.tracking_number::text, NULL
      FROM public.shipment_return_items r JOIN public.shipments s ON s.id = r.shipment_id
      JOIN public.orders o ON o.id = s.order_id WHERE target = ANY (r.box_uids)
    UNION ALL
    SELECT e.created_at, 10, 'RECALL_' || e.action, e.facility_id, e.actor_id, c.recall_code::text, e.note
      FROM public.batch_recall_events e JOIN public.batch_recalls c ON c.id = e.recall_id WHERE target = ANY (e.box_uids)
    UNION ALL
    SELECT e.created_at, 11, CASE e.action WHEN 'COMPLETED' THEN 'DESTROYED' ELSE 'DISPOSAL_' || e.action END, d.facility_id,
      e.actor_id, d.disposal_code::text, e.note
      FROM public.disposal_items i JOIN public.disposals d ON d.id = i.disposal_id
      JOIN public.disposal_events e ON e.disposal_id = d.id WHERE i.box_uid = target AND e.action <> 'ATTACHMENT_ADDED'
    UNION ALL
    SELECT q.scanned_at::timestamptz, 12, 'PUBLIC_SCAN', NULL, NULL, NULL, q.scan_result::text
      FROM public.qr_scan_logs q WHERE q.uid = target
    UNION ALL
    SELECT a.created_at::timestamptz, 13, 'FRAUD_ALERT', a.facility_id, a.reported_by_id, a.id::text, a.fraud_type::text
      FROM public.fraud_alerts a WHERE a.uid = target
    UNION ALL
    SELECT a.resolved_at, 14, 'FRAUD_ALERT_RESOLVED', a.facility_id, a.resolved_by_id, a.id::text, a.resolution_note
      FROM public.fraud_alerts a WHERE a.uid = target AND a.resolved_at IS NOT NULL
  )
  SELECT ev.occurred_at, ev.event_type, ev.facility_id, ev.actor_id, ev.reference, ev.detail FROM ev
  WHERE public.app_role_in_group('WH_ALL')
    AND (public.po_in_scope((SELECT b.current_facility_id FROM public.medicine_boxes b WHERE b.uid = target)) IS TRUE
      OR EXISTS (SELECT FROM ev e WHERE public.po_in_scope(e.facility_id) IS TRUE))
  ORDER BY ev.occurred_at, ev.step
$$;
REVOKE ALL ON FUNCTION public.box_history(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.box_history(uuid) TO app_user;
COMMIT;
