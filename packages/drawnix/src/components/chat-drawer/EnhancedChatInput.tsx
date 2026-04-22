/**
 * EnhancedChatInput Component
 *
 * 抽屉内简洁输入框：
 * - 仅保留输入和发送
 * - 固定按 agent 对话语义发送
 * - 抽屉附件草稿独立于外部 AIInputBar
 */

import React, {
  useRef,
  useState,
  useCallback,
  useEffect,
  forwardRef,
  useImperativeHandle,
  useMemo,
} from 'react';
import { SendIcon } from 'tdesign-icons-react';
import type { Message } from '@llamaindex/chat-ui';
import { usePromptHistory } from '../../hooks/usePromptHistory';
import { useI18n } from '../../i18n';
import { MediaLibraryModal } from '../media-library/MediaLibraryModal';
import { ImageUploadIcon, MediaLibraryIcon } from '../icons';
import { SelectedContentPreview } from '../shared/SelectedContentPreview';
import {
  AssetType,
  SelectionMode,
  type Asset,
} from '../../types/asset.types';
import type { SelectedContentItem } from '../../types/chat.types';

interface EnhancedChatInputProps {
  selectedContent: SelectedContentItem[];
  onSendMessage: (message: Message) => void | Promise<void>;
  disabled?: boolean;
  placeholder?: string;
}

export interface EnhancedChatInputRef {
  setContent: (content: string) => void;
  getContent: () => string;
  focus: () => void;
}

export const EnhancedChatInput = forwardRef<
  EnhancedChatInputRef,
  EnhancedChatInputProps
