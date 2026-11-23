# PharmaTrace VN - Database Architecture & Schema Specification

PostgreSQL schema, development seed data, application permissions, and RLS for **PharmaTrace VN**.

---

## Directory Structure

```text
database/
├── 00_create_app_user.sh           # Docker entrypoint: creates the runtime role
├── 00_master_init.sql              # Docker entrypoint: orchestrates SQL scripts
├── README.md
├── security/                       # Database access policies and workflow safeguards
│   ├── access/                     # Runtime role, base permissions and named role groups (app_role_groups.sql)
│   └── <module>/                   # Related policies and workflows, grouped by module
├── schemas/                        # Table DDL, constraints, primary & foreign keys
│   ├── 01_core_master_tables.sql   # Categories, facilities, customers, employees, manufacturers, medicines, packaging_variants, medicine_categories, customer_wishlists
│   ├── 02_inventory_tracking.sql   # Batches, sscc_cartons, medicine_boxes, inventories, inventory_logs
│   ├── 03_orders_prescriptions.sql # Prescriptions, vouchers, orders, order_items, cart_items, reviews, moderation_reports, moderation_audit_logs, articles
│   ├── 04_procurement_po.sql       # Purchase orders (PO) and PO line items
│   ├── 05_logistics_cod.sql        # Shipments and COD reconciliation
│   ├── 06_qr_fraud_anomaly.sql     # QR scan verification logs and anti-fraud anomaly alerts
│   ├── 07_crm_loyalty_rma.sql      # Customer loyalty points ledger
│   ├── 08_finance_ar_ap.sql        # Cashbook logs, accounts receivable (AR), accounts payable (AP)
│   └── 09_prescription_management.sql # Prescription review table, column, and indexes
│   └── 14_articles_blog.sql        # Article categories, blog article columns and article comments
│   └── 15_flash_sale_quota.sql     # Flash sale quota column and sold-count function
├── seeds/                          # Catalog, login accounts and facilities only (no transactions); cleanup_keep_catalog_accounts.sql empties an existing local DB the same way
│   └── 01_seed_data.sql
└── tests/
    ├── development_seed_test.sql   # Fresh-database fixtures, sequences, and grants
    ├── prescription_rls_test.sql   # Manual RLS isolation checks
    ├── wishlist_rls_test.sql       # Wishlist allow/deny checks, rolled back
    ├── cart_rls_test.sql           # Cart ownership and column-grant checks
    ├── review_rls_test.sql         # Review visibility and write restrictions
    ├── article_rls_test.sql        # Blog visibility, pharmacist drafts, admin approval and comment rules
    ├── order_rls_test.sql          # Customer/facility ownership and transfer projection
    ├── voucher_rls_test.sql        # Exact-code previews, management and consumption
    ├── manufacturer_rls_test.sql   # Manufacturer permissions and facility assignment
    └── warehouse_manager_access_test.sql # Warehouse manager scope, discrepancy gate and staff roster
```

`backups/` contains ignored local database dumps. Master initialization includes both prescription and auth security scripts. Auth roles and policies are prepared by the auth RLS script; the employee and customer RLS scripts enable RLS on employees and customers. Backend authentication must use the corresponding RLS configuration. These bootstrap scripts do not track applied versions or update existing Docker volumes automatically.

## Docker Development Setup

From the repository root, copy `.env.example` to `.env` and `pharmatrace-vn-backend/.env.example` to `pharmatrace-vn-backend/.env`. Set `APP_DB_PASSWORD` in the root `.env`, then use the same password in the backend `DATABASE_URL` for `app_user`. If it contains URL-reserved characters, encode them in `DATABASE_URL`. Add your own Cloudinary credentials to the backend `.env`. Do not commit either `.env` file.

On a new database volume, `docker compose up -d db` creates the restricted `app_user` role, loads the schema and seed data, grants application table privileges, and applies prescription RLS through `00_master_init.sql`.

The PostgreSQL image runs initialization scripts only when its data directory is empty. Existing volumes do not rerun them. Keep the versioned schema and RLS files in Git so new clones receive the same database setup. Do not remove the volume to rerun initialization unless its data can be discarded.

Run the fixture checks on a freshly initialized database, then the RLS checks:

```powershell
docker exec phartrace-vn-db psql -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/development_seed_test.sql
docker exec phartrace-vn-db psql -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/prescription_rls_test.sql
docker exec phartrace-vn-db psql -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/wishlist_rls_test.sql
docker exec phartrace-vn-db psql -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/cart_rls_test.sql

docker exec phartrace-vn-db psql -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/review_rls_test.sql
```

The test uses the IDs from the committed seed data and rolls back its test order.

Existing local databases do not rerun initialization automatically. To enable voucher usage release for prescription rejections, back up the database and apply the new script as the database owner:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/prescription/prescription_voucher_release.sql
```

The release is atomic with prescription rejection and applies only to that cancellation path. Other cancellation paths do not currently release voucher usage. Paid orders retain `PAID` until a manual refund is completed and recorded.

## Development Seed Accounts

### Interview demo setup

Use Docker and Node.js to start the project on a new machine. From the repository root:

```powershell
Copy-Item .env.example .env
Copy-Item pharmatrace-vn-backend/.env.example pharmatrace-vn-backend/.env
Copy-Item pharmatrace-vn-frontend/.env.example pharmatrace-vn-frontend/.env.local
```

Set `APP_DB_PASSWORD` in the root `.env` and configure the backend `DATABASE_URL` with the same password for `app_user`, the database name and port in the root `.env`. Set a local `JWT_SECRET` and `QR_SECRET_KEY` in the backend `.env`. Optional external services require their own credentials; do not commit `.env` files.

```powershell
docker compose up -d db
cd pharmatrace-vn-backend
npm ci
npm run start:dev
```

In a second terminal:

```powershell
cd pharmatrace-vn-frontend
npm ci
npm run dev
```

Open `http://localhost:3000`. The demo password below works for seeded accounts including super administrator `employee11@example.test`, store manager `employee12@example.test`, pharmacist `employee13@example.test`, and customer `customer1@example.test`. The seed is loaded only for a new database volume; it does not replace an existing local database. Verify the demo flows before an interview, especially optional image, map and AI integrations.

The seed is derived from a local export, with application IDs, relationships, stock, and transaction amounts retained. It excludes `_prisma_migrations` and the two legacy medicine backup tables. Personal contact fields, prescription text/image references, customer free text, and QR location/client data are replaced or removed. It is a development fixture, not an exact backup of the local database.

- Customers: `customer<ID>@example.test`, phone `09` followed by the ID padded to eight digits; for example, customer 1 uses `0900000001`.
- Employees: `employee<ID>@example.test`; existing role and facility assignments are retained.
- All seeded account passwords: `PharmaTraceDemo2026!` (bcrypt hashes; development only).
- Prescription images use `example.invalid` placeholders and review images are removed. Image display and real image moderation require separate synthetic uploads.
- Legacy `REDEEMED` is normalized to `REDEEM`. `REDEEM_REVERSAL` remains a separate transaction type supported by the schema and backend.

Do not overwrite this file with an unfiltered local dump. Keep raw exports in the ignored `backups/` directory. New exports require schema, privacy, and clean-import checks before replacing fixtures.

---

## Database Tables Overview (34 Tables)

### 1. Core Master Data (`schemas/01_core_master_tables.sql`)
* `categories`: Hierarchical pharmaceutical categories with recursive parent-child taxonomy.
* `facilities`: Physical organization units (Manufacturers, Central Warehouses, Branch Warehouses, Pharmacies).
* `customers`: Customer profiles, authentication credentials (`password_hash`), tiers (`BRONZE` to `DIAMOND`), and reward points.
* `employees`: Employee staff profiles, credentials, assigned facility, and system roles.
* `manufacturers`: Master pharmaceutical brand records and origin information.
* `medicines`: Comprehensive pharmaceutical catalog with pricing, active ingredients, dosage, prescription flags, and computed `effective_price`.
* `packaging_variants`: Multi-tier packaging units (Box, Bottle, Strip, Tube) with custom unit pricing and discounts.
* `medicine_categories`: Many-to-Many mapping table between medicines and categories.
* `customer_wishlists`: Customer bookmarked and saved medicines.

### 2. Inventory & Traceability (`schemas/02_inventory_tracking.sql`)
* `batches`: Production lot batches with manufacturing and expiration dates and CO/CQ certification.
* `sscc_cartons`: GS1 SSCC logistics cartons and master shipping containers.
* `medicine_boxes`: Serialized unit-level boxes (UUID primary key, cryptographic signature, and public key).
* `inventories`: Real-time stock balances per facility, medicine, and packaging variant.
* `inventory_logs`: Audit trail of stock movements (Inbound, Outbound, Transfer, Disposal, Adjustment).

### 3. Orders & Prescriptions (`schemas/03_orders_prescriptions.sql`)
* `prescriptions`: Uploaded doctor prescriptions with pharmacist approval status.
* `vouchers`: Promotional discount codes and usage tracking.
* `orders`: Customer orders, payment status (`UNPAID`, `PAID`), and order status.
* `order_items`: Purchased line items linked to variants, with assigned serial box UUIDs.
* `cart_items`: Active customer shopping carts uniquely keyed by `(customer_id, variant_id)`.
* `reviews`: Customer product ratings, reviews, replies, and verified purchase status.
* `moderation_reports`: Abuse and content violation reporting on reviews.
* `moderation_audit_logs`: Audit trail of administrative moderation actions.
* `articles`: Health and pharmaceutical knowledge articles.

### 4. Procurement (`schemas/04_procurement_po.sql`)
* `purchase_orders`: Supplier purchase orders (PO) and fulfillment lifecycle.
* `purchase_order_items`: PO line items, unit costs, and generated total price.

### 5. Logistics & COD (`schemas/05_logistics_cod.sql`)
* `shipments`: Courier tracking numbers, shipping status, and COD settlement reconciliation.
* `internal_transfers`: Facility-to-facility fulfillment transfers linked to an order.

### 6. Fraud & Anomaly (`schemas/06_qr_fraud_anomaly.sql`)
* `qr_scan_logs`: Audit trail of all consumer QR scans with geolocation, IP, and risk scoring.
* `fraud_alerts`: Real-time anomaly alerts for velocity fraud (distance/time > realistic travel speed) and counterfeit clones.

### 7. CRM & Loyalty (`schemas/07_crm_loyalty_rma.sql`)
* `loyalty_point_logs`: Customer points ledger (`EARN`, `REDEEM`, `REDEEM_REVERSAL`, `RANK_BONUS`, `RMA_DEDUCTION`, `ADMIN_ADJUSTMENT`).

### 8. Finance (`schemas/08_finance_ar_ap.sql`)
* `cashbook_logs`: Inflow and outflow cashbook journal entries.
* `accounts_receivable`: Accounts Receivable (AR) ledger for customer orders.
* `accounts_payable`: Accounts Payable (AP) ledger for supplier procurement orders.

### 9. Prescription Review (`schemas/09_prescription_management.sql`)
* `orders.prescription_review_status`: Review workflow state on an order.
* `order_prescription_reviews`: Per-order pharmacist assignments and decisions. Grants and facility-scoped RLS are defined in `security/prescription/prescription_rls.sql`.

---

## Execution Order

Docker runs only the top-level `.sh` and `.sql` entrypoints, in filename order. SQL files in subdirectories are included explicitly:

1. `00_create_app_user.sh` runs `security/access/create_app_user.sql` to create `app_user`.
2. `00_master_init.sql` loads `schemas/01` through `schemas/08` (33 base tables).
3. `security/access/app_permissions.sql` grants base table access and configures default privileges for tables created by `postgres`.
4. `schemas/09_prescription_management.sql` creates the prescription review table and adds the order review column.
5. `seeds/01_seed_data.sql` imports the catalog, login accounts and facilities (no orders, stock or other transactions; customer points and tier are defaults) in a transaction with foreign-key and CHECK constraints enabled, restores exported sequence values, and advances any sequence that would collide with imported IDs.
6. `security/prescription/prescription_rls.sql` revokes inherited review-table privileges, grants the permitted review operations, and applies prescription policies.
7. `security/auth/auth_rls.sql` prepares auth roles, column grants and policies. It does not enable account RLS unless explicitly invoked with `auth_rls_activate=true`. Master never runs the rollback script.
8. `security/wishlist/wishlist_rls.sql` restricts `app_user` to SELECT/INSERT/DELETE and enables/forces customer ownership policies on `customer_wishlists`.
9. `security/cart/cart_rls.sql` enables/forces customer cart ownership; UPDATE is limited to quantity/variant, and sequence reset/TRUNCATE are not granted.
10. `security/review/review_rls.sql` enforces review/report/audit scopes.
11. `security/access/app_role_groups.sql` defines `public.app_role_in_group()`, then `security/order/order_rls.sql` enforces order ownership, fulfillment scope and loyalty ledger access.
12. `security/voucher/voucher_rls.sql` adds order voucher references and enforces voucher scopes and consumption rules.

All tables must exist before importing the seed. Review grants are explicitly restricted after import so blanket or default privileges cannot add DELETE/TRUNCATE access. The SQL files are intended to run as `postgres` through `psql`.

---

## Maintenance Notes

### Current logistics bootstrap versus existing-database upgrades

`00_master_init.sql` is only for an empty database. It sets the internal psql marker
`bootstrap_current_functions` and unsets it at the end. During this entrypoint,
intermediate definitions are skipped:

