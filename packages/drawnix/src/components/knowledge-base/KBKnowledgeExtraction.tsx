/**
 * KBKnowledgeExtraction - 知识提取组件
 *
 * 提供知识提取对话界面，支持多轮对话和结构化提取
 * 复用 Chat Drawer 的视觉风格
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Sparkles,
  Send,
  Bot,
  User,
  Download,
  StopCircle,
  FileText,
  Copy,
  NotebookPen,
} from 'lucide-react';
import {
  extractKnowledgeStream,
  chatWithKnowledgeStream,
} from '../../services/kb-knowledge-extraction/extraction-service';
import {
  getChatSession,
  saveChatSession,
} from '../../services/kb-knowledge-extraction/chat-storage';
import {
  exportKnowledge,
  downloadExport,
} from '../../services/kb-knowledge-extraction/export-service';
import {
  type KnowledgeExtractionResult,
  type ChatMessage,
  type KnowledgeType,
  KNOWLEDGE_TYPE_LABELS,
} from '../../services/kb-knowledge-extraction/types';
import type { GeminiMessage } from '../../utils/gemini-api/types';
import './knowledge-base-extraction.scss';
import { Button, MessagePlugin } from 'tdesign-react';
import { ModelSelector } from '../chat-drawer';
import MarkdownEditor from '../MarkdownEditor';
import { createModelRef, type ModelRef } from '../../utils/settings-manager';

// 默认使用的模型，避免使用 gpt-5.1 导致 500 错误
const DEFAULT_MODEL = 'gemini-2.5-flash';

function formatExtractionResultToMarkdown(
  result: KnowledgeExtractionResult
): string {
  const lines: string[] = [];
  // Skip header and metadata as requested by user ("don't want checkbox" and "don't want # title ...")

  const typeOrder: KnowledgeType[] = [
    'concept',
    'definition',
    'step',
    'summary',
  ];
  for (const type of typeOrder) {
    const grouped = result.knowledgePoints.filter((p) => p.type === type);
    if (grouped.length === 0) continue;

    lines.push(`## ${KNOWLEDGE_TYPE_LABELS[type]}`);
    lines.push('');
    for (const p of grouped) {
      lines.push(`### ${p.title}`);
      lines.push('');
      lines.push(p.content);
      if (p.sourceContext) {
        lines.push('');
        lines.push(`> ${p.sourceContext}`);
      }
      // Tags are optional but useful, keeping them simple
      if (p.tags && p.tags.length > 0) {
        lines.push('');
        lines.push(`**标签**: ${p.tags.map((t) => `\`${t}\``).join(' ')}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n').trim();
}

interface KBKnowledgeExtractionProps {
  noteId: string;
  noteContent: string;
  noteTitle?: string;
  onInsertToNote?: (text: string) => void;
  onSaved?: () => void;
}

export const KBKnowledgeExtraction: React.FC<KBKnowledgeExtractionProps> = ({
  noteId,
  noteContent,
  noteTitle,
  onInsertToNote,
  onSaved,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [selectedModelRef, setSelectedModelRef] = useState<ModelRef | null>(
    () => createModelRef(null, DEFAULT_MODEL)
  );
  const [isLoading, setIsLoading] = useState(false);
  const [abortController, setAbortController] =
    useState<AbortController | null>(null);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 加载聊天记录
  useEffect(() => {
    let active = true;
    const loadHistory = async () => {
      // 切换笔记时先清空消息，避免闪烁
      setMessages([]);

      try {
        const session = await getChatSession(noteId);
        if (active) {
          if (session && session.messages.length > 0) {
            setMessages(session.messages);
          } else {
            // 初始化欢迎语
            setMessages([
              {
                id: 'init',
                role: 'model',
                content:
                  '我已经阅读了这篇笔记。你可以让我提取摘要、关键点，或者直接与我讨论笔记内容。',
                type: 'text',
                timestamp: Date.now(),
              },
            ]);
          }
        }
      } catch (e) {
        console.error('Failed to load chat history', e);
      }
    };

    loadHistory();
    return () => {
      active = false;
    };
  }, [noteId]);

  // 保存聊天记录
  useEffect(() => {
    if (messages.length > 0) {
      saveChatSession(noteId, messages).catch(console.error);
    }
  }, [messages, noteId]);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // 自动调整输入框高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        120
      )}px`;
    }
  }, [input]);

  const stopGeneration = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setIsLoading(false);

      // 添加一个系统消息提示已停止
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'model',
          content: '🚫 已停止生成',
          type: 'text',
          timestamp: Date.now(),
        },
      ]);
    }
  }, [abortController]);

  const handleSendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      type: 'text',
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    // 重置输入框高度
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const controller = new AbortController();
    setAbortController(controller);

    try {
      // 构建历史消息供 API 使用
      const history: GeminiMessage[] = messages.concat(userMsg).map((msg) => ({
        role: msg.role === 'model' ? 'assistant' : 'user',
        content: [{ type: 'text', text: msg.content }],
      }));

      // 如果是第一条用户消息（history[1]），附带笔记上下文
      // 注意：history[0] 是 init message (model)
      // history[1] 是第一条 user message
      if (history.length <= 2) {
        // 替换第一条用户消息的内容，加上上下文
        // 使用更明确的 Prompt 结构
        const contextPrompt = `Context:\n${noteContent}\n\nTask: ${userMsg.content}`;
        // 找到最后一条消息（即当前用户的输入）并修改
        const lastMsgIndex = history.length - 1;
        history[lastMsgIndex].content = [{ type: 'text', text: contextPrompt }];
      } else {
        // 对于多轮对话，为了确保模型始终记得上下文，
        // 我们可以把上下文作为一个 System Message 或者放在最开始的 User Message
        // 这里我们采用将 Context 注入到本次请求的 System Instruction 或者首条消息中
        // 简单起见，我们插入一条 System 消息到开头（如果 API 支持）或者 User 消息
        // 策略：在 history 头部插入一条包含 Context 的 User 消息
        // 但为了避免重复，我们只在第一轮做。
        // 如果是多轮，模型应该有记忆。如果模型遗忘，可以在 prompt 里再次强调。
        // 这里假设模型上下文窗口足够大。
      }

      // 添加一个临时的 AI 消息用于流式显示
      const aiMsgId = (Date.now() + 1).toString();
      setStreamingMsgId(aiMsgId);
      setMessages((prev) => [
        ...prev,
        {
          id: aiMsgId,
          role: 'model',
          content: '正在思考...',
          type: 'text',
          timestamp: Date.now(),
        },
      ]);

      await chatWithKnowledgeStream(history, {
        model: selectedModelRef || selectedModel,
        onProgress: (text) => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === aiMsgId ? { ...msg, content: text } : msg
            )
          );
        },
        signal: controller.signal,
      });
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            role: 'model',
            content: `Error: ${e.message || 'Something went wrong'}`,
            type: 'text',
            timestamp: Date.now(),
          },
        ]);
      }
    } finally {
      setIsLoading(false);
      setAbortController(null);
      setStreamingMsgId(null);
    }
  }, [
    input,
    isLoading,
    messages,
    noteContent,
    selectedModel,
    selectedModelRef,
  ]);

  const handleQuickExtract = useCallback(async () => {
    if (isLoading) return;
    setIsLoading(true);

    // 添加用户指令消息
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: '提取知识点',
      type: 'text',
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);

    const controller = new AbortController();
    setAbortController(controller);

    // 添加 AI 消息占位
    const aiMsgId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      {
        id: aiMsgId,
        role: 'model',
        content: '正在分析笔记内容并提取知识点...',
        type: 'text',
        timestamp: Date.now(),
      },
    ]);

    try {
      const result = await extractKnowledgeStream(noteContent, {
        title: noteTitle,
        model: selectedModelRef || selectedModel,
        signal: controller.signal,
      });

      // 替换占位消息为结果消息
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === aiMsgId
            ? {
                ...msg,
                content: '知识点提取完成：',
                type: 'extraction-result',
                data: result,
              }
            : msg
        )
      );
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === aiMsgId
              ? { ...msg, content: `提取失败: ${e.message}` }
              : msg
          )
        );
      }
    } finally {
      setIsLoading(false);
      setAbortController(null);
    }
  }, [isLoading, noteContent, noteTitle, selectedModel, selectedModelRef]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleCopy = useCallback((text: string) => {
    if (!text) {
      MessagePlugin.warning('没有可复制的内容');
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => {
        MessagePlugin.success('复制成功');
      })
      .catch(() => {
        MessagePlugin.error('复制失败');
      });
  }, []);

  const getMessageText = useCallback((msg: ChatMessage) => {
    if (msg.type === 'text') {
      return msg.content;
    }
    if (msg.type === 'extraction-result' && msg.data) {
      return formatExtractionResultToMarkdown(msg.data);
    }
    return '';
  }, []);

  const handleDownload = useCallback((msg: ChatMessage) => {
    if (msg.type === 'extraction-result' && msg.data) {
      try {
        const exportResult = exportKnowledge(msg.data, {
          format: 'markdown',
          includeSource: true,
          includeTags: true,
        });
        downloadExport(
          exportResult.content,
          exportResult.filename,
          exportResult.mimeType
        );
      } catch (e) {
        console.error('Failed to export', e);
        MessagePlugin.error('导出失败');
      }
    }
  }, []);

  return (
    <div className="kb-extraction-chat">
      <div className="kb-extraction-chat__header">
        <div className="kb-extraction-chat__title">
          <Sparkles size={18} />
          <span>知识提取 & 对话</span>
        </div>
      </div>

      <div className="kb-extraction-chat__messages" ref={scrollRef}>
        {messages.map((msg) => (
          <div key={msg.id} className={`kb-message kb-message--${msg.role}`}>
            <div className="kb-message__avatar">
              {msg.role === 'user' ? <User /> : <Bot />}
            </div>
            <div className="kb-message__body">
              <div className="kb-message__content">
                {msg.role === 'model' ? (
                  <div className="kb-message__content-scroll">
                    {msg.type === 'text' ? (
                      msg.id === streamingMsgId && (msg.content === '正在思考...' || msg.content === '正在分析笔记内容并提取知识点...') ? (
                        <div className="kb-message__thinking" aria-label="思考中">
                          <span className="kb-message__thinking-text">{msg.content.replace(/\.+$/, '')}</span>
                          <span className="kb-message__thinking-dots">
                            <span>.</span><span>.</span><span>.</span>
                          </span>
                        </div>
                      ) : msg.content ? (
                        <div className="kb-message__markdown-wrap">
                          <MarkdownEditor
                            markdown={msg.content}
                            readOnly
                            showModeSwitch={false}
                            initialMode="wysiwyg"
                            className="kb-extraction-markdown"
                          />
                        </div>
                      ) : null
                    ) : (
                      <ExtractionResultView result={msg.data!} />
                    )}
                  </div>
                ) : (
                  msg.type === 'text' ? (
                    <div className="kb-message__text">{msg.content}</div>
                  ) : (
                    <ExtractionResultView result={msg.data!} />
                  )
                )}
              </div>
              {msg.role === 'model' && (
                <div className="kb-message__actions">
                  <button
                    className="kb-message__action-btn"
                    onClick={() => handleCopy(getMessageText(msg))}
                    title="复制"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    className="kb-message__action-btn"
                    onClick={() => {
                      const text = getMessageText(msg);
                      if (text) onInsertToNote?.(text);
                    }}
                    title="插入到笔记"
                  >
                    <NotebookPen size={14} />
                  </button>
                  {msg.type === 'extraction-result' && (
                    <button
                      className="kb-message__action-btn"
                      onClick={() => handleDownload(msg)}
                      title="导出 Markdown"
                    >
                      <Download size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="kb-extraction-chat__input-area">
        <div className="kb-extraction-chat__input-wrapper">
          <textarea
            ref={textareaRef}
            className="kb-extraction-chat__textarea"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题，与 AI 讨论笔记内容..."
            disabled={isLoading}
            rows={1}
          />
        </div>
        <div className="kb-extraction-chat__input-actions">
          <div className="kb-extraction-chat__model-selector">
            <ModelSelector
              value={selectedModel}
              valueRef={selectedModelRef}
              onChange={(modelId, modelRef) => {
                setSelectedModel(modelId);
                setSelectedModelRef(modelRef || createModelRef(null, modelId));
              }}
              variant="capsule"
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              className="kb-extraction-chat__icon-btn"
              onClick={handleQuickExtract}
              title="一键提取知识点"
              disabled={isLoading}
            >
              <Sparkles size={16} />
            </button>

            <button
              className={`kb-extraction-chat__send-btn ${
                input.trim() || isLoading
                  ? 'kb-extraction-chat__send-btn--active'
                  : ''
              }`}
              onClick={isLoading ? stopGeneration : handleSendMessage}
              disabled={!input.trim() && !isLoading}
              title={isLoading ? '停止生成' : '发送'}
            >
              {isLoading ? <StopCircle size={18} /> : <Send size={18} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ExtractionResultView: React.FC<{
  result: KnowledgeExtractionResult;
}> = ({ result }) => {
  const markdown = React.useMemo(
    () => formatExtractionResultToMarkdown(result),
    [result]
  );

  return (
    <div className="kb-extraction-result-view">
      <MarkdownEditor
        markdown={markdown}
        readOnly
        showModeSwitch={false}
        initialMode="wysiwyg"
        className="kb-extraction-markdown"
      />
    </div>
  );
};
