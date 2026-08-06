/**
 * 工作流消息气泡组件
 *
 * 在对话消息中展示工作流执行过程
 */

import React, {
  Suspense,
  lazy,
  useState,
  useMemo,
  useRef,
  useEffect,
} from 'react';
import type {
  WorkflowMessageData,
  AgentLogEntry,
} from '../../types/chat.types';
import { MediaViewer } from '../shared/MediaViewer';
import { useMediaViewer } from '../../hooks/useMediaViewer';
import MarkdownReadonly from '../MarkdownReadonly';
import {
  getWorkflowBubbleStatus,
  normalizeWorkflowStepsForDisplay,
} from '../../utils/workflow-bubble-status';
import { collectWorkflowMediaResults } from './workflow-media-results';
import './workflow-message-bubble.scss';

const MermaidRenderer = lazy(() =>
  import('./MermaidRenderer').then((module) => ({
    default: module.MermaidRenderer,
  }))
);

// ============ 状态图标映射 ============

type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

const STATUS_ICONS: Record<StepStatus, string> = {
  pending: '○',
  running: '◉',
  completed: '✓',
  failed: '✗',
  skipped: '⊘',
};

const STATUS_LABELS: Record<StepStatus, string> = {
  pending: '待执行',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  skipped: '已跳过',
};

const WORKFLOW_STATUS_LABELS = {
  pending: '待开始',
  running: '执行中',
  completed: '已完成',
  failed: '执行失败',
} as const;

function renderWorkflowCodeBlock(
  code: string,
  language: string,
  key: string
): React.ReactNode | undefined {
  if (language !== 'mermaid') {
    return undefined;
  }

  return (
    <Suspense key={key} fallback={null}>
      <MermaidRenderer code={code.trim()} className="chat-markdown__mermaid" />
    </Suspense>
  );
}

function renderMarkdownWithMermaid(markdown: string): React.ReactNode {
  return (
    <MarkdownReadonly
      markdown={markdown}
      className="chat-markdown"
      renderCodeBlock={renderWorkflowCodeBlock}
    />
  );
}

// ============ 单个步骤项组件 ============

interface StepItemProps {
  step: WorkflowMessageData['steps'][0];
  index: number;
  isCurrentStep: boolean;
}

