'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, App, Button, Input, Modal, Segmented, Select, Spin, Tabs } from 'antd';
import { ArrowLeft, ImagePlus, Trash2 } from 'lucide-react';
import { articleService } from '@/services/article.service';
import { useAuth } from '@/store/useAuthStore';
import { workflowErrorMessage } from '@/utils/workflow-error';
import { hasArticleContent, isArticleEditor } from '@/utils/article-roles';
import { Article, ArticleCategory, ArticleInput, ArticleStatus } from '@/types/article.types';
import { ArticleStatusTag } from './ArticleStatusTag';
import { ArticleView } from './ArticleView';
import { RichTextEditor } from './RichTextEditor';

interface Draft {
  title: string;
  summary: string;
  content: string;
  categoryId?: number;
  coverImageUrl: string;
  coverImagePublicId: string;
}

const EMPTY: Draft = { title: '', summary: '', content: '', coverImageUrl: '', coverImagePublicId: '' };

const toDraft = (article: Article): Draft => ({
  title: article.title,
  summary: article.summary ?? '',
  content: article.content,
  categoryId: article.categoryId ?? undefined,
  coverImageUrl: article.coverImageUrl ?? '',
  coverImagePublicId: article.coverImagePublicId ?? '',
});

export function ArticleForm({ articleId }: { articleId?: number }) {
  const router = useRouter();
  const { message } = App.useApp();
  const { user } = useAuth();
  const isEditor = isArticleEditor(user?.role);

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saved, setSaved] = useState(JSON.stringify(EMPTY));
  const [article, setArticle] = useState<Article | null>(null);
  const [categories, setCategories] = useState<ArticleCategory[]>([]);
  const [ready, setReady] = useState(!articleId);
  const [saving, setSaving] = useState(false);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [sendBackNote, setSendBackNote] = useState('');
  const coverInput = useRef<HTMLInputElement>(null);

  const status: ArticleStatus = article?.status ?? 'DRAFT';
  const canEdit = isEditor || status === 'DRAFT' || status === 'PENDING';
  const dirty = ready && JSON.stringify(draft) !== saved;

  useEffect(() => {
    articleService
      .categories()
      .then((res) => setCategories(res.data))
      .catch(() => undefined);
    if (!articleId) return;
    articleService
      .adminGet(articleId)
      .then((res) => {
        const loaded = toDraft(res.data);
        setArticle(res.data);
        setDraft(loaded);
        setSaved(JSON.stringify(loaded));
        setReady(true);
      })
      .catch((error: unknown) => {
        message.error(workflowErrorMessage(error, 'The article could not be loaded'));
        router.replace('/admin/articles');
      });
  }, [articleId, message, router]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const patch = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }));

  const apply = (next: Article) => {
    const loaded = toDraft(next);
    setArticle(next);
    setDraft(loaded);
    setSaved(JSON.stringify(loaded));
  };

  const save = async (nextStatus: ArticleStatus, doneMessage: string) => {
    if (!draft.title.trim()) {
      message.error('Please enter a title');
      return;
    }
    if (nextStatus !== 'DRAFT' && !hasArticleContent(draft.content)) {
      message.error('Please write some content first');
      return;
    }
    const input: ArticleInput = {
      title: draft.title,
      summary: draft.summary || undefined,
      content: draft.content,
      categoryId: draft.categoryId,
      coverImageUrl: draft.coverImageUrl || undefined,
      coverImagePublicId: draft.coverImagePublicId || undefined,
      status: nextStatus,
    };
    setSaving(true);
    try {
      const { data } = articleId ? await articleService.update(articleId, input) : await articleService.create(input);
      message.success(doneMessage);
      if (articleId) apply(data);
      else {
        setSaved(JSON.stringify(draft));
        router.replace(`/admin/articles/${data.id}/edit`);
      }
    } catch (error) {
      message.error(workflowErrorMessage(error, 'The article could not be saved'));
    } finally {
      setSaving(false);
    }
  };

  const sendBack = async () => {
    if (!articleId) return;
    setSaving(true);
    try {
      const { data } = await articleService.review(articleId, 'DRAFT', sendBackNote);
      apply(data);
      setSendBackOpen(false);
      message.success('The article was sent back to its author');
    } catch (error) {
      message.error(workflowErrorMessage(error, 'The article could not be sent back'));
    } finally {
      setSaving(false);
    }
  };

  const uploadCover = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type) || file.size > 10 * 1024 * 1024) {
      message.error('Choose a JPG, PNG, WebP or GIF image smaller than 10 MB');
      return;
    }
    const hide = message.loading('Uploading cover image...', 0);
    try {
      const { data } = await articleService.uploadImage(file);
      patch({ coverImageUrl: data.imageUrl, coverImagePublicId: data.publicId });
    } catch (error) {
      message.error(workflowErrorMessage(error, 'The image could not be uploaded'));
    } finally {
      hide();
    }
  };

  if (!ready) {
    return (
      <div className="flex justify-center py-24">
        <Spin size="large" />
      </div>
    );
  }

  const keepsStatus = status === 'PUBLISHED' || status === 'HIDDEN';
  const categoryName = categories.find((category) => category.id === draft.categoryId)?.name;

  const actions = !canEdit ? null : isEditor ? (
    keepsStatus ? (
      <Button type="primary" loading={saving} onClick={() => save(status, 'Changes saved')}>
        Save changes
      </Button>
    ) : (
      <>
        {status === 'PENDING' && (
          <Button danger onClick={() => setSendBackOpen(true)}>
            Send back to author
          </Button>
        )}
        <Button loading={saving} onClick={() => save('DRAFT', 'Draft saved')}>
          Save as draft
        </Button>
        <Button type="primary" loading={saving} onClick={() => save('PUBLISHED', 'The article is now published')}>
          Publish
        </Button>
      </>
    )
  ) : (
    <>
      <Button loading={saving} onClick={() => save('DRAFT', 'Draft saved')}>
        Save draft
      </Button>
      <Button type="primary" loading={saving} onClick={() => save('PENDING', 'Submitted for approval')}>
        {status === 'PENDING' ? 'Update submission' : 'Submit for approval'}
      </Button>
    </>
  );

  const editTab = (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700" htmlFor="article-title">
            Title
          </label>
          <Input
            id="article-title"
            size="large"
            maxLength={255}
            value={draft.title}
            disabled={!canEdit}
            onChange={(event) => patch({ title: event.target.value })}
            placeholder="e.g. How to take antibiotics correctly"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700" htmlFor="article-summary">
            Short summary
          </label>
          <Input.TextArea
            id="article-summary"
            rows={2}
            maxLength={500}
            showCount
            value={draft.summary}
            disabled={!canEdit}
            onChange={(event) => patch({ summary: event.target.value })}
            placeholder="One or two sentences shown on the article list"
          />
        </div>
        <div>
          <span className="mb-1 block text-sm font-semibold text-slate-700">Article content</span>
          {canEdit ? (
            <RichTextEditor value={draft.content} onChange={(content) => patch({ content })} />
          ) : (
            <Alert type="info" showIcon message="Published articles can only be edited by an admin." />
          )}
        </div>
      </div>

      <aside className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="mb-2 block text-sm font-semibold text-slate-700">Category</span>
          <Select
            allowClear
            className="w-full"
            placeholder="Choose a category"
            disabled={!canEdit}
            value={draft.categoryId}
            onChange={(categoryId?: number) => patch({ categoryId })}
            options={categories.map((category) => ({ value: category.id, label: category.name }))}
          />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="mb-2 block text-sm font-semibold text-slate-700">Cover image</span>
          {draft.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={draft.coverImageUrl} alt="" className="aspect-video w-full rounded-lg object-cover" />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-400">
              No cover image yet
            </div>
          )}
          {canEdit && (
            <div className="mt-3 flex gap-2">
              <Button icon={<ImagePlus size={16} />} onClick={() => coverInput.current?.click()}>
                {draft.coverImageUrl ? 'Change image' : 'Upload image'}
              </Button>
              {draft.coverImageUrl && (
                <Button danger icon={<Trash2 size={16} />} onClick={() => patch({ coverImageUrl: '', coverImagePublicId: '' })}>
                  Remove
                </Button>
              )}
            </div>
          )}
          <input
            ref={coverInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            hidden
            onChange={(event) => {
              void uploadCover(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
      </aside>
    </div>
  );

  const previewTab = (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">This is how the article will look to readers.</p>
        <Segmented
          value={device}
          onChange={(value) => setDevice(value as 'desktop' | 'mobile')}
          options={[
            { value: 'desktop', label: 'Desktop' },
            { value: 'mobile', label: 'Mobile' },
          ]}
        />
      </div>
      <div className="rounded-xl bg-slate-100 p-4 sm:p-8">
        <div
          className="mx-auto overflow-hidden rounded-xl bg-white px-5 py-8 shadow-sm transition-all sm:px-8"
          style={{ maxWidth: device === 'mobile' ? 390 : 880 }}
        >
          <ArticleView
            title={draft.title}
            summary={draft.summary}
            content={draft.content}
            coverImageUrl={draft.coverImageUrl}
            categoryName={categoryName}
            authorName={article?.authorName ?? String(user?.fullName ?? '')}
            publishedAt={article?.publishedAt}
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 -mx-1 flex flex-col gap-3 border-b border-slate-200 bg-white/95 px-1 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Link href="/admin/articles" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-brand-500">
            <ArrowLeft size={14} /> Back to articles
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-xl font-black text-slate-900">{articleId ? 'Edit article' : 'New article'}</h1>
            <ArticleStatusTag status={status} />
            {dirty && <span className="text-xs font-semibold text-amber-600">Unsaved changes</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      </div>

      {article?.reviewNote && status === 'DRAFT' && (
        <Alert type="warning" showIcon message="Sent back by an admin" description={article.reviewNote} />
      )}

      <Tabs
        items={[
          { key: 'edit', label: 'Write', children: editTab },
          { key: 'preview', label: 'Preview', children: previewTab },
        ]}
      />

      <Modal
        title="Send back to author"
        open={sendBackOpen}
        okText="Send back"
        confirmLoading={saving}
        onOk={sendBack}
        onCancel={() => setSendBackOpen(false)}
      >
        <Input.TextArea
          rows={4}
          maxLength={1000}
          value={sendBackNote}
          onChange={(event) => setSendBackNote(event.target.value)}
          placeholder="Tell the author what to change"
        />
      </Modal>
    </div>
  );
}