| Function | Historical definitions | Fresh bootstrap | Final source |
| --- | --- | --- | --- |
| `guard_order_write()` | 5 | 1 | `security/order/unpacked_customer_cancellation.sql` |
| `reconcile_shipment_cod(integer,numeric,numeric,numeric,numeric,text,text)` | 3 | 1 | `security/payment/cod_statement_approval.sql` |

The four `order_write_guard` triggers and their function privileges are installed
from `security/order/order_write_guard_trigger.sql` after the final guard exists.
Only the trusted bootstrap owner runs before that installation. Table DDL, other
triggers, policies, grants and constraints still execute in their original order.
The final COD function remains inaccessible to `app_user`; statement submission
and approval are the supported entrypoints.

This cleanup requires no migration on an existing database: function bodies and
runtime privileges are unchanged. Do not set `bootstrap_current_functions` when
applying security scripts or upgrades to an existing database. With the marker
unset, each historical script retains its original function replacement and
trigger installation behavior. Existing databases apply the domain scripts in
the order described in [LOGISTICS_WORKFLOWS.md](LOGISTICS_WORKFLOWS.md).
`security/logistics/in_transit_custody.sql` refuses active legacy transfers
without physically reconciled custody. Do not use master initialization to
update an existing volume or bypass that check.

Verification uses two disposable databases: the prior bootstrap followed by the
current domain security scripts, and the current bootstrap. Their complete schema-only
`pg_dump` output must match after removing only the random `\restrict` /
`\unrestrict` tokens. This compares functions, triggers, RLS policies, grants,
indexes and constraints, not only function bodies. Run both logistics DB
regression suites against each database. The suites allow the dedicated names
`codex_logistics_cleanup_fresh_20261110` and
`codex_logistics_cleanup_legacy_20261110` in addition to their original test names.
Development seed transfers without custody are unsuitable for the upgrade test;
remove those fixtures only in the disposable test database, never infer their
handoff in an application database.

### Order pickup status upgrade

For existing databases, back up and review the order write guard, then apply `security/order/order_pickup_status.sql` as the database owner before deploying the updated backend. The upgrade replaces only the order guard function; it does not rewrite existing order or shipment statuses. Existing orders already marked `SHIPPING` retain that status and continue through the legacy shipment flow.

```powershell
docker exec -i phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/order/order_pickup_status.sql
```

### Logistics workflow enhancements upgrade

Apply `security/logistics/logistics_workflow_enhancements.sql` as the database owner. It adds Proof of Delivery (PoD) columns to `shipments`, variance details and return fields to `internal_transfers`, gross/net fee breakdown and discrepancy tracking to `logistics_cod_settlements`, and updates `guard_order_write` and `transfer_order_state` to safely handle returns, transit custody, staff-recorded PoD, and partial transfers without leaking reservations or stock.

```powershell
docker exec -i phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/logistics/logistics_workflow_enhancements.sql
```


### Logistics integrity upgrade

After the logistics workflow enhancements script, apply `security/logistics/logistics_integrity.sql` as a trusted PostgreSQL superuser before deploying the updated services. It adds source-return policies, warehouse quarantine intake permissions and atomic COD reconciliation. Pending discrepancies have a NULL cashbook reference; app_user cannot directly write settlement rows. Both collection APIs share order/shipment locks. Settled statements are immutable on retry. The COD receivable and net cash script later changes the accounting representation to net cash received plus a separate non-cash courier fee record.

```powershell
docker exec -i phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/logistics/logistics_integrity.sql
```

Tracked transfer discrepancies require scanned good/damaged UID lists. Remaining assigned UIDs become LOST. Good units from a discrepant line return to available destination stock; the incomplete order line is unreserved and remains waiting for resolution. Its actual good/damaged/missing UIDs are retained in `variance_details`. Source TRANSFER_OUT excludes shortages, which are recorded separately as TRANSFER_LOSS.

### Cancellation safeguards upgrade

After the logistics integrity script, apply `security/order/cancellation_safeguards.sql` as the database owner. It restricts customer cancellation states, requires a new reason for staff cancellation, and restricts processing cancellation to the export facility manager or super admin. Cancellation of approved prescriptions is blocked until a pharmacist confirmation workflow is available. Generic status updates cannot mark orders refunded; a separate financial approval and payment record are required. Customer cancellation reasons and both approval workflows still require implementation.

After the cancellation safeguards script, apply `security/returns/return_intake_lines.sql` before deploying the updated return workflow. It records the actual received variants, quantities and UIDs. Existing returned shipments are not backfilled; their intake must be reconstructed from verified physical records before QA can proceed.

Apply `security/customer/customer_cancellation_reason.sql` before deploying customer cancellation with a selected reason. It records the reason in the same transaction as the cancellation.

Apply `security/payment/online_payment_gate.sql` to prevent dispatching internal transfers for unpaid online orders. This gate does not itself implement payment evidence or automatic expiration.

Apply `security/payment/payment_expiration.sql` before deploying the payment expiration job. New online orders awaiting consolidation remain `PENDING` until payment; unpaid e-wallet orders expire after 15 minutes and bank transfers after 30 minutes. The job releases reservations and reverses redeemed points and voucher usage. COD and orders already in `WAITING_INTERNAL_TRANSFER` are not expired. Existing waiting orders are not rewritten by the migration.

Apply `security/logistics/transfer_manifest.sql` before deploying the manifest-enabled transfer service. New dispatches require source counts and scans matching the reserved packages; existing dispatched transfers do not receive fabricated manifests.

Apply `security/returns/return_refund_decision.sql` and `security/returns/refund_approval_before_payment.sql` in order before deploying the return refund workflow. Financial approval creates a pending decision without a cashbook entry; recording the actual payment requires a reference and creates the expense and any points reversal atomically. The application records external payment evidence; it does not initiate a gateway transfer.

Apply `security/order/cancel_voucher_release.sql` together with the payment expiration script before deploying cancellation and expiration changes. It replaces the prescription-only voucher release trigger with one release on every transition to `CANCELLED`.

Apply `security/returns/return_authorized_items.sql` before deploying post-delivery return approvals with quantities. Intake must not exceed authorized quantities. Existing post-delivery returns are not backfilled; reconcile their authorizations from verified records before intake.

Apply `security/inventory/quarantine_balances.sql` before deploying quarantine movement changes. New entries record real before/after balances by facility and variant; failed QA remains in quarantine until a separate disposal or return action. Opening quarantine balances are not inferred from legacy logs. Reconcile existing quarantined stock from verified physical records before processing it through the new workflow.

Apply `security/payment/disable_unverified_cod_collection.sql` before exposing COD collection. New settlements require the carrier statement workflow; the legacy collection endpoint can only return an already recorded receipt.

Apply `security/payment/cancelled_payment_guard.sql` with the expiration workflow. It prevents marking a cancelled order paid; late incoming payments require separate reconciliation.

Apply `security/payment/cod_receivable_and_net_cash.sql` before deploying the updated COD workflow. New delivered COD shipments create a carrier receivable; clean reconciliation records the actual net remittance in cashbook and the deducted fee separately. Existing deliveries are not backfilled: reconcile their carrier receivables from verified evidence before settlement.

Apply `security/payment/online_payment_evidence.sql` before deploying the online payment evidence workflow. Accountants record the full amount and reference; finance managers approve or reject the evidence. The approval creates the cashbook receipt and marks the order paid atomically. Late, short and excess payments require separate reconciliation and are not silently applied to an order.

Apply `security/payment/cod_payment_evidence.sql` before deploying payment status changes. COD orders cannot be marked paid without a settled carrier reconciliation.

Apply `security/payment/cod_statement_approval.sql` and then `security/logistics/transfer_reroute.sql` before deploying their corresponding services. Rerouting is restricted to super administrators and atomically changes the order and transfer destinations only when the order has one dispatched transfer, no shipment, and all items remain reserved at its source. Other cases require return and replanning. Source-return logs use the `AVAILABLE` bucket for the change in stock less reservations; on-hand stock does not increase when a reservation is released.

Apply `security/access/app_role_groups.sql`, `security/logistics/logistics_rls.sql`, `transfer_manifest.sql`, `source_manifest_assignment.sql`, `stock_transfers.sql` and then `security/logistics/factory_stock_transfers.sql` before deploying factory stock transfers. They add the `WH_TRANSFER` role group so `FACTORY_WAREHOUSE_STAFF` can approve requests for its factory's stock and dispatch the resulting transfer (source side only; receiving, discrepancy resolution and order operations stay with warehouse roles). Do not re-run `security/order/order_rls.sql` on a live database: it would roll back later function definitions. `factory_stock_transfers.sql` carries only the two objects from it that changed.

Apply `security/inventory/factory_batch_void.sql` (as a trusted superuser, after `factory_batch_intake.sql` and `batch_sellability.sql`) before deploying the factory batch void action. It adds the `VOIDED` batch status and `public.void_factory_batch()`, which takes an untouched factory batch out of stock, keeps the batch row for audit and records the reason in `batch_status_events`. A batch whose boxes were scanned, reserved, packed, transferred, received or disposed of cannot be voided. Verify with `tests/factory_batch_void_test.sql`.

QA requires every returned variant, disjoint UID groups belonging to the order, and QUARANTINED custody at the export facility. Intake, source-return receipt and QA serialize before reading mutable state. The logistics pages expose inspection, halt/source return, delivery evidence, post-delivery return approval, quarantine intake, QA and carrier-statement reconciliation.

Run `tests/logistics_integrity_test.sql` with psql against a disposable initialized database. For real service concurrency tests, set `LOGISTICS_TEST_DATABASE_URL` to an owner connection to a database named exactly `codex_logistics_integrity_test`, then run `npm test -- --runInBand logistics-database.integration.spec.ts` in the backend. Services connect under app_user; fixtures use the owner connection. The integration suite creates synthetic records; discard the test database afterward.


- Keep schema changes consistent with `pharmatrace-vn-backend/prisma/schema.prisma`.
- Prescription RLS is scoped to the current prescription workflow; this setup does not provide database-wide tenant isolation.
- The seed contains synthetic account and personal fields alongside catalog and operational fixtures. Foreign-key triggers remain enabled during import. It is not a production provisioning script.
- Some seed text already contains corrupted characters. Repair it from a verified source rather than guessing replacements.
- Existing databases need an explicit upgrade procedure for schema changes, including the `REDEEM_REVERSAL` constraint and review grants. Editing bootstrap files alone does not update an existing Docker volume.

## Cart RLS

Cart RLS is automatically enforced on new Docker databases through `security/cart/cart_rls.sql`. It is independent of `AUTH_RLS_ENABLED`; configure authentication to match the account policies installed on the target database.

- Only customer context with matching customer ID can SELECT/INSERT/UPDATE/DELETE cart rows. Missing context and employee identities are denied, even if their numeric IDs match customers.
- Runtime may insert customer/variant/quantity/timestamp, update only variant/quantity, and use the cart sequence. It cannot change ownership/row IDs, TRUNCATE, or reset the sequence.
- Every cart operation, helper query and returned cart read uses the same actor transaction. Sync and variant switches do not start nested, unscoped transactions.
- Checkout now carries customer context for both prescription and non-prescription orders, so purchased cart rows are deleted only for the buyer.
- Existing quantity, sync-max, pricing and stock-display rules are retained. Variant switching still checks live stock minus reservations. This change does not implement inventory RLS or solve the existing concurrent read/modify/write quantity races.

For an existing database, deploy the new cart **and checkout** backend first, back up/review existing policies and grants, then apply only this file as owner. Docker will not rerun init scripts for existing volumes. Old unscoped code could return an empty cart or leave purchased cart rows behind.

```powershell
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/security/cart/cart_rls.sql'
```

The script runs in a transaction, can be reapplied, refuses unknown cart policies and does not delete cart data. `tests/cart_rls_test.sql` verifies SQL allow/deny behavior using temporary fixtures and rolls them back; sequence increments are not rolled back. These changes do not automatically modify the developer's local database.

### Cart integration test

Run these PowerShell commands from the repository root, using a disposable database only:

```powershell
docker run --detach --name pharmatrace-cart-rls-test --publish 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data -e POSTGRES_PASSWORD=cart_test_owner_only -e APP_DB_PASSWORD=cart_test_app_only -e POSTGRES_DB=pharmatrace_cart_rls_test --mount "type=bind,source=$($PWD.Path)\database,target=/docker-entrypoint-initdb.d,readonly" postgres:15-alpine
docker logs pharmatrace-cart-rls-test
```

Wait for `PostgreSQL init process complete; ready for start up.`, then run:

```powershell
docker exec pharmatrace-cart-rls-test psql -X -v ON_ERROR_STOP=1 -U postgres -d pharmatrace_cart_rls_test -f /docker-entrypoint-initdb.d/tests/cart_rls_test.sql
$cartTestPort = (docker port pharmatrace-cart-rls-test 5432).Split(':')[-1]
$env:CART_RLS_TEST_DATABASE_URL = "postgresql://app_user:cart_test_app_only@127.0.0.1:$cartTestPort/pharmatrace_cart_rls_test"
$env:CART_RLS_TEST_ADMIN_URL = "postgresql://postgres:cart_test_owner_only@127.0.0.1:$cartTestPort/pharmatrace_cart_rls_test"
$env:CART_RLS_TEST_AUTH_ENABLED = 'false'
Push-Location pharmatrace-vn-backend
npm.cmd run test:e2e -- --runInBand --runTestsByPath test/cart-rls.e2e-spec.ts
Pop-Location
```

