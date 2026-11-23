'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Eye } from 'lucide-react';
import { articleService } from '@/services/article.service';
import type { ArticleListItem } from '@/types/article.types';

export function HealthCorner() {
  const [articles, setArticles] = useState<ArticleListItem[]>([]);

  useEffect(() => {
    articleService
      .list({ page: 1, limit: 3 })
      .then((res) => setArticles(res?.data || []))
      .catch(() => setArticles([]));
  }, []);

  if (articles.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <h2 className="m-0 text-xl sm:text-2xl font-extrabold text-slate-900">Health handbook</h2>
        <Link href="/blog" className="text-sm font-black uppercase !text-[#004996] hover:underline">
          View all posts
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {articles.map((a) => (
          <Link
            key={a.id}
            href={`/blog/${a.slug}`}
            className="group block bg-white rounded-2xl p-4 border border-slate-200 hover:shadow-md transition-shadow"
          >
            <div className="aspect-[16/9] rounded-xl overflow-hidden mb-4 bg-slate-100">
              {a.coverImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.coverImageUrl}
                  alt={a.title}
                  loading="lazy"
                  className="h-full w-full object-cover group-hover:scale-110 transition-transform duration-500"
                />
              )}
            </div>
            <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-[#004996]">
              {a.category?.name || 'Healthcare'}
            </span>
            <h3 className="m-0 mb-2 text-[15px] font-black text-slate-900 line-clamp-2 leading-tight group-hover:text-[#004996] transition-colors">
              {a.title}
            </h3>
            {a.summary && <p className="m-0 mb-4 text-xs text-slate-500 line-clamp-2">{a.summary}</p>}
            <div className="flex items-center justify-between pt-4 border-t border-slate-100 text-[10px] font-bold text-slate-400">
              <span>
                {a.authorName || 'PharmaTrace'}
                {a.publishedAt && ` · ${new Date(a.publishedAt).toLocaleDateString('en-US')}`}
              </span>
              <span className="flex items-center gap-1">
                <Eye className="w-3 h-3" /> {a.viewCount.toLocaleString('en-US')}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
