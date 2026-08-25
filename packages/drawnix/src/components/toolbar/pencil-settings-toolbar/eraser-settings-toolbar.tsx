/**
 * 橡皮擦设置工具栏
 * 在橡皮擦模式下显示，允许用户修改橡皮擦大小
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useBoard } from '@plait-board/react-board';
import { PlaitBoard } from '@plait/core';
import { Button } from 'tdesign-react';
import { Circle, Square } from 'lucide-react';
import { Island } from '../../island';
import Stack from '../../stack';
import { useDrawnix } from '../../../hooks/use-drawnix';
import {
  BrushShape,
  getFreehandSettings,
  setEraserShape,
  setEraserWidth,
} from '../../../plugins/freehand/freehand-settings';
import { FreehandShape } from '../../../plugins/freehand/type';
import { useI18n } from '../../../i18n';
import { useViewportScale } from '../../../hooks/useViewportScale';
import { updateEraserCursor } from '../../../hooks/usePencilCursor';
import { CursorPreview } from './cursor-preview';
import { SizePicker } from './size-picker';
import './pencil-settings-toolbar.scss';
import { HoverTip } from '../../shared/hover';
import { analytics } from '../../../utils/umami-analytics';

// 预设橡皮擦大小（步长更大，最大256px）
const ERASER_WIDTH_PRESETS = [16, 32, 48, 64, 96, 128, 192, 256];

// 橡皮擦颜色（用于预览）
const ERASER_COLOR = '#f5f5f5';

export const EraserSettingsToolbar: React.FC = () => {
  const board = useBoard();
  const { appState } = useDrawnix();
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);

  // 使用 viewport scale hook 确保工具栏保持在视口内且大小不变
  useViewportScale(containerRef, {
    enablePositionTracking: true,
    enableScaleCompensation: true,
  });

  // 从 board 获取当前设置
  const settings = getFreehandSettings(board);
  const [eraserSize, setEraserSize] = useState(settings.eraserWidth);
  const [currentShape, setCurrentShape] = useState<BrushShape>(
    settings.eraserShape
  );
  // 是否显示光标预览（仅鼠标悬停在工具栏上时）
  const [showCursorPreview, setShowCursorPreview] = useState(false);

  // 检查是否是橡皮擦指针
  const isEraserPointer = appState.pointer === FreehandShape.eraser;

  // 当 board 变化时同步设置
  useEffect(() => {
    const newSettings = getFreehandSettings(board);
    setEraserSize(newSettings.eraserWidth);
    setCurrentShape(newSettings.eraserShape);
  }, [board, appState.pointer, appState.toolSettingsVersion]);

  // 处理橡皮擦大小变化
  const handleSizeChange = useCallback(
    (size: number) => {
      setEraserSize(size);
      setEraserWidth(board, size);
      // 更新光标
      updateEraserCursor(board);
    },
    [board]
  );

  const handleSizeCommit = useCallback(
    (size: number) => {
      analytics.trackUIInteraction({
        area: 'canvas_tool_settings',
        action: 'eraser_size_changed',
        control: 'eraser_size_picker',
        value: size,
        source: 'eraser_settings_toolbar',
      });
    },
    []
  );

  // 处理形状切换
  const handleShapeChange = useCallback(
    (shape: BrushShape) => {
      if (shape !== currentShape) {
        analytics.trackUIInteraction({
          area: 'canvas_tool_settings',
          action: 'eraser_shape_changed',
          control: 'eraser_shape_button',
          value: shape,
          source: 'eraser_settings_toolbar',
        });
      }
      setCurrentShape(shape);
      setEraserShape(board, shape);
      // 更新光标
      updateEraserCursor(board);
    },
    [board, currentShape]
  );

  // 只在选择橡皮擦指针时显示
  if (!isEraserPointer) {
    return null;
  }

  const container = PlaitBoard.getBoardContainer(board);

  // 获取当前缩放比例
  const zoom = board.viewport?.zoom ?? 1;

  return (
    <div
      className="pencil-settings-toolbar eraser-settings-toolbar"
      onMouseEnter={() => setShowCursorPreview(true)}
      onMouseLeave={() => setShowCursorPreview(false)}
    >
      {/* 模拟光标预览 */}
      {showCursorPreview && (
        <CursorPreview
          color={ERASER_COLOR}
          size={eraserSize}
          zoom={zoom}
          shape={currentShape}
        />
      )}
      <Island ref={containerRef} padding={1}>
        <Stack.Row gap={1} align="center">
          <SizePicker
            size={eraserSize}
            onSizeChange={handleSizeChange}
            onSizeCommit={handleSizeCommit}
            presets={ERASER_WIDTH_PRESETS}
            previewColor="#999"
            title={t('toolbar.eraserSize')}
            container={container}
          />
          {/* 分隔线 */}
          <div className="toolbar-divider" />
          {/* 形状选择器 */}
          <div className="eraser-shape-picker">
            <HoverTip content={t('toolbar.eraserShape.circle')}>
              <Button
                variant="text"
                size="small"
                className={`eraser-shape-button ${
                  currentShape === BrushShape.circle ? 'active' : ''
                }`}
                onClick={() => handleShapeChange(BrushShape.circle)}
              >
                <Circle size={16} />
              </Button>
            </HoverTip>
            <HoverTip content={t('toolbar.eraserShape.square')}>
              <Button
                variant="text"
                size="small"
                className={`eraser-shape-button ${
                  currentShape === BrushShape.square ? 'active' : ''
                }`}
                onClick={() => handleShapeChange(BrushShape.square)}
              >
                <Square size={16} />
              </Button>
            </HoverTip>
          </div>
        </Stack.Row>
      </Island>
    </div>
  );
};

export default EraserSettingsToolbar;
