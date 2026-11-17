\set ON_ERROR_STOP on
BEGIN;
-- Batch holds, recalls, expiry and minimum remaining shelf life decide whether a box may be
-- reserved, packed or dispatched. box_sellable() is the single rule every one of those paths uses.

-- Legacy seed labels map onto the supported batch statuses before the constraint is enforced.
UPDATE public.batches SET status = 'ACTIVE' WHERE status = 'HopLe';
UPDATE public.batches SET status = 'RECALLED' WHERE status = 'ThuHoi';
ALTER TABLE public.batches DROP CONSTRAINT IF EXISTS chk_batch_status;
ALTER TABLE public.batches ADD CONSTRAINT chk_batch_status CHECK (status IN ('ACTIVE','ON_HOLD','RECALLED','EXPIRED'));
ALTER TABLE public.batches ADD COLUMN IF NOT EXISTS hold_reason text;
ALTER TABLE public.batches ADD COLUMN IF NOT EXISTS held_by_id integer REFERENCES public.employees(id);
ALTER TABLE public.batches ADD COLUMN IF NOT EXISTS held_at timestamptz;

-- NULL means the medicine uses the system default.
ALTER TABLE public.medicines ADD COLUMN IF NOT EXISTS min_remaining_shelf_life_days integer
  CHECK (min_remaining_shelf_life_days >= 0);

-- Single-row system settings.
CREATE TABLE IF NOT EXISTS public.system_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  default_min_shelf_life_days integer NOT NULL DEFAULT 0 CHECK (default_min_shelf_life_days >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.system_settings(id) VALUES (true) ON CONFLICT DO NOTHING;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.system_settings FROM PUBLIC, app_user;

CREATE OR REPLACE FUNCTION public.box_sellable(box_uid uuid, as_of date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT FROM public.medicine_boxes b
    JOIN public.batches batch ON batch.id = b.batch_id
    JOIN public.medicines m ON m.id = batch.medicine_id
    WHERE b.uid = box_uid
      AND b.status IS DISTINCT FROM 'QUARANTINED'
      AND batch.status = 'ACTIVE'
      AND batch.expiry_date > as_of
      AND batch.expiry_date - as_of >= coalesce(m.min_remaining_shelf_life_days,
        (SELECT s.default_min_shelf_life_days FROM public.system_settings s), 0))
$$;
REVOKE ALL ON FUNCTION public.box_sellable(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.box_sellable(uuid, date) TO app_user;

-- Unreserved boxes that may not be sold, per facility and medicine. Checkout subtracts them from
-- aggregate stock; only counts are exposed, never box identities.
CREATE OR REPLACE FUNCTION public.unsellable_box_counts(medicine_ids integer[]) RETURNS TABLE(facility_id integer, medicine_id integer, boxes integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT b.current_facility_id, batch.medicine_id, count(*)::integer
  FROM public.medicine_boxes b JOIN public.batches batch ON batch.id = b.batch_id
  WHERE batch.medicine_id = ANY(medicine_ids) AND b.current_facility_id IS NOT NULL
    AND b.status IN ('IN_STOCK','MANUFACTURED') AND NOT public.box_sellable(b.uid, current_date)
  GROUP BY 1, 2
$$;
REVOKE ALL ON FUNCTION public.unsellable_box_counts(integer[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unsellable_box_counts(integer[]) TO app_user;
COMMIT;
