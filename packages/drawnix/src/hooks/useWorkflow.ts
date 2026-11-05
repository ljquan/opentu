import type { TaskError } from '../types/shared/core.types';
/**
 * useWorkflow Hook
 * 
 * 管理工作流状态，提供工作流执行和状态更新功能
 */

import { useState, useCallback, useRef } from 'react';
import type { 
  WorkflowDefinition, 
  WorkflowStep 
} from '../components/ai-input-bar/workflow-converter';
import {
  updateStepStatus,
  addStepsToWorkflow,
  getWorkflowStatus,
  parseAIResponse,
} from '../components/ai-input-bar/workflow-converter';

export interface WorkflowState {
  /** 当前工作流 */
  workflow: WorkflowDefinition | null;
  /** 工作流执行状态 */
  status: 'idle' | 'running' | 'completed' | 'failed';
  /** 当前执行的步骤 */
  currentStep: WorkflowStep | null;
  /** 已完成步骤数 */
  completedSteps: number;
  /** 总步骤数 */
  totalSteps: number;
  /** 错误信息 */
  error: string | null;
}

export interface UseWorkflowReturn {
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
  /** 添加新步骤（Agent 流程动态添加） */
  addSteps: (steps: WorkflowStep[]) => void;
  /** 从 AI 响应解析并添加步骤，返回解析结果 */
  addStepsFromAIResponse: (response: string) => { content: string; steps: WorkflowStep[] };
  /** 重置工作流 */
  resetWorkflow: () => void;
  /** 中止工作流 */
  abortWorkflow: () => void;
  /** 恢复工作流（重置 aborted 标志，允许后续 updateStep 生效） */
  resumeWorkflow: () => void;
  /** 获取工作流 */
  getWorkflow: () => WorkflowDefinition | null;
}

const initialState: WorkflowState = {
  workflow: null,
  status: 'idle',
  currentStep: null,
  completedSteps: 0,
  totalSteps: 0,
  error: null,
};

/**
 * 工作流管理 Hook
 */
