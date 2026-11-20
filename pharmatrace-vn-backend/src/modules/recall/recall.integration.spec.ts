import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { findSellableBoxUids } from '../../common/inventory/box.helper';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminOrderService } from '../order/admin-order.service';
import { FulfillmentService } from '../warehouse/fulfillment/fulfillment.service';
import { RecallService } from './recall.service';

const integration = process.env.WORKFLOW_TEST_DATABASE_URL ? describe : describe.skip;
integration('Batch recalls with the restricted application role', () => {
  let db: Pool, prisma: PrismaService, recalls: RecallService, fulfillment: FulfillmentService;
  let warehouse: number, admin: number, manager: number, staff: number;
  const id = async (sql: string, args: unknown[] = []) => Number((await db.query(sql, args)).rows[0].id);
  const adminActor = () => ({ id: admin, role: 'SUPER_ADMIN', type: 'employee' as const });
  const managerActor = () => ({ id: manager, role: 'WAREHOUSE_MANAGER', type: 'employee' as const, facilityId: warehouse });
  const staffActor = () => ({ id: staff, role: 'WAREHOUSE_STAFF', type: 'employee' as const, facilityId: warehouse });
  const code = () => `RCL-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const url = new URL(process.env.WORKFLOW_TEST_DATABASE_URL!);
    if (url.pathname !== '/codex_batch_recall_20261120') throw new Error('Use the dedicated batch recall test database');
    db = new Pool({ connectionString: url.toString() });
    url.searchParams.set('options', '-c role=app_user');
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url.toString(); prisma = new PrismaService();
    if (original === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original;
    await prisma.onModuleInit();
    recalls = new RecallService(prisma);
    fulfillment = new FulfillmentService(prisma, new AdminOrderService(prisma));
    warehouse = await id("INSERT INTO facilities(facility_name,facility_type) VALUES ('Recall warehouse','CENTRAL_WAREHOUSE') RETURNING id");
    admin = await id("INSERT INTO employees(full_name,role) VALUES ('Recall admin','SUPER_ADMIN') RETURNING id");
    manager = await id("INSERT INTO employees(full_name,role,facility_id) VALUES ('Recall manager','WAREHOUSE_MANAGER',$1) RETURNING id", [warehouse]);
    staff = await id("INSERT INTO employees(full_name,role,facility_id) VALUES ('Recall staff','WAREHOUSE_STAFF',$1) RETURNING id", [warehouse]);
  });
  afterAll(async () => { await prisma?.onModuleDestroy(); await db?.end(); });

  /** A batch with 5 boxes in stock, 1 box reserved for an unpacked order and 1 delivered box. */
  async function stocked() {
    const medicine = await id("INSERT INTO medicines(medicine_name,status) VALUES ($1,'ACTIVE') RETURNING id", [`Recall medicine ${randomUUID()}`]);
    const variant = await id("INSERT INTO packaging_variants(medicine_id,unit_name,price) VALUES ($1,'Box',100) RETURNING id", [medicine]);
    const batch = await id("INSERT INTO batches(batch_number,medicine_id,production_date,expiry_date,status) VALUES ($1,$2,current_date-1,current_date+365,'ACTIVE') RETURNING id", [randomUUID(), medicine]);
    await db.query("INSERT INTO medicine_boxes(batch_id,current_facility_id,status) SELECT $1,$2,'IN_STOCK' FROM generate_series(1,5)", [batch, warehouse]);
    await db.query("INSERT INTO medicine_boxes(batch_id,current_facility_id,status) VALUES ($1,NULL,'DELIVERED')", [batch]);
    const box = (await db.query("INSERT INTO medicine_boxes(batch_id,current_facility_id,status) VALUES ($1,$2,'RESERVED') RETURNING uid", [batch, warehouse])).rows[0].uid as string;
    await db.query('INSERT INTO inventories(facility_id,variant_id,stock_quantity,reserved_quantity) VALUES ($1,$2,6,1)', [warehouse, variant]);
    const order = await id("INSERT INTO orders(order_code,export_facility_id,order_status,payment_method) VALUES ($1,$2,'PROCESSING','COD') RETURNING id", [`RCL-${randomUUID().slice(0, 8)}`, warehouse]);
    await db.query("INSERT INTO order_items(order_id,medicine_id,variant_id,medicine_name,unit_name,quantity,assigned_uids,inventory_reserved) VALUES ($1,$2,$3,'Recall medicine','Box',1,ARRAY[$4]::uuid[],true)", [order, medicine, variant, box]);
    return { medicine, variant, batch, order, box };
  }

  it('refuses a recall created by a warehouse manager', async () => {
    const { batch } = await stocked();
    await expect(recalls.create(managerActor(), { recallCode: code(), reason: 'Contamination', severity: 'LEVEL_1', batchIds: [batch] }))
      .rejects.toMatchObject({ code: 'RC_FORBIDDEN' });
    expect((await db.query('SELECT status FROM batches WHERE id=$1', [batch])).rows[0].status).toBe('ACTIVE');
  });

  it('blocks checkout and packing of the batch and reports every box', async () => {
    const { medicine, variant, batch, order, box } = await stocked();
    const recall = await recalls.create(adminActor(), { recallCode: code(), reason: 'Contamination', severity: 'LEVEL_1', batchIds: [batch] });

    const checkout = await prisma.withOrder('read', async tx => ({
      boxes: await findSellableBoxUids(tx, warehouse, medicine, 1),
      inventory: await tx.inventories.findFirstOrThrow({ where: { facility_id: warehouse, variant_id: variant } }),
    }), staffActor());
    expect(checkout.boxes).toEqual([]);
    expect(checkout.inventory.stock_quantity - (checkout.inventory.reserved_quantity ?? 0)).toBe(0);

    const packing = await fulfillment.addPackage(staffActor(), order, { packageCode: `PKG-${randomUUID().slice(0, 8)}`, boxUids: [box] }).catch((error: unknown) => error);
    expect(packing).toBeInstanceOf(AppException);
    expect(packing).toMatchObject({ code: 'PK_BOX_NOT_SELLABLE' });

    const impact = await recalls.impact(adminActor(), recall.id);
    const boxCount = Number((await db.query('SELECT count(*) FROM medicine_boxes WHERE batch_id=$1', [batch])).rows[0].count);
    expect(impact.totalBoxes).toBe(boxCount);
    expect(impact.byLocation).toEqual({ FACILITY: 6, IN_TRANSIT: 0, DELIVERED: 1, OTHER: 0 });

    const tasks = await recalls.tasks(managerActor(), {});
    expect(tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ recallId: recall.id, kind: 'QUARANTINED_STOCK', quantity: 5 }),
      expect.objectContaining({ recallId: recall.id, kind: 'ORDER_TO_RESOLVE', orderId: order }),
    ]));
    expect((await db.query('SELECT order_status FROM orders WHERE id=$1', [order])).rows[0].order_status).toBe('PROCESSING');
  });
});
