/**
 * useTaskWorkflowSync Hook
 *
 * 同步桥梁：监听 TaskQueueService 的任务状态变更，
 * 将变更传播到 WorkflowContext 的步骤状态，
 * 确保任务队列重试后 Workzone 和 ChatDrawer 状态一致。
 *
 * 事件缓冲：工作流恢复前到达的事件会被缓冲，恢复后自动重放。
 * 降级路径：当 WorkflowContext 无工作流时，直接更新 WorkZone Plait 元素。
 */

import { useEffect, useRef } from 'react';
import { taskQueueService } from '../services/task-queue-service';
import { TaskStatus, TaskType } from '../types/shared/core.types';
import type { WorkflowMessageData } from '../types/chat.types';
import { WorkZoneTransforms, isWorkZoneElement } from '../plugins/with-workzone';
import { PlaitBoard } from '@plait/core';
import { toWorkflowMessageData } from './useWorkflowSubmission';
import type { TaskEvent, Task } from '../types/task.types';

import type { WorkflowStep, WorkflowDefinition } from '../components/ai-input-bar/workflow-converter';
import type { PlaitWorkZone } from '../types/workzone.types';

interface WorkflowControl {
  updateStep: (
    stepId: string,
    status: WorkflowStep['status'],
    result?: unknown,
    error?: string,
    duration?: number
  ) => void;
  resumeWorkflow: () => void;
  restoreWorkflow?: (workflow: WorkflowDefinition) => void;
  getWorkflow: () => WorkflowDefinition | null;
}

export interface UseTaskWorkflowSyncOptions {
  workflowControl: WorkflowControl;
  updateWorkflowMessage: (data: WorkflowMessageData) => void;
  boardRef: React.MutableRefObject<PlaitBoard | null>;
  workZoneIdRef: React.MutableRefObject<string | null>;
}

const MAX_BUFFER_SIZE = 20;
const REPLAY_INTERVAL = 2000;
const MAX_REPLAY_DURATION = 30000;

/**
 * Build taskId → stepId mapping from workflow steps
 */
function buildTaskStepMap(
  steps: Array<{ id: string; result?: unknown }> | undefined
): Map<string, string> {
  const map = new Map<string, string>();
  if (!steps) return map;
  for (const step of steps) {
    const result = step.result as { taskId?: string } | undefined;
    if (result?.taskId) {
      map.set(result.taskId, step.id);
    }
  }
  return map;
}

/**
 * Map task status to step status
 */
function mapTaskToStepStatus(task: Task): {
  status: WorkflowStep['status']; result?: unknown; error?: string;
} | null {
  if (task.status === TaskStatus.PROCESSING) {
    return { status: 'running' };
  } else if (task.status === TaskStatus.COMPLETED && task.result) {
    return { status: 'completed', result: { ...task.result, taskId: task.id } };
  } else if (task.status === TaskStatus.FAILED) {
    const errorMsg = typeof task.error === 'string'
      ? task.error
      : task.error?.message || 'Task failed';
    return { status: 'failed', error: errorMsg };
  }
  return null;
}

/**
 * Try to process a task event via WorkflowContext (primary path).
 * Returns true if handled.
 */
function processViaContext(
  task: Task,
  mapped: { status: WorkflowStep['status']; result?: unknown; error?: string },
  workflowControl: WorkflowControl,
  updateWorkflowMessageRef: React.MutableRefObject<(data: WorkflowMessageData) => void>,
  boardRef: React.MutableRefObject<PlaitBoard | null>,
  workZoneIdRef: React.MutableRefObject<string | null>,
): boolean {
  const workflow = workflowControl.getWorkflow();
  const taskStepMap = buildTaskStepMap(workflow?.steps);
  const stepId = taskStepMap.get(task.id);
  if (!stepId) return false;
  const shouldSyncWorkZone =
    task.type !== TaskType.IMAGE && workflow?.generationType !== 'image';

  if (mapped.status === 'running') {
    workflowControl.resumeWorkflow();
  }
  workflowControl.updateStep(stepId, mapped.status, mapped.result, mapped.error);

  const updatedWorkflow = workflowControl.getWorkflow();
  if (updatedWorkflow) {
    const workflowData = toWorkflowMessageData(updatedWorkflow);
    updateWorkflowMessageRef.current(workflowData);
    const board = boardRef.current;
    const workZoneId = workZoneIdRef.current;
    if (shouldSyncWorkZone && board && workZoneId) {
      WorkZoneTransforms.updateWorkflow(board, workZoneId, workflowData);
    }
  }
  return true;
}

