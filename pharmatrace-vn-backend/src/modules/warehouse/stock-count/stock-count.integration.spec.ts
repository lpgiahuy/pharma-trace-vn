import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PrismaService } from '../../../prisma/prisma.service';
import { StockCountService } from './stock-count.service';

const integration = process.env.WORKFLOW_TEST_DATABASE_URL ? describe : describe.skip;
integration('Stock counts and adjustments with the restricted application role', () => {
  let db: Pool, prisma: PrismaService, counts: StockCountService;
  let warehouse: number, otherWarehouse: number, manager: number, staff: number, outsider: number;
  const id = async (sql: string, args: unknown[] = []) => Number((await db.query(sql, args)).rows[0].id);
  const actor = (employee: number, role: string, facilityId: number) => ({ id: employee, role, type: 'employee' as const, facilityId });
  const managerActor = () => actor(manager, 'WAREHOUSE_MANAGER', warehouse);
  const staffActor = () => actor(staff, 'WAREHOUSE_STAFF', warehouse);
  const code = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const url = new URL(process.env.WORKFLOW_TEST_DATABASE_URL!);
    if (url.pathname !== '/codex_stock_count_20261120') throw new Error('Use the dedicated stock count test database');
    db = new Pool({ connectionString: url.toString() });
    url.searchParams.set('options', '-c role=app_user');
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url.toString(); prisma = new PrismaService();
    if (original === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original;
    await prisma.onModuleInit();
    counts = new StockCountService(prisma);
    warehouse = await id("INSERT INTO facilities(facility_name,facility_type) VALUES ('Count warehouse','CENTRAL_WAREHOUSE') RETURNING id");
    otherWarehouse = await id("INSERT INTO facilities(facility_name,facility_type) VALUES ('Other count warehouse','BRANCH_WAREHOUSE') RETURNING id");
    manager = await id("INSERT INTO employees(full_name,role,facility_id) VALUES ('Count manager','WAREHOUSE_MANAGER',$1) RETURNING id", [warehouse]);
    staff = await id("INSERT INTO employees(full_name,role,facility_id) VALUES ('Count staff','WAREHOUSE_STAFF',$1) RETURNING id", [warehouse]);
    outsider = await id("INSERT INTO employees(full_name,role,facility_id) VALUES ('Other manager','WAREHOUSE_MANAGER',$1) RETURNING id", [otherWarehouse]);
  });
  afterAll(async () => { await prisma?.onModuleDestroy(); await db?.end(); });

  /** One batch with `boxes` IN_STOCK boxes and `reserved` RESERVED boxes; stock covers all of them. */
  async function stocked(boxes: number, reserved: number) {
    const medicine = await id("INSERT INTO medicines(medicine_name,status) VALUES ($1,'ACTIVE') RETURNING id", [`Count medicine ${randomUUID()}`]);
    const variant = await id("INSERT INTO packaging_variants(medicine_id,unit_name,price) VALUES ($1,'Box',100) RETURNING id", [medicine]);
    const batch = await id("INSERT INTO batches(batch_number,medicine_id,production_date,expiry_date,status) VALUES ($1,$2,current_date-1,current_date+365,'ACTIVE') RETURNING id", [randomUUID(), medicine]);
    await db.query("INSERT INTO medicine_boxes(batch_id,current_facility_id,status) SELECT $1,$2,'IN_STOCK' FROM generate_series(1,$3)", [batch, warehouse, boxes]);
    await db.query("INSERT INTO medicine_boxes(batch_id,current_facility_id,status) SELECT $1,$2,'RESERVED' FROM generate_series(1,$3)", [batch, warehouse, reserved]);
    await db.query('INSERT INTO inventories(facility_id,medicine_id,variant_id,stock_quantity,reserved_quantity) VALUES ($1,$2,$3,$4,$5)', [warehouse, medicine, variant, boxes + reserved, reserved]);
    return { medicine, variant, batch };
  }
  const state = async (batch: number, variant: number) => ({
    stock: Number((await db.query('SELECT stock_quantity FROM inventories WHERE facility_id=$1 AND variant_id=$2', [warehouse, variant])).rows[0].stock_quantity),
    onHand: Number((await db.query("SELECT count(*) FROM medicine_boxes WHERE batch_id=$1 AND current_facility_id=$2 AND status<>'MISSING'", [batch, warehouse])).rows[0].count),
    logged: Number((await db.query("SELECT coalesce(sum(quantity_changed),0) AS n FROM inventory_logs WHERE batch_id=$1 AND transaction_type LIKE 'ADJUSTMENT%'", [batch])).rows[0].n),
  });

  async function submitted(batch: number, counted: number) {
    const opened = await counts.open(managerActor(), { countCode: code('SC-OPEN'), batchId: batch });
    await counts.saveLines(staffActor(), opened.id, { lines: [{ batchId: batch, countedQuantity: counted }] });
    return counts.submit(staffActor(), opened.id);
  }

  it('books a counted loss once when two managers approve at the same time', async () => {
    const { variant, batch } = await stocked(8, 2);
    const count = await submitted(batch, 7);
    const results = await Promise.allSettled([counts.approve(managerActor(), count.id), counts.approve(managerActor(), count.id)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await state(batch, variant)).toEqual({ stock: 7, onHand: 7, logged: -3 });
  });

  it('compares the counted units with the stock at approval and warns about movements', async () => {
    const { variant, batch } = await stocked(10, 0);
    const count = await submitted(batch, 9);
    await db.query("UPDATE medicine_boxes SET status='DELIVERED', current_facility_id=NULL WHERE uid=(SELECT uid FROM medicine_boxes WHERE batch_id=$1 AND status='IN_STOCK' LIMIT 1)", [batch]);
    await db.query('UPDATE inventories SET stock_quantity=9 WHERE facility_id=$1 AND variant_id=$2', [warehouse, variant]);
    const waiting = await counts.detail(managerActor(), count.id);
    expect(waiting.lines[0]).toMatchObject({ systemQuantity: 10, currentQuantity: 9, movedSinceOpen: true });
    const approved = await counts.approve(managerActor(), count.id);
    expect(approved.status).toBe('APPROVED');
    expect(approved.lines[0]).toMatchObject({ countedQuantity: 9, currentQuantity: 9, difference: 0 });
    expect(await state(batch, variant)).toEqual({ stock: 9, onHand: 9, logged: 0 });
  });

  it('never adjusts below the reserved units or the unreserved boxes on hand', async () => {
    const { variant, batch } = await stocked(3, 2);
    await expect(counts.adjust(managerActor(), { adjustmentCode: code('ADJ'), batchId: batch, quantityChange: -4, reason: 'Crushed' }))
      .rejects.toMatchObject({ code: 'SC_BELOW_RESERVED' });
    await counts.adjust(managerActor(), { adjustmentCode: code('ADJ'), batchId: batch, quantityChange: -3, reason: 'Crushed' });
    expect(await state(batch, variant)).toEqual({ stock: 2, onHand: 2, logged: -3 });
    await expect(counts.adjust(managerActor(), { adjustmentCode: code('ADJ'), batchId: batch, quantityChange: -1, reason: 'Crushed' }))
      .rejects.toMatchObject({ code: 'SC_BELOW_RESERVED' });
  });

  it('books a repeated adjustment code once, even when sent at the same time', async () => {
    const { variant, batch } = await stocked(5, 0);
    const adjustmentCode = code('ADJ');
    const dto = { adjustmentCode, batchId: batch, quantityChange: -2, reason: 'Expired samples' };
    const [first, second] = await Promise.all([counts.adjust(managerActor(), dto), counts.adjust(managerActor(), dto)]);
    expect(first.logId).toBe(second.logId);
    expect(await state(batch, variant)).toEqual({ stock: 3, onHand: 3, logged: -2 });
  });

  it('restores only boxes recorded as missing', async () => {
    const { variant, batch } = await stocked(5, 0);
    await counts.adjust(managerActor(), { adjustmentCode: code('ADJ'), batchId: batch, quantityChange: -2, reason: 'Not on the shelf' });
    await expect(counts.adjust(managerActor(), { adjustmentCode: code('ADJ'), batchId: batch, quantityChange: 3, reason: 'Found' }))
      .rejects.toMatchObject({ code: 'SC_GAIN_UNKNOWN_BOXES' });
    await counts.adjust(managerActor(), { adjustmentCode: code('ADJ'), batchId: batch, quantityChange: 2, reason: 'Found in the cold room' });
    expect(await state(batch, variant)).toEqual({ stock: 5, onHand: 5, logged: 0 });
  });

  it('keeps counts of one warehouse away from another', async () => {
    const { batch } = await stocked(2, 0);
    const count = await submitted(batch, 2);
    const other = actor(outsider, 'WAREHOUSE_MANAGER', otherWarehouse);
    await expect(counts.detail(other, count.id)).rejects.toMatchObject({ code: 'SC_NOT_FOUND' });
    await expect(counts.approve(other, count.id)).rejects.toMatchObject({ code: 'SC_NOT_FOUND' });
    await expect(counts.open(other, { countCode: code('SC-OPEN'), batchId: batch })).rejects.toMatchObject({ code: 'SC_COUNT_EMPTY' });
  });
});
