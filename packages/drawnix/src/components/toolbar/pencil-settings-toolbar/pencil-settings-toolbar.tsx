/**
 * 画笔设置工具栏
 * 在画笔模式下显示，允许用户修改画笔大小和颜色
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import classNames from 'classnames';
import { useBoard } from '@plait-board/react-board';
import { DEFAULT_COLOR, PlaitBoard } from '@plait/core';
import { Circle, Square } from 'lucide-react';
import { Island } from '../../island';
import { ToolButton } from '../../tool-button';
import { UnifiedColorPicker } from '../../unified-color-picker';
import { Popover, PopoverContent, PopoverTrigger } from '../../popover/popover';
import Stack from '../../stack';
import { useDrawnix } from '../../../hooks/use-drawnix';
import {
  BrushShape,
  getFreehandSettings,
  setFreehandStrokeWidth,
  setFreehandStrokeColor,
  setFreehandStrokeStyle,
  setFreehandPressureEnabled,
  setPencilShape,
  FreehandStrokeStyle,
} from '../../../plugins/freehand/freehand-settings';
import { FreehandShape } from '../../../plugins/freehand/type';
import { getFreehandPointers } from '../../../plugins/freehand/utils';
import { useI18n } from '../../../i18n';
import { useViewportScale } from '../../../hooks/useViewportScale';
import { updatePencilCursor } from '../../../hooks/usePencilCursor';
import { Button, Slider, Switch } from 'tdesign-react';
import {
  StrokeStyleNormalIcon,
  StrokeStyleDashedIcon,
  StrokeStyleDotedIcon,
  StrokeStyleDoubleIcon,
} from '../../icons';
import './pencil-settings-toolbar.scss';
import { HoverTip } from '../../shared/hover';
import { analytics } from '../../../utils/umami-analytics';

// 模拟光标预览组件
const CursorPreview: React.FC<{
  color: string;
  size: number;
  zoom: number;
  shape?: BrushShape;
}> = ({ color, size, zoom, shape = BrushShape.circle }) => {
  // 应用缩放后的大小，限制范围：最小 4px，最大 256px
  const scaledSize = size * zoom;
  const previewSize = Math.max(4, Math.min(256, scaledSize));
  const borderRadius = shape === BrushShape.circle ? '50%' : '0';

  return (
    <div
      className="cursor-preview-dot"
      style={{
        width: previewSize,
        height: previewSize,
        backgroundColor: color,
        borderRadius,
      }}
    />
  );
};

export const PencilSettingsToolbar: React.FC = () => {
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
  const [strokeWidth, setStrokeWidth] = useState(settings.strokeWidth);
  const [strokeColor, setStrokeColor] = useState(settings.strokeColor);
  const [strokeStyle, setStrokeStyleState] = useState(settings.strokeStyle);
  const [currentShape, setCurrentShape] = useState<BrushShape>(
    settings.pencilShape
  );
  const [pressureEnabled, setPressureEnabled] = useState(
    settings.pressureEnabled
  );
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [isWidthPickerOpen, setIsWidthPickerOpen] = useState(false);
  const [inputValue, setInputValue] = useState(String(settings.strokeWidth));
  // 是否显示光标预览（仅鼠标悬停在工具栏上时）
  const [showCursorPreview, setShowCursorPreview] = useState(false);

  // 检查是否是画笔指针（不包括橡皮擦）
  const freehandPointers = getFreehandPointers();
  const isPencilPointer =
    freehandPointers.includes(appState.pointer as FreehandShape) &&
    appState.pointer !== FreehandShape.eraser;

  // 当 board 变化时同步设置
  useEffect(() => {
    const newSettings = getFreehandSettings(board);
    setStrokeWidth(newSettings.strokeWidth);
    setStrokeColor(newSettings.strokeColor);
    setStrokeStyleState(newSettings.strokeStyle);
    setCurrentShape(newSettings.pencilShape);
    setPressureEnabled(newSettings.pressureEnabled);
    setInputValue(String(newSettings.strokeWidth));
  }, [board, appState.pointer, appState.toolSettingsVersion]);

  // 处理输入框值变化
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputValue(e.target.value);
    },
    []
  );

  // 处理输入框失焦或回车确认
  const handleInputConfirm = useCallback(() => {
    const value = parseInt(inputValue, 10);
    if (!isNaN(value) && value >= 1 && value <= 100) {
      if (value !== strokeWidth) {
        analytics.trackUIInteraction({
          area: 'canvas_tool_settings',
          action: 'pencil_stroke_width_changed',
          control: 'stroke_width_input',
          value,
          source: 'pencil_settings_toolbar',
          metadata: { previousValue: strokeWidth },
        });
      }
      setStrokeWidth(value);
      setFreehandStrokeWidth(board, value);
      // 更新光标
      updatePencilCursor(board, appState.pointer);
    } else {
      // 恢复为当前值
      setInputValue(String(strokeWidth));
    }
  }, [board, inputValue, strokeWidth, appState.pointer]);

  // 处理输入框键盘事件
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleInputConfirm();
        (e.target as HTMLInputElement).blur();
      } else if (e.key === 'Escape') {
        setInputValue(String(strokeWidth));
        (e.target as HTMLInputElement).blur();
      }
    },
    [handleInputConfirm, strokeWidth]
  );

  // 处理画笔颜色变化
  const handleColorChange = useCallback(
    (color: string) => {
      if (color !== strokeColor) {
        analytics.trackUIInteraction({
          area: 'canvas_tool_settings',
          action: 'pencil_color_changed',
          control: 'stroke_color_picker',
          value: 'custom',
          source: 'pencil_settings_toolbar',
          metadata: { hasColor: !!color },
        });
      }
      setStrokeColor(color);
      setFreehandStrokeColor(board, color);
      // 更新光标
      updatePencilCursor(board, appState.pointer);
    },
    [board, appState.pointer, strokeColor]
  );

  // 处理描边样式变化
  const handleStrokeStyleChange = useCallback(
    (style: FreehandStrokeStyle) => {
      if (style !== strokeStyle) {
        analytics.trackUIInteraction({
          area: 'canvas_tool_settings',
          action: 'pencil_stroke_style_changed',
          control: 'stroke_style_button',
          value: style,
          source: 'pencil_settings_toolbar',
        });
      }
      setStrokeStyleState(style);
      setFreehandStrokeStyle(board, style);
    },
    [board, strokeStyle]
  );

  // 处理形状切换
  const handleShapeChange = useCallback(
    (shape: BrushShape) => {
      if (shape !== currentShape) {
        analytics.trackUIInteraction({
          area: 'canvas_tool_settings',
          action: 'pencil_shape_changed',
          control: 'brush_shape_button',
          value: shape,
          source: 'pencil_settings_toolbar',
        });
      }
      setCurrentShape(shape);
      setPencilShape(board, shape);
      // 更新光标
      updatePencilCursor(board, appState.pointer);
    },
    [board, appState.pointer, currentShape]
  );

  // 处理压力感应开关变化
  const handlePressureChange = useCallback(
    (enabled: boolean) => {
      if (enabled !== pressureEnabled) {
        analytics.trackUIInteraction({
          area: 'canvas_tool_settings',
          action: 'pencil_pressure_changed',
          control: 'pressure_switch',
          value: enabled,
          source: 'pencil_settings_toolbar',
        });
      }
      setPressureEnabled(enabled);
      setFreehandPressureEnabled(board, enabled);
    },
    [board, pressureEnabled]
  );

  // 只在选择画笔指针时显示（不包括橡皮擦）
  if (!isPencilPointer) {
    return null;
  }

  const container = PlaitBoard.getBoardContainer(board);

  // 获取当前缩放比例
  const zoom = board.viewport?.zoom ?? 1;

  return (
    <div
      className="pencil-settings-toolbar"
      onMouseEnter={() => setShowCursorPreview(true)}
      onMouseLeave={() => setShowCursorPreview(false)}
    >
      {/* 模拟光标预览 */}
      {showCursorPreview && (
        <CursorPreview
          color={strokeColor || DEFAULT_COLOR}
          size={strokeWidth}
          zoom={zoom}
          shape={currentShape}
        />
      )}
      <Island ref={containerRef} padding={1}>
        <Stack.Row gap={0} align="center">
          {/* 颜色选择按钮 */}
          <Popover
            sideOffset={12}
            open={isColorPickerOpen}
            onOpenChange={setIsColorPickerOpen}
            placement="bottom"
          >
            <PopoverTrigger asChild>
              <ToolButton
                className="pencil-color-button"
                type="button"
                visible={true}
                tooltip={t('toolbar.strokeColor')}
                aria-label={t('toolbar.strokeColor')}
                onPointerUp={() => setIsColorPickerOpen(!isColorPickerOpen)}
              >
                <div
                  className="pencil-color-preview"
                  style={{ backgroundColor: strokeColor || DEFAULT_COLOR }}
                />
              </ToolButton>
            </PopoverTrigger>
            <PopoverContent container={container}>
              <Island padding={4} className={classNames('stroke-setting')}>
                <UnifiedColorPicker
                  value={strokeColor}
                  onChange={handleColorChange}
                />
              </Island>
            </PopoverContent>
          </Popover>

          {/* 描边样式选择 */}
          <div className="pencil-stroke-style-picker">
            <ToolButton
              className={classNames('pencil-stroke-style-button', {
                active: strokeStyle === FreehandStrokeStyle.solid,
              })}
              type="button"
              visible={true}
              icon={<StrokeStyleNormalIcon />}
              tooltip="实线"
              aria-label="实线"
              onPointerUp={() =>
                handleStrokeStyleChange(FreehandStrokeStyle.solid)
              }
            />
            <ToolButton
              className={classNames('pencil-stroke-style-button', {
                active: strokeStyle === FreehandStrokeStyle.dashed,
              })}
              type="button"
              visible={true}
              icon={<StrokeStyleDashedIcon />}
              tooltip="虚线"
              aria-label="虚线"
              onPointerUp={() =>
                handleStrokeStyleChange(FreehandStrokeStyle.dashed)
              }
            />
            <ToolButton
              className={classNames('pencil-stroke-style-button', {
                active: strokeStyle === FreehandStrokeStyle.dotted,
              })}
              type="button"
              visible={true}
              icon={<StrokeStyleDotedIcon />}
              tooltip="点线"
              aria-label="点线"
              onPointerUp={() =>
                handleStrokeStyleChange(FreehandStrokeStyle.dotted)
              }
            />
            <ToolButton
              className={classNames('pencil-stroke-style-button', {
                active: strokeStyle === FreehandStrokeStyle.double,
              })}
              type="button"
              visible={true}
              icon={<StrokeStyleDoubleIcon />}
              tooltip="双层线"
              aria-label="双层线"
              onPointerUp={() =>
                handleStrokeStyleChange(FreehandStrokeStyle.double)
              }
            />
          </div>

          {/* 画笔形状选择 */}
          <div className="pencil-shape-picker">
            <HoverTip content={t('toolbar.pencilShape.circle')}>
              <Button
                variant="text"
                size="small"
                className={`pencil-shape-button ${
                  currentShape === BrushShape.circle ? 'active' : ''
                }`}
                onClick={() => handleShapeChange(BrushShape.circle)}
              >
                <Circle size={16} />
              </Button>
            </HoverTip>
            <HoverTip content={t('toolbar.pencilShape.square')}>
              <Button
                variant="text"
                size="small"
                className={`pencil-shape-button ${
                  currentShape === BrushShape.square ? 'active' : ''
                }`}
                onClick={() => handleShapeChange(BrushShape.square)}
              >
                <Square size={16} />
              </Button>
            </HoverTip>
          </div>

          {/* 画笔大小选择 */}
          <Popover
            sideOffset={12}
            open={isWidthPickerOpen}
            onOpenChange={setIsWidthPickerOpen}
            placement="bottom"
          >
            <PopoverTrigger asChild>
              <ToolButton
                className="pencil-width-button"
                type="button"
                visible={true}
                tooltip={t('toolbar.strokeWidth')}
                aria-label={t('toolbar.strokeWidth')}
                onPointerUp={() => setIsWidthPickerOpen(!isWidthPickerOpen)}
              >
                <svg className="pencil-width-icon" viewBox="0 0 24 24">
                  <line
                    x1="4"
                    y1="8"
                    x2="20"
                    y2="8"
                    strokeWidth="1"
                    stroke="currentColor"
                  />
                  <line
                    x1="4"
                    y1="12"
                    x2="20"
                    y2="12"
                    strokeWidth="2"
                    stroke="currentColor"
                  />
                  <line
                    x1="4"
                    y1="16"
                    x2="20"
                    y2="16"
                    strokeWidth="3"
                    stroke="currentColor"
                  />
                </svg>
              </ToolButton>
            </PopoverTrigger>
            <PopoverContent container={container}>
              <Island padding={4} className={classNames('stroke-width-picker')}>
                <Stack.Row
                  gap={3}
                  align="center"
                  style={{ padding: '4px 8px' }}
                >
                  <div
                    className="stroke-width-value"
                    style={{
                      minWidth: '40px',
                      fontSize: '13px',
                      fontWeight: 500,
                      color: 'var(--color-on-surface)',
                    }}
                  >
                    {strokeWidth}px
                  </div>
                  <div
                    className="stroke-width-slider-wrapper"
                    style={{ flex: 1, minWidth: '160px' }}
                  >
                    <Slider
                      value={strokeWidth}
                      min={1}
                      max={100}
                      step={1}
                      onChange={(val) => {
                        const width = val as number;
                        setStrokeWidth(width);
                        setInputValue(String(width));
                        setFreehandStrokeWidth(board, width);
                        updatePencilCursor(board, appState.pointer);
                      }}
                      label={false}
                    />
                  </div>
                </Stack.Row>
              </Island>
            </PopoverContent>
          </Popover>

          {/* 大小输入框 - 直接在工具栏上 */}
          <div className="pencil-width-input-wrapper">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={inputValue}
              onChange={handleInputChange}
              onBlur={handleInputConfirm}
              onKeyDown={handleInputKeyDown}
              className="pencil-width-input"
            />
            <span className="pencil-width-input-unit">px</span>
          </div>

          {/* 压力感应开关 */}
          <HoverTip content="压力感应：支持压感笔；鼠标/触控板使用速度模拟（慢=粗，快=细）">
            <div className="pencil-pressure-switch">
              <Switch
                size="small"
                value={pressureEnabled}
                onChange={handlePressureChange}
              />
            </div>
          </HoverTip>
        </Stack.Row>
      </Island>
    </div>
  );
};

export default PencilSettingsToolbar;
