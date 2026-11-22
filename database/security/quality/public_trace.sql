\set ON_ERROR_STOP on
BEGIN;
-- Public box tracing: a consumer-safe box summary and timeline, public scan logging that flags impossible travel
-- speed and excessive rescans as fraud alerts, and the scan counters of the admin fraud radar.
-- Errors raised with a TR_* code are mapped by the API.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install public trace as a trusted superuser';
  END IF;
  IF to_regprocedure('public.record_scan_anomaly(uuid, text[])') IS NULL THEN
    RAISE EXCEPTION 'Install warehouse_traceability.sql first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.public_box_trace(target uuid)
RETURNS TABLE(uid uuid, medicine_name text, manufacturer text, batch_number text, production_date date, expiry_date date,
  batch_status text, box_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT b.uid, m.medicine_name::text, m.manufacturer::text, lot.batch_number::text, lot.production_date, lot.expiry_date,
    lot.status::text, b.status::text
  FROM public.medicine_boxes b
  JOIN public.batches lot ON lot.id = b.batch_id
  JOIN public.medicines m ON m.id = lot.medicine_id
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
  SELECT c.received_at, 'TRANSFER_RECEIVED', f.facility_name::text
    FROM public.transfer_custody c
    JOIN public.internal_transfers t ON t.id = c.transfer_id
    JOIN public.facilities f ON f.id = t.to_facility_id
    WHERE target = ANY (c.box_uids) AND c.received_at IS NOT NULL
  ORDER BY 1
$$;
REVOKE ALL ON FUNCTION public.public_box_timeline(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_box_timeline(uuid) TO app_user;

-- Logs one public scan and opens a fraud alert when the box was last scanned somewhere it could not have travelled to
-- (faster than 900 km/h) or has been scanned more than 5 times in the last hour. An open alert of the same type
-- for the same box is not duplicated.
CREATE OR REPLACE FUNCTION public.record_public_scan(target uuid, lat double precision, lng double precision, ip text, agent text)
RETURNS TABLE(scan_result text, risk_score integer, reasons text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  prev record;
  flags text[] := ARRAY[]::text[];
  score integer := 0;
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
      IF kmh > 900 THEN
        flags := array_append(flags, 'IMPOSSIBLE_TRAVEL');
        score := 80;
        INSERT INTO public.fraud_alerts(uid, fraud_type, severity_level, description, latitude_1, longitude_1, latitude_2,
          longitude_2, distance_km, time_delta_minutes, calculated_speed_kmh, scanned_code)
        VALUES (target, 'IMPOSSIBLE_TRAVEL', 'CRITICAL', 'Consecutive public scans imply an impossible travel speed',
          prev.latitude, prev.longitude, lat, lng, km, minutes, kmh, target::text)
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;

  IF (SELECT count(*) FROM public.qr_scan_logs q WHERE q.uid = target AND q.scanned_at > localtimestamp - interval '1 hour') >= 5 THEN
    flags := array_append(flags, 'EXCESSIVE_SCANS');
    score := greatest(score, 50);
    INSERT INTO public.fraud_alerts(uid, fraud_type, severity_level, description, scanned_code)
    VALUES (target, 'EXCESSIVE_SCANS', 'WARNING', 'The box was scanned more than 5 times within an hour', target::text)
    ON CONFLICT DO NOTHING;
  END IF;

  scan_result := CASE WHEN score > 0 THEN 'SUSPICIOUS' ELSE 'VALID' END;
  INSERT INTO public.qr_scan_logs(uid, latitude, longitude, ip_address, user_agent, scan_result, risk_score)
  VALUES (target, lat, lng, left(ip, 50), agent, scan_result, score);
  risk_score := score;
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
  RETURN QUERY SELECT count(*)::integer, (count(*) FILTER (WHERE q.scan_result = 'SUSPICIOUS'))::integer
    FROM public.qr_scan_logs q WHERE q.scanned_at > localtimestamp - interval '24 hours';
END $$;
REVOKE ALL ON FUNCTION public.fraud_scan_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fraud_scan_stats() TO app_user;
COMMIT;
