import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminOrderService } from '../../order/admin-order.service';
import { OrderService } from '../../order/order.service';
import { FulfillmentService } from './fulfillment.service';

const integration = process.env.WORKFLOW_TEST_DATABASE_URL ? describe : describe.skip;
integration('Order packing against customer cancellation with the restricted application role', () => {
  let db: Pool, prisma: PrismaService, fulfillment: FulfillmentService, orders: OrderService;
  let warehouse: number, staff: number, customer: number;
  const id = async (sql: string, args: unknown[] = []) => Number((await db.query(sql, args)).rows[0].id);
  const staffActor = () => ({ id: staff, role: 'WAREHOUSE_STAFF', type: 'employee' as const, facilityId: warehouse });

  beforeAll(async () => {
    const url = new URL(process.env.WORKFLOW_TEST_DATABASE_URL!);
    if (url.pathname !== '/codex_order_packing_20261119') throw new Error('Use the dedicated order packing test database');
    db = new Pool({ connectionString: url.toString() });
    url.searchParams.set('options', '-c role=app_user');
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url.toString(); prisma = new PrismaService();
    if (original === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original;
    await prisma.onModuleInit();
    fulfillment = new FulfillmentService(prisma, new AdminOrderService(prisma));
    orders = new OrderService(prisma);
    warehouse = await id("INSERT INTO facilities(facility_name,facility_type) VALUES ('Packing warehouse','CENTRAL_WAREHOUSE') RETURNING id");
    staff = await id("INSERT INTO employees(full_name,role,facility_id) VALUES ('Packing staff','WAREHOUSE_STAFF',$1) RETURNING id", [warehouse]);
    customer = await id("INSERT INTO customers(full_name) VALUES ('Packing customer') RETURNING id");
  });
  afterAll(async () => { await prisma?.onModuleDestroy(); await db?.end(); });

  async function reservedOrder(): Promise<{ order: number; box: string }> {
    const medicine = await id("INSERT INTO medicines(medicine_name,status) VALUES ('Packing medicine','ACTIVE') RETURNING id");
    const variant = await id("INSERT INTO packaging_variants(medicine_id,unit_name,price) VALUES ($1,'Box',100) RETURNING id", [medicine]);
    const batch = await id("INSERT INTO batches(batch_number,medicine_id,production_date,expiry_date,status) VALUES ($1,$2,current_date-1,current_date+365,'ACTIVE') RETURNING id", [randomUUID(), medicine]);
    const box = (await db.query("INSERT INTO medicine_boxes(batch_id,current_facility_id,status) VALUES ($1,$2,'RESERVED') RETURNING uid", [batch, warehouse])).rows[0].uid as string;
    await db.query('INSERT INTO inventories(facility_id,variant_id,stock_quantity,reserved_quantity) VALUES ($1,$2,1,1)', [warehouse, variant]);
    const order = await id("INSERT INTO orders(order_code,customer_id,export_facility_id,order_status,payment_method) VALUES ($1,$2,$3,'PROCESSING','COD') RETURNING id", [`PACK-${randomUUID().slice(0, 8)}`, customer, warehouse]);
    await db.query("INSERT INTO order_items(order_id,medicine_id,variant_id,medicine_name,unit_name,quantity,assigned_uids,inventory_reserved) VALUES ($1,$2,$3,'Packing medicine','Box',1,ARRAY[$4]::uuid[],true)", [order, medicine, variant, box]);
    return { order, box };
  }

  it.each([1, 2, 3])('lets exactly one of customer cancellation and packing completion win (run %i)', async () => {
    const { order, box } = await reservedOrder();
    await fulfillment.addPackage(staffActor(), order, { packageCode: `PKG-${randomUUID().slice(0, 8)}`, boxUids: [box] });

    const results = await Promise.allSettled([
      orders.cancelMyOrder(customer, order, { reasonCode: 'CHANGED_MIND' }),
      fulfillment.completePacking(staffActor(), order, {}),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);

    const state = (await db.query(
      `SELECT o.order_status, b.status AS box_status, p.status AS package_status, (SELECT count(*)::int FROM shipments s WHERE s.order_id = o.id) AS shipments
       FROM orders o JOIN order_packages p ON p.order_id = o.id JOIN medicine_boxes b ON b.uid = $2 WHERE o.id = $1`, [order, box])).rows[0];
    if (results[0].status === 'fulfilled') {
      expect(state).toMatchObject({ order_status: 'CANCELLED', package_status: 'VOID', shipments: 0 });
      expect(state.box_status).not.toBe('PACKAGED');
    } else {
      expect(state).toEqual({ order_status: 'PENDING_PICKUP', box_status: 'PACKAGED', package_status: 'PACKED', shipments: 1 });
    }
  });
});
