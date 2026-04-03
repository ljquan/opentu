/**
 * 工作流可视化展示组件
 * 
 * 在 ChatDrawer 中展示工作流执行过程
 */

import React, { useState, useCallback, useMemo } from 'react';
import type { WorkflowDefinition, WorkflowStep } from '../ai-input-bar/workflow-converter';
import { getWorkflowStatus } from '../ai-input-bar/workflow-converter';
import './workflow-display.scss';

// ============ 状态图标映射 ============

const STATUS_ICONS: Record<WorkflowStep['status'], string> = {
  pending: '○',
  running: '◉',
  completed: '✓',
  failed: '✗',
  skipped: '⊘',
};

const STATUS_LABELS: Record<WorkflowStep['status'], string> = {
  pending: '待执行',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  skipped: '已跳过',
};

function getGenerationIcon(type: WorkflowDefinition['generationType']): string {
  switch (type) {
    case 'image':
      return '🖼️';
    case 'video':
      return '🎬';
    case 'audio':
      return '🎵';
    default:
      return '📝';
  }
}

// ============ 单个步骤项组件 ============

interface StepItemProps {
  step: WorkflowStep;
  index: number;
  isCurrentStep: boolean;
}

const StepItem: React.FC<StepItemProps> = ({
  step,
  index,
  isCurrentStep,
}) => {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = STATUS_ICONS[step.status];
  const statusLabel = STATUS_LABELS[step.status];
  const hasResult = step.result !== undefined && step.result !== null;
  const hasExpandableDetails =
    hasResult || !!step.error || typeof step.duration === 'number';

  return (
    <div
      className={`workflow-display-item workflow-status-${step.status} ${isCurrentStep ? 'workflow-current' : ''}`}
    >
      <div className="workflow-display-item-main" onClick={() => setExpanded(!expanded)}>
        <div className="workflow-display-item-index">{index + 1}</div>
        <div className={`workflow-display-item-status workflow-status-${step.status}`}>
          {step.status === 'running' ? (
            <span className="workflow-display-spinner" />
          ) : (
            statusIcon
          )}
        </div>
        <div className="workflow-display-item-content">
          <div className="workflow-display-item-title">{step.description}</div>
          <div className="workflow-display-item-status-text">{statusLabel}</div>
        </div>
        {hasExpandableDetails && (
          <div className={`workflow-display-item-expand ${expanded ? 'expanded' : ''}`}>▼</div>
        )}
      </div>

      {expanded && hasExpandableDetails && (
        <div className="workflow-display-item-details">
          {/* 工具名称 */}
          <div className="workflow-display-item-tool">
            <span className="workflow-display-label">工具:</span>
            <code className="workflow-display-tool-name">{step.mcp}</code>
          </div>

          {/* 执行时间 */}
          {typeof step.duration === 'number' && (
            <div className="workflow-display-item-duration">
              <span className="workflow-display-label">耗时:</span>
              <span>{step.duration}ms</span>
            </div>
          )}

          {/* 执行结果 */}
          {hasResult && (
            <div className="workflow-display-item-result">
              <span className="workflow-display-label">执行结果:</span>
              <div className="workflow-display-result-content">
                {typeof step.result === 'string'
                  ? step.result
                  : String(JSON.stringify(step.result, null, 2))}
              </div>
            </div>
          )}

          {/* 错误信息 */}
          {step.error && (
            <div className="workflow-display-item-error">
              <span className="workflow-display-label">错误信息:</span>
              <div className="workflow-display-error-content">{step.error}</div>
            </div>
          )}

          {/* 参数详情 */}
          {Object.keys(step.args).length > 0 && (
            <div className="workflow-display-item-args">
              <span className="workflow-display-label">参数:</span>
              <pre className="workflow-display-args-content">
                {JSON.stringify(step.args, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ============ 工作流展示组件 ============

interface WorkflowDisplayProps {
  workflow: WorkflowDefinition;
  onCancel?: () => void;
  onRetry?: (stepId: string) => void;
  className?: string;
}

export const WorkflowDisplay: React.FC<WorkflowDisplayProps> = ({
  workflow,
  onCancel,
  onRetry,
  className = '',
}) => {
  const workflowStatus = useMemo(() => getWorkflowStatus(workflow), [workflow]);

  // 计算进度
  const progress = workflow.steps.length > 0 
    ? (workflowStatus.completedSteps / workflowStatus.totalSteps) * 100 
    : 0;

  // 状态标签
  const statusLabels: Record<typeof workflowStatus.status, string> = {
    pending: '待开始',
    running: '执行中',
    completed: '已完成',
    failed: '执行失败',
  };

  const isRunning = workflowStatus.status === 'running';
  const isFailed = workflowStatus.status === 'failed';
  const isCompleted = workflowStatus.status === 'completed';

  // 获取当前执行步骤的索引
  const currentStepIndex = useMemo(() => {
    return workflow.steps.findIndex(s => s.status === 'running');
  }, [workflow.steps]);

  return (
    <div className={`workflow-display ${className}`}>
      {/* 头部 */}
      <div className="workflow-display-header">
        <div className="workflow-display-header-left">
          <span className="workflow-display-icon">
            {getGenerationIcon(workflow.generationType)}
          </span>
          <span className="workflow-display-title">{workflow.name}</span>
        </div>
        <div className="workflow-display-header-right">
          <span className={`workflow-display-status workflow-status-${workflowStatus.status}`}>
            {statusLabels[workflowStatus.status]}
          </span>
          <span className="workflow-display-progress-text">
            {workflowStatus.completedSteps}/{workflowStatus.totalSteps}
          </span>
        </div>
      </div>

      {/* 进度条 */}
      <div className="workflow-display-progress">
        <div
          className={`workflow-display-progress-bar workflow-status-${workflowStatus.status}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* 原始请求 */}
      <div className="workflow-display-original">
        <span className="workflow-display-label">请求:</span>
        <span className="workflow-display-original-text">
          {workflow.metadata.prompt.length > 100 
            ? `${workflow.metadata.prompt.substring(0, 100)}...` 
            : workflow.metadata.prompt}
        </span>
      </div>

      {/* 步骤列表 */}
      <div className="workflow-display-steps">
        {workflow.steps.map((step, index) => (
          <StepItem
            key={step.id}
            step={step}
            index={index}
            isCurrentStep={index === currentStepIndex && isRunning}
          />
        ))}
      </div>

      {/* 控制按钮 */}
      {(isRunning || isFailed) && (
        <div className="workflow-display-controls">
          {isRunning && onCancel && (
            <button
              className="workflow-display-btn workflow-display-btn-cancel"
              onClick={onCancel}
            >
              ✕ 取消
            </button>
          )}
          {isFailed && onRetry && (
            <button
              className="workflow-display-btn workflow-display-btn-retry"
              onClick={() => {
                const failedStep = workflow.steps.find(s => s.status === 'failed');
                if (failedStep) {
                  onRetry(failedStep.id);
                }
              }}
            >
              🔄 重试
            </button>
          )}
        </div>
      )}

      {/* 完成摘要 */}
      {isCompleted && (
        <div className="workflow-display-summary">
          <div className="workflow-display-summary-header">
            <span className="workflow-display-summary-icon">✨</span>
            <span className="workflow-display-summary-title">执行完成</span>
          </div>
          <div className="workflow-display-summary-content">
            {workflow.generationType === 'image'
              ? `成功生成 ${workflow.metadata.count} 张图片`
              : workflow.generationType === 'video'
              ? `成功生成 ${workflow.metadata.count} 个视频`
              : `成功提交 ${workflow.metadata.count} 个音频生成任务`}
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkflowDisplay;
