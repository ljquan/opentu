/**
 * EnhancedChatInput Component
 *
 * 增强版聊天输入框，支持：
 * - 选中元素展示
 * - 多行文本输入
 */

import React, {
  useRef,
  useState,
  useCallback,
  useEffect,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { Send } from 'lucide-react';
import { MessagePlugin } from 'tdesign-react';
import { SelectedContentPreview } from '../shared/SelectedContentPreview';
import type { SelectedContentItem } from '../../contexts/ChatDrawerContext';
import { useChatDrawerControl } from '../../contexts/ChatDrawerContext';
import type { Message } from '../../types/chat-ui.types';
import { usePromptHistory } from '../../hooks/usePromptHistory';
import { useI18n } from '../../i18n';
import { useAssets } from '../../contexts/AssetContext';
import {
  AssetSource,
  AssetType,
  SelectionMode,
  type Asset,
} from '../../types/asset.types';
import { GenerationTypeDropdown } from '../ai-input-bar/GenerationTypeDropdown';
import { ModelDropdown } from '../ai-input-bar/ModelDropdown';
import { ParametersDropdown } from '../ai-input-bar/ParametersDropdown';
import { CountDropdown } from '../ai-input-bar/CountDropdown';
import { AIInputComposerShell } from '../ai-input-bar/AIInputComposerShell';
import { MediaLibraryModal } from '../media-library/MediaLibraryModal';
import { ImageUploadIcon, MediaLibraryIcon } from '../icons';
import { HoverTip } from '../shared';
import { useChatDrawerGenerationControls } from './useChatDrawerGenerationControls';
import { shouldUseImplicitWorkflowReferences } from './workflow-media-results';
import '../ai-input-bar/ai-input-bar.scss';

interface EnhancedChatInputProps {
  selectedContent: SelectedContentItem[];
  implicitReferenceContent?: SelectedContentItem[];
  implicitReferenceLabel?: string;
  implicitReferencePinned?: boolean;
  onClearImplicitReference?: () => void;
  onImplicitReferenceConsumed?: () => void;
  onSend: (message: Message) => void | Promise<void>;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * EnhancedChatInput Ref 接口
 */
export interface EnhancedChatInputRef {
  /** 设置输入框内容 */
  setContent: (content: string) => void;
  /** 获取输入框内容 */
  getContent: () => string;
  /** 聚焦输入框 */
  focus: () => void;
}

export const EnhancedChatInput = forwardRef<
  EnhancedChatInputRef,
  EnhancedChatInputProps
>(
  (
    {
      selectedContent,
      implicitReferenceContent = [],
      implicitReferenceLabel,
      implicitReferencePinned = false,
      onClearImplicitReference,
      onImplicitReferenceConsumed,
      onSend,
      disabled = false,
      placeholder = '输入消息...',
    },
    ref
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [input, setInput] = useState('');
    const [uploadedContent, setUploadedContent] = useState<
      SelectedContentItem[]
    >([]);
    const [showMediaLibrary, setShowMediaLibrary] = useState(false);
    const allContent = useMemo(
      () => [...uploadedContent, ...selectedContent],
      [selectedContent, uploadedContent]
    );
    const hasExplicitContent = allContent.length > 0;
    const hasSelection = allContent.length > 0;
    const { addHistory: addPromptHistory } = usePromptHistory();
    const { language } = useI18n();
    const { addAsset } = useAssets();
    const chatDrawerControl = useChatDrawerControl();
    const generationControls = useChatDrawerGenerationControls();

    const appendUploadedContent = useCallback(
      (items: SelectedContentItem[]) => {
        if (items.length === 0) return;
        setUploadedContent((prev) => [...prev, ...items]);
      },
      []
    );

    const fileToBase64WithDimensions = useCallback(
      (file: Blob): Promise<{ url: string; width: number; height: number }> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const base64Url = reader.result as string;
            const img = new Image();
            img.onload = () => {
              resolve({
                url: base64Url,
                width: img.naturalWidth,
                height: img.naturalHeight,
              });
            };
            img.onerror = () =>
              resolve({ url: base64Url, width: 0, height: 0 });
            img.src = base64Url;
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      },
      []
    );

    const importLocalImages = useCallback(
      async (files: File[] | FileList) => {
        const fileList = Array.from(files);
        if (fileList.length === 0) return;

        const newContent: SelectedContentItem[] = [];

        for (const [index, file] of fileList.entries()) {
          if (!file.type.startsWith('image/')) {
            MessagePlugin.error('请选择图片文件');
            continue;
          }

          if (file.size > 25 * 1024 * 1024) {
            MessagePlugin.error('图片不能超过 25MB');
            continue;
          }

          try {
            addAsset(file, AssetType.IMAGE, AssetSource.LOCAL, file.name).catch(
              (error) => {
                console.warn(
                  '[EnhancedChatInput] Failed to add asset to library:',
                  error
                );
              }
            );

            const { url, width, height } = await fileToBase64WithDimensions(
              file
            );
            newContent.push({
              type: 'image',
              url,
              name: file.name || `上传图片 ${index + 1}`,
              width: width || undefined,
              height: height || undefined,
            });
          } catch (error) {
            console.error('[EnhancedChatInput] Failed to import image:', error);
            MessagePlugin.error('图片读取失败');
          }
        }

        appendUploadedContent(newContent);
      },
      [addAsset, appendUploadedContent, fileToBase64WithDimensions]
    );

    const handleFileChange = useCallback(
      async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        await importLocalImages(files);
        e.target.value = '';
      },
      [importLocalImages]
    );

    const handleUploadClick = useCallback(() => {
      fileInputRef.current?.click();
    }, []);

    const handleMediaLibrarySelect = useCallback(
      (asset: Asset) => {
        const selectedAssetContent: SelectedContentItem = {
          type: 'image',
          url: asset.url,
          name: asset.name || `素材-${Date.now()}`,
        };

        appendUploadedContent([selectedAssetContent]);
        setShowMediaLibrary(false);
      },
      [appendUploadedContent]
    );

    const handleMediaLibrarySelectMultiple = useCallback(
      async (assets: Asset[]) => {
        if (assets.length === 0) return;

        try {
          const newContents = assets.map((asset) => ({
            type: 'image' as const,
            url: asset.url,
            name: asset.name || `素材-${Date.now()}`,
          }));
          appendUploadedContent(newContents);
          setShowMediaLibrary(false);
        } catch (error) {
          console.error('Failed to batch select assets from library:', error);
          setShowMediaLibrary(false);
        }
      },
      [appendUploadedContent]
    );

    const handleRemoveUploadedContent = useCallback((index: number) => {
      setUploadedContent((prev) => prev.filter((_, i) => i !== index));
    }, []);

    // 暴露方法给父组件
    useImperativeHandle(
      ref,
      () => ({
        setContent: (content: string) => {
          setInput(content);
          // 聚焦输入框
          textareaRef.current?.focus();
        },
        getContent: () => input,
        focus: () => textareaRef.current?.focus(),
      }),
      [input]
    );

    // 发送消息
    const submitGeneration = useCallback(
      async (trimmedInput: string) => {
        const shouldUseImplicitReferences =
          allContent.length === 0 &&
          implicitReferenceContent.length > 0 &&
          generationControls.generationType !== 'agent' &&
          (implicitReferencePinned ||
            shouldUseImplicitWorkflowReferences(trimmedInput));
        const generationContent = shouldUseImplicitReferences
          ? implicitReferenceContent
          : allContent;
        const submitted = await chatDrawerControl.submitGenerationFromDrawer({
          prompt: trimmedInput,
          selectedContent: generationContent,
          generationType: generationControls.generationType,
          selectedModel: generationControls.selectedModel,
          selectedModelRef: generationControls.selectedModelRef,
          selectedParams: generationControls.selectedParams,
          selectedCount: generationControls.selectedCount,
        });

        if (!submitted) {
          MessagePlugin.error('生成入口未准备好，请稍后重试');
          return;
        }

        setInput('');
        setUploadedContent([]);
        if (shouldUseImplicitReferences) {
          onImplicitReferenceConsumed?.();
        }
      },
      [
        chatDrawerControl,
        generationControls.generationType,
        generationControls.selectedCount,
        generationControls.selectedModel,
        generationControls.selectedModelRef,
        generationControls.selectedParams,
        allContent,
        implicitReferenceContent,
        implicitReferencePinned,
        onImplicitReferenceConsumed,
      ]
    );

    const handleSend = useCallback(() => {
      const trimmedInput = input.trim();
      if (!trimmedInput && allContent.length === 0) return;

      if (generationControls.generationType !== 'agent') {
        void submitGeneration(trimmedInput).catch((error) => {
          console.error('[EnhancedChatInput] generation submit failed:', error);
          MessagePlugin.error('生成提交失败');
        });
        return;
      }

      // 构建消息
      const parts: Message['parts'] = [];

      // 添加文本
      if (trimmedInput) {
        parts.push({ type: 'text', text: trimmedInput });
      }

      // 添加选中的图片/视频
      allContent.forEach((item, index) => {
        if (item.type === 'image' || item.type === 'graphics') {
          parts.push({
            type: 'data-file',
            data: {
              filename: `${item.type}-${index + 1}.png`,
              mediaType: 'image/png',
              url: item.url || '',
            },
          });
        } else if (item.type === 'video') {
          parts.push({
            type: 'data-file',
            data: {
              filename: `video-${index + 1}.mp4`,
              mediaType: 'video/mp4',
              url: item.url || '',
            },
          });
        }
      });

      const message: Message = {
        id: `msg_${Date.now()}`,
        role: 'user',
        parts,
      };

      // 保存提示词到历史记录（Chat Drawer 默认为 Agent 模式）
      if (trimmedInput) {
        addPromptHistory(trimmedInput, hasSelection, 'agent');
      }

      void Promise.resolve(onSend(message)).catch((error) => {
        console.error('[EnhancedChatInput] send failed:', error);
      });
      setInput('');
      setUploadedContent([]);
      if (
        allContent.length === 0 &&
        implicitReferenceContent.length > 0 &&
        (implicitReferencePinned ||
          shouldUseImplicitWorkflowReferences(trimmedInput))
      ) {
        onImplicitReferenceConsumed?.();
      }
    }, [
      input,
      allContent,
      generationControls.generationType,
      submitGeneration,
      onSend,
      addPromptHistory,
      hasSelection,
      implicitReferenceContent,
      implicitReferencePinned,
      onImplicitReferenceConsumed,
    ]);

    // 键盘事件处理
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // 检测 IME 组合输入状态（如中文拼音输入法）
        if (e.nativeEvent.isComposing) {
          return;
        }

        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      },
      [handleSend]
    );

    // 自动调整高度
    useEffect(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(
          textareaRef.current.scrollHeight,
          120
        )}px`;
      }
    }, [input]);

    // 渲染选中内容预览
    const renderSelectedContent = () => {
      if (allContent.length === 0) return null;

      return (
        <div className="enhanced-chat-input__selection">
          <SelectedContentPreview
            items={allContent}
            language="zh"
            enableHoverPreview={true}
            onRemove={handleRemoveUploadedContent}
            removableStartIndex={uploadedContent.length}
          />
        </div>
      );
    };

    const renderImplicitReferenceContent = () => {
      const shouldShowImplicitReferences =
        !hasExplicitContent &&
        implicitReferenceContent.length > 0 &&
        (implicitReferencePinned ||
          shouldUseImplicitWorkflowReferences(input));

      if (!shouldShowImplicitReferences) {
        return null;
      }

      return (
        <div className="enhanced-chat-input__selection enhanced-chat-input__selection--implicit">
          <div className="enhanced-chat-input__implicit-reference-header">
            <span className="enhanced-chat-input__implicit-reference-label">
              {implicitReferenceLabel ||
                (language === 'zh'
                  ? '输入修改描述后，将以上一次生成结果作为参考'
                  : 'Using the previous generated results as references')}
            </span>
            {onClearImplicitReference && (
              <button
                type="button"
                className="enhanced-chat-input__implicit-reference-clear"
                onClick={onClearImplicitReference}
                aria-label={language === 'zh' ? '取消回复' : 'Cancel reply'}
              >
                ×
              </button>
            )}
          </div>
          <SelectedContentPreview
            items={implicitReferenceContent}
            language="zh"
            enableHoverPreview={true}
          />
        </div>
      );
    };

    const renderComposerPreview = () => {
      const selectedPreview = renderSelectedContent();
      const implicitPreview = renderImplicitReferenceContent();

      if (!selectedPreview && !implicitPreview) {
        return null;
      }

      return (
        <>
          {selectedPreview}
          {implicitPreview}
        </>
      );
    };

    const composerPreview = renderComposerPreview();
    const isActive = (input.trim() || allContent.length > 0) && !disabled;
    const isGenerationMode = generationControls.generationType !== 'agent';

    return (
      <div className="enhanced-chat-input" ref={containerRef}>
        <div className="enhanced-chat-input__composer-scope ai-input-bar">
          <AIInputComposerShell
            variant="drawer"
            expanded={Boolean(input.trim()) || Boolean(composerPreview)}
            disabled={disabled}
            preview={composerPreview}
            textarea={
              <textarea
                ref={textareaRef}
                className="enhanced-chat-input__textarea"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={hasSelection ? '描述你想要的效果...' : placeholder}
                disabled={disabled}
                rows={4}
              />
            }
            leftTools={
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />

                <HoverTip
                  content={language === 'zh' ? '上传图片' : 'Upload images'}
                  placement="top"
                >
                  <button
                    className="ai-input-bar__upload-btn"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={handleUploadClick}
                    aria-label={
                      language === 'zh' ? '上传图片' : 'Upload images'
                    }
                    type="button"
                  >
                    <ImageUploadIcon size={18} />
                  </button>
                </HoverTip>

                <HoverTip
                  content={
                    language === 'zh' ? '从素材库选择' : 'Select from library'
                  }
                  placement="top"
                >
                  <button
                    className="ai-input-bar__library-btn"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={() => setShowMediaLibrary(true)}
                    aria-label={
                      language === 'zh' ? '从素材库选择' : 'Select from library'
                    }
                    type="button"
                  >
                    <MediaLibraryIcon size={18} />
                  </button>
                </HoverTip>
              </>
            }
            controls={
              <>
                <GenerationTypeDropdown
                  value={generationControls.generationType}
                  onSelect={generationControls.setGenerationType}
                  disabled={disabled}
                />
                <ModelDropdown
                  selectedModel={generationControls.selectedModel}
                  selectedSelectionKey={generationControls.selectedSelectionKey}
                  onSelect={generationControls.handleModelSelect}
                  onSelectModel={generationControls.handleModelConfigSelect}
                  language={language}
                  models={generationControls.currentModels}
                  placement="up"
                  header={
                    language === 'zh'
                      ? isGenerationMode
                        ? '选择模型 (↑↓ Tab)'
                        : '选择文本模型 (↑↓ Tab)'
                      : isGenerationMode
                      ? 'Select model (↑↓ Tab)'
                      : 'Select text model (↑↓ Tab)'
                  }
                  disabled={disabled}
                />
                {isGenerationMode &&
                  generationControls.compatibleParams.length > 0 && (
                    <ParametersDropdown
                      key={generationControls.selectedModel}
                      selectedParams={generationControls.selectedParams}
                      onParamChange={generationControls.handleParamSelect}
                      compatibleParams={generationControls.compatibleParams}
                      modelId={generationControls.selectedModel}
                      language={language}
                      disabled={disabled}
                      placement="up"
                    />
                  )}
                {isGenerationMode &&
                  generationControls.generationType !== 'text' &&
                  generationControls.generationType !== 'audio' && (
                    <CountDropdown
                      value={generationControls.selectedCount}
                      onSelect={generationControls.setSelectedCount}
                      disabled={disabled}
                    />
                  )}
              </>
            }
            sendButton={
              <button
                className={`ai-input-bar__send-btn ${isActive ? 'active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={handleSend}
                disabled={!isActive}
                aria-label="发送"
                data-testid="drawer-ai-send-btn"
              >
                <Send size={18} />
              </button>
            }
          />
        </div>

        {showMediaLibrary && (
          <MediaLibraryModal
            isOpen={showMediaLibrary}
            onClose={() => setShowMediaLibrary(false)}
            mode={SelectionMode.SELECT}
            filterType={AssetType.IMAGE}
            onSelect={handleMediaLibrarySelect}
            onSelectMultiple={handleMediaLibrarySelectMultiple}
            batchSelectButtonText="批量插入对话框"
          />
        )}
      </div>
    );
  }
);

EnhancedChatInput.displayName = 'EnhancedChatInput';

export default EnhancedChatInput;
