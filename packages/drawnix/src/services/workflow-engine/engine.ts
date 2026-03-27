/**
 * Workflow Engine
 *
 * 主线程工作流引擎，负责：
 * - 管理工作流状态
 * - 按顺序/依赖执行步骤
 * - 调用 media-generation 服务执行媒体生成任务
 * - 轮询等待任务完成
 */

import { Subject } from 'rxjs';
import type {
  Workflow,
  WorkflowStep,
  WorkflowEvent,
  WorkflowEngineOptions,
} from './types';
import { executorFactory, taskStorageWriter } from '../media-executor';
import type { AIAnalyzeParams } from '../media-executor/types';
import { workflowStorageWriter } from './workflow-storage-writer';
import { findExecutableSteps, getFirstError } from './workflow-factory';
import { generateImage, generateVideo, TaskStatus } from '../media-generation';
import type { ModelRef } from '../../utils/settings-manager';

/**
 * 主线程工作流引擎
 */
export class WorkflowEngine {
  private workflows: Map<string, Workflow> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private events$ = new Subject<WorkflowEvent>();
  private options: Omit<WorkflowEngineOptions, 'forceFallbackExecutor'> & {
    stepTimeout: number;
    continueOnError: boolean;
    onEvent: (event: WorkflowEvent) => void;
    forceFallbackExecutor: boolean;
  };

  constructor(options: WorkflowEngineOptions = {}) {
    this.options = {
      stepTimeout: options.stepTimeout ?? 10 * 60 * 1000, // 10 分钟
      continueOnError: options.continueOnError ?? false,
      onEvent: options.onEvent ?? (() => {}),
      executeMainThreadTool: options.executeMainThreadTool,
      forceFallbackExecutor: options.forceFallbackExecutor ?? false,
    };

    // 订阅事件并调用回调
    this.events$.subscribe((event) => {
      this.options.onEvent(event);
    });
  }

  /**
   * 提交工作流
   */
  async submitWorkflow(workflow: Workflow): Promise<void> {
    console.log(
      '[WorkflowEngine] submitWorkflow 入口, id:',
      workflow.id,
      'steps:',
      workflow.steps.length
    );

    // 保存到内存
    this.workflows.set(workflow.id, workflow);

    // 保存到 IndexedDB（降级模式下可能失败，不阻塞执行）
    try {
      await workflowStorageWriter.saveWorkflow(workflow);
      console.log('[WorkflowEngine] submitWorkflow: IDB 保存完成');
    } catch (e) {
      console.warn(
        '[WorkflowEngine] submitWorkflow: IDB 保存失败，继续执行:',
        e
      );
    }

    // 创建取消控制器
    const abortController = new AbortController();
    this.abortControllers.set(workflow.id, abortController);

    // 异步执行工作流
    console.log('[WorkflowEngine] submitWorkflow: 开始异步执行工作流');
    this.executeWorkflow(workflow.id).catch((error) => {
      console.error(
        `[WorkflowEngine] Workflow ${workflow.id} execution error:`,
        error
      );
    });
  }

  /**
   * 取消工作流
   */
  async cancelWorkflow(workflowId: string): Promise<void> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return;

    // 发送取消信号
    const abortController = this.abortControllers.get(workflowId);
    abortController?.abort();

    // 更新状态
    workflow.status = 'cancelled';
    workflow.updatedAt = Date.now();
    await workflowStorageWriter.saveWorkflow(workflow);

