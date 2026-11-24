import { Prisma } from '@prisma/client';

interface PricedVariant {
  price: Prisma.Decimal | number | string;
  original_price?: Prisma.Decimal | number | string | null;
  discount_percent?: number | null;
  sale_start_date?: Date | string | null;
  sale_end_date?: Date | string | null;
  /** Max units sellable at the sale price; null/undefined means unlimited. */
  sale_quantity?: number | null;
  /** Units already sold at the sale price (attached by attachSaleSold). */
  sale_sold?: number | null;
}

export function getVariantPrice(variant: PricedVariant, now = new Date()) {
  const price = Number(variant.price);
  const originalPrice = variant.original_price ? Number(variant.original_price) : null;
  const hasDiscount = Boolean(
    (variant.discount_percent && variant.discount_percent > 0) ||
    (originalPrice && price < originalPrice),
  );
  const saleRemaining = variant.sale_quantity != null
    ? Math.max(0, variant.sale_quantity - (variant.sale_sold ?? 0))
    : null;
  const isSaleActive = hasDiscount && Boolean(variant.sale_start_date && variant.sale_end_date) &&
    new Date(variant.sale_start_date!) <= now && new Date(variant.sale_end_date!) >= now &&
    saleRemaining !== 0;

  return {
    price: isSaleActive ? price : (originalPrice ?? price),
    originalPrice: isSaleActive ? originalPrice : null,
    discountPercent: isSaleActive
      ? (variant.discount_percent ?? (originalPrice && price < originalPrice
        ? Math.round(((originalPrice - price) / originalPrice) * 100) : 0))
      : 0,
    isSaleActive,
    saleQuantity: variant.sale_quantity ?? null,
    saleRemaining,
  };
}
