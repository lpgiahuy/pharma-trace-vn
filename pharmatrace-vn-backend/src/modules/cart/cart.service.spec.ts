import { Test, TestingModule } from '@nestjs/testing';
import { CartService } from './cart.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('CartService', () => {
  let service: CartService;
  let prisma: any;

  const mockCustomer = {
    id: 1,
    full_name: 'Test Customer',
    status: 'ACTIVE',
  };

  const mockVariant = {
    id: 10,
    medicine_id: 100,
    unit_name: 'Box',
    price: 50000,
    original_price: 60000,
    discount_percent: 16,
    sale_start_date: new Date('2000-01-01T00:00:00Z'),
    sale_end_date: new Date('2100-01-01T00:00:00Z'),
    is_base_unit: true,
    medicine: {
      id: 100,
      medicine_name: 'Panadol Extra',
      slug: 'panadol-extra',
      image_url: 'http://img.com/panadol.jpg',
      status: 'ACTIVE',
      is_prescription: false,
      packaging_variants: [
        {
          id: 10,
          unit_name: 'Box',
          price: 50000,
          original_price: 60000,
          discount_percent: 16,
          is_base_unit: true,
        },
      ],
    },
  };

  const mockCartRecord = {
    id: 5,
    customer_id: 1,
    variant_id: 10,
    quantity: 2,
    created_at: new Date(),
    packaging_variants: mockVariant,
  };

  beforeEach(async () => {
    prisma = {
      customers: {
        findUnique: jest.fn().mockResolvedValue(mockCustomer),
      },
      packaging_variants: {
        findUnique: jest.fn().mockResolvedValue(mockVariant),
        findMany: jest.fn().mockResolvedValue([mockVariant]),
      },
      cart_items: {
        findMany: jest.fn().mockResolvedValue([mockCartRecord]),
        findUnique: jest.fn().mockResolvedValue(mockCartRecord),
        create: jest.fn().mockResolvedValue({ ...mockCartRecord, id: 6 }),
        update: jest.fn().mockResolvedValue(mockCartRecord),
        delete: jest.fn().mockResolvedValue(mockCartRecord),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      // 100 units on hand, 10 reserved: 90 can still be supplied.
      inventories: {
        findMany: jest.fn().mockResolvedValue([{ variant_id: 10, facility_id: 1, stock_quantity: 100, reserved_quantity: 10 }]),
      },
      // Boxes of held, recalled or expired lots per facility and medicine (none by default).
      $queryRaw: jest.fn().mockResolvedValue([]),
      withActor: jest.fn((_actor: unknown, operation: (tx: any) => Promise<unknown>) => operation(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<CartService>(CartService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getCart', () => {
    it('should return formatted cart items, subtotal, and total items', async () => {
      const result = await service.getCart(1);
      expect(result.items.length).toBe(1);
      expect(result.items[0].productId).toBe(100);
      expect(result.items[0].price).toBe(50000);
      expect(result.items[0].quantity).toBe(2);
      expect(result.totalItems).toBe(2);
      expect(result.subtotal).toBe(100000);
    });

    it('should throw NotFoundException if customer does not exist', async () => {
      prisma.customers.findUnique.mockResolvedValueOnce(null);
      await expect(service.getCart(999)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if customer is inactive', async () => {
      prisma.customers.findUnique.mockResolvedValueOnce({
        id: 1,
        status: 'BANNED',
      });
      await expect(service.getCart(1)).rejects.toThrow(BadRequestException);
    });
  });

  describe('addToCart', () => {
    it('should increment quantity if item already in cart', async () => {
      prisma.cart_items.findUnique.mockResolvedValueOnce(mockCartRecord);
      await service.addToCart(1, { variantId: 10, quantity: 3 });

      expect(prisma.cart_items.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockCartRecord.id },
          data: { quantity: 5 },
        }),
      );
    });

    it('should create new cart item if not already in cart', async () => {
      prisma.cart_items.findUnique.mockResolvedValueOnce(null);
      await service.addToCart(1, { variantId: 10, quantity: 1 });

      expect(prisma.cart_items.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            customer_id: 1,
            variant_id: 10,
            quantity: 1,
          },
        }),
      );
    });

    it('should throw NotFoundException if variant does not exist', async () => {
      prisma.packaging_variants.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.addToCart(1, { variantId: 999, quantity: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if medicine is not ACTIVE', async () => {
      prisma.packaging_variants.findUnique.mockResolvedValueOnce({
        ...mockVariant,
        medicine: { ...mockVariant.medicine, status: 'INACTIVE' },
      });
      await expect(
        service.addToCart(1, { variantId: 10, quantity: 1 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateQuantity', () => {
    it('should update quantity when quantity > 0', async () => {
      await service.updateQuantity(1, 10, { quantity: 4 });
      expect(prisma.cart_items.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockCartRecord.id },
          data: { quantity: 4 },
        }),
      );
    });

    it('should delete item when quantity is 0', async () => {
      await service.updateQuantity(1, 10, { quantity: 0 });
      expect(prisma.cart_items.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockCartRecord.id },
        }),
      );
    });

    it('should throw NotFoundException when item not in cart', async () => {
      prisma.cart_items.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.updateQuantity(1, 999, { quantity: 2 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeItem', () => {
    it('should delete variant from customer cart', async () => {
      await service.removeItem(1, 10);
      expect(prisma.cart_items.deleteMany).toHaveBeenCalledWith({
        where: {
          customer_id: 1,
          variant_id: 10,
        },
      });
    });
  });

  describe('clearCart', () => {
    it('should delete all cart items for customer', async () => {
      const result = await service.clearCart(1);
      expect(prisma.cart_items.deleteMany).toHaveBeenCalledWith({
        where: { customer_id: 1 },
      });
      expect(result.items).toEqual([]);
      expect(result.totalItems).toBe(0);
      expect(result.subtotal).toBe(0);
    });
  });

  describe('stock limits (C1)', () => {
    it('reports the units that can still be supplied for every cart item', async () => {
      const result = await service.getCart(1);
      expect(result.items[0].availableStock).toBe(90);
    });

    it('reports zero for a unit without inventory rows', async () => {
      prisma.inventories.findMany.mockResolvedValueOnce([]);
      const result = await service.getCart(1);
      expect(result.items[0].availableStock).toBe(0);
    });

    it('rejects adding more than is available, naming the item and the amount', async () => {
      prisma.cart_items.findUnique.mockResolvedValueOnce(null);
      await expect(service.addToCart(1, { variantId: 10, quantity: 500 })).rejects.toThrow(/Only 90 of .* available/);
      expect(prisma.cart_items.create).not.toHaveBeenCalled();
    });

    it('counts what is already in the cart when adding more', async () => {
      prisma.cart_items.findUnique.mockResolvedValueOnce({ ...mockCartRecord, quantity: 89 });
      await expect(service.addToCart(1, { variantId: 10, quantity: 2 })).rejects.toThrow(/Only 90 of/);
      expect(prisma.cart_items.update).not.toHaveBeenCalled();
    });

    it('allows exactly the available amount', async () => {
      prisma.cart_items.findUnique.mockResolvedValueOnce(null);
      await service.addToCart(1, { variantId: 10, quantity: 90 });
      expect(prisma.cart_items.create).toHaveBeenCalled();
    });

    it('rejects adding a unit that is out of stock', async () => {
      prisma.inventories.findMany.mockResolvedValueOnce([{ variant_id: 10, facility_id: 1, stock_quantity: 5, reserved_quantity: 5 }]);
      prisma.cart_items.findUnique.mockResolvedValueOnce(null);
      await expect(service.addToCart(1, { variantId: 10, quantity: 1 })).rejects.toThrow(/out of stock/);
    });

    it('rejects raising a quantity above the available amount but always allows lowering it', async () => {
      await expect(service.updateQuantity(1, 10, { quantity: 91 })).rejects.toThrow(/Only 90 of/);
      expect(prisma.cart_items.update).not.toHaveBeenCalled();
      prisma.cart_items.findUnique.mockResolvedValueOnce({ ...mockCartRecord, quantity: 500 });
      await service.updateQuantity(1, 10, { quantity: 400 });
      expect(prisma.cart_items.update).toHaveBeenCalledWith(expect.objectContaining({ data: { quantity: 400 } }));
    });

    it('counts only warehouses and pharmacies, like checkout (a factory does not ship to customers)', async () => {
      await service.getCart(1);
      expect(prisma.inventories.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ facilities: { facility_type: { in: ['CENTRAL_WAREHOUSE', 'BRANCH_WAREHOUSE', 'PHARMACY'] } } }),
      }));
    });

    it('sums facilities and subtracts boxes of held or expired lots', async () => {
      prisma.inventories.findMany.mockResolvedValueOnce([
        { variant_id: 10, facility_id: 1, stock_quantity: 100, reserved_quantity: 10 },
        { variant_id: 10, facility_id: 2, stock_quantity: 50, reserved_quantity: 0 },
      ]);
      prisma.$queryRaw.mockResolvedValueOnce([{ facility_id: 2, medicine_id: 100, boxes: 20 }]);
      const result = await service.getCart(1);
      expect(result.items[0].availableStock).toBe(90 + 30);
    });
  });
});
