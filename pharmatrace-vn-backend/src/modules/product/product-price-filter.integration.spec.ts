import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductService } from './product.service';

// Runs the price filter against a real database through the restricted application role.
// Set PRICE_FILTER_TEST_DATABASE_URL to a scratch copy named like "*_price_scratch"; never a real database.
const integration = process.env.PRICE_FILTER_TEST_DATABASE_URL ? describe : describe.skip;
integration('B3 price filter matches any variant by effective price', () => {
  let db: Pool, prisma: PrismaService, service: ProductService;

  beforeAll(async () => {
    const url = new URL(process.env.PRICE_FILTER_TEST_DATABASE_URL!);
    if (!url.pathname.endsWith('_price_scratch')) throw new Error('Use a scratch database ending in _price_scratch');
    db = new Pool({ connectionString: url.toString() });
    url.searchParams.set('options', '-c role=app_user');
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url.toString(); prisma = new PrismaService();
    if (original === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original;
    await prisma.onModuleInit();
    service = new ProductService(prisma, {} as never);
  });
  afterAll(async () => { await prisma?.onModuleDestroy(); await db?.end(); });

  type Variant = { unit: string; price: number; original?: number; pct?: number; sale?: 'active' | 'expired' };
  async function medicine(variants: Variant[], unitPrice = 1) {
    const name = `PriceFilter ${randomUUID()}`;
    const id = Number((await db.query("INSERT INTO medicines(medicine_name,status,unit_price) VALUES ($1,'ACTIVE',$2) RETURNING id", [name, unitPrice])).rows[0].id);
    for (const [i, v] of variants.entries()) {
      const start = v.sale === 'active' ? "now() - interval '1 day'" : v.sale === 'expired' ? "now() - interval '10 day'" : 'NULL';
      const end = v.sale === 'active' ? "now() + interval '1 day'" : v.sale === 'expired' ? "now() - interval '5 day'" : 'NULL';
      await db.query(`INSERT INTO packaging_variants(medicine_id,unit_name,price,original_price,discount_percent,is_base_unit,sale_start_date,sale_end_date) VALUES ($1,$2,$3,$4,$5,$6,${start},${end})`,
        [id, v.unit, v.price, v.original ?? null, v.pct ?? 0, i === 0]);
    }
    return name;
  }
  const found = async (name: string, minPrice?: number, maxPrice?: number) =>
    (await service.findAll({ search: name, minPrice, maxPrice } as never)).items.some((p: { medicineName: string }) => p.medicineName === name);

  it('finds a product through its second variant (20000 and 70000 vs 60000-80000)', async () => {
    const name = await medicine([{ unit: 'Blister', price: 20000 }, { unit: 'Box', price: 70000 }]);
    expect(await found(name, 60000, 80000)).toBe(true);
    expect(await found(name, 10000, 25000)).toBe(true);
    expect(await found(name, 30000, 50000)).toBe(false);
  });

  it('treats the bounds as inclusive and supports one-sided ranges', async () => {
    const name = await medicine([{ unit: 'Blister', price: 20000 }, { unit: 'Box', price: 70000 }]);
    expect(await found(name, 70000, 70000)).toBe(true);
    expect(await found(name, 70001, 90000)).toBe(false);
    expect(await found(name, 69000, undefined)).toBe(true);
    expect(await found(name, undefined, 19999)).toBe(false);
    expect(await found(name, undefined, 20000)).toBe(true);
  });

  it('uses the sale price while the sale is active, not the original price', async () => {
    const name = await medicine([{ unit: 'Box', price: 65000, original: 100000, pct: 35, sale: 'active' }]);
    expect(await found(name, 60000, 70000)).toBe(true);
    expect(await found(name, 95000, 110000)).toBe(false);
  });

  it('uses the regular price once the sale has ended', async () => {
    const name = await medicine([{ unit: 'Box', price: 65000, original: 100000, pct: 35, sale: 'expired' }]);
    expect(await found(name, 60000, 70000)).toBe(false);
    expect(await found(name, 95000, 110000)).toBe(true);
  });

  it('falls back to the medicine price when it has no variants', async () => {
    const name = await medicine([], 50000);
    expect(await found(name, 40000, 60000)).toBe(true);
    expect(await found(name, 60000, 80000)).toBe(false);
  });
});
