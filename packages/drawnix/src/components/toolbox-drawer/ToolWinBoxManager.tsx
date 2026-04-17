/**
 * ToolWinBoxManager Component
 * 
 * 管理所有以 WinBox 弹窗形式打开的工具
 * 支持最小化、常驻工具栏等功能
 */

import React, { useEffect, useState, Suspense, useCallback, useMemo, useRef } from 'react';
import { PlaitBoard, getViewportOrigination } from '@plait/core';
import { WinBoxWindow } from '../winbox';
import { toolWindowService } from '../../services/tool-window-service';
import {
  ToolDefinition,
  ToolInstanceContextProps,
  ToolWindowState,
} from '../../types/toolbox.types';
import { useI18n } from '../../i18n';
import { useDrawnix } from '../../hooks/use-drawnix';
import { ToolTransforms } from '../../plugins/with-tool';
import { processToolUrl } from '../../utils/url-template';
import { useDeviceType } from '../../hooks/useDeviceType';
import { toolRegistry } from '../../tools/registry';
import { winboxManagerService } from '../../services/winbox-manager-service';

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
    instanceId: string,
    position: { x: number; y: number },
    size: { width: number; height: number }
  ) => {
    toolWindowService.minimizeTool(instanceId, position, size);
  }, []);

  /**
   * 处理窗口位置/尺寸变化
   */
  const handleMove = useCallback((instanceId: string, x: number, y: number) => {
    const state = toolWindowService.getToolInstance(instanceId);
    if (state) {
      toolWindowService.updateToolPosition(instanceId, { x, y }, state.size);
    }
  }, []);

  /**
   * 处理窗口调整大小
   */
  const handleResize = useCallback((instanceId: string, width: number, height: number) => {
    const state = toolWindowService.getToolInstance(instanceId);
    if (state) {
      toolWindowService.updateToolPosition(
        instanceId,
        state.position || { x: 0, y: 0 },
        { width, height }
      );
    }
  }, []);

  const handleActivate = useCallback((instanceId: string) => {
    toolWindowService.markToolActivated(instanceId);
  }, []);

  // 当 toolStates 变化时（如外部调用 openTool），同步置顶到 WinBoxManager
  const prevTopToolRef = useRef<string | null>(null);
  useEffect(() => {
    const openStates = toolStates.filter(s => s.status === 'open');
    if (openStates.length === 0) {
      prevTopToolRef.current = null;
      return;
    }
    const topTool = openStates.reduce((a, b) =>
      a.activationOrder >= b.activationOrder ? a : b
    );
    const topToolId = topTool.instanceId;
    if (topToolId !== prevTopToolRef.current) {
      prevTopToolRef.current = topToolId;
      winboxManagerService.bringToFront(`tool-window-${topToolId}`);
    }
  }, [toolStates]);

  /**
   * 处理将工具插入到画布
   * @param tool 工具定义
   * @param rect 弹窗当前位置和尺寸（屏幕坐标）
   */
  const handleInsertToCanvas = useCallback((
    instanceId: string,
    tool: ToolDefinition,
    rect: { x: number; y: number; width: number; height: number }
  ) => {
    if (!board) {
      console.warn('Board not ready');
      return;
    }

    // 先关闭弹窗
    toolWindowService.closeTool(instanceId);

    // 将屏幕坐标转换为画布坐标
    const boardContainerRect = PlaitBoard.getBoardContainer(board).getBoundingClientRect();
    const zoom = board.viewport.zoom;
    const origination = getViewportOrigination(board);
    if (!origination) {
      console.warn('Viewport origination not ready');
      return;
    }

    // 弹窗位置相对于画布容器的偏移
    const screenX = rect.x - boardContainerRect.left;
    const screenY = rect.y - boardContainerRect.top;

    // 转换为画布坐标
    const canvasX = origination[0] + screenX / zoom;
    const canvasY = origination[1] + screenY / zoom;

    // 使用弹窗的尺寸
    const width = rect.width;
    const height = rect.height;

    // 插入到画布（使用与 ToolboxDrawer 相同的调用方式）
    const toolUrl = 'url' in tool ? tool.url : undefined;
    const toolComponent = 'component' in tool ? tool.component : undefined;
    if (tool.url || tool.component) {
      ToolTransforms.insertTool(
        board,
        tool.id,
        toolUrl,
        [canvasX, canvasY],
        { width, height },
        {
          name: tool.name,
          category: tool.category,
          permissions: tool.permissions,
          component: toolComponent,
        }
      );
    }
  }, [board]);

  /**
   * 处理窗口最大化回调
   * 清除 autoMaximize 标记，避免再次打开时重复最大化
   */
  const handleMaximize = useCallback((instanceId: string) => {
    const state = toolWindowService.getToolInstance(instanceId);
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
        return a.instanceId.localeCompare(b.instanceId);
      }),
    [activeStates]
  );

  const displayMetaByInstanceId = useMemo(() => {
    const counts = new Map<string, number>();
    const counters = new Map<string, number>();

    stackedStates.forEach((state) => {
      counts.set(state.toolId, (counts.get(state.toolId) || 0) + 1);
    });

    const result = new Map<string, { displayIndex: number; showIndex: boolean }>();
    stackedStates.forEach((state) => {
      const displayIndex = (counters.get(state.toolId) || 0) + 1;
      counters.set(state.toolId, displayIndex);
      result.set(state.instanceId, {
        displayIndex,
        showIndex: (counts.get(state.toolId) || 0) > 1,
      });
    });

    return result;
  }, [stackedStates]);

  if (stackedStates.length === 0) {
    return null;
  }

  return (
    <>
      {stackedStates.map(state => {
        const { instanceId, instanceIndex, tool, status, position, size, autoMaximize } = state;
        const InternalComponent = toolRegistry.resolveInternalComponent(tool.component);
        const displayMeta = displayMetaByInstanceId.get(instanceId);
        const componentProps: ToolInstanceContextProps & Record<string, unknown> = {
          ...(state.componentProps || {}),
          toolInstanceId: instanceId,
          toolId: state.toolId,
          instanceIndex,
        };
        
        // 确定窗口是否可见
        const isVisible = status === 'open';
        
        // 计算窗口尺寸（移动端限制不超出屏幕）
        const windowSize = getWindowSize(tool, size);
        
        return (
          <WinBoxWindow
            key={instanceId}
            id={`tool-window-${instanceId}`}
            visible={isVisible}
            keepAlive={true}
            title={displayMeta?.showIndex ? `${tool.name} #${displayMeta.displayIndex}` : tool.name}
            icon={tool.icon}
            width={windowSize.width}
            height={windowSize.height}
            x={position?.x}
            y={position?.y}
            autoMaximize={autoMaximize}
            onClose={() => toolWindowService.closeTool(instanceId)}
            onMinimize={(pos, sz) => handleMinimize(instanceId, pos, sz)}
            onMaximize={() => handleMaximize(instanceId)}
            onMove={(x, y) => handleMove(instanceId, x, y)}
            onResize={(w, h) => handleResize(instanceId, w, h)}
            onActivate={() => handleActivate(instanceId)}
            onInsertToCanvas={(rect) => handleInsertToCanvas(instanceId, tool, rect)}
            minimizeTargetSelector={`[data-minimize-target="${instanceId}"]`}
            className="winbox-ai-generation winbox-tool-window"
            background="#ffffff"
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
                  <InternalComponent {...componentProps} />
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
