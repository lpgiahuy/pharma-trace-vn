\set ON_ERROR_STOP on
BEGIN;
-- A carton (SSCC) is where its boxes are. Receiving a transfer moves the boxes, but not the carton row, so the next
-- dispatch from the new facility rejected the carton ("Carton ... is not at the source facility") although every one
-- of its boxes was in stock there. Keep the carton with its boxes: once every box that still has a facility is at the
-- same facility, the carton is too. Boxes in transit or lost have no facility and do not hold the carton back.
CREATE OR REPLACE FUNCTION public.sync_carton_location() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.carton_id IS NULL OR NEW.current_facility_id IS NULL THEN RETURN NEW; END IF;
  UPDATE public.sscc_cartons c SET current_facility_id = NEW.current_facility_id
    WHERE c.id = NEW.carton_id AND c.status IS DISTINCT FROM 'VOIDED' AND c.current_facility_id IS DISTINCT FROM NEW.current_facility_id
      AND NOT EXISTS (SELECT FROM public.medicine_boxes b
        WHERE b.carton_id = c.id AND b.current_facility_id IS NOT NULL AND b.current_facility_id <> NEW.current_facility_id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_carton_location() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_sync_carton_location ON public.medicine_boxes;
CREATE TRIGGER trg_sync_carton_location AFTER UPDATE OF current_facility_id ON public.medicine_boxes
  FOR EACH ROW WHEN (NEW.current_facility_id IS DISTINCT FROM OLD.current_facility_id) EXECUTE FUNCTION public.sync_carton_location();

-- Cartons that were left behind by transfers received before this trigger existed.
UPDATE public.sscc_cartons c SET current_facility_id = loc.facility_id
  FROM (SELECT b.carton_id, min(b.current_facility_id) AS facility_id
          FROM public.medicine_boxes b WHERE b.carton_id IS NOT NULL AND b.current_facility_id IS NOT NULL
          GROUP BY b.carton_id HAVING count(DISTINCT b.current_facility_id) = 1) loc
  WHERE c.id = loc.carton_id AND c.status IS DISTINCT FROM 'VOIDED' AND c.current_facility_id IS DISTINCT FROM loc.facility_id;
COMMIT;
