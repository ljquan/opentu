/**
 * Card 元素的 React 渲染组件
 *
 * 复用 MarkdownEditor 进行 Markdown 内容展示（只读模式）
 * Card 在画布上仅作只读展示，编辑通过知识库进行
 */
import React, { useCallback } from 'react';
import { MarkdownEditor } from '../MarkdownEditor';
import { getTitleColor, getBodyColor } from '../../constants/card-colors';
import type { PlaitCard } from '../../types/card.types';

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
 * Card 内容组件 - 渲染标题 + MarkdownEditor 正文（只读）
 */
export const CardElement: React.FC<CardElementProps> = ({ element }) => {
  const hasTitle = !!(element.title && element.title.trim());
  const titleColor = getTitleColor(element.fillColor);
  const bodyColor = getBodyColor(element.fillColor);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = target;
    const atTop = scrollTop === 0 && e.deltaY < 0;
    const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && e.deltaY > 0;
    if (!atTop && !atBottom) {
      e.stopPropagation();
    }
  }, []);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 8,
        overflow: 'hidden',
        border: `1.5px solid ${titleColor}`,
        boxSizing: 'border-box',
        background: bodyColor,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {hasTitle && (
        <div
          style={{
            background: titleColor,
            color: '#fff',
            padding: '8px 12px',
            fontSize: 14,
            fontWeight: 600,
            lineHeight: '1.4',
            flexShrink: 0,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            cursor: 'move',
            pointerEvents: 'auto',
          }}
        >
          {element.title}
        </div>
      )}
      <div
        ref={(el) => {
          if (el) cardBodyElements.set(element.id, el);
          else cardBodyElements.delete(element.id);
        }}
        style={{
          pointerEvents: 'auto',
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={handleWheel}
      >
        <MarkdownEditor
          markdown={element.body}
          readOnly={true}
          showModeSwitch={false}
          className="card-markdown-viewer"
        />
      </div>
    </div>
  );
};