export function useWorkflow(): UseWorkflowReturn {
  const [state, setState] = useState<WorkflowState>(initialState);
  const workflowRef = useRef<WorkflowDefinition | null>(null);
  const abortedRef = useRef(false);

  /**
   * 开始执行工作流
   */
  const startWorkflow = useCallback((workflow: WorkflowDefinition) => {
    workflowRef.current = workflow;
    abortedRef.current = false;
    
    const workflowStatus = getWorkflowStatus(workflow);
    
    setState({
      workflow,
      status: 'running',
      currentStep: workflowStatus.currentStep || null,
      completedSteps: workflowStatus.completedSteps,
      totalSteps: workflowStatus.totalSteps,
      error: null,
    });
  }, []);

  /**
   * 恢复工作流（用于页面刷新后恢复状态，不触发执行）
   * 与 startWorkflow 不同，这个只恢复 UI 状态
   */
  const restoreWorkflow = useCallback((workflow: WorkflowDefinition) => {
    workflowRef.current = workflow;
    abortedRef.current = false;
    
    const workflowStatus = getWorkflowStatus(workflow);
    
    // 根据工作流当前状态确定显示状态
    let displayStatus: WorkflowState['status'] = 'running';
    if (workflow.status === 'completed') {
      displayStatus = 'completed';
    } else if (workflow.status === 'failed') {
      displayStatus = 'failed';
    } else if (workflow.status === 'cancelled') {
      displayStatus = 'failed';
    }
    
    setState({
      workflow,
      status: displayStatus,
      currentStep: workflowStatus.currentStep || null,
      completedSteps: workflowStatus.completedSteps,
      totalSteps: workflowStatus.totalSteps,
      error: workflow.error || null,
    });
  }, []);

  /**
   * 更新步骤状态
   */
  const updateStep = useCallback((
    stepId: string,
    status: WorkflowStep['status'],
    result?: unknown,
    error?: string,
    duration?: number,
    errorDetails?: TaskError
  ) => {
    if (abortedRef.current) return;

    // 先从 ref 获取当前工作流，确保获取最新状态
    const currentWorkflow = workflowRef.current;
    if (!currentWorkflow) return;

    // 立即更新 ref，确保 getWorkflow() 能获取最新状态
    const updatedWorkflow = updateStepStatus(
      currentWorkflow,
      stepId,
      status,
      result,
      error,
      duration,
      errorDetails
    );
    workflowRef.current = updatedWorkflow;

    // 然后更新 React state 触发重新渲染
    setState(prev => {
      const workflowStatus = getWorkflowStatus(updatedWorkflow);

      // 确定整体状态
      let overallStatus: WorkflowState['status'] = 'running';
      if (workflowStatus.status === 'completed') {
        overallStatus = 'completed';
      } else if (workflowStatus.status === 'failed') {
        overallStatus = 'failed';
      }

      return {
        ...prev,
        workflow: updatedWorkflow,
        status: overallStatus,
        currentStep: workflowStatus.currentStep || null,
        completedSteps: workflowStatus.completedSteps,
        totalSteps: workflowStatus.totalSteps,
        error: error || prev.error,
      };
    });
  }, []);

  /**
   * 添加新步骤
   */
  const addSteps = useCallback((steps: WorkflowStep[]) => {
    if (abortedRef.current || steps.length === 0) return;

    // 先从 ref 获取当前工作流，确保获取最新状态
    const currentWorkflow = workflowRef.current;
    if (!currentWorkflow) return;

    // 立即更新 ref，确保 getWorkflow() 能获取最新状态
    const updatedWorkflow = addStepsToWorkflow(currentWorkflow, steps);
    workflowRef.current = updatedWorkflow;

    // 然后更新 React state 触发重新渲染
    setState(prev => {
      const workflowStatus = getWorkflowStatus(updatedWorkflow);

      return {
        ...prev,
        workflow: updatedWorkflow,
        currentStep: workflowStatus.currentStep || prev.currentStep,
        totalSteps: workflowStatus.totalSteps,
      };
    });
  }, []);

  /**
   * 从 AI 响应解析并添加步骤，同时更新 AI 分析内容
   */
  const addStepsFromAIResponse = useCallback((response: string): { content: string; steps: WorkflowStep[] } => {
    const currentWorkflow = workflowRef.current;
    if (!currentWorkflow || abortedRef.current) return { content: '', steps: [] };

    const existingStepCount = currentWorkflow.steps.length;
    const { content, steps: newSteps } = parseAIResponse(response, existingStepCount);

    // 更新 AI 分析内容
    if (content && !currentWorkflow.aiAnalysis) {
      workflowRef.current = {
        ...currentWorkflow,
        aiAnalysis: content,
      };
    }

    if (newSteps.length > 0) {
      addSteps(newSteps);
    }

    return { content, steps: newSteps };
  }, [addSteps]);

  /**
   * 重置工作流
   */
  const resetWorkflow = useCallback(() => {
    workflowRef.current = null;
    abortedRef.current = false;
    setState(initialState);
  }, []);

  /**
   * 中止工作流
   */
  const abortWorkflow = useCallback(() => {
    abortedRef.current = true;
    setState(prev => ({
      ...prev,
      status: 'failed',
      error: '工作流已中止',
    }));
  }, []);

  /**
   * 恢复工作流（重置 aborted 标志，允许后续 updateStep 生效）
   * 用于任务队列重试时，重新激活已中止的工作流
   */
  const resumeWorkflow = useCallback(() => {
    abortedRef.current = false;
    setState(prev => ({ ...prev, status: 'running', error: null }));
  }, []);

  /**
   * 获取当前工作流
   */
  const getWorkflow = useCallback(() => {
    return workflowRef.current;
  }, []);

  return {
    state,
    startWorkflow,
    restoreWorkflow,
    updateStep,
    addSteps,
    addStepsFromAIResponse,
    resetWorkflow,
    abortWorkflow,
    resumeWorkflow,
    getWorkflow,
  };
}

export default useWorkflow;
