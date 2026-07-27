/**
 * BottomActionsSection Component
 *
 * 统一的底部工具区域,整合"打开项目"、"工具箱"和"任务队列"功能
 * 采用上下布局,视觉风格统一,使用标准的 ToolButton 组件
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Badge } from 'tdesign-react';
import { ToolButton } from '../tool-button';
import { useTaskQueue } from '../../hooks/useTaskQueue';
import type { Task } from '../../types/task.types';
import { FeedbackButton } from '../feedback-button/feedback-button';
import { FolderIcon, ToolboxIcon, TaskIcon } from '../icons';
import './bottom-actions-section.scss';

const FAILED_TASK_ACK_STORAGE_KEY = 'aitu-task-queue-failed-ack-at';

function readFailedTaskAckAt(): number {
  if (typeof window === 'undefined') {
    return 0;
  }

  try {
    const value = Number(
      window.localStorage.getItem(FAILED_TASK_ACK_STORAGE_KEY)
    );
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function writeFailedTaskAckAt(value: number): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(FAILED_TASK_ACK_STORAGE_KEY, String(value));
}

function getTaskSignalAt(task: Task): number {
  return task.completedAt || task.updatedAt || task.createdAt || 0;
}

export interface BottomActionsSectionProps {
  /** 项目抽屉是否打开 */
  projectDrawerOpen: boolean;
  /** 项目抽屉切换回调 */
  onProjectDrawerToggle: () => void;
  /** 工具箱抽屉是否打开 */
  toolboxDrawerOpen?: boolean;
  /** 工具箱抽屉切换回调 */
  onToolboxDrawerToggle?: () => void;
  /** 任务面板是否展开 */
  taskPanelExpanded: boolean;
  /** 任务面板切换回调 */
  onTaskPanelToggle: () => void;
}

export const BottomActionsSection: React.FC<BottomActionsSectionProps> = ({
  projectDrawerOpen,
  onProjectDrawerToggle,
  toolboxDrawerOpen = false,
  onToolboxDrawerToggle,
  taskPanelExpanded,
  onTaskPanelToggle,
}) => {
  const { activeTasks, completedTasks, failedTasks } = useTaskQueue();
  const [acknowledgedFailedAt, setAcknowledgedFailedAt] = useState(
    readFailedTaskAckAt
  );

  const latestFailedAt = useMemo(
    () =>
      failedTasks.reduce(
        (latest, task) => Math.max(latest, getTaskSignalAt(task)),
        0
      ),
    [failedTasks]
  );
  const hasUnseenFailedTasks = latestFailedAt > acknowledgedFailedAt;

  useEffect(() => {
    if (!taskPanelExpanded || latestFailedAt <= acknowledgedFailedAt) {
      return;
    }

    setAcknowledgedFailedAt(latestFailedAt);
    try {
      writeFailedTaskAckAt(latestFailedAt);
    } catch {
      // localStorage 不可用时，仅保留当前页面会话内的已读状态
    }
  }, [acknowledgedFailedAt, latestFailedAt, taskPanelExpanded]);

  // 准备任务提示内容
  const totalTasks = activeTasks.length + completedTasks.length + failedTasks.length;
  const taskTooltip = totalTasks > 0
    ? `任务队列 (生成中: ${activeTasks.length}, 已完成: ${completedTasks.length}, 失败: ${failedTasks.length})`
    : '任务队列 (暂无任务)';

  return (
    <div className="bottom-actions-section">
      {/* 反馈按钮 */}
      <FeedbackButton />

      {/* 打开项目按钮 - 使用 ToolButton */}
      <ToolButton
        type="icon"
        icon={<FolderIcon />}
        aria-label={projectDrawerOpen ? '关闭项目' : '打开项目'}
        tooltip={projectDrawerOpen ? '关闭项目' : '打开项目'}
        tooltipPlacement="right"
        selected={projectDrawerOpen}
        visible={true}
        data-track="toolbar_click_project_drawer"
        data-testid="toolbar-project"
        onPointerDown={(e) => {
          e.event.stopPropagation();
        }}
        onClick={onProjectDrawerToggle}
      />

      {/* 工具箱按钮 */}
      {onToolboxDrawerToggle && (
        <ToolButton
          type="icon"
          icon={<ToolboxIcon />}
          aria-label={toolboxDrawerOpen ? '关闭工具箱' : '打开工具箱'}
          tooltip={toolboxDrawerOpen ? '关闭工具箱' : '打开工具箱'}
          tooltipPlacement="right"
          selected={toolboxDrawerOpen}
          visible={true}
          data-track="toolbar_click_toolbox"
          data-testid="toolbar-toolbox"
          onPointerDown={(e) => {
            e.event.stopPropagation();
          }}
          onClick={onToolboxDrawerToggle}
        />
      )}

      {/* 任务队列按钮 - 使用 ToolButton + Badge */}
      <div className="bottom-actions-section__task-wrapper">
        <Badge
          count={activeTasks.length > 0 ? activeTasks.length : 0}
          showZero={false}
          offset={[6, -6]}
        >
          <ToolButton
            type="icon"
            icon={<TaskIcon />}
            aria-label="任务队列"
            tooltip={taskTooltip}
            tooltipPlacement="right"
            selected={taskPanelExpanded}
            visible={true}
            data-track="toolbar_click_tasks"
            data-testid="toolbar-tasks"
            onPointerDown={(e) => {
              e.event.stopPropagation();
            }}
            onClick={onTaskPanelToggle}
          />
        </Badge>

        {/* 状态指示点 */}
        {activeTasks.length > 0 && (
          <div className="bottom-actions-section__status bottom-actions-section__status--active" />
        )}
        {hasUnseenFailedTasks && activeTasks.length === 0 && (
          <div className="bottom-actions-section__status bottom-actions-section__status--failed" />
        )}
      </div>
    </div>
  );
};
