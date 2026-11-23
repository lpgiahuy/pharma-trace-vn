'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { App } from 'antd';
import { Heart, Plus } from 'lucide-react';
import { wishlistService } from '@/services/wishlist.service';
import { useAuth } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';
import { Product } from '@/types/product.types';
import { formatCurrency, cleanText, cn } from '@/utils';

export function ProductCard({
  product,
  variant,
  isFavorite: initialFavorite = false,
  onToggleFavorite,
}: {
  product: Product;
  /** Show and sell this specific packaging variant (e.g. the one on flash sale) instead of the default. */
  variant?: NonNullable<Product['packagingOptions']>[number];
  isFavorite?: boolean;
  onToggleFavorite?: (productId: number, nextStatus: boolean) => void;
}) {
  const { message } = App.useApp();
  const [isFavorite, setIsFavorite] = useState(initialFavorite);
  const { isAuthenticated } = useAuth();

  const [previousFavorite, setPreviousFavorite] = useState(initialFavorite);
  if (previousFavorite !== initialFavorite) {
    setPreviousFavorite(initialFavorite);
    setIsFavorite(initialFavorite);
  }

  const handleToggleFavorite = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthenticated) {
      message.warning('Please sign in to save items to your wishlist');
      return;
    }
    const nextStatus = !isFavorite;
    setIsFavorite(nextStatus);
    onToggleFavorite?.(product.id, nextStatus);

    try {
      if (!nextStatus) {
        await wishlistService.removeFromWishlist(product.id);
        message.success('Removed from wishlist');
      } else {
        await wishlistService.addToWishlist(product.id);
        message.success('Added to wishlist');
      }
    } catch (err: any) {
      setIsFavorite(!nextStatus);
      onToggleFavorite?.(product.id, !nextStatus);
      const errMsg = err?.response?.data?.message || err?.message || 'Failed to update wishlist';
      message.error(errMsg);
    }
  };

  const addItem = useCartStore((state) => state.addItem);

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isInStock) {
      message.warning('This medicine is currently out of stock');
      return;
    }

    const baseVariant =
      variant || product.packagingOptions?.[0] || product.packaging;

    const effectivePrice = baseVariant && 'price' in baseVariant && baseVariant.price
      ? Number(baseVariant.price)
      : Number(product.promotionalPrice || product.unitPrice || 0);

    addItem(
      {
        id: `${product.id}-${baseVariant?.id || 'base'}`,
        productId: product.id,
        slug: product.slug || String(product.id),
        medicineName: product.medicineName,
        isPrescription: product.isPrescription,
        imageUrl: product.imageUrl,
        variantId: baseVariant?.id,
        unitName: baseVariant?.unitName || 'Box',
        price: effectivePrice,
        originalPrice: Number((variant?.originalPrice ?? product.unitPrice) || effectivePrice),
      },
      1,
    );

    message.success('Added to cart!');
  };

  // Price shown on the card: the given variant when provided, otherwise the product default.
  const shownPrice = variant ? Number(variant.price) : Number(product.promotionalPrice || product.unitPrice);
  const shownOriginal = variant ? Number(variant.originalPrice ?? 0) : Number(product.unitPrice);
  const shownUnit = variant?.unitName || product.packaging?.unitName || 'Box';

  const hasDiscount = Boolean(shownOriginal && shownPrice && shownPrice < shownOriginal);

  const discount = hasDiscount
    ? (variant?.discountPercent || Math.round(((shownOriginal - shownPrice) / shownOriginal) * 100))
    : 0;

  const isInStock = variant ? (variant.stock ?? 0) > 0 : (product.totalStock ?? 0) > 0;

  return (
    <article className="bg-white rounded-2xl border border-slate-200/90 hover:border-slate-300 hover:shadow-md transition-all duration-300 p-4 flex flex-col h-full group">
      {/* Image container */}
      <Link
        href={`/products/${product.slug || product.id}`}
        className="relative block aspect-square bg-slate-50 rounded-xl mb-3.5 overflow-hidden flex items-center justify-center p-3.5 border border-slate-100"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={product.imageUrl || '/favicon.ico'}
          alt={product.medicineName}
          className={cn(
            'max-w-full max-h-full object-contain transition-transform duration-300',
            isInStock ? 'group-hover:scale-105' : 'opacity-50 grayscale',
          )}
          loading="lazy"
        />

        {/* Top-left: Functional Badges (Discount or Prescription) */}
        <div className="absolute top-2.5 left-2.5 z-10 flex flex-col gap-1 items-start">
          {discount > 0 && (
            <span className="bg-rose-600 text-white text-xs font-bold px-2 py-0.5 rounded-full tabular-nums leading-none shadow-xs">
              -{discount}%
            </span>
          )}
          {product.isPrescription && (
            <span className="bg-slate-900 text-white text-[11px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider leading-none shadow-xs">
              Rx
            </span>
          )}
        </div>

        {/* Out of Stock Overlay */}
        {!isInStock && (
          <div className="absolute inset-0 bg-white/75 flex items-center justify-center z-20 pointer-events-none">
            <span className="bg-slate-800 text-white text-xs font-bold px-3 py-1 rounded-md uppercase tracking-wider">
              Out of stock
            </span>
          </div>
        )}

        {/* Wishlist button */}
        <button
          type="button"
          onClick={handleToggleFavorite}
          aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          className={cn(
            'group/fav absolute bottom-2 right-2 p-1.5 bg-transparent flex items-center justify-center transition-all cursor-pointer z-30 active:scale-90',
            isFavorite ? 'text-rose-600' : 'text-slate-400 hover:text-rose-500',
          )}
        >
          <Heart
            className={cn(
              'w-5 h-5 transition-all duration-200',
              isFavorite
                ? 'fill-rose-600 text-rose-600'
                : 'text-slate-400 group-hover/fav:fill-rose-500 group-hover/fav:text-rose-500 group-hover/fav:scale-110',
            )}
          />
        </button>
      </Link>

      {/* Content */}
      <div className="flex flex-col flex-1">
        {/* Category or manufacturer meta label */}
        <div className="mb-1 text-xs font-semibold text-slate-500 uppercase tracking-wider truncate">
          {product.manufacturer || product.category?.categoryName || 'General Healthcare'}
        </div>

        {/* Medicine Name */}
        <Link href={`/products/${product.slug || product.id}`} className="block mb-2">
          <h3 className="text-base font-bold text-slate-900 line-clamp-2 leading-snug min-h-[44px] group-hover:text-[#004996] transition-colors m-0">
            {cleanText(product.medicineName)}
          </h3>
        </Link>

        {/* Price Area */}
        <div className="mt-auto mb-3.5">
          <div className="flex items-baseline gap-1.5 leading-none">
            <span className="text-lg sm:text-xl font-extrabold text-slate-900 tabular-nums tracking-tight">
              {formatCurrency(shownPrice)}
            </span>
            <span className="text-sm text-slate-500 font-medium">
              /{shownUnit}
            </span>
          </div>
          {hasDiscount && (
            <div className="mt-1">
              <span className="text-xs text-slate-400 line-through tabular-nums font-medium">
                {formatCurrency(shownOriginal)}
              </span>
            </div>
          )}
        </div>

        {/* Add to Cart Button */}
        {isInStock ? (
          <button
            type="button"
            onClick={handleAddToCart}
            className="w-full h-10 rounded-xl border-2 border-[#004996] bg-white text-[#004996] hover:bg-blue-50 active:bg-blue-100 text-sm font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Add to cart</span>
          </button>
        ) : (
          <button
            type="button"
            disabled
            className="w-full h-10 rounded-xl bg-slate-100 text-slate-400 text-sm font-medium flex items-center justify-center gap-2 border border-slate-200 cursor-not-allowed select-none"
          >
            <span>Out of stock</span>
          </button>
        )}
      </div>
    </article>
  );
}
