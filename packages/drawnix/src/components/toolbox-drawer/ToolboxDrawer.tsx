/**
 * ToolboxDrawer Component
 *
 * 工具箱侧边栏 - 展示可用工具列表
 * 用户点击工具项后，将工具插入到画布中心
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Button, Input, MessagePlugin } from 'tdesign-react';
import { SearchIcon, AddIcon } from 'tdesign-icons-react';
import { PlaitBoard, getViewportOrigination } from '@plait/core';
import { useDrawnix } from '../../hooks/use-drawnix';
import { ToolTransforms } from '../../plugins/with-tool';
import { toolboxService } from '../../services/toolbox-service';
import { toolWindowService } from '../../services/tool-window-service';
import { analytics } from '../../utils/posthog-analytics';
import { ToolDefinition } from '../../types/toolbox.types';
import { DEFAULT_TOOL_CONFIG, TOOL_CATEGORY_LABELS } from '../../constants/built-in-tools';
import { ToolList } from './ToolList';
import { CustomToolDialog } from '../custom-tool-dialog/CustomToolDialog';
import { BaseDrawer } from '../side-drawer';
import { useConfirmDialog } from '../dialog/ConfirmDialog';
import { needsApiKeyConfiguration } from '../../utils/url-template';
import { geminiSettings } from '../../utils/settings-manager';
import './toolbox-drawer.scss';

export interface ToolboxDrawerProps {
  /** 是否打开抽屉 */
  isOpen: boolean;
  /** 抽屉打开状态变化回调 */
  onOpenChange: (open: boolean) => void;
}

// Storage key for drawer width
export const TOOLBOX_DRAWER_WIDTH_KEY = 'toolbox-drawer-width';

/**
 * 工具箱抽屉组件
 */