The suite uses explicit localhost test URLs with that exact database name, never `.env` as a target. Without URLs it is skipped. It checks actual HTTP/JWT/Prisma/PostgreSQL behavior: ownership, same-ID employees, totals, quantities, sync, variant switch/merge/stock failures, clear/delete, forbidden direct writes, rollback and non-prescription checkout cart cleanup. Fixtures include synthetic accounts, products and stock, and are cleaned up after testing.

To test cart with account RLS, use a disposable database with the current auth, customer and employee policies, set `CART_RLS_TEST_AUTH_ENABLED=true` and rerun. Do not run suites concurrently against this database.

```powershell
docker rm --force pharmatrace-cart-rls-test
Remove-Item Env:CART_RLS_TEST_DATABASE_URL, Env:CART_RLS_TEST_ADMIN_URL, Env:CART_RLS_TEST_AUTH_ENABLED
```

## Wishlist RLS

Wishlist RLS is enabled automatically on a new Docker database, independently of `AUTH_RLS_ENABLED`. Configure the authentication flag to match the account policies installed on the target database.

`security/wishlist/wishlist_rls.sql` permits only a customer context (`app.current_user_type=customer`, `app.current_user_role=CUSTOMER`) whose ID matches `customer_wishlists.customer_id`:

- SELECT/INSERT/DELETE apply only to that customer's rows. Missing context and employee context see no rows and cannot insert.
- UPDATE and TRUNCATE are not granted. Duplicate adds use INSERT with conflict-ignore rather than an UPDATE/upsert.
- List, count, search, pagination, single/batch checks and writes run through the same actor transaction in `WishlistService`. Medicine and packaging reads remain part of that transaction.
- No database superuser or `BYPASSRLS` connection may be used for these runtime queries. The bootstrap owner is separate from `app_user`.

The script does not change account or catalog RLS, product visibility, or existing stock display behavior. Its context comes from the authenticated server; it does not protect against someone who already holds backend database credentials and can send arbitrary SQL.

### Existing database

Docker does not rerun init scripts for existing volumes. Deploy the updated wishlist backend before applying the SQL; older code without actor context would receive empty results or denied writes. Back up the current policy/grants and test on a copy first. The script is transactional, can be reapplied, and refuses unknown wishlist policies rather than combining them with potentially broader access. It does not delete seed or customer rows.

After deploying the compatible backend, an owner can apply just this script without resetting the volume:

```powershell
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/security/wishlist/wishlist_rls.sql'
```

Run `tests/wishlist_rls_test.sql` as owner for standalone allow/deny checks. It creates temporary customer fixtures, uses the runtime role for assertions and rolls back the data. Sequence advancement is not rolled back. This work does not apply the SQL to the developer's existing database automatically.

### Wishlist HTTP integration test

Use a separate disposable database. These PowerShell commands start at the repository root:

```powershell
docker run --detach --name pharmatrace-wishlist-rls-test --publish 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data -e POSTGRES_PASSWORD=wishlist_test_owner_only -e APP_DB_PASSWORD=wishlist_test_app_only -e POSTGRES_DB=pharmatrace_wishlist_rls_test --mount "type=bind,source=$($PWD.Path)\database,target=/docker-entrypoint-initdb.d,readonly" postgres:15-alpine
docker logs pharmatrace-wishlist-rls-test
```

Wait for `PostgreSQL init process complete; ready for start up.`, then:

```powershell
$wishlistTestPort = (docker port pharmatrace-wishlist-rls-test 5432).Split(':')[-1]
$env:WISHLIST_RLS_TEST_DATABASE_URL = "postgresql://app_user:wishlist_test_app_only@127.0.0.1:$wishlistTestPort/pharmatrace_wishlist_rls_test"
$env:WISHLIST_RLS_TEST_ADMIN_URL = "postgresql://postgres:wishlist_test_owner_only@127.0.0.1:$wishlistTestPort/pharmatrace_wishlist_rls_test"
$env:WISHLIST_RLS_TEST_AUTH_ENABLED = 'false'
Push-Location pharmatrace-vn-backend
npm.cmd run test:e2e -- --runInBand --runTestsByPath test/wishlist-rls.e2e-spec.ts
Pop-Location
```

The suite requires those explicit localhost URLs and the database name above; it never uses `.env` as a test target. Without test URLs the suite is skipped, not verified. It tests HTTP, JWT, Prisma, cross-customer isolation, employee rejection, product relations, pagination/search/count, batch checks, duplicate-add concurrency, delete idempotence, forbidden database writes and context cleanup after rollback.

To test wishlist with account RLS, use a disposable database with the current auth, customer and employee policies, set `WISHLIST_RLS_TEST_AUTH_ENABLED=true`, and rerun. No other integration suite should share this test database concurrently.

After testing:

```powershell
docker rm --force pharmatrace-wishlist-rls-test
Remove-Item Env:WISHLIST_RLS_TEST_DATABASE_URL, Env:WISHLIST_RLS_TEST_ADMIN_URL
Remove-Item Env:WISHLIST_RLS_TEST_AUTH_ENABLED -ErrorAction SilentlyContinue
```

## Auth RLS rollout

Implementation branch: `feature/auth-rbac`. Date: 2026-10-25.

### Rollout status

**Docker automatically prepares auth roles and policies for new databases** through `security/auth/auth_rls.sql`, called by master initialization. The auth RLS script alone does not ENABLE/FORCE account RLS by default; master initialization later applies the employee and customer RLS scripts, which enable it. Configure the backend authentication flag for the deployed database policies.

Policy preparation and enforcement activation are separate steps. Prescription enforcement can run because its workflow has been adapted; customers/employees are still used by modules without the required context. Do not delete an existing data volume to force Docker initialization to run again.

Activate enforcement on the shared database only after the remaining modules use the appropriate context and roles. Do not add unrestricted table policies to avoid errors, as that would defeat the intended isolation.

#### Before enforcement is enabled

- Auth distinguishes customers from employees when reading/updating profiles and passwords, including accounts with matching numeric IDs.
- JWTs require valid type/role claims and accounts are checked in the database on every request. Locked accounts or role/facility changes cause existing tokens to be rejected.
- `ADMIN` no longer bypasses endpoint role lists; `SUPER_ADMIN` must also be listed explicitly. Aliases are normalized against the supported roles.
- Cart, wishlist, customer order and customer review operations have guards that enforce the correct account type.
- `POST /admin/auth/setup` returns 410 without writing to the database. Provision the initial administrator through the DBA process; the development seed provides demo accounts.
- `JWT_SECRET` is required; the code has no fallback secret. Tokens without a type claim require the user to log in again.
- Auth transactions carry context but still use the existing connection role. Account RLS is not yet enforced at the database layer.

#### After enforcement is enabled on a configured database

`withAuth()` verifies that the role is not a superuser, does not have BYPASSRLS, does not own the tables, and that both account tables have ENABLE + FORCE RLS. Incomplete setup returns 503 instead of reverting to broader access. The transaction then uses `SET LOCAL ROLE auth_runtime` and sets every context field, including empty values for missing fields.

| Operation | Database access for `auth_runtime` |
|---|---|
| No actor and not a login/register operation | No account rows are visible |
| Customer login | Only the row matching the phone/email being checked |
| Employee login | Only the row matching the email being checked |
| Registration | Insert only five profile/credential columns with matching phone context; points/tier/status use defaults and are restricted by CHECK policies |
| Profile/password | Only the matching account type + ID; UPDATE is granted only for profile/password columns |
| Role/facility/status/points/ID | No permission to change these fields or assign them during insertion |
| Create/delete employees, delete customers, TRUNCATE | Not granted |

Auth does not use `SECURITY DEFINER` or database functions that return credentials. The backend reads credentials through parameterized, scoped login queries; HTTP responses do not contain hashes. The auth role can SELECT facility data to build employee profiles; this does not implement authorization for the entire facility module.

Custom settings are context supplied by the trusted server, not independent proof of identity. End users must not receive database credentials or permission to execute arbitrary SQL.

### Testing on a separate database

Run the following PowerShell commands from the repository root. The test database uses a separate temporary container/volume; do not substitute the application database name.

```powershell
docker run --detach --name pharmatrace-auth-rls-test --publish 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data -e POSTGRES_PASSWORD=auth_test_owner_only -e APP_DB_PASSWORD=auth_test_app_only -e POSTGRES_DB=pharmatrace_auth_rls_test --mount "type=bind,source=$($PWD.Path)\database,target=/docker-entrypoint-initdb.d,readonly" postgres:15-alpine
docker logs pharmatrace-auth-rls-test
```

Wait for `PostgreSQL init process complete; ready for start up.`. Check the fixtures before the tests create accounts:

```powershell
docker exec pharmatrace-auth-rls-test psql -X -v ON_ERROR_STOP=1 -U postgres -d pharmatrace_auth_rls_test -f /docker-entrypoint-initdb.d/tests/development_seed_test.sql
docker exec pharmatrace-auth-rls-test psql -X -v ON_ERROR_STOP=1 -v auth_rls_activate=true -U postgres -d pharmatrace_auth_rls_test -f /docker-entrypoint-initdb.d/security/auth/auth_rls.sql

$authTestPort = (docker port pharmatrace-auth-rls-test 5432).Split(':')[-1]
$env:AUTH_RLS_TEST_DATABASE_URL = "postgresql://app_user:auth_test_app_only@127.0.0.1:$authTestPort/pharmatrace_auth_rls_test"
$env:AUTH_RLS_TEST_ADMIN_URL = "postgresql://postgres:auth_test_owner_only@127.0.0.1:$authTestPort/pharmatrace_auth_rls_test"

Push-Location pharmatrace-vn-backend
npm.cmd test -- --runInBand --runTestsByPath src/common/guards/roles.guard.spec.ts src/modules/auth/strategies/jwt.strategy.spec.ts src/prisma/prisma.service.spec.ts
npm.cmd run test:e2e -- --runInBand --runTestsByPath test/auth-rls.e2e-spec.ts
Pop-Location
```

E2E requires two explicit test URLs and accepts only localhost with the database name `pharmatrace_auth_rls_test`; it does not use `.env` as the target. Tests use real HTTP, Prisma and PostgreSQL, create/delete their own fixtures, and check lookups, row/column access, matching account IDs, stale tokens, passwords, registration, rollback context and concurrent requests. Without test variables, the suite is skipped; this is not a passing integration result.

Do not run other integration suites concurrently against this database: the tests temporarily change FORCE RLS and restore it to verify fail-closed behavior.

### Prerequisites for shared-database activation

- [ ] Finalize roles and business permissions; changing `ADMIN` does not complete authorization for every service.
- [ ] Move customer/employee queries in checkout, customer/employee management, reviews, facilities, cron and remaining modules to their designed access paths.
- [ ] Inspect the shared runtime role: it still has broad baseline grants. The auth script does not revoke all of them. A shared role with arbitrary actor context is not a replacement for operation-specific authorization.
- [ ] Inventory ownership, grants and policies on the target database. The script rejects unmanaged account policies, RLS enabled outside the script, and unexpectedly broad auth-role privileges.
- [ ] Establish a tracked SQL upgrade process for existing databases. Docker initialization does not upgrade existing volumes, and the script does not write `_prisma_migrations` records.
- [ ] Back up and test restoration; record the RLS/policy baseline. The rollback script supports only the pre-auth baseline with account RLS disabled.
- [ ] Run all regression and E2E suites for dependent modules on a copy of the target database.
- [ ] Configure a dedicated `JWT_SECRET`, not a sample value. Users must log in again to receive valid claims.

**Setting `AUTH_RLS_ENABLED=true` does not enable table RLS by itself. Running SQL alone does not migrate every module to the new role/context. Deploy both using the verified procedure.**

### Apply and roll back

Run `security/auth/auth_rls.sql` as owner/DBA. Without the activation flag, it prepares only the NOLOGIN role, column grants and policies. With `-v auth_rls_activate=true`, it also enables/forces RLS. There is no unrestricted compatibility policy. On reapplication, it checks and replaces only its own policies; it does not replace unknown policies or disable existing enforcement.

Proceed only after completing the checklist, during a controlled deployment. Monitor errors and unexpected empty results, since RLS can filter rows without producing SQL errors.

The rollback script is `security/auth/auth_rls_rollback.sql`, requires `-v auth_rls_rollback=true`, and is never called by master. It restores disabled RLS on the two account tables without deleting data or accounts. **Rollback restores broader baseline access**; it is not an automatic fallback and must not be used on a database with a different RLS design. The script refuses unknown policies and retains the NOLOGIN role to preserve dependencies.

To roll back: stop relevant traffic/jobs, set `AUTH_RLS_ENABLED=false`, apply the rollback script against the saved baseline, restart, and smoke test. Setting the flag to false alone does not disable database RLS; running the rollback while the flag remains true makes auth return 503.

Test rollback/reactivation on the test container, not the local application database:

```powershell
docker exec pharmatrace-auth-rls-test psql -X -v ON_ERROR_STOP=1 -v auth_rls_rollback=true -U postgres -d pharmatrace_auth_rls_test -f /docker-entrypoint-initdb.d/security/auth/auth_rls_rollback.sql
docker exec pharmatrace-auth-rls-test psql -X -v ON_ERROR_STOP=1 -v auth_rls_activate=true -U postgres -d pharmatrace_auth_rls_test -f /docker-entrypoint-initdb.d/security/auth/auth_rls.sql
```

