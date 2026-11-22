\set ON_ERROR_STOP on
-- Sales and stock reports: role denial, store manager facility scope, revenue with refunds and cancellations, Vietnam day
-- boundaries, empty buckets and the previous period. Run as owner on a disposable initialized database; every fixture
-- is rolled back. Fixture dates are in 2030 so the development seed does not affect the totals.
BEGIN;
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('DR store A', 'PHARMACY') RETURNING id AS a \gset f_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('DR store B', 'PHARMACY') RETURNING id AS b \gset f_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('DR manager A', 'STORE_MANAGER', :f_a) RETURNING id AS manager \gset e_
INSERT INTO public.employees(full_name, role) VALUES ('DR accountant', 'ACCOUNTANT') RETURNING id AS accountant \gset e_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('DR staff', 'WAREHOUSE_STAFF', :f_a) RETURNING id AS staff \gset e_
INSERT INTO public.customers(full_name, created_at) VALUES ('DR customer 1', '2030-01-01 02:00') RETURNING id AS one \gset c_
INSERT INTO public.customers(full_name, created_at) VALUES ('DR customer 2', '2030-01-02 16:30') RETURNING id AS two \gset c_
INSERT INTO public.customers(full_name, created_at) VALUES ('DR customer 3', '2029-12-30 05:00') RETURNING id AS three \gset c_

-- created_at is UTC: 16:30 UTC is 23:30 in Vietnam, 17:30 UTC is 00:30 the next Vietnam day.
INSERT INTO public.orders(order_code, customer_id, export_facility_id, order_status, total_amount, created_at) VALUES
  ('DR-1', :c_one, :f_a, 'DELIVERED', 1000000, '2030-01-01 03:00'),
  ('DR-2', :c_two, :f_a, 'COMPLETED', 500000, '2030-01-02 17:30'),
  ('DR-3', :c_one, :f_a, 'PARTIALLY_RETURNED', 300000, '2030-01-01 16:30'),
  ('DR-4', :c_two, :f_a, 'CANCELLED', 200000, '2030-01-02 05:00'),
  ('DR-5', :c_three, :f_b, 'DELIVERED', 700000, '2030-01-02 05:00'),
  ('DR-6', :c_one, :f_a, 'DELIVERED', 9999, '2030-01-03 17:30'),
  ('DR-7', :c_three, :f_a, 'DELIVERED', 400000, '2029-12-30 05:00');
INSERT INTO public.cashbook_logs(transaction_code, transaction_type, category, amount, order_id, transaction_date)
SELECT 'DR-' || code, type, category, amount, (SELECT id FROM public.orders WHERE order_code = ord), at::timestamptz
FROM (VALUES
  ('IN-1', 'INCOME', 'ONLINE_PAYMENT', 1000000, 'DR-1', '2030-01-01 10:00+07'),
  ('IN-5', 'INCOME', 'ONLINE_PAYMENT', 700000, 'DR-5', '2030-01-02 10:00+07'),
  ('FEE-1', 'EXPENSE', 'SHIPPING_FEE', 50000, 'DR-1', '2030-01-01 11:00+07'),
  ('REF-3', 'EXPENSE', 'CUSTOMER_REFUND', 100000, 'DR-3', '2030-01-05 10:00+07'),
  ('REF-4', 'EXPENSE', 'CUSTOMER_REFUND', 200000, 'DR-4', '2030-01-02 12:00+07')
) v(code, type, category, amount, ord, at);

INSERT INTO public.medicines(medicine_name, min_remaining_shelf_life_days) VALUES ('DR stock medicine', 20) RETURNING id AS id \gset m_
INSERT INTO public.packaging_variants(medicine_id, unit_name) SELECT :m_id, u FROM unnest(ARRAY['out', 'low-default', 'low-own', 'ok', 'b-out']) u;
INSERT INTO public.inventories(facility_id, medicine_id, variant_id, stock_quantity, reserved_quantity, min_stock_quantity)
SELECT f, :m_id, v.id, s, r, m FROM public.packaging_variants v JOIN (VALUES
  ('out', :f_a, 10, 10, NULL), ('low-default', :f_a, 8, 5, NULL), ('low-own', :f_a, 20, 0, 25), ('ok', :f_a, 20, 0, 5), ('b-out', :f_b, 0, 0, NULL)
) t(unit, f, s, r, m) ON t.unit = v.unit_name WHERE v.medicine_id = :m_id;
SELECT id AS low FROM public.inventories i WHERE i.facility_id = :f_a AND i.variant_id = (SELECT id FROM public.packaging_variants WHERE medicine_id = :m_id AND unit_name = 'low-default') \gset i_
SELECT id AS b FROM public.inventories i WHERE i.facility_id = :f_b AND i.medicine_id = :m_id \gset i_

SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS today \gset
INSERT INTO public.batches(batch_number, medicine_id, production_date, expiry_date)
SELECT 'DR-S-' || n, :m_id, :'today'::date - 400, :'today'::date + d FROM (VALUES (1, 1), (2, -5), (3, 60), (4, 150), (5, 300), (6, 10)) v(n, d);
INSERT INTO public.medicine_boxes(batch_id, current_facility_id, status)
SELECT (SELECT id FROM public.batches WHERE batch_number = 'DR-S-' || n), CASE WHEN f = 'A' THEN :f_a WHEN f = 'B' THEN :f_b END, status
FROM (VALUES (1, 'A', 'IN_STOCK'), (1, 'A', 'IN_STOCK'), (1, 'A', 'RESERVED'), (1, 'A', 'QUARANTINED'), (1, NULL, 'IN_TRANSIT'),
  (2, 'A', 'IN_STOCK'), (3, 'A', 'IN_STOCK'), (3, 'A', 'MANUFACTURED'), (4, 'A', 'IN_STOCK'), (5, 'A', 'IN_STOCK'), (6, 'B', 'IN_STOCK')) v(n, f, status);
SELECT set_config('test.i_low', :'i_low', true), set_config('test.i_b', :'i_b', true);

SELECT set_config('test.a', :'f_a', true), set_config('test.b', :'f_b', true), set_config('test.manager', :'e_manager', true),
  set_config('test.accountant', :'e_accountant', true), set_config('test.staff', :'e_staff', true);

-- Finance fixtures: aging reports as of 2031-01-31, cashbook window 2031-01-01..2031-01-03 (Vietnam days).
INSERT INTO public.orders(order_code, order_status, payment_method, payment_status, total_amount, created_at)
SELECT 'DR-AR-' || age, 'DELIVERED', 'COD', 'UNPAID', 1, '2031-01-01'::timestamp FROM unnest(ARRAY[7, 8, 15, 16, 30, 31, 99]) age;
INSERT INTO public.shipments(order_id, tracking_number)
SELECT id, 'DR-TRK-' || substr(order_code, 7) FROM public.orders WHERE order_code LIKE 'DR-AR-%';
INSERT INTO public.courier_receivables(shipment_id, courier_name, amount_due, status, created_at)
SELECT s.id, 'DR-Courier-A', v.amount, v.status, (('2031-01-31'::date - v.age)::text || ' 12:00+07')::timestamptz
FROM (VALUES (7, 100, 'OPEN'), (8, 200, 'OPEN'), (15, 400, 'OPEN'), (16, 800, 'OPEN'), (30, 1600, 'OPEN'), (31, 3200, 'OPEN'), (99, 6400, 'SETTLED')) v(age, amount, status)
JOIN public.shipments s ON s.tracking_number = 'DR-TRK-' || v.age;
INSERT INTO public.orders(order_code, order_status, payment_method, payment_status, total_amount, created_at) VALUES
  ('DR-ON-1', 'DELIVERED', 'BANK_TRANSFER', 'UNPAID', 1000, '2031-01-20 05:00'),
  ('DR-ON-2', 'DELIVERED', 'E_WALLET', 'PAID', 2000, '2031-01-20 05:00'),
  ('DR-ON-3', 'PENDING', 'BANK_TRANSFER', 'UNPAID', 4000, '2031-01-20 05:00'),
  ('DR-ON-4', 'DELIVERED', 'COD', 'UNPAID', 8000, '2031-01-20 05:00');

