/**
 * useWorkflowSubmission Hook
 *
 * Encapsulates workflow submission logic for AIInputBar.
 * All workflows execute in main thread.
 *
 * Handles:
 * - Workflow creation and submission
 * - Status synchronization with WorkflowContext, ChatDrawer, WorkZone
 * - Canvas operation handling
 */

import { useEffect, useCallback, useRef } from 'react';
import { Subscription } from 'rxjs';
import {
  workflowSubmissionService,
  type WorkflowDefinition as SWWorkflowDefinition,
  type WorkflowEvent,
  type CanvasInsertEvent,
  type WorkflowStepsAddedEvent,
} from '../services/workflow-submission-service';
import { useWorkflowControl } from '../contexts/WorkflowContext';
import { useChatDrawerControl } from '../contexts/ChatDrawerContext';
import type { WorkflowMessageData, WorkflowRetryContext, PostProcessingStatus } from '../types/chat.types';
import type { ParsedGenerationParams } from '../utils/ai-input-parser';
import { convertToWorkflow, type WorkflowDefinition as LegacyWorkflowDefinition } from '../components/ai-input-bar/workflow-converter';
import { WorkZoneTransforms } from '../plugins/with-workzone';
import { PlaitBoard } from '@plait/core';
import { geminiSettings } from '../utils/settings-manager';
import { useTaskWorkflowSync } from './useTaskWorkflowSync';
import {
  workflowCompletionService,
  type WorkflowCompletionEvent,
} from '../services/workflow-completion-service';
import { deriveRecoveredPostProcessingState } from '../utils/workflow-post-processing';

// ============================================================================
// Workflow Recovery Coordination
// ============================================================================

let workflowRecoveryResolve: (() => void) | null = null;
export const workflowRecoveryPromise = new Promise<void>((resolve) => {
  workflowRecoveryResolve = resolve;
});

// ============================================================================
// Types
// ============================================================================

export interface UseWorkflowSubmissionOptions {
  /** Board reference for WorkZone updates */
  boardRef: React.MutableRefObject<PlaitBoard | null>;
  /** Current WorkZone ID reference */
  workZoneIdRef: React.MutableRefObject<string | null>;
  /** Optional lifecycle callback for caller-owned UI side effects */
  onPostProcessingCompleted?: (
    event: WorkflowCompletionEvent
  ) => void | Promise<void>;
}

export interface UseWorkflowSubmissionReturn {
  /** Submit a workflow based on parsed AI input */
  submitWorkflow: (
    parsedInput: ParsedGenerationParams,
    referenceImages: string[],
    retryContext?: WorkflowRetryContext,
    existingWorkflow?: LegacyWorkflowDefinition,
    sendOptions?: WorkflowSendOptions
  ) => Promise<{ workflowId: string; usedSW: boolean }>;
  /** Cancel a workflow */
  cancelWorkflow: (workflowId: string) => Promise<void>;
  /** Handle workflow retry */
  retryWorkflow: (
    workflowMessageData: WorkflowMessageData,
    startStepIndex: number
  ) => Promise<void>;
  /** Get current retry context */
  getRetryContext: () => WorkflowRetryContext | null;
}

export type WorkflowExecutionMode = 'caller-owned' | 'service-owned';

