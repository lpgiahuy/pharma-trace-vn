\set ON_ERROR_STOP on
-- Supplier payments: due date default, role denial, validation, overpayment, duplicate reference, status transitions,
-- the cashbook expense and the payment history. Run as owner on a disposable initialized database; every fixture is rolled back.
BEGIN;
INSERT INTO public.employees(full_name, role) VALUES ('SP finance manager', 'FINANCE_MANAGER') RETURNING id AS manager \gset e_
INSERT INTO public.employees(full_name, role) VALUES ('SP super admin', 'SUPER_ADMIN') RETURNING id AS admin \gset e_
INSERT INTO public.employees(full_name, role) VALUES ('SP accountant', 'ACCOUNTANT') RETURNING id AS accountant \gset e_
INSERT INTO public.employees(full_name, role) VALUES ('SP staff', 'WAREHOUSE_STAFF') RETURNING id AS staff \gset e_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('SP supplier', 'PHARMACY') RETURNING id AS supplier \gset f_
INSERT INTO public.purchase_orders(po_code, supplier_id, status) VALUES ('SP-PO-1', :f_supplier, 'RECEIVED') RETURNING id AS po \gset p_
INSERT INTO public.accounts_payable(supplier_name, supplier_id, po_id, total_due_amount, created_at)
  VALUES ('SP-Supplier', :f_supplier, :p_po, 1000000, '2030-03-01 00:00+00') RETURNING id AS main \gset ap_
INSERT INTO public.accounts_payable(supplier_name, total_due_amount, due_date)
  VALUES ('SP-Supplier', 500000, '2030-06-15 00:00+00') RETURNING id AS dated \gset ap_
INSERT INTO public.accounts_payable(supplier_name, total_due_amount) VALUES ('SP-Supplier', 700000) RETURNING id AS other \gset ap_
SELECT set_config('test.manager', :'e_manager', true), set_config('test.admin', :'e_admin', true),
  set_config('test.accountant', :'e_accountant', true), set_config('test.staff', :'e_staff', true),
  set_config('test.main', :'ap_main', true), set_config('test.other', :'ap_other', true);

