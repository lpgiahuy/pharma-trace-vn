import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { GoodsReceiptDto, GoodsReceiptLineDto } from './dto/goods-receipt.dto';
import { GoodsReceiptService } from './goods-receipt.service';
import { PurchaseOrderService } from './purchase-order.service';

type Actor = { id: number; role: string; type: 'employee'; facilityId: number };

const integration = process.env.WORKFLOW_TEST_DATABASE_URL ? describe : describe.skip;
integration('Goods receipts against the restricted application role', () => {
  let db: Pool, appDb: Pool, prisma: PrismaService, receipts: GoodsReceiptService, orders: PurchaseOrderService;
  let warehouse: number, otherWarehouse: number, manufacturer: number, medicine: number, otherMedicine: number, variant: number;
  let staff: Actor, manager: Actor, otherStaff: Actor, accountant: number;

  const id = async (sql: string, args: unknown[] = []): Promise<number> => Number((await db.query<{ id: number }>(sql, args)).rows[0].id);
  const count = async (sql: string, args: unknown[] = []): Promise<number> => Number((await db.query<{ n: number }>(sql, args)).rows[0].n);
  const uuids = (n: number): string[] => Array.from({ length: n }, () => randomUUID());
  const code = (): string => `GR-${randomUUID().slice(0, 18)}`;

  async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
    try { await promise; } catch (error) { return error instanceof AppException ? error.code : String(error); }
    return undefined;
  }

  async function approvedOrder(quantity = 100, status = 'APPROVED'): Promise<{ po: number; item: number }> {
    const po = await id(
      'INSERT INTO purchase_orders(po_code,supplier_manufacturer_id,facility_id,created_by_employee_id,status) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [`PO-${randomUUID()}`, manufacturer, warehouse, manager.id, status],
    );
    const item = await id('INSERT INTO purchase_order_items(po_id,medicine_id,variant_id,quantity,unit_price) VALUES ($1,$2,$3,$4,10) RETURNING id', [po, medicine, variant, quantity]);
    return { po, item };
  }

  function line(item: number, batchNumber: string, extra: Partial<GoodsReceiptLineDto> = {}): GoodsReceiptLineDto {
    return { poItemId: item, batchNumber, productionDate: '2026-01-01', expiryDate: '2028-01-01', ...extra };
  }

  const receipt = (lines: GoodsReceiptLineDto[], receiptCode = code()): GoodsReceiptDto => ({ receiptCode, lines });
  const stock = async (): Promise<number> => count('SELECT coalesce(sum(stock_quantity),0)::int AS n FROM inventories WHERE facility_id=$1 AND variant_id=$2', [warehouse, variant]);
  const quarantine = async (): Promise<number> => count('SELECT coalesce(sum(quantity),0)::int AS n FROM quarantine_balances WHERE facility_id=$1 AND variant_id=$2', [warehouse, variant]);

  beforeAll(async () => {
    const url = new URL(process.env.WORKFLOW_TEST_DATABASE_URL ?? '');
    if (url.pathname !== '/codex_goods_receipt_20261118') throw new Error('Use the dedicated goods receipt test database');
    db = new Pool({ connectionString: url.toString() });
    url.searchParams.set('options', '-c role=app_user');
    appDb = new Pool({ connectionString: url.toString() });
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url.toString(); prisma = new PrismaService();
    if (original === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original;
    await prisma.onModuleInit();
    receipts = new GoodsReceiptService(prisma, {} as CloudinaryService);
    orders = new PurchaseOrderService(prisma);

    warehouse = await id("INSERT INTO facilities(facility_name,facility_type) VALUES ('Receipt warehouse','CENTRAL_WAREHOUSE') RETURNING id");
    otherWarehouse = await id("INSERT INTO facilities(facility_name,facility_type) VALUES ('Other warehouse','BRANCH_WAREHOUSE') RETURNING id");
    manufacturer = await id('INSERT INTO manufacturers(name) VALUES ($1) RETURNING id', [`Receipt manufacturer ${randomUUID()}`]);
    const employee = (role: string, facility: number) => id('INSERT INTO employees(full_name,role,status,facility_id) VALUES ($1,$2,$3,$4) RETURNING id', [`Receipt ${role}`, role, 'ACTIVE', facility]);
    staff = { id: await employee('WAREHOUSE_STAFF', warehouse), role: 'WAREHOUSE_STAFF', type: 'employee', facilityId: warehouse };
    manager = { id: await employee('WAREHOUSE_MANAGER', warehouse), role: 'WAREHOUSE_MANAGER', type: 'employee', facilityId: warehouse };
    otherStaff = { id: await employee('WAREHOUSE_STAFF', otherWarehouse), role: 'WAREHOUSE_STAFF', type: 'employee', facilityId: otherWarehouse };
    accountant = await employee('ACCOUNTANT', warehouse);
    medicine = await id("INSERT INTO medicines(medicine_name) VALUES ('Receipt medicine') RETURNING id");
    otherMedicine = await id("INSERT INTO medicines(medicine_name) VALUES ('Other receipt medicine') RETURNING id");
    variant = await id("INSERT INTO packaging_variants(medicine_id,unit_name,price) VALUES ($1,'Box',100) RETURNING id", [medicine]);
  });
  afterAll(async () => { await prisma?.onModuleDestroy(); await db?.end(); await appDb?.end(); });

  it('receives 100 ordered boxes as 60 with 5 rejected, then 40, with stock, quarantine and two payables', async () => {
    const { po, item } = await approvedOrder();
    const lot = `LOT-${randomUUID()}`;
    const [stockBefore, quarantineBefore] = [await stock(), await quarantine()];

    const first = await receipts.receive(staff, po, receipt([line(item, lot, { boxUids: uuids(55), rejectedBoxUids: uuids(5), rejectReason: 'Crushed boxes' })]));
    expect(first.purchase_orders.status).toBe('PARTIALLY_RECEIVED');
    expect(first.goods_receipt_lines[0]).toMatchObject({ quantity_accepted: 55, quantity_rejected: 5, reject_reason: 'Crushed boxes' });

    const second = await receipts.receive(staff, po, receipt([line(item, lot, { boxUids: uuids(40) })]));
    expect(second.purchase_orders.status).toBe('RECEIVED');
    expect(await stock()).toBe(stockBefore + 95);
    expect(await quarantine()).toBe(quarantineBefore + 5);
    expect(await count('SELECT received_quantity AS n FROM purchase_order_items WHERE id=$1', [item])).toBe(100);
    expect(await count("SELECT count(*)::int AS n FROM medicine_boxes b JOIN batches l ON l.id=b.batch_id WHERE l.batch_number=$1 AND b.current_facility_id=$2 AND b.status='QUARANTINED'", [lot, warehouse])).toBe(5);
    expect(await count("SELECT count(*)::int AS n FROM purchase_order_events WHERE po_id=$1 AND action='GOODS_RECEIVED'", [po])).toBe(2);
    expect((await db.query<{ received_at: Date | null }>('SELECT received_at FROM purchase_orders WHERE id=$1', [po])).rows[0].received_at).not.toBeNull();

    const client = await appDb.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_type','employee',true), set_config('app.current_user_role','ACCOUNTANT',true), set_config('app.current_user_id',$1,true)", [String(accountant)]);
      const payables = await client.query<{ total_due_amount: string; goods_receipt_id: number }>('SELECT total_due_amount, goods_receipt_id FROM accounts_payable WHERE po_id=$1 ORDER BY id', [po]);
      expect(payables.rows).toEqual([{ total_due_amount: '550.00', goods_receipt_id: first.id }, { total_due_amount: '400.00', goods_receipt_id: second.id }]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('returns the existing receipt when the same receipt code is sent again', async () => {
    const { po, item } = await approvedOrder();
    const dto = receipt([line(item, `LOT-${randomUUID()}`, { boxUids: uuids(10) })]);
    const first = await receipts.receive(staff, po, dto);
    const again = await receipts.receive(staff, po, { ...dto, lines: [line(item, `LOT-${randomUUID()}`, { boxUids: uuids(3) })] });
    expect(again.id).toBe(first.id);
    expect(await count('SELECT count(*)::int AS n FROM goods_receipts WHERE po_id=$1', [po])).toBe(1);
    expect(await count('SELECT received_quantity AS n FROM purchase_order_items WHERE id=$1', [item])).toBe(10);

    const other = await approvedOrder();
    expect(await errorCode(receipts.receive(staff, other.po, { ...dto, lines: [line(other.item, `LOT-${randomUUID()}`, { boxUids: uuids(1) })] })))
      .toBe('GR_CODE_CONFLICT');
  });

  it('never lets two concurrent receipts exceed the ordered quantity', async () => {
    const { po, item } = await approvedOrder();
    const lot = `LOT-${randomUUID()}`;
    const results = await Promise.allSettled([
      receipts.receive(staff, po, receipt([line(item, lot, { boxUids: uuids(60) })])),
      receipts.receive(manager, po, receipt([line(item, lot, { boxUids: uuids(60) })])),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find(result => result.status === 'rejected');
    expect(failed?.status === 'rejected' && failed.reason instanceof AppException ? failed.reason.code : undefined).toBe('GR_OVER_RECEIPT');
    expect(await count('SELECT received_quantity AS n FROM purchase_order_items WHERE id=$1', [item])).toBe(60);
    expect(await count('SELECT count(*)::int AS n FROM goods_receipts WHERE po_id=$1', [po])).toBe(1);
  });

  it('creates one receipt when the same receipt code arrives twice at the same time', async () => {
    const { po, item } = await approvedOrder();
    const dto = receipt([line(item, `LOT-${randomUUID()}`, { boxUids: uuids(5) })]);
    const [a, b] = await Promise.all([receipts.receive(staff, po, dto), receipts.receive(staff, po, dto)]);
    expect(a.id).toBe(b.id);
    expect(await count('SELECT received_quantity AS n FROM purchase_order_items WHERE id=$1', [item])).toBe(5);
  });

  it('accepts every box of a scanned SSCC carton of the declared batch', async () => {
    const { po, item } = await approvedOrder();
    const lot = `LOT-${randomUUID()}`;
    const batch = await id("INSERT INTO batches(batch_number,medicine_id,production_date,expiry_date,status) VALUES ($1,$2,'2026-01-01','2028-01-01','ACTIVE') RETURNING id", [lot, medicine]);
    const sscc = `SSCC-${randomUUID().slice(0, 20)}`;
    const carton = await id('INSERT INTO sscc_cartons(sscc_code,batch_id,box_count) VALUES ($1,$2,3) RETURNING id', [sscc, batch]);
    await db.query("INSERT INTO medicine_boxes(batch_id,carton_id,status) SELECT $1,$2,'MANUFACTURED' FROM generate_series(1,3)", [batch, carton]);

    const result = await receipts.receive(staff, po, receipt([line(item, lot, { ssccCodes: [sscc], boxUids: uuids(1) })]));
    expect(result.goods_receipt_lines[0].quantity_accepted).toBe(4);
    expect(await count('SELECT count(*)::int AS n FROM medicine_boxes WHERE carton_id=$1 AND current_facility_id=$2', [carton, warehouse])).toBe(3);
    expect(await count('SELECT count(*)::int AS n FROM sscc_cartons WHERE id=$1 AND current_facility_id=$2', [carton, warehouse])).toBe(1);
    expect(await errorCode(receipts.receive(staff, po, receipt([line(item, lot, { ssccCodes: [sscc] })])))).toBe('GR_CARTON_UNAVAILABLE');
  });

  describe('rejections', () => {
    it('rejects receipts above the ordered quantity', async () => {
      const { po, item } = await approvedOrder(10);
      expect(await errorCode(receipts.receive(staff, po, receipt([line(item, `LOT-${randomUUID()}`, { boxUids: uuids(11) })])))).toBe('GR_OVER_RECEIPT');
    });

    it('rejects orders that are not approved or partially received', async () => {
      for (const status of ['PENDING', 'CANCELLED', 'RECEIVED', 'CLOSED']) {
        const { po, item } = await approvedOrder(10, status);
        expect(await errorCode(receipts.receive(staff, po, receipt([line(item, `LOT-${randomUUID()}`, { boxUids: uuids(1) })])))).toBe('GR_PO_NOT_RECEIVABLE');
      }
    });

    it('rejects a batch number that belongs to another medicine', async () => {
      const { po, item } = await approvedOrder();
      const lot = `LOT-${randomUUID()}`;
      await db.query("INSERT INTO batches(batch_number,medicine_id,production_date,expiry_date) VALUES ($1,$2,'2026-01-01','2028-01-01')", [lot, otherMedicine]);
      expect(await errorCode(receipts.receive(staff, po, receipt([line(item, lot, { boxUids: uuids(1) })])))).toBe('GR_BATCH_MEDICINE_MISMATCH');
    });

    it('rejects an existing batch declared with other dates', async () => {
      const { po, item } = await approvedOrder();
      const lot = `LOT-${randomUUID()}`;
      await db.query("INSERT INTO batches(batch_number,medicine_id,production_date,expiry_date) VALUES ($1,$2,'2026-01-01','2028-01-01')", [lot, medicine]);
      expect(await errorCode(receipts.receive(staff, po, receipt([line(item, lot, { expiryDate: '2029-01-01', boxUids: uuids(1) })])))).toBe('GR_BATCH_DATES_MISMATCH');
    });

    it('rejects a new batch whose production date is not before its expiry date', async () => {
      const { po, item } = await approvedOrder();
      const dto = receipt([line(item, `LOT-${randomUUID()}`, { productionDate: '2028-01-01', expiryDate: '2028-01-01', boxUids: uuids(1) })]);
      expect(await errorCode(receipts.receive(staff, po, dto))).toBe('GR_BATCH_INVALID');
    });

    it('rejects a box of another batch and names it', async () => {
      const { po, item } = await approvedOrder();
      const other = await id("INSERT INTO batches(batch_number,medicine_id,production_date,expiry_date) VALUES ($1,$2,'2026-01-01','2028-01-01') RETURNING id", [`LOT-${randomUUID()}`, medicine]);
      const box = (await db.query<{ uid: string }>("INSERT INTO medicine_boxes(batch_id,status) VALUES ($1,'MANUFACTURED') RETURNING uid", [other])).rows[0].uid;
      try {
        await receipts.receive(staff, po, receipt([line(item, `LOT-${randomUUID()}`, { boxUids: [box] })]));
        throw new Error('accepted');
      } catch (error) {
        expect(error instanceof AppException ? [error.code, error.details] : error).toEqual(['GR_BOX_WRONG_BATCH', { value: box }]);
      }
    });

    it('rejects a box that was already received', async () => {
      const { po, item } = await approvedOrder();
      const lot = `LOT-${randomUUID()}`;
      const boxes = uuids(2);
      await receipts.receive(staff, po, receipt([line(item, lot, { boxUids: boxes })]));
      expect(await errorCode(receipts.receive(staff, po, receipt([line(item, lot, { boxUids: [boxes[0]] })])))).toBe('GR_BOX_UNAVAILABLE');
    });

    it('rejects a box scanned twice in one receipt', async () => {
      const { po, item } = await approvedOrder();
      const [box] = uuids(1);
      expect(await errorCode(receipts.receive(staff, po, receipt([line(item, `LOT-${randomUUID()}`, { boxUids: [box], rejectedBoxUids: [box], rejectReason: 'Damaged' })]))))
        .toBe('GR_BOX_DUPLICATE');
    });

    it('requires a reason for rejected boxes', async () => {
      const { po, item } = await approvedOrder();
      expect(await errorCode(receipts.receive(staff, po, receipt([line(item, `LOT-${randomUUID()}`, { rejectedBoxUids: uuids(1) })])))).toBe('GR_REJECT_REASON_REQUIRED');
    });

    it('rejects a line of another purchase order and a line without scans', async () => {
      const { po, item } = await approvedOrder();
      const other = await approvedOrder();
      expect(await errorCode(receipts.receive(staff, po, receipt([line(other.item, `LOT-${randomUUID()}`, { boxUids: uuids(1) })])))).toBe('GR_LINE_INVALID');
      expect(await errorCode(receipts.receive(staff, po, receipt([line(item, `LOT-${randomUUID()}`)])))).toBe('GR_LINE_EMPTY');
    });

    it('rejects a carton of another batch', async () => {
      const { po, item } = await approvedOrder();
      const other = await id("INSERT INTO batches(batch_number,medicine_id,production_date,expiry_date) VALUES ($1,$2,'2026-01-01','2028-01-01') RETURNING id", [`LOT-${randomUUID()}`, medicine]);
      const sscc = `SSCC-${randomUUID().slice(0, 20)}`;
      await db.query('INSERT INTO sscc_cartons(sscc_code,batch_id) VALUES ($1,$2)', [sscc, other]);
      expect(await errorCode(receipts.receive(staff, po, receipt([line(item, `LOT-${randomUUID()}`, { ssccCodes: [sscc] })])))).toBe('GR_CARTON_WRONG_BATCH');
      expect(await errorCode(receipts.receive(staff, po, receipt([line(item, `LOT-${randomUUID()}`, { ssccCodes: ['SSCC-UNKNOWN'] })])))).toBe('GR_CARTON_INVALID');
    });

    it('hides the order from another warehouse', async () => {
      const { po, item } = await approvedOrder();
      expect(await errorCode(receipts.receive(otherStaff, po, receipt([line(item, `LOT-${randomUUID()}`, { boxUids: uuids(1) })])))).toBe('PO_NOT_FOUND');
      expect(await errorCode(receipts.detail(otherStaff, po, 1))).toBe('GR_NOT_FOUND');
    });

    it('leaves nothing behind when a receipt is rejected', async () => {
      const { po, item } = await approvedOrder(10);
      const lot = `LOT-${randomUUID()}`;
      const boxes = uuids(11);
      expect(await errorCode(receipts.receive(staff, po, receipt([line(item, lot, { boxUids: boxes })])))).toBe('GR_OVER_RECEIPT');
      expect(await count('SELECT count(*)::int AS n FROM goods_receipts WHERE po_id=$1', [po])).toBe(0);
      expect(await count('SELECT count(*)::int AS n FROM batches WHERE batch_number=$1', [lot])).toBe(0);
      expect(await count('SELECT count(*)::int AS n FROM medicine_boxes WHERE uid = ANY($1::uuid[])', [boxes])).toBe(0);
    });
  });

  it('closes a partially received order with a reason and stops further receipts', async () => {
    const { po, item } = await approvedOrder();
    expect(await errorCode(orders.close(manager, po, 'Too early'))).toBe('PO_INVALID_TRANSITION');
    await receipts.receive(staff, po, receipt([line(item, `LOT-${randomUUID()}`, { boxUids: uuids(30) })]));
    const closed = await orders.close(manager, po, '  Supplier cannot deliver the rest ');
    expect(closed).toMatchObject({ status: 'CLOSED', closed_reason: 'Supplier cannot deliver the rest' });
    expect(closed.purchase_order_events.at(-1)).toMatchObject({ action: 'CLOSED', from_status: 'PARTIALLY_RECEIVED', to_status: 'CLOSED' });
    expect(closed.goods_receipts).toHaveLength(1);
    expect(await errorCode(receipts.receive(staff, po, receipt([line(item, `LOT-${randomUUID()}`, { boxUids: uuids(1) })])))).toBe('GR_PO_NOT_RECEIVABLE');
  });
});
