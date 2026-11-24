'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { App, Button, Input, Pagination, Popconfirm } from 'antd';
import { Edit3, Trash2, User } from 'lucide-react';
import { articleService } from '@/services/article.service';
import { useAuth } from '@/store/useAuthStore';
import { workflowErrorMessage } from '@/utils/workflow-error';
import { formatDateTime } from '@/utils';
import { ArticleCommentThread, Pagination as PageInfo } from '@/types/article.types';
import { StaffReply } from '@/components/shared/StaffReply';

const PAGE_SIZE = 10;

export function ArticleComments({ slug }: { slug: string }) {
  const { message } = App.useApp();
  const { user, isAuthenticated } = useAuth();
  const [threads, setThreads] = useState<ArticleCommentThread[]>([]);
  const [pagination, setPagination] = useState<PageInfo>({ page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);

  const load = useCallback(() => {
    articleService
      .comments(slug, { page, limit: PAGE_SIZE })
      .then((res) => {
        setThreads(res.data);
        setPagination(res.pagination);
      })
      .catch(() => undefined);
  }, [slug, page]);

  useEffect(load, [load]);

  const post = async () => {
    if (!text.trim()) return;
    setPosting(true);
    try {
      await articleService.addComment(slug, text.trim());
      setText('');
      if (page === 1) load();
      else setPage(1);
    } catch (error) {
      message.error(workflowErrorMessage(error, 'Your comment could not be posted'));
    } finally {
      setPosting(false);
    }
  };

  const saveEdit = async () => {
    if (!editing?.text.trim()) return;
    try {
      await articleService.editComment(editing.id, editing.text.trim());
      setEditing(null);
      load();
    } catch (error) {
      message.error(workflowErrorMessage(error, 'Your comment could not be saved'));
    }
  };

  const remove = async (id: number) => {
    try {
      await articleService.deleteComment(id);
      load();
    } catch (error) {
      message.error(workflowErrorMessage(error, 'Your comment could not be deleted'));
    }
  };

  return (
    <section className="mt-12 w-full border-t border-slate-200 pt-8">
      <h2 className="text-xl font-black text-slate-900">Comments ({pagination.total})</h2>

      {isAuthenticated ? (
        <div className="mt-4 space-y-2">
          <Input.TextArea
            rows={3}
            maxLength={2000}
            showCount
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Share your thoughts or ask a question"
          />
          <Button type="primary" loading={posting} disabled={!text.trim()} onClick={post}>
            Post comment
          </Button>
        </div>
      ) : (
        <div className="mt-4 rounded-lg bg-slate-100 p-4 text-slate-700">
          <Link href={`/login?redirect=/blog/${slug}`} className="font-bold text-brand-500 hover:underline">
            Log in
          </Link>{' '}
          to leave a comment.
        </div>
      )}

      <div className="mt-6 divide-y divide-slate-100 space-y-6">
        {threads.map((thread) => {
          const own = isAuthenticated && thread.customerId !== null && thread.customerId === user?.id;
          return (
            <div key={thread.id} className="pt-6 first:pt-0">
              <div className="relative">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-500 text-white flex items-center justify-center shrink-0">
                    <User className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-bold text-slate-900">{thread.authorName || 'Reader'}</span>
                    <div className="text-xs text-slate-400 mt-0.5">{formatDateTime(thread.createdAt)}</div>
                  </div>
                </div>

                <div className="pl-13 mt-2 space-y-2.5">
                  {editing?.id === thread.id ? (
                    <div className="space-y-2">
                      <Input.TextArea
                        rows={3}
                        maxLength={2000}
                        value={editing.text}
                        onChange={(event) => setEditing({ id: thread.id, text: event.target.value })}
                      />
                      <div className="flex gap-2">
                        <Button type="primary" size="small" onClick={saveEdit}>
                          Save
                        </Button>
                        <Button size="small" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-800 m-0 leading-relaxed whitespace-pre-line">{thread.content}</p>
                  )}

                  {own && editing?.id !== thread.id && (
                    <div className="pt-1 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditing({ id: thread.id, text: thread.content })}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-[6px] text-slate-600 hover:text-[#004996] hover:bg-blue-50 border border-slate-200 transition-colors cursor-pointer"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>Edit</span>
                      </button>
                      <Popconfirm
                        title="Delete Comment"
                        description="Are you sure you want to delete this comment?"
                        okText="Yes, Delete"
                        cancelText="Cancel"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => remove(thread.id)}
                      >
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-[6px] text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-100 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Delete</span>
                        </button>
                      </Popconfirm>
                    </div>
                  )}
                </div>

                {thread.replies.map((reply, index) => (
                  <StaffReply key={reply.id} name={reply.authorName} date={reply.createdAt} text={reply.content} connector={index === 0} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <Pagination
        className="mt-6"
        align="center"
        current={pagination.page}
        pageSize={PAGE_SIZE}
        total={pagination.total}
        showSizeChanger={false}
        hideOnSinglePage
        onChange={setPage}
      />
    </section>
  );
}