INSERT INTO public.purchase_orders(po_code, supplier_id, status) VALUES ('DR-PO-1', :f_b, 'RECEIVED') RETURNING id AS po \gset p_
INSERT INTO public.accounts_payable(supplier_name, po_id, total_due_amount, paid_amount, due_date)
SELECT 'DR-Supplier-A', CASE WHEN due = '2031-02-05' AND total = 100 THEN :p_po END, total, paid, (due || ' 12:00+07')::timestamptz
FROM (VALUES (100, 0, '2031-02-05'), (200, 0, '2031-01-31'), (1000, 400, '2031-02-05'), (400, 0, '2031-01-30'), (800, 0, '2031-01-01'),
  (1600, 0, '2030-12-31'), (3200, 0, '2030-12-02'), (6400, 0, '2030-12-01'), (500, 500, '2031-01-01')) v(total, paid, due);
INSERT INTO public.accounts_payable(supplier_name, total_due_amount) VALUES ('DR-Supplier-A', 12800);

INSERT INTO public.cashbook_logs(transaction_code, transaction_type, category, amount, payment_method, transaction_date, order_id, po_id)
SELECT 'DR-F-' || code, type, 'TEST', amount, method, at::timestamptz,
  CASE WHEN code = '1' THEN (SELECT id FROM public.orders WHERE order_code = 'DR-1') END, CASE WHEN code = '4' THEN :p_po END
FROM (VALUES
  ('OPEN-IN', 'INCOME', 500000, 'CASH', '2030-12-31 23:30+07'),
  ('OPEN-EX', 'EXPENSE', 120000, 'CASH', '2030-12-31 10:00+07'),
  ('1', 'INCOME', 300000, 'CASH', '2031-01-01 00:30+07'),
  ('2', 'EXPENSE', 50000, 'CASH', '2031-01-01 23:30+07'),
  ('3', 'INCOME', 700000, 'BANK_TRANSFER', '2031-01-03 09:00+07'),
  ('4', 'EXPENSE', 80000, 'CASH', '2031-01-03 12:00+07'),
  ('5', 'INCOME', 100000, 'CASH', '2031-01-04 00:10+07')
) v(code, type, amount, method, at);
SELECT coalesce(sum(CASE WHEN transaction_type = 'INCOME' THEN amount ELSE -amount END), 0) AS base FROM public.cashbook_logs
WHERE payment_method = 'CASH' AND transaction_date < '2031-01-01 00:00+07' AND transaction_code NOT LIKE 'DR-F-%' \gset cash_
SELECT set_config('test.cash_base', :'cash_base', true);

