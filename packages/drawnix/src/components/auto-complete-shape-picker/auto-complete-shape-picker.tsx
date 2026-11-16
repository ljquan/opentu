import { Type, Image, Video, Pencil, ArrowRight } from 'lucide-react';
import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import classNames from 'classnames';
import { ATTACHED_ELEMENT_CLASS_NAME } from '@plait/core';
import { BasicShapes, DrawPointerType, FlowchartSymbols } from '@plait/draw';
import { Island } from '../island';
import Stack from '../stack';
import { ToolButton } from '../tool-button';
import {
  RectangleIcon,
  EllipseIcon,
  TriangleIcon,
  DiamondIcon,
  ParallelogramIcon,
  RoundRectangleIcon,
  TerminalIcon,
} from '../icons';
import './auto-complete-shape-picker.scss';

export interface ShapeOption {
  icon: React.ReactNode;
  title: string;
  pointer: DrawPointerType;
}

const SHAPES: ShapeOption[] = [
  { icon: <RectangleIcon />, title: 'Rectangle', pointer: BasicShapes.rectangle },
  { icon: <EllipseIcon />, title: 'Ellipse', pointer: BasicShapes.ellipse },
  { icon: <TriangleIcon />, title: 'Triangle', pointer: BasicShapes.triangle },
  { icon: <TerminalIcon />, title: 'Terminal', pointer: FlowchartSymbols.terminal },
  { icon: <DiamondIcon />, title: 'Diamond', pointer: BasicShapes.diamond },
  { icon: <ParallelogramIcon />, title: 'Parallelogram', pointer: BasicShapes.parallelogram },
  { icon: <RoundRectangleIcon />, title: 'RoundRectangle', pointer: BasicShapes.roundRectangle },
];

export interface AutoCompleteShapePickerProps {
  /** 是否显示 */
  visible: boolean;
  generationOptions?: boolean;
  onSelectGeneration?: (type: 'image' | 'video' | 'text' | 'edit' | 'line') => void;
  /** 位置 */
  position: { x: number; y: number };
  /** 当前源元素的形状（用于高亮默认选项） */
  currentShape?: DrawPointerType;
  /** 选择形状的回调 */
  onSelectShape: (shape: DrawPointerType) => void;
  /** 关闭回调 */
  onClose: () => void;
  /** 容器元素 */
  container?: HTMLElement | null;
}

export const AutoCompleteShapePicker: React.FC<AutoCompleteShapePickerProps> = ({
  visible,
  generationOptions,
  onSelectGeneration,
  position,
  currentShape,
  onSelectShape,
  onClose,
  container,
}) => {
  const pickerRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    // 延迟添加点击监听器，避免立即触发
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);

    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [visible, onClose]);

  const handleShapeSelect = useCallback((shape: DrawPointerType) => {
    // onSelectShape 内部会重置状态（visible=false），无需再调用 onClose
    onSelectShape(shape);
  }, [onSelectShape]);

  if (!visible) return null;

  // 计算位置，确保不超出视口且值有效
  const adjustedPosition = { 
    x: isNaN(position.x) ? 0 : position.x,
    y: isNaN(position.y) ? 0 : position.y,
  };
  const pickerWidth = generationOptions ? 248 : 200;
  const pickerHeight = generationOptions ? 322 : 80;
  
  if (typeof window !== 'undefined') {
    if (adjustedPosition.x + pickerWidth > window.innerWidth) {
      adjustedPosition.x = window.innerWidth - pickerWidth - 10;
    }
    if (adjustedPosition.y + pickerHeight > window.innerHeight) {
      adjustedPosition.y = position.y - pickerHeight - 20;
    }
  }

  adjustedPosition.x = Math.max(10, adjustedPosition.x);
  adjustedPosition.y = Math.max(10, adjustedPosition.y);

  const content = (
    <div
      ref={pickerRef}
      className={classNames('auto-complete-shape-picker', ATTACHED_ELEMENT_CLASS_NAME, { 'auto-complete-shape-picker--generation': generationOptions })}
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
      }}
    >
      <Island padding={1}>
        <Stack.Col gap={1}>
          <Stack.Row gap={1}>
            {generationOptions ? <div className="generation-actions" role="menu" aria-label="引用此图片">
              <div className="generation-actions__heading">引用此图片</div>
              {([
                { type: 'text', title: '文本', description: '看图描述、提取内容与创作', icon: Type },
                { type: 'image', title: '图片', description: '以此图为参考生成图片', icon: Image },
                { type: 'video', title: '视频', description: '用参考图创作视频', icon: Video },
                { type: 'edit', title: '快捷编辑', description: '打开图片编辑器', icon: Pencil },
                { type: 'line', title: '普通连线', description: '仅连接画布，不作为参考', icon: ArrowRight },
              ] as const).map(({ type, title, description, icon: Icon }) => (
                <button key={type} role="menuitem" aria-label={title} className="generation-choice" onPointerDown={event => event.stopPropagation()} onClick={() => onSelectGeneration?.(type)}>
                  <Icon size={17} strokeWidth={1.7} />
                  <span><strong>{title}</strong><small>{description}</small></span>
                </button>
              ))}
            </div> : SHAPES.map((shape, index) => (
              <ToolButton
                key={index}
                className={classNames('shape-button', {
                  'is-current': currentShape === shape.pointer,
                })}
                type="icon"
                size="small"
                visible={true}
                icon={shape.icon}
                tooltip={shape.title}
                aria-label={shape.title}
                onPointerDown={({ event }) => {
                  event.stopPropagation();
                  handleShapeSelect(shape.pointer);
                }}
              />
            ))}
          </Stack.Row>
        </Stack.Col>
      </Island>
    </div>
  );

  // 如果提供了容器，使用 Portal
  if (container) {
    return createPortal(content, container);
  }

  return content;
};

export default AutoCompleteShapePicker;
