import { useEffect } from 'react';
import type { PlaitElement } from '@plait/core';
import type { DrawnixBoard } from '../../hooks/use-drawnix';
import { useTaskStorage } from '../../hooks/useTaskStorage';
import { useTaskExecutor } from '../../hooks/useTaskExecutor';
import { useAutoInsertToCanvas } from '../../hooks/useAutoInsertToCanvas';
import { useImageGenerationAnchorSync } from '../../hooks/useImageGenerationAnchorSync';
import { useBeforeUnload } from '../../hooks/useBeforeUnload';
import { useProviderProfiles } from '../../hooks/use-provider-profiles';
import { initializeAssetIntegration } from '../../services/asset-integration-service';
import { fontManagerService } from '../../services/font-manager-service';
import { modelPricingService } from '../../utils/model-pricing-service';

export interface DrawnixDeferredRuntimeProps {
  board: DrawnixBoard | null;
  value: PlaitElement[];
}

const FRESH_WORKZONE_GRACE_MS = 60_000;

function runWhenIdle(callback: () => void, timeout: number): () => void {
  const idleCallback = (
    window as Window & {
      requestIdleCallback?: (
        cb: () => void,
        options?: { timeout: number }
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    }
  ).requestIdleCallback;

  if (typeof idleCallback === 'function') {
    const id = idleCallback(callback, { timeout });
    return () => {
      (
        window as Window & {
          cancelIdleCallback?: (callbackId: number) => void;
        }
      ).cancelIdleCallback?.(id);
    };
  }

  const timer = window.setTimeout(callback, Math.min(timeout, 500));
  return () => window.clearTimeout(timer);
}

export function DrawnixDeferredRuntime({
  board,
  value,
}: DrawnixDeferredRuntimeProps) {
  const isTaskStorageReady = useTaskStorage();
  const providerProfiles = useProviderProfiles();

  useEffect(() => {
    if (providerProfiles.length === 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      modelPricingService.warmupProfiles(providerProfiles);
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [providerProfiles]);

  useEffect(() => {
    const cleanup = initializeAssetIntegration();
    return cleanup;
  }, []);

  useEffect(() => {
    if (!value || value.length === 0) {
      return;
    }

    return runWhenIdle(() => {
      fontManagerService.preloadBoardFonts(value).catch((error) => {
        console.warn(
          '[DrawnixDeferredRuntime] Failed to preload board fonts:',
          error
        );
      });
    }, 2000);
  }, [value]);

  useEffect(() => {
    if (!board) {
      return;
    }

    return runWhenIdle(() => {
      import('../../services/video-recovery-service')
        .then((videoRecoveryService) => {
          const initVideoRecoveryService =
            videoRecoveryService?.initVideoRecoveryService;

          if (typeof initVideoRecoveryService !== 'function') {
            console.warn(
              '[DrawnixDeferredRuntime] Video recovery service unavailable.'
            );
            return;
          }

          initVideoRecoveryService(board);
        })
        .catch((error) => {
          console.warn(
            '[DrawnixDeferredRuntime] Failed to load video recovery service:',
            error
          );
        });
    }, 3000);
  }, [board]);

  useEffect(() => {
    if (!isTaskStorageReady) {
      return;
    }

    let disposed = false;
    let taskSubscription: { unsubscribe: () => void } | undefined;
    let cancelVideoRecoveries: (() => void) | undefined;
    const cancelIdle = runWhenIdle(() => {
      const resumeTasks = async () => {
        try {
          const { workflowRecoveryPromise } = await import(
            '../../hooks/useWorkflowSubmission'
          );
          await Promise.race([
            workflowRecoveryPromise,
            new Promise<void>((resolve) => window.setTimeout(resolve, 5000)),
          ]);
        } catch {
          // Ignore and continue.
        }

        const [{ fallbackMediaExecutor }, { taskQueueService }] =
          await Promise.all([
            import('../../services/media-executor/fallback-executor'),
            import('../../services/task-queue'),
          ]);
        if (disposed) return;
        cancelVideoRecoveries = () =>
          fallbackMediaExecutor.cancelAllPendingTaskRecoveries();

        const resumeVideoTasks = (
          tasks: ReturnType<typeof taskQueueService.getAllTasks>
        ) =>
          fallbackMediaExecutor.resumePendingTasks(
            (taskId, status, updates) => {
              taskQueueService.updateTaskStatus(taskId, status, updates);
            },
            tasks,
            (taskId) => {
              const token = taskQueueService.getTaskExecutionToken(taskId);
              return () =>
                Boolean(
                  token &&
                    taskQueueService.isTaskExecutionTokenCurrent(taskId, token)
                );
            }
          );

        taskSubscription = taskQueueService
          .observeTaskUpdates()
          .subscribe((event) => {
            const task = event.task;
            if (event.type === 'taskDeleted') {
              fallbackMediaExecutor.cancelPendingTask(task.id);
            } else if (event.type === 'taskCreated') {
              void resumeVideoTasks([task]);
            } else if (
              event.type === 'taskUpdated' &&
              task.type === 'video' &&
              task.status === 'processing' &&
              task.remoteId
            ) {
              void resumeVideoTasks([task]);
            }
          });
        await resumeVideoTasks(taskQueueService.getAllTasks());
      };

      resumeTasks().catch((error) => {
        console.error(
          '[DrawnixDeferredRuntime] Failed to resume tasks:',
          error
        );
      });
    }, 5000);

    return () => {
      disposed = true;
      cancelIdle();
      taskSubscription?.unsubscribe();
      cancelVideoRecoveries?.();
    };
  }, [isTaskStorageReady]);

  useEffect(() => {
    if (!isTaskStorageReady || !board || !value || value.length === 0) {
      return;
    }

    return runWhenIdle(() => {
      const restoreWorkZones = async () => {
        const [{ WorkZoneTransforms }, { TaskStatus }, { taskQueueService }] =
          await Promise.all([
            import('../../plugins/with-workzone'),
            import('../../types/task.types'),
            import('../../services/task-queue'),
          ]);

        const workzones = WorkZoneTransforms.getAllWorkZones(board);

        for (const workzone of workzones) {
          if (
            workzone.createdAt &&
            Date.now() - workzone.createdAt < FRESH_WORKZONE_GRACE_MS
          ) {
            continue;
          }

          const currentWorkflow = {
            ...workzone.workflow,
            steps: [...workzone.workflow.steps],
          };

          const hasPendingOrRunningSteps = currentWorkflow.steps.some(
            (step) => step.status === 'running' || step.status === 'pending'
          );

          if (
            currentWorkflow.status === 'completed' &&
            !hasPendingOrRunningSteps
          ) {
            WorkZoneTransforms.removeWorkZone(board, workzone.id);
            continue;
          }

          if (!hasPendingOrRunningSteps) {
            continue;
          }

          const updatedSteps = currentWorkflow.steps.map((step) => {
            if (step.status !== 'running' && step.status !== 'pending') {
              return step;
            }

            const taskId = (step.result as { taskId?: string })?.taskId;
            if (!taskId) {
              const mediaGenerationSteps = [
                'generate_image',
                'generate_video',
                'generate_grid_image',
                'generate_inspiration_board',
                'generate_ppt',
              ];
              if (
                step.mcp === 'ai_analyze' ||
                mediaGenerationSteps.includes(step.mcp)
              ) {
                return step;
              }

              if (step.status === 'running') {
                return {
                  ...step,
                  status: 'failed' as const,
                  error: '页面刷新导致中断，请删除后重新发起',
                };
              }
              return step;
            }

            const task = taskQueueService.getTask(taskId);
            if (!task) {
              return {
                ...step,
                status: 'failed' as const,
                error: '任务未找到，请重试',
              };
            }

            switch (task.status) {
              case TaskStatus.COMPLETED:
                return {
                  ...step,
                  status: 'completed' as const,
                  result: { taskId, result: task.result },
                };
              case TaskStatus.FAILED:
                return {
                  ...step,
                  status: 'failed' as const,
                  error: task.error?.message || '任务执行失败',
                };
              case TaskStatus.CANCELLED:
                return {
                  ...step,
                  status: 'skipped' as const,
                };
              default:
                return step;
            }
          });

          const hasChanges = updatedSteps.some(
            (step, index) =>
              step.status !== currentWorkflow.steps[index]?.status
          );

          if (hasChanges) {
            WorkZoneTransforms.updateWorkflow(board, workzone.id, {
              steps: updatedSteps,
            });
          }
        }
      };

      restoreWorkZones().catch((error) => {
        console.error(
          '[DrawnixDeferredRuntime] Failed to restore WorkZones:',
          error
        );
      });
    }, 2000);
  }, [board, isTaskStorageReady, value]);

  useEffect(() => {
    if (!board) {
      return;
    }

    let subscription: { unsubscribe: () => void } | null = null;

    const setupWorkflowSync = async () => {
      const workflowModule = await import(
        '../../services/workflow-submission-service'
      );
      const { WorkZoneTransforms } = await import(
        '../../plugins/with-workzone'
      );
      const { workflowSubmissionService } = workflowModule;

      subscription = workflowSubmissionService.subscribeToAllEvents((event) => {
        const workflowEvent = event as {
          type: string;
          workflowId: string;
          stepId?: string;
          status?: string;
          result?: unknown;
          error?: string;
          duration?: number;
          steps?: Array<{
            id: string;
            mcp: string;
            args: Record<string, unknown>;
            description: string;
            status: string;
          }>;
          workflow?: {
            steps: Array<unknown>;
            status: string;
          };
        };

        const workzones = WorkZoneTransforms.getAllWorkZones(board);
        const workzone = workzones.find(
          (wz) => wz.workflow.id === workflowEvent.workflowId
        );

        if (!workzone) {
          return;
        }

        switch (workflowEvent.type) {
          case 'step': {
            const updatedSteps = workzone.workflow.steps.map((step) => {
              if (step.id === workflowEvent.stepId) {
                return {
                  ...step,
                  status: (workflowEvent.status ||
                    step.status) as typeof step.status,
                  result: workflowEvent.result ?? step.result,
                  error: workflowEvent.error ?? step.error,
                  duration: workflowEvent.duration ?? step.duration,
                };
              }
              return step;
            });
            WorkZoneTransforms.updateWorkflow(board, workzone.id, {
              steps: updatedSteps,
            });
            break;
          }

          case 'steps_added': {
            const newSteps = (workflowEvent.steps || []).map((step) => ({
              id: step.id,
              mcp: step.mcp,
              args: step.args,
              description: step.description,
              status: step.status as
                | 'pending'
                | 'running'
                | 'completed'
                | 'failed'
                | 'skipped',
            }));
            WorkZoneTransforms.updateWorkflow(board, workzone.id, {
              steps: [...workzone.workflow.steps, ...newSteps],
            });
            break;
          }

          case 'completed':
          case 'failed': {
            const finalStatus =
              workflowEvent.type === 'completed' ? 'completed' : 'failed';
            const updatedSteps = workzone.workflow.steps.map((step) => {
              if (step.status !== 'running' && step.status !== 'pending') {
                return step;
              }

              const stepResult = step.result as { taskId?: string } | undefined;
              if (stepResult?.taskId) {
                return step;
              }

              return {
                ...step,
                status: finalStatus as 'completed' | 'failed',
                error:
                  workflowEvent.type === 'failed'
                    ? workflowEvent.error
                    : undefined,
              };
            });
            WorkZoneTransforms.updateWorkflow(board, workzone.id, {
              steps: updatedSteps,
            });
            break;
          }

          case 'recovered': {
            if (workflowEvent.workflow) {
              WorkZoneTransforms.updateWorkflow(board, workzone.id, {
                steps: workflowEvent.workflow
                  .steps as typeof workzone.workflow.steps,
                status: workflowEvent.workflow
                  .status as typeof workzone.workflow.status,
              });
            }
            break;
          }
        }
      });
    };

    setupWorkflowSync().catch((error) => {
      console.error(
        '[DrawnixDeferredRuntime] Failed to setup workflow sync:',
        error
      );
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, [board]);

  useEffect(() => {
    if (!isTaskStorageReady || !board) {
      return;
    }

    let subscription: { unsubscribe: () => void } | null = null;

    const setupTaskQueueSync = async () => {
      const { taskQueueService } = await import('../../services/task-queue');
      const { WorkZoneTransforms } = await import(
        '../../plugins/with-workzone'
      );
      const { TaskStatus } = await import('../../types/task.types');

      subscription = taskQueueService
        .observeTaskUpdates()
        .subscribe((event) => {
          if (
            event.type !== 'taskUpdated' &&
            event.type !== 'taskCompleted' &&
            event.type !== 'taskFailed'
          ) {
            return;
          }

          const task = event.task;
          if (!task) {
            return;
          }

          const workzones = WorkZoneTransforms.getAllWorkZones(board);

          for (const workzone of workzones) {
            const currentWorkflow = {
              ...workzone.workflow,
              steps: [...workzone.workflow.steps],
            };
            let hasChanges = false;

            const updatedSteps = currentWorkflow.steps.map((step) => {
              const stepResult = step.result as { taskId?: string } | undefined;

              if (stepResult?.taskId !== task.id) {
                return step;
              }

              let newStatus = step.status;
              let newError = step.error;
              let newResult = step.result;

              switch (task.status) {
                case TaskStatus.COMPLETED:
                  newStatus = 'completed';
                  newResult = { taskId: task.id, result: task.result };
                  break;
                case TaskStatus.FAILED:
                  newStatus = 'failed';
                  newError = task.error?.message || '任务失败';
                  break;
                case TaskStatus.PROCESSING:
                  newStatus = 'running';
                  break;
                case TaskStatus.PENDING:
                  newStatus = 'pending';
                  break;
                case TaskStatus.CANCELLED:
                  newStatus = 'skipped';
                  break;
              }

              if (newStatus !== step.status || newError !== step.error) {
                hasChanges = true;
                return {
                  ...step,
                  status: newStatus as typeof step.status,
                  error: newError,
                  result: newResult,
                };
              }

              return step;
            });

            if (hasChanges) {
              WorkZoneTransforms.updateWorkflow(board, workzone.id, {
                steps: updatedSteps,
              });
            }
          }
        });
    };

    setupTaskQueueSync().catch((error) => {
      console.error(
        '[DrawnixDeferredRuntime] Failed to sync task queue:',
        error
      );
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, [board, isTaskStorageReady]);

  useTaskExecutor(isTaskStorageReady);
  useAutoInsertToCanvas({
    enabled: true,
    insertPrompt: false,
    groupSimilarTasks: true,
  });
  useImageGenerationAnchorSync({ board, enabled: isTaskStorageReady });
  useBeforeUnload();

  return null;
}

export default DrawnixDeferredRuntime;
