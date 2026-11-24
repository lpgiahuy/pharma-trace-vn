'use client';

import { useCallback, useEffect, useState } from 'react';
import { App, Button, Input, Modal, Popconfirm } from 'antd';
import { Pencil, Trash2 } from 'lucide-react';
import { articleService } from '@/services/article.service';
import { workflowErrorMessage } from '@/utils/workflow-error';
import { ArticleCategory } from '@/types/article.types';

interface CategoryManagerProps {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

export function CategoryManager({ open, onClose, onChanged }: CategoryManagerProps) {
  const { message } = App.useApp();
  const [categories, setCategories] = useState<ArticleCategory[]>([]);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);

  const load = useCallback(() => {
    articleService
      .categories()
      .then((res) => setCategories(res.data))
      .catch((error: unknown) => message.error(workflowErrorMessage(error, 'Categories could not be loaded')));
  }, [message]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const run = async (action: () => Promise<unknown>, failure: string) => {
    try {
      await action();
      load();
      onChanged();
    } catch (error) {
      message.error(workflowErrorMessage(error, failure));
    }
  };

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    void run(async () => {
      await articleService.createCategory(name);
      setNewName('');
    }, 'The category could not be added');
  };

  const rename = () => {
    if (!editing?.name.trim()) return;
    void run(async () => {
      await articleService.renameCategory(editing.id, editing.name.trim());
      setEditing(null);
    }, 'The category could not be renamed');
  };

  return (
    <Modal title="Article categories" open={open} onCancel={onClose} footer={null} destroyOnHidden>
      <div className="flex gap-2">
        <Input
          value={newName}
          maxLength={100}
          onChange={(event) => setNewName(event.target.value)}
          onPressEnter={add}
          placeholder="New category name"
        />
        <Button type="primary" onClick={add}>
          Add
        </Button>
      </div>
      <ul className="mt-4 divide-y divide-slate-100">
        {categories.length === 0 && <li className="py-6 text-center text-sm text-slate-400">No categories yet</li>}
        {categories.map((category) => (
          <li key={category.id} className="flex items-center justify-between gap-2 py-2">
            {editing?.id === category.id ? (
              <Input
                autoFocus
                value={editing.name}
                maxLength={100}
                onChange={(event) => setEditing({ id: category.id, name: event.target.value })}
                onPressEnter={rename}
                onBlur={rename}
              />
            ) : (
              <span className="font-medium text-slate-800">{category.name}</span>
            )}
            <div className="flex shrink-0 gap-1">
              <Button type="text" aria-label="Rename" icon={<Pencil size={16} />} onClick={() => setEditing(category)} />
              <Popconfirm
                title="Delete this category?"
                description="Articles in it will become uncategorized."
                okText="Delete"
                okButtonProps={{ danger: true }}
                onConfirm={() => run(() => articleService.deleteCategory(category.id), 'The category could not be deleted')}
              >
                <Button type="text" danger aria-label="Delete" icon={<Trash2 size={16} />} />
              </Popconfirm>
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
