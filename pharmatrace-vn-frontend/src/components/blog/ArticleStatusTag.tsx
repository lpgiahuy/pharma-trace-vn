import { ArticleStatus } from '@/types/article.types';

const STATUS: Record<ArticleStatus, { label: string; className: string }> = {
  DRAFT: { label: 'Draft', className: 'text-slate-500' },
  PENDING: { label: 'Awaiting approval', className: 'text-amber-600' },
  PUBLISHED: { label: 'Published', className: 'text-green-600' },
  HIDDEN: { label: 'Hidden', className: 'text-red-600' },
};

export function ArticleStatusTag({ status }: { status: ArticleStatus }) {
  const { label, className } = STATUS[status];
  return <span className={`text-sm font-semibold ${className}`}>{label}</span>;
}
