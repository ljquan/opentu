/**
 * ToolWinBoxManager Component
 * 
 * 管理所有以 WinBox 弹窗形式打开的工具
 * 支持最小化、常驻工具栏等功能
 */

import React, { useEffect, useState, Suspense, useCallback, useMemo } from 'react';
import { PlaitBoard, getViewportOrigination } from '@plait/core';
import { WinBoxWindow } from '../winbox';
import { toolWindowService } from '../../services/tool-window-service';
import { ToolDefinition, ToolWindowState } from '../../types/toolbox.types';
import { useI18n } from '../../i18n';
import { useDrawnix } from '../../hooks/use-drawnix';
import { ToolTransforms } from '../../plugins/with-tool';
import { processToolUrl } from '../../utils/url-template';
import { useDeviceType } from '../../hooks/useDeviceType';
import { toolRegistry } from '../../tools/registry';
import { Z_INDEX } from '../../constants/z-index';

/**
 * 工具弹窗管理器组件
 */
export const ToolWinBoxManager: React.FC = () => {
  const [toolStates, setToolStates] = useState<ToolWindowState[]>([]);
  const { language } = useI18n();
  const { board } = useDrawnix();
  const { isMobile, isTablet, viewportWidth, viewportHeight } = useDeviceType();

  useEffect(() => {
    const subscription = toolWindowService.observeToolStates().subscribe(states => {
      setToolStates(states);
    });
    
    return () => subscription.unsubscribe();
  }, []);

  /**
   * 计算窗口尺寸，确保不超出视口
   */
  const getWindowSize = useCallback((tool: ToolDefinition, savedSize?: { width: number; height: number }) => {
    const defaultWidth = savedSize?.width || tool.defaultWidth || 800;
    const defaultHeight = savedSize?.height || tool.defaultHeight || 600;
    
    // 移动端/平板端限制窗口尺寸
    if (isMobile || isTablet) {
      const maxWidth = viewportWidth - 16; // 留出边距
      const maxHeight = viewportHeight - 60; // 留出标题栏和边距
      return {
        width: Math.min(defaultWidth, maxWidth),
        height: Math.min(defaultHeight, maxHeight),
      };
    }
    
    return { width: defaultWidth, height: defaultHeight };
  }, [isMobile, isTablet, viewportWidth, viewportHeight]);

  /**
   * 处理工具最小化
   */
  const handleMinimize = useCallback((
    toolId: string,
    position: { x: number; y: number },
    size: { width: number; height: number }
  ) => {
    toolWindowService.minimizeTool(toolId, position, size);
  }, []);

  /**
   * 处理窗口位置/尺寸变化
   */
  const handleMove = useCallback((toolId: string, x: number, y: number) => {
    const state = toolWindowService.getToolState(toolId);
    if (state) {
      toolWindowService.updateToolPosition(toolId, { x, y }, state.size);
    }
  }, []);

  /**
   * 处理窗口调整大小
   */
  const handleResize = useCallback((toolId: string, width: number, height: number) => {
    const state = toolWindowService.getToolState(toolId);
    if (state) {
      toolWindowService.updateToolPosition(
        toolId,
        state.position || { x: 0, y: 0 },
        { width, height }
      );
    }
  }, []);

  const handleActivate = useCallback((toolId: string) => {
    toolWindowService.markToolActivated(toolId);
  }, []);

  /**
   * 处理将工具插入到画布
   * @param tool 工具定义
   * @param rect 弹窗当前位置和尺寸（屏幕坐标）
   */
  const handleInsertToCanvas = useCallback((
    tool: ToolDefinition,
    rect: { x: number; y: number; width: number; height: number }
  ) => {
    if (!board) {
      console.warn('Board not ready');
      return;
    }

    // 先关闭弹窗
    toolWindowService.closeTool(tool.id);

    // 将屏幕坐标转换为画布坐标
    const boardContainerRect = PlaitBoard.getBoardContainer(board).getBoundingClientRect();
    const zoom = board.viewport.zoom;
    const origination = getViewportOrigination(board);

    // 弹窗位置相对于画布容器的偏移
    const screenX = rect.x - boardContainerRect.left;
    const screenY = rect.y - boardContainerRect.top;

    // 转换为画布坐标
    const canvasX = origination![0] + screenX / zoom;
    const canvasY = origination![1] + screenY / zoom;

    // 使用弹窗的尺寸
    const width = rect.width;
    const height = rect.height;

    // 插入到画布（使用与 ToolboxDrawer 相同的调用方式）
    if (tool.url || tool.component) {
      ToolTransforms.insertTool(
        board,
        tool.id,
        (tool as any).url, // url 可能为 undefined
        [canvasX, canvasY],
        { width, height },
        {
          name: tool.name,
          category: tool.category,
          permissions: tool.permissions,
          component: (tool as any).component,
        }
      );
    }
  }, [board]);

  /**
   * 处理窗口最大化回调
   * 清除 autoMaximize 标记，避免再次打开时重复最大化
   */
  const handleMaximize = useCallback((toolId: string) => {
    const state = toolWindowService.getToolState(toolId);
    if (state && state.autoMaximize) {
      // 清除 autoMaximize 标记（通过更新状态）
      // 由于 ToolWindowState 是引用类型，直接修改即可
      state.autoMaximize = false;
    }
  }, []);

  // 只渲染 open 或 minimized 状态的工具（minimized 状态需要保留实例但隐藏）
  const activeStates = toolStates.filter(
    state => state.status === 'open' || state.status === 'minimized'
  );

  const stackedStates = useMemo(
    () =>
      [...activeStates].sort((a, b) => {
        if (a.activationOrder !== b.activationOrder) {
          return a.activationOrder - b.activationOrder;
        }
        return a.tool.id.localeCompare(b.tool.id);
      }),
    [activeStates]
  );

  const openWindowZIndexMap = useMemo(() => {
    const visibleStates = stackedStates.filter(state => state.status === 'open');
    return new Map(
      visibleStates.map((state, index) => [
        state.tool.id,
        Z_INDEX.DIALOG_AI_IMAGE + index,
      ])
    );
  }, [stackedStates]);

  if (stackedStates.length === 0) {
    return null;
  }

  return (
    <>
      {stackedStates.map(state => {
        const { tool, status, position, size, autoMaximize } = state;
        const InternalComponent = toolRegistry.resolveInternalComponent(tool.component);
        
        // 确定窗口是否可见
        const isVisible = status === 'open';
        
        // 计算窗口尺寸（移动端限制不超出屏幕）
        const windowSize = getWindowSize(tool, size);
        
        return (
          <WinBoxWindow
            key={tool.id}
            id={`tool-window-${tool.id}`}
            visible={isVisible}
            keepAlive={true}
            title={tool.name}
            icon={tool.icon}
            width={windowSize.width}
            height={windowSize.height}
            x={position?.x}
            y={position?.y}
            autoMaximize={autoMaximize}
            onClose={() => toolWindowService.closeTool(tool.id)}
            onMinimize={(pos, sz) => handleMinimize(tool.id, pos, sz)}
            onMaximize={() => handleMaximize(tool.id)}
            onMove={(x, y) => handleMove(tool.id, x, y)}
            onResize={(w, h) => handleResize(tool.id, w, h)}
            onActivate={() => handleActivate(tool.id)}
            onInsertToCanvas={(rect) => handleInsertToCanvas(tool, rect)}
            minimizeTargetSelector={`[data-minimize-target="${tool.id}"]`}
            className="winbox-ai-generation winbox-tool-window"
            background="#ffffff"
            zIndex={openWindowZIndexMap.get(tool.id) ?? Z_INDEX.DIALOG_AI_IMAGE}
          >
            <div className="tool-window-content" style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
              {InternalComponent ? (
                <Suspense fallback={
                  <div style={{ 
                    padding: 20, 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    height: '100%',
                    color: '#666'
                  }}>
                    {language === 'zh' ? '加载中...' : 'Loading...'}
                  </div>
                }>
                  <InternalComponent {...(state.componentProps || {})} />
                </Suspense>
              ) : tool.url ? (
                <iframe
                  src={processToolUrl(tool.url).url}
                  title={tool.name}
                  style={{ width: '100%', height: '100%', border: 'none' }}
                  sandbox={tool.permissions?.join(' ') || 'allow-scripts allow-same-origin'}
                />
              ) : (
                <div style={{ padding: 20, textAlign: 'center', color: '#999' }}>
                  {language === 'zh' ? '未定义的工具内容' : 'Undefined tool content'}
                </div>
              )}
            </div>
          </WinBoxWindow>
        );
      })}
    </>
  );
};

export default ToolWinBoxManager;