const StepItem: React.FC<StepItemProps> = ({ step, index, isCurrentStep }) => {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = STATUS_ICONS[step.status];
  const statusLabel = STATUS_LABELS[step.status];
  // 步骤有详情的条件：有参数、有结果、有错误、有耗时
  const hasArgs: boolean = Object.keys(step.args).length > 0;
  const hasResult = step.result !== undefined && step.result !== null;
  const hasDetails =
    hasArgs || hasResult || Boolean(step.error) || step.duration !== undefined;

  // 格式化显示参数，排除 context 等大对象
  const formatArgs = (args: Record<string, unknown> | undefined) => {
    if (!args) return null;
    const filteredArgs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      // 排除 context 等大对象，只显示关键参数
      if (key === 'context') {
        filteredArgs[key] = '[AgentExecutionContext]';
      } else if (typeof value === 'string' && value.length > 200) {
        filteredArgs[key] = value.substring(0, 200) + '...';
      } else {
        filteredArgs[key] = value;
      }
    }
    return filteredArgs;
  };

  const argsText = useMemo(() => {
    if (!hasArgs) return '';
    return JSON.stringify(formatArgs(step.args), null, 2) || '';
  }, [hasArgs, step.args]);

  return (
    <div
      className={`workflow-bubble-step workflow-bubble-step--${step.status} ${
        isCurrentStep ? 'workflow-bubble-step--current' : ''
      }`}
    >
      <div
        className="workflow-bubble-step__main"
        onClick={() => hasDetails && setExpanded(!expanded)}
        style={{ cursor: hasDetails ? 'pointer' : 'default' }}
      >
        <div className="workflow-bubble-step__index">{index + 1}</div>
        <div
          className={`workflow-bubble-step__status workflow-bubble-step__status--${step.status}`}
        >
          {step.status === 'running' ? (
            <span className="workflow-bubble-step__spinner" />
          ) : (
            statusIcon
          )}
        </div>
        <div className="workflow-bubble-step__content">
          <div className="workflow-bubble-step__title">{step.description}</div>
          <div className="workflow-bubble-step__status-text">{statusLabel}</div>
        </div>
        {hasDetails && (
          <div
            className={`workflow-bubble-step__expand ${
              expanded ? 'workflow-bubble-step__expand--open' : ''
            }`}
          >
            ▼
          </div>
        )}
      </div>

      {expanded && hasDetails && (
        <div className="workflow-bubble-step__details">
          {/* 工具名称 */}
          <div className="workflow-bubble-step__detail-row">
            <span className="workflow-bubble-step__label">工具:</span>
            <code className="workflow-bubble-step__tool">{step.mcp}</code>
          </div>

          {/* 输入参数 */}
          {hasArgs ? (
            <div className="workflow-bubble-step__detail-row workflow-bubble-step__detail-row--block">
              <span className="workflow-bubble-step__label">输入参数:</span>
              <pre className="workflow-bubble-step__args">{argsText}</pre>
            </div>
          ) : null}

          {/* 执行时间 */}
          {step.duration !== undefined && (
            <div className="workflow-bubble-step__detail-row">
              <span className="workflow-bubble-step__label">耗时:</span>
              <span>{step.duration}ms</span>
            </div>
          )}

          {/* 执行结果 */}
          {hasResult ? (
            <div className="workflow-bubble-step__detail-row workflow-bubble-step__detail-row--block">
              <span className="workflow-bubble-step__label">执行结果:</span>
              <div className="workflow-bubble-step__result">
                {typeof step.result === 'string'
                  ? step.result
                  : String(JSON.stringify(step.result, null, 2))}
              </div>
            </div>
          ) : null}

          {/* 错误信息 */}
          {step.error && (
            <div className="workflow-bubble-step__detail-row workflow-bubble-step__detail-row--block">
              <span className="workflow-bubble-step__label">错误信息:</span>
              <div className="workflow-bubble-step__error">{step.error}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ============ Agent 日志项组件 ============

interface AgentLogItemProps {
  log: AgentLogEntry;
}

const AgentLogItem: React.FC<AgentLogItemProps> = ({ log }) => {
  const [expanded, setExpanded] = useState(false);

  if (log.type === 'thinking') {
    // AI 思考内容
    const content = log.content;
    const isLong = content.length > 200;
    const displayContent = expanded ? content : content.substring(0, 200);

    return (
      <div className="agent-log agent-log--thinking">
        <div className="agent-log__header">
          <span className="agent-log__icon" role="img" aria-label="思考">
            💭
          </span>
          <span className="agent-log__title">AI 分析</span>
        </div>
        <div className="agent-log__content">
          <pre className="agent-log__thinking-text">
            {displayContent}
            {isLong && !expanded && '...'}
          </pre>
          {isLong && (
            <button
              className="agent-log__toggle"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? '收起' : '展开全部'}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (log.type === 'tool_call') {
    return (
      <div className="agent-log agent-log--tool-call">
        <div
          className="agent-log__header agent-log__header--clickable"
          onClick={() => setExpanded(!expanded)}
        >
          <span className="agent-log__icon" role="img" aria-label="工具">
            🔧
          </span>
          <span className="agent-log__title">调用工具: {log.toolName}</span>
          <span
            className={`agent-log__expand ${
              expanded ? 'agent-log__expand--open' : ''
            }`}
          >
            ▼
          </span>
        </div>
        {expanded && (
          <div className="agent-log__content">
            <pre className="agent-log__args">
              {JSON.stringify(log.args, null, 2)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  if (log.type === 'tool_result') {
    const statusClass = log.success ? 'success' : 'error';
    const statusIcon = log.success ? '✅' : '❌';
    const statusIconLabel = log.success ? '成功' : '失败';
    const hasData = log.data !== undefined && log.data !== null;

    return (
      <div
        className={`agent-log agent-log--tool-result agent-log--${statusClass}`}
      >
        <div
          className="agent-log__header agent-log__header--clickable"
          onClick={() => setExpanded(!expanded)}
        >
          <span
            className="agent-log__icon"
            role="img"
            aria-label={statusIconLabel}
          >
            {statusIcon}
          </span>
          <span className="agent-log__title">
            {log.toolName} {log.success ? '执行成功' : '执行失败'}
          </span>
          <span
            className={`agent-log__expand ${
              expanded ? 'agent-log__expand--open' : ''
            }`}
          >
            ▼
          </span>
        </div>
        {expanded && (
          <div className="agent-log__content">
            {log.error && <div className="agent-log__error">{log.error}</div>}
            {hasData && (
              <pre className="agent-log__data">
                {typeof log.data === 'string'
                  ? log.data
                  : String(JSON.stringify(log.data, null, 2))}
              </pre>
            )}
          </div>
        )}
      </div>
    );
  }

  if (log.type === 'retry') {
    return (
      <div className="agent-log agent-log--retry">
        <div className="agent-log__header">
          <span className="agent-log__icon" role="img" aria-label="重试">
            🔄
          </span>
          <span className="agent-log__title">
            重试 #{log.attempt}: {log.reason}
          </span>
        </div>
      </div>
    );
  }

  return null;
};

// ============ 工作流消息气泡组件 ============

interface WorkflowMessageBubbleProps {
  workflow: WorkflowMessageData;
  className?: string;
  /** 重试回调，从指定步骤索引开始重试 */
  onRetry?: (stepIndex: number) => void;
  /** 基于该工作流结果继续生成 */
  onReply?: () => void;
  /** 是否正在重试 */
  isRetrying?: boolean;
}

export const WorkflowMessageBubble: React.FC<WorkflowMessageBubbleProps> = ({
  workflow,
  className = '',
  onRetry,
  onReply,
  isRetrying = false,
}) => {
  const normalizedSteps = useMemo(() => {
    return normalizeWorkflowStepsForDisplay(workflow.steps);
  }, [workflow.steps]);

  // 计算工作流状态。图片生成以任务队列完成为准，画布插入不再阻塞抽屉收口。
  const workflowStatus = useMemo(() => {
    return getWorkflowBubbleStatus(normalizedSteps);
  }, [normalizedSteps]);

  // 计算进度
  const progress =
    workflowStatus.totalSteps > 0
      ? (workflowStatus.completedSteps / workflowStatus.totalSteps) * 100
      : 0;

  // 状态标签（考虑后处理状态）
  const statusLabel = WORKFLOW_STATUS_LABELS[workflowStatus.status];

  const isCompleted = workflowStatus.status === 'completed';
  const isFailed = workflowStatus.status === 'failed';
  const isRunning = workflowStatus.status === 'running';
  const { openViewer, viewerProps } = useMediaViewer({
    showNavbar: true,
    showToolbar: true,
    showTitle: true,
  });
  const mediaResults = useMemo(
    () => collectWorkflowMediaResults(workflow, normalizedSteps),
    [workflow, normalizedSteps]
  );
  const mediaViewerItems = useMemo(
    () =>
      mediaResults.map((item, index) => ({
        url: item.url,
        type: item.type,
        title: item.title || `生成结果 ${index + 1}`,
        alt: item.title || `生成结果 ${index + 1}`,
        posterUrl: item.thumbnailUrl,
      })),
    [mediaResults]
  );

  const handleMediaPreview = (index: number): void => {
    openViewer(mediaViewerItems, index);
  };

  /**
   * 获取工作流最后一个 content
   * 优先取最后一个步骤的 result.content，没有则取 workflow.aiAnalysis
   */
  const lastContent = useMemo(() => {
    if (!isCompleted) return '';

    // 从后往前遍历步骤，找到最后一个有 content 的结果
    for (let i = normalizedSteps.length - 1; i >= 0; i -= 1) {
      const result = normalizedSteps[i]?.result;
      if (!result) continue;

      // 字符串直接返回
      if (typeof result === 'string') {
        const text = result.trim();
        if (text) return text;
        continue;
      }

      // 对象类型，取 content 或 response 字段
      if (typeof result === 'object' && result !== null) {
        const res = result as {
          response?: unknown;
          content?: unknown;
          data?: { content?: unknown; response?: unknown };
        };
        // 优先取 data.content（ai_analyze 格式），再取顶层 content/response
        const text = (res.data?.content ||
          res.data?.response ||
          res.content ||
          res.response) as string;
        if (typeof text === 'string') {
          const trimmed = text.trim();
          if (trimmed) return trimmed;
        }
      }
    }

    // 没有步骤返回 content，使用 workflow.aiAnalysis
    return workflow.aiAnalysis || '';
  }, [isCompleted, normalizedSteps, workflow.aiAnalysis]);

  // 检查是否有媒体生成步骤（图片/视频）
  const hasMediaGeneration = useMemo(() => {
    const mediaGenerationMcps = [
      'generate_image',
      'generate_video',
      'generate_audio',
      'generate_grid_image',
      'generate_inspiration_board',
      'generate_long_video',
    ];
    return normalizedSteps.some((step) =>
      mediaGenerationMcps.includes(step.mcp || '')
    );
  }, [normalizedSteps]);

  const summaryView = useMemo(() => {
    if (!isCompleted && !isFailed) return null;

    // 失败状态
    if (isFailed) {
      return { variant: 'info' as const, icon: '❌', text: '生成失败' };
    }

    if (mediaResults.length > 0) {
      return null;
    }

    // 直接展示最后一个 content
    if (lastContent) {
      return {
        variant: 'markdown' as const,
        icon: '✨',
        markdown: lastContent,
      };
    }

    // 媒体生成场景，成功但没有 content 返回
    if (hasMediaGeneration) {
      return null;
    }

    // 没有任何内容
    return { variant: 'info' as const, icon: 'ℹ️', text: '未生成任何内容' };
  }, [isCompleted, isFailed, lastContent, hasMediaGeneration, mediaResults]);

  const markdownSummary = useMemo(() => {
    if (!summaryView || summaryView.variant !== 'markdown') return null;
    return summaryView.markdown;
  }, [summaryView]);

  // 获取当前执行步骤的索引
  const currentStepIndex = useMemo(() => {
    return normalizedSteps.findIndex((s) => s.status === 'running');
  }, [normalizedSteps]);

  // 获取第一个失败步骤的索引
  const firstFailedStepIndex = useMemo(() => {
    return normalizedSteps.findIndex((s) => s.status === 'failed');
  }, [normalizedSteps]);

  const shouldCollapseCompletedDetails = isCompleted && hasMediaGeneration;
  const hasDetailsContent =
    normalizedSteps.length > 0 || Boolean(workflow.logs?.length);
  const [showCompletedDetails, setShowCompletedDetails] = useState(false);
  const previousWorkflowIdRef = useRef(workflow.id);

  useEffect(() => {
    if (previousWorkflowIdRef.current !== workflow.id) {
      previousWorkflowIdRef.current = workflow.id;
      setShowCompletedDetails(false);
      return;
    }

    if (shouldCollapseCompletedDetails) {
      setShowCompletedDetails(false);
    }
  }, [shouldCollapseCompletedDetails, workflow.id]);

  const shouldShowDetails =
    !shouldCollapseCompletedDetails || showCompletedDetails;
  const shouldShowDetailsToggle =
    shouldCollapseCompletedDetails && hasDetailsContent;

  const bubbleRef = useRef<HTMLDivElement>(null);

  // 当步骤状态变化时，自动滚动到当前执行的步骤
  useEffect(() => {
    // 只在运行中时自动滚动
    if (!isRunning) return;

    // 使用 requestAnimationFrame 确保 DOM 更新后再滚动
    requestAnimationFrame(() => {
      if (bubbleRef.current) {
        // 滚动整个 bubble 到视口中
        bubbleRef.current.scrollIntoView({
          behavior: 'smooth',
          block: 'end', // 滚动到底部，确保最新步骤可见
        });
      }
    });
  }, [currentStepIndex, isRunning, normalizedSteps.length]);

  // 检查是否可以重试（有重试上下文且有失败步骤）
  const canRetry =
    isFailed && workflow.retryContext && firstFailedStepIndex >= 0;

  // 处理重试点击
  const handleRetry = () => {
    if (onRetry && firstFailedStepIndex >= 0) {
      onRetry(firstFailedStepIndex);
    }
  };

  return (
    <div
      ref={bubbleRef}
      className={`workflow-bubble chat-message chat-message--assistant ${className}`}
    >
      <div className="chat-message-avatar">
        <span>
          {workflow.generationType === 'image'
            ? '🖼️'
            : workflow.generationType === 'video'
            ? '🎬'
            : workflow.generationType === 'audio'
            ? '🎵'
            : '📝'}
        </span>
      </div>
      <div className="workflow-bubble__content chat-message-content">
        {/* 头部 */}
        <div className="workflow-bubble__header">
          <span className="workflow-bubble__title">{workflow.name}</span>
          <div className="workflow-bubble__status-info">
            <span
              className={`workflow-bubble__status workflow-bubble__status--${workflowStatus.status}`}
            >
              {statusLabel}
            </span>
            <span className="workflow-bubble__progress-text">
              {workflowStatus.completedSteps}/{workflowStatus.totalSteps}
            </span>
          </div>
        </div>

        {/* 进度条 */}
        <div className="workflow-bubble__progress">
          <div
            className={`workflow-bubble__progress-bar workflow-bubble__progress-bar--${workflowStatus.status}`}
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* 原始请求 */}
        {workflow.prompt && (
          <div className="workflow-bubble__prompt">
            <span className="workflow-bubble__label">请求:</span>
            <span className="workflow-bubble__prompt-text">
              {workflow.prompt.length > 100
                ? `${workflow.prompt.substring(0, 100)}...`
                : workflow.prompt}
            </span>
          </div>
        )}

        {isCompleted && mediaResults.length > 0 && (
          <div
            className={`workflow-bubble__media-grid workflow-bubble__media-grid--${Math.min(
              mediaResults.length,
              4
            )}`}
            aria-label="生成结果"
          >
            {mediaResults.map((item, index) => (
              <button
                key={`${item.url}-${index}`}
                type="button"
                className="workflow-bubble__media-item"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  handleMediaPreview(index);
                }}
                aria-label={`查看生成结果 ${index + 1}`}
              >
                {item.type === 'video' ? (
                  <video
                    className="workflow-bubble__media-preview"
                    src={item.url}
                    poster={item.thumbnailUrl}
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : item.type === 'audio' ? (
                  <div className="workflow-bubble__audio-preview">
                    {item.thumbnailUrl ? (
                      <img
                        src={item.thumbnailUrl}
                        alt={item.title || `生成结果 ${index + 1}`}
                        className="workflow-bubble__media-preview"
                        loading="lazy"
                      />
                    ) : (
                      <span className="workflow-bubble__audio-icon">♪</span>
                    )}
                  </div>
                ) : (
                  <img
                    src={item.thumbnailUrl || item.url}
                    alt={item.title || `生成结果 ${index + 1}`}
                    className="workflow-bubble__media-preview"
                    loading="lazy"
                  />
                )}
              </button>
            ))}
          </div>
        )}

        {shouldShowDetailsToggle && (
          <div className="workflow-bubble__actions">
            <button
              type="button"
              className="workflow-bubble__details-toggle"
              onClick={() => setShowCompletedDetails((value) => !value)}
              aria-expanded={showCompletedDetails}
              aria-label={
                showCompletedDetails ? '收起执行详情' : '查看执行详情'
              }
            >
              <span>{showCompletedDetails ? '收起详情' : '查看详情'}</span>
              <span
                className={`workflow-bubble__details-toggle-icon ${
                  showCompletedDetails
                    ? 'workflow-bubble__details-toggle-icon--open'
                    : ''
                }`}
                aria-hidden="true"
              >
                ▼
              </span>
            </button>
            {onReply && mediaResults.length > 0 && (
              <button
                type="button"
                className="workflow-bubble__reply-btn"
                onClick={onReply}
              >
                回复
              </button>
            )}
          </div>
        )}

        {/* 步骤列表 */}
        {shouldShowDetails && (
          <div className="workflow-bubble__steps">
            {normalizedSteps.map((step, index) => (
              <StepItem
                key={step.id}
                step={step}
                index={index}
                isCurrentStep={index === currentStepIndex && isRunning}
              />
            ))}
          </div>
        )}

        {/* Agent 执行日志 */}
        {shouldShowDetails && workflow.logs && workflow.logs.length > 0 && (
          <div className="workflow-bubble__logs">
            <div className="workflow-bubble__logs-header">
              <span className="workflow-bubble__logs-title">执行详情</span>
            </div>
            <div className="workflow-bubble__logs-list">
              {workflow.logs.map((log, index) => (
                <AgentLogItem key={`log-${index}-${log.timestamp}`} log={log} />
              ))}
            </div>
          </div>
        )}

        {/* 完成摘要 */}
        {summaryView && summaryView.variant !== 'markdown' && (
          <div
            className={`workflow-bubble__summary workflow-bubble__summary--${summaryView.variant}`}
          >
            <span className="workflow-bubble__summary-icon">
              {summaryView.icon}
            </span>
            <span>{summaryView.text}</span>
          </div>
        )}

        {summaryView &&
          summaryView.variant === 'markdown' &&
          markdownSummary && (
            <div className="workflow-bubble__summary workflow-bubble__summary--success workflow-bubble__summary--markdown">
              <span className="workflow-bubble__summary-icon">
                {summaryView.icon}
              </span>
              <div className="workflow-bubble__summary-markdown">
                <div className="workflow-bubble__markdown-message">
                  <div className="workflow-bubble__markdown-content">
                    {renderMarkdownWithMermaid(markdownSummary)}
                  </div>
                </div>
              </div>
            </div>
          )}

        {/* 失败提示 */}
        {isFailed && (
          <div className="workflow-bubble__summary workflow-bubble__summary--error">
            <span
              className="workflow-bubble__summary-icon"
              role="img"
              aria-label="失败"
            >
              ❌
            </span>
            <span>执行失败，请重试</span>
            {canRetry && onRetry && (
              <button
                className="workflow-bubble__retry-btn"
                onClick={handleRetry}
                disabled={isRetrying}
              >
                {isRetrying ? (
                  '重试中...'
                ) : (
                  <>
                    <span aria-hidden="true">🔄</span> 从失败步骤重试
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
      <MediaViewer {...viewerProps} />
    </div>
  );
};

export default WorkflowMessageBubble;