After testing:

```powershell
docker rm --force pharmatrace-auth-rls-test
Remove-Item Env:AUTH_RLS_TEST_DATABASE_URL, Env:AUTH_RLS_TEST_ADMIN_URL
```

### Limitations and follow-up work

- This provides independently tested auth/RBAC foundations and account policies, not end-to-end authorization for the entire application.
- Password changes do not revoke every issued JWT. Logout requires the client to discard its token; this rollout has no token blacklist or token versioning. Account locks and role/facility changes are checked on every request.
- Employee details in public facility APIs, customer-management scope and dedicated admin-order context require work in their respective branches.
- Employee administration must not use the auth role intended for personal profile updates; the employee module needs its own principal/permission design.
- Keep `database/*.sh` files at LF through `.gitattributes` so Windows checkout does not break Linux initialization.

## Review RLS

`security/review/review_rls.sql` enables/forces RLS on `reviews`, `moderation_reports` and `moderation_audit_logs`. Master calls it automatically when Docker initializes a new volume. The backend continues using `app_user`, without new role memberships or `SECURITY DEFINER` functions.

| User | Access |
|---|---|
| Public | Read APPROVED reviews, statistics and product-detail reviews; helpful operations update only APPROVED review counters |
| Customer | Read own history; create reviews for matching DELIVERED/COMPLETED purchases; edit/delete own reviews; submit reports and read only own reports |
| STORE_MANAGER / PHARMACIST | Read all review statuses and reply; cannot change status, delete reviews, or view reports/audit; list responses omit customer email/phone |
| ADMIN / SUPER_ADMIN | Read, reply, approve/hide/mark spam/delete reviews; view and resolve reports; read audit logs |
| Other employee roles | Cannot access review administration or use matching customer IDs to access customer history |

Staff permissions apply system-wide, preserving the scope declared in the controllers; reviews do not have facility assignments. Public access can read APPROVED reviews without context; all writes and moderation reads require the appropriate scope. `withReview()` sets transaction-local context with `set_config(..., true)`, verifies that runtime is not a superuser/BYPASSRLS/table owner, and checks RLS on all three tables. Incomplete setup returns 503. Custom settings remain trusted backend context and do not protect against someone with `app_user` credentials or arbitrary SQL access.

Column grants and an invoker trigger prevent customers from modifying staff replies, ordinary staff from changing review status, and helpful operations from modifying content. Customer edits to reviews that are not APPROVED still require administrator approval; safe new reviews can still be approved by the existing automated moderation pipeline. Review/report mutations and audit writes share one transaction; audit failure rolls back the mutation. The app cannot UPDATE/DELETE/TRUNCATE audit logs. Deleting a review preserves audit rows with `review_id = NULL` and the original ID in `meta.reviewId`; old audit metadata is retained, and previously cascade-deleted records are not recovered.

### Existing database

The seed and review eligibility checks use uppercase `DELIVERED`/`COMPLETED`. The review RLS script does not update order statuses; legacy data found in other environments must be reconciled and normalized separately before deployment.

Do not rerun master/seed or delete the volume. Back up the database, test restoration, and try the script on a copy first. Stop relevant backend/jobs, apply the following file as owner/DBA, then start the backend with code from the same branch and smoke test the access matrix above:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/review/review_rls.sql
```

Use container/database names matching your environment. The script is transactional, can be reapplied, and rejects unknown policies or audit foreign keys for manual review. Changing the audit FK to SET NULL may wait for table locks; allow an appropriate maintenance window. Rolling back only the code is unsafe because old code does not supply review write context. If rollback is needed, stop traffic and restore matching code/grants/FKs/policies from the saved baseline; do not disable RLS automatically on errors.

Use the backend authentication configuration that matches the deployed account policies and test review visibility on a disposable database.

### Review-specific testing

Run from the repository root and wait for `PostgreSQL init process complete` before testing:

```powershell
docker run --detach --name pharmatrace-review-rls-test --publish 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data -e POSTGRES_PASSWORD=review_test_owner_only -e APP_DB_PASSWORD=review_test_app_only -e POSTGRES_DB=pharmatrace_review_rls_test --mount "type=bind,source=$($PWD.Path)\database,target=/docker-entrypoint-initdb.d,readonly" postgres:15-alpine
docker logs pharmatrace-review-rls-test

docker exec pharmatrace-review-rls-test psql -X -v ON_ERROR_STOP=1 -U postgres -d pharmatrace_review_rls_test -f /docker-entrypoint-initdb.d/tests/development_seed_test.sql -f /docker-entrypoint-initdb.d/tests/review_rls_test.sql
$reviewTestPort = (docker port pharmatrace-review-rls-test 5432).Split(':')[-1]
$env:REVIEW_RLS_TEST_DATABASE_URL = "postgresql://app_user:review_test_app_only@127.0.0.1:$reviewTestPort/pharmatrace_review_rls_test"
$env:REVIEW_RLS_TEST_ADMIN_URL = "postgresql://postgres:review_test_owner_only@127.0.0.1:$reviewTestPort/pharmatrace_review_rls_test"
Push-Location pharmatrace-vn-backend
npm.cmd test -- --runInBand
npm.cmd run test:e2e -- --runInBand --runTestsByPath test/review-rls.e2e-spec.ts
Pop-Location

docker rm --force pharmatrace-review-rls-test
Remove-Item Env:REVIEW_RLS_TEST_DATABASE_URL, Env:REVIEW_RLS_TEST_ADMIN_URL
```

E2E accepts only the disposable localhost database named `pharmatrace_review_rls_test`; missing environment variables skip the suite rather than verify integration. It checks public/customer access, same-ID employees, moderators, purchase eligibility, reports/APPROVE, helpful votes, audit retention after deletion, rollback on audit failure, pooled connection context and 503 responses when FORCE RLS is missing. Do not run another suite concurrently against this database because the tests temporarily disable and restore FORCE. SQL tests use a transaction and ROLLBACK fixture data.

Helpful votes and rate limits still use IP/process-local memory; they do not provide vote-fraud prevention or synchronization across backend instances. Cloudinary image upload remains unchanged and is not called by this integration suite.

## Order / checkout RLS

`security/order/order_rls.sql` enables/forces RLS on `orders`, `order_items`, `shipments`, `internal_transfers` and `loyalty_point_logs`. It adds no logins/memberships and uses neither `BYPASSRLS` nor `app.bypass_rls`. `withOrder()` checks the runtime role and protection on all five tables; incomplete setup returns 503. Each transaction sets operation, user ID/type/role and facility through local settings, which are cleared at commit/rollback.

| Actor | Scope |
|---|---|
| Customer | Read own orders/items/shipments/transfers/points; checkout creates own orders; cancel only PENDING or WAITING_INTERNAL_TRANSFER orders |
| STORE_MANAGER / PHARMACIST / WAREHOUSE_STAFF | Read orders assigned to their `export_facility_id` |
| STORE_MANAGER / PHARMACIST | Change order status at the assigned facility according to the state machine; only pharmacists or SUPER_ADMIN can decide prescription reviews |
| STORE_MANAGER / PHARMACIST / WAREHOUSE_STAFF | Pack at the fulfillment facility and confirm UIDs for serialized medicine packages |
| STORE_MANAGER / WAREHOUSE_STAFF | Dispatch at the source; receive/reject damaged goods and create replacement transfers at the destination |
| SUPER_ADMIN | Perform order administration across the system under existing guards |
| Internal loyalty job | Read COMPLETED orders for eligibility and write the correct EARN amount; cannot modify orders or delete ledger rows |

`ADMIN` is not listed in the current order guards; its name does not grant global access. Review moderator scope does not grant order administration rights.

Source warehouses cannot read orders fulfilled by another facility or their prescriptions. Transfer list/dispatch responses omit nested `orders`. Two `SECURITY DEFINER` functions provide narrow projections: `transfer_order_state()` returns order/review statuses needed to dispatch the warehouse's own transfer; `product_has_order_history()` returns a boolean to prevent hard deletion of medicines with order history at other facilities. Both use a fixed search_path, check context, fully qualify table names, and revoke PUBLIC execution. Create them as a trusted DBA (the commands below use postgres); do not transfer ownership to app_user.

Column grants and triggers block changes to customer/facility, prices, totals, payment status through cancellation, and prescription status through the order API. The app cannot DELETE/TRUNCATE order tables or UPDATE/DELETE ledger rows. Point redemption/refunds/awards share a transaction with their associated operation; order locks and a unique EARN index per order prevent duplicate cron awards. Conditional transfer receipt prevents duplicate stock movements, and packing locks the order to prevent duplicate shipments.

The ledger constraint adds `EARN_REVERSAL`, which the backend already uses for returns. If the target contains multiple EARN/EARNED records for one order or unsupported transaction types, the script stops and rolls back. Reconcile those records first; do not delete ledger entries automatically.

Dependent queries also carry identity: customer-management order history/statistics, prescription decisions and medicine-deletion history checks. GET order details no longer creates prescription review rows; legacy orders missing reviews require a verified DBA backfill before rollout. Checkout continues creating prescription reviews within its transaction.

### Applying to an existing database

Back up and test restoration, then run tests against a copy. Stop relevant backend/jobs, apply as owner/DBA, then start matching backend code and smoke test checkout, cancellation, packing, transfers, prescriptions and cron:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/order/order_rls.sql
```

Use container/database names matching your environment. The script is transactional, refuses unknown policies and can be reapplied. It replaces the two earlier prescription order policies with shared order policies; do not rerun only `prescription_rls.sql` after this rollout. Do not rerun master/seed or delete the volume to upgrade. New volumes receive the order RLS script from master after the preceding scripts.

This script does not enable RLS for inventories/medicine boxes, vouchers or account/point balances; checkout still needs their existing baseline grants. Context is supplied by the trusted server and does not protect against someone holding app_user credentials or executing arbitrary SQL. This is not complete database-wide authorization. To roll back, stop traffic/jobs and restore matching code/policies/grants/constraints from the saved baseline; do not disable RLS automatically to bypass errors.

### Testing on a separate database

From the repository root, create a temporary container and wait for `PostgreSQL init process complete`:

```powershell
docker run --detach --name pharmatrace-order-rls-test --publish 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data -e POSTGRES_PASSWORD=order_test_owner_only -e APP_DB_PASSWORD=order_test_app_only -e POSTGRES_DB=pharmatrace_order_rls_test --mount "type=bind,source=$($PWD.Path)\database,target=/docker-entrypoint-initdb.d,readonly" postgres:15-alpine
docker logs pharmatrace-order-rls-test
docker exec pharmatrace-order-rls-test psql -X -v ON_ERROR_STOP=1 -U postgres -d pharmatrace_order_rls_test -f /docker-entrypoint-initdb.d/tests/development_seed_test.sql -f /docker-entrypoint-initdb.d/tests/order_rls_test.sql

$orderTestPort = (docker port pharmatrace-order-rls-test 5432).Split(':')[-1]
$env:ORDER_RLS_TEST_DATABASE_URL = "postgresql://app_user:order_test_app_only@127.0.0.1:$orderTestPort/pharmatrace_order_rls_test"
$env:ORDER_RLS_TEST_ADMIN_URL = "postgresql://postgres:order_test_owner_only@127.0.0.1:$orderTestPort/pharmatrace_order_rls_test"
Push-Location pharmatrace-vn-backend
npm.cmd test -- --runInBand
npm.cmd run test:e2e -- --runInBand --runTestsByPath test/order-rls.e2e-spec.ts
Pop-Location

docker rm --force pharmatrace-order-rls-test
Remove-Item Env:ORDER_RLS_TEST_DATABASE_URL, Env:ORDER_RLS_TEST_ADMIN_URL
```

The suite accepts only the localhost database named `pharmatrace_order_rls_test`; missing test variables skip the suite rather than verify integration. Do not run another suite concurrently on the same database: tests temporarily revoke ledger grants or disable FORCE to check rollback/fail-closed behavior, restoring them in finally blocks. Tests use GPS fixtures and do not call external geocoding/Cloudinary services. SQL tests roll back fixture data; HTTP tests clean up their own fixtures.

## Voucher RLS

`security/voucher/voucher_rls.sql` also creates the partial unique index `orders_one_voucher_per_customer` on `orders(customer_id, voucher_id)`, so each account can use a voucher once; cancelled orders keep their `voucher_id`, so they still consume it. Reconcile existing duplicate `(customer_id, voucher_id)` rows before applying. Customers list selectable vouchers through the `available` scope.

`security/voucher/voucher_rls.sql` enables and forces RLS on `vouchers`, independently of `AUTH_RLS_ENABLED`. It uses the existing `app_user`, invoker functions and an update trigger; no additional login, role membership or `SECURITY DEFINER` function is introduced.

| Actor / operation | Access |
|---|---|
| Public `POST /vouchers/validate` | Read only the exact supplied code, case-insensitively; the service checks status, dates, capacity and subtotal and returns the discount preview without consuming usage |
| SUPER_ADMIN / STORE_MANAGER | List, create and edit global vouchers; delete only unused vouchers without order history; never directly edit the usage counter |
| PHARMACIST | Read-only voucher administration |
| Other employee roles, ADMIN, customers | No voucher administration under the current endpoint role lists |
| Customer checkout | Lock the selected voucher, create an owned order, and increment only its usage counter within the same transaction |

