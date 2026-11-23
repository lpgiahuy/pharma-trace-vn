'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { productService } from '@/services/product.service';
import { categoryService } from '@/services/category.service';
import { ProductCard } from '@/components/shared/ProductCard';
import { Product } from '@/types/product.types';
import { Category } from '@/types/category.types';
import { cn } from '@/utils';

export function RecommendedProducts() {
  const [tabs, setTabs] = useState<Category[]>([]);
  const [activeTab, setActiveTab] = useState<number | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);

  useEffect(() => {
    categoryService
      .getCategories()
      .then((res) => setTabs((res?.data || []).filter((c) => !c.parentId).slice(0, 3)))
      .catch(() => setTabs([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    productService
      .getProducts({ page: 1, limit: 10, sortBy: 'id', sortOrder: 'asc', inStock: true, ...(activeTab ? { categoryId: activeTab } : {}) })
      .then((res) => {
        if (!cancelled) setProducts(res?.data || []);
      })
      .catch(() => {
        if (!cancelled) setProducts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  const tabCls = (active: boolean) =>
    cn(
      'text-sm font-bold uppercase tracking-widest transition-colors cursor-pointer whitespace-nowrap',
      active ? 'text-[#004996]' : 'text-slate-400 hover:text-[#004996]',
    );

  return (
    <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-5 border-b border-slate-100">
        <h2 className="m-0 text-xl sm:text-2xl font-extrabold text-slate-900">Recommended for you</h2>
        <div className="flex items-center gap-5 overflow-x-auto no-scrollbar">
          <button type="button" className={tabCls(activeTab === null)} onClick={() => setActiveTab(null)}>
            All
          </button>
          {tabs.map((t) => (
            <button key={t.id} type="button" className={tabCls(activeTab === t.id)} onClick={() => setActiveTab(t.id)}>
              {t.categoryName}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4 sm:p-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
          {products === null
            ? Array.from({ length: 10 }).map((_, i) => <div key={i} className="h-[340px] rounded-2xl bg-slate-200/70 animate-pulse" />)
            : products.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
        {products && products.length === 0 && (
          <p className="py-8 text-center text-slate-500 font-medium">No products in this category yet.</p>
        )}
        {products && products.length > 0 && (
          <div className="mt-8 flex justify-center">
            <Link
              href={activeTab ? `/products?category=${activeTab}` : '/products'}
              className="px-12 py-3 rounded-xl border-2 border-[#004996] bg-white text-sm font-black uppercase tracking-widest !text-[#004996] hover:bg-blue-50 transition-colors"
            >
              View all
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
