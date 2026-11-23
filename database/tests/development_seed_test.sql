\set ON_ERROR_STOP on

-- Run as postgres on a freshly initialized development database, before other tests.
BEGIN;

DO $$
DECLARE
    fixture RECORD;
    actual_count BIGINT;
    sequence_name TEXT;
    maximum_id BIGINT;
    sequence_value BIGINT;
BEGIN
    FOR fixture IN SELECT * FROM (VALUES
        ('facilities', 15), ('employees', 5), ('customers', 11),
        ('manufacturers', 422), ('medicines', 543),
        ('packaging_variants', 624), ('categories', 38),
        ('medicine_categories', 670),
        ('prescriptions', 0), ('orders', 0), ('articles', 0), ('batches', 0),
        ('cart_items', 0), ('customer_wishlists', 0), ('medicine_boxes', 0),
        ('internal_transfers', 0), ('inventories', 0), ('inventory_logs', 0),
        ('loyalty_point_logs', 0), ('reviews', 0), ('moderation_audit_logs', 0),
        ('moderation_reports', 0), ('order_items', 0),
        ('order_prescription_reviews', 0), ('qr_scan_logs', 0), ('shipments', 0),
        ('vouchers', 0), ('purchase_orders', 0), ('accounts_payable', 0),
        ('accounts_receivable', 0), ('cashbook_logs', 0), ('sscc_cartons', 0),
        ('fraud_alerts', 0), ('purchase_order_items', 0)
    ) AS expected(table_name, row_count)
    LOOP
        EXECUTE format('SELECT count(*) FROM public.%I', fixture.table_name) INTO actual_count;
        IF actual_count <> fixture.row_count THEN
            RAISE EXCEPTION 'Seed row count mismatch for %: expected %, got %',
                fixture.table_name, fixture.row_count, actual_count;
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS all 34 application table row counts (catalog, accounts and facilities only)';

    IF (SELECT count(*) FROM public.facility_fulfillment_policy) <> 14
        OR (SELECT count(*) FROM public.medicine_transport_requirements) <> 543
        OR (SELECT count(*) FROM public.warehouse_selling_pharmacies) <> 2
        OR EXISTS (SELECT FROM public.facility_fulfillment_policy p
            WHERE NOT public.valid_selling_pharmacy(p.facility_id,p.selling_facility_id)
                OR NOT p.enabled OR p.opens_minute<>0 OR p.closes_minute<>1440
                OR p.weekdays<>ARRAY[0,1,2,3,4,5,6] OR p.daily_capacity<>1000 OR p.radius_km<>100
                OR p.transport_conditions<>ARRAY['APPROVED_STANDARD'])
        OR EXISTS (SELECT FROM public.medicine_transport_requirements WHERE condition<>'APPROVED_STANDARD') THEN
        RAISE EXCEPTION 'Development fulfillment configuration is incomplete or invalid';
    END IF;
    RAISE NOTICE 'PASS development fulfillment policies, warehouse links and medicine classifications';

    IF to_regclass('public._prisma_migrations') IS NOT NULL
        OR to_regclass('public.medicines_backup_before_m2m') IS NOT NULL
        OR to_regclass('public.medicines_category_id_backup_v2') IS NOT NULL THEN
        RAISE EXCEPTION 'Development seed must not restore migration history or backup tables';
    END IF;

    RAISE NOTICE 'PASS excluded tables';


    FOR fixture IN
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (is_identity = 'YES' OR column_default LIKE 'nextval(%')
    LOOP
        sequence_name := pg_get_serial_sequence(format('public.%I', fixture.table_name), fixture.column_name);
        EXECUTE format('SELECT max(%I) FROM public.%I', fixture.column_name, fixture.table_name) INTO maximum_id;
        EXECUTE format('SELECT last_value FROM %s', sequence_name) INTO sequence_value;
        IF maximum_id > sequence_value THEN
            RAISE EXCEPTION 'Sequence % is behind imported IDs', sequence_name;
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS sequences cover all imported IDs';

    IF EXISTS (SELECT 1 FROM public.customers WHERE membership_tier <> 'BRONZE' OR reward_points <> 0)
        OR EXISTS (SELECT 1 FROM public.customers WHERE email !~ '^customer[0-9]+@example\.test$')
        OR EXISTS (SELECT 1 FROM public.employees WHERE email !~ '^employee[0-9]+@example\.test$') THEN
        RAISE EXCEPTION 'Unexpected personal contact, image, or IP values in development fixtures';
    END IF;
    RAISE NOTICE 'PASS synthetic contact/image/IP fixtures';

    IF has_table_privilege('app_user', 'public.order_prescription_reviews', 'DELETE')
        OR has_table_privilege('app_user', 'public.order_prescription_reviews', 'TRUNCATE')
        OR has_sequence_privilege('app_user', 'public.order_prescription_reviews_id_seq', 'UPDATE') THEN
        RAISE EXCEPTION 'Review privileges inherited broader access than intended';
    END IF;
    IF NOT has_table_privilege('app_user', 'public.order_prescription_reviews', 'SELECT')
        OR NOT has_table_privilege('app_user', 'public.order_prescription_reviews', 'INSERT')
        OR NOT has_table_privilege('app_user', 'public.order_prescription_reviews', 'UPDATE') THEN
        RAISE EXCEPTION 'Review workflow privileges are missing';
    END IF;
    RAISE NOTICE 'PASS restricted review grants';
END
$$;

ROLLBACK;
