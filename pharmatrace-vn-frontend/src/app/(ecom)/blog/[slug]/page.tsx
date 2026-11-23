'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Empty, Skeleton } from 'antd';
import { ArrowLeft } from 'lucide-react';
import { articleService } from '@/services/article.service';
import { Article } from '@/types/article.types';
import { ArticleView } from '@/components/blog/ArticleView';
import { ArticleComments } from '@/components/blog/ArticleComments';

export default function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    articleService
      .getBySlug(slug)
      .then((res) => {
        setArticle(res.data);
        document.title = `${res.data.title} - PharmaTrace VN`;
      })
      .catch(() => setArticle(null))
      .finally(() => setLoading(false));
  }, [slug]);

  return (
    <div className="w-full py-4">
      <Link href="/blog" className="mb-6 inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-brand-500">
        <ArrowLeft size={16} /> Health Library
      </Link>
      {loading ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : !article ? (
        <Empty description="This article is not available" className="py-16" />
      ) : (
        <>
          <ArticleView
            title={article.title}
            summary={article.summary}
            content={article.content}
            coverImageUrl={article.coverImageUrl}
            categoryName={article.category?.name}
            authorName={article.authorName}
            publishedAt={article.publishedAt}
          />
          <ArticleComments slug={article.slug} />
        </>
      )}
    </div>
  );
}
