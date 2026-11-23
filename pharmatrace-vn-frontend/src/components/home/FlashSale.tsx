'use client';

import React, { useEffect, useState } from 'react';
import { ProductRail } from './ProductRail';
import type { Product } from '@/types/product.types';

function Countdown() {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      setLeft(Math.max(0, end.getTime() - now.getTime()));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  if (left === null) return null;
  const s = Math.floor(left / 1000);
  const parts = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0'));
  return (
    <div className="flex items-center gap-1.5 text-white" aria-label="Time left today">
      <span className="mr-1 text-sm font-medium text-white/90">Ends in</span>
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          <span className="w-9 rounded bg-white px-1 py-0.5 text-center text-sm font-bold text-[#EF4444] tabular-nums">{p}</span>
          {i < 2 && <span className="font-bold">:</span>}
        </React.Fragment>
      ))}
    </div>
  );
}

type Variant = NonNullable<Product['packagingOptions']>[number];

// A variant is live when its discount window covers now and it still has sellable
// stock (stock minus reserved).
const isVariantLive = (o: Variant, now: number) =>
  Boolean(
    o.isSaleActive &&
      (o.stock ?? 0) > 0 &&
      o.saleStartDate &&
      o.saleEndDate &&
      new Date(o.saleStartDate).getTime() <= now &&
      new Date(o.saleEndDate).getTime() >= now,
  );

// The variant shown on the card: the live one with the biggest discount.
const liveVariant = (p: Product, now = Date.now()): Variant | undefined =>
  (p.packagingOptions || [])
    .filter((o) => isVariantLive(o, now))
    .sort((x, y) => (y.discountPercent ?? 0) - (x.discountPercent ?? 0))[0];

/**
 * Every product whose discount window covers right now is shown together, even when
 * the windows differ (e.g. 20/11-23/11 and 23/11-26/11 both run today). The countdown
 * runs to the end of today, like Pharmacity's daily deal slots.
 */
export function FlashSale() {
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
  return (
    <ProductRail
      tone="sale"
      title={`Flash sale · ${today}`}
      query={{ page: 1, limit: 30, onSale: true, inStock: true, sortBy: 'createdAt', sortOrder: 'desc' }}
      filter={(p) => Boolean(liveVariant(p))}
      variantFor={(p) => liveVariant(p)}
      headerExtra={<Countdown />}
    />
  );
}
