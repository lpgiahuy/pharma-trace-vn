\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install shipment carrier confirmation as a trusted superuser';
  END IF;
END $$;

-- Confirms the carrier and its tracking number of a shipment that waits for pickup, under the 'carrier' operation.
-- The export facility of the order confirms it: store managers and pharmacists for an order exported from their
-- pharmacy, warehouse staff and managers (WH_ALL) for an order their warehouse packed. Nobody confirms a shipment of
-- another facility; SUPER_ADMIN confirms any. Mirrored by the roles of withOrder('carrier') and
-- PATCH admin/logistics/shipments/:id/carrier in the backend.
--
-- 'carrier' is not an operation of order_operation_allowed(), so it never writes the order tables directly: the only
-- write it allows is this function, which changes only courier_name, tracking_number, carrier_confirmed_at and
-- updated_at. The handover still requires the confirmation (record_carrier_handover, HV_CARRIER_NOT_CONFIRMED).
CREATE OR REPLACE FUNCTION public.confirm_shipment_carrier(target_shipment integer, courier text, tracking text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor integer := nullif(current_setting('app.current_user_id', true), '')::integer;
  courier_code text := upper(btrim(courier));
  tracking_code text := btrim(tracking);
  ship public.shipments%ROWTYPE;
  facility integer;
BEGIN
  IF actor IS NULL OR current_setting('app.order_operation', true) IS DISTINCT FROM 'carrier'
     OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
     OR NOT (coalesce(current_setting('app.current_user_role', true), '') IN ('SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST')
       OR public.app_role_in_group('WH_ALL')) THEN
    RAISE EXCEPTION 'CR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF coalesce(courier_code, '') = '' OR length(courier_code) > 100 OR coalesce(tracking_code, '') = '' OR length(tracking_code) > 50 THEN
    RAISE EXCEPTION 'CR_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT s.* INTO ship FROM public.shipments s WHERE s.id = target_shipment FOR UPDATE;
  IF FOUND THEN SELECT o.export_facility_id INTO facility FROM public.orders o WHERE o.id = ship.order_id; END IF;
  -- A shipment of another facility looks the same as a missing one.
  IF ship.id IS NULL OR public.order_staff(facility) IS NOT TRUE THEN
    RAISE EXCEPTION 'CR_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF ship.shipping_status IS DISTINCT FROM 'PENDING_PICKUP' THEN
    RAISE EXCEPTION 'CR_NOT_PENDING_PICKUP' USING ERRCODE = '22023';
  END IF;

  UPDATE public.shipments SET courier_name = courier_code, tracking_number = tracking_code,
    carrier_confirmed_at = now(), updated_at = now()
  WHERE id = target_shipment;
END $$;
REVOKE ALL ON FUNCTION public.confirm_shipment_carrier(integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_shipment_carrier(integer, text, text) TO app_user;
COMMIT;
