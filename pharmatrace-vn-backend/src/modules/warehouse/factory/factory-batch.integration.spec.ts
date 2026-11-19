import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { AppException } from '../../../common/errors/app-exception';
import { CryptoUtil } from '../../../common/utils/crypto.util';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateFactoryBatchDto } from './dto/factory-batch.dto';
import { FactoryBatchService } from './factory-batch.service';

type Actor = { id: number; role: string; type: 'employee'; facilityId?: number };

const integration = process.env.WORKFLOW_TEST_DATABASE_URL ? describe : describe.skip;
integration('Factory batch intake against the restricted application role', () => {
  let db: Pool, prisma: PrismaService, batches: FactoryBatchService;
  let factory: number, otherFactory: number, warehouse: number, medicine: number, variant: number;
  let staff: Actor, otherStaff: Actor, admin: Actor, warehouseStaff: Actor;
  const originalKey = process.env.QR_SECRET_KEY;

  const id = async (sql: string, args: unknown[] = []): Promise<number> => Number((await db.query<{ id: number }>(sql, args)).rows[0].id);
  const count = async (sql: string, args: unknown[] = []): Promise<number> => Number((await db.query<{ n: number }>(sql, args)).rows[0].n);

  async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
    try { await promise; } catch (error) { return error instanceof AppException ? error.code : String(error); }
    return undefined;
  }

  const input = (extra: Partial<CreateFactoryBatchDto> = {}): CreateFactoryBatchDto => ({
    variantId: variant, batchNumber: `LOT-${randomUUID()}`, productionDate: '2026-11-01', expiryDate: '2028-11-01',
    boxCount: 25, boxesPerCarton: 10, ...extra,
  });
  const stock = (): Promise<number> => count('SELECT coalesce(sum(stock_quantity),0)::int AS n FROM inventories WHERE facility_id=$1 AND variant_id=$2', [factory, variant]);

  beforeAll(async () => {
    process.env.QR_SECRET_KEY = 'integration-signing-key';
    const url = new URL(process.env.WORKFLOW_TEST_DATABASE_URL ?? '');
    if (url.pathname !== '/codex_factory_batch_20261118') throw new Error('Use the dedicated factory batch test database');
    db = new Pool({ connectionString: url.toString() });
    url.searchParams.set('options', '-c role=app_user');
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url.toString(); prisma = new PrismaService();
    if (original === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original;
    await prisma.onModuleInit();
    batches = new FactoryBatchService(prisma);

    factory = await id("INSERT INTO facilities(facility_name,facility_type) VALUES ('Intake factory','FACTORY') RETURNING id");
    otherFactory = await id("INSERT INTO facilities(facility_name,facility_type) VALUES ('Other factory','FACTORY') RETURNING id");
    warehouse = await id("INSERT INTO facilities(facility_name,facility_type) VALUES ('Intake warehouse','CENTRAL_WAREHOUSE') RETURNING id");
    const employee = (role: string, facility: number | null) => id('INSERT INTO employees(full_name,role,status,facility_id) VALUES ($1,$2,$3,$4) RETURNING id', [`Intake ${role}`, role, 'ACTIVE', facility]);
    staff = { id: await employee('FACTORY_WAREHOUSE_STAFF', factory), role: 'FACTORY_WAREHOUSE_STAFF', type: 'employee', facilityId: factory };
    otherStaff = { id: await employee('FACTORY_WAREHOUSE_STAFF', otherFactory), role: 'FACTORY_WAREHOUSE_STAFF', type: 'employee', facilityId: otherFactory };
    admin = { id: await employee('SUPER_ADMIN', null), role: 'SUPER_ADMIN', type: 'employee' };
    warehouseStaff = { id: await employee('WAREHOUSE_STAFF', warehouse), role: 'WAREHOUSE_STAFF', type: 'employee', facilityId: warehouse };
    medicine = await id("INSERT INTO medicines(medicine_name) VALUES ('Intake medicine') RETURNING id");
    variant = await id("INSERT INTO packaging_variants(medicine_id,unit_name,price) VALUES ($1,'Box',100) RETURNING id", [medicine]);
  });
  afterAll(async () => {
    if (originalKey === undefined) delete process.env.QR_SECRET_KEY; else process.env.QR_SECRET_KEY = originalKey;
    await prisma?.onModuleDestroy();
    await db?.end();
  });

  it('registers a batch of signed boxes in cartons and adds them to factory stock', async () => {
    const dto = input();
    const before = await stock();
    const created = await batches.create(staff, dto);
    expect(created).toMatchObject({ batchNumber: dto.batchNumber, boxCount: 25, cartonCount: 3 });

    expect(await stock()).toBe(before + 25);
    const batch = (await db.query('SELECT * FROM batches WHERE id=$1', [created.id])).rows[0];
    expect(batch).toMatchObject({
      medicine_id: medicine, manufacturer_source_facility_id: factory, initial_quantity: 25, remaining_quantity: 25, status: 'ACTIVE',
    });
    expect((await db.query('SELECT box_count FROM sscc_cartons WHERE batch_id=$1 ORDER BY id', [created.id])).rows.map(row => row.box_count)).toEqual([10, 10, 5]);

    const boxes = (await db.query<{ uid: string; signature: string; status: string; current_facility_id: number; carton_id: number }>(
      'SELECT uid, signature, status, current_facility_id, carton_id FROM medicine_boxes WHERE batch_id=$1', [created.id])).rows;
    expect(boxes).toHaveLength(25);
    expect(boxes.every(box => box.status === 'IN_STOCK' && box.current_facility_id === factory && box.carton_id !== null)).toBe(true);
    expect(boxes.every(box => CryptoUtil.verifyBoxSignature(box.uid, dto.batchNumber, box.signature))).toBe(true);
    expect(boxes.some(box => CryptoUtil.verifyBoxSignature(box.uid, `${dto.batchNumber}-x`, box.signature))).toBe(false);

    expect((await db.query(
      "SELECT quantity_changed, previous_quantity, new_quantity, performed_by_id FROM inventory_logs WHERE batch_id=$1 AND transaction_type='PRODUCTION_IN'", [created.id])).rows)
      .toEqual([{ quantity_changed: 25, previous_quantity: before, new_quantity: before + 25, performed_by_id: staff.id }]);
  });

  it('exports the labels of the batch with every box uid and the SSCC of its carton', async () => {
    const created = await batches.create(staff, input({ boxCount: 5, boxesPerCarton: 2 }));
    const [header, ...rows] = (await batches.labels(staff, created.id, {})).split('\n');
    expect(header).toBe('sscc,uid');
    expect(rows).toHaveLength(5);
    const cartons = (await db.query<{ sscc_code: string; box_count: number }>('SELECT sscc_code, box_count FROM sscc_cartons WHERE batch_id=$1', [created.id])).rows;
    for (const carton of cartons) expect(rows.filter(row => row.startsWith(`${carton.sscc_code},`))).toHaveLength(carton.box_count);
    expect(await errorCode(batches.labels(otherStaff, created.id, {}))).toBe('WAREHOUSE_BATCH_NOT_FOUND');
  });

  it('rejects a repeated batch number and leaves stock untouched', async () => {
    const dto = input();
    await batches.create(staff, dto);
    const before = await stock();
    expect(await errorCode(batches.create(staff, dto))).toBe('FB_BATCH_EXISTS');
    expect(await stock()).toBe(before);
    expect(await count('SELECT count(*)::int AS n FROM batches WHERE batch_number=$1', [dto.batchNumber])).toBe(1);
  });

  it('creates only one batch when the same batch number arrives twice at the same time', async () => {
    const dto = input({ boxCount: 6, boxesPerCarton: 3 });
    const before = await stock();
    const results = await Promise.allSettled([batches.create(staff, dto), batches.create(staff, dto)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find(result => result.status === 'rejected');
    expect(failed?.status === 'rejected' && failed.reason instanceof AppException ? failed.reason.code : undefined).toBe('FB_BATCH_EXISTS');
    expect(await stock()).toBe(before + 6);
  });

  it('rejects a batch whose production date is not before its expiry date', async () => {
    expect(await errorCode(batches.create(staff, input({ productionDate: '2028-11-01', expiryDate: '2026-11-01' })))).toBe('FB_BATCH_INVALID');
  });

  it('rejects an unknown packaging', async () => {
    expect(await errorCode(batches.create(staff, input({ variantId: 999999999 })))).toBe('FB_VARIANT_INVALID');
  });

  it('rejects a batch above the configured size without writing anything', async () => {
    const dto = input({ boxCount: 10001 });
    expect(await errorCode(batches.create(staff, dto))).toBe('FB_BATCH_TOO_LARGE');
    expect(await count('SELECT count(*)::int AS n FROM batches WHERE batch_number=$1', [dto.batchNumber])).toBe(0);
  });

  it('keeps each factory and role in its own lane', async () => {
    expect(await errorCode(batches.create(staff, input({ facilityId: otherFactory })))).toBe('WAREHOUSE_FACILITY_FORBIDDEN');
    expect(await errorCode(batches.create(warehouseStaff, input()))).toBe('WAREHOUSE_ACCOUNT_REQUIRED');
    expect(await errorCode(batches.create(admin, input()))).toBe('FB_FACTORY_REQUIRED');
    expect(await errorCode(batches.create(admin, input({ facilityId: warehouse })))).toBe('FB_FACTORY_REQUIRED');
    const created = await batches.create(admin, input({ facilityId: otherFactory }));
    expect(await count('SELECT manufacturer_source_facility_id AS n FROM batches WHERE id=$1', [created.id])).toBe(otherFactory);
  });
});
