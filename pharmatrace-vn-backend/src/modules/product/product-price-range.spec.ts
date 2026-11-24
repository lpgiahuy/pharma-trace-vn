import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ProductQueryDto } from './dto/product-query.dto';
import { ProductService } from './product.service';

// Same options as main.ts.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const parse = (query: Record<string, unknown>) => pipe.transform(query, { type: 'query', metatype: ProductQueryDto }) as Promise<ProductQueryDto>;

describe('product price range filter (B2)', () => {
  it('rejects a negative or non-numeric bound with HTTP 400', async () => {
    await expect(parse({ minPrice: '-1' })).rejects.toMatchObject({ status: 400 });
    await expect(parse({ maxPrice: '-5' })).rejects.toMatchObject({ status: 400 });
    await expect(parse({ minPrice: 'abc' })).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    [{ minPrice: '0' }],
    [{ minPrice: '10000' }],
    [{ maxPrice: '5000' }],
    [{ minPrice: '5000', maxPrice: '5000' }],
    [{ minPrice: '5000', maxPrice: '10000' }],
  ])('accepts %p', async (query) => {
    await expect(parse(query)).resolves.toBeDefined();
  });

  describe('ProductService.findAll', () => {
    const prisma = {
      medicines: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new ProductService(prisma as never, {} as never);

    it('rejects a minimum above the maximum (10000 > 5000) before querying', async () => {
      const query = await parse({ minPrice: '10000', maxPrice: '5000' });
      await expect(service.findAll(query)).rejects.toThrow(new BadRequestException('Minimum price cannot be greater than maximum price'));
      expect(prisma.medicines.findMany).not.toHaveBeenCalled();
    });

    it('allows equal bounds', async () => {
      const query = await parse({ minPrice: '5000', maxPrice: '5000' });
      await expect(service.findAll(query)).resolves.toBeDefined();
    });
  });
});
