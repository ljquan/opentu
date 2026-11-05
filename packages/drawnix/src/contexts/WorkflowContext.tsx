import type { TaskError } from '../types/shared/core.types';
/**
 * Workflow Context
 * 
 * 提供工作流状态的全局访问，使 AIInputBar 和 ChatDrawer 可以共享工作流状态
 */

import React, { createContext, useContext, useCallback, useMemo } from 'react';
import { useWorkflow, type WorkflowState, type UseWorkflowReturn } from '../hooks/useWorkflow';
import type { WorkflowDefinition, WorkflowStep } from '../components/ai-input-bar/workflow-converter';

interface WorkflowContextValue {
  /** 工作流状态 */
  state: WorkflowState;
  /** 开始执行工作流 */
  startWorkflow: (workflow: WorkflowDefinition) => void;
  /** 恢复工作流（用于页面刷新后恢复状态，不触发执行） */
  restoreWorkflow: (workflow: WorkflowDefinition) => void;
  /** 更新步骤状态 */
  updateStep: (
    stepId: string,
    status: WorkflowStep['status'],
    result?: unknown,
    error?: string,
    duration?: number,
    errorDetails?: TaskError
  ) => void;
  /** 添加新步骤 */
  addSteps: (steps: WorkflowStep[]) => void;
  /** 从 AI 响应解析并添加步骤，返回解析结果 */
  addStepsFromAIResponse: (response: string) => { content: string; steps: WorkflowStep[] };
  /** 重置工作流 */
  resetWorkflow: () => void;
  /** 中止工作流 */
  abortWorkflow: () => void;
  /** 恢复工作流（重置 aborted 标志，允许后续 updateStep 生效） */
  resumeWorkflow: () => void;
  /** 获取当前工作流 */
  getWorkflow: () => WorkflowDefinition | null;
}

const WorkflowContext = createContext<WorkflowContextValue | null>(null);

export interface WorkflowProviderProps {
  children: React.ReactNode;
}

/**
 * Workflow Provider
 * 提供工作流状态管理
 */
export const WorkflowProvider: React.FC<WorkflowProviderProps> = ({ children }) => {
  const workflow = useWorkflow();

  const value = useMemo<WorkflowContextValue>(() => ({
    state: workflow.state,
    startWorkflow: workflow.startWorkflow,
    restoreWorkflow: workflow.restoreWorkflow,
    updateStep: workflow.updateStep,
    addSteps: workflow.addSteps,
    addStepsFromAIResponse: workflow.addStepsFromAIResponse,
    resetWorkflow: workflow.resetWorkflow,
    abortWorkflow: workflow.abortWorkflow,
    resumeWorkflow: workflow.resumeWorkflow,
    getWorkflow: workflow.getWorkflow,
  }), [
    workflow.state,
    workflow.startWorkflow,
    workflow.restoreWorkflow,
    workflow.updateStep,
    workflow.addSteps,
    workflow.addStepsFromAIResponse,
    workflow.resetWorkflow,
    workflow.abortWorkflow,
    workflow.resumeWorkflow,
    workflow.getWorkflow,
  ]);

  return (
    <WorkflowContext.Provider value={value}>
      {children}
    </WorkflowContext.Provider>
  );
};

/**
 * Hook to access Workflow context
 */
export function useWorkflowContext(): WorkflowContextValue {
  const context = useContext(WorkflowContext);
  if (!context) {
    throw new Error('useWorkflowContext must be used within a WorkflowProvider');
  }
  return context;
}

/**
 * Hook to get workflow state only (for display components)
 */
export function useWorkflowState(): WorkflowState {
  const { state } = useWorkflowContext();
  return state;
}

/**
 * Hook to get workflow control methods only (for action components)
 */
export function useWorkflowControl() {
  const context = useWorkflowContext();
  
  return {
    startWorkflow: context.startWorkflow,
    restoreWorkflow: context.restoreWorkflow,
    updateStep: context.updateStep,
    addSteps: context.addSteps,
    addStepsFromAIResponse: context.addStepsFromAIResponse,
    resetWorkflow: context.resetWorkflow,
    abortWorkflow: context.abortWorkflow,
    resumeWorkflow: context.resumeWorkflow,
    getWorkflow: context.getWorkflow,
  };
}

export default WorkflowContext;
