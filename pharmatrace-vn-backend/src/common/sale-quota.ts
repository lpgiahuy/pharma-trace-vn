import { Prisma } from '@prisma/client';

interface QuotaVariant {
  id: number;
  sale_quantity?: number | null;
  sale_sold?: number | null;
}

interface RawClient {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
}

/**
 * Attaches `sale_sold` (units sold at the sale price) to every variant that has a sale quota,
 * so getVariantPrice can stop the sale once the quota is used up. Variants without a quota are
 * left untouched and cost no query.
 */
export async function attachSaleSold(client: RawClient, variants: QuotaVariant[]): Promise<void> {
  const limited = variants.filter((v) => v.sale_quantity != null);
  if (limited.length === 0) return;

  const ids = limited.map((v) => v.id);
  const rows = await client.$queryRaw<{ variant_id: number; sold: number }[]>(
    Prisma.sql`SELECT variant_id, sold FROM public.variant_sale_sold(${ids}::integer[])`,
  );
  const sold = new Map(rows.map((r) => [Number(r.variant_id), Number(r.sold)]));
  for (const v of limited) v.sale_sold = sold.get(v.id) ?? 0;
}