Vouchers have no facility ownership column, so management remains global. No facility or per-customer eligibility model is inferred from the employee role. `withVoucher()` validates the actor and scope, verifies ENABLE/FORCE and the restricted runtime role, and sets transaction-local code/scope/identity context. Missing protection returns 503. Public previews cannot list other codes or modify rows. Invalid or inactive codes keep the existing 404/400 responses.

`POST /vouchers/apply` now returns **410 Gone**. The checkout page already uses `/vouchers/validate`; its unused standalone-consumption helper has been removed. Consumers outside this repository must preview through validate and place orders through `POST /orders`.

`orders.voucher_id` records the voucher used by new orders, with a RESTRICT foreign key. Existing orders keep NULL because their original voucher cannot be inferred reliably from a discount amount. The trigger permits checkout to change only `used_quantity`, by exactly +1, for a matching owned PENDING/WAITING_INTERNAL_TRANSFER order with the correct subtotal and discount. Checkout rejects unavailable or changed voucher terms and rolls back stock, points, cart cleanup, the order and consumption together when any write fails. Concurrent checkouts cannot exceed the usage limit. Cancellation continues to retain the consumed use, as before; this change does not add per-customer limits or make order placement idempotent.

Every voucher requires a start and end date in chronological order; percentage discounts also require a positive maximum discount. Fixed discounts do not require a cap. Before applying 09 to an existing database, reconcile vouchers missing dates or a positive percentage cap; the script fails without modifying data if any are invalid. Management validates percentage bounds, dates and capacity, cannot reduce the limit below existing usage, and cannot reset the counter. Deactivate used vouchers instead of deleting them. A normalized-code unique index prevents duplicate codes differing only in case or surrounding spaces. Existing duplicate codes or invalid terms stop the script for reconciliation rather than being silently rewritten. Runtime cannot TRUNCATE vouchers, change IDs, or reset their sequence.

### Existing-database deployment

Back up and test restoration, inspect existing policies/data, and run the suites on a copy first. Stop the backend/jobs, apply the SQL as owner/DBA, generate the Prisma client, then start the matching backend and smoke test preview, administration and checkout:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/voucher/voucher_rls.sql
Push-Location pharmatrace-vn-backend
npx prisma generate
Pop-Location
```

Use the correct container/database names. Deploy this script after 08: it also grants order insertion of `voucher_id`, which the earlier order grant list does not include. The script is transactional, can be reapplied, and refuses unknown voucher policies or an incompatible existing voucher FK. Do not rerun master/seed or reset the volume. New volumes receive 09 automatically from master. Old code performs unscoped voucher queries and must not serve traffic after enforcement; new code requires the new column and policies. Roll back code/schema/grants/policies together from a saved baseline rather than automatically disabling RLS. Configure backend authentication to match the deployed account policies.

### Isolated voucher tests

Run from the repository root and wait for `PostgreSQL init process complete` before testing:

```powershell
docker run --detach --name pharmatrace-voucher-rls-test --publish 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data -e POSTGRES_PASSWORD=voucher_test_owner_only -e APP_DB_PASSWORD=voucher_test_app_only -e POSTGRES_DB=pharmatrace_voucher_rls_test --mount "type=bind,source=$($PWD.Path)\database,target=/docker-entrypoint-initdb.d,readonly" postgres:15-alpine
docker logs pharmatrace-voucher-rls-test
docker exec pharmatrace-voucher-rls-test psql -X -v ON_ERROR_STOP=1 -U postgres -d pharmatrace_voucher_rls_test -f /docker-entrypoint-initdb.d/tests/development_seed_test.sql -f /docker-entrypoint-initdb.d/tests/voucher_rls_test.sql

$voucherTestPort = (docker port pharmatrace-voucher-rls-test 5432).Split(':')[-1]
$env:VOUCHER_RLS_TEST_DATABASE_URL = "postgresql://app_user:voucher_test_app_only@127.0.0.1:$voucherTestPort/pharmatrace_voucher_rls_test"
$env:VOUCHER_RLS_TEST_ADMIN_URL = "postgresql://postgres:voucher_test_owner_only@127.0.0.1:$voucherTestPort/pharmatrace_voucher_rls_test"
Push-Location pharmatrace-vn-backend
npm.cmd test -- --runInBand
npm.cmd run test:e2e -- --runInBand --runTestsByPath test/voucher-rls.e2e-spec.ts
Pop-Location

docker rm --force pharmatrace-voucher-rls-test
Remove-Item Env:VOUCHER_RLS_TEST_DATABASE_URL, Env:VOUCHER_RLS_TEST_ADMIN_URL
```

The suite requires explicit localhost URLs and the exact database name `pharmatrace_voucher_rls_test`; it does not use `.env` as a target. Without test URLs it skips rather than verifies integration. It covers role boundaries, exact-code reads, standalone-consumption rejection, terms, duplicate codes, capped discounts, last-use concurrency, stale configuration, atomic rollback, order linkage, protected columns and fail-closed behavior. Do not run another suite on the same database concurrently: one test temporarily revokes ledger grants and another temporarily disables FORCE, restoring both in finally blocks.

Securability notes: **Confidentiality** limits public reads to a supplied code; **Integrity** binds consumption to checkout and protects counters; **Testability** verifies both allowed and denied paths with the real runtime role. Context remains trusted server data, not independent authentication against someone with backend database credentials or arbitrary SQL access.

## Facility RLS

`security/facility/facility_rls.sql` enables and forces RLS on `facilities`. Existing public facility reads remain available to the application and auth runtime. Facility creation, update and deletion require an authenticated SUPER_ADMIN through transaction-local context; the application checks that RLS is enabled and forced before writes. The runtime cannot truncate facilities, reset the ID sequence or update IDs. Context relies on a trusted backend and is not a defense against arbitrary SQL using app_user credentials.

This policy covers facilities only: inventories, batches and related stock data are not protected by this script. Product and cart stock reads and checkout/transfer writes require a separate cross-module authorization design. Existing public facility detail responses also include employee information and counts from other tables; facility RLS does not protect those joined records. Review that endpoint and employee authorization separately.

For an existing database, back up and test a copy, stop backend traffic, apply 10 after 03 and 09 with an owner connection, then deploy matching backend code. The script is transactional and refuses unknown facility policies. New Docker volumes apply it through master init; existing volumes do not automatically rerun initialization. Roll back policies, grants and code together from a saved baseline.

`database/tests/facility_rls_test.sql` tests public reads, role boundaries and restricted privileges. The HTTP integration test requires explicit localhost URLs `FACILITY_RLS_TEST_DATABASE_URL` and `FACILITY_RLS_TEST_ADMIN_URL` for a disposable database named exactly `pharmatrace_facility_rls_test`. It temporarily disables FORCE and restores it in a finally block; do not run other suites on that database concurrently.

## Employee RLS

`security/employee/employee_rls.sql` enables and forces RLS on employees after the auth policies and facility security. SUPER_ADMIN manages all employees through transaction-local management context. After applying security/employee/employee_facility_rls.sql, STORE_MANAGER may manage PHARMACIST and WAREHOUSE_STAFF accounts only at their assigned facility; managers cannot assign elevated roles or move staff across facilities. Other staff retain self profile and exact-email login access through the existing auth policies. Profile writes cannot change roles, facilities, status or other protected columns. Public unscoped facility queries no longer expose employee rows; facility administration can count employees before deletion. Employee management fails closed until the facility-scoped policy is present.

Apply 11 and then 14 with an owner connection to a backed-up test copy first, stop traffic, then deploy matching backend and policies together. Configure backend authentication to match the deployed account policies; employee RLS is enforced independently. Never rerun base grants after restricted scripts. Context trusts the backend; app_user credentials and arbitrary SQL must remain private. Rollback requires restoring the saved policies/grants and matching code. Existing 03 policy preflight intentionally rejects rerunning auth setup over additional employee policies.

SQL checks: `tests/employee_rls_test.sql` and `tests/employee_facility_rls_test.sql`. HTTP tests require explicit localhost EMPLOYEE_RLS_TEST_DATABASE_URL and EMPLOYEE_RLS_TEST_ADMIN_URL targeting only the disposable database pharmatrace_employee_rls_test. They cover login, administration, profile writes, privilege escalation and missing FORCE. Do not run other suites on that database concurrently.

## Customer RLS

`security/customer/customer_rls.sql` enables and forces RLS for customers after the existing auth, order, review and employee policies. Customers can access their own account through the auth context. SUPER_ADMIN manages customers globally; STORE_MANAGER can access and change status only for customers with an order visible at their facility; PHARMACIST has read-only access to the same scope. Account profiles cannot directly change status or reward points. Existing order operations handle loyalty changes within their scoped transactions. Review moderators can access customers attached to reviews; staff remain limited by customer facility scope. Public review responses may show the existing anonymous-name fallback because public sessions cannot read customer rows.

Apply 12 on a tested backup with an owner connection, while backend traffic is stopped, before starting matching code. New Docker volumes apply it through master initialization; existing volumes do not automatically rerun it. Do not rerun base grants after security scripts. Configure backend authentication to match the deployed account policies. Context relies on the trusted backend and does not protect against arbitrary SQL executed with app_user credentials. Back up policies, grants and code together for rollback. The auth setup script's preflight rejects later policies if rerun.

`tests/customer_rls_test.sql` and `test/customer-rls.e2e-spec.ts` use disposable databases. The integration test requires explicit localhost CUSTOMER_RLS_TEST_DATABASE_URL and CUSTOMER_RLS_TEST_ADMIN_URL for a database named exactly pharmatrace_customer_rls_test.

## Catalog RLS

`security/catalog/catalog_rls.sql` enables and forces RLS on medicines, categories, packaging_variants and medicine_categories. Existing app_user catalog reads remain public; SUPER_ADMIN and STORE_MANAGER can manage catalog rows through transaction-local context. Runtime cannot truncate tables, update IDs or reset sequences. Product and category writes run in transactions so related writes roll back together on failure. Inventory tables are outside this policy. Existing public read behavior, including status filtering in the API, is not changed by this script.

Test a backup first and stop application traffic before applying 13 with an owner connection and deploying matching backend code. New Docker volumes apply it through master init; existing volumes do not rerun initialization. Do not reapply base broad grants after restricted scripts. Database context is supplied by a trusted backend; arbitrary SQL using app_user credentials can forge it. Restore policies, grants and code together from a saved baseline for rollback.

Run `tests/catalog_rls_test.sql` and `test/catalog-rls.e2e-spec.ts` against disposable databases. The HTTP test requires explicit localhost CATALOG_RLS_TEST_DATABASE_URL and CATALOG_RLS_TEST_ADMIN_URL targeting exactly pharmatrace_catalog_rls_test.

## Manufacturer RLS and Existing Databases

`security/manufacturer/manufacturer_rls.sql` applies manufacturer policies and prevents employee assignment to external manufacturer records. New databases receive it through master initialization. `tests/manufacturer_rls_test.sql` checks permitted and denied access in a rolled-back transaction.

Existing volumes do not update automatically. For an older database, prepare and test a data-specific upgrade after backing up and reviewing existing relationships. Applying the RLS script alone does not upgrade the schema or clean historical data.

## Logistics operations

The logistics endpoints use the existing order RLS context. New databases install `schemas/10_logistics_operations.sql` followed by `security/logistics/logistics_rls.sql` after the order policies. For an existing database, back up and test on a copy, stop backend traffic, apply the schema script and then the security script as a trusted PostgreSQL superuser, and deploy the matching backend. Do not rerun the master initialization or seed scripts on an existing volume. The SECURITY DEFINER functions intentionally require a trusted superuser owner; runtime access is limited to their narrow operations and trusts the same server-supplied actor context as order RLS.

Events start when the migration is installed; it does not manufacture historical events. COD collection requires a delivered, unsettled shipment with a positive COD amount, locks it, and creates the cashbook and settlement records atomically. Shipment status and COD endpoints require super admin or store manager; pharmacists may update delivery status but cannot collect COD. A cancelled, undispatched transfer releases only its own reservations; its order remains waiting and requires an order cancellation or a separate replanning workflow. Return tracking records movement only: receiving returned items does not automatically restore sellable inventory, change the order to returned, or issue a refund; inspection and those workflows must be handled separately.

Run `database/tests/logistics_test.sql` against an isolated database after both logistics scripts; it creates its own fixtures and rolls them back. It checks facility denial, duplicate COD settlement, cancellation, event history and reservation release. Also run the order RLS regression suite when changing these policies.


## 2026-11-09 — Logistics workflow completion upgrade

See [the implementation and rollout guide](LOGISTICS_WORKFLOWS.md) for NV-05/NV-06 custody and discrepancy resolution, NV-11 exceptional payments, C6 unpacked PROCESSING cancellation and NV-14 facility delivery policies.

After applying the earlier Logistics prerequisites, stop the matching backend/jobs and apply the domain scripts listed in [LOGISTICS_WORKFLOWS.md](LOGISTICS_WORKFLOWS.md) as a trusted DBA. The custody script refuses active legacy dispatched/return-requested transfers without custody records; complete or physically reconcile those with the previous backend before cutover. Never reset the database volume to apply these changes.

After the upgrade, dispatch removes source on-hand stock and reservations. Receipt consumes in-transit custody; source returns increase on-hand stock only after physical inspection. The older description above that source returns only release reservations applies to the earlier implementation.

New delivery orders require enabled facility policies and medicine transport classifications, managed at `/admin/logistics/policies`. Fresh development initialization loads demo policies and classifications from `seeds/01_seed_data.sql`. Existing volumes do not rerun bootstrap automatically. The local application database has received the domain controls; local demo settings are described below.

## 2026-11-10 — Order resolution and local upgrade

`security/order/order_resolution.sql` installs staff cancellation audit, structured delivery dispute conclusions and approved cancellation refunds backed by actual cashbook payments. Apply it after `security/payment/payment_exceptions.sql` and `security/logistics/event_identity.sql`, following the logistics prerequisites. Fresh initialization includes the same controls.

Standalone transfer cancellation and rerouting are blocked until delivery replanning is supported. Cancel the entire order instead. Admin completion requires a delivered shipment with PoD type, reference, recipient and delivery time. Disputes retain their original reason and record a final outcome, reason, handler and time. Open disputes and confirmed non-delivery block loyalty awards; confirmed non-delivery reverses previously earned points. Delivery confirmation restores eligibility under the existing paid-order and return-window rules.

Cancellation refunds cover the full amount of a paid order cancelled before packing, without an RMA. Finance managers or super administrators approve; accountants may record the actual payment with the approved amount and a unique reference. Approval does not change payment status. Actual recording atomically creates the cashbook expense, consumes allocated exceptional funds if applicable and marks the order refunded. Retries with matching evidence return the existing record. References cannot be reused across cancellation, RMA and exceptional-payment refunds.

The local `phartrace-vn-db` was backed up to `backups/pharmatrace-before-order-resolution-20261110.dump` and restored to `codex_local_upgrade_20261110` for rehearsal. The user confirmed order 145 and transfer `ITR-261029-DF0CE598` as disposable demo data. Their one-time reconciliation has completed: both are cancelled, the one reservation was released, and source stock was preserved at 2,206 at reconciliation time. No historical physical receipt or package evidence was invented. The completed data-specific script has been removed; never replay that cleanup against current data or fresh databases.

Development fulfillment configuration is included in `seeds/01_seed_data.sql`: all 14 supported pharmacy/warehouse facilities, 24/7 Vietnam time, 1,000 orders/day, 100 km radius and `APPROVED_STANDARD` for 543 demo medicines. The two warehouse links use the first development pharmacy. Factory facilities are excluded. These are test settings, not production transport classifications. `schemas/13_fulfillment_policy.sql` creates the tables before the seed; `security/logistics/fulfillment_policy.sql` installs their runtime controls later. There is no separate demo configuration script. Existing local seed data was not replayed, preserving current local policies and warehouse link choices.

There is no separate `upgrades` directory: schema and function changes live in `schemas/` and `security/`, development data in `seeds/`, and verification in `tests/`. Current local schema/security changes are applied without rerunning master or resetting the volume. For other existing databases, follow the domain-script order and prerequisites in [LOGISTICS_WORKFLOWS.md](LOGISTICS_WORKFLOWS.md).

Folder consolidation backup: `backups/pharmatrace-before-folder-merge-20261110.dump`. Restoration and source-script application were tested separately before applying the same source scripts to local. Data-only dumps before/after matched exactly; current policies, warehouse links, orders and inventory were preserved.

The matching local app serves the resolution endpoints under `/admin/orders/:id`: `/resolution`, `/dispute/resolve`, `/cancellation-refund/approve` and `/cancellation-refund/payment`. Order details display cancellation audit, dispute handling and refund evidence. Regression tests are in `src/modules/logistics/workflow-gaps.integration.spec.ts` and run with the restricted `app_user` role on a dedicated workflow database. Both production builds pass; authenticated local HTTP checks return 200, and the browser displays the demo cancellation audit. The customer-receipt SQL regression also covers the fix preventing a customer event from being relabeled as an employee when their numeric IDs collide.

### Transfer receipt and variant integrity fixes

- `security/logistics/transit_box_receipt.sql` adds a `medicine_boxes` policy that lets destination staff (and source staff for returns) see and update only the in-transit boxes of the transfer they are receiving, and only during the `receive` operation. In-transit boxes have no facility, so the facility-based policy alone hid them from every non-super-admin.
- `security/logistics/normalize_legacy_box_status.sql` maps the legacy seed values `TrongKho` to `IN_STOCK` and `HopLe` to `ACTIVE`; the application and dispatch functions only recognise the English values.
- `security/order/order_item_variant_restrict.sql` changes `order_items.variant_id` to `ON DELETE RESTRICT` so a packaging variant that is on an order can no longer be deleted (it used to be set to NULL, which stranded transfers).
- `security/logistics/logistics_workflow_enhancements.sql` now also grants `INSERT` on `internal_transfers.variance_details` and `discrepancy_status`, which Prisma writes explicitly when checkout creates a transfer.

## Warehouse manager access

`WAREHOUSE_MANAGER` can now do everything `WAREHOUSE_STAFF` can do on orders, transfers, shipments and returns, at its own warehouse only, and can also resolve transfer discrepancies at its warehouse. It also gets a read-only staff roster through the `employee_warehouse_read` policy (`app.employee_operation = 'warehouse_read'`). `FACTORY_WAREHOUSE_STAFF` gets no new access. It will be granted per feature, together with the workflows that need it.

Role lists no longer repeat warehouse roles. Policies and functions call `public.app_role_in_group('WH_STAFF' | 'WH_MANAGER' | 'WH_ALL')` from `security/access/app_role_groups.sql`. These groups mirror `pharmatrace-vn-backend/src/common/warehouse-roles.ts`; change both together. An unknown group name raises, and the function never returns NULL.

### Applying to an existing database

Back up the database first. Re-applying `security/order/order_rls.sql` also re-installs older copies of functions that later scripts replace (`guard_order_write`, `order_staff`, `transfer_order_state`, ...). For that reason the whole chain below must be applied, in this order, as the database owner. Stop after the first error:

1. `security/access/app_role_groups.sql`
2. `security/order/order_rls.sql`
3. `security/employee/employee_rls.sql`
4. `security/employee/employee_facility_rls.sql`
5. `security/logistics/logistics_rls.sql`
6. `security/order/order_pickup_status.sql`
7. `security/logistics/logistics_workflow_enhancements.sql`
8. `security/logistics/logistics_integrity.sql`
9. `security/logistics/transfer_manifest.sql`
10. `security/inventory/quarantine_balances.sql`
11. `security/payment/disable_unverified_cod_collection.sql`
12. `security/payment/cod_receivable_and_net_cash.sql`
13. `security/payment/online_payment_evidence.sql`
14. `security/payment/cod_statement_approval.sql`
15. `security/logistics/in_transit_custody.sql`
16. `security/logistics/source_manifest_assignment.sql`
17. `security/logistics/transfer_discrepancy_resolution.sql`
18. `security/payment/payment_exceptions.sql`
19. `security/order/unpacked_customer_cancellation.sql`
20. `security/order/order_resolution.sql`
21. `security/returns/return_requests.sql`

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/access/app_role_groups.sql
```

