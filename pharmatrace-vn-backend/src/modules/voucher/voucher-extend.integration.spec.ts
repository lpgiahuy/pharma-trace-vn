import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PrismaService } from '../../prisma/prisma.service';
import { VoucherService } from './voucher.service';

// Real-database check of "extend an expired voucher" (C3). Needs VOUCHER_STATUS_TEST_DATABASE_URL pointing at a
// scratch copy whose name ends in _voucher_status_scratch.
const integration = process.env.VOUCHER_STATUS_TEST_DATABASE_URL ? describe : describe.skip;
integration('C3 extending an expired voucher', () => {
  let db: Pool, prisma: PrismaService, service: VoucherService, admin: number;
  const actor = () => ({ id: admin, role: 'SUPER_ADMIN', type: 'employee' as const, facilityId: null });

  beforeAll(async () => {
    const url = new URL(process.env.VOUCHER_STATUS_TEST_DATABASE_URL!);
    if (!url.pathname.endsWith('_voucher_status_scratch')) throw new Error('Use a scratch database ending in _voucher_status_scratch');
    db = new Pool({ connectionString: url.toString() });
    url.searchParams.set('options', '-c role=app_user');
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url.toString(); prisma = new PrismaService();
    if (original === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original;
    await prisma.onModuleInit();
    service = new VoucherService(prisma);
    admin = Number((await db.query("INSERT INTO employees(full_name,role) VALUES ('Voucher admin','SUPER_ADMIN') RETURNING id")).rows[0].id);
  });
  afterAll(async () => { await prisma?.onModuleDestroy(); await db?.end(); });

  async function expiredVoucher(storedStatus = 'ACTIVE') {
    const code = `C3-${randomUUID().slice(0, 8).toUpperCase()}`;
    const id = Number((await db.query(
      "INSERT INTO vouchers(voucher_code,discount_type,discount_value,min_order_value,total_quantity,used_quantity,start_date,end_date,status) VALUES ($1,'FIXED',10000,0,10,0,now()-interval '20 day',now()-interval '2 day',$2) RETURNING id", [code, storedStatus])).rows[0].id);
    return { id, code };
  }
  const nextWeek = () => new Date(Date.now() + 7 * 86400000).toISOString();
  const validates = (code: string) => service.validateVoucher({ voucherCode: code, orderSubtotal: 50000 }).then(() => true, () => false);
  const stored = async (id: number) => (await db.query('SELECT status FROM vouchers WHERE id=$1', [id])).rows[0].status as string;

  it('shows an expired voucher as EXPIRED in the list, which is what the edit form prefills', async () => {
    const v = await expiredVoucher();
    const shown = await service.findOne(v.id, actor() as never);
    expect(shown.status).toBe('EXPIRED');
  });

  it('becomes usable when the admin edits it with the prefilled status and a future end date', async () => {
    const v = await expiredVoucher();
    const shown = await service.findOne(v.id, actor() as never);
    // The admin form submits the status it was prefilled with next to the new end date.
    await service.update(v.id, { endDate: nextWeek(), status: shown.status }, actor() as never);
    expect(await validates(v.code)).toBe(true);
    expect(await stored(v.id)).toBe('ACTIVE');
  });

  it('becomes usable when only the end date is sent', async () => {
    const v = await expiredVoucher();
    await service.update(v.id, { endDate: nextWeek() }, actor() as never);
    expect(await validates(v.code)).toBe(true);
  });

  it('keeps a manually disabled voucher disabled after extending it', async () => {
    const v = await expiredVoucher('INACTIVE');
    await service.update(v.id, { endDate: nextWeek(), status: 'INACTIVE' }, actor() as never);
    expect(await validates(v.code)).toBe(false);
    expect(await stored(v.id)).toBe('INACTIVE');
  });

  it('reactivates a voucher stored as EXPIRED when the end date moves to the future', async () => {
    const v = await expiredVoucher('EXPIRED');
    await service.update(v.id, { endDate: nextWeek(), status: 'EXPIRED' }, actor() as never);
    expect(await stored(v.id)).toBe('ACTIVE');
    expect(await validates(v.code)).toBe(true);
  });

  it('stays expired when the new end date is still in the past', async () => {
    const v = await expiredVoucher('EXPIRED');
    const stillPast = new Date(Date.now() - 86400000).toISOString();
    await service.update(v.id, { endDate: stillPast, status: 'EXPIRED' }, actor() as never);
    expect(await stored(v.id)).toBe('EXPIRED');
    expect(await validates(v.code)).toBe(false);
  });

  it('does not reactivate a voucher that was expired on purpose when the end date is not changed', async () => {
    const code = `C3-${randomUUID().slice(0, 8).toUpperCase()}`;
    const id = Number((await db.query(
      "INSERT INTO vouchers(voucher_code,discount_type,discount_value,min_order_value,total_quantity,used_quantity,start_date,end_date,status) VALUES ($1,'FIXED',10000,0,10,0,now()-interval '1 day',now()+interval '5 day','EXPIRED') RETURNING id", [code])).rows[0].id);
    // end_date is a timestamp without time zone that the API reads as UTC, so read it the same way here.
    const current = new Date((await db.query("SELECT to_char(end_date, 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS d FROM vouchers WHERE id=$1", [id])).rows[0].d as string);
    await service.update(id, { endDate: current.toISOString(), status: 'EXPIRED', totalQuantity: 20 }, actor() as never);
    expect(await stored(id)).toBe('EXPIRED');
  });

  it('is active again but not yet valid when the start date is in the future', async () => {
    const v = await expiredVoucher();
    const start = new Date(Date.now() + 3 * 86400000).toISOString();
    const end = new Date(Date.now() + 10 * 86400000).toISOString();
    await service.update(v.id, { startDate: start, endDate: end, status: 'EXPIRED' }, actor() as never);
    expect(await stored(v.id)).toBe('ACTIVE');
    expect(await validates(v.code)).toBe(false);
  });

  it('is active again but rejected when its usage limit is used up', async () => {
    const v = await expiredVoucher();
    await db.query('UPDATE vouchers SET used_quantity=total_quantity WHERE id=$1', [v.id]);
    await service.update(v.id, { endDate: nextWeek(), status: 'EXPIRED' }, actor() as never);
    expect(await stored(v.id)).toBe('ACTIVE');
    expect(await validates(v.code)).toBe(false);
  });

  it('accepts an end date a minute away, and rejects it once it has passed', async () => {
    const v = await expiredVoucher();
    await service.update(v.id, { endDate: new Date(Date.now() + 60000).toISOString(), status: 'EXPIRED' }, actor() as never);
    expect(await validates(v.code)).toBe(true);
    await db.query("UPDATE vouchers SET end_date = now() - interval '1 second' WHERE id=$1", [v.id]);
    expect(await validates(v.code)).toBe(false);
  });
});
