import { forwardRef, useEffect, useImperativeHandle, useRef, useCallback, memo, useState, useContext } from 'react';
import { editorViewCtx } from '@milkdown/kit/core';
import { insert, replaceAll } from '@milkdown/kit/utils';
import { Crepe, CrepeFeature } from '@milkdown/crepe';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/nord.css';
import 'katex/dist/katex.min.css';
import { Eye, Code2, ImagePlus } from 'lucide-react';
import { AssetContext } from '../../contexts/asset-context-instance';
import { AssetType, SelectionMode } from '../../types/asset.types';
import { MediaLibraryModal } from '../media-library';
import { assetEmbedPlugins } from './asset-embed-plugin';
import { markdownImageBlockPlugins } from './image-block-plugin';
import './MarkdownEditor.css';

/** 编辑器模式 */
export type EditorMode = 'wysiwyg' | 'source';

export interface MarkdownEditorProps {
  /** 初始 Markdown 内容 */
  markdown: string;
  /** 源码模式下显示的 Markdown 内容（可选） */
  sourceMarkdown?: string;
  /** 内容变化回调 */
  onChange?: (markdown: string) => void;
  /** 占位符文本 */
  placeholder?: string;
  /** 是否只读 */
  readOnly?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 是否显示模式切换按钮 */
  showModeSwitch?: boolean;
  /** 初始编辑模式 */
  initialMode?: EditorMode;
  /** 是否启用素材引用渲染 */
  enableAssetEmbeds?: boolean;
  /** 是否让内建图片插入入口支持素材库 */
  enableAssetLibraryImagePicker?: boolean;
}

export interface MarkdownEditorRef {
  getMarkdown: () => string;
  setMarkdown: (markdown: string) => void;
  insertMarkdown: (markdown: string) => void;
  focus: () => void;
  getMode: () => EditorMode;
  setMode: (mode: EditorMode) => void;
}