Repeat the command for each path above. Every script runs in its own transaction and can be re-applied. `order_rls.sql` now allows the three policies that `logistics_integrity.sql` adds to the order tables, so it can run on an installed database. `in_transit_custody.sql` still refuses to run while a `DISPATCHED` or `RETURN_REQUESTED` transfer has no custody record. Reconcile such transfers first, as described in [LOGISTICS_WORKFLOWS.md](LOGISTICS_WORKFLOWS.md).

How this was verified, using disposable containers only:

- A database built from the previous scripts and then upgraded with this chain produced a `pg_dump --schema-only` identical to a fresh initialization, grants included.
- Applying the chain a second time changed nothing.
- On the upgrade copy, the seeded demo transfer had to be reconciled first, because it has no custody record.

Run `tests/warehouse_manager_access_test.sql` after applying:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/warehouse_manager_access_test.sql
```

## Warehouse inventory reads

`security/inventory/warehouse_inventory_read.sql` lets the warehouse portal read stock, inventory logs and quarantine of its own facility. It turns on RLS for `inventories`, `inventory_logs`, `quarantine_balances` and `quarantine_movements`, and grants `SELECT` on the two quarantine tables to `app_user`.

- When the backend sets `app.inventory_operation = 'warehouse_read'`, only the `*_warehouse_read` policies apply. `WAREHOUSE_STAFF`, `WAREHOUSE_MANAGER` and `FACTORY_WAREHOUSE_STAFF` see only rows of `app.current_unit_id`; `SUPER_ADMIN` sees every facility. These roles form the new `WH_READ` group in `security/access/app_role_groups.sql`.
- Every other flow (checkout, cart, catalog, transfers, returns) does not set that operation and keeps its current access through the `inventory_default` and `inventory_log_default` policies. A plain `app_user` session without the warehouse read context is therefore not facility-scoped yet.
- Quarantine tables have no default policy: `app_user` can read them only in the warehouse read context. Writes still go through the `SECURITY DEFINER` quarantine functions.

### Applying to an existing database

Back up the database first, then run as the database owner:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/access/app_role_groups.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/inventory/warehouse_inventory_read.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/warehouse_inventory_rls_test.sql
```

Both scripts can be re-applied.

## Batch sellability

`security/inventory/batch_sellability.sql` decides whether a box may be reserved, packed or dispatched.

- `batches.status` is limited to `ACTIVE`, `ON_HOLD`, `RECALLED` and `EXPIRED`. The legacy seed labels `HopLe` and `ThuHoi` are mapped to `ACTIVE` and `RECALLED`. Hold details go in `hold_reason`, `held_by_id` and `held_at`.
- `medicines.min_remaining_shelf_life_days` sets the minimum remaining shelf life of a medicine. `NULL` means the medicine uses `system_settings.default_min_shelf_life_days`, which starts at `0`. `system_settings` is one row and is not readable by `app_user`.
- `box_sellable(uid, as_of)` is true only when the box is not `QUARANTINED`, its batch is `ACTIVE`, the batch has not expired on `as_of`, and the remaining days meet the minimum.
- `unsellable_box_counts(medicine_ids)` returns per facility and medicine the number of unreserved boxes that may not be sold. Checkout subtracts them from aggregate stock.
- `security/logistics/source_manifest_assignment.sql` now uses `box_sellable` when a transfer is dispatched, including packages reserved earlier.
- `default_min_shelf_life_days()` returns the system default to `app_user`; `set_min_shelf_life_days(medicine, days)` changes one medicine's minimum (or, with a `NULL` medicine, the default) and requires `SUPER_ADMIN`.
- `batch_status_events` records every batch hold and release with the reason and the employee. `app_user` may only read and insert: warehouse roles read, warehouse managers insert rows for themselves. A daily backend job sets `EXPIRED` on `ACTIVE` and `ON_HOLD` batches past their expiry date.

### Applying to an existing database

Back up the database first. If any batch has a status other than the four above, `HopLe` or `ThuHoi`, the script stops; fix those rows first. Then run as the database owner:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/inventory/batch_sellability.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/logistics/source_manifest_assignment.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/batch_sellability_test.sql
```

Both scripts can be re-applied.

## Purchase orders

`security/procurement/purchase_orders.sql` adds the purchase order lifecycle (create, edit while `PENDING`, approve, cancel). Receiving goods and payables come later.

- `purchase_orders` gains `facility_id` (the receiving warehouse), `supplier_manufacturer_id`, `approved_by_id`, `approved_at`, `cancel_reason`, `closed_reason` and `expected_at`. A check requires exactly one of `supplier_id` (a `FACTORY` facility) and `supplier_manufacturer_id`.
- Statuses are `PENDING`, `APPROVED`, `PARTIALLY_RECEIVED`, `RECEIVED`, `CLOSED` and `CANCELLED`.
- `received_at` no longer defaults to the creation time. It stays empty until goods are received, and the script clears it on existing orders that are not `RECEIVED`.
- `purchase_order_items.received_quantity` starts at 0 and may not exceed `quantity`.
- `purchase_order_events` is an append-only history of status changes with the employee and the reason.
- All three tables use forced RLS. Warehouse roles read only the orders addressed to their own warehouse, `SUPER_ADMIN` reads all, only warehouse managers write, and items change only while the order is `PENDING`. `po_parties_valid()` checks that the receiving facility is a warehouse and the supplier is a manufacturer or a factory.

### Applying to an existing database

Back up the database first. `security/access/app_role_groups.sql` must already be installed. Run as the database owner:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/procurement/purchase_orders.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/purchase_order_rls_test.sql
```

Both scripts can be re-applied.

## Goods receipts

`security/procurement/goods_receipts.sql` receives approved purchase orders in one or more receipts.

- New tables: `goods_receipts` (unique `receipt_code`, order, receiving warehouse, employee, time, note), `goods_receipt_lines` (order line, batch, accepted and rejected quantities, reject reason, scanned `box_uids` and `rejected_box_uids`) and `goods_receipt_attachments` (photos, delivery notes and CO/CQ, stored as private images).
- `inventory_logs` gains `batch_id`. Receipts log `PURCHASE_IN` (stock bucket `ON_HAND`) per line, and rejected boxes log `QUARANTINE_IN` with a `PO_RECEIPT` quarantine movement.
- `accounts_payable` gains a unique `goods_receipt_id`. Each receipt with accepted goods creates one payable worth accepted quantity × unit price; rejected boxes are not payable.
- `purchase_orders.closed_reason` must be 1–500 characters when set.
- `record_goods_receipt(po, code, note, lines)` is a security-definer function that does the whole receipt in one transaction: it locks the order and its lines, returns the existing receipt for a repeated code, creates or matches the batch (same medicine and dates), checks that every scanned box or SSCC carton belongs to the batch and is not held by any facility yet, refuses quantities above the order, moves boxes and cartons to the warehouse, adds stock or quarantine, updates `received_quantity`, moves the order to `PARTIALLY_RECEIVED` or `RECEIVED` with an event, and records the payable. Unknown box UIDs are registered as new, unsigned boxes of the declared batch.
- RLS is forced on the three new tables and on `accounts_payable`. Warehouse roles read the receipts of their own warehouse; only the function writes receipts and payables. `SUPER_ADMIN`, `ACCOUNTANT` and `FINANCE_MANAGER` read every payable, and a warehouse manager reads the payables of the warehouse's orders.
- `employees` gains `employee_procurement_actor_read`: inside purchase order requests (`app.employee_operation = 'procurement_read'`), a caller reads the employees who acted on the order events, receipts and attachments it can already read, so warehouse staff see who created, approved and received an order.

