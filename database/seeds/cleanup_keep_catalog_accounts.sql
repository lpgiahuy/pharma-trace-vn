-- Local database cleanup (manual, run as postgres; never run by master init).
-- Keeps medicines, packaging, categories, manufacturers, login accounts and facilities
-- (plus fulfillment configuration and schema-owned reference data). Everything else is emptied.
-- Back up first: pg_dump -U postgres -Fc <db> > backup.dump
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE wipe text;
BEGIN
  SELECT string_agg(format('public.%I', table_name), ', ') INTO wipe
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    AND table_name NOT IN (
      'medicines', 'packaging_variants', 'medicine_categories', 'categories', 'manufacturers',
      'customers', 'employees', 'facilities',
      'facility_fulfillment_policy', 'warehouse_selling_pharmacies', 'medicine_transport_requirements',
      'system_settings', 'article_categories', '_prisma_migrations',
      'medicines_backup_before_m2m', 'medicines_category_id_backup_v2');
  -- No CASCADE: a missed foreign key fails loudly instead of emptying a kept table.
  EXECUTE 'TRUNCATE TABLE ' || wipe || ' RESTART IDENTITY';
END $$;
UPDATE public.customers SET membership_tier = 'BRONZE', reward_points = 0;
COMMIT;