    this.emitEvent({
      type: 'status',
      workflowId,
      status: 'cancelled',
    });
  }

  /**
   * 获取工作流
   */
  getWorkflow(workflowId: string): Workflow | undefined {
    return this.workflows.get(workflowId);
  }

  /**
   * 从 IndexedDB 恢复并继续执行工作流
   * 用于页面刷新后恢复未完成的工作流
   */
  async resumeWorkflow(workflowId: string): Promise<void> {
    // 检查是否已在内存中
    if (this.workflows.has(workflowId)) {
      return;
    }

    // 从 IndexedDB 加载
    const workflow = await workflowStorageWriter.getWorkflow(workflowId);
    if (!workflow) {
      return;
    }

    // 检查是否有需要执行的步骤
    const hasPendingSteps = workflow.steps.some((s) => s.status === 'pending');
    const hasRunningSteps = workflow.steps.some((s) => s.status === 'running');
    const hasPendingMainThreadSteps = workflow.steps.some(
      (s) => s.status === 'pending_main_thread'
    );

    if (!hasPendingSteps && !hasRunningSteps && !hasPendingMainThreadSteps) {
      return;
    }

    // 将 running 步骤重置为 pending（页面刷新导致中断）
    // pending_main_thread 步骤保持不变，由 WorkflowPollingService 处理
    workflow.steps.forEach((s) => {
      if (s.status === 'running') {
        s.status = 'pending';
      }
    });

    // 加载到内存并执行
    this.workflows.set(workflowId, workflow);
    const abortController = new AbortController();
    this.abortControllers.set(workflowId, abortController);

    // 开始执行
    this.executeWorkflow(workflowId).catch((error) => {
      console.error(
        '[WorkflowEngine] Resume workflow failed:',
        workflowId,
        error
      );
    });
  }

  /**
   * 执行工作流
   */
  private async executeWorkflow(workflowId: string): Promise<void> {
    console.log('[WorkflowEngine] executeWorkflow 开始, id:', workflowId);
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      console.warn(
        '[WorkflowEngine] executeWorkflow: 工作流不存在:',
        workflowId
      );
      return;
    }

    const abortController = this.abortControllers.get(workflowId);

    try {
      // 更新状态为 running
      workflow.status = 'running';
      workflow.updatedAt = Date.now();
      try {
        await workflowStorageWriter.saveWorkflow(workflow);
      } catch (e) {
        console.warn(
          '[WorkflowEngine] executeWorkflow: IDB 保存失败，继续:',
          e
        );
      }

      console.log('[WorkflowEngine] executeWorkflow: 状态已更新为 running');
      this.emitEvent({
        type: 'status',
        workflowId,
        status: 'running',
      });

      // 执行步骤
      await this.executeSteps(workflow, abortController?.signal);

      // 检查是否所有步骤都完成
      const allCompleted = workflow.steps.every(
        (s) => s.status === 'completed' || s.status === 'skipped'
      );
      const hasFailed = workflow.steps.some((s) => s.status === 'failed');

      if (hasFailed && !this.options.continueOnError) {
        workflow.status = 'failed';
        workflow.error = getFirstError(workflow);
      } else if (allCompleted) {
        workflow.status = 'completed';
        workflow.completedAt = Date.now();
      }

      workflow.updatedAt = Date.now();
      await workflowStorageWriter.saveWorkflow(workflow);

      if (workflow.status === 'completed') {
        this.emitEvent({
          type: 'completed',
          workflowId,
          workflow,
        });
      } else if (workflow.status === 'failed') {
        this.emitEvent({
          type: 'failed',
          workflowId,
          error: workflow.error || 'Unknown error',
        });
      }
    } catch (error: any) {
      // 处理执行错误
      workflow.status = 'failed';
      workflow.error = error.message || 'Workflow execution failed';
      workflow.updatedAt = Date.now();
      await workflowStorageWriter.saveWorkflow(workflow);

      this.emitEvent({
        type: 'failed',
        workflowId,
        error: workflow.error || 'Workflow execution failed',
      });
    } finally {
      // 清理
      this.abortControllers.delete(workflowId);
    }
  }

  /**
   * 执行工作流步骤
   */
  private async executeSteps(
    workflow: Workflow,
    signal?: AbortSignal
  ): Promise<void> {
    // 循环执行，直到没有可执行的步骤
    let iteration = 0;
    while (true) {
      iteration++;
      if (signal?.aborted) {
        throw new Error('Workflow cancelled');
      }

      // 查找可执行的步骤
      const executableSteps = findExecutableSteps(workflow);

      if (executableSteps.length === 0) {
        break;
      }

      // 并行执行所有可执行的步骤
      await Promise.all(
        executableSteps.map((step) => this.executeStep(workflow, step, signal))
      );
    }
  }

  /**
   * 执行单个步骤
   */
  private async executeStep(
    workflow: Workflow,
    step: WorkflowStep,
    signal?: AbortSignal
  ): Promise<void> {
    console.log(
      '[WorkflowEngine] executeStep 开始:',
      step.mcp,
      'stepId:',
      step.id
    );
    const startTime = Date.now();

    // 更新步骤状态为 running
    step.status = 'running';
    workflow.updatedAt = Date.now();
    await workflowStorageWriter.saveWorkflow(workflow);

    this.emitEvent({
      type: 'step',
      workflowId: workflow.id,
      stepId: step.id,
      status: 'running',
    });

    try {
      // 根据工具类型执行
      await this.executeToolStep(workflow, step, signal);

      // 更新步骤状态为 completed
      step.status = 'completed';
      step.duration = Date.now() - startTime;
      workflow.updatedAt = Date.now();
      await workflowStorageWriter.saveWorkflow(workflow);

      this.emitEvent({
        type: 'step',
        workflowId: workflow.id,
        stepId: step.id,
        status: 'completed',
        result: step.result,
        duration: step.duration,
      });
    } catch (error: any) {
      // 更新步骤状态为 failed
      step.status = 'failed';
      step.error = error.message || 'Step execution failed';
      step.duration = Date.now() - startTime;
      workflow.updatedAt = Date.now();
      await workflowStorageWriter.saveWorkflow(workflow);

      this.emitEvent({
        type: 'step',
        workflowId: workflow.id,
        stepId: step.id,
        status: 'failed',
        error: step.error,
        duration: step.duration,
      });

      if (!this.options.continueOnError) {
        throw error;
      }
    }
  }

  /**
   * 执行工具步骤
   */
  private async executeToolStep(
    workflow: Workflow,
    step: WorkflowStep,
    signal?: AbortSignal
  ): Promise<void> {
    console.log(
      '[WorkflowEngine] executeToolStep:',
      step.mcp,
      'stepId:',
      step.id,
      'forceFallback:',
      this.options.forceFallbackExecutor
    );

    // 根据工具类型执行
    switch (step.mcp) {
      case 'generate_image': {
        // 使用独立的图片生成服务
        const result = await generateImage(step.args.prompt as string, {
          model: step.args.model as string | undefined,
          modelRef: (step.args.modelRef as ModelRef | null | undefined) || null,
          size: step.args.size as string | undefined,
          referenceImages: step.args.referenceImages as string[] | undefined,
          count: step.args.count as number | undefined,
          params: step.args.params as Record<string, unknown> | undefined,
          forceMainThread: this.options.forceFallbackExecutor,
          signal,
          onTaskCreated: (taskId) => {
            // 提前持久化 taskId，页面刷新后 useTaskWorkflowSync 可通过此映射匹配事件
            step.result = { taskId };
            workflowStorageWriter.saveWorkflow(workflow);
          },
        });

        if (result.task.status === TaskStatus.FAILED) {
          throw new Error(
            result.task.error?.message || 'Image generation failed'
          );
        }

        step.result = { ...result.task.result, taskId: result.task.id };
        break;
      }

      case 'generate_video': {
        // 使用独立的视频生成服务
        const result = await generateVideo(step.args.prompt as string, {
          model: step.args.model as string | undefined,
          modelRef: (step.args.modelRef as ModelRef | null | undefined) || null,
          duration: (step.args.seconds ?? step.args.duration) as
            | string
            | number
            | undefined,
          size: step.args.size as string | undefined,
          referenceImages: step.args.referenceImages as string[] | undefined,
          params: step.args.params as Record<string, unknown> | undefined,
          forceMainThread: this.options.forceFallbackExecutor,
          signal,
          onTaskCreated: (taskId) => {
            // 提前持久化 taskId，页面刷新后 useTaskWorkflowSync 可通过此映射匹配事件
            step.result = { taskId };
            workflowStorageWriter.saveWorkflow(workflow);
          },
        });

        if (result.task.status === TaskStatus.FAILED) {
          throw new Error(
            result.task.error?.message || 'Video generation failed'
          );
        }

        step.result = { ...result.task.result, taskId: result.task.id };
        break;
      }

      case 'ai_analyze': {
        // AI 分析任务（不写入 tasks 表，chat 类型不应该出现在用户任务列表）
        // 注意：ai_analyze 必须使用降级执行器（主线程执行），因为需要立即返回结果和 addSteps
        // SW 执行器的 fire-and-forget 模式无法满足这个需求

        // 强制使用降级执行器，确保结果立即返回
        const fallbackExecutor = executorFactory.getFallbackExecutor();
        const taskId = step.id;
        const analyzeResult = await fallbackExecutor.aiAnalyze(
          {
            taskId,
            // 支持 messages 或 prompt
            messages: step.args.messages as AIAnalyzeParams['messages'],
            prompt: step.args.prompt as string | undefined,
            // 支持 referenceImages 或 images
            referenceImages: step.args.referenceImages as string[] | undefined,
            images: step.args.images as string[] | undefined,
            // 支持 textModel 或 model
            textModel: step.args.textModel as string | undefined,
            model: step.args.model as string | undefined,
            modelRef:
              (step.args.modelRef as ModelRef | null | undefined) || null,
          },
          { signal }
        );

        step.result = { content: analyzeResult.content };

        // 处理动态添加的步骤（AI 规划的后续任务）
        if (analyzeResult.addSteps && analyzeResult.addSteps.length > 0) {
          for (const newStep of analyzeResult.addSteps) {
            // 去重检查
            if (!workflow.steps.find((s) => s.id === newStep.id)) {
              workflow.steps.push({
                id: newStep.id,
                mcp: newStep.mcp,
                args: newStep.args,
                description: newStep.description,
                status: newStep.status,
              });
            }
          }
          // 保存工作流状态（包含新步骤）
          await workflowStorageWriter.saveWorkflow(workflow);
          // 通知 UI 有新步骤被添加
          this.emitEvent({
            type: 'steps_added',
            workflowId: workflow.id,
            steps: workflow.steps.filter((s) => s.status === 'pending'),
          });
        } else if (analyzeResult.content && analyzeResult.content.trim()) {
          // 路径 C（角色扮演模式）：AI 返回纯文本，没有工具调用
          // 自动添加 insert_to_canvas 步骤，将文本以 markdown 方式插入画布
          const insertStepId = `${step.id}-insert-text`;
          if (!workflow.steps.find((s) => s.id === insertStepId)) {
            // 将用户输入的 rawInput 作为一级标题，拼接在 AI 回复内容前面
            const rawInput = (workflow as any).metadata?.rawInput || '';
            const titlePrefix = rawInput.trim()
              ? `# ${rawInput.trim()}\n\n`
              : '';
            const insertStep: WorkflowStep = {
              id: insertStepId,
              mcp: 'insert_to_canvas',
              args: {
                items: [
                  {
                    type: 'text',
                    content: titlePrefix + analyzeResult.content,
                  },
                ],
              },
              description: '将 AI 回复插入画布',
              status: 'pending',
            };
            workflow.steps.push(insertStep);
            await workflowStorageWriter.saveWorkflow(workflow);
            // 通知 UI 有新步骤被添加
            this.emitEvent({
              type: 'steps_added',
              workflowId: workflow.id,
              steps: [insertStep],
            });
          }
        }
        break;
      }

      // 主线程工具（需要访问 Board/Canvas 或由 swCapabilitiesHandler 统一处理，与 SW 工具集一致）
      case 'generate_grid_image':
      case 'generate_inspiration_board':
      case 'split_image':
      case 'generate_long_video':
      case 'insert_mermaid':
      case 'insert_mindmap':
      case 'insert_svg':
      case 'canvas_insert':
      case 'insert_to_canvas': {
        if (!this.options.executeMainThreadTool) {
          throw new Error(
            `No main thread tool executor configured for: ${step.mcp}`
          );
        }

        const toolResult = await this.options.executeMainThreadTool(
          step.mcp,
          step.args
        );

        if (!toolResult.success) {
          throw new Error(toolResult.error || `${step.mcp} failed`);
        }

        step.result = toolResult.result;
        break;
      }

      default:
        throw new Error(`Unknown tool: ${step.mcp}`);
    }
  }

  /**
   * 发送事件
   */
  private emitEvent(event: WorkflowEvent): void {
    this.events$.next(event);
  }

  /**
   * 销毁引擎
   */
  destroy(): void {
    // 取消所有正在执行的工作流
    for (const [workflowId, abortController] of this.abortControllers) {
      abortController.abort();
    }
    this.abortControllers.clear();
    this.workflows.clear();
    this.events$.complete();
  }
}

// Re-export createWorkflow from workflow-factory
export { createWorkflow } from './workflow-factory';
