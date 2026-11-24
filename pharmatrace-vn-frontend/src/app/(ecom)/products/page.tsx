'use client';

import React, { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Spin, Pagination, Drawer } from 'antd';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Minus,
  X,
  Package,
  Search,
  MessageCircle,
  SlidersHorizontal,
} from 'lucide-react';
import { productService } from '@/services/product.service';
import { categoryService } from '@/services/category.service';
import { wishlistService } from '@/services/wishlist.service';
import { useAuth } from '@/store/useAuthStore';
import { Product } from '@/types/product.types';
import { Category } from '@/types/category.types';
import { CategoryIcon } from '@/components/common/CategoryIcon';
import { formatCurrency, cn } from '@/utils';
import { parsePriceRange } from '@/utils/price-range';
import { selectionState, toggleCategorySelection, topSelectedIds } from '@/utils/category-selection';
import { pickVariantForPriceRange } from '@/utils/product-variant';
import { ProductCard } from '@/components/shared/ProductCard';

const buildCategoryTree = (flatList: Category[]): (Category & { children?: Category[] })[] => {
  const map = new Map<number, Category & { children?: Category[] }>();
  const tree: (Category & { children?: Category[] })[] = [];

  flatList.forEach((item) => {
    map.set(item.id, { ...item, children: [] });
  });

  flatList.forEach((item) => {
    const mappedItem = map.get(item.id)!;
    if (item.parentId && map.has(item.parentId)) {
      const parent = map.get(item.parentId)!;
      if (!parent.children) parent.children = [];
      parent.children.push(mappedItem);
    } else {
      tree.push(mappedItem);
    }
  });

  const cleanEmptyChildren = (nodes: (Category & { children?: Category[] })[]) => {
    nodes.forEach((node) => {
      if (node.children && node.children.length === 0) {
        delete node.children;
      } else if (node.children) {
        cleanEmptyChildren(node.children);
      }
    });
  };
  cleanEmptyChildren(tree);

  return tree;
};

