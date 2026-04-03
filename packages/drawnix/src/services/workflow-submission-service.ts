/**
 * Workflow Submission Service
 *
 * Simplified service for submitting workflows to Service Worker.
 * This replaces the complex workflow execution logic in AIInputBar.
 *
 * Architecture:
 * - Application layer: Build workflow definition → Submit to SW → Listen for updates
 * - Service Worker: Execute workflow → Call MCP tools → Broadcast status updates
 *
 * Updated: Now fully uses postmessage-duplex via SWChannelClient for all SW communication.
 */

import { Subject, Observable, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import type { ParsedGenerationParams } from '../utils/ai-input-parser';
import { swCapabilitiesHandler } from './sw-capabilities';
import type { DelegatedOperation } from './sw-capabilities';
import { workflowStorageReader } from './workflow-storage-reader';
import { WorkflowEngine as MainThreadWorkflowEngine } from './workflow-engine';
import { executorFactory } from './media-executor';
import { geminiSettings, type ModelRef } from '../utils/settings-manager';
import type {
  Workflow as EngineWorkflow,
  WorkflowEvent as EngineWorkflowEvent,
} from './workflow-engine/types';

// ============================================================================
// Types
// ============================================================================

export type WorkflowStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'pending_main_thread';

export interface WorkflowStepOptions {
  mode?: 'async' | 'queue';
  batchId?: string;
  batchIndex?: number;
  batchTotal?: number;
  globalIndex?: number;
}

export interface WorkflowStep {
  id: string;
  mcp: string;
  args: Record<string, unknown>;
  description: string;
  status: WorkflowStepStatus;
  result?: unknown;
  error?: string;
  duration?: number;
  options?: WorkflowStepOptions;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  steps: WorkflowStep[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
  context?: {
    userInput?: string;
    model?: string;
    modelRef?: ModelRef | null;
    params?: {
      count?: number;
      size?: string;
      duration?: string;
    };
    referenceImages?: string[];
  };
  /**
   * 发起工作流的画布 ID
   * 用于多画布场景下隔离工作流执行
   */
  initiatorBoardId?: string;
}

// Events emitted by the service
export interface WorkflowStatusEvent {
  type: 'status';
  workflowId: string;
  status: WorkflowDefinition['status'];
}

export interface WorkflowStepEvent {
  type: 'step';
  workflowId: string;
  stepId: string;
  status: WorkflowStepStatus;
  result?: unknown;
  error?: string;
  duration?: number;
}

export interface WorkflowCompletedEvent {
  type: 'completed';
  workflowId: string;
  workflow: WorkflowDefinition;
}

export interface WorkflowFailedEvent {
  type: 'failed';
  workflowId: string;
  error: string;
}

export interface CanvasInsertEvent {
  type: 'canvas_insert';
  requestId: string;
  operation: 'insert_image' | 'insert_video' | 'insert_audio' | 'insert_text' | 'canvas_insert';
  params: {
    url?: string;
    content?: string;
    position?: { x: number; y: number };
    items?: Array<{ type: string; url?: string; content?: string; [key: string]: unknown }>;
    [key: string]: unknown;
  };
}

/**
 * Main thread tool request event
 * SW requests main thread to execute a tool
 */
export interface MainThreadToolRequestEvent {
  type: 'main_thread_tool_request';
  requestId: string;
  workflowId: string;
  stepId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface WorkflowStepsAddedEvent {
  type: 'steps_added';
  workflowId: string;
  steps: Array<{
    id: string;
    mcp: string;
    args: Record<string, unknown>;
    description: string;
    status: WorkflowStepStatus;
  }>;
}

export interface WorkflowRecoveredEvent {
  type: 'recovered';
  workflowId: string;
  workflow: WorkflowDefinition;
}

export type WorkflowEvent =
  | WorkflowStatusEvent
  | WorkflowStepEvent
  | WorkflowCompletedEvent
  | WorkflowFailedEvent
  | CanvasInsertEvent
  | MainThreadToolRequestEvent
  | WorkflowStepsAddedEvent
  | WorkflowRecoveredEvent;

// ============================================================================
// Workflow Submission Service
// ============================================================================

class WorkflowSubmissionService {
  private events$ = new Subject<WorkflowEvent>();
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private initialized = false;

  /**
   * Initialize the service (call once on app startup)
   * 工作流现在完全在主线程执行，不再需要 SW 事件监听。
   */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
  }

  /**
   * Destroy the service
   */
  destroy(): void {
    this.events$.complete();
    this.initialized = false;
  }

  /**
   * Recover workflow states after page refresh
   * Call this after initialization to restore all workflows from IndexedDB
   * This includes failed workflows (e.g., interrupted by SW restart during ai_analyze)
   */
  async recoverWorkflows(): Promise<WorkflowDefinition[]> {
    try {
      // 优先直接从 IndexedDB 读取，避免 postMessage 通信
      let workflows: WorkflowDefinition[] = [];

      if (await workflowStorageReader.isAvailable()) {
        workflows = await workflowStorageReader.getAllWorkflows();
      }

      if (workflows.length === 0) {
        return [];
      }

      // Sync all workflows to local cache (including failed/completed)
      // This ensures UI shows correct status for interrupted workflows
      for (const workflow of workflows) {
        const existingWorkflow = this.workflows.get(workflow.id);
        // Only update if data is newer or workflow doesn't exist locally
        if (
          !existingWorkflow ||
          workflow.updatedAt > (existingWorkflow.updatedAt || 0)
        ) {
          this.workflows.set(workflow.id, workflow);

          // Emit status event for failed workflows so UI can update
          if (
            workflow.status === 'failed' &&
            existingWorkflow?.status !== 'failed' &&
            this.events$
          ) {
            this.events$.next({
              type: 'failed',
              workflowId: workflow.id,
              error: workflow.error || 'Unknown error',
            });
          }
        }
      }

      // Return running/pending workflows for callers that need them
      return workflows.filter(
        (w) => w.status === 'running' || w.status === 'pending'
      );
    } catch (error) {
      console.warn(
        '[WorkflowSubmissionService] Failed to recover workflows:',
        error
      );
      return [];
    }
  }

  /**
   * Get running workflows from cache
   */
  getRunningWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values()).filter(
      (w) => w.status === 'running' || w.status === 'pending'
    );
  }

  /**
   * 通知工作流步骤状态更新（由 WorkflowPollingService 调用）
   */
  notifyStepUpdate(
    workflowId: string,
    stepId: string,
    status: WorkflowStepStatus,
    result?: unknown,
    error?: string,
    duration?: number
  ): void {
    // 更新本地缓存
    const workflow = this.workflows.get(workflowId);
    if (workflow) {
      const step = workflow.steps.find((s) => s.id === stepId);
      if (step) {
        step.status = status;
        step.result = result;
        step.error = error;
        step.duration = duration;
      }
    }

    // 发送事件通知 UI
    this.events$.next({
      type: 'step',
      workflowId,
      stepId,
      status,
      result,
      error,
      duration,
    });
  }

  /**
   * 通知工作流完成（由 WorkflowPollingService 调用）
   */
  notifyWorkflowCompleted(
    workflowId: string,
    workflow: WorkflowDefinition
  ): void {
    // 更新本地缓存
    this.workflows.set(workflowId, workflow);

    // 发送事件通知 UI
    this.events$.next({
      type: 'completed',
      workflowId,
      workflow,
    });
  }

  /**
   * 通知工作流失败（由 WorkflowPollingService 调用）
   */
  notifyWorkflowFailed(workflowId: string, error: string): void {
    // 更新本地缓存
    const workflow = this.workflows.get(workflowId);
    if (workflow) {
      workflow.status = 'failed';
      workflow.error = error;
    }

    // 发送事件通知 UI
    this.events$.next({
      type: 'failed',
      workflowId,
      error,
    });
  }

  /**
   * 检查工作流是否由降级引擎管理
   */
  isWorkflowManagedByFallback(workflowId: string): boolean {
    if (!this.fallbackEngine) return false;
    const workflow = this.fallbackEngine.getWorkflow(workflowId);
    return workflow !== undefined;
  }

  /**
   * 从降级引擎获取工作流状态
   */
  getWorkflowFromFallback(workflowId: string): WorkflowDefinition | undefined {
    if (!this.fallbackEngine) return undefined;
    const workflow = this.fallbackEngine.getWorkflow(workflowId);
    if (!workflow) return undefined;

    // 转换为 WorkflowDefinition 格式
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
      status: workflow.status,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
      completedAt: workflow.completedAt,
      error: workflow.error,
      context: workflow.context,
    };
  }

  /**
   * 使用降级引擎恢复并继续执行工作流
   * 用于页面刷新后恢复有 pending 步骤的工作流
   */
  async resumeWorkflowWithFallback(workflowId: string): Promise<boolean> {
    // 确保降级引擎已初始化
    if (!this.fallbackEngine) {
      this.fallbackEngine = new MainThreadWorkflowEngine({
        onEvent: (event) => this.handleFallbackEngineEvent(event),
        // 主线程工具执行回调（insert_mermaid, insert_mindmap 等）
        executeMainThreadTool: async (toolName, args) => {
          try {
            const result = await swCapabilitiesHandler.execute({
              operation: toolName,
              args,
            } as DelegatedOperation);
            return {
              success: result.success,
              error: result.error,
            };
          } catch (error: any) {
            return {
              success: false,
              error: error.message || 'Main thread tool execution failed',
            };
          }
        },
      });
    }

    // 从 IndexedDB 恢复
    await this.fallbackEngine.resumeWorkflow(workflowId);

    // 检查是否成功恢复
    return this.fallbackEngine.getWorkflow(workflowId) !== undefined;
  }

  /**
   * Create a workflow from parsed AI input
   */
  createWorkflow(
    parsedInput: ParsedGenerationParams,
    referenceImages: string[] = []
  ): WorkflowDefinition {
    const workflowId = `wf_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const now = Date.now();

    // Determine MCP tool based on generation type
    const mcpTool =
      parsedInput.generationType === 'video'
        ? 'generate_video'
        : 'generate_image';

    // Build tool arguments
    const args: Record<string, unknown> = {
      prompt: parsedInput.prompt,
      model: parsedInput.modelId,
      modelRef: parsedInput.modelRef || null,
    };

    if (parsedInput.size) args.size = parsedInput.size;
    if (parsedInput.count && parsedInput.count > 1)
      args.count = parsedInput.count;
    if (parsedInput.duration) args.seconds = parsedInput.duration;
    if (referenceImages.length > 0) args.referenceImages = referenceImages;
    if (parsedInput.extraParams) args.params = parsedInput.extraParams;

    // Create steps based on count
    const steps: WorkflowStep[] = [];
    const count = parsedInput.count || 1;

    for (let i = 0; i < count; i++) {
      steps.push({
        id: `step_${i}_${Math.random().toString(36).substr(2, 9)}`,
        mcp: mcpTool,
        args: { ...args, count: 1 }, // Each step generates 1 item
        description:
          parsedInput.generationType === 'video'
            ? `生成视频 ${i + 1}/${count}`
            : `生成图片 ${i + 1}/${count}`,
        status: 'pending',
      });
    }

    const workflow: WorkflowDefinition = {
      id: workflowId,
      name: parsedInput.generationType === 'video' ? '视频生成' : '图片生成',
      steps,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      context: {
        userInput: parsedInput.userInstruction,
        model: parsedInput.modelId,
        modelRef: parsedInput.modelRef || null,
        params: {
          count: parsedInput.count,
          size: parsedInput.size,
          duration: parsedInput.duration,
        },
        referenceImages,
      },
    };

    return workflow;
  }

  /**
   * Submit a workflow for execution
   * 始终使用主线程工作流引擎（不再依赖 SW）
   */
  async submit(workflow: WorkflowDefinition): Promise<void> {
    console.log(
      '[WorkflowSubmissionService][submit] 入口 workflowId:',
      workflow.id
    );

    // Store locally
    this.workflows.set(workflow.id, workflow);

    // 工作流变更时清除读取缓存
    workflowStorageReader.invalidateCache();

    // 直接使用主线程工作流引擎
    const success = await this.tryFallbackEngine(workflow);
    if (success) {
      return;
    }

    // 失败
    this.workflows.delete(workflow.id);
    throw new Error('Submit workflow failed');
  }

  /**
   * 主线程工作流引擎实例（降级模式）
   */
  private fallbackEngine: MainThreadWorkflowEngine | null = null;

  /**
   * 尝试使用主线程工作流引擎执行工作流
   */
  private async tryFallbackEngine(
    workflow: WorkflowDefinition
  ): Promise<boolean> {
    try {
      // 降级路径：直接使用 fallback 执行器，不检测 SW 可用性（避免 30s+ 阻塞）
      const executor = executorFactory.getFallbackExecutor();
      if (!executor) {
        console.warn(
          '[WorkflowSubmissionService] tryFallbackEngine: fallback executor 不可用'
        );
        return false;
      }
      console.log(
        '[WorkflowSubmissionService] tryFallbackEngine: 使用降级执行器'
      );

      // 创建或获取主线程工作流引擎
      if (!this.fallbackEngine) {
        this.fallbackEngine = new MainThreadWorkflowEngine({
          onEvent: (event) => this.handleFallbackEngineEvent(event),
          forceFallbackExecutor: true, // 降级路径：强制主线程执行器，直接调用 API，不依赖 SW/IndexedDB
          executeMainThreadTool: async (toolName, args) => {
            try {
              const result = await swCapabilitiesHandler.execute({
                operation: toolName,
                args,
              } as DelegatedOperation);
              return {
                success: result.success,
                result: result.data,
                error: result.error,
              };
            } catch (error: any) {
              return {
                success: false,
                error: error.message || 'Main thread tool execution failed',
              };
            }
          },
        });
      }

      // 转换工作流定义为引擎格式
      const engineWorkflow: EngineWorkflow = {
        id: workflow.id,
        name: workflow.name,
        steps: workflow.steps.map((step) => ({
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
          result: step.result,
          error: step.error,
          duration: step.duration,
          options: step.options,
        })),
        status: workflow.status as
          | 'pending'
          | 'running'
          | 'completed'
          | 'failed'
          | 'cancelled',
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
        completedAt: workflow.completedAt,
        error: workflow.error,
        context: workflow.context,
      };

      // 提交到主线程引擎
      console.log(
        '[WorkflowSubmissionService] tryFallbackEngine: 提交到主线程引擎, steps:',
        engineWorkflow.steps.length
      );
      await this.fallbackEngine.submitWorkflow(engineWorkflow);
      console.log('[WorkflowSubmissionService] tryFallbackEngine: 引擎已启动');

      return true;
    } catch (error) {
      console.error(
        '[WorkflowSubmissionService] Fallback engine error:',
        error
      );
      return false;
    }
  }

  /**
   * 处理主线程工作流引擎事件
   */
  private handleFallbackEngineEvent(event: EngineWorkflowEvent): void {
    // 转换引擎事件为服务事件格式并广播
    switch (event.type) {
      case 'status':
        this.events$.next({
          type: 'status',
          workflowId: event.workflowId,
          status: event.status,
        });
        break;
      case 'step':
        this.events$.next({
          type: 'step',
          workflowId: event.workflowId,
          stepId: event.stepId,
          status: event.status,
          result: event.result,
          error: event.error,
          duration: event.duration,
        });
        // 同步更新本地缓存
        const workflow = this.workflows.get(event.workflowId);
        if (workflow) {
          const step = workflow.steps.find((s) => s.id === event.stepId);
          if (step) {
            step.status = event.status;
            step.result = event.result;
            step.error = event.error;
            step.duration = event.duration;
          }
          workflow.updatedAt = Date.now();
        }
        break;
      case 'completed':
        this.events$.next({
          type: 'completed',
          workflowId: event.workflowId,
          workflow: event.workflow as unknown as WorkflowDefinition,
        });
        // 更新本地缓存
        this.workflows.set(
          event.workflowId,
          event.workflow as unknown as WorkflowDefinition
        );
        break;
      case 'failed':
        this.events$.next({
          type: 'failed',
          workflowId: event.workflowId,
          error: event.error,
        });
        // 更新本地缓存
        const failedWorkflow = this.workflows.get(event.workflowId);
        if (failedWorkflow) {
          failedWorkflow.status = 'failed';
          failedWorkflow.error = event.error;
          failedWorkflow.updatedAt = Date.now();
        }
        break;
      case 'steps_added':
        this.events$.next({
          type: 'steps_added',
          workflowId: event.workflowId,
          steps: event.steps.map((s) => ({
            id: s.id,
            mcp: s.mcp,
            args: s.args,
            description: s.description,
            status: s.status,
          })),
        });
        break;
    }
  }

  /**
   * Cancel a workflow
   */
  async cancel(workflowId: string): Promise<void> {
    workflowStorageReader.invalidateCache();
    // 通知主线程引擎取消
    if (this.fallbackEngine) {
      await this.fallbackEngine.cancelWorkflow(workflowId);
    }
  }

  /**
   * Get workflow by ID
   */
  getWorkflow(workflowId: string): WorkflowDefinition | undefined {
    return this.workflows.get(workflowId);
  }

  /**
   * Query workflow status (returns full workflow data)
   * 优先直接从 IndexedDB 读取
   */
  async queryWorkflowStatus(
    workflowId: string
  ): Promise<WorkflowDefinition | null> {
    try {
      // 优先直接从 IndexedDB 读取
      if (await workflowStorageReader.isAvailable()) {
        const workflow = await workflowStorageReader.getWorkflow(workflowId);
        if (workflow) {
          this.workflows.set(workflowId, workflow);
          return workflow;
        }
      }
    } catch (error) {
      console.warn(
        '[WorkflowSubmissionService] Failed to query workflow status:',
        error
      );
    }

    return this.workflows.get(workflowId) || null;
  }

  /**
   * Query all workflows
   * 优先直接从 IndexedDB 读取
   */
  async queryAllWorkflows(): Promise<WorkflowDefinition[]> {
    try {
      // 优先直接从 IndexedDB 读取
      if (await workflowStorageReader.isAvailable()) {
        const workflows = await workflowStorageReader.getAllWorkflows();
        for (const workflow of workflows) {
          this.workflows.set(workflow.id, workflow);
        }
        return workflows;
      }
    } catch (error) {
      console.warn(
        '[WorkflowSubmissionService] Failed to query all workflows:',
        error
      );
    }

    return Array.from(this.workflows.values());
  }

  /**
   * Observable of all workflow events
   */
  get events(): Observable<WorkflowEvent> {
    return this.events$.asObservable();
  }

  /**
   * Subscribe to events for a specific workflow
   */
  subscribeToWorkflow(
    workflowId: string,
    callback: (event: WorkflowEvent) => void
  ): Subscription {
    return this.events$
      .pipe(
        filter((event) => {
          if (event.type === 'canvas_insert') return false;
          return (event as any).workflowId === workflowId;
        })
      )
      .subscribe(callback);
  }

  // 保存待注册的 Canvas 处理器（用于延迟注册）
  private pendingCanvasHandler:
    | ((
        operation: string,
        params: Record<string, unknown>
      ) => Promise<{ success: boolean; error?: string }>)
    | null = null;

  /**
   * 注册 Canvas 操作处理器
   * 工作流在主线程执行时，Canvas 操作通过 executeMainThreadTool 回调处理。
   * 此方法保持 API 兼容，但不再注册到 SW。
   */
  registerCanvasHandler(
    handler: (
      operation: string,
      params: Record<string, unknown>
    ) => Promise<{ success: boolean; error?: string }>
  ): void {
    this.pendingCanvasHandler = handler;
  }

  /**
   * Subscribe to main thread tool requests
   */
  subscribeToToolRequests(
    callback: (event: MainThreadToolRequestEvent) => void
  ): Subscription {
    return this.events$
      .pipe(
        filter(
          (event): event is MainThreadToolRequestEvent =>
            event.type === 'main_thread_tool_request'
        )
      )
      .subscribe(callback);
  }

  /**
   * Subscribe to all workflow events (for global state sync)
   * Used by drawnix.tsx to sync WorkZone UI with SW workflow state
   */
  subscribeToAllEvents(callback: (event: WorkflowEvent) => void): Subscription {
    return this.events$.subscribe(callback);
  }

  // SW 事件处理器已移除 - 工作流事件现在通过 handleFallbackEngineEvent 处理
}

// Export singleton instance
export const workflowSubmissionService = new WorkflowSubmissionService();
