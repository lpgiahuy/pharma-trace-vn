\set ON_ERROR_STOP on
BEGIN;
-- Read-only finance reports for the FINANCE_READ group. Days are grouped in Asia/Ho_Chi_Minh.
-- Receivables: OPEN courier COD receivables plus delivered online orders that are not PAID.
-- Payables: accounts_payable rows with a remaining balance; rows without a due date get their own bucket.
-- Cashbook: balances follow the payment method filter; the type filter only narrows the entry list and its count.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install finance reports as a trusted superuser';
  END IF;
  IF to_regprocedure('public.app_role_in_group(text)') IS NULL OR to_regclass('public.courier_receivables') IS NULL THEN
    RAISE EXCEPTION 'Install app_role_groups.sql and the COD accounting first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.report_finance_access(p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_range boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
BEGIN
  IF NOT public.app_role_in_group('FINANCE_READ') OR NULLIF(current_setting('app.current_user_id', true), '') IS NULL THEN
    RAISE EXCEPTION 'Report access denied' USING ERRCODE = '42501';
  END IF;
  IF p_range AND (p_from IS NULL OR p_to IS NULL OR p_from > p_to) THEN
    RAISE EXCEPTION 'The report range is invalid' USING ERRCODE = '22023';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.report_receivables_aging(p_as_of date)
