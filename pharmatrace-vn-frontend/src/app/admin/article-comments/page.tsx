'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { App, Button, Input, Pagination, Popconfirm, Tag } from 'antd';
import { articleService } from '@/services/article.service';
import { workflowErrorMessage } from '@/utils/workflow-error';
import { formatDateTime } from '@/utils';
import { Pagination as PageInfo, StaffArticleComment } from '@/types/article.types';

const PAGE_SIZE = 10;

export default function AdminArticleCommentsPage() {
  const { message } = App.useApp();
  const [items, setItems] = useState<StaffArticleComment[]>([]);
  const [pagination, setPagination] = useState<PageInfo>({ page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [reply, setReply] = useState('');

  const load = useCallback(() => {
    articleService
      .adminComments({ page, limit: PAGE_SIZE })
      .then((res) => {
        setItems(res.data);
        setPagination(res.pagination);
      })
      .catch((error: unknown) => message.error(workflowErrorMessage(error, 'Comments could not be loaded')))
      .finally(() => setLoading(false));
  }, [page, message]);

  useEffect(load, [load]);

  const change = async (action: () => Promise<unknown>, done: string, failure: string) => {
    try {
      await action();
      message.success(done);
      load();
    } catch (error) {
      message.error(workflowErrorMessage(error, failure));
    }
  };

  const sendReply = async (id: number) => {
    if (!reply.trim()) return;
    await change(
      async () => {
        await articleService.reply(id, reply.trim());
        setReplyingTo(null);
        setReply('');
      },
      'Reply posted',
      'The reply could not be posted',
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Article comments</h1>
        <p className="text-sm text-slate-500">Reply to readers, or hide comments that break the rules.</p>
      </div>

      <div className="space-y-3">
        {!loading && items.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">No comments yet</div>
        )}
        {items.map((comment) => (
          <div key={comment.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-bold text-slate-900">{comment.authorName}</span>
              {comment.isStaff && <Tag color="blue">Staff reply</Tag>}
              {comment.status === 'HIDDEN' && <Tag color="red">Hidden</Tag>}
              <span className="text-slate-400">{formatDateTime(comment.createdAt)}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              On{' '}
              <Link href={`/blog/${comment.article.slug}`} target="_blank" className="font-semibold text-brand-500 hover:underline">
                {comment.article.title}
              </Link>
            </p>
            <p className="mt-2 whitespace-pre-wrap text-slate-800">{comment.content}</p>

            <div className="mt-3 flex flex-wrap gap-2">
              {!comment.parentId && (
                <Button size="small" type="primary" onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}>
                  Reply
                </Button>
              )}
              <Button
                size="small"
                onClick={() =>
                  change(
                    () => articleService.setCommentStatus(comment.id, comment.status === 'HIDDEN' ? 'VISIBLE' : 'HIDDEN'),
                    comment.status === 'HIDDEN' ? 'Comment is visible again' : 'Comment hidden',
                    'The comment could not be updated',
                  )
                }
              >
                {comment.status === 'HIDDEN' ? 'Show' : 'Hide'}
              </Button>
              <Popconfirm
                title="Delete this comment?"
                okText="Delete"
                okButtonProps={{ danger: true }}
                onConfirm={() => change(() => articleService.adminDeleteComment(comment.id), 'Comment deleted', 'The comment could not be deleted')}
              >
                <Button size="small" danger>
                  Delete
                </Button>
              </Popconfirm>
            </div>

            {replyingTo === comment.id && (
              <div className="mt-3 space-y-2">
                <Input.TextArea rows={3} maxLength={2000} showCount value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Write your reply" />
                <div className="flex gap-2">
                  <Button type="primary" onClick={() => sendReply(comment.id)}>
                    Post reply
                  </Button>
                  <Button onClick={() => setReplyingTo(null)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <Pagination current={pagination.page} pageSize={PAGE_SIZE} total={pagination.total} showSizeChanger={false} onChange={setPage} hideOnSinglePage />
    </div>
  );
}