// 图片上传：转 base64
function handleImageUpload(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** 内部编辑器 ref */
interface InternalEditorRef {
  getMarkdown: () => string;
  setMarkdown: (markdown: string) => void;
  insertMarkdown: (markdown: string) => void;
  focus: () => void;
}

interface CrepeEditorCoreProps {
  markdown: string;
  onChange?: (markdown: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  editorRef: React.MutableRefObject<InternalEditorRef | null>;
  enableAssetEmbeds?: boolean;
}

/**
 * 核心编辑器组件 - 使用 useEditor hook（必须在 MilkdownProvider 内部）
 */
function CrepeEditorCore({ markdown, onChange, placeholder, readOnly, editorRef, enableAssetEmbeds }: CrepeEditorCoreProps) {
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const lastMarkdownRef = useRef(markdown);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const crepeRef = useRef<Crepe | null>(null);

  const { get, loading } = useEditor((root) => {
    const crepe = new Crepe({
      root,
      defaultValue: markdown,
      features: {
        [CrepeFeature.CodeMirror]: true,
        [CrepeFeature.ListItem]: true,
        [CrepeFeature.LinkTooltip]: true,
        [CrepeFeature.Cursor]: true,
        [CrepeFeature.ImageBlock]: true,
        [CrepeFeature.BlockEdit]: true,
        [CrepeFeature.Toolbar]: true,
        [CrepeFeature.Placeholder]: true,
        [CrepeFeature.Table]: true,
        [CrepeFeature.Latex]: true,
      },
      featureConfigs: {
        [CrepeFeature.Placeholder]: { text: placeholder || '开始编辑...' },
        [CrepeFeature.Cursor]: { color: '#3b82f6', width: 4 },
        [CrepeFeature.ImageBlock]: {
          onUpload: handleImageUpload,
          inlineOnUpload: handleImageUpload,
          blockOnUpload: handleImageUpload,
        },
        [CrepeFeature.Latex]: { katexOptions: { strict: 'ignore' } },
      },
    });

    crepe.editor.use(markdownImageBlockPlugins);

    // 注册 asset-embed 插件（remark + schema + view）
    if (enableAssetEmbeds) {
      crepe.editor.use(assetEmbedPlugins);
    }

    // 仅在外部需要回传内容时注册监听，避免只读视图走额外序列化链路。
    if (onChangeRef.current) {
      crepe.on((listener) => {
        listener.markdownUpdated((_: unknown, md: string) => {
          if (debounceRef.current) clearTimeout(debounceRef.current);
          if (md !== lastMarkdownRef.current) {
            lastMarkdownRef.current = md;
            debounceRef.current = setTimeout(() => onChangeRef.current?.(md), 50);
          }
        });
      });
    }

    crepeRef.current = crepe;
    return crepe;
  }, []);

  // 编辑器就绪后暴露方法 & 设置只读
  useEffect(() => {
    if (loading) return;
    const crepe = crepeRef.current;
    if (!crepe) return;

    if (readOnly) {
      try { crepe.setReadonly(true); } catch { /* 忽略 */ }
    }

    editorRef.current = {
      getMarkdown: () => lastMarkdownRef.current,
      setMarkdown: (md: string) => {
        try { lastMarkdownRef.current = md; crepe.editor?.action(replaceAll(md)); } catch { /* 忽略 */ }
      },
      insertMarkdown: (md: string) => {
        try { crepe.editor?.action(insert(md)); } catch { /* 忽略 */ }
      },
      focus: () => {
        try { crepe.editor?.ctx.get(editorViewCtx)?.focus(); } catch { /* 忽略 */ }
      },
    };

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      editorRef.current = null;
    };
  }, [get, readOnly, editorRef, loading]);

  // 同步 readOnly
  useEffect(() => {
    if (loading) return;
    const crepe = crepeRef.current;
    if (crepe) { try { crepe.setReadonly(!!readOnly); } catch { /* 忽略 */ } }
  }, [readOnly, loading]);

  // 外部 markdown prop 变化时同步
  useEffect(() => {
    if (loading) return;
    const crepe = crepeRef.current;
    if (!crepe) return;
    try {
      const cur = lastMarkdownRef.current;
      if (markdown !== cur) {
        lastMarkdownRef.current = markdown;
        crepe.editor?.action(replaceAll(markdown));
      }
    } catch { /* 忽略 */ }
  }, [markdown, loading]);

  return <Milkdown />;
}

/**
 * 封装的 Markdown 富文本编辑器组件
 */
export const MarkdownEditor = memo(forwardRef<MarkdownEditorRef, MarkdownEditorProps>(
  function MarkdownEditor(
    {
      markdown,
      sourceMarkdown,
      onChange,
      placeholder = '开始编辑...',
      readOnly = false,
      className = '',
      showModeSwitch = true,
      initialMode = 'wysiwyg',
      enableAssetEmbeds = false,
      enableAssetLibraryImagePicker = false,
    },
    ref
  ) {
    const assetContext = useContext(AssetContext);
    const editorRef = useRef<InternalEditorRef | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const previewHostRef = useRef<HTMLDivElement>(null);
    const activeImageInputRef = useRef<HTMLElement | null>(null);
    const [mode, setMode] = useState<EditorMode>(initialMode);
    const [sourceContent, setSourceContent] = useState(sourceMarkdown || markdown);
    const [isImageAssetLibraryOpen, setIsImageAssetLibraryOpen] = useState(false);
    const [showImageAssetLibraryOverlay, setShowImageAssetLibraryOverlay] = useState(false);
    const [canMountWysiwyg, setCanMountWysiwyg] = useState(initialMode !== 'wysiwyg');
    const sourceContentRef = useRef(sourceMarkdown || markdown);

    const canUseAssetLibraryImagePicker = enableAssetLibraryImagePicker && Boolean(assetContext);

    // 启用素材渲染时，确保资产已加载到 global store
    useEffect(() => {
      if (enableAssetEmbeds && assetContext?.loadAssets) {
        void assetContext.loadAssets();
      }
    }, [enableAssetEmbeds, assetContext]);

    useEffect(() => {
      sourceContentRef.current = sourceContent;
    }, [sourceContent]);

    useEffect(() => {
      if (mode !== 'wysiwyg') {
        setCanMountWysiwyg(false);
        return;
      }

      let rafId = 0;
      let cancelled = false;

      const waitForHost = () => {
        const host = previewHostRef.current;
        if (cancelled) return;

        if (host?.isConnected) {
          setCanMountWysiwyg(true);
          return;
        }

        rafId = requestAnimationFrame(waitForHost);
      };

      waitForHost();

      return () => {
        cancelled = true;
        if (rafId) cancelAnimationFrame(rafId);
      };
    }, [mode]);

    const handleModeChange = useCallback((newMode: EditorMode) => {
      if (newMode === mode) return;
      if (newMode === 'source') {
        setSourceContent(sourceMarkdown || editorRef.current?.getMarkdown() || markdown);
      } else if (!sourceMarkdown) {
        editorRef.current?.setMarkdown(sourceContent);
        onChange?.(sourceContent);
      }
      setMode(newMode);
    }, [mode, markdown, sourceContent, sourceMarkdown, onChange]);

    const handleSourceChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const v = e.target.value;
      setSourceContent(v);
      onChange?.(v);
    }, [onChange]);

    const insertMarkdown = useCallback((snippet: string) => {
      if (!snippet) return;

      const current = mode === 'source'
        ? sourceContentRef.current
        : (sourceMarkdown || editorRef.current?.getMarkdown() || sourceContentRef.current || markdown);

      if (mode === 'source' && textareaRef.current) {
        const textarea = textareaRef.current;
        const start = textarea.selectionStart ?? current.length;
        const end = textarea.selectionEnd ?? current.length;
        const next = `${current.slice(0, start)}${snippet}${current.slice(end)}`;
        setSourceContent(next);
        onChange?.(next);
        requestAnimationFrame(() => {
          textarea.focus();
          const caret = start + snippet.length;
          textarea.setSelectionRange(caret, caret);
        });
        return;
      }

      editorRef.current?.insertMarkdown(snippet);
      requestAnimationFrame(() => {
        const next = editorRef.current?.getMarkdown();
        if (typeof next === 'string') {
          setSourceContent(next);
        }
      });
    }, [markdown, mode, onChange, sourceMarkdown]);

    useImperativeHandle(ref, () => ({
      getMarkdown: () => mode === 'source' ? sourceContent : (editorRef.current?.getMarkdown() || sourceContent),
      setMarkdown: (md: string) => {
        setSourceContent(md);
        editorRef.current?.setMarkdown(md);
      },
      insertMarkdown,
      focus: () => { mode === 'source' ? textareaRef.current?.focus() : editorRef.current?.focus(); },
      getMode: () => mode,
      setMode: handleModeChange,
    }), [handleModeChange, insertMarkdown, mode, sourceContent]);

    // 外部 markdown prop 变化时同步源码内容
    useEffect(() => {
      const src = sourceMarkdown || markdown;
      if (src !== sourceContent) setSourceContent(src);
    }, [markdown, sourceContent, sourceMarkdown]);

    const syncActiveImageHost = useCallback(() => {
      const root = previewHostRef.current;
      if (!root) {
        activeImageInputRef.current = null;
        setShowImageAssetLibraryOverlay(false);
        return;
      }

      const activeElement = root.ownerDocument.activeElement;
      const focusedHost = activeElement instanceof HTMLElement
        ? activeElement.closest('.image-edit')
        : null;
      const nextHost = (focusedHost && root.contains(focusedHost))
        ? focusedHost as HTMLElement
        : root.querySelector<HTMLElement>('.image-edit');

      activeImageInputRef.current = nextHost ?? null;
      setShowImageAssetLibraryOverlay(Boolean(nextHost));
    }, []);

    const commitAssetToImageHost = useCallback((host: HTMLElement | null, assetId: string): boolean => {
      if (!host) {
        return false;
      }

      const container = host.querySelector<HTMLElement>('.link-input-area');
      const target = container?.matches('input, textarea, [contenteditable="true"]')
        ? container
        : container?.querySelector<HTMLElement>('input, textarea, [contenteditable="true"]') ?? container;

      if (!target) {
        return false;
      }

      target.focus();

      const nextValue = `asset://${assetId}`;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.value = nextValue;
      } else {
        target.textContent = nextValue;
      }

      target.dispatchEvent(new Event('input', { bubbles: true }));

      const confirmButton = host.querySelector<HTMLButtonElement>('.confirm');
      if (confirmButton) {
        confirmButton.click();
        return true;
      }

      target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
      return true;
    }, []);

    useEffect(() => {
      if (!canUseAssetLibraryImagePicker || readOnly || mode !== 'wysiwyg' || !previewHostRef.current) {
        activeImageInputRef.current = null;
        setShowImageAssetLibraryOverlay(false);
        return;
      }

      const root = previewHostRef.current;
      let frameId = 0;
      const scheduleSync = () => {
        cancelAnimationFrame(frameId);
        frameId = requestAnimationFrame(syncActiveImageHost);
      };

      const handlePointerSync = (event: Event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }

        const host = target.closest('.image-edit');
        if (host && root.contains(host)) {
          activeImageInputRef.current = host as HTMLElement;
          setShowImageAssetLibraryOverlay(true);
          return;
        }

        scheduleSync();
      };

      scheduleSync();

      root.addEventListener('focusin', handlePointerSync);
      root.addEventListener('click', handlePointerSync, true);
      const observer = new MutationObserver(scheduleSync);
      observer.observe(root, { childList: true, subtree: true });

      return () => {
        cancelAnimationFrame(frameId);
        observer.disconnect();
        root.removeEventListener('focusin', handlePointerSync);
        root.removeEventListener('click', handlePointerSync, true);
      };
    }, [canUseAssetLibraryImagePicker, mode, readOnly, syncActiveImageHost]);

    return (
      <div
        className={`collimind-markdown-editor ${className}`}
        data-readonly={readOnly}
        data-mode={mode}
        data-asset-embeds={enableAssetEmbeds}
      >
        {canUseAssetLibraryImagePicker && showImageAssetLibraryOverlay && (
          <button
            type="button"
            className="collimind-markdown-image-library-overlay"
            style={{ right: showModeSwitch ? 68 : 8 }}
            onClick={() => {
              syncActiveImageHost();
              if (activeImageInputRef.current) {
                setIsImageAssetLibraryOpen(true);
              }
            }}
          >
            <ImagePlus className="collimind-icon-sm" />
            <span>从素材库插图</span>
          </button>
        )}

        {showModeSwitch && (
          <div className="collimind-markdown-editor-mode-switch">
            <button
              type="button"
              className={`collimind-markdown-editor-mode-btn ${mode === 'wysiwyg' ? 'active' : ''}`}
              onClick={() => handleModeChange('wysiwyg')}
              title="所见即所得模式"
            >
              <Eye className="collimind-icon-sm" />
            </button>
            <button
              type="button"
              className={`collimind-markdown-editor-mode-btn ${mode === 'source' ? 'active' : ''}`}
              onClick={() => handleModeChange('source')}
              title="Markdown 源码模式"
            >
              <Code2 className="collimind-icon-sm" />
            </button>
          </div>
        )}

        {/* WYSIWYG 编辑器 */}
        <div
          ref={previewHostRef}
          style={{ display: mode === 'wysiwyg' ? 'contents' : 'none' }}
        >
          {canMountWysiwyg && (
            <MilkdownProvider>
              <CrepeEditorCore
                markdown={markdown}
                onChange={onChange}
                placeholder={placeholder}
                readOnly={readOnly}
                editorRef={editorRef}
                enableAssetEmbeds={enableAssetEmbeds}
              />
            </MilkdownProvider>
          )}
        </div>

        {/* 源码编辑器 */}
        {mode === 'source' && (
          <textarea
            ref={textareaRef}
            className="collimind-markdown-editor-source"
            value={sourceContent}
            onChange={handleSourceChange}
            placeholder={placeholder}
            readOnly={readOnly || !!sourceMarkdown}
            spellCheck={false}
          />
        )}

        {canUseAssetLibraryImagePicker && isImageAssetLibraryOpen && (
          <MediaLibraryModal
            isOpen={isImageAssetLibraryOpen}
            onClose={() => {
              setIsImageAssetLibraryOpen(false);
              syncActiveImageHost();
            }}
            mode={SelectionMode.SELECT}
            filterType={AssetType.IMAGE}
            onSelect={(asset) => {
              const host = activeImageInputRef.current ?? previewHostRef.current?.querySelector<HTMLElement>('.image-edit') ?? null;
              if (!commitAssetToImageHost(host, asset.id)) {
                setIsImageAssetLibraryOpen(false);
                return;
              }
              setIsImageAssetLibraryOpen(false);
              requestAnimationFrame(syncActiveImageHost);
            }}
            selectButtonText="插入素材库图片"
          />
        )}
      </div>
    );
  }
));

export default MarkdownEditor;
