-- Flash sale quota: how many units of a packaging variant may be sold at its sale price.
-- NULL means unlimited. Units already sold at the sale price are counted from order_items, so
-- cancelling or returning an order frees its quota again.
ALTER TABLE public.packaging_variants
    ADD COLUMN IF NOT EXISTS sale_quantity INTEGER CHECK (sale_quantity IS NULL OR sale_quantity > 0);

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT INSERT (sale_quantity), UPDATE (sale_quantity) ON public.packaging_variants TO app_user;
  END IF;
END $$;

-- Customers cannot read each other's orders, so the public catalog reads the sold count through
-- this definer function, which only exposes an aggregate per variant.
CREATE OR REPLACE FUNCTION public.variant_sale_sold(variant_ids integer[])
RETURNS TABLE (variant_id integer, sold integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT pv.id, coalesce((
        SELECT sum(oi.quantity)
        FROM public.order_items oi
        JOIN public.orders o ON o.id = oi.order_id
        WHERE oi.variant_id = pv.id
          AND oi.unit_price = pv.price
          AND o.created_at >= pv.sale_start_date AND o.created_at <= pv.sale_end_date
          AND o.order_status NOT IN ('CANCELLED', 'RETURNED')
    ), 0)::integer
    FROM public.packaging_variants pv
    WHERE pv.id = ANY(variant_ids) AND pv.sale_quantity IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.variant_sale_sold(integer[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.variant_sale_sold(integer[]) TO app_user;
