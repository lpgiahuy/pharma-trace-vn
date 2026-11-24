'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { App, Button, Dropdown, Input, Select, Table } from 'antd';
import type { MenuProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { MoreHorizontal, Plus, Tags } from 'lucide-react';
import { articleService } from '@/services/article.service';
import { useAuth } from '@/store/useAuthStore';
import { workflowErrorMessage } from '@/utils/workflow-error';
import { isArticleEditor } from '@/utils/article-roles';
import { formatDate } from '@/utils';
import { ArticleCategory, ArticleListItem, ArticleStatus, Pagination } from '@/types/article.types';
import { ArticleStatusTag } from '@/components/blog/ArticleStatusTag';
import { CategoryManager } from '@/components/blog/CategoryManager';

const PAGE_SIZE = 10;

export default function AdminArticlesPage() {
  const router = useRouter();
  const { message, modal } = App.useApp();
  const { user } = useAuth();
  const isEditor = isArticleEditor(user?.role);

  const [items, setItems] = useState<ArticleListItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 });
  const [categories, setCategories] = useState<ArticleCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ArticleStatus>();
  const [categoryId, setCategoryId] = useState<number>();
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  const loadCategories = useCallback(() => {
    articleService
      .categories()
      .then((res) => setCategories(res.data))
      .catch(() => undefined);
  }, []);

  const load = useCallback(() => {
    articleService
      .adminList({ page, limit: PAGE_SIZE, search: search || undefined, status, categoryId })
      .then((res) => {
        setItems(res.data);
        setPagination(res.pagination);
      })
      .catch((error: unknown) => message.error(workflowErrorMessage(error, 'Articles could not be loaded')))
      .finally(() => setLoading(false));
  }, [page, search, status, categoryId, message]);

  useEffect(load, [load]);
  useEffect(loadCategories, [loadCategories]);

  const change = async (action: () => Promise<unknown>, done: string, failure: string) => {
    try {
      await action();
      message.success(done);
      load();
    } catch (error) {
      message.error(workflowErrorMessage(error, failure));
    }
  };

  const setArticleStatus = (id: number, next: 'PUBLISHED' | 'HIDDEN', done: string) =>
    change(() => articleService.review(id, next), done, 'The status could not be changed');

  const columns: ColumnsType<ArticleListItem> = [
    {
      title: 'Article',
      key: 'article',
      render: (_, article) => (
        <div className="flex items-center gap-3">
          {article.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={article.coverImageUrl} alt="" className="h-12 w-20 shrink-0 rounded-md object-cover" />
          ) : (
            <div className="h-12 w-20 shrink-0 rounded-md bg-slate-100" />
          )}
          <div className="min-w-0">
            <p className="line-clamp-2 font-semibold text-slate-900">{article.title}</p>
            <p className="text-xs text-slate-500">{article.authorName ?? 'Unknown author'}</p>
          </div>
        </div>
      ),
    },
    { title: 'Category', key: 'category', width: 140, render: (_, article) => article.category?.name ?? '—' },
    { title: 'Status', key: 'status', width: 160, render: (_, article) => <ArticleStatusTag status={article.status} /> },
    { title: 'Views', dataIndex: 'viewCount', width: 80 },
    { title: 'Updated', key: 'updated', width: 110, render: (_, article) => formatDate(article.updatedAt) },
    {
      title: 'Actions',
      key: 'actions',
      width: 120,
      render: (_, article) => {
        const canEdit = isEditor || article.status === 'DRAFT' || article.status === 'PENDING';
        const canDelete = isEditor || article.status === 'DRAFT';
        const items: MenuProps['items'] = [
          ...(canEdit
            ? [{ key: 'edit', label: isEditor && article.status === 'PENDING' ? 'Review' : 'Edit', onClick: () => router.push(`/admin/articles/${article.id}/edit`) }]
            : []),
          ...(article.status === 'PUBLISHED'
            ? [{ key: 'view', label: 'View on site', onClick: () => window.open(`/blog/${article.slug}`, '_blank') }]
            : []),
          ...(isEditor && article.status !== 'PUBLISHED' && article.status !== 'DRAFT'
            ? [{
                key: 'publish',
                label: article.status === 'HIDDEN' ? 'Show' : 'Approve',
                onClick: () => setArticleStatus(article.id, 'PUBLISHED', 'The article is now published'),
              }]
            : []),
          ...(isEditor && article.status === 'PUBLISHED'
            ? [{ key: 'hide', label: 'Hide', onClick: () => setArticleStatus(article.id, 'HIDDEN', 'The article is now hidden') }]
            : []),
          ...(canDelete
            ? [{
                key: 'delete',
                label: 'Delete',
                danger: true,
                onClick: () =>
                  modal.confirm({
                    title: 'Delete this article?',
                    content: 'Its comments will be deleted too. This cannot be undone.',
                    okText: 'Delete',
                    okButtonProps: { danger: true },
                    onOk: () => change(() => articleService.remove(article.id), 'Article deleted', 'The article could not be deleted'),
                  }),
              }]
            : []),
        ];
        return (
          <Dropdown menu={{ items }} trigger={['click']}>
            <Button size="small" className="!inline-flex !items-center gap-1">
              Actions
            </Button>
          </Dropdown>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Articles</h1>
          <p className="text-sm text-slate-500">
            {isEditor ? 'Write, review and publish health articles.' : 'Write articles and submit them for approval.'}
          </p>
        </div>
        <div className="flex gap-2">
          {isEditor && (
            <Button icon={<Tags size={16} />} onClick={() => setCategoriesOpen(true)} className="!flex !items-center">
              Categories
            </Button>
          )}
          <Link href="/admin/articles/new">
            <Button type="primary" icon={<Plus size={16} />} className="!flex !items-center">
              New article
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input.Search
          allowClear
          className="w-full sm:w-72"
          placeholder="Search by title"
          onSearch={(value) => {
            setSearch(value.trim());
            setPage(1);
          }}
        />
        <Select
          allowClear
          className="w-48"
          placeholder="All statuses"
          value={status}
          onChange={(value?: ArticleStatus) => {
            setStatus(value);
            setPage(1);
          }}
          options={[
            { value: 'DRAFT', label: 'Draft' },
            { value: 'PENDING', label: 'Awaiting approval' },
            { value: 'PUBLISHED', label: 'Published' },
            { value: 'HIDDEN', label: 'Hidden' },
          ]}
        />
        <Select
          allowClear
          className="w-48"
          placeholder="All categories"
          value={categoryId}
          onChange={(value?: number) => {
            setCategoryId(value);
            setPage(1);
          }}
          options={categories.map((category) => ({ value: category.id, label: category.name }))}
        />
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={items}
        loading={loading}
        scroll={{ x: 900 }}
        pagination={{ current: pagination.page, pageSize: PAGE_SIZE, total: pagination.total, showSizeChanger: false, onChange: setPage }}
      />

      <CategoryManager open={categoriesOpen} onClose={() => setCategoriesOpen(false)} onChanged={loadCategories} />
    </div>
  );
}
