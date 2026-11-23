'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Empty, Input, Pagination, Skeleton } from 'antd';
import { articleService } from '@/services/article.service';
import { cn, formatDate } from '@/utils';
import { ArticleCategory, ArticleListItem, Pagination as PageInfo } from '@/types/article.types';

const PAGE_SIZE = 9;

export default function BlogPage() {
  const [items, setItems] = useState<ArticleListItem[]>([]);
  const [pagination, setPagination] = useState<PageInfo>({ page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 });
  const [categories, setCategories] = useState<ArticleCategory[]>([]);
  const [categoryId, setCategoryId] = useState<number>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    articleService
      .categories()
      .then((res) => setCategories(res.data))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    articleService
      .list({ page, limit: PAGE_SIZE, search: search || undefined, categoryId })
      .then((res) => {
        setItems(res.data);
        setPagination(res.pagination);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [page, search, categoryId]);

  const chip = (active: boolean) =>
    cn(
      'rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors',
      active ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-brand-500',
    );

  return (
    <div className="w-full space-y-6 py-4">
      <div>
        <h1 className="text-3xl font-black text-slate-900">Health Library</h1>
        <p className="mt-1 text-slate-600">Articles from our pharmacists on medicines and everyday health.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input.Search
          allowClear
          className="w-full sm:w-80"
          placeholder="Search articles"
          onSearch={(value) => {
            setSearch(value.trim());
            setPage(1);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={chip(categoryId === undefined)}
            onClick={() => {
              setCategoryId(undefined);
              setPage(1);
            }}
          >
            All
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              className={chip(categoryId === category.id)}
              onClick={() => {
                setCategoryId(category.id);
                setPage(1);
              }}
            >
              {category.name}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} active />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Empty description="No articles found" className="py-16" />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((article) => (
            <Link
              key={article.id}
              href={`/blog/${article.slug}`}
              className="group overflow-hidden rounded-lg border border-slate-200 bg-white transition-shadow hover:shadow-md"
            >
              {article.coverImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={article.coverImageUrl} alt="" className="aspect-video w-full object-cover" />
              ) : (
                <div className="aspect-video w-full bg-brand-50" />
              )}
              <div className="p-4">
                {article.category && <span className="text-xs font-bold uppercase tracking-wide text-brand-500">{article.category.name}</span>}
                <h2 className="mt-1 line-clamp-2 text-lg font-bold text-slate-900 group-hover:text-brand-500">{article.title}</h2>
                {article.summary && <p className="mt-2 line-clamp-3 text-sm text-slate-600">{article.summary}</p>}
                <p className="mt-3 text-xs text-slate-500">
                  {article.authorName ? `${article.authorName} · ` : ''}
                  {formatDate(article.publishedAt)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Pagination
        align="end"
        current={pagination.page}
        pageSize={PAGE_SIZE}
        total={pagination.total}
        showSizeChanger={false}
        hideOnSinglePage
        onChange={setPage}
        itemRender={(_page, type, originalElement) => {
          if (type === 'prev') {
            return <span className="px-1 text-xs font-medium text-slate-600">&lt; Previous</span>;
          }
          if (type === 'next') {
            return <span className="px-1 text-xs font-medium text-[#1e4287]">Next &gt;</span>;
          }
          return originalElement;
        }}
      />
    </div>
  );
}
