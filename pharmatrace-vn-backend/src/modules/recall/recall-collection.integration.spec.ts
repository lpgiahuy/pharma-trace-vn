import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PrismaService } from '../../prisma/prisma.service';
import { InternalTransferService } from '../logistics/internal-transfer/internal-transfer.service';
import { RecallService } from './recall.service';

const integration = process.env.WORKFLOW_TEST_DATABASE_URL ? describe : describe.skip;
integration('Recall collection from a warehouse back to the factory, with the restricted application role', () => {
  let db: Pool, prisma: PrismaService, recalls: RecallService, transfers: InternalTransferService;
  let warehouse: number, factory: number, admin: number, manager: number, factoryStaff: number;
  const id = async (sql: string, args: unknown[] = []) => Number((await db.query(sql, args)).rows[0].id);
  const adminActor = () => ({ id: admin, role: 'SUPER_ADMIN', type: 'employee' as const });
  const managerActor = () => ({ id: manager, role: 'WAREHOUSE_MANAGER', type: 'employee' as const, facilityId: warehouse });
  const factoryActor = () => ({ id: factoryStaff, role: 'FACTORY_WAREHOUSE_STAFF', type: 'employee' as const, facilityId: factory });

  beforeAll(async () => {
    const url = new URL(process.env.WORKFLOW_TEST_DATABASE_URL!);
    if (url.pathname !== '/codex_recall_collection_20261124') throw new Error('Use the dedicated recall collection test database');
    db = new Pool({ connectionString: url.toString() });
    url.searchParams.set('options', '-c role=app_user');
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url.toString(); prisma = new PrismaService();
    if (original === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original;
    await prisma.onModuleInit();
    recalls = new RecallService(prisma);
    transfers = new InternalTransferService(prisma);
    warehouse = await id("INSERT INTO facilities(facility_name,facility_type) VALUES ('Collection warehouse','CENTRAL_WAREHOUSE') RETURNING id");
    factory = await id("INSERT INTO facilities(facility_name,facility_type) VALUES ('Collection factory','FACTORY') RETURNING id");
    admin = await id("INSERT INTO employees(full_name,role) VALUES ('Collection admin','SUPER_ADMIN') RETURNING id");
    manager = await id("INSERT INTO employees(full_name,role,facility_id) VALUES ('Collection manager','WAREHOUSE_MANAGER',$1) RETURNING id", [warehouse]);
    factoryStaff = await id("INSERT INTO employees(full_name,role,facility_id) VALUES ('Collection factory staff','FACTORY_WAREHOUSE_STAFF',$1) RETURNING id", [factory]);
  });
  afterAll(async () => { await prisma?.onModuleDestroy(); await db?.end(); });

  it('collects the warehouse stock, dispatches it, receives it at the factory in quarantine and closes the recall', async () => {
    const medicine = await id("INSERT INTO medicines(medicine_name,status) VALUES ($1,'ACTIVE') RETURNING id", [`Collection medicine ${randomUUID()}`]);
    const variant = await id("INSERT INTO packaging_variants(medicine_id,unit_name,price) VALUES ($1,'Box',100) RETURNING id", [medicine]);
    const batch = await id(`INSERT INTO batches(batch_number,medicine_id,production_date,expiry_date,status,manufacturer_source_facility_id)
      VALUES ($1,$2,current_date-1,current_date+365,'ACTIVE',$3) RETURNING id`, [randomUUID(), medicine, factory]);
    await db.query("INSERT INTO medicine_boxes(batch_id,current_facility_id,status) SELECT $1,$2,'IN_STOCK' FROM generate_series(1,3)", [batch, warehouse]);
    await db.query('INSERT INTO inventories(facility_id,variant_id,stock_quantity,reserved_quantity) VALUES ($1,$2,3,0)', [warehouse, variant]);
    const recall = await recalls.createForFactory(factoryActor(), { recallCode: `RCL-${randomUUID().slice(0, 8)}`, reason: 'Contamination', severity: 'LEVEL_1', batchIds: [batch] });

    await expect(recalls.collectionDestination(managerActor(), recall.id)).resolves.toEqual({ facilityId: factory, facilityName: 'Collection factory' });
    const otherWarehouse = await id("INSERT INTO facilities(facility_name,facility_type) VALUES ('Other warehouse','BRANCH_WAREHOUSE') RETURNING id");
    await expect(recalls.collectFromFacility(managerActor(), recall.id, { toFacilityId: otherWarehouse }))
      .rejects.toMatchObject({ code: 'RC_DESTINATION_NOT_ORIGIN' });
    const collection = await recalls.collectFromFacility(managerActor(), recall.id, { toFacilityId: factory, note: 'Back to the factory' });
    expect(collection).toMatchObject({ toFacilityId: factory, created: true });
    await expect(recalls.collectFromFacility(managerActor(), recall.id, { toFacilityId: factory }))
      .resolves.toMatchObject({ transferId: collection.transferId, created: false });
    expect(await recalls.tasks(managerActor(), {})).toEqual(expect.arrayContaining([
      expect.objectContaining({ recallId: recall.id, kind: 'COLLECTION_TRANSFER', transferId: collection.transferId, transferStatus: 'REQUESTED' }),
    ]));

    const boxUids = (await db.query('SELECT uid::text FROM medicine_boxes WHERE batch_id=$1 ORDER BY uid', [batch])).rows.map(row => row.uid as string);
    await transfers.adminDispatchInternalTransfer(collection.transferId,
      { transportMode: 'INTERNAL', transportEmployeeId: manager, manifest: [{ variantId: variant, quantity: 3, boxUids }] }, managerActor());

    expect((await transfers.adminGetInternalTransfers(undefined, factoryActor())).map(t => t.id)).toContain(collection.transferId);
    const received = await transfers.adminReceiveInternalTransfer(collection.transferId, factoryActor(), { lines: [{ variantId: variant, receivedQuantity: 3 }] });
    expect(received).toMatchObject({ status: 'RECEIVED', transfer_type: 'RECALL_COLLECTION', to_facility_id: factory });

    const boxes = await db.query('SELECT status, current_facility_id FROM medicine_boxes WHERE batch_id=$1', [batch]);
    expect(boxes.rows).toEqual(Array(3).fill({ status: 'QUARANTINED', current_facility_id: factory }));
    const stock = await db.query(`SELECT i.stock_quantity, q.quantity FROM inventories i JOIN quarantine_balances q USING (facility_id, variant_id)
      WHERE i.facility_id=$1 AND i.variant_id=$2`, [factory, variant]);
    expect(stock.rows[0]).toEqual({ stock_quantity: 0, quantity: 3 });

    await expect(recalls.close(adminActor(), recall.id, { note: 'Returned to the factory' })).resolves.toMatchObject({ status: 'CLOSED' });
    await expect(recalls.collectFromFacility(managerActor(), recall.id, { toFacilityId: factory })).rejects.toMatchObject({ code: 'RC_NOT_ACTIVE' });
  });
});
