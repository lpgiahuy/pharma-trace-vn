export interface VariantLike {
  id: number;
  /** Available units of this packaging unit, when known. */
  stock?: number | null;
}

export interface ProductVariantSource<V extends VariantLike> {
  /** The default (base) packaging unit the product is labelled with. */
  packaging?: { id: number } | null;
  packagingOptions?: V[] | null;
}

/**
 * The packaging variant a product card shows and sells.
 *
 * The card labels the product with one packaging unit and that same unit has to be the one added to the cart.
 * Order of preference:
 *  1. an explicit `override` (such as a flash-sale variant);
 *  2. the base unit (`packaging`), when it has stock or its stock is unknown;
 *  3. otherwise the first unit that has stock, so a medicine whose stock is held under another unit (e.g. Box)
 *     is not shown as sold out while it can be bought;
 *  4. otherwise the base unit, or the first option when the base unit is unknown.
 * The option order from the API is not guaranteed to start with the base unit, so `packagingOptions[0]` alone
 * can add a different unit than the one displayed.
 */
export function pickDisplayedVariant<V extends VariantLike>(
  product: ProductVariantSource<V>,
  override?: V,
): V | undefined {
  if (override) return override;
  const options = product.packagingOptions ?? [];
  const baseId = product.packaging?.id;
  const base = baseId != null ? options.find((option) => option.id === baseId) : undefined;
  const hasStock = (option: V) => typeof option.stock !== 'number' || option.stock > 0;
  if (base && hasStock(base)) return base;
  return options.find((option) => typeof option.stock === 'number' && option.stock > 0) ?? base ?? options[0];
}

interface PricedVariantLike extends VariantLike {
  /** Effective price (sale price while a sale is on). */
  price?: number | string | null;
}

const inRange = (price: unknown, min: number | null, max: number | null): boolean => {
  const value = Number(price);
  if (!Number.isFinite(value)) return false;
  return (min === null || value >= min) && (max === null || value <= max);
};

/**
 * When a price filter is active, the variant a result card should show instead of the default one: the first unit
 * whose price is inside the range, but only when the default unit is outside it. Returns undefined when there is no
 * filter, the default unit already matches, or no unit matches (the card then keeps its normal unit).
 */
export function pickVariantForPriceRange<V extends PricedVariantLike>(
  product: ProductVariantSource<V>,
  min: number | null,
  max: number | null,
): V | undefined {
  if (min === null && max === null) return undefined;
  const fallback = pickDisplayedVariant(product);
  if (fallback && inRange(fallback.price, min, max)) return undefined;
  return (product.packagingOptions ?? []).find((option) => inRange(option.price, min, max));
}
