/**
 * MinimizedToolsBar Component
 *
 * 显示最小化的工具图标和常驻工具图标
 * 位于左侧工具栏底部，工具箱按钮下方
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Dropdown, DropdownOption } from 'tdesign-react';
import { ToolButton } from '../../tool-button';
import { toolWindowService } from '../../../services/tool-window-service';
import { toolboxService } from '../../../services/toolbox-service';
import { ToolDefinition, ToolWindowState } from '../../../types/toolbox.types';
import { useI18n } from '../../../i18n';
import classNames from 'classnames';
import './minimized-tools-bar.scss';

/**
 * 渲染图标组件，支持字符串和 React 组件
 */
const renderIcon = (icon: unknown, size = 20): React.ReactNode => {
  if (!icon) {
    return (
      <span role="img" aria-label="tool" style={{ fontSize: size }}>
        🔧
      </span>
    );
  }
  if (typeof icon === 'function') {
    const IconComponent = icon as React.ComponentType<{ size?: number }>;
    return <IconComponent size={size} />;
  }
  if (typeof icon === 'string') {
    return <span style={{ fontSize: size }}>{icon}</span>;
  }
  return React.isValidElement(icon) ? icon : null;
};

/**
 * 最小化工具栏组件
 */
export const MinimizedToolsBar: React.FC = () => {
  const [toolbarTools, setToolbarTools] = useState<ToolWindowState[]>([]);
  const [contextMenuOpenId, setContextMenuOpenId] = useState<string | null>(null);
  const { language, t } = useI18n();

  const displayMetaByInstanceId = useMemo(() => {
    const counts = new Map<string, number>();
    const counters = new Map<string, number>();

    toolbarTools.forEach((state) => {
      if (state.isLauncher) {
        return;
      }
      counts.set(state.toolId, (counts.get(state.toolId) || 0) + 1);
    });

    const result = new Map<string, { displayIndex: number; showBadge: boolean }>();
    toolbarTools.forEach((state) => {
      if (state.isLauncher) {
        return;
      }
      const displayIndex = (counters.get(state.toolId) || 0) + 1;
      counters.set(state.toolId, displayIndex);
      result.set(state.instanceId, {
        displayIndex,
        showBadge: (counts.get(state.toolId) || 0) > 1,
      });
    });

    return result;
  }, [toolbarTools]);

  useEffect(() => {
    const subscription = toolWindowService.observeToolStates().subscribe(() => {
      // 获取需要在工具栏显示的工具
      setToolbarTools(toolWindowService.getToolbarTools());
    });

    // 初始化
    setToolbarTools(toolWindowService.getToolbarTools());

    return () => subscription.unsubscribe();
  }, []);

  /**
   * 处理工具图标点击
   */
  const handleToolClick = useCallback((state: ToolWindowState, tool: ToolDefinition) => {
    if (state.isLauncher || state.status === 'closed') {
      const fullTool = toolboxService.getToolById(tool.id);
      if (fullTool) {
        toolWindowService.openTool(fullTool);
      } else {
        console.warn('[MinimizedToolsBar] Tool not found:', tool.id);
      }
    } else {
      toolWindowService.toggleToolVisibility(state.instanceId);
    }
  }, []);

  /**
   * 处理右键菜单操作
   */
  const handleContextMenuAction = useCallback((
    state: ToolWindowState,
    tool: ToolDefinition,
    action: 'toggle-pin' | 'close' | 'new-window'
  ) => {
    switch (action) {
      case 'toggle-pin': {
        const isPinned = toolWindowService.isPinned(state.toolId);
        toolWindowService.setPinned(state.toolId, !isPinned);
        break;
      }
      case 'close':
        toolWindowService.closeTool(state.instanceId);
        break;
      case 'new-window':
        toolWindowService.openNewToolInstance(tool);
        break;
    }
  }, []);

  /**
   * 生成右键菜单选项
   */
  const getContextMenuOptions = useCallback((
    state: ToolWindowState,
    tool: ToolDefinition
  ): DropdownOption[] => {
    const isPinned = state.isPinned;
    const options: DropdownOption[] = [
      ...(toolWindowService.canOpenMultiple(tool) ? [{
        content: t('toolbar.openNewWindow'),
        value: 'new-window',
      } as DropdownOption] : []),
      {
        content: isPinned 
          ? (language === 'zh' ? '取消常驻' : 'Unpin from toolbar')
          : (language === 'zh' ? '常驻工具栏' : 'Pin to toolbar'),
        value: 'toggle-pin',
      },
    ];

    if (!state.isLauncher) {
      options.push({
        content: language === 'zh' ? '关闭' : 'Close',
        value: 'close',
        theme: 'error' as const,
      });
    }

    return options;
  }, [language, t]);

  if (toolbarTools.length === 0) {
    return null;
  }

  return (
    <div className="minimized-tools-bar">
      {toolbarTools.map(state => {
        const { tool } = state;
        // 尝试从 toolboxService 获取完整的工具定义（包括 icon）
        const fullTool = toolboxService.getToolById(tool.id) || tool;
        const displayMeta = displayMetaByInstanceId.get(state.instanceId);
        const title = state.isLauncher || !displayMeta?.showBadge
          ? fullTool.name
          : `${fullTool.name} #${displayMeta.displayIndex}`;
        
        return (
          <Dropdown
            key={state.instanceId}
            options={getContextMenuOptions(state, fullTool)}
            trigger="context-menu"
            popupProps={{
              onVisibleChange: (visible) => {
                setContextMenuOpenId(visible ? state.instanceId : null);
              }
            }}
            onClick={(data) => {
              handleContextMenuAction(
                state,
                fullTool,
                data.value as 'toggle-pin' | 'close' | 'new-window'
              );
            }}
          >
            <div 
              className="minimized-tools-bar__item"
              data-minimize-target={state.instanceId}
              onClick={(e) => {
                // 只响应左键
                if (e.button === 0) {
                  e.stopPropagation();
                  handleToolClick(state, fullTool);
                }
              }}
            >
              <ToolButton
                type="icon"
                visible={true}
                selected={state.status === 'open'}
                icon={renderIcon(fullTool.icon)}
                title={contextMenuOpenId === state.instanceId ? undefined : title}
                aria-label={title}
                data-track="toolbar_click_minimized_tool"
                data-tool-id={fullTool.id}
              />
              {!state.isLauncher && displayMeta?.showBadge && (
                <span className="minimized-tools-bar__badge" aria-hidden="true">
                  {displayMeta.displayIndex}
                </span>
              )}
              {state.status !== 'closed' && (
                <div 
                  className={classNames('minimized-tools-bar__indicator', {
                    'minimized-tools-bar__indicator--active': state.status === 'open'
                  })} 
                />
              )}
            </div>
          </Dropdown>
        );
      })}
    </div>
  );
};

export default MinimizedToolsBar;