RETURNS TABLE (row_type text, party_name text, bucket text, row_count bigint, amount numeric, shipment_id integer,
  order_id integer, order_code text, doc_date date, age_days integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.report_finance_access();
  RETURN QUERY
  WITH open_items AS (
    SELECT cr.courier_name::text AS party_name, cr.amount_due - cr.collected_amount AS amount, cr.shipment_id, s.order_id, o.order_code::text AS order_code,
      (cr.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS doc_date
    FROM public.courier_receivables cr
    JOIN public.shipments s ON s.id = cr.shipment_id
    JOIN public.orders o ON o.id = s.order_id
    WHERE cr.status = 'OPEN'
    UNION ALL
    SELECT 'Online orders', o.total_amount, NULL, o.id, o.order_code::text,
      ((coalesce(s.actual_delivery_at, o.created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    FROM public.orders o
    LEFT JOIN public.shipments s ON s.order_id = o.id
    WHERE o.payment_method IN ('BANK_TRANSFER', 'E_WALLET') AND o.order_status = 'DELIVERED' AND o.payment_status IS DISTINCT FROM 'PAID'
  ), aged AS (
    SELECT i.*, greatest(p_as_of - i.doc_date, 0) AS age_days,
      CASE WHEN p_as_of - i.doc_date <= 7 THEN '0_7' WHEN p_as_of - i.doc_date <= 15 THEN '8_15'
        WHEN p_as_of - i.doc_date <= 30 THEN '16_30' ELSE 'GT_30' END AS bucket
    FROM open_items i
  )
  SELECT 'SUMMARY'::text, a.party_name, a.bucket, count(*), sum(a.amount), NULL::integer, NULL::integer, NULL::text, NULL::date, NULL::integer
  FROM aged a GROUP BY a.party_name, a.bucket
  UNION ALL
  SELECT 'DETAIL', a.party_name, a.bucket, 1, a.amount, a.shipment_id, a.order_id, a.order_code, a.doc_date, a.age_days FROM aged a
  ORDER BY 1 DESC, 2, 3, 9, 8;
END $$;

CREATE OR REPLACE FUNCTION public.report_payables_aging(p_as_of date)
RETURNS TABLE (row_type text, supplier_id integer, supplier_name text, bucket text, row_count bigint, amount numeric, ap_id integer,
  po_id integer, po_code text, due_date date, days_overdue integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.report_finance_access();
  RETURN QUERY
  WITH aged AS (
    SELECT ap.supplier_id, ap.supplier_name::text AS supplier_name, ap.remaining_balance AS amount, ap.id AS ap_id, ap.po_id, po.po_code::text AS po_code,
      d.due_date, p_as_of - d.due_date AS days_overdue,
      CASE WHEN d.due_date IS NULL THEN 'NO_DUE_DATE' WHEN p_as_of - d.due_date <= 0 THEN 'NOT_DUE' WHEN p_as_of - d.due_date <= 30 THEN '1_30'
        WHEN p_as_of - d.due_date <= 60 THEN '31_60' ELSE 'GT_60' END AS bucket
    FROM public.accounts_payable ap
    LEFT JOIN public.purchase_orders po ON po.id = ap.po_id
    CROSS JOIN LATERAL (SELECT (ap.due_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS due_date) d
    WHERE ap.remaining_balance > 0
  )
  SELECT 'SUMMARY'::text, a.supplier_id, a.supplier_name, a.bucket, count(*), sum(a.amount), NULL::integer, NULL::integer, NULL::text, NULL::date, NULL::integer
  FROM aged a GROUP BY a.supplier_id, a.supplier_name, a.bucket
  UNION ALL
  SELECT 'DETAIL', a.supplier_id, a.supplier_name, a.bucket, 1, a.amount, a.ap_id, a.po_id, a.po_code, a.due_date, a.days_overdue FROM aged a
  ORDER BY 1 DESC, 3, 2, 4, 10, 7;
END $$;

-- One SUMMARY row for the range, then one DAY row per Vietnam day. Every row satisfies opening + income - expense = closing.
CREATE OR REPLACE FUNCTION public.report_cashbook(p_from date, p_to date, p_payment_method text DEFAULT NULL, p_type text DEFAULT NULL)
RETURNS TABLE (row_type text, day date, opening numeric, income numeric, expense numeric, closing numeric, entry_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.report_finance_access(p_from, p_to, true);
  RETURN QUERY
  WITH c AS (
    SELECT (l.transaction_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day, l.transaction_type, l.amount
    FROM public.cashbook_logs l
    WHERE l.transaction_date < (p_to + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'
      AND (p_payment_method IS NULL OR l.payment_method = p_payment_method)
  ), start_balance AS (
    SELECT coalesce(sum(CASE WHEN transaction_type = 'INCOME' THEN amount ELSE -amount END), 0) AS balance FROM c WHERE day < p_from
  ), per_day AS (
    SELECT g.day::date AS day, coalesce(sum(c.amount) FILTER (WHERE c.transaction_type = 'INCOME'), 0) AS income,
      coalesce(sum(c.amount) FILTER (WHERE c.transaction_type = 'EXPENSE'), 0) AS expense
    FROM generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g(day)
    LEFT JOIN c ON c.day = g.day::date
    GROUP BY g.day
  ), running AS (
    SELECT d.day, d.income, d.expense, b.balance + sum(d.income - d.expense) OVER (ORDER BY d.day) AS closing
    FROM per_day d CROSS JOIN start_balance b
  )
  SELECT 'SUMMARY'::text, NULL::date, b.balance, sum(r.income), sum(r.expense), b.balance + sum(r.income) - sum(r.expense),
    (SELECT count(*) FROM public.cashbook_logs l
      WHERE l.transaction_date >= p_from::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh' AND l.transaction_date < (p_to + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'
        AND (p_payment_method IS NULL OR l.payment_method = p_payment_method) AND (p_type IS NULL OR l.transaction_type = p_type))
  FROM running r CROSS JOIN start_balance b GROUP BY b.balance
  UNION ALL
  SELECT 'DAY', r.day, r.closing - r.income + r.expense, r.income, r.expense, r.closing, NULL::bigint FROM running r
  ORDER BY 1 DESC, 2;
END $$;

-- A NULL limit returns every entry (CSV export).
CREATE OR REPLACE FUNCTION public.report_cashbook_entries(p_from date, p_to date, p_payment_method text DEFAULT NULL, p_type text DEFAULT NULL,
  p_limit integer DEFAULT NULL, p_offset integer DEFAULT 0)
RETURNS TABLE (id integer, transaction_code text, transaction_date timestamptz, transaction_type text, category text, amount numeric,
  payment_method text, party_name text, note text, order_id integer, order_code text, po_id integer, po_code text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.report_finance_access(p_from, p_to, true);
  RETURN QUERY
  SELECT l.id, l.transaction_code::text, l.transaction_date, l.transaction_type::text, l.category::text, l.amount, l.payment_method::text,
    l.party_name::text, l.note, l.order_id, o.order_code::text, l.po_id, po.po_code::text
  FROM public.cashbook_logs l
  LEFT JOIN public.orders o ON o.id = l.order_id
  LEFT JOIN public.purchase_orders po ON po.id = l.po_id
  WHERE l.transaction_date >= p_from::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh' AND l.transaction_date < (p_to + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'
    AND (p_payment_method IS NULL OR l.payment_method = p_payment_method) AND (p_type IS NULL OR l.transaction_type = p_type)
  ORDER BY l.transaction_date DESC, l.id DESC
  LIMIT p_limit OFFSET p_offset;
END $$;

REVOKE ALL ON FUNCTION public.report_finance_access(date, date, boolean), public.report_receivables_aging(date), public.report_payables_aging(date),
  public.report_cashbook(date, date, text, text), public.report_cashbook_entries(date, date, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_receivables_aging(date), public.report_payables_aging(date),
  public.report_cashbook(date, date, text, text), public.report_cashbook_entries(date, date, text, text, integer, integer) TO app_user;
COMMIT;