/**
 * Fallback: find the WorkZone element on the board that contains the task,
 * update its step status directly, and restore the workflow to context.
 */
function processViaWorkZone(
  task: Task,
  mapped: { status: WorkflowStep['status']; result?: unknown; error?: string },
  workflowControl: WorkflowControl,
  updateWorkflowMessageRef: React.MutableRefObject<(data: WorkflowMessageData) => void>,
  boardRef: React.MutableRefObject<PlaitBoard | null>,
  workZoneIdRef: React.MutableRefObject<string | null>,
): boolean {
  const board = boardRef.current;
  if (!board) return false;
  if (task.type === TaskType.IMAGE) {
    return false;
  }

  for (const element of board.children) {
    if (!isWorkZoneElement(element)) continue;
    const wz = element as PlaitWorkZone;
    if (wz.workflow.generationType === 'image') {
      continue;
    }
    const wzStepMap = buildTaskStepMap(wz.workflow?.steps);
    const wzStepId = wzStepMap.get(task.id);
    if (!wzStepId) continue;

    // Update the WorkZone's workflow steps
    const updatedSteps = wz.workflow.steps.map(step => {
      if (step.id !== wzStepId) return step;
      return {
        ...step,
        status: mapped.status,
        ...(mapped.result !== undefined && { result: mapped.result }),
        ...(mapped.error !== undefined && { error: mapped.error }),
      };
    });
    const updatedWorkflow: WorkflowMessageData = {
      ...wz.workflow,
      steps: updatedSteps,
    };
    if (mapped.status === 'running') {
      delete (updatedWorkflow as any).error;
    }

    WorkZoneTransforms.updateWorkflow(board, wz.id, updatedWorkflow);
    workZoneIdRef.current = wz.id;
    updateWorkflowMessageRef.current(updatedWorkflow);

    // Restore to WorkflowContext so subsequent events use the primary path
    if (workflowControl.restoreWorkflow) {
      const restoredWorkflow: WorkflowDefinition = {
        id: updatedWorkflow.id,
        name: updatedWorkflow.name || '',
        description: '',
        scenarioType: 'direct_generation',
        generationType: updatedWorkflow.generationType,
        status: mapped.status === 'running' ? 'running' : 'failed',
        steps: updatedSteps.map(s => ({
          id: s.id,
          mcp: s.mcp || '',
          args: s.args || {},
          description: s.description || '',
          status: s.status,
          result: s.result,
          error: s.error,
          duration: s.duration,
          options: s.options,
        })),
        createdAt: updatedWorkflow.createdAt || Date.now(),
        metadata: {
          prompt: updatedWorkflow.prompt || '',
          userInstruction: '',
          rawInput: '',
          modelId: '',
          isModelExplicit: false,
          count: updatedWorkflow.count || 1,
          selection: { texts: [], images: [], videos: [], graphics: [] },
        },
        aiAnalysis: updatedWorkflow.aiAnalysis,
      };
      workflowControl.restoreWorkflow(restoredWorkflow);
    }
    return true;
  }
  return false;
}

/**
 * Try to process a task event. Uses WorkflowContext first, falls back to WorkZone element.
 */
function processTaskEvent(
  event: TaskEvent,
  workflowControl: WorkflowControl,
  updateWorkflowMessageRef: React.MutableRefObject<(data: WorkflowMessageData) => void>,
  boardRef: React.MutableRefObject<PlaitBoard | null>,
  workZoneIdRef: React.MutableRefObject<string | null>,
  options?: { logProcessing?: boolean; logUnmatched?: boolean },
): boolean {
  const task = event.task;
  const mapped = mapTaskToStepStatus(task);
  if (!mapped) return false;

  if (options?.logProcessing !== false) {
    console.debug(`[useTaskWorkflowSync] Processing task ${task.id} → ${mapped.status}`);
  }

  // Primary: update via WorkflowContext
  if (processViaContext(task, mapped, workflowControl, updateWorkflowMessageRef, boardRef, workZoneIdRef)) {
    console.debug(`[useTaskWorkflowSync] Task ${task.id} handled via WorkflowContext`);
    return true;
  }
  // Fallback: update WorkZone Plait element directly
  if (processViaWorkZone(task, mapped, workflowControl, updateWorkflowMessageRef, boardRef, workZoneIdRef)) {
    console.debug(`[useTaskWorkflowSync] Task ${task.id} handled via WorkZone fallback`);
    return true;
  }

  if (options?.logUnmatched !== false) {
    console.debug(`[useTaskWorkflowSync] Task ${task.id} not matched to any workflow step (buffering)`);
  }
  return false;
}

