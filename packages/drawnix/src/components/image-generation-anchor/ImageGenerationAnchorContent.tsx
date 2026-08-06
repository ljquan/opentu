import React, { useCallback, useMemo, useState } from 'react';
import classNames from 'classnames';
import type { PlaitBoard } from '@plait/core';
import { Copy } from 'lucide-react';
import { MessagePlugin } from 'tdesign-react';
import { useImageGenerationAnchorController } from '../../hooks/useImageGenerationAnchorController';
import { taskQueueService } from '../../services/task-queue';
import { workflowCompletionService } from '../../services/workflow-completion-service';
import { ImageGenerationAnchorTransforms } from './image-generation-anchor.transforms';
import {
  IMAGE_GENERATION_ANCHOR_RETRY_EVENT,
  type ImageGenerationAnchorActionType,
  type PlaitImageGenerationAnchor,
} from '../../types/image-generation-anchor.types';
import { TaskStatus } from '../../types/task.types';
import {
  ImageGenerationProgressDisplay,
  type ImageGenerationProgressTone,
} from '../shared/ImageGenerationProgressDisplay';
import { RetryImage } from '../retry-image';
import { getImageTaskProgressStatusText } from '../../utils/image-task-progress';
import { buildImageGenerationAnchorPresentationPatch } from '../../utils/image-generation-anchor-state';
import {
  getTasksForImageGenerationAnchor,
  selectPrimaryImageGenerationAnchorTask,
} from '../../utils/image-generation-anchor-task';
import './image-generation-anchor.scss';

interface ImageGenerationAnchorContentProps {
  board: PlaitBoard;
  element: PlaitImageGenerationAnchor;
  selected: boolean;
}

const PHASE_CENTER_LABELS = {
  submitted: '等待执行',
  queued: '等待执行',
  generating: '生成中',
  developing: '正在显影',
  inserting: '正在显现',
  completed: '',
  failed: '生成失败',
} as const;

const STACK_SLOT_STATUS_LABELS = {
  pending: '待生成',
  generating: '生成中',
  ready: '已完成',
  failed: '失败',
} as const;

export const ImageGenerationAnchorContent: React.FC<
  ImageGenerationAnchorContentProps