function CategoryFilterItem({
  cat,
  tree,
  selectedCategory,
  onCategoryToggle,
}: {
  cat: Category & { children?: Category[] };
  tree: (Category & { children?: Category[] })[];
  selectedCategory?: string;
  onCategoryToggle: (id: number | '') => void;
}) {
  const selectedIds = selectedCategory ? String(selectedCategory).split(',').filter(Boolean) : [];
  const hasChildren = cat.children && cat.children.length > 0;
  // A parent is checked when it and all its children are selected, and partial when only some children are.
  const parentState = selectionState(tree, selectedIds, cat.id);
  const isParentSelected = parentState === 'checked';
  const isParentPartial = parentState === 'partial';
  const isParentActive = parentState !== 'none';

  const [expanded, setExpanded] = useState(isParentActive);

  const [previousParentActive, setPreviousParentActive] = useState(isParentActive);
  if (previousParentActive !== isParentActive) {
    setPreviousParentActive(isParentActive);
    if (isParentActive) setExpanded(true);
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 min-w-0">
        <button
          type="button"
          onClick={() => onCategoryToggle(cat.id)}
          className={cn(
            'flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors group text-left min-w-0 cursor-pointer',
            isParentSelected || isParentPartial
              ? 'bg-blue-50 border-blue-200 text-[#004996] font-bold'
              : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50',
          )}
        >
          <div
            className={cn(
              'w-4 h-4 rounded-md border flex items-center justify-center transition-colors shrink-0',
              isParentSelected || isParentPartial ? 'border-[#004996] bg-[#004996]' : 'border-slate-300 text-slate-400 group-hover:text-slate-600',
            )}
          >
            {isParentSelected ? (
              <Check className="w-2.5 h-2.5 text-white stroke-[2.5]" />
            ) : isParentPartial ? (
              <Minus aria-label="Some subcategories selected" className="w-2.5 h-2.5 text-white stroke-[3]" />
            ) : (
              <CategoryIcon icon={cat.icon || 'pill'} size={12} />
            )}
          </div>
          <span className="truncate">{cat.categoryName}</span>
        </button>

        {hasChildren && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className={cn(
              'w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-700 transition-colors cursor-pointer shrink-0',
              expanded && 'bg-slate-50 text-[#004996] border-slate-300',
            )}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* Sub-categories */}
      {hasChildren && expanded && (
        <div className="pl-5 space-y-1 animate-fade-in">
          {cat.children!.map((child) => {
            const isChildActive = selectionState(tree, selectedIds, child.id) === 'checked';
            return (
              <button
                key={child.id}
                type="button"
                onClick={() => onCategoryToggle(child.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors group text-left min-w-0 cursor-pointer',
                  isChildActive
                    ? 'bg-blue-50 border-blue-200 text-[#004996] font-bold'
                    : 'bg-transparent border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                <div
                  className={cn(
                    'w-3.5 h-3.5 rounded-md border flex items-center justify-center transition-colors shrink-0',
                    isChildActive ? 'border-[#004996] bg-[#004996]' : 'border-slate-300 group-hover:border-slate-400',
                  )}
                >
                  {isChildActive && <Check className="w-2.5 h-2.5 text-white stroke-[2.5]" />}
                </div>
                <span className="truncate">{child.categoryName}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProductListContainer() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated } = useAuth();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryTree, setCategoryTree] = useState<(Category & { children?: Category[] })[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [brandSearch, setBrandSearch] = useState('');
  const [showAllBrands, setShowAllBrands] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [wishlistIds, setWishlistIds] = useState<Set<number>>(new Set());

  const page = Number(searchParams.get('page')) || 1;
  const categoryParam = searchParams.get('category') || '';
  const sort = searchParams.get('sort') || 'newest';
  const search = searchParams.get('search') || '';
  const selectedBrand = searchParams.get('brand') || '';
  const inStockOnly = searchParams.get('in_stock') === 'true';
  const minPrice = searchParams.get('minPrice') || '';
  const maxPrice = searchParams.get('maxPrice') || '';

  useEffect(() => {
    if (isAuthenticated && products.length > 0) {
      const ids = products.map((p) => p.id);
      wishlistService
        .checkBatchWishlist(ids)
        .then((res) => {
          if (res?.data?.wishlistedProductIds) {
            setWishlistIds(new Set(res.data.wishlistedProductIds));
          }
        })
        .catch(() => { });
    } else {
      setWishlistIds(new Set());
    }
  }, [isAuthenticated, products]);

  const handleToggleWishlist = (productId: number, nextStatus: boolean) => {
    setWishlistIds((prev) => {
      const next = new Set(prev);
      if (nextStatus) next.add(productId);
      else next.delete(productId);
      return next;
    });
  };

  const [localMin, setLocalMin] = useState(minPrice);
  const [localMax, setLocalMax] = useState(maxPrice);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(search);

  useEffect(() => {
    const loadCategoriesAndBrands = () => {
      categoryService.getCategories().then((res) => {
        if (res?.data) {
          setCategories(res.data);
          const tree = buildCategoryTree(res.data);
          setCategoryTree(tree);
        }
      }).catch(() => {});

      productService.getBrands().then((res) => {
        if (res?.data) {
          setBrands(res.data);
        }
      }).catch(() => { });
    };

    loadCategoriesAndBrands();
  }, []);

  const setParam = useCallback(
    (key: string, val: any) => {
      const current = new URLSearchParams(Array.from(searchParams.entries()));
      if (val !== undefined && val !== null && val !== '') {
        current.set(key, String(val));
      } else {
        current.delete(key);
      }
      if (key !== 'page') current.set('page', '1');
      router.push(`/products?${current.toString()}`);
    },
    [router, searchParams],
  );

  const handleCategoryToggle = (catId: number | '') => {
    if (!catId) {
      setParam('category', '');
      return;
    }
    const current = categoryParam ? categoryParam.split(',').filter(Boolean) : [];
    // A parent selects (or clears) everything under it; a parent is only ticked when all its children are.
    setParam('category', toggleCategorySelection(categoryTree, current, Number(catId)).join(','));
  };

  const handleBrandToggle = (brandName: string) => {
    const current = selectedBrand ? selectedBrand.split(',').filter(Boolean) : [];
    if (current.includes(brandName)) {
      const next = current.filter((b) => b !== brandName);
      setParam('brand', next.join(','));
    } else {
      setParam('brand', [...current, brandName].join(','));
    }
  };

  const handleClearFilters = () => {
    setSearchInput('');
    setLocalMin('');
    setLocalMax('');
    setPriceError(null);
    setBrandSearch('');
    router.push('/products');
  };

  const handleApplyCustomPrice = () => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    const { min: parsedMin, max: parsedMax, error } = parsePriceRange(localMin, localMax);
    setPriceError(error);
    if (error) return;

    if (parsedMin !== null) current.set('minPrice', String(parsedMin));
    else current.delete('minPrice');
    if (parsedMax !== null) current.set('maxPrice', String(parsedMax));
    else current.delete('maxPrice');
    current.set('page', '1');
    router.push(`/products?${current.toString()}`);
  };

  const fetchProducts = useCallback(async function loadProducts(retryAttempt = 0) {
    setLoading(true);
    setFetchError(null);
    try {
      let sortBy: 'id' | 'price' | 'name' | 'createdAt' = 'id';
      let sortOrder: 'asc' | 'desc' = 'desc';

      if (sort === 'oldest') {
        sortBy = 'id';
        sortOrder = 'asc';
      } else if (sort === 'price_asc') {
        sortBy = 'price';
        sortOrder = 'asc';
      } else if (sort === 'price_desc') {
        sortBy = 'price';
        sortOrder = 'desc';
      } else if (sort === 'name_asc') {
        sortBy = 'name';
        sortOrder = 'asc';
      } else if (sort === 'name_desc') {
        sortBy = 'name';
        sortOrder = 'desc';
      } else {
        // default: newest
        sortBy = 'id';
        sortOrder = 'desc';
      }

      const res = await productService.getProducts({
        page,
        limit: 12,
        categoryId: categoryParam || undefined,
        minPrice: minPrice ? Number(minPrice) : undefined,
        maxPrice: maxPrice ? Number(maxPrice) : undefined,
        search: search.trim() || undefined,
        manufacturer: selectedBrand || undefined,
        inStock: inStockOnly ? true : undefined,
        status: 'ACTIVE',
        sortBy,
        sortOrder,
      });

      if (res && res.data) {
        setProducts(res.data);
        setTotal(res.pagination?.total ?? res.data.length);
        setFetchError(null);
        setLoading(false);
      } else {
        setProducts([]);
        setTotal(0);
        setLoading(false);
      }
    } catch (err: any) {
      console.error('Failed to load products:', err);
      if (retryAttempt < 1) {
        setTimeout(() => {
          void loadProducts(retryAttempt + 1);
        }, 1200);
        return;
      }
      setProducts([]);
      setTotal(0);
      setFetchError(err?.message || 'Unable to load products. Please check server connection.');
      setLoading(false);
    }
  }, [page, categoryParam, minPrice, maxPrice, search, selectedBrand, sort, inStockOnly]);

  useEffect(() => {
    // Cancel pending work when dependencies change or the component unmounts.
    const timer = setTimeout(() => {
      fetchProducts();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchProducts]);

  const hasActiveFilters = Boolean(categoryParam || minPrice || maxPrice || inStockOnly || selectedBrand || search);

  const PRICE_OPTIONS = [
    { label: 'Under 50,000 ₫', min: '', max: '50000' },
    { label: '50,000 ₫ - 100,000 ₫', min: '50000', max: '100000' },
    { label: '100,000 ₫ - 300,000 ₫', min: '100000', max: '300000' },
    { label: '300,000 ₫ - 500,000 ₫', min: '300000', max: '500000' },
    { label: 'Above 500,000 ₫', min: '500000', max: '' },
  ];

  const selectedBrandsList = selectedBrand ? selectedBrand.split(',').filter(Boolean) : [];

  const filteredBrands = brands.filter((b) =>
    b.toLowerCase().includes(brandSearch.toLowerCase()),
  );
  const displayedBrands = showAllBrands ? filteredBrands : filteredBrands.slice(0, 6);

  const activeFilterCount = [
    Boolean(categoryParam),
    Boolean(inStockOnly),
    Boolean(minPrice || maxPrice),
    Boolean(selectedBrand),
    Boolean(search),
  ].filter(Boolean).length;

  const renderFilterBody = () => (
    <>
      {/* Department */}
      <div className="space-y-2">
        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider m-0">Department</h4>
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => handleCategoryToggle('')}
            className={cn(
              'w-full flex items-center gap-2.5 px-3 py-2 rounded-md border text-xs font-medium transition-colors group text-left cursor-pointer',
              !categoryParam
                ? 'bg-blue-50 border-blue-200 text-[#004996] font-semibold'
                : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50',
            )}
          >
            <div
              className={cn(
                'w-4 h-4 rounded-sm border flex items-center justify-center transition-colors shrink-0',
                !categoryParam ? 'border-[#004996] bg-[#004996]' : 'border-slate-300',
              )}
            >
              {!categoryParam && <Check className="w-2.5 h-2.5 text-white stroke-[2.5]" />}
            </div>
            <span>All Categories</span>
          </button>

          {categoryTree.map((cat) => (
            <CategoryFilterItem
              key={cat.id}
              cat={cat}
              tree={categoryTree}
              selectedCategory={categoryParam}
              onCategoryToggle={handleCategoryToggle}
            />
          ))}
        </div>
      </div>

      {/* Availability */}
      <div className="space-y-2 pt-2 border-t border-slate-100">
        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider m-0">Availability</h4>
        <button
          type="button"
          onClick={() => setParam('in_stock', inStockOnly ? '' : 'true')}
          className={cn(
            'w-full flex items-center gap-2.5 px-3 py-2 rounded-md border text-xs font-medium transition-colors group text-left cursor-pointer',
            inStockOnly
              ? 'bg-blue-50 border-blue-200 text-[#004996] font-semibold'
              : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50',
          )}
        >
          <div
            className={cn(
              'w-4 h-4 rounded-sm border flex items-center justify-center transition-colors shrink-0',
              inStockOnly ? 'border-[#004996] bg-[#004996]' : 'border-slate-300',
            )}
          >
            {inStockOnly && <Check className="w-2.5 h-2.5 text-white stroke-[2.5]" />}
          </div>
          <span>Show in-stock only</span>
        </button>
      </div>

      {/* Price Range (VND) */}
      <div className="space-y-2 pt-2 border-t border-slate-100">
        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider m-0">Price Range (VND)</h4>
        <div className="space-y-1">
          {PRICE_OPTIONS.map((p, idx) => {
            const isChecked = minPrice === p.min && maxPrice === p.max;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  const current = new URLSearchParams(Array.from(searchParams.entries()));
                  if (isChecked) {
                    current.delete('minPrice');
                    current.delete('maxPrice');
                  } else {
                    if (p.min) current.set('minPrice', p.min);
                    else current.delete('minPrice');
                    if (p.max) current.set('maxPrice', p.max);
                    else current.delete('maxPrice');
                  }
                  current.set('page', '1');
                  router.push(`/products?${current.toString()}`);
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-md border text-xs font-medium transition-colors group text-left cursor-pointer',
                  isChecked
                    ? 'bg-blue-50 border-blue-200 text-[#004996] font-semibold'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50',
                )}
              >
                <div
                  className={cn(
                    'w-3.5 h-3.5 rounded-full border flex items-center justify-center transition-colors shrink-0',
                    isChecked ? 'border-[#004996] bg-white' : 'border-slate-300',
                  )}
                >
                  {isChecked && <div className="w-1.5 h-1.5 rounded-full bg-[#004996]" />}
                </div>
                <span className="tabular-nums">{p.label}</span>
              </button>
            );
          })}
        </div>

        {/* Custom Min / Max Price Input */}
        <div className="pt-2 space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <div className="relative">
              <input
                type="number"
                min="0"
                placeholder="Min"
                value={localMin}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') {
                    setLocalMin('');
                  } else {
                    const num = Math.max(0, parseInt(val.replace(/[^0-9]/g, ''), 10) || 0);
                    setLocalMin(String(num));
                  }
                }}
                className="w-full h-8 px-2.5 pr-5 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-[#004996] focus:border-[#004996] outline-none tabular-nums"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-medium">₫</span>
            </div>
            <div className="relative">
              <input
                type="number"
                min="0"
                placeholder="Max"
                value={localMax}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') {
                    setLocalMax('');
                  } else {
                    const num = Math.max(0, parseInt(val.replace(/[^0-9]/g, ''), 10) || 0);
                    setLocalMax(String(num));
                  }
                }}
                className="w-full h-8 px-2.5 pr-5 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-[#004996] focus:border-[#004996] outline-none tabular-nums"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-medium">₫</span>
            </div>
          </div>
          {priceError && (
            <p role="alert" className="text-[11px] text-rose-600">{priceError}</p>
          )}
          <button
            type="button"
            onClick={handleApplyCustomPrice}
            className="w-full h-8 rounded-md bg-[#004996] hover:bg-[#003772] text-white font-medium text-xs tracking-wider transition-colors cursor-pointer"
          >
            Apply Price
          </button>
        </div>
      </div>

      {/* Brand Filter */}
      {brands.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider m-0">Brand</h4>

          {/* Brand Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search brand..."
              value={brandSearch}
              onChange={(e) => setBrandSearch(e.target.value)}
              className="w-full h-8 pl-8 pr-2.5 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-[#004996] focus:border-[#004996] outline-none"
            />
          </div>

          {/* Brand List */}
          <div
            className={cn(
              'space-y-1 overflow-y-auto pr-1 transition-all duration-300',
              showAllBrands ? 'max-h-[500px]' : 'max-h-48',
            )}
          >
            {displayedBrands.map((brand) => {
              const isBrandActive = selectedBrandsList.includes(brand);
              return (
                <button
                  key={brand}
                  type="button"
                  onClick={() => handleBrandToggle(brand)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors group text-left cursor-pointer',
                    isBrandActive
                      ? 'bg-blue-50 border-blue-200 text-[#004996] font-semibold'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50',
                  )}
                >
                  <div
                    className={cn(
                      'w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-colors shrink-0',
                      isBrandActive ? 'border-[#004996] bg-[#004996]' : 'border-slate-300',
                    )}
                  >
                    {isBrandActive && <Check className="w-2.5 h-2.5 text-white stroke-[2.5]" />}
                  </div>
                  <span className="truncate">{brand}</span>
                </button>
              );
            })}
          </div>

          {filteredBrands.length > 6 && (
            <button
              type="button"
              onClick={() => setShowAllBrands(!showAllBrands)}
              className="w-full flex items-center justify-center gap-1 text-xs font-semibold text-[#004996] hover:underline transition-colors py-1 cursor-pointer"
            >
              {showAllBrands ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5" /> Show less
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5" /> Show more ({filteredBrands.length - 6})
                </>
              )}
            </button>
          )}
        </div>
      )}
    </>
  );

  return (
    <div className="w-full animate-fade-in min-h-[75vh]">
      <div className="flex flex-col md:flex-row gap-8">
        {/* Left Sidebar Filter (Desktop Only) */}
        <aside className="hidden md:block w-64 shrink-0 space-y-6">
          <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-800 text-base m-0">Filter By</h3>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="text-xs text-rose-500 hover:underline flex items-center gap-1 cursor-pointer font-semibold"
                >
                  <X className="w-3 h-3" /> Clear
                </button>
              )}
            </div>

            {renderFilterBody()}
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Top Search & Filter Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="Search product"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setParam('search', searchInput);
                  }
                }}
                className="w-full h-9 pl-3.5 pr-9 rounded-md border border-slate-200 bg-white text-xs focus:outline-none focus:border-[#004996] focus:ring-1 focus:ring-[#004996]"
              />
              <button
                type="button"
                onClick={() => setParam('search', searchInput)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#004996] cursor-pointer"
              >
                <Search className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              {/* Mobile Filter Trigger Button (Phone/Tablet only) */}
              <button
                type="button"
                onClick={() => setMobileFilterOpen(true)}
                className="md:hidden flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0 shadow-2xs"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-[#004996]" />
                <span>Filters</span>
                {activeFilterCount > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#004996] text-white text-[10px] font-bold flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </button>

              <div className="relative min-w-[145px] sm:min-w-[165px] flex-1 sm:flex-initial">
                <select
                  value={sort}
                  onChange={(e) => setParam('sort', e.target.value)}
                  className="w-full h-9 pl-3.5 pr-8 rounded-md border border-slate-200 bg-white text-xs font-semibold focus:outline-none focus:border-[#004996] text-slate-800 cursor-pointer appearance-none shadow-2xs"
                >
                  <option value="newest">Newest Arrivals</option>
                  <option value="price_asc">Price: Low to High</option>
                  <option value="price_desc">Price: High to Low</option>
                  <option value="name_asc">Name: A to Z</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Active Filter Tags */}
          {hasActiveFilters && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1 pb-1">
              <span className="text-xs font-semibold text-slate-500 mr-1">
                Active filters:
              </span>
              {topSelectedIds(categoryTree, categoryParam.split(',').filter(Boolean))
                .map((catIdStr) => {
                  const cat = categories.find((c) => String(c.id) === catIdStr);
                  return (
                    <span
                      key={catIdStr}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 text-[#004996] border border-blue-200 text-xs font-medium"
                    >
                      <span>Category: {cat ? cat.categoryName : catIdStr}</span>
                      <button
                        type="button"
                        onClick={() => handleCategoryToggle(Number(catIdStr))}
                        className="hover:text-rose-600 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
              {selectedBrandsList.map((brandName) => (
                <span
                  key={brandName}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 border border-slate-200 text-xs font-medium"
                >
                  <span>Brand: {brandName}</span>
                  <button
                    type="button"
                    onClick={() => handleBrandToggle(brandName)}
                    className="hover:text-rose-600 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              {(minPrice || maxPrice) && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 text-[#004996] border border-blue-200 text-xs font-medium">
                  <span>
                    Price:{' '}
                    {minPrice && maxPrice
                      ? `${formatCurrency(Number(minPrice))} - ${formatCurrency(Number(maxPrice))}`
                      : minPrice
                        ? `>= ${formatCurrency(Number(minPrice))}`
                        : `<= ${formatCurrency(Number(maxPrice))}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const current = new URLSearchParams(Array.from(searchParams.entries()));
                      current.delete('minPrice');
                      current.delete('maxPrice');
                      current.set('page', '1');
                      router.push(`/products?${current.toString()}`);
                    }}
                    className="hover:text-rose-600 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              <button
                type="button"
                onClick={handleClearFilters}
                className="text-xs text-rose-600 hover:underline font-semibold ml-1 cursor-pointer"
              >
                Clear all
              </button>
            </div>
          )}

          {/* Results Count */}
          <div className="text-xs text-slate-500 font-medium pt-0.5">
            Showing <span className="font-semibold text-slate-800 tabular-nums">{total}</span> results
          </div>

          {/* Product Grid (4 columns) */}
          {loading ? (
            <div className="py-24 text-center bg-white rounded-md border border-slate-200">
              <Spin size="large" />
              <p className="mt-3 text-slate-500 text-xs font-medium">Loading products...</p>
            </div>
          ) : fetchError ? (
            <div className="py-16 text-center bg-white rounded-md border border-rose-200 space-y-3">
              <Package className="w-10 h-10 text-rose-300 mx-auto" />
              <p className="text-sm font-semibold text-rose-700 m-0">Failed to load products</p>
              <p className="text-xs text-slate-500">{fetchError}</p>
              <button
                type="button"
                onClick={() => fetchProducts(0)}
                className="px-4 py-2 rounded-lg bg-[#004996] text-white text-xs font-semibold hover:bg-[#003875] transition-colors cursor-pointer"
              >
                Try again
              </button>
            </div>
          ) : products.length === 0 ? (
            <div className="py-16 text-center bg-white rounded-md border border-slate-200 space-y-3">
              <Package className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-sm font-semibold text-slate-700 m-0">No products found</p>
              <button
                type="button"
                onClick={handleClearFilters}
                className="text-xs text-[#004996] font-semibold hover:underline cursor-pointer"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {products.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  variant={pickVariantForPriceRange(p, minPrice ? Number(minPrice) : null, maxPrice ? Number(maxPrice) : null)}
                  isFavorite={wishlistIds.has(p.id)}
                  onToggleFavorite={handleToggleWishlist}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {total > 12 && (
            <div className="flex justify-center pt-6">
              <Pagination
                current={page}
                pageSize={12}
                total={total}
                onChange={(p) => setParam('page', p)}
                showSizeChanger={false}
              />
            </div>
          )}
        </div>
      </div>

      {/* Mobile Filter Drawer */}
      <Drawer
        title={
          <div className="flex items-center justify-between pr-2">
            <span className="font-bold text-slate-900 text-base">Filter Products</span>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="text-xs text-rose-500 hover:underline flex items-center gap-1 font-semibold cursor-pointer"
              >
                <X className="w-3.5 h-3.5" /> Clear All
              </button>
            )}
          </div>
        }
        placement="left"
        onClose={() => setMobileFilterOpen(false)}
        open={mobileFilterOpen}
        styles={{ wrapper: { width: 320 }, body: { padding: '16px' } }}
        footer={
          <div className="p-2">
            <button
              type="button"
              onClick={() => setMobileFilterOpen(false)}
              className="w-full py-2.5 rounded-xl bg-[#004996] hover:bg-[#003875] text-white font-bold text-sm shadow-xs transition-colors cursor-pointer"
            >
              Show Results ({total} items)
            </button>
          </div>
        }
      >
        <div className="space-y-6">
          {renderFilterBody()}
        </div>
      </Drawer>

      {/* Floating Chat Widget on Bottom Right */}
      <button
        type="button"
        className="fixed bottom-6 right-6 w-11 h-11 rounded-full bg-[#004996] hover:bg-[#003772] text-white shadow-md hover:shadow-lg flex items-center justify-center z-50 transition-all cursor-pointer"
        title="Live Support"
      >
        <MessageCircle className="w-5 h-5 fill-current" />
      </button>
    </div>
  );
}

export default function ProductListPage() {
  return (
    <Suspense fallback={<div className="py-24 text-center"><Spin size="large" /></div>}>
      <ProductListContainer />
    </Suspense>
  );
}
