\set ON_ERROR_STOP on
BEGIN;
-- Public box tracing: a consumer-safe box summary and distribution timeline (manufacture, receipt, transfer, packing,
-- courier handover, delivery and code activation, with warehouse names only), dual-code activation (the first valid secret code
-- activates a box, later entries show the original activation), public scan logging, automatic counterfeit flagging
-- (a box scanned or entered 10 times within a minute, or scanned in two places too far apart to be reached in the time
-- between the scans, is flagged until an administrator resolves its alert) and the scan counters of the admin fraud radar.
-- Errors raised with a TR_* code are mapped by the API.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install public trace as a trusted superuser';
  END IF;
  IF to_regprocedure('public.record_scan_anomaly(uuid, text[])') IS NULL THEN
    RAISE EXCEPTION 'Install warehouse_traceability.sql first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.box_activations (
  uid uuid PRIMARY KEY REFERENCES public.medicine_boxes(uid) ON DELETE CASCADE,
  activated_at timestamptz NOT NULL DEFAULT now(),
  verify_count integer NOT NULL DEFAULT 1
);
ALTER TABLE public.box_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.box_activations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.box_activations FROM PUBLIC, app_user;

CREATE TABLE IF NOT EXISTS public.box_code_entries (
  id bigserial PRIMARY KEY,
  uid uuid NOT NULL REFERENCES public.medicine_boxes(uid) ON DELETE CASCADE,
  valid boolean NOT NULL,
  device text NOT NULL,
  entered_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_box_code_entries_uid ON public.box_code_entries(uid, entered_at);
ALTER TABLE public.box_code_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.box_code_entries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.box_code_entries FROM PUBLIC, app_user;

-- A box is flagged as counterfeit while it has an unresolved IMPOSSIBLE_TRAVEL, EXCESSIVE_SCANS or CODE_BURST alert.
-- Resolving the alert clears the flag.
CREATE OR REPLACE FUNCTION public.box_flagged(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (SELECT FROM public.fraud_alerts f WHERE f.uid = target AND f.resolution_status = 'UNRESOLVED'
    AND f.fraud_type IN ('IMPOSSIBLE_TRAVEL', 'EXCESSIVE_SCANS', 'CODE_BURST'))
$$;
REVOKE ALL ON FUNCTION public.box_flagged(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.box_flagged(uuid) TO app_user;

DROP FUNCTION IF EXISTS public.public_box_trace(uuid);
CREATE FUNCTION public.public_box_trace(target uuid)
RETURNS TABLE(uid uuid, medicine_name text, manufacturer text, batch_number text, production_date date, expiry_date date,
  batch_status text, box_status text, activated_at timestamptz, verify_count integer, flagged boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT b.uid, m.medicine_name::text, m.manufacturer::text, lot.batch_number::text, lot.production_date, lot.expiry_date,
    lot.status::text, b.status::text, a.activated_at, coalesce(a.verify_count, 0), public.box_flagged(b.uid)
  FROM public.medicine_boxes b
  JOIN public.batches lot ON lot.id = b.batch_id
  JOIN public.medicines m ON m.id = lot.medicine_id
  LEFT JOIN public.box_activations a ON a.uid = b.uid
  WHERE b.uid = target
$$;
REVOKE ALL ON FUNCTION public.public_box_trace(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_box_trace(uuid) TO app_user;

CREATE OR REPLACE FUNCTION public.public_box_timeline(target uuid)
RETURNS TABLE(occurred_at timestamptz, event_type text, facility_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT b.created_at::timestamptz, 'MANUFACTURED', NULL::text FROM public.medicine_boxes b WHERE b.uid = target
  UNION ALL
  SELECT r.received_at, 'RECEIVED', f.facility_name::text
    FROM public.goods_receipt_lines l
    JOIN public.goods_receipts r ON r.id = l.receipt_id
    JOIN public.facilities f ON f.id = r.facility_id
    WHERE target = ANY (l.box_uids)
  UNION ALL
  SELECT c.handed_over_at, 'TRANSFER_DISPATCHED', f.facility_name::text
    FROM public.transfer_custody c
    JOIN public.internal_transfers t ON t.id = c.transfer_id
    JOIN public.facilities f ON f.id = t.from_facility_id
    WHERE target = ANY (c.box_uids)
  UNION ALL
  SELECT c.received_at, 'TRANSFER_RECEIVED', f.facility_name::text
    FROM public.transfer_custody c
    JOIN public.internal_transfers t ON t.id = c.transfer_id
    JOIN public.facilities f ON f.id = t.to_facility_id
    WHERE target = ANY (c.box_uids) AND c.received_at IS NOT NULL
  UNION ALL
  SELECT p.packed_at, 'PACKED', f.facility_name::text
    FROM public.order_package_items i
    JOIN public.order_packages p ON p.id = i.package_id
    JOIN public.facilities f ON f.id = p.facility_id
    WHERE i.box_uid = target AND i.voided_at IS NULL
  UNION ALL
  SELECT h.handed_over_at, 'HANDED_OVER', f.facility_name::text
    FROM public.order_package_items i
    JOIN public.carrier_handover_packages hp ON hp.package_id = i.package_id
    JOIN public.carrier_handovers h ON h.id = hp.handover_id
    JOIN public.facilities f ON f.id = h.facility_id
    WHERE i.box_uid = target AND i.voided_at IS NULL
  UNION ALL
  SELECT DISTINCT s.actual_delivery_at::timestamptz, 'DELIVERED', NULL::text
    FROM public.order_package_items i
    JOIN public.order_packages p ON p.id = i.package_id
    JOIN public.shipments s ON s.order_id = p.order_id
    WHERE i.box_uid = target AND i.voided_at IS NULL AND s.actual_delivery_at IS NOT NULL
  UNION ALL
  SELECT a.activated_at, 'CODE_ACTIVATED', NULL::text FROM public.box_activations a WHERE a.uid = target
  ORDER BY 1
$$;
REVOKE ALL ON FUNCTION public.public_box_timeline(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_box_timeline(uuid) TO app_user;

-- Records one secret code entry whose validity the API already checked, made from the given device. The first valid
-- entry activates the box and later valid entries only count; an invalid entry changes nothing. Returns the activation
-- state after the entry (no activation: NULL time and 0 entries) and whether the box is flagged as counterfeit.
-- Alerts, each opened once while an alert of the same type for the box is unresolved: CODE_BURST (CRITICAL, flags the
-- box) for 10 valid entries within a minute, CODE_REUSED (WARNING) for a valid code entered from a second device and
-- CODE_GUESSING (WARNING) for 5 wrong entries within 10 minutes.
DROP FUNCTION IF EXISTS public.record_box_verification(uuid, boolean);
DROP FUNCTION IF EXISTS public.record_box_verification(uuid, boolean, text);
CREATE FUNCTION public.record_box_verification(target uuid, valid boolean, device text)
RETURNS TABLE(first_activation boolean, activated_at timestamptz, verify_count integer, flagged boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT FROM public.medicine_boxes b WHERE b.uid = target) THEN
    RAISE EXCEPTION 'TR_BOX_NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.box_code_entries(uid, valid, device) VALUES (target, valid, device);
  IF valid THEN
    INSERT INTO public.box_activations AS a(uid) VALUES (target)
      ON CONFLICT (uid) DO UPDATE SET verify_count = a.verify_count + 1
      RETURNING (xmax = 0), a.activated_at, a.verify_count INTO first_activation, activated_at, verify_count;
    IF (SELECT count(*) FROM public.box_code_entries e WHERE e.uid = target AND e.valid AND e.entered_at > now() - interval '1 minute') >= 10 THEN
      INSERT INTO public.fraud_alerts(uid, fraud_type, severity_level, description, scanned_code)
      VALUES (target, 'CODE_BURST', 'CRITICAL', 'The secret code was entered 10 times within a minute', target::text)
      ON CONFLICT DO NOTHING;
    END IF;
    IF (SELECT count(DISTINCT e.device) FROM public.box_code_entries e WHERE e.uid = target AND e.valid) >= 2 THEN
      INSERT INTO public.fraud_alerts(uid, fraud_type, severity_level, description, scanned_code)
      VALUES (target, 'CODE_REUSED', 'WARNING', 'The secret code was entered from more than one device', target::text)
      ON CONFLICT DO NOTHING;
    END IF;
  ELSE
    SELECT false, a.activated_at, coalesce(a.verify_count, 0) INTO first_activation, activated_at, verify_count
      FROM (SELECT 1) one LEFT JOIN public.box_activations a ON a.uid = target;
    IF (SELECT count(*) FROM public.box_code_entries e WHERE e.uid = target AND NOT e.valid AND e.entered_at > now() - interval '10 minutes') >= 5 THEN
      INSERT INTO public.fraud_alerts(uid, fraud_type, severity_level, description, scanned_code)
      VALUES (target, 'CODE_GUESSING', 'WARNING', 'The secret code was entered wrongly 5 times within 10 minutes', target::text)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  flagged := public.box_flagged(target);
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.record_box_verification(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_box_verification(uuid, boolean, text) TO app_user;

-- Logs one public scan. Two findings flag the box as counterfeit and open a CRITICAL alert (not duplicated while an alert
-- of the same type for the box is unresolved): the box was last scanned somewhere it could not have reached at under
-- 1000 km/h (IMPOSSIBLE_TRAVEL), or it was scanned 10 times within a minute (EXCESSIVE_SCANS). The result is FLAGGED while
-- the box is flagged, otherwise VALID, and reasons lists the findings of this scan.
DROP FUNCTION IF EXISTS public.record_public_scan(uuid, double precision, double precision, text, text);
CREATE FUNCTION public.record_public_scan(target uuid, lat double precision, lng double precision, ip text, agent text)
RETURNS TABLE(scan_result text, reasons text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  prev record;
  flags text[] := ARRAY[]::text[];
  km double precision;
  minutes double precision;
  kmh double precision;
BEGIN
  IF (lat IS NULL) <> (lng IS NULL) OR lat NOT BETWEEN -90 AND 90 OR lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'TR_LOCATION_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT FROM public.medicine_boxes b WHERE b.uid = target) THEN
    RAISE EXCEPTION 'TR_BOX_NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target::text, 0));

  IF lat IS NOT NULL THEN
    SELECT q.latitude, q.longitude, q.scanned_at INTO prev FROM public.qr_scan_logs q
      WHERE q.uid = target AND q.latitude IS NOT NULL ORDER BY q.scanned_at DESC, q.id DESC LIMIT 1;
    IF FOUND THEN
      km := 12742 * asin(sqrt(least(1, sin(radians(lat - prev.latitude) / 2) ^ 2
        + cos(radians(prev.latitude)) * cos(radians(lat)) * sin(radians(lng - prev.longitude) / 2) ^ 2)));
      minutes := greatest(extract(epoch FROM localtimestamp - prev.scanned_at) / 60, 1);
      kmh := km / (minutes / 60);
      IF kmh > 1000 THEN
        flags := array_append(flags, 'IMPOSSIBLE_TRAVEL');
        INSERT INTO public.fraud_alerts(uid, fraud_type, severity_level, description, latitude_1, longitude_1, latitude_2,
          longitude_2, distance_km, time_delta_minutes, calculated_speed_kmh, scanned_code)
        VALUES (target, 'IMPOSSIBLE_TRAVEL', 'CRITICAL', 'Consecutive public scans imply an impossible travel speed',
          prev.latitude, prev.longitude, lat, lng, km, minutes, kmh, target::text)
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;

  IF (SELECT count(*) FROM public.qr_scan_logs q WHERE q.uid = target AND q.scanned_at > localtimestamp - interval '1 minute') >= 9 THEN
    flags := array_append(flags, 'EXCESSIVE_SCANS');
    INSERT INTO public.fraud_alerts(uid, fraud_type, severity_level, description, scanned_code)
    VALUES (target, 'EXCESSIVE_SCANS', 'CRITICAL', 'The box was scanned 10 times within a minute', target::text)
    ON CONFLICT DO NOTHING;
  END IF;

  scan_result := CASE WHEN public.box_flagged(target) THEN 'FLAGGED' ELSE 'VALID' END;
  INSERT INTO public.qr_scan_logs(uid, latitude, longitude, ip_address, user_agent, scan_result, risk_score)
  VALUES (target, lat, lng, left(ip, 50), agent, scan_result, CASE WHEN scan_result = 'FLAGGED' THEN 100 ELSE 0 END);
  reasons := flags;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.record_public_scan(uuid, double precision, double precision, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_public_scan(uuid, double precision, double precision, text, text) TO app_user;

CREATE OR REPLACE FUNCTION public.fraud_scan_stats()
RETURNS TABLE(scans_24h integer, suspicious_24h integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF coalesce(current_setting('app.current_user_type', true), '') <> 'employee'
    OR coalesce(current_setting('app.current_user_role', true), '') <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'TR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT count(*)::integer, (count(*) FILTER (WHERE q.scan_result IN ('FLAGGED', 'SUSPICIOUS')))::integer
    FROM public.qr_scan_logs q WHERE q.scanned_at > localtimestamp - interval '24 hours';
END $$;
REVOKE ALL ON FUNCTION public.fraud_scan_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fraud_scan_stats() TO app_user;
COMMIT;