export const ToolboxDrawer: React.FC<ToolboxDrawerProps> = ({
  isOpen,
  onOpenChange,
}) => {
  const { board, appState, setAppState } = useDrawnix();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [customToolDialogVisible, setCustomToolDialogVisible] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const { confirm, confirmDialog } = useConfirmDialog();

  // 待处理的工具操作（等待 API Key 配置完成后继续）
  const pendingToolRef = useRef<{
    tool: ToolDefinition;
    action: 'insert' | 'window';
  } | null>(null);

  /**
   * 关闭抽屉
   */
  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  /**
   * 监听设置弹窗关闭，如果有待处理的工具操作，检查 API Key 是否已配置
   */
  useEffect(() => {
    if (!appState.openSettings && pendingToolRef.current) {
      const settings = geminiSettings.get();
      if (settings?.apiKey) {
        const { tool, action } = pendingToolRef.current;
        pendingToolRef.current = null;

        // 延迟执行，确保设置已保存
        setTimeout(() => {
          if (action === 'insert') {
            executeToolInsert(tool);
          } else if (action === 'window') {
            executeToolOpenWindow(tool);
          }
        }, 100);
      } else {
        // 用户关闭了设置但没有配置 API Key，取消操作
        pendingToolRef.current = null;
      }
    }
  }, [appState.openSettings]);

  /**
   * 执行工具插入到画布（实际执行逻辑）
   */
  const executeToolInsert = useCallback(
    (tool: ToolDefinition) => {
      if (!board) {
        console.warn('Board not ready');
        return;
      }

      // 计算画布中心位置
      // 使用 Plait 的 getViewportOrigination 获取视口原点
      const boardContainerRect =
        PlaitBoard.getBoardContainer(board).getBoundingClientRect();
      const focusPoint = [
        boardContainerRect.width / 2,
        boardContainerRect.height / 2,
      ];
      const zoom = board.viewport.zoom;
      const origination = getViewportOrigination(board);
      const centerX = origination![0] + focusPoint[0] / zoom;
      const centerY = origination![1] + focusPoint[1] / zoom;

      // 工具尺寸
      const width = tool.defaultWidth || DEFAULT_TOOL_CONFIG.defaultWidth;
      const height = tool.defaultHeight || DEFAULT_TOOL_CONFIG.defaultHeight;

      // 获取工具 URL（保持模板形式，如 ${apiKey}）
      // 模板变量会在渲染时由 ToolGenerator 动态替换
      const toolUrl = (tool as any).url;

      // 插入到画布（中心对齐）
      if (toolUrl || tool.component) {
        ToolTransforms.insertTool(
          board,
          tool.id,
          toolUrl, // 存储原始模板 URL，渲染时再替换
          [centerX - width / 2, centerY - height / 2],
          { width, height },
          {
            name: tool.name,
            category: tool.category,
            permissions: tool.permissions,
            component: (tool as any).component,
          }
        );

        // 埋点：工具实际使用（插入画布）
        analytics.track('tool_actually_used', {
          toolId: tool.id,
          toolName: tool.name,
          category: tool.category,
          usageType: 'insert',
          isCustomTool: !tool.id.startsWith('builtin-'),
        });
      } else {
        MessagePlugin.warning('该工具未定义内容（URL 或组件）');
      }

      // 插入后关闭抽屉
      handleClose();
    },
    [board, handleClose]
  );

  /**
   * 处理工具插入到画布（入口，检查是否需要配置 API Key）
   */
  const handleToolInsert = useCallback(
    (tool: ToolDefinition) => {
      // 检查 URL 是否需要 API Key 配置
      const toolUrl = (tool as any).url;
      if (toolUrl && needsApiKeyConfiguration(toolUrl)) {
        // 需要配置 API Key，保存待处理的操作并打开设置弹窗
        pendingToolRef.current = { tool, action: 'insert' };
        MessagePlugin.info('该工具需要配置 API Key，请先完成设置');
        setAppState((prev) => ({ ...prev, openSettings: true }));
        return;
      }

      // 直接执行插入
      executeToolInsert(tool);
    },
    [executeToolInsert, setAppState]
  );

  /**
   * 执行在窗口中打开工具（实际执行逻辑）
   */
  const executeToolOpenWindow = useCallback(
    (tool: ToolDefinition) => {
      // 存储原始模板 URL，在渲染时由 ToolWinBoxManager 替换
      toolWindowService.openTool(tool);

      // 埋点：工具实际使用（在窗口中打开）
      analytics.track('tool_actually_used', {
        toolId: tool.id,
        toolName: tool.name,
        category: tool.category,
        usageType: 'window',
        isCustomTool: !tool.id.startsWith('builtin-'),
      });

      // 在窗口打开后，可以选择关闭抽屉，也可以保持打开
      handleClose();
    },
    [handleClose]
  );

  /**
   * 处理在窗口中打开工具（入口，检查是否需要配置 API Key）
   */
  const handleToolOpenWindow = useCallback(
    (tool: ToolDefinition) => {
      // 检查 URL 是否需要 API Key 配置
      const toolUrl = (tool as any).url;
      if (toolUrl && needsApiKeyConfiguration(toolUrl)) {
        // 需要配置 API Key，保存待处理的操作并打开设置弹窗
        pendingToolRef.current = { tool, action: 'window' };
        MessagePlugin.info('该工具需要配置 API Key，请先完成设置');
        setAppState((prev) => ({ ...prev, openSettings: true }));
        return;
      }

      // 直接执行打开窗口
      executeToolOpenWindow(tool);
    },
    [executeToolOpenWindow, setAppState]
  );

  /**
   * 获取所有工具（搜索 + 分类过滤）
   */
  const filteredTools = useMemo(() => {
    let tools = toolboxService.getAvailableTools();

    // 搜索过滤
    if (searchQuery.trim()) {
      tools = toolboxService.searchTools(searchQuery);
    }

    // 分类过滤
    if (selectedCategory) {
      tools = tools.filter((tool) => tool.category === selectedCategory);
    }

    return tools;
  }, [searchQuery, selectedCategory, refreshKey]);

  /**
   * 获取分类列表（应包含所有可用分类，不受当前筛选影响）
   */
  const allCategories = useMemo(() => {
    const tools = toolboxService.getAvailableTools();
    const cats = new Set<string>();
    tools.forEach((tool) => {
      if (tool.category) {
        cats.add(tool.category);
      }
    });
    return Array.from(cats);
  }, [refreshKey]);

  /**
   * 按分类分组
   */
  const toolsByCategory = useMemo(() => {
    const categorized = toolboxService.getToolsByCategory();

    // 如果有搜索或分类过滤，使用过滤后的结果
    if (searchQuery || selectedCategory) {
      const result: Record<string, ToolDefinition[]> = {};
      filteredTools.forEach((tool) => {
        const category = tool.category || 'utilities';
        if (!result[category]) {
          result[category] = [];
        }
        result[category].push(tool);
      });
      return result;
    }

    return categorized;
  }, [filteredTools, searchQuery, selectedCategory]);

  /**
   * 获取分类列表
   */
  const categories = useMemo(() => {
    return Object.keys(toolsByCategory);
  }, [toolsByCategory]);

  /**
   * 处理添加自定义工具按钮点击
   */
  const handleAddCustomTool = useCallback(() => {
    setCustomToolDialogVisible(true);
  }, []);

  /**
   * 处理删除工具
   */
  const handleDeleteTool = useCallback(async (tool: ToolDefinition) => {
    const confirmed = await confirm({
      title: '确认删除',
      description: `确定要删除工具 "${tool.name}" 吗？此操作不可撤销。`,
      confirmText: '删除',
      cancelText: '取消',
      danger: true,
    });

    if (!confirmed) {
      return;
    }

    try {
      const removed = await toolboxService.removeCustomTool(tool.id);
      if (removed) {
        MessagePlugin.success('工具已删除');
        setRefreshKey((prev) => prev + 1);
      } else {
        MessagePlugin.warning('工具不存在或删除失败');
      }
    } catch (error) {
      console.error('Failed to delete tool:', error);
      MessagePlugin.error('删除工具失败，请重试');
    }
  }, []);

  /**
   * 处理添加成功
   */
  const handleCustomToolSaved = useCallback(() => {
    // 触发列表刷新
    setRefreshKey((prev) => prev + 1);
    // 清空搜索和分类过滤，显示所有工具
    setSearchQuery('');
    setSelectedCategory(null);
  }, []);

  /**
   * 处理对话框关闭
   */
  const handleDialogClose = useCallback(() => {
    setCustomToolDialogVisible(false);
  }, []);

  // Header actions
  const headerActions = (
    <Button
      variant="outline"
      size="small"
      icon={<AddIcon />}
      onClick={handleAddCustomTool}
      title="添加自定义工具"
      data-track="toolbox_click_add_custom_tool"
    >
      添加工具
    </Button>
  );

  // Filter section: search + category
  const filterSection = (
    <>
      <Input
        placeholder="搜索工具..."
        value={searchQuery}
        onChange={setSearchQuery}
        prefixIcon={<SearchIcon />}
        size="small"
        clearable
      />
      <div className="toolbox-drawer__categories">
        <Button
          variant={selectedCategory === null ? 'base' : 'outline'}
          size="small"
          onClick={() => setSelectedCategory(null)}
        >
          全部
        </Button>
        {allCategories.map((category) => (
          <Button
            key={category}
            variant={selectedCategory === category ? 'base' : 'outline'}
            size="small"
            onClick={() => setSelectedCategory(category)}
          >
            {TOOL_CATEGORY_LABELS[category] || category}
          </Button>
        ))}
      </div>
    </>
  );

  return (
    <>
      <BaseDrawer
        isOpen={isOpen}
        onClose={handleClose}
        title="工具箱"
        subtitle={`${filteredTools.length} 个工具`}
        headerActions={headerActions}
        filterSection={filterSection}
        position="toolbar-right"
        width="narrow"
        storageKey={TOOLBOX_DRAWER_WIDTH_KEY}
        resizable={true}
        className="toolbox-drawer"
        contentClassName="toolbox-drawer__content"
      >
        {filteredTools.length === 0 ? (
          <div className="toolbox-drawer__empty">
            <p>未找到匹配的工具</p>
          </div>
        ) : (
          <ToolList
            toolsByCategory={toolsByCategory}
            onToolInsert={handleToolInsert}
            onToolOpenWindow={handleToolOpenWindow}
            onToolDelete={handleDeleteTool}
          />
        )}
      </BaseDrawer>

      {/* Custom Tool Dialog */}
      {customToolDialogVisible && (
        <CustomToolDialog
          visible={customToolDialogVisible}
          onClose={handleDialogClose}
          onSuccess={handleCustomToolSaved}
        />
      )}
      {confirmDialog}
    </>
  );
};
