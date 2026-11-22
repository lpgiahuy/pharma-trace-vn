\set ON_ERROR_STOP on
BEGIN;
-- Only finance roles read the cashbook. Every cashbook writer is a SECURITY DEFINER function owned by a superuser,
-- so it bypasses RLS; the table is deliberately not FORCEd.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install report access as a trusted superuser';
  END IF;
  IF to_regprocedure('public.app_role_in_group(text)') IS NULL OR to_regclass('public.cashbook_logs') IS NULL THEN
    RAISE EXCEPTION 'Install app_role_groups.sql and the finance schema first';
  END IF;
END $$;

ALTER TABLE public.cashbook_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cashbook_finance_read ON public.cashbook_logs;
CREATE POLICY cashbook_finance_read ON public.cashbook_logs FOR SELECT TO app_user
  USING (public.app_role_in_group('FINANCE_READ'));
COMMIT;
