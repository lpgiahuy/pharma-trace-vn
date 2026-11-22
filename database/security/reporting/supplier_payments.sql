\set ON_ERROR_STOP on
BEGIN;
-- Supplier payments against accounts_payable. A new payable gets a due date from the default payment term, and
-- record_supplier_payment() pays it down and writes the cashbook expense in one transaction.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install supplier payments as a trusted superuser';
  END IF;
  IF to_regclass('public.system_settings') IS NULL OR to_regclass('public.goods_receipts') IS NULL
    OR to_regprocedure('public.report_finance_access(date, date, boolean)') IS NULL THEN
    RAISE EXCEPTION 'Install batch_sellability.sql, goods_receipts.sql and finance_reports.sql first';
  END IF;
END $$;

ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS default_supplier_payment_term_days integer NOT NULL DEFAULT 30
  CHECK (default_supplier_payment_term_days >= 0);

CREATE OR REPLACE FUNCTION public.set_payable_due_date() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.due_date IS NULL THEN
    NEW.due_date := coalesce((SELECT r.received_at FROM public.goods_receipts r WHERE r.id = NEW.goods_receipt_id), NEW.created_at)
      + make_interval(days => (SELECT s.default_supplier_payment_term_days FROM public.system_settings s));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.set_payable_due_date() FROM PUBLIC, app_user;
DROP TRIGGER IF EXISTS set_payable_due_date ON public.accounts_payable;
CREATE TRIGGER set_payable_due_date BEFORE INSERT ON public.accounts_payable
FOR EACH ROW EXECUTE FUNCTION public.set_payable_due_date();

UPDATE public.accounts_payable ap
SET due_date = coalesce((SELECT r.received_at FROM public.goods_receipts r WHERE r.id = ap.goods_receipt_id), ap.created_at)
  + make_interval(days => (SELECT s.default_supplier_payment_term_days FROM public.system_settings s))
WHERE ap.due_date IS NULL;

CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id serial PRIMARY KEY,
  ap_id integer NOT NULL REFERENCES public.accounts_payable(id),
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL CHECK (payment_method IN ('CASH','BANK_TRANSFER','DEBIT_CARD','E_WALLET')),
  reference text NOT NULL CHECK (length(btrim(reference)) BETWEEN 1 AND 100),
  cashbook_id integer NOT NULL UNIQUE REFERENCES public.cashbook_logs(id),
  paid_by integer NOT NULL REFERENCES public.employees(id),
  paid_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_method, reference)
);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_ap ON public.supplier_payments(ap_id);
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_payments FROM PUBLIC, app_user;

CREATE OR REPLACE FUNCTION public.record_supplier_payment(target_ap integer, paid numeric, method text, payment_ref text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor integer := nullif(current_setting('app.current_user_id', true), '')::integer;
  payable public.accounts_payable%ROWTYPE;
  ref text := btrim(coalesce(payment_ref, ''));
  payment integer; cash integer;
BEGIN
  IF actor IS NULL OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
    OR coalesce(current_setting('app.current_user_role', true), '') NOT IN ('SUPER_ADMIN', 'FINANCE_MANAGER') THEN
    RAISE EXCEPTION 'Supplier payment is not authorized' USING ERRCODE = '42501';
  END IF;
  IF paid IS NULL OR paid::text IN ('NaN', 'Infinity', '-Infinity') OR paid <= 0 OR paid <> round(paid, 2)
    OR coalesce(method, '') NOT IN ('CASH', 'BANK_TRANSFER', 'DEBIT_CARD', 'E_WALLET') OR length(ref) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Valid amount, method and reference are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO payable FROM public.accounts_payable WHERE id = target_ap FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payable not found' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT FROM public.supplier_payments p WHERE p.payment_method = method AND p.reference = ref) THEN
    RAISE EXCEPTION 'Payment reference is already recorded' USING ERRCODE = '22023';
  END IF;
  IF paid > payable.remaining_balance THEN
    RAISE EXCEPTION 'Payment exceeds the remaining balance' USING ERRCODE = '22023';
  END IF;

  payment := nextval('public.supplier_payments_id_seq');
  INSERT INTO public.cashbook_logs(transaction_code, transaction_type, category, amount, party_type, party_name, po_id, payment_method, note, created_by_user_id)
    VALUES ('SUP-' || payment, 'EXPENSE', 'SUPPLIER_PAYMENT', paid, 'SUPPLIER', payable.supplier_name, payable.po_id, method,
      'Payment reference: ' || ref, actor)
    RETURNING id INTO cash;
  INSERT INTO public.supplier_payments(id, ap_id, amount, payment_method, reference, cashbook_id, paid_by)
    VALUES (payment, target_ap, paid, method, ref, cash, actor);
  UPDATE public.accounts_payable
    SET paid_amount = paid_amount + paid,
      status = CASE WHEN paid_amount + paid >= total_due_amount THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
      updated_at = now()
    WHERE id = target_ap;
  RETURN payment;
END $$;

CREATE OR REPLACE FUNCTION public.report_payable_payments(target_ap integer)
RETURNS TABLE (id integer, amount numeric, payment_method text, reference text, paid_at timestamptz, paid_by_name text, cashbook_code text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.report_finance_access();
  RETURN QUERY
  SELECT p.id, p.amount, p.payment_method, p.reference, p.paid_at, e.full_name::text, c.transaction_code::text
  FROM public.supplier_payments p
  JOIN public.employees e ON e.id = p.paid_by
  JOIN public.cashbook_logs c ON c.id = p.cashbook_id
  WHERE p.ap_id = target_ap
  ORDER BY p.paid_at DESC, p.id DESC;
END $$;

REVOKE ALL ON FUNCTION public.record_supplier_payment(integer, numeric, text, text), public.report_payable_payments(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_supplier_payment(integer, numeric, text, text), public.report_payable_payments(integer) TO app_user;
COMMIT;