### Applying to an existing database

Back up the database first. `security/procurement/purchase_orders.sql` and `security/returns/return_requests.sql` must already be installed. Run as the database owner:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/procurement/goods_receipts.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/goods_receipt_test.sql
```

The backend suite `src/modules/procurement/goods-receipt.integration.spec.ts` (partial receipts, concurrent receipts, repeated codes and every rejection) runs as `app_user` when `WORKFLOW_TEST_DATABASE_URL` points to a freshly initialized database named `codex_goods_receipt_20261118`.

Both scripts can be re-applied. Re-running `security/inventory/quarantine_balances.sql` or `security/returns/return_requests.sql` afterwards narrows the quarantine origin check again, so re-apply this script after them.

## Factory batch intake

`security/inventory/factory_batch_intake.sql` lets factory staff register finished-goods batches.

- `stock_in_on_hand(...)` (defined in `security/procurement/goods_receipts.sql`) adds sellable stock and writes the `inventory_logs` row. Goods receipts call it with `PURCHASE_IN` and factory intake with `PRODUCTION_IN`; `inventory_logs.transaction_type` has no check constraint, so no schema change is needed.
- `record_factory_batch(facility, variant, batch number, production date, expiry date, co/cq, cartons)` is a security-definer function. It requires the `FACTORY_INTAKE` role group (`FACTORY_WAREHOUSE_STAFF`, `SUPER_ADMIN`), a facility of type `FACTORY` inside the caller's scope, a unique batch number and production date before expiry. In one transaction it creates the batch, its SSCC cartons and its boxes (stored as `IN_STOCK` at the factory with the signature supplied by the API), then adds the stock. `batches`, `sscc_cartons` and `medicine_boxes` have no RLS (other flows write them directly), so this function is where the role and factory checks for batch intake live.
- `app_role_group('FACTORY_INTAKE')` is added to `security/access/app_role_groups.sql`.

### Applying to an existing database

Back up the database first. `security/access/app_role_groups.sql` and `security/procurement/goods_receipts.sql` must be re-applied before the new script. Run as the database owner:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/access/app_role_groups.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/procurement/goods_receipts.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/inventory/factory_batch_intake.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/factory_batch_intake_test.sql
```

The backend suite `src/modules/warehouse/factory/factory-batch.integration.spec.ts` runs as `app_user` when `WORKFLOW_TEST_DATABASE_URL` points to a freshly initialized database named `codex_factory_batch_20261118`. Set `QR_SECRET_KEY` and optionally `FACTORY_BATCH_MAX_BOXES` (default 10000) in the backend `.env`.

## Order packages

`security/order/order_packages.sql` splits packing an order into packages.

- `order_packages` records each package of an order (`PACKED`, `HANDED_OVER` or `VOID`) at the order's export facility. `order_package_items` lists the scanned boxes and the order line each one fills.
- A partial unique index keeps every box in at most one active package. Voiding a package sets `voided_at` on its items, which frees the boxes.
- RLS: staff of the export facility read the packages. Inserts need the `pack` order operation and the actor as `packed_by_id`. Only `WH_MANAGER` can void, and only the void columns can be updated.
- The trigger `void_cancelled_order_packages` voids the active packages of an order when it is cancelled, whichever path cancels it.

### Applying to an existing database

Back up the database first. Run as the database owner:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/order/order_packages.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/order_packages_test.sql
```

The backend suite `src/modules/warehouse/fulfillment/fulfillment.integration.spec.ts` (customer cancel racing packing) runs as `app_user` when `WORKFLOW_TEST_DATABASE_URL` points to a freshly initialized database named `codex_order_packing_20261119`.

## Carrier handovers

`security/order/carrier_handovers.sql` hands packed packages over to a carrier.

- `carrier_handovers` records the courier, driver, vehicle, note, employee and time of one handover at a facility. `carrier_handover_packages` lists its packages; a package can be in one handover only.
- `record_carrier_handover(...)` is the only writer. It runs in one transaction, is idempotent by `handover_code`, and rejects packages that are not `PACKED`, belong to another facility, have an unconfirmed carrier or a different carrier than the handover.
- Handed-over packages become `HANDED_OVER`. When every active package of an order is handed over, the shipment and the order become `PICKED_UP` (logged by the existing logistics event trigger) and the boxes become `IN_TRANSIT`.
- RLS: staff of the facility read handovers; there are no direct write grants.

### Applying to an existing database

Back up the database first. `security/order/order_packages.sql` must already be applied. Run as the database owner:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/order/carrier_handovers.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/carrier_handovers_test.sql
```

## Stock transfers

`security/logistics/stock_transfers.sql` lets internal transfers exist without an order and adds stock transfer requests between facilities.

- `internal_transfers.order_id` is nullable. New columns: `transfer_type` (`ORDER_FULFILLMENT` by default, `REPLENISHMENT`, `RETURN_TO_WAREHOUSE`, `RECALL_COLLECTION`) and `request_id`. A check requires an order for `ORDER_FULFILLMENT` and no order for every other type.
- The transfer functions read a stock transfer's lines from `internal_transfers.items` instead of `order_items`:
  - `prepare_dispatch_manifest` reserves the scanned source boxes, and `record_transfer_manifest` requires one reserved box per unit.
  - `handoff_transfer_custody` takes the dispatched UIDs from the manifest.
  - `transit_box_receivable` finds in-transit boxes through `transfer_custody` (for both types).
  - `record_quarantine_movement` takes the medicine from the transfer line (for both types).
  - `resolve_transfer_discrepancy` rejects stock transfers: their receipt is final.
- `stock_transfer_requests` (unique `request_code`, source and destination facility, normalized `lines`, `status` `REQUESTED` / `APPROVED` / `REJECTED` / `CANCELLED`, requester, decider, reason and decision note) and `stock_transfer_request_events` (one row per change, with the employee and note). Both use forced RLS: staff of either facility read them, `SUPER_ADMIN` reads all, and there are no direct write grants.
- `create_stock_transfer_request(code, source, destination, lines, reason)`: a `WAREHOUSE_MANAGER` or `STORE_MANAGER` of the destination creates a request. Resending a code returns the existing request.
- `decide_stock_transfer_request(id, decision, note)`: `APPROVE` and `REJECT` require a manager of the source facility. Approval reserves source stock (`inventories.reserved_quantity`) and creates one `internal_transfers` row (`REPLENISHMENT`, or `RETURN_TO_WAREHOUSE` from a pharmacy to a warehouse) that then follows the normal dispatch and receipt workflow. `CANCEL` by a manager of either facility works until the transfer is dispatched and releases the reservation. Reject and cancel need a note.

### Applying to an existing database

Back up the database first. Run as the database owner, in this order (`return_requests.sql` holds the final `record_quarantine_movement`; do not re-run the older `quarantine_balances.sql` after it):

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/logistics/stock_transfers.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/returns/return_requests.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/logistics/transit_box_receipt.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/logistics/transfer_manifest.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/logistics/source_manifest_assignment.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/logistics/in_transit_custody.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/logistics/transfer_discrepancy_resolution.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/stock_transfers_test.sql
```

`in_transit_custody.sql` keeps its check that refuses active transfers without custody records. All scripts can be re-applied.

## Stock counts and adjustments

`security/inventory/stock_counts.sql` adds warehouse stock counts and manager-approved stock adjustments.

- New tables: `stock_counts` (unique `count_code`, warehouse, `scope` of `FULL`, `MEDICINE` or `BATCH`, `status` `OPEN` / `SUBMITTED` / `APPROVED` / `CANCELLED`), `stock_count_lines` (one per batch: `system_quantity` at opening, `counted_quantity`, and `current_quantity` and `difference` filled at approval) and `stock_count_events` (every status change with the employee and note). All three use forced RLS: warehouse roles read their own warehouse, `SUPER_ADMIN` reads all, and `app_user` has no write grants.
- A line is a batch. Boxes carry no variant, so the line's variant is the one variant of the batch's medicine that the warehouse stocks. A count (or an adjustment) of a medicine with zero or several stocked variants is refused with `SC_VARIANT_AMBIGUOUS`. `system_quantity` is the number of boxes of the batch at the warehouse in status `IN_STOCK`, `MANUFACTURED`, `RESERVED` or `PACKAGED`.
- `open_stock_count`, `save_stock_count_lines`, `submit_stock_count`, `cancel_stock_count`, `approve_stock_count` and `record_stock_adjustment` are security-definer functions. Opening, cancelling, approving and adjusting need `WH_MANAGER`; saving lines and submitting need `WH_ALL`. A repeated count or adjustment code returns the record it created.
- Approval compares each counted number with the units on hand at approval time, not at opening, and books the difference. A loss marks unreserved boxes of the batch `MISSING`; a gain restores `MISSING` boxes of the batch only (`SC_GAIN_UNKNOWN_BOXES` otherwise). Stock never drops below `reserved_quantity` (`SC_BELOW_RESERVED`). Each change adds an `ADJUSTMENT_LOSS` or `ADJUSTMENT_GAIN` row to `inventory_logs` with the batch, before and after units, the code and the employee, and moves `batches.remaining_quantity`. `inventory_logs.transaction_type` has no check constraint, so no schema change is needed.

### Applying to an existing database

Back up the database first. `security/procurement/purchase_orders.sql` must already be installed. Run as the database owner:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/inventory/stock_counts.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/stock_counts_test.sql
```

Both scripts can be re-applied.

## Batch recalls

`security/quality/batch_recalls.sql` lets `SUPER_ADMIN` recall batches across every facility.

- New tables: `batch_recalls` (unique `recall_code`, reason, `severity` `LEVEL_1` / `LEVEL_2` / `LEVEL_3`, optional `document_url`, `status` `ACTIVE` / `CLOSED`), `batch_recall_batches` (a batch belongs to at most one recall) and `batch_recall_events` (`CREATE`, `HOLD`, `COLLECT`, `CLOSE` with the employee; `HOLD` and `COLLECT` keep the facility, batch, exact box UIDs and collection transfer). All three use forced RLS and only `SUPER_ADMIN` reads them; `app_user` has no write grants.
- `create_batch_recall(code, reason, severity, document, batch_ids)` sets the batches `RECALLED` (with a `batch_status_events` row), so `box_sellable()` refuses them at checkout, packing and dispatch. Unreserved `IN_STOCK` / `MANUFACTURED` boxes at every facility become `QUARANTINED`: `inventories.stock_quantity` drops, `quarantine_balances` rises, two `RECALL_HOLD` rows go to `inventory_logs` (on-hand and quarantine side) and a `quarantine_movements` row with origin `RECALL` points at the `HOLD` event. Reserved boxes of unpacked orders are left on the order and listed as tasks; staff use the existing box replacement or cancellation. A repeated code with the same batches returns the recall.
- `collect_batch_recall(id, destination)` creates one `RECALL_COLLECTION` internal transfer per facility that still holds boxes, to a central or branch warehouse. The held boxes go back to reserved on-hand stock (`RECALL_COLLECT` logs, quarantine action `COLLECT`), so the normal dispatch and receipt workflow carries them. `prepare_dispatch_manifest` accepts those already reserved recalled boxes for collection transfers. On receipt, a trigger quarantines the received boxes at the destination.
- `close_batch_recall(id, note)` is refused while a collection transfer is still open. Batches stay `RECALLED`.
- `batch_recall_impact(id)` lists every box of the recalled batches with its location (`FACILITY`, `IN_TRANSIT`, `DELIVERED`, `OTHER`), facility, and the last order and customer it was assigned to. `batch_recall_tasks(facility)` lists held stock, open collection transfers and unpacked orders holding recalled boxes for warehouse roles and `STORE_MANAGER` of that facility.
- `quarantine_movements` checks now allow origin `RECALL` and action `COLLECT`.

### Applying to an existing database