CREATE FUNCTION pg_temp.dr_expect(expected text, statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected % but the statement succeeded: %', expected, statement;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> expected THEN RAISE; END IF;
END $$;
CREATE FUNCTION pg_temp.dr_as(role text, employee text, unit text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.current_user_type', 'employee', true), set_config('app.current_user_role', role, true),
    set_config('app.current_user_id', current_setting('test.' || employee), true),
    set_config('app.current_unit_id', coalesce(current_setting('test.' || unit, true), ''), true);
END $$;
CREATE FUNCTION pg_temp.dr_check(label text, actual text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION '%: expected %, got %', label, expected, actual; END IF;
END $$;

SET LOCAL ROLE app_user;
DO $$
DECLARE b integer := current_setting('test.b')::integer; a integer := current_setting('test.a')::integer;
BEGIN
  PERFORM pg_temp.dr_as('WAREHOUSE_STAFF', 'staff', 'a');
  PERFORM pg_temp.dr_expect('42501', 'SELECT * FROM public.report_sales_overview(''2030-01-01'', ''2030-01-03'', NULL)');
  PERFORM pg_temp.dr_expect('42501', 'SELECT * FROM public.report_revenue_series(''2030-01-01'', ''2030-01-03'', ''day'', NULL)');
  PERFORM pg_temp.dr_expect('42501', 'SELECT * FROM public.report_order_status(''2030-01-01'', ''2030-01-03'', NULL)');
  PERFORM set_config('app.current_user_type', 'customer', true), set_config('app.current_user_role', 'SUPER_ADMIN', true);
  PERFORM pg_temp.dr_expect('42501', 'SELECT * FROM public.report_order_status(''2030-01-01'', ''2030-01-03'', NULL)');

  PERFORM pg_temp.dr_as('ACCOUNTANT', 'accountant', 'none');
  PERFORM pg_temp.dr_expect('22023', 'SELECT * FROM public.report_sales_overview(''2030-01-03'', ''2030-01-01'', NULL)');
  PERFORM pg_temp.dr_expect('22023', 'SELECT * FROM public.report_revenue_series(''2030-01-01'', ''2030-01-03'', ''week'', NULL)');

  PERFORM pg_temp.dr_check('All facilities current period',
    (SELECT row(revenue, collected_cash, orders, cancelled_orders, new_customers, first_time_buyers, avg_order_value)::text
     FROM public.report_sales_overview('2030-01-01', '2030-01-03', NULL) WHERE period = 'current'),
    '(2400000.00,1700000.00,5,1,2,2,600000.00)');
  PERFORM pg_temp.dr_check('Facility B',
    (SELECT row(revenue, collected_cash, orders, new_customers, first_time_buyers)::text
     FROM public.report_sales_overview('2030-01-01', '2030-01-03', b) WHERE period = 'current'),
    '(700000.00,700000.00,1,0,0)');

  PERFORM pg_temp.dr_as('STORE_MANAGER', 'manager', 'a');
  PERFORM pg_temp.dr_check('Store manager current period is facility A even when asking for B',
    (SELECT row(period_from, period_to, revenue, collected_cash, orders, cancelled_orders, new_customers, first_time_buyers, avg_order_value)::text
     FROM public.report_sales_overview('2030-01-01', '2030-01-03', b) WHERE period = 'current'),
    '(2030-01-01,2030-01-03,1700000.00,1000000.00,4,1,2,2,566666.67)');
  PERFORM pg_temp.dr_check('Previous period of the same length',
    (SELECT row(period_from, period_to, revenue, orders, new_customers, first_time_buyers)::text
     FROM public.report_sales_overview('2030-01-01', '2030-01-03', b) WHERE period = 'previous'),
    '(2029-12-29,2029-12-31,400000.00,1,1,1)');
  PERFORM pg_temp.dr_check('Daily series by Vietnam day with an empty bucket',
    (SELECT string_agg(row(bucket, revenue, refunds, orders, new_customers)::text, ' ' ORDER BY bucket)
     FROM public.report_revenue_series('2030-01-01', '2030-01-05', 'day', b)),
    '(2030-01-01,1200000.00,100000.00,2,1) (2030-01-02,0,0,1,1) (2030-01-03,500000.00,0,1,0) (2030-01-04,9999.00,0,1,0) (2030-01-05,0,0,0,0)');
  PERFORM pg_temp.dr_check('Monthly series',
    (SELECT string_agg(row(bucket, revenue, refunds, orders, new_customers)::text, ' ' ORDER BY bucket)
     FROM public.report_revenue_series('2029-12-15', '2030-01-03', 'month', a)),
    '(2029-12-01,400000.00,0,1,1) (2030-01-01,1700000.00,100000.00,4,2)');
  PERFORM pg_temp.dr_check('Order status counts and amounts',
    (SELECT string_agg(row(status, count, amount)::text, ' ' ORDER BY status)
     FROM public.report_order_status('2030-01-01', '2030-01-03', b)),
    '(CANCELLED,1,200000.00) (COMPLETED,1,500000.00) (DELIVERED,1,1000000.00) (PARTIALLY_RETURNED,1,300000.00)');

  PERFORM set_config('app.current_unit_id', '', true);
  PERFORM pg_temp.dr_expect('42501', 'SELECT * FROM public.report_order_status(''2030-01-01'', ''2030-01-03'', NULL)');
END $$;
DO $$
DECLARE a integer := current_setting('test.a')::integer;
  low integer := current_setting('test.i_low')::integer; ib integer := current_setting('test.i_b')::integer;
  stock text := $q$SELECT string_agg(concat_ws('/', CASE WHEN facility_id = %s THEN 'A' ELSE 'B' END, unit_name, available, threshold, level), ' ' ORDER BY unit_name)
    FROM public.report_stock_alerts(%s) WHERE medicine_name = 'DR stock medicine'$q$;
  expiry text := $q$SELECT string_agg(concat_ws('/', batch_number, CASE WHEN facility_id = %s THEN 'A' ELSE 'B' END, boxes, days_left, level, below_min_shelf_life), ' ' ORDER BY batch_number)
    FROM public.report_expiry_alerts(%s, %s) WHERE batch_number LIKE 'DR-S-%%'$q$;
  result text;
BEGIN
  PERFORM pg_temp.dr_as('WAREHOUSE_STAFF', 'staff', 'a');
  PERFORM pg_temp.dr_expect('42501', 'SELECT * FROM public.report_stock_alerts(NULL)');
  PERFORM pg_temp.dr_expect('42501', 'SELECT * FROM public.report_expiry_alerts(NULL, 180)');
  PERFORM pg_temp.dr_as('ACCOUNTANT', 'accountant', 'none');
  PERFORM pg_temp.dr_expect('42501', 'SELECT * FROM public.report_stock_alerts(NULL)');
  PERFORM pg_temp.dr_expect('42501', 'SELECT * FROM public.report_expiry_alerts(NULL, 180)');
  PERFORM pg_temp.dr_expect('42501', format('SELECT public.set_inventory_min_stock_quantity(%s, 1)', low));
  PERFORM pg_temp.dr_as('ADMIN', 'manager', 'none');
  PERFORM pg_temp.dr_expect('42501', format('SELECT public.set_inventory_min_stock_quantity(%s, 1)', low));
  PERFORM pg_temp.dr_expect('42501', 'SELECT public.set_default_min_stock_quantity(1)');
  PERFORM pg_temp.dr_as('STORE_MANAGER', 'manager', 'a');
  PERFORM pg_temp.dr_expect('42501', 'SELECT public.set_default_min_stock_quantity(1)');

  PERFORM pg_temp.dr_as('SUPER_ADMIN', 'manager', 'none');
  PERFORM public.set_default_min_stock_quantity(4);
  PERFORM pg_temp.dr_expect('22023', 'SELECT * FROM public.report_expiry_alerts(NULL, 0)');
  PERFORM pg_temp.dr_expect('23514', format('SELECT public.set_inventory_min_stock_quantity(%s, -1)', low));

  PERFORM pg_temp.dr_as('ADMIN', 'manager', 'none');
  EXECUTE format(stock, a, 'NULL') INTO result;
  PERFORM pg_temp.dr_check('Out of stock and low stock use available stock and the default or own threshold', result,
    'B/b-out/0/4/OUT_OF_STOCK A/low-default/3/4/LOW_STOCK A/low-own/20/25/LOW_STOCK A/out/0/4/OUT_OF_STOCK');
  EXECUTE format(expiry, a, 'NULL', 180) INTO result;
  PERFORM pg_temp.dr_check('Expiry levels count only boxes physically in stock, expired batches included', result,
    'DR-S-1/A/3/1/LE_30/t DR-S-2/A/1/-5/EXPIRED/f DR-S-3/A/2/60/D31_90/f DR-S-4/A/1/150/D91_180/f DR-S-6/B/1/10/LE_30/t');
  EXECUTE format(expiry, a, 'NULL', 30) INTO result;
  PERFORM pg_temp.dr_check('Within 30 days keeps LE_30 and expired batches', result,
    'DR-S-1/A/3/1/LE_30/t DR-S-2/A/1/-5/EXPIRED/f DR-S-6/B/1/10/LE_30/t');

  PERFORM pg_temp.dr_as('STORE_MANAGER', 'manager', 'a');
  EXECUTE format(stock, a, ib) INTO result;
  PERFORM pg_temp.dr_check('Store manager stock alerts stay on facility A when asking for B', result,
    'A/low-default/3/4/LOW_STOCK A/low-own/20/25/LOW_STOCK A/out/0/4/OUT_OF_STOCK');
  EXECUTE format(expiry, a, ib, 180) INTO result;
  PERFORM pg_temp.dr_check('Store manager expiry alerts stay on facility A when asking for B', result,
    'DR-S-1/A/3/1/LE_30/t DR-S-2/A/1/-5/EXPIRED/f DR-S-3/A/2/60/D31_90/f DR-S-4/A/1/150/D91_180/f');

  PERFORM public.set_inventory_min_stock_quantity(low, 2);
  EXECUTE format(stock, a, 'NULL') INTO result;
  PERFORM pg_temp.dr_check('A lower own threshold removes the item from the alerts', result,
    'A/low-own/20/25/LOW_STOCK A/out/0/4/OUT_OF_STOCK');
  PERFORM public.set_inventory_min_stock_quantity(low, NULL);
  EXECUTE format(stock, a, 'NULL') INTO result;
  PERFORM pg_temp.dr_check('A NULL threshold uses the default again', result,
    'A/low-default/3/4/LOW_STOCK A/low-own/20/25/LOW_STOCK A/out/0/4/OUT_OF_STOCK');
  PERFORM pg_temp.dr_expect('P0002', format('SELECT public.set_inventory_min_stock_quantity(%s, 1)', ib));
END $$;

DO $$
DECLARE base numeric := current_setting('test.cash_base')::numeric; touched integer;
BEGIN
  PERFORM pg_temp.dr_as('WAREHOUSE_STAFF', 'staff', 'a');
  PERFORM pg_temp.dr_expect('42501', 'SELECT * FROM public.report_receivables_aging(''2031-01-31'')');
  PERFORM pg_temp.dr_expect('42501', 'SELECT * FROM public.report_payables_aging(''2031-01-31'')');
  PERFORM pg_temp.dr_expect('42501', 'SELECT * FROM public.report_cashbook(''2031-01-01'', ''2031-01-03'')');
  PERFORM pg_temp.dr_expect('42501', 'SELECT * FROM public.report_cashbook_entries(''2031-01-01'', ''2031-01-03'')');
  PERFORM pg_temp.dr_check('Warehouse staff read no cashbook rows', (SELECT count(*) FROM public.cashbook_logs)::text, '0');
  PERFORM pg_temp.dr_as('STORE_MANAGER', 'manager', 'a');
  PERFORM pg_temp.dr_expect('42501', 'SELECT * FROM public.report_receivables_aging(''2031-01-31'')');
  PERFORM pg_temp.dr_expect('42501', 'SELECT * FROM public.report_cashbook(''2031-01-01'', ''2031-01-03'')');
  PERFORM pg_temp.dr_check('Store manager reads no cashbook rows', (SELECT count(*) FROM public.cashbook_logs)::text, '0');
  PERFORM set_config('app.current_user_type', 'customer', true), set_config('app.current_user_role', 'SUPER_ADMIN', true);
  PERFORM pg_temp.dr_expect('42501', 'SELECT * FROM public.report_payables_aging(''2031-01-31'')');

  PERFORM pg_temp.dr_as('ACCOUNTANT', 'accountant', 'none');
  PERFORM pg_temp.dr_check('Finance reads cashbook rows directly', (SELECT count(*) > 0 FROM public.cashbook_logs)::text, 'true');
  PERFORM pg_temp.dr_expect('42501', 'INSERT INTO public.cashbook_logs(transaction_code, transaction_type, category, amount) VALUES (''DR-FORGED'', ''INCOME'', ''TEST'', 1)');
  UPDATE public.cashbook_logs SET amount = 1;
  GET DIAGNOSTICS touched = ROW_COUNT;
  PERFORM pg_temp.dr_check('Direct cashbook update changes nothing', touched::text, '0');
  PERFORM pg_temp.dr_expect('22023', 'SELECT * FROM public.report_cashbook(''2031-01-03'', ''2031-01-01'')');
  PERFORM pg_temp.dr_expect('22023', 'SELECT * FROM public.report_cashbook_entries(''2031-01-03'', ''2031-01-01'')');

  PERFORM pg_temp.dr_check('Courier receivable buckets honour the 7/8, 15/16 and 30/31 day boundaries',
    (SELECT string_agg(concat_ws('/', bucket, row_count, amount), ' ' ORDER BY bucket COLLATE "C")
     FROM public.report_receivables_aging('2031-01-31') WHERE row_type = 'SUMMARY' AND party_name = 'DR-Courier-A'),
    '0_7/1/100.00 16_30/2/2400.00 8_15/2/600.00 GT_30/1/3200.00');
  PERFORM pg_temp.dr_check('Receivable details carry order, age and exclude settled rows',
    (SELECT string_agg(concat_ws('/', order_code, age_days, bucket), ' ' ORDER BY age_days)
     FROM public.report_receivables_aging('2031-01-31') WHERE row_type = 'DETAIL' AND party_name = 'DR-Courier-A'),
    'DR-AR-7/7/0_7 DR-AR-8/8/8_15 DR-AR-15/15/8_15 DR-AR-16/16/16_30 DR-AR-30/30/16_30 DR-AR-31/31/GT_30');
  PERFORM pg_temp.dr_check('Only delivered unpaid online orders are receivable',
    (SELECT string_agg(concat_ws('/', order_code, amount, age_days, bucket), ' ' ORDER BY order_code)
     FROM public.report_receivables_aging('2031-01-31') WHERE row_type = 'DETAIL' AND order_code LIKE 'DR-ON-%'),
    'DR-ON-1/1000.00/11/8_15');

  PERFORM pg_temp.dr_check('Payable buckets honour due dates, remaining balance and the missing due date',
    (SELECT string_agg(concat_ws('/', bucket, row_count, amount), ' ' ORDER BY bucket COLLATE "C")
     FROM public.report_payables_aging('2031-01-31') WHERE row_type = 'SUMMARY' AND supplier_name = 'DR-Supplier-A'),
    '1_30/2/1200.00 31_60/2/4800.00 GT_60/1/6400.00 NOT_DUE/3/900.00 NO_DUE_DATE/1/12800.00');
  PERFORM pg_temp.dr_check('Payable details link the purchase order and days overdue',
    (SELECT string_agg(concat_ws('/', po_code, days_overdue, bucket), ' ' ORDER BY due_date)
     FROM public.report_payables_aging('2031-01-31') WHERE row_type = 'DETAIL' AND supplier_name = 'DR-Supplier-A' AND due_date = '2031-02-05' AND po_code IS NOT NULL),
    'DR-PO-1/-5/NOT_DUE');

  PERFORM pg_temp.dr_check('Cash summary: opening includes earlier cash rows by Vietnam day, other methods are excluded',
    (SELECT row(opening - base, income, expense, closing - base, entry_count)::text FROM public.report_cashbook('2031-01-01', '2031-01-03', 'CASH') WHERE row_type = 'SUMMARY'),
    '(380000.00,300000.00,130000.00,550000.00,3)');
  PERFORM pg_temp.dr_check('Cash days run from the opening balance and empty days stay',
    (SELECT string_agg(row(day, opening - base, income, expense, closing - base)::text, ' ' ORDER BY day)
     FROM public.report_cashbook('2031-01-01', '2031-01-03', 'CASH') WHERE row_type = 'DAY'),
    '(2031-01-01,380000.00,300000.00,50000.00,630000.00) (2031-01-02,630000.00,0,0,630000.00) (2031-01-03,630000.00,0,80000.00,550000.00)');
  PERFORM pg_temp.dr_check('Opening + income - expense = closing on every row',
    (SELECT count(*) FROM public.report_cashbook('2031-01-01', '2031-01-03') WHERE opening + income - expense <> closing)::text, '0');
  PERFORM pg_temp.dr_check('All methods add the bank income; the type filter only changes the entry count',
    (SELECT row(income, expense, entry_count)::text FROM public.report_cashbook('2031-01-01', '2031-01-03', NULL, 'INCOME') WHERE row_type = 'SUMMARY'),
    '(1000000.00,130000.00,2)');
  PERFORM pg_temp.dr_check('Entries are newest first, paged, with order and PO links',
    (SELECT string_agg(concat_ws('/', transaction_code, order_code, po_code), ' ' ORDER BY transaction_date DESC, id DESC) FROM public.report_cashbook_entries('2031-01-01', '2031-01-03', 'CASH', NULL, 2, 0)),
    'DR-F-4/DR-PO-1 DR-F-2');
  PERFORM pg_temp.dr_check('Second page',
    (SELECT string_agg(concat_ws('/', transaction_code, order_code, po_code), ' ') FROM public.report_cashbook_entries('2031-01-01', '2031-01-03', 'CASH', NULL, 2, 2)),
    'DR-F-1/DR-1');
  PERFORM pg_temp.dr_check('A NULL limit returns every entry matching the filters',
    (SELECT string_agg(transaction_code, ' ' ORDER BY transaction_date DESC, id DESC) FROM public.report_cashbook_entries('2031-01-01', '2031-01-03', NULL, 'INCOME', NULL, 0)),
    'DR-F-3 DR-F-1');
END $$;

RESET ROLE;
ROLLBACK;
\echo 'dashboard_reports_test passed'