export interface WorkflowSendOptions {
  autoOpen?: boolean;
  continueInCurrentSession?: boolean;
  activateTargetSession?: boolean;
  executionMode?: WorkflowExecutionMode;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert internal workflow to WorkflowMessageData for ChatDrawer
 */
export function toWorkflowMessageData(
  workflow: LegacyWorkflowDefinition,
  retryContext?: WorkflowRetryContext,
  postProcessingStatus?: PostProcessingStatus,
  insertedCount?: number
): WorkflowMessageData {
  // Safely access metadata with defaults
  const metadata = workflow.metadata || {};
  
  return {
    id: workflow.id,
    name: workflow.name,
    generationType: workflow.generationType,
    prompt: metadata.prompt || retryContext?.aiContext?.finalPrompt || '',
    aiAnalysis: workflow.aiAnalysis,
    count: metadata.count,
    createdAt: workflow.createdAt,
    status: workflow.status,
    steps: workflow.steps.map(step => ({
      id: step.id,
      description: step.description,
      status: step.status,
      mcp: step.mcp,
      args: step.args,
      result: step.result,
      error: step.error,
      duration: step.duration,
      options: step.options,
    })),
    retryContext,
    postProcessingStatus,
    insertedCount,
    error: workflow.error,
  };
}

function toServiceWorkflowDefinition(
  workflow: LegacyWorkflowDefinition
): SWWorkflowDefinition {
  const metadata = workflow.metadata || {};
  const context = workflow.context || {};

  return {
    id: workflow.id,
    name: workflow.name,
    steps: workflow.steps.map((step) => ({
      id: step.id,
      mcp: step.mcp,
      args: step.args,
      description: step.description,
      status: step.status,
      result: step.result,
      error: step.error,
      duration: step.duration,
      options: step.options,
    })),
    status: workflow.status || 'pending',
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt || workflow.createdAt,
    error: workflow.error,
    context: {
      userInput: context.userInput || metadata.userInstruction,
      model: context.model || metadata.modelId,
      modelRef: context.modelRef ?? metadata.modelRef ?? null,
      params: {
        count: metadata.count,
        size: metadata.size,
        duration: metadata.duration,
      },
      referenceImages:
        context.referenceImages || metadata.referenceImages || [],
    },
  };
}

/**
 * Handle canvas insert operation
 */
async function handleCanvasInsert(board: PlaitBoard, event: CanvasInsertEvent): Promise<void> {
  const { operation, params } = event;
  
  try {
    // Dynamically import canvas operations to avoid circular dependencies
    const { insertImageFromUrl } = await import('../data/image');
    const { insertVideoFromUrl } = await import('../data/video');
    const { insertAudioFromUrl } = await import('../data/audio');
    const { getSmartInsertionPoint } = await import('../utils/selection-utils');
    
    // Get insertion point
    const insertPoint = params.position 
      ? [params.position.x, params.position.y] as [number, number]
      : getSmartInsertionPoint(board) || [100, 100] as [number, number];
    
    if (operation === 'canvas_insert' && params.items) {
      // Handle batch insert
      for (const item of params.items) {
        if (item.type === 'image' && item.url) {
          await insertImageFromUrl(board, item.url, insertPoint);
        } else if (item.type === 'video' && item.url) {
          await insertVideoFromUrl(board, item.url, insertPoint);
        } else if (item.type === 'audio' && item.url) {
          await insertAudioFromUrl(board, item.url, item as any, insertPoint);
        }
      }
    } else if (operation === 'insert_image' && params.url) {
      await insertImageFromUrl(board, params.url, insertPoint);
    } else if (operation === 'insert_video' && params.url) {
      await insertVideoFromUrl(board, params.url, insertPoint);
    } else if ((operation as string) === 'insert_audio' && params.url) {
      await insertAudioFromUrl(board, params.url, params as any, insertPoint);
    }
  } catch (error) {
    console.error('[useWorkflowSubmission] Failed to insert to canvas:', error);
  }
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useWorkflowSubmission(
  options: UseWorkflowSubmissionOptions
): UseWorkflowSubmissionReturn {
  const { boardRef, workZoneIdRef, onPostProcessingCompleted } = options;

  const workflowControl = useWorkflowControl();
  const chatDrawerControl = useChatDrawerControl();

  // Refs for callbacks to avoid stale closures
  const sendWorkflowMessageRef = useRef(chatDrawerControl.sendWorkflowMessage);
  const updateWorkflowMessageRef = useRef(chatDrawerControl.updateWorkflowMessage);

  useEffect(() => {
    sendWorkflowMessageRef.current = chatDrawerControl.sendWorkflowMessage;
    updateWorkflowMessageRef.current = chatDrawerControl.updateWorkflowMessage;
  }, [chatDrawerControl.sendWorkflowMessage, chatDrawerControl.updateWorkflowMessage]);

  // Sync task queue state changes to workflow steps (retry → Workzone/ChatDrawer)
  useTaskWorkflowSync({
    workflowControl,
    updateWorkflowMessage: chatDrawerControl.updateWorkflowMessage,
    boardRef,
    workZoneIdRef,
  });

  // Current retry context
  const currentRetryContextRef = useRef<WorkflowRetryContext | null>(null);
  const postProcessingStatusRef = useRef<PostProcessingStatus | undefined>();
  const insertedCountRef = useRef<number | undefined>();
  const trackedWorkflowIdRef = useRef<string | null>(null);
  const ownedWorkflowIdRef = useRef<string | null>(null);
  const onPostProcessingCompletedRef = useRef(onPostProcessingCompleted);

  useEffect(() => {
    onPostProcessingCompletedRef.current = onPostProcessingCompleted;
  }, [onPostProcessingCompleted]);

  // Active subscriptions
  const subscriptionsRef = useRef<Subscription[]>([]);

  // Flag to track if we've already recovered workflows
  const hasRecoveredRef = useRef(false);

  // Ref to hold handleWorkflowEvent to avoid TDZ issues
  const handleWorkflowEventRef = useRef<((
    event: WorkflowEvent,
    legacyWorkflow: LegacyWorkflowDefinition,
    retryContext: WorkflowRetryContext
  ) => Promise<void>) | null>(null);

  const shouldSyncWorkZone = useCallback(
    (generationType?: WorkflowMessageData['generationType'] | LegacyWorkflowDefinition['generationType']) =>
      generationType !== 'image',
    []
  );

  const subscribeToWorkflowEvents = useCallback(
    (
      workflow: LegacyWorkflowDefinition,
      retryContext: WorkflowRetryContext
    ): Subscription => {
      const workflowSub = workflowSubmissionService.subscribeToWorkflow(
        workflow.id,
        async (event: WorkflowEvent) => {
          await handleWorkflowEventRef.current?.(event, workflow, retryContext);
        }
      );
      subscriptionsRef.current.push(workflowSub);
      return workflowSub;
    },
    []
  );

  const removeWorkflowSubscription = useCallback((subscription: Subscription) => {
    subscription.unsubscribe();
    subscriptionsRef.current = subscriptionsRef.current.filter(
      (entry) => entry !== subscription
    );
  }, []);

  const buildWorkflowMessageData = useCallback(
    (
      workflow: LegacyWorkflowDefinition,
      retryContext?: WorkflowRetryContext
    ): WorkflowMessageData => {
      const shouldAttachPostProcessing =
        trackedWorkflowIdRef.current === workflow.id;
      const recoveredPostProcessing = deriveRecoveredPostProcessingState(workflow);
      const resolvedPostProcessingStatus =
        shouldAttachPostProcessing && postProcessingStatusRef.current !== undefined
          ? postProcessingStatusRef.current
          : recoveredPostProcessing.postProcessingStatus;
      const resolvedInsertedCount =
        shouldAttachPostProcessing && insertedCountRef.current !== undefined
          ? insertedCountRef.current
          : recoveredPostProcessing.insertedCount;

      return toWorkflowMessageData(
        workflow,
        retryContext,
        resolvedPostProcessingStatus,
        resolvedInsertedCount
      );
    },
    []
  );

  const syncWorkflowPresentation = useCallback(
    (
      workflow: LegacyWorkflowDefinition,
      retryContext?: WorkflowRetryContext
    ): WorkflowMessageData => {
      const workflowData = buildWorkflowMessageData(workflow, retryContext);
      updateWorkflowMessageRef.current(workflowData);

      const board = boardRef.current;
      const workZoneId = workZoneIdRef.current;
      if (workZoneId && board) {
        WorkZoneTransforms.updateWorkflow(board, workZoneId, workflowData);
      }

      return workflowData;
    },
    [boardRef, buildWorkflowMessageData, shouldSyncWorkZone, workZoneIdRef]
  );
  /**
   * Recover workflows on mount (after page refresh)
   */
  const recoverWorkflowsOnMount = useCallback(async () => {
    if (hasRecoveredRef.current) return;
    hasRecoveredRef.current = true;

    try {
      await workflowSubmissionService.recoverWorkflows();
    } catch (error) {
      console.warn('[useWorkflowSubmission] Failed to recover workflows:', error);
    } finally {
      workflowRecoveryResolve?.();
    }
  }, []);

  // Initialize service on mount
  useEffect(() => {
    workflowSubmissionService.init();

    // 注册 Canvas 操作处理器
    workflowSubmissionService.registerCanvasHandler(
      async (_operation: string, _params: Record<string, unknown>) => {
        return { success: true };
      }
    );

    // Subscribe to workflow events
    const eventSub = workflowSubmissionService.subscribeToAllEvents(
      (event: WorkflowEvent) => {
        if (event.type === 'recovered' && event.workflow) {
          const recoveredWorkflow = event.workflow as unknown as LegacyWorkflowDefinition;
          
          // 只恢复活跃状态和最近失败的工作流
          const isActive = recoveredWorkflow.status === 'running' || recoveredWorkflow.status === 'pending';
          const isRecentlyFailed = recoveredWorkflow.status === 'failed' && 
            recoveredWorkflow.updatedAt && 
            (Date.now() - recoveredWorkflow.updatedAt) < 5 * 60 * 1000;
          
          if (!isActive && !isRecentlyFailed) return;

          workflowControl.restoreWorkflow?.(recoveredWorkflow);

          const globalSettings = geminiSettings.get();
          const retryContext: WorkflowRetryContext = {
            aiContext: {
              rawInput: recoveredWorkflow.context?.userInput || '',
              userInstruction: recoveredWorkflow.context?.userInput || '',
              model: {
                id: recoveredWorkflow.context?.model || '',
                type:
                  recoveredWorkflow.generationType === 'video'
                    ? 'video'
                    : recoveredWorkflow.generationType === 'audio'
                    ? 'audio'
                    : 'image',
                isExplicit: true,
              },
              defaultModels: {
                image: globalSettings.imageModelName || 'gemini-3-pro-image-preview-vip',
                video: globalSettings.videoModelName || 'veo3.1',
                audio: globalSettings.audioModelName || 'suno_music',
              } as any,
              params: {
                count: recoveredWorkflow.metadata?.count,
                size: recoveredWorkflow.metadata?.size,
                duration: recoveredWorkflow.metadata?.duration,
              },
              selection: { texts: [], images: [], videos: [], graphics: [] },
              finalPrompt: recoveredWorkflow.metadata?.prompt || '',
            } as any,
            referenceImages: recoveredWorkflow.context?.referenceImages || [],
            textModel: globalSettings.textModelName,
          };

          trackedWorkflowIdRef.current = recoveredWorkflow.id;
          postProcessingStatusRef.current = undefined;
          insertedCountRef.current = undefined;
          syncWorkflowPresentation(recoveredWorkflow, retryContext);
          subscribeToWorkflowEvents(recoveredWorkflow, retryContext);
        }
      }
    );
    subscriptionsRef.current.push(eventSub);

    // Recover workflows after page refresh
    recoverWorkflowsOnMount();

    return () => {
      subscriptionsRef.current.forEach(sub => sub.unsubscribe());
      subscriptionsRef.current = [];
    };
  }, [
    boardRef,
    recoverWorkflowsOnMount,
    subscribeToWorkflowEvents,
    syncWorkflowPresentation,
    workflowControl,
    workZoneIdRef,
  ]);

  /**
   * Handle workflow events
   */
  const handleWorkflowEvent = useCallback(async (
    event: WorkflowEvent,
    legacyWorkflow: LegacyWorkflowDefinition,
    retryContext: WorkflowRetryContext
  ) => {
    const board = boardRef.current;
    const workZoneId = workZoneIdRef.current;
    const syncWorkZone = shouldSyncWorkZone(legacyWorkflow.generationType);

    switch (event.type) {
      case 'step': {
        // console.log('[useWorkflowSubmission] Step event:', event.stepId, '->', event.status);
        // Update step in WorkflowContext
        workflowControl.updateStep(
          event.stepId,
          event.status as any,
          event.result,
          event.error,
          event.duration
        );

        // Sync to ChatDrawer and WorkZone
        const updatedWorkflow = workflowControl.getWorkflow();
        if (updatedWorkflow) {
          syncWorkflowPresentation(updatedWorkflow, retryContext);
        }
        break;
      }

      case 'completed': {

        // Update steps to completed status, but skip steps with taskId (they're waiting for task completion)
        const currentWorkflow = workflowControl.getWorkflow();
        let hasQueuedTasks = false;
        
        if (currentWorkflow) {
          // Mark remaining steps as completed, except those with taskId (queue tasks)
          currentWorkflow.steps.forEach(step => {
            const stepResult = step.result as { taskId?: string } | undefined;
            const hasTaskId = stepResult?.taskId;
            
            // 检查所有状态的步骤是否有 taskId
            if (hasTaskId) {
              hasQueuedTasks = true;
              // console.log('[useWorkflowSubmission] Step has taskId:', step.id, step.mcp, 'taskId:', hasTaskId);
            }
            
            // 只更新 running/pending 状态的步骤（如果没有 taskId 的话）
            if ((step.status === 'running' || step.status === 'pending') && !hasTaskId) {
              workflowControl.updateStep(step.id, 'completed');
            }
          });
        }

        // Sync final state to ChatDrawer and WorkZone
        const completedWorkflow = workflowControl.getWorkflow();
        if (completedWorkflow) {
          syncWorkflowPresentation(completedWorkflow, retryContext);

          if (syncWorkZone && workZoneId && board) {
            // 检查是否还有 pending 或 running 步骤（AI 分析可能会添加后续步骤）
            const hasPendingSteps = completedWorkflow.steps.some(
              step => step.status === 'pending' || step.status === 'running'
            );
            
            // 如果还有 pending 步骤，不要删除 WorkZone
            if (hasPendingSteps) {
              // console.log('[useWorkflowSubmission] Workflow has pending steps, not removing WorkZone');
              break;
            }
            
            // If no queued tasks (like generate_image), remove WorkZone after a delay
            // Queued tasks will be handled by useAutoInsertToCanvas when they complete AND are inserted
            if (!hasQueuedTasks) {
              setTimeout(() => {
                WorkZoneTransforms.removeWorkZone(board, workZoneId);
              }, 1500);
            } else {
              // 检查是否所有队列任务的后处理已经完成（可能在工作流完成前就已经插入了）
              const { workflowCompletionService } = await import('../services/workflow-completion-service');
              const allPostProcessingFinished = completedWorkflow.steps.every(step => {
                const stepResult = step.result as { taskId?: string } | undefined;
                if (stepResult?.taskId) {
                  const isCompleted = workflowCompletionService.isPostProcessingCompleted(stepResult.taskId);
                  return isCompleted;
                }
                return true;
              });

              if (allPostProcessingFinished) {
                setTimeout(() => {
                  WorkZoneTransforms.removeWorkZone(board, workZoneId);
                }, 1500);
              }
            }
          }
        }
        break;
      }

      case 'failed': {
        workflowControl.abortWorkflow();

        // Sync failed state to ChatDrawer and WorkZone
        const failedWorkflow = workflowControl.getWorkflow();
        if (failedWorkflow) {
          syncWorkflowPresentation(failedWorkflow, retryContext);
        }
        break;
      }

      case 'steps_added': {
        // console.log('[useWorkflowSubmission] Steps added:', event.steps?.length);
        // Add new steps to WorkflowContext
        const stepsAddedEvent = event as WorkflowStepsAddedEvent;
        workflowControl.addSteps(stepsAddedEvent.steps.map((step: any) => ({
          id: step.id,
          mcp: step.mcp,
          args: step.args,
          description: step.description,
          status: step.status,
        })));

        // Sync to ChatDrawer and WorkZone
        const workflowWithNewSteps = workflowControl.getWorkflow();
        if (workflowWithNewSteps) {
          syncWorkflowPresentation(workflowWithNewSteps, retryContext);
        }
        break;
      }

      case 'canvas_insert': {
        // Handle canvas insert operation
        const canvasEvent = event as CanvasInsertEvent;
        // console.log('[useWorkflowSubmission] Canvas insert:', canvasEvent.operation, canvasEvent.params);
        
        if (board) {
          handleCanvasInsert(board, canvasEvent);
        }
        break;
      }
    }
  }, [
    boardRef,
    shouldSyncWorkZone,
    syncWorkflowPresentation,
    workflowControl,
    workZoneIdRef,
  ]);

  useEffect(() => {
    const completionSub = workflowCompletionService
      .observeCompletionEvents()
      .subscribe((event) => {
        const workflow = workflowControl.getWorkflow();
        if (!workflow || trackedWorkflowIdRef.current !== workflow.id) {
          return;
        }

        const step = workflow.steps.find((currentStep) => {
          const result = currentStep.result as { taskId?: string } | undefined;
          return result?.taskId === event.taskId;
        });

        if (!step) {
          return;
        }

        switch (event.type) {
          case 'postProcessingStarted':
            postProcessingStatusRef.current = 'processing';
            break;
          case 'postProcessingCompleted':
            postProcessingStatusRef.current = 'completed';
            insertedCountRef.current =
              (insertedCountRef.current || 0) + (event.result.insertedCount || 0);
            break;
          case 'postProcessingFailed':
            postProcessingStatusRef.current = 'failed';
            break;
        }

        const updatedWorkflow = workflowControl.getWorkflow();
        if (updatedWorkflow && trackedWorkflowIdRef.current === updatedWorkflow.id) {
          syncWorkflowPresentation(
            updatedWorkflow,
            currentRetryContextRef.current || undefined
          );
        }

        if (
          event.type === 'postProcessingCompleted' &&
          ownedWorkflowIdRef.current === workflow.id
        ) {
          void onPostProcessingCompletedRef.current?.(event);
        }
      });

    subscriptionsRef.current.push(completionSub);

    return () => {
      removeWorkflowSubscription(completionSub);
    };
  }, [removeWorkflowSubscription, syncWorkflowPresentation, workflowControl]);

  // Update ref when handleWorkflowEvent changes
  useEffect(() => {
    handleWorkflowEventRef.current = handleWorkflowEvent;
  }, [handleWorkflowEvent]);

  /**
   * Submit a workflow (always uses main thread)
   */
  const submitWorkflow = useCallback(async (
    parsedInput: ParsedGenerationParams,
    referenceImages: string[],
    retryContext?: WorkflowRetryContext,
    existingWorkflow?: LegacyWorkflowDefinition,
    sendOptions?: WorkflowSendOptions
  ): Promise<{ workflowId: string; usedSW: boolean }> => {
    // Use existing workflow if provided, otherwise create a new one
    const legacyWorkflow = existingWorkflow || convertToWorkflow(parsedInput, referenceImages);
    trackedWorkflowIdRef.current = legacyWorkflow.id;
    ownedWorkflowIdRef.current = legacyWorkflow.id;
    postProcessingStatusRef.current = undefined;
    insertedCountRef.current = undefined;

    // Start workflow in WorkflowContext
    workflowControl.startWorkflow(legacyWorkflow);

    // Build retry context
    const globalSettings = geminiSettings.get();
    const textModel = globalSettings.textModelName;

    const finalRetryContext: WorkflowRetryContext = retryContext || {
      aiContext: {
        rawInput: parsedInput.rawInput || parsedInput.userInstruction,
        userInstruction: parsedInput.userInstruction,
        model: {
          id: parsedInput.modelId,
          type: parsedInput.generationType,
          isExplicit: parsedInput.isModelExplicit,
        },
        defaultModels: {
          image: globalSettings.imageModelName || 'gemini-3-pro-image-preview-vip',
          video: globalSettings.videoModelName || 'veo3.1',
          audio: globalSettings.audioModelName || 'suno_music',
        },
        params: {
          count: parsedInput.count,
          size: parsedInput.size,
          duration: parsedInput.duration,
        },
        selection: parsedInput.selection || { texts: [], images: [], videos: [], graphics: [] },
        finalPrompt: parsedInput.prompt,
      },
      referenceImages,
      textModel,
    } as any;
    currentRetryContextRef.current = finalRetryContext;

    // Send to ChatDrawer
    const workflowMessageData = buildWorkflowMessageData(
      legacyWorkflow,
      finalRetryContext
    );
    await sendWorkflowMessageRef.current({
      context: finalRetryContext.aiContext,
      workflow: workflowMessageData,
      textModel,
      autoOpen: sendOptions?.autoOpen ?? false,
      continueInCurrentSession: sendOptions?.continueInCurrentSession ?? false,
      activateTargetSession: sendOptions?.activateTargetSession ?? true,
    });

    if ((sendOptions?.executionMode ?? 'caller-owned') === 'service-owned') {
      const workflowSub = subscribeToWorkflowEvents(
        legacyWorkflow,
        finalRetryContext
      );

      try {
        await workflowSubmissionService.submit(
          toServiceWorkflowDefinition(legacyWorkflow)
        );
      } catch (error) {
        removeWorkflowSubscription(workflowSub);

        const failureMessage =
          error instanceof Error ? error.message : 'Workflow execution failed';
        const failedWorkflow: LegacyWorkflowDefinition = {
          ...(workflowControl.getWorkflow() || legacyWorkflow),
          status: 'failed',
          error: failureMessage,
          updatedAt: Date.now(),
        };

        workflowControl.restoreWorkflow(failedWorkflow);

        const failedWorkflowMessage = toWorkflowMessageData(
          failedWorkflow,
          finalRetryContext,
          postProcessingStatusRef.current,
          insertedCountRef.current
        );
        updateWorkflowMessageRef.current(failedWorkflowMessage);

        const board = boardRef.current;
        const workZoneId = workZoneIdRef.current;
        if (workZoneId && board) {
          WorkZoneTransforms.updateWorkflow(
            board,
            workZoneId,
            failedWorkflowMessage
          );
        }

        throw error;
      }
    }

    return { workflowId: legacyWorkflow.id, usedSW: false };
  }, [
    workflowControl,
    boardRef,
    workZoneIdRef,
    buildWorkflowMessageData,
    subscribeToWorkflowEvents,
    removeWorkflowSubscription,
  ]);

  /**
   * Cancel a workflow
   */
  const cancelWorkflow = useCallback(async (workflowId: string): Promise<void> => {
    await workflowSubmissionService.cancel(workflowId);
    workflowControl.abortWorkflow();
  }, [workflowControl]);

  /**
   * Retry a workflow from a specific step
   */
  const retryWorkflow = useCallback(async (
    workflowMessageData: WorkflowMessageData,
    startStepIndex: number
  ): Promise<void> => {
    const retryContext = workflowMessageData.retryContext;
    if (!retryContext) {
      console.error('[useWorkflowSubmission] No retry context available');
      return;
    }

    // console.log(`[useWorkflowSubmission] Retrying from step ${startStepIndex}`);

    // Reconstruct parsed input from retry context
    const parsedInput: ParsedGenerationParams = {
      prompt: workflowMessageData.prompt,
      userInstruction: retryContext.aiContext.userInstruction,
      rawInput: retryContext.aiContext.rawInput,
      modelId: retryContext.aiContext.model.id,
      isModelExplicit: retryContext.aiContext.model.isExplicit,
      generationType: retryContext.aiContext.model.type as
        | 'image'
        | 'video'
        | 'audio'
        | 'text'
        | 'agent',
      count: workflowMessageData.count || 1,
      size: retryContext.aiContext.params.size,
      duration: retryContext.aiContext.params.duration,
      scenario:
        retryContext.aiContext.model.type === 'agent'
          ? 'agent_flow'
          : 'direct_generation',
      selection: retryContext.aiContext.selection,
      parseResult: {} as any, // Not needed for retry
      hasExtraContent: false,
    };

    // Submit as new workflow
    await submitWorkflow(parsedInput, retryContext.referenceImages || [], retryContext);
  }, [submitWorkflow]);

  /**
   * Get current retry context
   */
  const getRetryContext = useCallback((): WorkflowRetryContext | null => {
    return currentRetryContextRef.current;
  }, []);

  return {
    submitWorkflow,
    cancelWorkflow,
    retryWorkflow,
    getRetryContext,
  };
}