/**
 * Sync task queue state changes to workflow steps.
 * Buffers events that arrive before workflow recovery completes,
 * then replays them once the workflow is available.
 */
export function useTaskWorkflowSync(options: UseTaskWorkflowSyncOptions): void {
  const { workflowControl, boardRef, workZoneIdRef } = options;

  const updateWorkflowMessageRef = useRef(options.updateWorkflowMessage);
  useEffect(() => {
    updateWorkflowMessageRef.current = options.updateWorkflowMessage;
  }, [options.updateWorkflowMessage]);

  const eventBufferRef = useRef<Map<string, TaskEvent>>(new Map());
  const replayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const replayStartRef = useRef<number>(0);
  const initialReconciliationDoneRef = useRef(false);

  useEffect(() => {
    const bufferEvent = (event: TaskEvent) => {
      const buffer = eventBufferRef.current;

      if (!buffer.has(event.task.id) && buffer.size >= MAX_BUFFER_SIZE) {
        const oldestKey = buffer.keys().next().value;
        if (oldestKey) {
          buffer.delete(oldestKey);
        }
      }

      buffer.set(event.task.id, event);
    };

    const tryReplayBuffer = () => {
      const remaining = new Map<string, TaskEvent>();
      for (const [taskId, buffered] of eventBufferRef.current.entries()) {
        const handled = processTaskEvent(
          buffered,
          workflowControl,
          updateWorkflowMessageRef,
          boardRef,
          workZoneIdRef,
          { logProcessing: false, logUnmatched: false }
        );
        if (!handled) {
          remaining.set(taskId, buffered);
        }
      }
      eventBufferRef.current = remaining;

      if (remaining.size === 0 || Date.now() - replayStartRef.current > MAX_REPLAY_DURATION) {
        if (replayTimerRef.current) {
          clearInterval(replayTimerRef.current);
          replayTimerRef.current = null;
        }
        eventBufferRef.current = new Map();
      }
    };

    // Initial reconciliation: only run once to avoid infinite loop
    // (processTaskEvent may trigger state updates → re-render → useEffect re-run)
    if (!initialReconciliationDoneRef.current) {
      initialReconciliationDoneRef.current = true;
      const allTasks = taskQueueService.getAllTasks();
      for (const task of allTasks) {
        const mapped = mapTaskToStepStatus(task);
        if (!mapped) continue;
        if (mapped.status === 'completed' || mapped.status === 'failed') {
          processTaskEvent(
            { type: 'taskUpdated', task, timestamp: Date.now() },
            workflowControl, updateWorkflowMessageRef, boardRef, workZoneIdRef,
          );
        }
      }
    }

    const subscription = taskQueueService.observeTaskUpdates().subscribe((event) => {
      if (event.type !== 'taskUpdated') return;

      if (
        event.task.status === TaskStatus.PROCESSING &&
        eventBufferRef.current.has(event.task.id)
      ) {
        bufferEvent(event);
        if (!replayTimerRef.current) {
          replayStartRef.current = Date.now();
          replayTimerRef.current = setInterval(tryReplayBuffer, REPLAY_INTERVAL);
        }
        return;
      }

      const handled = processTaskEvent(
        event, workflowControl, updateWorkflowMessageRef, boardRef, workZoneIdRef,
      );

      if (handled) {
        eventBufferRef.current.delete(event.task.id);
      } else {
        bufferEvent(event);
        if (!replayTimerRef.current) {
          replayStartRef.current = Date.now();
          replayTimerRef.current = setInterval(tryReplayBuffer, REPLAY_INTERVAL);
        }
      }
    });

    return () => {
      subscription.unsubscribe();
      if (replayTimerRef.current) {
        clearInterval(replayTimerRef.current);
        replayTimerRef.current = null;
      }
      eventBufferRef.current = new Map();
    };
  }, [workflowControl, boardRef, workZoneIdRef]);
}
