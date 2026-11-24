\set ON_ERROR_STOP on
-- A carton follows its boxes: it moves when every box that has a facility is at the new one, and never when voided.
BEGIN;
SELECT c.id AS carton, c.current_facility_id AS home
  FROM public.sscc_cartons c JOIN public.medicine_boxes b ON b.carton_id = c.id
  WHERE c.status = 'PACKAGED' AND c.box_count >= 2 AND b.current_facility_id = c.current_facility_id LIMIT 1 \gset
SELECT id AS other FROM public.facilities WHERE id <> :home ORDER BY id LIMIT 1 \gset
SELECT set_config('test.carton', :'carton', true), set_config('test.home', :'home', true), set_config('test.other', :'other', true);
DO $$
DECLARE carton integer := current_setting('test.carton')::integer; home integer := current_setting('test.home')::integer;
  other integer := current_setting('test.other')::integer; first_box uuid;
BEGIN
  SELECT uid INTO first_box FROM public.medicine_boxes WHERE carton_id = carton ORDER BY uid LIMIT 1;
  -- Boxes in transit hold no facility and do not move the carton.
  UPDATE public.medicine_boxes SET status = 'IN_TRANSIT', current_facility_id = NULL WHERE carton_id = carton;
  IF (SELECT current_facility_id FROM public.sscc_cartons WHERE id = carton) <> home THEN RAISE EXCEPTION 'Carton moved while its boxes were in transit'; END IF;
  -- Every box arrives at the other facility: the carton is there too.
  UPDATE public.medicine_boxes SET current_facility_id = other, status = 'IN_STOCK' WHERE carton_id = carton;
  IF (SELECT current_facility_id FROM public.sscc_cartons WHERE id = carton) IS DISTINCT FROM other THEN
    RAISE EXCEPTION 'Carton did not follow its boxes to the receiving facility';
  END IF;
  -- One box goes back while the rest stay: the carton is split and stays where most of it is.
  UPDATE public.medicine_boxes SET current_facility_id = home WHERE uid = first_box;
  IF (SELECT current_facility_id FROM public.sscc_cartons WHERE id = carton) IS DISTINCT FROM other THEN
    RAISE EXCEPTION 'A split carton was moved by one box';
  END IF;
  -- A voided carton stays out of circulation.
  UPDATE public.sscc_cartons SET status = 'VOIDED', current_facility_id = NULL WHERE id = carton;
  UPDATE public.medicine_boxes SET current_facility_id = home WHERE carton_id = carton;
  IF (SELECT current_facility_id FROM public.sscc_cartons WHERE id = carton) IS NOT NULL THEN RAISE EXCEPTION 'A voided carton was moved'; END IF;
  RAISE NOTICE 'PASS carton location follows its boxes';
END $$;
ROLLBACK;
