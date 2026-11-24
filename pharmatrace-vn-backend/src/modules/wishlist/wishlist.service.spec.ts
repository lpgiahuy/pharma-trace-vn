import { WishlistService } from './wishlist.service';

const inv = (stock: number, reserved: number) => ({ stock_quantity: stock, reserved_quantity: reserved });
const variant = (id: number, unit: string, inventories: unknown[], isBase = false) => ({
  id, unit_name: unit, price: 1000, original_price: null, discount_percent: 0, is_base_unit: isBase, inventories,
});
const record = (medicineId: number, variants: unknown[]) => ({
  created_at: new Date(),
  medicines: { id: medicineId, medicine_name: `Medicine ${medicineId}`, status: 'ACTIVE', packaging_variants: variants },
});

function serviceWith(records: unknown[]) {
  const tx = {
    customer_wishlists: { count: jest.fn().mockResolvedValue(records.length), findMany: jest.fn().mockResolvedValue(records) },
  };
  const prisma = { withActor: jest.fn((_actor, run) => run(tx)) };
  return { service: new WishlistService(prisma as never), tx };
}

describe('Wishlist stock (B4)', () => {
  it('asks for inventories of every packaging variant', async () => {
    const { service, tx } = serviceWith([]);
    await service.getWishlist(1);
    expect(tx.customer_wishlists.findMany.mock.calls[0][0].include.medicines.include.packaging_variants)
      .toEqual({ include: { inventories: true } });
  });

  it('reports zero stock for a medicine without inventory, whatever its id', async () => {
    // Ids 1780 (the reported Hagizin) and 7 used to get a made-up number from the old id-based formula.
    const { service } = serviceWith([record(1780, [variant(1, 'Box', [], true)]), record(8, [variant(2, 'Box', [])])]);
    const { items } = await service.getWishlist(1);
    expect(items.map((i) => i.totalStock)).toEqual([0, 0]);
    expect(items[0].packagingOptions[0].stock).toBe(0);
  });

  it('subtracts reserved units, never goes below zero, and sums per variant', async () => {
    const { service } = serviceWith([record(5, [
      variant(10, 'Blister', [inv(30, 5), inv(10, 10)], true),
      variant(11, 'Box', [inv(2, 9)]),
    ])]);
    const { items } = await service.getWishlist(1);
    expect(items[0].packagingOptions.map((o: { stock: number }) => o.stock)).toEqual([25, 0]);
    expect(items[0].totalStock).toBe(25);
  });
});