Back up the database first. Run as the database owner:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/logistics/source_manifest_assignment.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/quality/batch_recalls.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/batch_recalls_test.sql
```

All scripts can be re-applied. `batch_recalls.sql` sets the final `quarantine_movements` checks; re-run it after any older script that redefines them.

The backend suite `src/modules/recall/recall.integration.spec.ts` (manager refused, checkout and packing refusing the recalled batch, impact matching the box count) runs as `app_user` when `WORKFLOW_TEST_DATABASE_URL` points to a freshly initialized database named `codex_batch_recall_20261120`.

## Drug disposals

`security/quality/drug_disposals.sql` lets a warehouse dispose of expired, quarantined and recalled boxes with a signed record.

- New tables: `disposals` (unique `disposal_code`, warehouse, `status` `DRAFT` / `APPROVED` / `COMPLETED` / `CANCELLED`, reason, creator, approver, completer), `disposal_items` (one row per box with its source `EXPIRED`, `QUARANTINE` or `RECALL`), `disposal_attachments` (private image references of the disposal record, at most 5 per disposal) and `disposal_events` (every status change and attachment with the employee). All four use forced RLS: warehouse roles read their own warehouse, `SUPER_ADMIN` reads all, and `app_user` has no write grants.
- `disposal_candidates(warehouse)` lists the boxes that may be disposed of: expired `IN_STOCK` / `MANUFACTURED` boxes and `QUARANTINED` boxes (of a `RECALLED` batch they count as `RECALL`). Boxes that are in date, in an `ACTIVE` batch and not quarantined, `DESTROYED` boxes and boxes on another open (`DRAFT` / `APPROVED`) disposal are refused.
- `create_disposal(code, warehouse, reason, box_uids)` opens a draft (`WH_ALL`); a repeated code with the same boxes returns the disposal. `add_disposal_attachment` adds an image while the disposal is open. `approve_disposal`, `complete_disposal` and `cancel_disposal` need `WH_MANAGER`.
- `complete_disposal` is refused without an attachment. It sets the boxes `DESTROYED`, lowers `inventories.stock_quantity` for expired boxes or `quarantine_balances` for quarantined and recalled boxes, lowers `batches.remaining_quantity` and writes `DISPOSAL` rows to `inventory_logs`. It fails with `DP_BOX_CHANGED` when a box changed state after the draft. Completing twice does nothing.

### Applying to an existing database

Back up the database first. Run as the database owner:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/quality/drug_disposals.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/drug_disposals_test.sql
```

Both scripts can be re-applied.

## Warehouse traceability

`security/quality/warehouse_traceability.sql` lets a warehouse check scanned boxes, read a box timeline, unpack cartons and handle fraud alerts. A scan never proves a box is authentic; it only raises alerts that need investigation.

- Changed table: `fraud_alerts` gets `facility_id`, `scanned_code`, `reported_by_id`, `resolved_by_id`, `resolved_at` and `resolution_note`. A unique index allows one unresolved alert per scanned code, reason and warehouse, so repeated scans add nothing. The table now uses forced RLS: managers read the alerts of their warehouse (or of a box held there), `SUPER_ADMIN` reads all, and `app_user` has no write grants.
- New table: `carton_events` (one `UNPACKED` row per unpacked carton with the warehouse and employee), with forced RLS and read-only access.
- `scan_box_facts(uid)` returns what the scan check needs about a box; `record_scan_anomaly(uid, reasons)` (`WH_ALL`) opens one alert per reason (`UNKNOWN_UID`, `SIGNATURE_MISMATCH`, `NOT_AT_WAREHOUSE`, `BOX_STATUS_UNEXPECTED`). The signature itself is checked by the API, which holds the QR secret.
- `box_history(uid)` returns the box timeline, oldest first, from goods receipts, transfers, carton unpacking, packages, carrier handovers, returns, recalls, disposals, public QR scans and fraud alerts. A warehouse sees it when it holds the box now or appears in its history. Stock count adjustments mark boxes `MISSING` without a per-box record, so they are not on the timeline.
- `carton_overview(sscc)` returns a carton of the caller's warehouse with its boxes. `unpack_carton(sscc)` (`WH_ALL`) marks a `PACKAGED` carton `UNPACKED` when all its boxes are still at the warehouse; boxes keep their carton, and unpacking twice does nothing.
- `resolve_fraud_alert(id, note)` needs `WH_MANAGER` and a note; resolving twice keeps the first resolution.

### Applying to an existing database

Back up the database first. Run as the database owner:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/quality/warehouse_traceability.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/warehouse_traceability_test.sql
```

Both scripts can be re-applied.

## Public trace

`security/quality/public_trace.sql` backs the consumer trace portal and the admin fraud radar. It needs `warehouse_traceability.sql` first. It adds the `box_activations` and `box_code_entries` tables (forced RLS, no direct access for `app_user`) and functions.

- `public_box_trace(uid)` returns the medicine, manufacturer, batch, dates, batch and box status, activation time, number of valid code entries and whether the box is flagged as counterfeit. `public_box_timeline(uid)` returns its distribution events oldest first (`MANUFACTURED`, `RECEIVED`, `TRANSFER_DISPATCHED`, `TRANSFER_RECEIVED`, `PACKED`, `HANDED_OVER`, `DELIVERED`, `CODE_ACTIVATED`) with the warehouse name where one applies, and no employee, order or customer data. Both are callable without a login and are empty for an unknown uid.
- `record_box_verification(uid, valid, device)` records a secret code entry whose validity the API checked with the QR secret, made from a device (a random id kept by the browser, or the IP address when none is sent). Every entry is kept in `box_code_entries`. The first valid entry activates the box (one `box_activations` row); later valid entries only raise `verify_count`; an invalid entry changes nothing. It returns whether this entry was the first, the activation time, the entry count and whether the box is flagged. Alerts open once while an alert of the same type for the box is unresolved: `CODE_BURST` (`CRITICAL`, flags the box) for 10 valid entries within a minute, `CODE_REUSED` (`WARNING`) for a valid code entered from a second device, and `CODE_GUESSING` (`WARNING`) for 5 wrong entries within 10 minutes. The two warnings are for the administrator and do not flag the box.
- `record_public_scan(uid, lat, lng, ip, agent)` logs one scan in `qr_scan_logs`. There is no score: two findings flag the box as counterfeit and open a `CRITICAL` alert, impossible travel (the distance from the previous located scan implies more than 1000 km/h, with the elapsed time counting as at least one minute, `IMPOSSIBLE_TRAVEL`) and 10 scans of the box within a minute (`EXCESSIVE_SCANS`). The result is `FLAGGED` while the box is flagged and `VALID` otherwise, and `reasons` lists the findings of this scan. The location is optional but both coordinates come together. The impossible travel alert keeps both locations, the distance, the time and the speed, and the unique open-alert index prevents duplicates. Unknown uids raise `TR_BOX_NOT_FOUND` and write nothing.
- `box_flagged(uid)` is true while the box has an unresolved `IMPOSSIBLE_TRAVEL`, `EXCESSIVE_SCANS` or `CODE_BURST` alert, so resolving the alert in the warehouse fraud alert screen clears the flag. Because the scan location and the box code come from the caller, anyone can trigger these alerts for a real box; the administrator resolves such an alert to restore the box.
- `fraud_scan_stats()` returns the scans and flagged scans of the last 24 hours for `SUPER_ADMIN` only. `SUPER_ADMIN` reads the alerts through the existing `fraud_alerts` policy.

### Applying to an existing database

Back up the database first. Run as the database owner:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/quality/public_trace.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/public_trace_test.sql
```

Both scripts can be re-applied.

## Sales reports

`security/reporting/sales_reports.sql` adds read-only dashboard reports for the `REPORT_READ` group (`SUPER_ADMIN`, `ADMIN`, `STORE_MANAGER`, `ACCOUNTANT`, `FINANCE_MANAGER`). `app_role_groups.sql` also gains `FINANCE_READ` for the finance reports. `STORE_MANAGER` always gets its own facility, whatever `facility_id` is passed; other roles get all facilities when it is NULL.

- `orders.created_at` and `customers.created_at` hold UTC wall-clock time; days and months are grouped in `Asia/Ho_Chi_Minh`.
- Revenue: `DELIVERED`, `COMPLETED` and `PARTIALLY_RETURNED` orders minus their `CUSTOMER_REFUND` cashbook expenses, by order creation date. Collected cash: cashbook `INCOME` by transaction date (with a facility, only rows linked to that facility's orders).
- `report_sales_overview(from, to, facility_id)` returns the current and the previous period of the same length: revenue, collected cash, orders, cancelled orders, new customers, first-time buyers and average order value.
- `report_revenue_series(from, to, 'day'|'month', facility_id)` returns one row per bucket, 0 for empty buckets.
- `report_order_status(from, to, facility_id)` returns the count and amount per order status.
- Indexes on `orders(created_at)`, `orders(export_facility_id, created_at)`, `customers(created_at)` and `cashbook_logs(transaction_date)`.

### Applying to an existing database

Back up the database first. Run as the database owner:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/access/app_role_groups.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/reporting/sales_reports.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/dashboard_reports_test.sql
```

All scripts can be re-applied.

## Stock alerts

`security/reporting/stock_alerts.sql` adds stock and expiry alerts for the `STOCK_READ` group (`SUPER_ADMIN`, `ADMIN`, `STORE_MANAGER`, added to `app_role_groups.sql`). `STORE_MANAGER` always gets its own facility, whatever `facility_id` is passed.

- Adds `inventories.min_stock_quantity` (NULL uses the default) and `system_settings.default_min_stock_quantity`.
- `report_stock_alerts(facility_id)` lists inventories with `available = stock_quantity - reserved_quantity` at or below the threshold: `OUT_OF_STOCK` when available is 0 or less, otherwise `LOW_STOCK`.
- `report_expiry_alerts(facility_id, within_days)` groups boxes physically at a facility (`IN_STOCK`, `MANUFACTURED`, `RESERVED`) by batch and facility. `days_left` is counted from today in `Asia/Ho_Chi_Minh`; levels are `EXPIRED`, `LE_30`, `D31_90` and `D91_180`. Expired batches are always listed. `below_min_shelf_life` uses `min_remaining_shelf_life_days` with `default_min_shelf_life_days` as fallback.
- `set_default_min_stock_quantity(quantity)` is for `SUPER_ADMIN`. `set_inventory_min_stock_quantity(inventory_id, quantity)` is for `SUPER_ADMIN` and for a `STORE_MANAGER` on its own facility; a NULL quantity restores the default.

### Applying to an existing database

Back up the database first. Run as the database owner:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/access/app_role_groups.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/reporting/stock_alerts.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/dashboard_reports_test.sql
```

All scripts can be re-applied.

## Finance reports

`security/reporting/report_access.sql` enables RLS on `cashbook_logs` with one select policy for the `FINANCE_READ` group (`SUPER_ADMIN`, `ADMIN`, `ACCOUNTANT`, `FINANCE_MANAGER`). `app_user` can no longer insert, update or delete cashbook rows directly. Every cashbook writer (COD reconciliation, online payment approval, payment exceptions, cancellation, return and approved refunds) is a `SECURITY DEFINER` function owned by a superuser and is unaffected; the table is deliberately not `FORCE`d.

`security/reporting/finance_reports.sql` adds read-only reports for `FINANCE_READ`. Days are grouped in `Asia/Ho_Chi_Minh`. Each function returns `SUMMARY` rows (per party and bucket) and `DETAIL` rows, except the cashbook ones.

- `report_receivables_aging(as_of)`: `OPEN` courier COD receivables (aged from `courier_receivables.created_at`, grouped by courier) plus `DELIVERED` orders paid by `BANK_TRANSFER` or `E_WALLET` whose `payment_status` is not `PAID` (grouped as `Online orders`, aged from the delivery date, falling back to the order date). Buckets: `0_7`, `8_15`, `16_30`, `GT_30` days.
- `report_payables_aging(as_of)`: `accounts_payable` rows with a remaining balance, per supplier. Buckets: `NOT_DUE` (due today or later), `1_30`, `31_60`, `GT_60` days overdue, and `NO_DUE_DATE`.
- `report_cashbook(from, to, payment_method, type, category)`: one `SUMMARY` row for the range and one `DAY` row per day, each with `opening + income - expense = closing`. `payment_method` filters the balances; `type` and `category` only change the `entry_count` of the summary.
- `report_cashbook_entries(from, to, payment_method, type, limit, offset, category)`: entries newest first with `order_code` and `po_code`. A NULL limit returns every entry (CSV export).
- `report_cashbook_categories()`: every category used by the cashbook, for the filter list.

The category filter replaced the earlier four- and six-argument signatures of `report_cashbook` and `report_cashbook_entries`; re-running `finance_reports.sql` drops them.

### Applying to an existing database

Back up the database first. Run as the database owner:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/reporting/report_access.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/reporting/finance_reports.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/dashboard_reports_test.sql
```

All scripts can be re-applied.

## Supplier payments

`security/reporting/supplier_payments.sql` lets finance pay down supplier payables.

- `system_settings.default_supplier_payment_term_days` (default 30). A trigger gives every new `accounts_payable` row without a `due_date` the goods receipt date plus this term (the row's `created_at` when there is no receipt). The script also fills the existing rows that have no due date, once; re-running it changes nothing more. Change the term with a plain `UPDATE public.system_settings`.
- `supplier_payments` keeps one row per payment (amount, method, reference, cashbook entry, employee). `(payment_method, reference)` is unique. The table is not readable by `app_user`; the history comes from `report_payable_payments(ap_id)` for `FINANCE_READ`.
- `record_supplier_payment(ap_id, amount, payment_method, reference)` is for `SUPER_ADMIN` and `FINANCE_MANAGER` only. It locks the payable, rejects an amount above `remaining_balance` and a reference already used with the same method, raises `paid_amount`, sets `PARTIALLY_PAID` or `PAID`, and writes one `EXPENSE` cashbook entry (`SUPPLIER_PAYMENT`, party type `SUPPLIER`, with the purchase order) in the same transaction. It returns the payment id.

### Applying to an existing database

Back up the database first. Run as the database owner:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/reporting/supplier_payments.sql
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/supplier_payments_test.sql
```

All scripts can be re-applied.
