\set ON_ERROR_STOP on
BEGIN;
-- Read-only sales reports for the admin dashboard (REPORT_READ). STORE_MANAGER is always limited to its own facility.
-- orders.created_at and customers.created_at are UTC wall-clock TIMESTAMP values; days are grouped in Asia/Ho_Chi_Minh.
-- Revenue = DELIVERED, COMPLETED and PARTIALLY_RETURNED orders minus their CUSTOMER_REFUND cashbook expenses,
-- by order creation date.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install sales reports as a trusted superuser';
  END IF;
  IF to_regprocedure('public.app_role_in_group(text)') IS NULL OR to_regclass('public.cashbook_logs') IS NULL THEN
    RAISE EXCEPTION 'Install app_role_groups.sql and the finance schema first';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_facility_created_at ON public.orders(export_facility_id, created_at);
CREATE INDEX IF NOT EXISTS idx_customers_created_at ON public.customers(created_at);
CREATE INDEX IF NOT EXISTS idx_cashbook_transaction_date ON public.cashbook_logs(transaction_date);

CREATE OR REPLACE FUNCTION public.report_utc(day date) RETURNS timestamp
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT (day::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'UTC'
$$;

CREATE OR REPLACE FUNCTION public.report_scope(p_facility_id integer, p_from date, p_to date) RETURNS integer
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE unit integer := NULLIF(current_setting('app.current_unit_id', true), '')::integer;
BEGIN
  IF NOT public.app_role_in_group('REPORT_READ') OR NULLIF(current_setting('app.current_user_id', true), '') IS NULL THEN
    RAISE EXCEPTION 'Report access denied' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'The report range is invalid' USING ERRCODE = '22023';
  END IF;
  IF current_setting('app.current_user_role', true) <> 'STORE_MANAGER' THEN RETURN p_facility_id; END IF;
  IF unit IS NULL THEN RAISE EXCEPTION 'Store manager is not assigned to a facility' USING ERRCODE = '42501'; END IF;
  RETURN unit;
END $$;

CREATE OR REPLACE FUNCTION public.report_scoped_orders(p_from date, p_to date, scope integer)
RETURNS TABLE (order_status varchar, total_amount numeric, refunds numeric, is_revenue boolean, local_date date)
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT o.order_status, o.total_amount,
    CASE WHEN o.order_status IN ('DELIVERED', 'COMPLETED', 'PARTIALLY_RETURNED') THEN coalesce((SELECT sum(c.amount) FROM public.cashbook_logs c
      WHERE c.order_id = o.id AND c.transaction_type = 'EXPENSE' AND c.category = 'CUSTOMER_REFUND'), 0) ELSE 0 END,
    o.order_status IN ('DELIVERED', 'COMPLETED', 'PARTIALLY_RETURNED'),
    ((o.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
  FROM public.orders o
  WHERE o.created_at >= public.report_utc(p_from) AND o.created_at < public.report_utc(p_to + 1)
    AND (scope IS NULL OR o.export_facility_id = scope)
$$;

-- With a facility scope, a new customer counts only when it also ordered at that facility in the range.
CREATE OR REPLACE FUNCTION public.report_new_customers(p_from date, p_to date, scope integer)
RETURNS TABLE (local_date date)
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT ((c.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
  FROM public.customers c
  WHERE c.created_at >= public.report_utc(p_from) AND c.created_at < public.report_utc(p_to + 1)
    AND (scope IS NULL OR EXISTS (SELECT FROM public.orders o WHERE o.customer_id = c.id AND o.export_facility_id = scope
      AND o.created_at >= public.report_utc(p_from) AND o.created_at < public.report_utc(p_to + 1)))
$$;

CREATE OR REPLACE FUNCTION public.report_sales_overview(p_from date, p_to date, p_facility_id integer DEFAULT NULL)
RETURNS TABLE (period text, period_from date, period_to date, revenue numeric, collected_cash numeric, orders bigint,
  cancelled_orders bigint, new_customers bigint, first_time_buyers bigint, avg_order_value numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
#variable_conflict use_column
DECLARE scope integer := public.report_scope(p_facility_id, p_from, p_to); days integer := p_to - p_from + 1;
BEGIN
  RETURN QUERY
  SELECT p.period, p.f, p.t, s.revenue, cash.amount, s.orders, s.cancelled,
    (SELECT count(*) FROM public.report_new_customers(p.f, p.t, scope)),
    (SELECT count(*) FROM (SELECT DISTINCT ON (o.customer_id) o.export_facility_id, o.created_at FROM public.orders o
        WHERE o.customer_id IS NOT NULL ORDER BY o.customer_id, o.created_at, o.id) first_order
      WHERE first_order.created_at >= public.report_utc(p.f) AND first_order.created_at < public.report_utc(p.t + 1)
        AND (scope IS NULL OR first_order.export_facility_id = scope)),
    CASE WHEN s.revenue_orders > 0 THEN round(s.revenue / s.revenue_orders, 2) ELSE 0 END
  FROM (VALUES ('current'::text, p_from, p_to), ('previous', p_from - days, p_from - 1)) p(period, f, t)
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(o.total_amount - o.refunds) FILTER (WHERE o.is_revenue), 0) AS revenue, count(*) AS orders,
      count(*) FILTER (WHERE o.order_status IN ('CANCELLED', 'CANCELED')) AS cancelled,
      count(*) FILTER (WHERE o.is_revenue) AS revenue_orders
    FROM public.report_scoped_orders(p.f, p.t, scope) o) s
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(c.amount), 0) AS amount FROM public.cashbook_logs c
    WHERE c.transaction_type = 'INCOME'
      AND c.transaction_date >= p.f::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'
      AND c.transaction_date < (p.t + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'
      AND (scope IS NULL OR EXISTS (SELECT FROM public.orders o WHERE o.id = c.order_id AND o.export_facility_id = scope))) cash;
END $$;

CREATE OR REPLACE FUNCTION public.report_revenue_series(p_from date, p_to date, p_granularity text DEFAULT 'day', p_facility_id integer DEFAULT NULL)
RETURNS TABLE (bucket date, revenue numeric, refunds numeric, orders bigint, new_customers bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
#variable_conflict use_column
DECLARE scope integer := public.report_scope(p_facility_id, p_from, p_to);
BEGIN
  IF p_granularity IS NULL OR p_granularity NOT IN ('day', 'month') THEN
    RAISE EXCEPTION 'Granularity must be day or month' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH o AS (SELECT date_trunc(p_granularity, s.local_date)::date AS bucket, s.* FROM public.report_scoped_orders(p_from, p_to, scope) s),
    c AS (SELECT date_trunc(p_granularity, n.local_date)::date AS bucket FROM public.report_new_customers(p_from, p_to, scope) n)
  SELECT b.day::date,
    (SELECT coalesce(sum(o.total_amount - o.refunds) FILTER (WHERE o.is_revenue), 0) FROM o WHERE o.bucket = b.day::date),
    (SELECT coalesce(sum(o.refunds), 0) FROM o WHERE o.bucket = b.day::date),
    (SELECT count(*) FROM o WHERE o.bucket = b.day::date),
    (SELECT count(*) FROM c WHERE c.bucket = b.day::date)
  FROM generate_series(date_trunc(p_granularity, p_from::timestamp), p_to::timestamp, ('1 ' || p_granularity)::interval) b(day)
  ORDER BY 1;
END $$;

CREATE OR REPLACE FUNCTION public.report_order_status(p_from date, p_to date, p_facility_id integer DEFAULT NULL)
RETURNS TABLE (status varchar, count bigint, amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
#variable_conflict use_column
DECLARE scope integer := public.report_scope(p_facility_id, p_from, p_to);
BEGIN
  RETURN QUERY
  SELECT o.order_status, count(*), coalesce(sum(o.total_amount), 0)
  FROM public.report_scoped_orders(p_from, p_to, scope) o GROUP BY o.order_status ORDER BY 2 DESC, 1;
END $$;

REVOKE ALL ON FUNCTION public.report_utc(date), public.report_scope(integer, date, date),
  public.report_scoped_orders(date, date, integer), public.report_new_customers(date, date, integer),
  public.report_sales_overview(date, date, integer), public.report_revenue_series(date, date, text, integer),
  public.report_order_status(date, date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_sales_overview(date, date, integer), public.report_revenue_series(date, date, text, integer),
  public.report_order_status(date, date, integer) TO app_user;
COMMIT;
