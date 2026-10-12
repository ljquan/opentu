/**
 * Card 元素的 React 渲染组件
 *
 * 使用轻量 MarkdownReadonly 进行 Markdown 内容展示（只读模式）
 * Card 在画布上仅作只读展示，编辑通过知识库进行
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, BookOpen, Check, Copy } from 'lucide-react';
import { HoverTip } from '../shared/hover';
import MarkdownReadonly from '../MarkdownReadonly';
import {
  getTitleColor,
  getBodyColor,
  getCardDisplayTitle,
} from '../../constants/card-colors';
import type { PlaitCard } from '../../types/card.types';
import { copyToClipboard } from '../../utils/runtime-helpers';
import { useTextSelection } from '../../hooks/useTextSelection';

const cardBodyElements = new Map<string, HTMLElement>();

export function getCardBodyElement(cardId: string): HTMLElement | null {
  return cardBodyElements.get(cardId) ?? null;
}

/**
 * 临时去掉 flex 约束，测量 body 内容的真实高度。
 * 同步读取，读完立即恢复，不会触发重绘。
 */
export function measureCardBodyContentHeight(cardId: string): number | null {
  const el = cardBodyElements.get(cardId);
  if (!el) return null;
  const prevFlex = el.style.flex;
  const prevMinH = el.style.minHeight;
  el.style.flex = 'none';
  el.style.minHeight = '0';
  const h = el.scrollHeight;
  el.style.flex = prevFlex;
  el.style.minHeight = prevMinH;
  return h;
}

interface CardElementProps {
  element: PlaitCard;
}

/**
 * Card 内容组件 - 渲染标题 + MarkdownReadonly 正文（只读）
 */
export const CardElement: React.FC<CardElementProps> = ({ element }) => {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>(
    'idle'
  );
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useTextSelection(bodyRef);
  useEffect(() => {
    if (copyStatus !== 'copied') return;
    const timer = window.setTimeout(() => setCopyStatus('idle'), 1600);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);
  const copyLabel =
    copyStatus === 'copied'
      ? '已复制'
      : copyStatus === 'failed'
      ? '复制失败，请重试'
      : '复制文本内容';
  const displayTitle = getCardDisplayTitle(element.title);
  const titleColor = getTitleColor(element.fillColor);
  const bodyColor = getBodyColor(element.fillColor);
  const hasKnowledgeBaseLink = !!element.noteId;
  const copyText = element.title?.trim()
    ? `${displayTitle}\n\n${element.body}`
    : element.body;

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = target;
    const atTop = scrollTop === 0 && e.deltaY < 0;
    const atBottom =
      scrollTop + clientHeight >= scrollHeight - 1 && e.deltaY > 0;
    if (!atTop && !atBottom) {
      e.stopPropagation();
    }
  }, []);

  const handleOpenKnowledgeBase = useCallback(
    (e: React.MouseEvent | React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!element.noteId) return;
      window.dispatchEvent(
        new CustomEvent('kb:open', { detail: { noteId: element.noteId } })
      );
    },
    [element.noteId]
  );

  const handleCopy = useCallback(
    async (e: React.MouseEvent | React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await copyToClipboard(copyText);
        setCopyStatus('copied');
      } catch {
        setCopyStatus('failed');
      }
    },
    [copyText]
  );

  const stopPointerPropagation = useCallback(
    (e: React.MouseEvent | React.PointerEvent) => {
      e.stopPropagation();
    },
    []
  );

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 8,
        overflow: 'hidden',
        border: `1px solid ${titleColor}`,
        boxSizing: 'border-box',
        background: bodyColor,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          background: titleColor,
          color: '#fff',
          padding: '9px 14px',
          fontSize: 14,
          fontWeight: 600,
          lineHeight: '1.35',
          flexShrink: 0,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          cursor: 'move',
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {displayTitle}
        </span>
        <HoverTip content={copyLabel} showArrow={false}>
          <button
            type="button"
            aria-label={copyLabel}
            onMouseDown={stopPointerPropagation}
            onPointerDown={stopPointerPropagation}
            onClick={handleCopy}
            style={{
              width: 24,
              height: 24,
              padding: 0,
              border: 'none',
              borderRadius: 6,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.16)',
              color: '#fff',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {copyStatus === 'copied' ? (
              <Check size={14} aria-hidden="true" />
            ) : copyStatus === 'failed' ? (
              <AlertCircle size={14} aria-hidden="true" />
            ) : (
              <Copy size={14} aria-hidden="true" />
            )}
          </button>
        </HoverTip>
        {hasKnowledgeBaseLink && (
          <HoverTip content="打开知识库笔记" showArrow={false}>
            <button
              type="button"
              aria-label="打开知识库笔记"
              onMouseDown={stopPointerPropagation}
              onPointerDown={stopPointerPropagation}
              onClick={handleOpenKnowledgeBase}
              style={{
                width: 24,
                height: 24,
                padding: 0,
                border: 'none',
                borderRadius: 6,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255,255,255,0.16)',
                color: '#fff',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <BookOpen size={14} />
            </button>
          </HoverTip>
        )}
      </div>
      <div
        tabIndex={0}
        ref={(el) => {
          bodyRef.current = el;
          if (el) cardBodyElements.set(element.id, el);
          else cardBodyElements.delete(element.id);
        }}
        style={{
          pointerEvents: 'auto',
          flex: 1,
          minHeight: 0,
          background: 'rgba(255, 255, 255, 0.68)',
          userSelect: 'text',
          overflowY: 'auto',
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={handleWheel}
      >
        <MarkdownReadonly
          markdown={element.body}
          className="card-markdown-viewer"
        />
      </div>
    </div>
  );
};