>(
  (
    {
      selectedContent,
      onSendMessage,
      disabled = false,
      placeholder = '输入指令，让 Agent 为你工作...',
    },
    ref
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [input, setInput] = useState('');
    const [uploadedContent, setUploadedContent] = useState<SelectedContentItem[]>(
      []
    );
    const [showMediaLibrary, setShowMediaLibrary] = useState(false);
    const { addHistory: addPromptHistory } = usePromptHistory();
    const { language } = useI18n();

    const allContent = useMemo(
      () => [...uploadedContent, ...selectedContent],
      [uploadedContent, selectedContent]
    );
    const hasSelection = allContent.length > 0;

    useImperativeHandle(
      ref,
      () => ({
        setContent: (content: string) => {
          setInput(content);
          textareaRef.current?.focus();
        },
        getContent: () => input,
        focus: () => textareaRef.current?.focus(),
      }),
      [input]
    );

    useEffect(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(
          textareaRef.current.scrollHeight,
          120
        )}px`;
      }
    }, [input]);

    const fileToSelectedContent = useCallback(
      (file: File): Promise<SelectedContentItem> =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const url = reader.result as string;
            if (file.type.startsWith('image/')) {
              const img = new Image();
              img.onload = () => {
                resolve({
                  type: 'image',
                  url,
                  name: file.name || `插入图片-${Date.now()}`,
                  width: img.naturalWidth || undefined,
                  height: img.naturalHeight || undefined,
                });
              };
              img.onerror = () => {
                resolve({
                  type: 'image',
                  url,
                  name: file.name || `插入图片-${Date.now()}`,
                });
              };
              img.src = url;
              return;
            }

            resolve({
              type: 'video',
              url,
              name: file.name || `插入文件-${Date.now()}`,
            });
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        }),
      []
    );

    const handleUploadClick = useCallback(() => {
      fileInputRef.current?.click();
    }, []);

    const handleFileChange = useCallback(
      async (event: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = Array.from(event.target.files || []);
        if (fileList.length === 0) {
          return;
        }

        const nextContent: SelectedContentItem[] = [];

        for (const file of fileList) {
          if (
            !file.type.startsWith('image/') &&
            !file.type.startsWith('video/')
          ) {
            continue;
          }

          try {
            nextContent.push(await fileToSelectedContent(file));
          } catch (error) {
            console.error('[EnhancedChatInput] Failed to read local file:', error);
          }
        }

        if (nextContent.length > 0) {
          setUploadedContent((prev) => [...prev, ...nextContent]);
        }

        event.target.value = '';
      },
      [fileToSelectedContent]
    );

    const handleMediaLibrarySelect = useCallback(
      (asset: Asset) => {
        setUploadedContent((prev) => [
          ...prev,
          {
            type: 'image',
            url: asset.url,
            name: asset.name || `素材-${Date.now()}`,
          },
        ]);
        setShowMediaLibrary(false);
      },
      []
    );

    const handleRemoveUploadedContent = useCallback((index: number) => {
      setUploadedContent((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    }, []);

    const handleSubmit = useCallback(async () => {
      const trimmedInput = input.trim();
      if (!trimmedInput && allContent.length === 0) return;
      const submittedInput = trimmedInput;
      const submittedUploadedContent = uploadedContent;

      const parts: Message['parts'] = [];

      if (trimmedInput) {
        parts.push({ type: 'text', text: trimmedInput });
      }

      allContent.forEach((item, index) => {
        if (item.type === 'image' || item.type === 'graphics') {
          parts.push({
            type: 'data-file',
            data: {
              filename: `${item.type}-${index + 1}.png`,
              mediaType: 'image/png',
              url: item.url || '',
            },
          } as Message['parts'][number]);
        } else if (item.type === 'video') {
          parts.push({
            type: 'data-file',
            data: {
              filename: `video-${index + 1}.mp4`,
              mediaType: 'video/mp4',
              url: item.url || '',
            },
          } as Message['parts'][number]);
        }
      });

      if (trimmedInput) {
        addPromptHistory(trimmedInput, hasSelection, 'agent');
      }

      setInput('');
      setUploadedContent([]);
      try {
        await Promise.resolve(
          onSendMessage({
            id: `msg_${Date.now()}`,
            role: 'user',
            parts,
          })
        );
      } catch (error) {
        console.error('[EnhancedChatInput] Failed to send message:', error);
        setInput((current) => (current ? current : submittedInput));
        setUploadedContent((current) =>
          current.length > 0 ? current : submittedUploadedContent
        );
      }
    }, [
      addPromptHistory,
      allContent,
      hasSelection,
      input,
      onSendMessage,
      uploadedContent,
    ]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing) {
          return;
        }

        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          void handleSubmit();
        }
      },
      [handleSubmit]
    );

    const isActive = (input.trim() || allContent.length > 0) && !disabled;
    const hasUploadedContent = uploadedContent.length > 0;
    const uploadLabel = language === 'zh' ? '插入文件' : 'Insert file';
    const libraryLabel = language === 'zh' ? '素材库' : 'Library';
    const toolButtonClassName = (isSelected: boolean) =>
      `enhanced-chat-input__tool-button${
        isSelected ? ' enhanced-chat-input__tool-button--selected' : ''
      }`;

    return (
      <div className="enhanced-chat-input">
        <div className="enhanced-chat-input__form">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="enhanced-chat-input__file-input"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />

          {allContent.length > 0 && (
            <div className="enhanced-chat-input__content-preview">
              <SelectedContentPreview
                items={allContent}
                language={language}
                enableHoverPreview={true}
                onRemove={handleRemoveUploadedContent}
                removableStartIndex={uploadedContent.length}
              />
            </div>
          )}

          <div className="enhanced-chat-input__input-wrapper">
            <textarea
              ref={textareaRef}
              className="enhanced-chat-input__textarea"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              rows={3}
            />
          </div>

          <div className="enhanced-chat-input__actions enhanced-chat-input__bottom-bar">
            <div className="enhanced-chat-input__tools enhanced-chat-input__action-group">
              <button
                type="button"
                className={toolButtonClassName(hasUploadedContent)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={handleUploadClick}
                disabled={disabled}
                aria-label={uploadLabel}
                title={uploadLabel}
              >
                <ImageUploadIcon size={16} />
              </button>

              <button
                type="button"
                className={toolButtonClassName(hasUploadedContent)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={() => setShowMediaLibrary(true)}
                disabled={disabled}
                aria-label={libraryLabel}
                title={libraryLabel}
              >
                <MediaLibraryIcon size={16} />
              </button>
            </div>

            <div className="enhanced-chat-input__bottom-spacer" />

            <button
              type="button"
              className={`enhanced-chat-input__send ${
                isActive ? 'enhanced-chat-input__send--active' : ''
              }`}
              onClick={() => void handleSubmit()}
              disabled={!isActive}
              aria-label="发送"
            >
              <SendIcon size={20} />
            </button>
          </div>
        </div>

        {showMediaLibrary && (
          <MediaLibraryModal
            isOpen={showMediaLibrary}
            onClose={() => setShowMediaLibrary(false)}
            mode={SelectionMode.SELECT}
            filterType={AssetType.IMAGE}
            onSelect={handleMediaLibrarySelect}
          />
        )}
      </div>
    );
  }
);

EnhancedChatInput.displayName = 'EnhancedChatInput';

export default EnhancedChatInput;
