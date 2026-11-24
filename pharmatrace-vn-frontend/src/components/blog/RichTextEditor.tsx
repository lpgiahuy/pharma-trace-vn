'use client';

import { ReactNode, useCallback, useRef, useState } from 'react';
import { App, Button, Input, Modal, Select, Tooltip } from 'antd';
import { Editor, EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import ImageExtension from '@tiptap/extension-image';
import { Bold, ImagePlus, Italic, Link2, List, ListOrdered, Minus, Quote, Redo2, Underline, Undo2 } from 'lucide-react';
import { articleService } from '@/services/article.service';
import { workflowErrorMessage } from '@/utils/workflow-error';
import { cn } from '@/utils';
import { articleBodyClass, articleEditorClass } from './ArticleContent';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif)$/;

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
}

function ToolButton({ label, active, disabled, onClick, children }: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip title={label}>
      <Button
        type="text"
        size="middle"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className={cn('!flex !h-9 !w-9 !items-center !justify-center !p-0', active && '!bg-brand-100 !text-brand-500')}
      >
        {children}
      </Button>
    </Tooltip>
  );
}

function Toolbar({ editor, onPickImage }: { editor: Editor; onPickImage: () => void }) {
  const { message } = App.useApp();
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive('bold') ?? false,
      italic: e?.isActive('italic') ?? false,
      underline: e?.isActive('underline') ?? false,
      bullet: e?.isActive('bulletList') ?? false,
      ordered: e?.isActive('orderedList') ?? false,
      quote: e?.isActive('blockquote') ?? false,
      link: e?.isActive('link') ?? false,
      style: e?.isActive('heading', { level: 2 }) ? 'h2' : e?.isActive('heading', { level: 3 }) ? 'h3' : 'p',
      canUndo: e?.can().undo() ?? false,
      canRedo: e?.can().redo() ?? false,
      hasSelection: e ? !e.state.selection.empty : false,
    }),
  });

  const openLink = () => {
    if (!state.link && !state.hasSelection) {
      message.info('Select the text you want to turn into a link first');
      return;
    }
    setLinkUrl(String(editor.getAttributes('link').href ?? ''));
    setLinkOpen(true);
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    const chain = editor.chain().focus().extendMarkRange('link');
    if (!url) chain.unsetLink().run();
    else chain.setLink({ href: /^(https?:\/\/|mailto:)/i.test(url) ? url : `https://${url}` }).run();
    setLinkOpen(false);
  };

  const setStyle = (style: string) => {
    const chain = editor.chain().focus();
    if (style === 'p') chain.setParagraph().run();
    else chain.setHeading({ level: style === 'h2' ? 2 : 3 }).run();
  };

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 rounded-t-lg border-b border-slate-200 bg-white px-2 py-1.5">
      <ToolButton label="Undo" disabled={!state.canUndo} onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 size={17} />
      </ToolButton>
      <ToolButton label="Redo" disabled={!state.canRedo} onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 size={17} />
      </ToolButton>
      <span className="mx-1 h-6 w-px bg-slate-200" />
      <Select
        value={state.style}
        onChange={setStyle}
        className="w-36"
        options={[
          { value: 'p', label: 'Normal text' },
          { value: 'h2', label: 'Heading' },
          { value: 'h3', label: 'Subheading' },
        ]}
      />
      <span className="mx-1 h-6 w-px bg-slate-200" />
      <ToolButton label="Bold" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold size={17} />
      </ToolButton>
      <ToolButton label="Italic" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic size={17} />
      </ToolButton>
      <ToolButton label="Underline" active={state.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <Underline size={17} />
      </ToolButton>
      <span className="mx-1 h-6 w-px bg-slate-200" />
      <ToolButton label="Bulleted list" active={state.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List size={17} />
      </ToolButton>
      <ToolButton label="Numbered list" active={state.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered size={17} />
      </ToolButton>
      <ToolButton label="Quote" active={state.quote} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote size={17} />
      </ToolButton>
      <ToolButton label="Divider line" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        <Minus size={17} />
      </ToolButton>
      <span className="mx-1 h-6 w-px bg-slate-200" />
      <ToolButton label="Link" active={state.link} onClick={openLink}>
        <Link2 size={17} />
      </ToolButton>
      <Button icon={<ImagePlus size={16} />} onClick={onPickImage} className="!flex !items-center">
        Add image
      </Button>
      <Modal title="Add a link" open={linkOpen} onOk={applyLink} onCancel={() => setLinkOpen(false)} okText="Apply" destroyOnHidden>
        <Input
          autoFocus
          value={linkUrl}
          onChange={(event) => setLinkUrl(event.target.value)}
          onPressEnter={applyLink}
          placeholder="https://example.com"
        />
        <p className="mt-2 text-xs text-slate-500">Leave empty to remove the link.</p>
      </Modal>
    </div>
  );
}

export function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const { message } = App.useApp();
  const editorRef = useRef<Editor | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        if (!IMAGE_TYPES.test(file.type)) {
          message.error(`${file.name}: only JPG, PNG, WebP or GIF images can be added`);
          continue;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          message.error(`${file.name}: the image must be smaller than 10 MB`);
          continue;
        }
        const hide = message.loading('Uploading image...', 0);
        try {
          const { data } = await articleService.uploadImage(file);
          editorRef.current?.chain().focus().setImage({ src: data.imageUrl, alt: file.name.replace(/\.[^.]+$/, '') }).run();
        } catch (error) {
          message.error(workflowErrorMessage(error, 'The image could not be uploaded'));
        } finally {
          hide();
        }
      }
    },
    [message],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false } }), ImageExtension],
    content: value,
    onCreate: ({ editor: created }) => {
      editorRef.current = created;
    },
    onUpdate: ({ editor: updated }) => onChange(updated.getHTML()),
    editorProps: {
      attributes: { class: `${articleBodyClass} ${articleEditorClass}` },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        void upload(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        void upload(files);
        return true;
      },
    },
  });

  return (
    <div className="rounded-lg border border-slate-300 bg-white focus-within:border-brand-500">
      {editor && <Toolbar editor={editor} onPickImage={() => fileInput.current?.click()} />}
      <EditorContent editor={editor} />
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        hidden
        onChange={(event) => {
          void upload(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
    </div>
  );
}
