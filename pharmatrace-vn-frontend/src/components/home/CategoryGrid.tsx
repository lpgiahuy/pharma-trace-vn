'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { categoryService } from '@/services/category.service';
import { Category } from '@/types/category.types';
import { CategoryIcon } from '@/components/common/CategoryIcon';

export function CategoryGrid() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeParentId, setActiveParentId] = useState<number | null>(null);

  useEffect(() => {
    categoryService
      .getCategories()
      .then((res) => setCategories(res?.data || []))
      .catch(() => setCategories([]));
  }, []);

  const roots = useMemo(() => categories.filter((c) => !c.parentId), [categories]);
  const childrenOf = (id: number) => categories.filter((c) => c.parentId === id);
  const activeParent = roots.find((c) => c.id === activeParentId);
  const displayed = activeParent ? childrenOf(activeParent.id) : roots;

  if (roots.length === 0) return null;

  return (
    <section className="py-2">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          {activeParent && (
            <button
              type="button"
              aria-label="Back to all categories"
              onClick={() => setActiveParentId(null)}
              className="h-9 w-9 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 hover:bg-blue-50 hover:text-[#004996] transition-all cursor-pointer"
            >
              <ArrowRight className="w-5 h-5 rotate-180" />
            </button>
          )}
          <h2 className="m-0 text-xl sm:text-2xl font-extrabold text-slate-900">
            {activeParent ? activeParent.categoryName : 'Featured categories'}
          </h2>
        </div>
        <Link href="/products" className="text-sm font-black uppercase !text-[#004996] hover:underline">
          View all
        </Link>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-y-6 gap-x-4">
        {displayed.slice(0, 16).map((cat) => {
          const hasChildren = !activeParent && childrenOf(cat.id).length > 0;
          return (
            <Link
              key={cat.id}
              href={`/products?category=${cat.id}`}
              onClick={(e) => {
                if (hasChildren) {
                  e.preventDefault();
                  setActiveParentId(cat.id);
                }
              }}
              className="group flex flex-col items-center gap-3 hover:-translate-y-1 transition-transform duration-200"
            >
              <span className="h-20 w-20 rounded-full bg-white border border-slate-200 shadow-sm text-[#004996] text-3xl flex items-center justify-center group-hover:border-blue-300 group-hover:shadow-md transition-all">
                <CategoryIcon icon={cat.icon || 'category'} size={32} />
              </span>
              <span className="text-[13px] font-bold !text-slate-700 text-center leading-tight line-clamp-2">
                {cat.categoryName}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