> = ({ board, element, selected }) => {
  const { viewModel } = useImageGenerationAnchorController({ anchor: element });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const relatedTasks = useMemo(
    () => getTasksForImageGenerationAnchor(element, taskQueueService.getAllTasks()),
    [element]
  );
  const resolvedTask = useMemo(
    () => selectPrimaryImageGenerationAnchorTask(element, relatedTasks),
    [element, relatedTasks]
  );
  const isGhost = viewModel.anchorType === 'ghost';
  const batchPreview = viewModel.batchPreview;
  const isStack = Boolean(batchPreview);
  const isRenderingResult =
    viewModel.phase === 'developing' || viewModel.phase === 'inserting';
  const candidateCount =
    batchPreview?.totalCount ??
    Math.max(element.requestedCount ?? 0, element.taskIds.length, 1);
  const showActions = viewModel.phase === 'failed' || detailsOpen || selected;
  const showRing = viewModel.progressMode !== 'hidden';
  const showDeterminateProgress =
    viewModel.progressMode === 'determinate' && viewModel.progress != null;
  const progressValue = Math.round(viewModel.progress ?? 0);
  const showCenterLabel = viewModel.phase !== 'completed';
  const centerLabel = isStack
    ? batchPreview?.statusText || PHASE_CENTER_LABELS[viewModel.phase]
    : showDeterminateProgress
    ? getImageTaskProgressStatusText(progressValue)
    : PHASE_CENTER_LABELS[viewModel.phase];
  const progressTone: ImageGenerationProgressTone =
    viewModel.phase === 'failed'
      ? 'danger'
      : viewModel.phase === 'completed'
      ? 'success'
      : isRenderingResult
      ? 'loading'
      : 'default';
  const detailItems = useMemo(
    () => [
      {
        label: '编号',
        value:
          resolvedTask?.id ||
          element.primaryTaskId ||
          element.taskIds[0] ||
          element.workflowId,
        copyable: true,
      },
      { label: '阶段', value: viewModel.phaseLabel },
      { label: '形态', value: viewModel.anchorType },
      { label: '过渡', value: viewModel.transitionMode },
      {
        label: '任务',
        value: element.primaryTaskId || (element.taskIds[0] ?? '待绑定'),
        copyable: true,
      },
      { label: '工作流', value: element.workflowId, copyable: true },
      { label: '错误', value: viewModel.error || '无' },
    ],
    [
      resolvedTask?.id,
      element.primaryTaskId,
      element.taskIds,
      element.workflowId,
      viewModel.anchorType,
      viewModel.error,
      viewModel.phaseLabel,
      viewModel.transitionMode,
    ]
  );

  const stopEventPropagation = useCallback(
    (event: React.PointerEvent | React.MouseEvent) => {
      event.stopPropagation();
    },
    []
  );
  const stopInteractionStart = useCallback(
    (event: React.PointerEvent | React.MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
    },
    []
  );
  const failureIdentifier =
    resolvedTask?.id ||
    element.primaryTaskId ||
    element.taskIds[0] ||
    element.workflowId;
  const stopPointer = useCallback(
    (event: React.PointerEvent | React.MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
    },
    []
  );
  const copyText = useCallback(
    async (
      event: React.PointerEvent | React.MouseEvent,
      value?: string | null
    ) => {
      stopPointer(event);
      if (!value) {
        return;
      }

      try {
        await navigator.clipboard.writeText(value);
        MessagePlugin.success('已复制 ID');
      } catch (error) {
        console.error('[ImageGenerationAnchor] Failed to copy text:', error);
        MessagePlugin.error('复制失败');
      }
    },
    [stopPointer]
  );

  const handleAction = useCallback(
    (actionType: ImageGenerationAnchorActionType) => {
      if (actionType === 'none') {
        return;
      }

      if (actionType === 'details') {
        setDetailsOpen((value) => !value);
        return;
      }

      if (actionType === 'retry') {
        const retryableTask =
          relatedTasks.find(
            (task) =>
              task.status === TaskStatus.FAILED ||
              task.status === TaskStatus.CANCELLED
          ) ||
          relatedTasks.find(
            (task) =>
              workflowCompletionService.getPostProcessingStatus(task.id)
                ?.status === 'failed'
          ) ||
          selectPrimaryImageGenerationAnchorTask(element, relatedTasks);
        const taskId =
          retryableTask?.id || element.primaryTaskId || element.taskIds[0];
        if (!taskId) {
          ImageGenerationAnchorTransforms.updateAnchor(
            board,
            element.id,
            buildImageGenerationAnchorPresentationPatch('failed', {
              error: '任务未绑定，无法重试',
            })
          );
          return;
        }

        const retryablePostProcessingStatus = retryableTask
          ? workflowCompletionService.getPostProcessingStatus(retryableTask.id)
              ?.status
          : undefined;

        if (retryableTask) {
          ImageGenerationAnchorTransforms.updateAnchor(
            board,
            element.id,
            buildImageGenerationAnchorPresentationPatch('retrying')
          );

          if (
            retryableTask.status === TaskStatus.FAILED ||
            retryableTask.status === TaskStatus.CANCELLED
          ) {
            taskQueueService.retryTask(retryableTask.id);
            return;
          }

          if (
            retryableTask.status === TaskStatus.COMPLETED &&
            retryablePostProcessingStatus === 'failed'
          ) {
            taskQueueService.retryTask(retryableTask.id, {
              allowCompleted: true,
            });
            return;
          }
        }

        window.dispatchEvent(
          new CustomEvent(IMAGE_GENERATION_ANCHOR_RETRY_EVENT, {
            detail: { taskId, anchorId: element.id },
          })
        );
        return;
      }

      if (actionType === 'dismiss') {
        board.deleteFragment([element]);
      }
    },
    [board, element, relatedTasks]
  );
  const runDeferredAction = useCallback(
    (actionType: ImageGenerationAnchorActionType) => {
      window.setTimeout(() => {
        handleAction(actionType);
      }, 0);
    },
    [handleAction]
  );

  const renderCore = () => {
    return (
      <div className="image-generation-anchor__surface-core">
        {showCenterLabel ? (
          <ImageGenerationProgressDisplay
            progress={showDeterminateProgress ? progressValue : null}
            progressMode={viewModel.progressMode}
            tone={progressTone}
            statusText={centerLabel}
            compact
            showRing={showRing || viewModel.phase === 'failed'}
            className="image-generation-anchor__progress-display"
          />
        ) : null}
        {viewModel.phase === 'failed' && viewModel.error ? (
          <div className="image-generation-anchor__error">
            <span className="image-generation-anchor__error-raw">
              {viewModel.error}
            </span>
            {failureIdentifier ? (
              <span className="image-generation-anchor__error-id">
                <span className="image-generation-anchor__error-id-text">
                  ID: {failureIdentifier}
                </span>
                <button
                  type="button"
                  className="image-generation-anchor__copy-button"
                  onPointerDown={stopInteractionStart}
                  onMouseDown={stopInteractionStart}
                  onPointerUp={stopEventPropagation}
                  onMouseUp={stopEventPropagation}
                  onClick={(event) => {
                    void copyText(event, failureIdentifier);
                  }}
                  aria-label="复制 ID"
                  title="复制 ID"
                >
                  <Copy size={12} />
                </button>
              </span>
            ) : null}
            <button
              type="button"
              className="image-generation-anchor__error-link"
              onPointerDown={stopInteractionStart}
              onMouseDown={stopInteractionStart}
              onPointerUp={stopEventPropagation}
              onMouseUp={stopEventPropagation}
              onClick={(event) => {
                stopPointer(event);
                runDeferredAction('details');
              }}
            >
              {detailsOpen ? '收起详情' : '查看详情'}
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  const primaryActionLabel =
    detailsOpen && viewModel.primaryAction.type === 'details'
      ? '收起'
      : viewModel.primaryAction.label;
  const secondaryActionLabel =
    detailsOpen && viewModel.secondaryAction?.type === 'details'
      ? '收起'
      : viewModel.secondaryAction?.label;
  const secondaryActionType = viewModel.secondaryAction?.type;
  const stackBadgeLabel =
    candidateCount > 1 ? `${candidateCount} 张` : String(candidateCount);
  const stackSummaryLabel =
    batchPreview && batchPreview.readySlotCount > 0
      ? `${batchPreview.readySlotCount}/${batchPreview.totalCount} 已完成`
      : batchPreview?.statusText;

  const renderSurfacePreview = () => {
    if (isStack && batchPreview) {
      const slots = batchPreview.slots.map((slot, index) => {
        return (
          <div
            key={slot.id}
            className={classNames(
              'image-generation-anchor__stack-slot',
              `image-generation-anchor__stack-slot--index-${index}`,
              `image-generation-anchor__stack-slot--${slot.status}`,
              {
                'image-generation-anchor__stack-slot--preview': Boolean(
                  slot.previewImageUrl
                ),
              }
            )}
          >
            <span className="image-generation-anchor__stack-slot-noise" />
            {slot.previewImageUrl ? (
              <RetryImage
                className="image-generation-anchor__stack-slot-image"
                src={slot.previewImageUrl}
                alt={`生成预览 ${index + 1}`}
                showSkeleton={false}
                eager
              />
            ) : null}
            <span className="image-generation-anchor__stack-slot-meta">
              <span className="image-generation-anchor__stack-slot-index">
                {index + 1}
              </span>
              <span className="image-generation-anchor__stack-slot-status">
                {STACK_SLOT_STATUS_LABELS[slot.status]}
              </span>
            </span>
            <span className="image-generation-anchor__stack-slot-sheen" />
          </div>
        );
      });

      return (
        <div
          className={classNames(
            'image-generation-anchor__surface-preview',
            'image-generation-anchor__surface-preview--stack'
          )}
        >
          <div
            className={classNames(
              'image-generation-anchor__stack-preview',
              `image-generation-anchor__stack-preview--count-${batchPreview.visibleSlotCount}`,
              {
                'image-generation-anchor__stack-preview--has-preview':
                  batchPreview.hasPreviewImage,
              }
            )}
          >
            {slots}
          </div>
        </div>
      );
    }

    return (
      <div className="image-generation-anchor__surface-preview">
        <div className="image-generation-anchor__surface-shell" />
        <div
          className={classNames('image-generation-anchor__surface-image', {
            'image-generation-anchor__surface-image--actual': Boolean(
              viewModel.previewImageUrl
            ),
          })}
        >
          <span className="image-generation-anchor__surface-image-noise" />
          {viewModel.previewImageUrl ? (
            <RetryImage
              className="image-generation-anchor__surface-image-actual"
              src={viewModel.previewImageUrl}
              alt="图片生成预览"
              showSkeleton={false}
              eager
            />
          ) : null}
          <span className="image-generation-anchor__surface-image-sheen" />
        </div>
      </div>
    );
  };

  return (
    <div
      className={classNames(
        'image-generation-anchor',
        `image-generation-anchor--${viewModel.anchorType}`,
        `image-generation-anchor--${viewModel.tone}`,
        `image-generation-anchor--phase-${viewModel.phase}`,
        `image-generation-anchor--progress-${viewModel.progressMode}`,
        `image-generation-anchor--transition-${viewModel.transitionMode}`,
        {
          'image-generation-anchor--selected': selected,
          'image-generation-anchor--terminal': viewModel.isTerminal,
          'image-generation-anchor--details-open': detailsOpen,
        }
      )}
    >
      <div className="image-generation-anchor__glow" />

      <div
        className={classNames('image-generation-anchor__surface', {
          'image-generation-anchor__surface--compact': isGhost,
          'image-generation-anchor__surface--stack': isStack,
        })}
      >
        {!isStack ? (
          <div className="image-generation-anchor__surface-grid" />
        ) : null}
        <div className="image-generation-anchor__surface-refresh" />
        {isStack && batchPreview ? (
          <div className="image-generation-anchor__stack-header">
            <div className="image-generation-anchor__stack-badge">
              {stackBadgeLabel}
            </div>
            {stackSummaryLabel ? (
              <div className="image-generation-anchor__stack-summary">
                {stackSummaryLabel}
              </div>
            ) : null}
          </div>
        ) : null}
        {renderSurfacePreview()}

        {renderCore()}
      </div>

      {detailsOpen ? (
        <div className="image-generation-anchor__details">
          {detailItems.map((item) => (
            <div
              key={item.label}
              className="image-generation-anchor__detail-row"
            >
              <span className="image-generation-anchor__detail-label">
                {item.label}
              </span>
              <span className="image-generation-anchor__detail-value">
                <span className="image-generation-anchor__detail-value-text">
                  {item.value}
                </span>
                {item.copyable && item.value ? (
                  <button
                    type="button"
                    className="image-generation-anchor__copy-button image-generation-anchor__copy-button--detail"
                    onPointerDown={stopInteractionStart}
                    onMouseDown={stopInteractionStart}
                    onPointerUp={stopEventPropagation}
                    onMouseUp={stopEventPropagation}
                    onClick={(event) => {
                      void copyText(event, item.value);
                    }}
                    aria-label={`复制${item.label}`}
                    title={`复制${item.label}`}
                  >
                    <Copy size={12} />
                  </button>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {showActions ? (
        <div className="image-generation-anchor__actions">
          <button
            type="button"
            className="image-generation-anchor__action"
            onPointerDown={stopInteractionStart}
            onMouseDown={stopInteractionStart}
            onPointerUp={stopEventPropagation}
            onMouseUp={stopEventPropagation}
            onClick={(event) => {
              stopPointer(event);
              runDeferredAction(viewModel.primaryAction.type);
            }}
          >
            {primaryActionLabel}
          </button>
          {viewModel.secondaryAction ? (
            <button
              type="button"
              className="image-generation-anchor__action image-generation-anchor__action--secondary"
              onPointerDown={stopInteractionStart}
              onMouseDown={stopInteractionStart}
              onPointerUp={stopEventPropagation}
              onMouseUp={stopEventPropagation}
              onClick={(event) => {
                stopPointer(event);
                if (secondaryActionType) {
                  runDeferredAction(secondaryActionType);
                }
              }}
            >
              {secondaryActionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
