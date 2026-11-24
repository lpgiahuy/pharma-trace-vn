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
