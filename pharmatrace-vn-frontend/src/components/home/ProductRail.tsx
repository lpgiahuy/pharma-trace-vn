'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { productService } from '@/services/product.service';
import { ProductCard } from '@/components/shared/ProductCard';
import { Product, ProductQuery } from '@/types/product.types';
import { cn } from '@/utils';

interface ProductRailProps {
  title: string;
  query: ProductQuery;
  href?: string;
  /** Optional client-side filter, e.g. keep only discounted products. */
  filter?: (p: Product) => boolean;
  /** Pick the packaging variant a card should show and sell (e.g. the one on sale). */
  variantFor?: (p: Product) => NonNullable<Product['packagingOptions']>[number] | undefined;
  limit?: number;
  tone?: 'light' | 'sale';
  headerExtra?: React.ReactNode;
}

export function ProductRail({ title, query, href = '/products', filter, variantFor, limit = 12, tone = 'light', headerExtra }: ProductRailProps) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    let cancelled = false;
    productService
      .getProducts(JSON.parse(queryKey))
      .then((res) => {
        if (cancelled) return;
        const list = res?.data || [];
        setProducts((filter ? list.filter(filter) : list).slice(0, limit));
      })
      .catch(() => {
        if (!cancelled) setProducts([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, limit]);

  if (products && products.length === 0) return null;

  const scrollBy = (dir: 1 | -1) =>
    scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.8, behavior: 'smooth' });

  const sale = tone === 'sale';

  return (
    <section
      className={cn(
        'rounded-2xl overflow-hidden border',
        sale ? 'bg-[#EF4444] border-[#EF4444]' : 'bg-white border-slate-200',
      )}
    >
      <div className={cn('flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4', !sale && 'pb-0')}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2 className={cn('m-0 text-lg sm:text-xl font-extrabold', sale ? '!text-white' : 'text-slate-900')}>{title}</h2>
          {headerExtra}
        </div>
        <Link
          href={href}
          className={cn('text-sm font-bold hover:underline', sale ? '!text-white' : '!text-[#004996]')}
        >
          View all
        </Link>
      </div>

      <div className={cn('relative group p-4 sm:px-6', sale && 'bg-white')}>
        <div ref={scroller} className="flex gap-3 overflow-x-auto no-scrollbar snap-x scroll-smooth pb-1">
          {products === null
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="w-[180px] sm:w-[210px] shrink-0 h-[340px] rounded-2xl bg-slate-200/70 animate-pulse" />
              ))
            : products.map((p) => (
                <div key={p.id} className="w-[180px] sm:w-[210px] shrink-0 snap-start">
                  <ProductCard product={p} variant={variantFor?.(p)} />
                </div>
              ))}
        </div>
        {products && products.length > 4 && (
          <>
            <button
              type="button"
              aria-label="Scroll left"
              onClick={() => scrollBy(-1)}
              className="hidden md:flex absolute -left-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-white shadow-md border border-slate-200 items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            >
              <ChevronLeft className="w-5 h-5 text-slate-700" />
            </button>
            <button
              type="button"
              aria-label="Scroll right"
              onClick={() => scrollBy(1)}
              className="hidden md:flex absolute -right-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-white shadow-md border border-slate-200 items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            >
              <ChevronRight className="w-5 h-5 text-slate-700" />
            </button>
          </>
        )}
      </div>
    </section>
  );
}
