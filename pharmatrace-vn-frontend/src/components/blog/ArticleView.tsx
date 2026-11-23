import { formatDate } from '@/utils';
import { ArticleContent } from './ArticleContent';

interface ArticleViewProps {
  title: string;
  summary?: string | null;
  content: string;
  coverImageUrl?: string | null;
  categoryName?: string | null;
  authorName?: string | null;
  publishedAt?: string | null;
}

export function ArticleView({ title, summary, content, coverImageUrl, categoryName, authorName, publishedAt }: ArticleViewProps) {
  return (
    <article className="w-full">
      {categoryName && (
        <span className="inline-block rounded-full bg-brand-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand-500">
          {categoryName}
        </span>
      )}
      <h1 className="mt-3 text-3xl font-black leading-tight text-slate-900 sm:text-4xl">{title || 'Untitled article'}</h1>
      <p className="mt-3 text-sm text-slate-500">
        {authorName ? `${authorName} · ` : ''}
        {formatDate(publishedAt ?? new Date())}
      </p>
      {summary && <p className="mt-4 text-lg leading-relaxed text-slate-600">{summary}</p>}
      {coverImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverImageUrl} alt="" className="mt-6 aspect-video w-full rounded-lg object-cover" />
      )}
      <div className="mt-8">
        <ArticleContent html={content} />
      </div>
    </article>
  );
}