CREATE FUNCTION pg_temp.sp_expect(expected text, statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected % but the statement succeeded: %', expected, statement;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> expected THEN RAISE; END IF;
END $$;
CREATE FUNCTION pg_temp.sp_as(role text, employee text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.current_user_type', 'employee', true), set_config('app.current_user_role', role, true),
    set_config('app.current_user_id', current_setting('test.' || employee), true), set_config('app.current_unit_id', '', true);
END $$;
CREATE FUNCTION pg_temp.sp_check(label text, actual text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION '%: expected %, got %', label, expected, actual; END IF;
END $$;

SET LOCAL ROLE app_user;
DO $$
DECLARE main integer := current_setting('test.main')::integer; other integer := current_setting('test.other')::integer;
BEGIN
  PERFORM pg_temp.sp_as('FINANCE_MANAGER', 'manager');
  PERFORM pg_temp.sp_check('A payable without a due date gets the 30-day term',
    (SELECT (due_date - created_at)::text FROM public.accounts_payable WHERE id = main), '30 days');
  PERFORM pg_temp.sp_check('A payable with a due date keeps it',
    (SELECT (due_date = timestamptz '2030-06-15 00:00+00')::text FROM public.accounts_payable WHERE total_due_amount = 500000 AND supplier_name = 'SP-Supplier'), 'true');

  PERFORM pg_temp.sp_as('ACCOUNTANT', 'accountant');
  PERFORM pg_temp.sp_expect('42501', format('SELECT public.record_supplier_payment(%s, 1000, ''CASH'', ''SP-DENIED'')', main));
  PERFORM pg_temp.sp_check('An accountant reads the empty history', (SELECT count(*) FROM public.report_payable_payments(main))::text, '0');
  PERFORM pg_temp.sp_as('WAREHOUSE_STAFF', 'staff');
  PERFORM pg_temp.sp_expect('42501', format('SELECT public.record_supplier_payment(%s, 1000, ''CASH'', ''SP-DENIED'')', main));
  PERFORM pg_temp.sp_expect('42501', format('SELECT * FROM public.report_payable_payments(%s)', main));
  PERFORM pg_temp.sp_expect('42501', 'SELECT * FROM public.supplier_payments');

  PERFORM pg_temp.sp_as('FINANCE_MANAGER', 'manager');
  PERFORM pg_temp.sp_expect('22023', format('SELECT public.record_supplier_payment(%s, 0, ''CASH'', ''SP-ZERO'')', main));
  PERFORM pg_temp.sp_expect('22023', format('SELECT public.record_supplier_payment(%s, -5, ''CASH'', ''SP-NEG'')', main));
  PERFORM pg_temp.sp_expect('22023', format('SELECT public.record_supplier_payment(%s, 10.005, ''CASH'', ''SP-FRAC'')', main));
  PERFORM pg_temp.sp_expect('22023', format('SELECT public.record_supplier_payment(%s, 1000, ''BARTER'', ''SP-METHOD'')', main));
  PERFORM pg_temp.sp_expect('22023', format('SELECT public.record_supplier_payment(%s, 1000, ''CASH'', ''   '')', main));
  PERFORM pg_temp.sp_expect('P0002', 'SELECT public.record_supplier_payment(0, 1000, ''CASH'', ''SP-MISSING'')');

  PERFORM public.record_supplier_payment(main, 400000, 'BANK_TRANSFER', 'SP-REF-1');
  PERFORM pg_temp.sp_check('Partial payment',
    (SELECT row(paid_amount, remaining_balance, status)::text FROM public.accounts_payable WHERE id = main), '(400000.00,600000.00,PARTIALLY_PAID)');
  PERFORM pg_temp.sp_check('The cashbook expense',
    (SELECT row(transaction_type, category, amount, party_type, party_name, payment_method, created_by_user_id = current_setting('test.manager')::integer,
      po_id = (SELECT po_id FROM public.accounts_payable WHERE id = main))::text
     FROM public.cashbook_logs WHERE note = 'Payment reference: SP-REF-1'),
    '(EXPENSE,SUPPLIER_PAYMENT,400000.00,SUPPLIER,SP-Supplier,BANK_TRANSFER,t,t)');

  PERFORM pg_temp.sp_expect('22023', format('SELECT public.record_supplier_payment(%s, 600000.01, ''CASH'', ''SP-OVER'')', main));
  PERFORM pg_temp.sp_expect('22023', format('SELECT public.record_supplier_payment(%s, 1000, ''BANK_TRANSFER'', '' SP-REF-1 '')', main));
  PERFORM pg_temp.sp_expect('22023', format('SELECT public.record_supplier_payment(%s, 1000, ''BANK_TRANSFER'', ''SP-REF-1'')', other));
  PERFORM pg_temp.sp_check('Rejected payments change nothing',
    (SELECT row(paid_amount, status)::text FROM public.accounts_payable WHERE id = main), '(400000.00,PARTIALLY_PAID)');
  PERFORM pg_temp.sp_check('Rejected payments write no cashbook entry',
    (SELECT count(*) FROM public.cashbook_logs WHERE category = 'SUPPLIER_PAYMENT')::text, '1');

  PERFORM public.record_supplier_payment(main, 600000, 'CASH', 'SP-REF-1');
  PERFORM pg_temp.sp_check('The same reference is free under another method; the payable is paid',
    (SELECT row(paid_amount, remaining_balance, status)::text FROM public.accounts_payable WHERE id = main), '(1000000.00,0.00,PAID)');
  PERFORM pg_temp.sp_expect('22023', format('SELECT public.record_supplier_payment(%s, 1, ''CASH'', ''SP-REF-2'')', main));

  PERFORM pg_temp.sp_check('History lists both payments, newest first',
    (SELECT string_agg(reference || ':' || amount || ':' || paid_by_name || ':' || (cashbook_code LIKE 'SUP-%'), ' ' ORDER BY paid_at DESC, id DESC)
     FROM public.report_payable_payments(main)),
    'SP-REF-1:600000.00:SP finance manager:true SP-REF-1:400000.00:SP finance manager:true');

  PERFORM pg_temp.sp_as('SUPER_ADMIN', 'admin');
  PERFORM public.record_supplier_payment(other, 700000, 'E_WALLET', 'SP-ADMIN-1');
  PERFORM pg_temp.sp_check('A super admin settles a payable',
    (SELECT status FROM public.accounts_payable WHERE id = other), 'PAID');
END $$;
RESET ROLE;
ROLLBACK;
\echo 'supplier_payments_test passed'
