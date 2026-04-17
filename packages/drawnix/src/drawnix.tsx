import { Board, BoardChangeData, Wrapper } from '@plait-board/react-board';
import {
  PlaitBoard,
  PlaitBoardOptions,
  PlaitElement,
  PlaitPlugin,
  PlaitPointerType,
  PlaitTheme,
  Selection,
  ThemeColorMode,
  Viewport,
  BoardTransforms,
  getSelectedElements,
  getHitElementByPoint,
  toHostPoint,
  toViewBoxPoint,
  getViewportOrigination,
  RectangleClient,
  Transforms,
  type Point,
} from '@plait/core';
import React, { useState, useRef, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { withGroup } from '@plait/common';
import { withDraw, BasicShapes, DrawTransforms } from '@plait/draw';
import { MindThemeColors, withMind } from '@plait/mind';
import MobileDetect from 'mobile-detect';
import { withMindExtend } from './plugins/with-mind-extend';
import { withCommonPlugin } from './plugins/with-common';
import { PopupToolbar } from './components/toolbar/popup-toolbar/popup-toolbar';
import { UnifiedToolbar } from './components/toolbar/unified-toolbar';
import classNames from 'classnames';
import './styles/index.scss';
import { buildDrawnixHotkeyPlugin } from './plugins/with-hotkey';
import { withFreehand } from './plugins/freehand/with-freehand';
import { withPen } from './plugins/pen/with-pen';
import { buildPencilPlugin } from './plugins/with-pencil';
import {
  DrawnixBoard,
  DrawnixContext,
  DrawnixState,
  useDrawnix,
} from './hooks/use-drawnix';
import { ClosePencilToolbar } from './components/toolbar/pencil-mode-toolbar';
import { PencilSettingsToolbar, EraserSettingsToolbar } from './components/toolbar/pencil-settings-toolbar';
import { PenSettingsToolbar } from './components/toolbar/pen-settings-toolbar';
import { CleanConfirm } from './components/clean-confirm/clean-confirm';
import { buildTextLinkPlugin } from './plugins/with-text-link';
import { LinkPopup } from './components/popup/link-popup/link-popup';
import { I18nProvider } from './i18n';
import { withVideo, isVideoElement } from './plugins/with-video';
import {
  getAudioPlaybackSourceFromElement,
  getCanvasAudioPlaybackQueue,
  isAudioElement,
} from './data/audio';
import {
  AUDIO_PLAYLIST_CANVAS_AUDIO_ID,
  AUDIO_PLAYLIST_CANVAS_AUDIO_LABEL,
} from './types/audio-playlist.types';
import { UnifiedMediaViewer, type MediaItem as UnifiedMediaItem } from './components/shared/media-preview';
import { PlaitDrawElement } from '@plait/draw';
import { withTracking } from './plugins/tracking';
import { withUnknownElementFallback } from './plugins/with-unknown-element-fallback';
import { withTool } from './plugins/with-tool';
import { withToolFocus } from './plugins/with-tool-focus';
import { withToolResize } from './plugins/with-tool-resize';
import { withMultiResize } from './plugins/with-multi-resize';
import { withTextResize } from './plugins/with-text-resize';
import { withImageGenerationAnchor } from './plugins/with-image-generation-anchor';
import { withWorkZone } from './plugins/with-workzone';
import { MultiSelectionHandles } from './components/multi-selection-handles';
import { ActiveTaskWarning } from './components/task-queue/ActiveTaskWarning';
import { useTaskStorage } from './hooks/useTaskStorage';
import { useTaskExecutor } from './hooks/useTaskExecutor';
import { useAutoInsertToCanvas } from './hooks/useAutoInsertToCanvas';
import { useImageGenerationAnchorSync } from './hooks/useImageGenerationAnchorSync';
import { useBeforeUnload } from './hooks/useBeforeUnload';
import { ChatDrawer } from './components/chat-drawer';
import { ChatDrawerProvider, useChatDrawer } from './contexts/ChatDrawerContext';
import { ModelHealthProvider } from './contexts/ModelHealthContext';
import { fontManagerService } from './services/font-manager-service';
import { WorkflowProvider } from './contexts/WorkflowContext';
import { useWorkspace } from './hooks/useWorkspace';
import { workspaceService } from './services/workspace-service';
import { Board as WorkspaceBoard } from './types/workspace.types';
import { toolTestHelper } from './utils/tool-test-helper';
import { ViewNavigation } from './components/view-navigation';
import { AssetProvider } from './contexts/AssetContext';
import { AudioPlaylistProvider } from './contexts/AudioPlaylistContext';
import { initializeAssetIntegration } from './services/asset-integration-service';
import { ToolbarConfigProvider } from './hooks/use-toolbar-config';
import { AIInputBar } from './components/ai-input-bar';
import { VersionUpdatePrompt } from './components/version-update/version-update-prompt';
import { PerformancePanel } from './components/performance-panel';
import { QuickCreationToolbar } from './components/toolbar/quick-creation-toolbar/quick-creation-toolbar';
import { CacheQuotaProvider } from './components/cache-quota-provider/CacheQuotaProvider';
import { RecentColorsProvider } from './components/unified-color-picker';
import { GitHubSyncProvider } from './contexts/GitHubSyncContext';
import { SyncSettings } from './components/sync-settings';
import { usePencilCursor } from './hooks/usePencilCursor';
import { useToolFromUrl } from './hooks/useToolFromUrl';
import { withArrowLineAutoCompleteExtend } from './plugins/with-arrow-line-auto-complete-extend';
import { withFlowchartShortcut } from './plugins/with-flowchart-shortcut';
import { withFrame } from './plugins/with-frame';
import { withCard } from './plugins/with-card';
import { withCardResize } from './plugins/with-card-resize';
import { withAudioNode } from './plugins/with-audio-node';
import { withAudioNodeResize } from './plugins/with-audio-node-resize';
import { toolWindowService } from './services/tool-window-service';
import { BUILT_IN_TOOLS } from './constants/built-in-tools';
import { AutoCompleteShapePicker } from './components/auto-complete-shape-picker';
import { useAutoCompleteShapePicker } from './hooks/useAutoCompleteShapePicker';
import { ToolWinBoxManager } from './components/toolbox-drawer/ToolWinBoxManager';
import { withDefaultFill } from './plugins/with-default-fill';
import { withGradientFill } from './plugins/with-gradient-fill';
import { withFrameResize } from './plugins/with-frame-resize';
import { withLassoSelection } from './plugins/with-lasso-selection';
import { withLockedElement } from './plugins/with-locked-element';
import { API_AUTH_ERROR_EVENT, ApiAuthErrorDetail } from './utils/api-auth-error-event';
import { MessagePlugin } from 'tdesign-react';
import { calculateEditedImagePoints } from './utils/image';
import { isCardElement } from './types/card.types';
import { openCardInKnowledgeBase } from './utils/card-actions';
import { useI18n } from './i18n';
import { safeReload } from './utils/active-tasks';
import { CommandPalette } from './components/command-palette/command-palette';
import { CanvasSearch } from './components/canvas-search/canvas-search';
import { useTabSync } from './hooks/useTabSync';
import { CanvasAudioPlayer } from './components/audio-node-element/CanvasAudioPlayer';
import { canvasAudioPlaybackService } from './services/canvas-audio-playback-service';
import { useCanvasAudioPlaybackSelector } from './hooks/useCanvasAudioPlayback';
import { isAudioNodeElement } from './types/audio-node.types';
import { useProviderProfiles } from './hooks/use-provider-profiles';
import { modelPricingService } from './utils/model-pricing-service';

const TTDDialog = lazy(() => import('./components/ttd-dialog/ttd-dialog').then(module => ({ default: module.TTDDialog })));
const SettingsDialog = lazy(() => import('./components/settings-dialog/settings-dialog').then(module => ({ default: module.SettingsDialog })));
const ProjectDrawer = lazy(() => import('./components/project-drawer').then(module => ({ default: module.ProjectDrawer })));
const ToolboxDrawer = lazy(() => import('./components/toolbox-drawer/ToolboxDrawer').then(module => ({ default: module.ToolboxDrawer })));
const MediaLibraryModal = lazy(() => import('./components/media-library').then(module => ({ default: module.MediaLibraryModal })));
const BackupRestoreDialog = lazy(() => import('./components/backup-restore').then(module => ({ default: module.BackupRestoreDialog })));

export type DrawnixProps = {
  value: PlaitElement[];
  viewport?: Viewport;
  theme?: PlaitTheme;
  onChange?: (value: BoardChangeData) => void;
  onSelectionChange?: (selection: Selection | null) => void;
  onValueChange?: (value: PlaitElement[]) => void;
  onViewportChange?: (value: Viewport) => void;
  onThemeChange?: (value: ThemeColorMode) => void;
  afterInit?: (board: PlaitBoard) => void;
  /** Called when board is switched */
  onBoardSwitch?: (board: WorkspaceBoard) => void;
  /** Called when tab sync is needed (other tab modified data) */
  onTabSyncNeeded?: () => void;
  /** 数据是否已准备好（用于判断画布是否为空） */
  isDataReady?: boolean;
  /** 当前画板 ID（用于 tab 同步过滤） */
  currentBoardId?: string | null;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'>;

export const Drawnix: React.FC<DrawnixProps> = ({
  value,
  viewport,
  theme,
  onChange,
  onSelectionChange,
  onViewportChange,
  onThemeChange,
  onValueChange,
  afterInit,
  onBoardSwitch,
  onTabSyncNeeded,
  isDataReady = false,
  currentBoardId,
}) => {
  const options: PlaitBoardOptions = {
    readonly: false,
    hideScrollbar: false,
    disabledScrollOnNonFocus: false,
    themeColors: MindThemeColors,
  };

  // Initialize task storage synchronization
  const isTaskStorageReady = useTaskStorage();
  const providerProfiles = useProviderProfiles();

  const [appState, setAppState] = useState<DrawnixState>(() => {
    // TODO: need to consider how to maintenance the pointer state in future
    const md = new MobileDetect(window.navigator.userAgent);
    return {
      pointer: PlaitPointerType.hand,
      isMobile: md.mobile() !== null,
      isPencilMode: false,
      openDialogTypes: new Set(),
      dialogInitialData: null,
      openCleanConfirm: false,
      openSettings: false,
    };
  });

  const [board, setBoard] = useState<DrawnixBoard | null>(null);
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);
  const [toolboxDrawerOpen, setToolboxDrawerOpen] = useState(false);
  const [taskPanelExpanded, setTaskPanelExpanded] = useState(false);
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false);
  const [backupRestoreOpen, setBackupRestoreOpen] = useState(false);
  const [cloudSyncOpen, setCloudSyncOpen] = useState(false);

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

  // 使用 ref 来保存 board 的最新引用,避免 useCallback 依赖问题
  const boardRef = useRef<DrawnixBoard | null>(null);

  // 关闭所有抄屉
  const closeAllDrawers = useCallback(() => {
    setProjectDrawerOpen(false);
    setToolboxDrawerOpen(false);
    setTaskPanelExpanded(false);
    setMediaLibraryOpen(false);
  }, []);
  // 获取知识库工具定义
  const kbTool = BUILT_IN_TOOLS.find(t => t.id === 'knowledge-base')!;

  // 处理知识库切换（通过 WinBox 打开）
  const handleKnowledgeBaseToggle = useCallback(() => {
    const state = toolWindowService.getToolState('knowledge-base');
    if (state && state.status === 'open') {
      toolWindowService.closeTool('knowledge-base');
    } else {
      toolWindowService.openTool(kbTool);
    }
  }, [kbTool]);

  // 监听 kb:open 事件，支持从 popup-toolbar 等外部打开知识库并定位到指定笔记
  useEffect(() => {
    const handleKBOpen = (e: Event) => {
      const { noteId } = (e as CustomEvent<{ noteId?: string }>).detail;
      const isAlreadyOpen = toolWindowService.isToolOpen(kbTool.id);
      toolWindowService.openTool(kbTool, {
        componentProps: noteId ? { initialNoteId: noteId } : {},
      });
      // 如果知识库已经打开，initialNoteId prop 不会触发重新定位
      // 需要额外发送 kb:open-note 事件让已挂载的组件动态定位
      if (isAlreadyOpen && noteId) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('kb:open-note', { detail: { noteId } }));
        }, 50);
      }
    };
    window.addEventListener('kb:open', handleKBOpen);
    return () => window.removeEventListener('kb:open', handleKBOpen);
  }, [kbTool]);

  // 处理项目抽屉切换（互斥逻辑）
  const handleProjectDrawerToggle = useCallback(() => {
    setProjectDrawerOpen((prev) => {
      if (!prev) closeAllDrawers();
      return !prev;
    });
  }, [closeAllDrawers]);

  // 处理工具箱抽屉切换（互斥逻辑）
  const handleToolboxDrawerToggle = useCallback(() => {
    setToolboxDrawerOpen((prev) => {
      if (!prev) closeAllDrawers();
      return !prev;
    });
  }, [closeAllDrawers]);

  // 处理任务面板切换（互斥逻辑）
  const handleTaskPanelToggle = useCallback(() => {
    setTaskPanelExpanded((prev) => {
      if (!prev) closeAllDrawers();
      return !prev;
    });
  }, [closeAllDrawers]);

  // 打开素材库（用于缓存满提示）
  const handleOpenMediaLibrary = useCallback(() => {
    closeAllDrawers();
    setMediaLibraryOpen(true);
  }, [closeAllDrawers]);

  // 使用 useCallback 稳定 setAppState 函数引用，支持函数式更新
  const stableSetAppState = useCallback((newAppState: DrawnixState | ((prev: DrawnixState) => DrawnixState)) => {
    if (typeof newAppState === 'function') {
      setAppState(newAppState);
    } else {
      setAppState(newAppState);
    }
  }, []);

  const updateAppState = useCallback((newAppState: Partial<DrawnixState>) => {
    setAppState(prevState => ({
      ...prevState,
      ...newAppState,
    }));
  }, []);

  // 使用 useEffect 来更新 board.appState 和 boardRef，避免在每次渲染时执行
  useEffect(() => {
    if (board) {
      board.appState = appState;
      (board as any).__setAppState = stableSetAppState;
      boardRef.current = board;
    }
  }, [board, appState, stableSetAppState]);

  // Initialize asset integration service on mount
  useEffect(() => {
    const cleanup = initializeAssetIntegration();
    return cleanup;
  }, []);

  // 预加载画布中使用的字体（当 value 变化时）
  // 延迟执行以避免阻塞首屏渲染
  useEffect(() => {
    if (value && value.length > 0) {
      const preloadFonts = () => {
        fontManagerService.preloadBoardFonts(value).then(() => {
          // 字体加载完成后，强制重新渲染
          // PlaitBoard 没有 redraw 方法，字体加载后会自动应用
        }).catch(error => {
          console.warn('Failed to preload board fonts:', error);
        });
      };

      // 延迟字体预加载，优先渲染画布
      if ('requestIdleCallback' in window) {
        (window as Window).requestIdleCallback(preloadFonts, { timeout: 2000 });
      } else {
        setTimeout(preloadFonts, 300);
      }
    }
  }, [value]);

  // Initialize video recovery service to restore expired blob URLs
  // 延迟执行以避免阻塞首屏渲染
  useEffect(() => {
    if (board) {
      const initVideoRecovery = () => {
        import('./services/video-recovery-service').then(({ initVideoRecoveryService }) => {
          initVideoRecoveryService(board);
        });
      };

      if ('requestIdleCallback' in window) {
        (window as Window).requestIdleCallback(initVideoRecovery, { timeout: 3000 });
      } else {
        setTimeout(initVideoRecovery, 500);
      }
    }
  }, [board]);

  // Initialize fallback media executor to resume pending tasks
  useEffect(() => {
    if (!isTaskStorageReady) return;

    const resumeTasks = async () => {
      console.warn('[drawnix] resumeTasks: waiting for workflow recovery...');
      // Wait for workflow recovery to complete before resuming tasks,
      // so useTaskWorkflowSync can find the step mappings
      try {
        const { workflowRecoveryPromise } = await import('./hooks/useWorkflowSubmission');
        await Promise.race([
          workflowRecoveryPromise,
          new Promise<void>(resolve => setTimeout(resolve, 5000)),
        ]);
      } catch {
        // Continue even if import fails
      }
      console.warn('[drawnix] resumeTasks: workflow recovery done, calling resumePendingTasks');

      const [{ fallbackMediaExecutor }, { taskQueueService }] = await Promise.all([
        import('./services/media-executor/fallback-executor'),
        import('./services/task-queue')
      ]);
      const allTasks = taskQueueService.getAllTasks();
      console.warn('[drawnix] Starting resumePendingTasks, in-memory tasks:', allTasks.length);
      fallbackMediaExecutor.resumePendingTasks(
        (taskId, status, updates) => {
          console.warn(`[drawnix] resumePendingTasks callback: task=${taskId} status=${status}`);
          taskQueueService.updateTaskStatus(taskId, status, updates);
        },
        allTasks
      );
    };

    if ('requestIdleCallback' in window) {
      (window as Window).requestIdleCallback(resumeTasks, { timeout: 5000 });
    } else {
      setTimeout(resumeTasks, 1000);
    }
  }, [isTaskStorageReady]);

  // 监听 API 认证错误事件，自动打开设置对话框
  useEffect(() => {
    const handleApiAuthError = (event: Event) => {
      const customEvent = event as CustomEvent<ApiAuthErrorDetail>;
      const { message } = customEvent.detail;
      
      // 显示错误提示
      MessagePlugin.error({
        content: 'API Key 无效或已过期，请重新配置',
        duration: 5000,
      });
      
      console.error('[Drawnix] API auth error:', message);
      
      // 打开设置对话框
      setAppState(prev => ({ ...prev, openSettings: true }));
    };

    window.addEventListener(API_AUTH_ERROR_EVENT, handleApiAuthError);
    return () => {
      window.removeEventListener(API_AUTH_ERROR_EVENT, handleApiAuthError);
    };
  }, []);

  // Handle interrupted WorkZone elements after page refresh
  // Query task status from main-thread task queue and restore workflow state
  useEffect(() => {
    if (!isTaskStorageReady) return;

    if (board && value && value.length > 0) {
      const restoreWorkZones = async () => {
        const { WorkZoneTransforms } = await import('./plugins/with-workzone');
        const { TaskStatus } = await import('./types/task.types');

        // 数据迁移已移至 useTaskStorage 中统一处理（确保迁移在读取之前完成）

        const { taskQueueService } = await import('./services/task-queue');

        const workzones = WorkZoneTransforms.getAllWorkZones(board);

        for (const workzone of workzones) {
          const currentWorkflow = { ...workzone.workflow, steps: [...workzone.workflow.steps] };

          // 检查工作流是否已完成，如果是则自动删除 WorkZone
          const hasPendingOrRunningSteps = currentWorkflow.steps.some(
            step => step.status === 'running' || step.status === 'pending'
          );
          
          if (currentWorkflow.status === 'completed' && !hasPendingOrRunningSteps) {
            WorkZoneTransforms.removeWorkZone(board, workzone.id);
            continue;
          }

          const hasRunningSteps = hasPendingOrRunningSteps;
          if (!hasRunningSteps) continue;

          // Update steps based on task queue status
          const updatedSteps = currentWorkflow.steps.map(step => {
            if (step.status !== 'running' && step.status !== 'pending') {
              return step;
            }

            // Get taskId from step result
            const taskId = (step.result as { taskId?: string })?.taskId;
            if (!taskId) {
              // For media generation steps, keep status for fallback engine to resume
              const mediaGenerationSteps = ['generate_image', 'generate_video', 'generate_grid_image', 'generate_inspiration_board'];
              if (step.mcp === 'ai_analyze' || mediaGenerationSteps.includes(step.mcp)) {
                return step;
              }
              
              // For other steps without taskId (like insert_mindmap, insert_mermaid),
              // they are synchronous and should have completed before refresh
              if (step.status === 'running') {
                return {
                  ...step,
                  status: 'failed' as const,
                  error: '页面刷新导致中断，请删除后重新发起',
                };
              }
              return step;
            }

            // Query task status from task queue
            const task = taskQueueService.getTask(taskId);
            if (!task) {
              return {
                ...step,
                status: 'failed' as const,
                error: '任务未找到，请重试',
              };
            }

            // Update step status based on task status
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
              case TaskStatus.PENDING:
              case TaskStatus.PROCESSING:
                return step;
              default:
                return step;
            }
          });

          // Check if any steps were updated
          const hasChanges = updatedSteps.some((step, i) =>
            step.status !== currentWorkflow.steps[i]?.status
          );

          if (hasChanges) {
            WorkZoneTransforms.updateWorkflow(board, workzone.id, {
              steps: updatedSteps,
            });
          }
        }
      };

      // 使用 requestIdleCallback 延迟执行 WorkZone 恢复逻辑
      // 避免阻塞首屏渲染
      const scheduleRestore = () => {
        if ('requestIdleCallback' in window) {
          (window as Window).requestIdleCallback(() => {
            restoreWorkZones().catch(error => {
              console.error('[Drawnix] Failed to restore WorkZones:', error);
            });
          }, { timeout: 2000 });
        } else {
          setTimeout(() => {
            restoreWorkZones().catch(error => {
              console.error('[Drawnix] Failed to restore WorkZones:', error);
            });
          }, 500);
        }
      };

      scheduleRestore();
    }
  }, [board, isTaskStorageReady]); // Only run once when board is initialized and task storage is ready

  // Subscribe to workflow status updates from SW and sync to WorkZone
  // This ensures WorkZone UI stays in sync even after page refresh
  useEffect(() => {
    if (!board) return;

    let subscription: { unsubscribe: () => void } | null = null;

    const setupWorkflowSync = async () => {
      const workflowModule = await import('./services/workflow-submission-service');
      const { WorkZoneTransforms } = await import('./plugins/with-workzone');
      const { workflowSubmissionService } = workflowModule;

      // Subscribe to all workflow events
      subscription = workflowSubmissionService.subscribeToAllEvents((event) => {
        const workflowEvent = event as { 
          type: string; 
          workflowId: string; 
          stepId?: string; 
          status?: string; 
          result?: unknown; 
          error?: string; 
          duration?: number;
          steps?: Array<{ id: string; mcp: string; args: Record<string, unknown>; description: string; status: string }>;
        };
        // console.log('[Drawnix] Workflow event:', workflowEvent.type, workflowEvent.workflowId);
        
        // Find WorkZone with this workflow ID
        const workzones = WorkZoneTransforms.getAllWorkZones(board);
        const workzone = workzones.find(wz => wz.workflow.id === workflowEvent.workflowId);
        
        if (!workzone) {
          // console.log('[Drawnix] No WorkZone found for workflow:', workflowEvent.workflowId);
          return;
        }

        switch (workflowEvent.type) {
          case 'step': {
            // Update specific step status
            const updatedSteps = workzone.workflow.steps.map(step => {
              if (step.id === workflowEvent.stepId) {
                return {
                  ...step,
                  status: (workflowEvent.status || step.status) as 'pending' | 'running' | 'completed' | 'failed' | 'skipped',
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
            // Add new steps to workflow
            const newSteps = (workflowEvent.steps || []).map(step => ({
              id: step.id,
              mcp: step.mcp,
              args: step.args,
              description: step.description,
              status: step.status as 'pending' | 'running' | 'completed' | 'failed' | 'skipped',
            }));
            WorkZoneTransforms.updateWorkflow(board, workzone.id, {
              steps: [...workzone.workflow.steps, ...newSteps],
            });
            break;
          }

          case 'completed':
          case 'failed': {
            // Workflow completed or failed - update all pending/running steps
            const finalStatus = workflowEvent.type === 'completed' ? 'completed' : 'failed';
            const updatedSteps = workzone.workflow.steps.map(step => {
              if (step.status === 'running' || step.status === 'pending') {
                // For steps with taskId, don't force status change - let task queue handle it
                const stepResult = step.result as { taskId?: string } | undefined;
                if (stepResult?.taskId) {
                  return step;
                }
                return {
                  ...step,
                  status: finalStatus as 'completed' | 'failed',
                  error: workflowEvent.type === 'failed' ? workflowEvent.error : undefined,
                };
              }
              return step;
            });
            WorkZoneTransforms.updateWorkflow(board, workzone.id, {
              steps: updatedSteps,
            });
            break;
          }

          case 'recovered': {
            // Full workflow recovery - sync all steps and status
            const swWorkflow = (workflowEvent as any).workflow;
            if (swWorkflow) {
              WorkZoneTransforms.updateWorkflow(board, workzone.id, {
                steps: swWorkflow.steps,
                status: swWorkflow.status,
              });
            }
            break;
          }
        }
      });
    };

    setupWorkflowSync().catch(error => {
      console.error('[Drawnix] Failed to setup workflow sync:', error);
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, [board]);

  // Subscribe to task queue updates to sync WorkZone status
  // This handles real-time updates for tasks running in the background (e.g. video generation)
  useEffect(() => {
    if (!isTaskStorageReady || !board) return;

    let subscription: { unsubscribe: () => void } | null = null;

    const setupTaskQueueSync = async () => {
      const { taskQueueService } = await import('./services/task-queue');
      const { WorkZoneTransforms } = await import('./plugins/with-workzone');
      const { TaskStatus } = await import('./types/task.types');

      subscription = taskQueueService.observeTaskUpdates().subscribe((event) => {
        // Only care about task updates that might affect WorkZone steps
        if (event.type !== 'taskUpdated' && event.type !== 'taskCompleted' && event.type !== 'taskFailed') {
          return;
        }
        
        const task = event.task;
        if (!task) return;

        // Find WorkZone steps that are waiting for this task
        const workzones = WorkZoneTransforms.getAllWorkZones(board);
        
        for (const workzone of workzones) {
          const currentWorkflow = { ...workzone.workflow, steps: [...workzone.workflow.steps] };
          let hasChanges = false;
          
          const updatedSteps = currentWorkflow.steps.map(step => {
            const stepResult = step.result as { taskId?: string } | undefined;
            
            // Only update steps that are linked to this task
            if (stepResult?.taskId === task.id) {
              let newStatus = step.status;
              let newError = step.error;
              let newResult = step.result;

              // Map task status to step status
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
                  status: newStatus as any,
                  error: newError,
                  result: newResult
                };
              }
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

    setupTaskQueueSync().catch(console.error);

    return () => {
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, [board, isTaskStorageReady]);

  const plugins: PlaitPlugin[] = [
    withDraw,
    withGroup,
    withMind,
    withMindExtend,
    withCommonPlugin,
    buildDrawnixHotkeyPlugin(updateAppState),
    withFreehand,
    withPen,
    withTextResize, // 文本缩放 - 拖拽缩放文本框时连带字体大小等比缩放
    withMultiResize, // 多选缩放 - 支持 Freehand 和 PenPath 的多选缩放
    buildPencilPlugin(updateAppState),
    buildTextLinkPlugin(updateAppState),
    withVideo,
    withTool,
    withToolResize, // 工具缩放功能 - 拖拽缩放手柄
    withToolFocus, // 工具焦点管理 - 双击编辑
    withImageGenerationAnchor, // 生图锚点 - 结果对象化反馈的独立画布元素
    withWorkZone, // 工作区元素 - 在画布上显示工作流进度
    withArrowLineAutoCompleteExtend, // 自动完成形状选择 - hover 中点时选择下一个节点形状
    withFlowchartShortcut, // 流程图快速创建 - 方向键创建连接节点，Tab 导航
    withFrame, // Frame 容器 - 分组管理画布元素
    withFrameResize, // Frame 缩放 - 拖拽缩放 Frame 容器
    withCard, // Card 标签贴 - Markdown 粘贴和 Agent 输出的卡片展示
    withCardResize, // Card 缩放 - 拖拽缩放 Card 标签贴
    withAudioNode, // Audio Node - 画布内可播放的音频组件节点
    withAudioNodeResize, // Audio Node 缩放 - 拖拽缩放音频组件节点
    withDefaultFill, // 默认填充 - 让新创建的图形有白色填充，方便双击编辑
    withGradientFill, // 渐变填充 - 支持渐变和图片填充渲染
    withLassoSelection, // 套索选择 - 自由路径框选元素
    withLockedElement, // 锁定元素 - 阻止选中和移动被锁定的元素
    withTracking,
    withUnknownElementFallback, // 必须最后 — 捕获未知元素类型避免崩溃
  ];

  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize task executor for background processing
  useTaskExecutor();

  // Auto-insert completed tasks to canvas
  useAutoInsertToCanvas({ enabled: true, insertPrompt: false, groupSimilarTasks: true });

  // Image generation anchor sync skeleton
  useImageGenerationAnchorSync({ board, enabled: isTaskStorageReady });

  // Warn users before leaving page with active tasks
  useBeforeUnload();

  // Workspace management
  const { saveBoard, createBoard, switchBoard } = useWorkspace();

  // Handle saving before board switch
  const handleBeforeSwitch = useCallback(async () => {
    if (onChange && boardRef.current) {
      // Get current data and save
      const currentData = {
        children: boardRef.current.children || [],
        viewport: boardRef.current.viewport,
        theme: boardRef.current.theme,
      };
      await saveBoard(currentData);
    }
  }, [onChange, saveBoard]);

  // 创建新项目并刷新页面（用于释放内存）
  const handleCreateProjectForMemory = useCallback(async () => {
    // 先保存当前画布
    await handleBeforeSwitch();
    
    // 创建新画布
    const newBoard = await createBoard({
      name: '新画布',
    });
    
    if (newBoard) {
      // 切换到新画布
      await switchBoard(newBoard.id);
      
      // 延迟刷新页面，让用户看到切换效果
      setTimeout(() => {
        safeReload();
      }, 500);
    }
  }, [handleBeforeSwitch, createBoard, switchBoard]);

  // 处理选中状态变化,保存最近选中的元素IDs
  const handleSelectionChange = useCallback((selection: Selection | null) => {
    const currentBoard = boardRef.current;
    if (currentBoard && selection) {
      // 使用Plait的getSelectedElements函数来获取选中的元素
      const selectedElements = getSelectedElements(currentBoard);

      const elementIds = selectedElements.map((el: any) => el.id).filter(Boolean);

      // 更新lastSelectedElementIds（包括清空的情况）
      // console.log('Selection changed, saving element IDs:', elementIds);
      updateAppState({ lastSelectedElementIds: elementIds });
    }

    // 调用外部的onSelectionChange回调
    onSelectionChange && onSelectionChange(selection);
  }, [onSelectionChange, updateAppState]);

  // 使用 useMemo 稳定 DrawnixContext.Provider 的 value
  const contextValue = useMemo(() => ({
    appState,
    setAppState: stableSetAppState,
    board
  }), [appState, stableSetAppState, board]);

  return (
    <I18nProvider>
      <RecentColorsProvider>
        <AssetProvider>
          <AudioPlaylistProvider>
            <ToolbarConfigProvider>
              <CacheQuotaProvider onOpenMediaLibrary={handleOpenMediaLibrary}>
                <ModelHealthProvider>
                  <GitHubSyncProvider>
                    <ChatDrawerProvider>
                      <WorkflowProvider>
                        <DrawnixContext.Provider value={contextValue}>
                        <DrawnixContent
                        value={value}
                        viewport={viewport}
                        theme={theme}
                        options={options}
                        plugins={plugins}
                        containerRef={containerRef}
                        appState={appState}
                        board={board}
                        setBoard={setBoard}
                        projectDrawerOpen={projectDrawerOpen}
                        toolboxDrawerOpen={toolboxDrawerOpen}
                        taskPanelExpanded={taskPanelExpanded}
                        mediaLibraryOpen={mediaLibraryOpen}
                        backupRestoreOpen={backupRestoreOpen}
                        onChange={onChange}
                        onSelectionChange={handleSelectionChange}
                        onViewportChange={onViewportChange}
                        onThemeChange={onThemeChange}
                        onValueChange={onValueChange}
                        afterInit={afterInit}
                        onBoardSwitch={onBoardSwitch}
                        onTabSyncNeeded={onTabSyncNeeded}
                        handleProjectDrawerToggle={handleProjectDrawerToggle}
                        handleToolboxDrawerToggle={handleToolboxDrawerToggle}
                        handleKnowledgeBaseToggle={handleKnowledgeBaseToggle}
                        handleTaskPanelToggle={handleTaskPanelToggle}
                        setProjectDrawerOpen={setProjectDrawerOpen}
                        setToolboxDrawerOpen={setToolboxDrawerOpen}
                        setMediaLibraryOpen={setMediaLibraryOpen}
                        setBackupRestoreOpen={setBackupRestoreOpen}
                        cloudSyncOpen={cloudSyncOpen}
                        setCloudSyncOpen={setCloudSyncOpen}
                        handleBeforeSwitch={handleBeforeSwitch}
                        isDataReady={isDataReady}
                        onCreateProjectForMemory={handleCreateProjectForMemory}
                        currentBoardId={currentBoardId}
                      />
                      {mediaLibraryOpen && (
                        <Suspense fallback={null}>
                          <MediaLibraryModal
                            isOpen={mediaLibraryOpen}
                            onClose={() => setMediaLibraryOpen(false)}
                          />
                        </Suspense>
                      )}
                        </DrawnixContext.Provider>
                      </WorkflowProvider>
                    </ChatDrawerProvider>
                  </GitHubSyncProvider>
                </ModelHealthProvider>
              </CacheQuotaProvider>
            </ToolbarConfigProvider>
          </AudioPlaylistProvider>
        </AssetProvider>
      </RecentColorsProvider>
    </I18nProvider>
  );
};

// Internal component that uses ChatDrawer context
interface DrawnixContentProps {
  value: PlaitElement[];
  viewport?: Viewport;
  theme?: PlaitTheme;
  options: PlaitBoardOptions;
  plugins: PlaitPlugin[];
  containerRef: React.RefObject<HTMLDivElement>;
  appState: DrawnixState;
  board: DrawnixBoard | null;
  setBoard: React.Dispatch<React.SetStateAction<DrawnixBoard | null>>;
  projectDrawerOpen: boolean;
  toolboxDrawerOpen: boolean;
  taskPanelExpanded: boolean;
  mediaLibraryOpen: boolean;
  backupRestoreOpen: boolean;
  onChange?: (value: BoardChangeData) => void;
  onSelectionChange: (selection: Selection | null) => void;
  onViewportChange?: (value: Viewport) => void;
  onThemeChange?: (value: ThemeColorMode) => void;
  onValueChange?: (value: PlaitElement[]) => void;
  afterInit?: (board: PlaitBoard) => void;
  onBoardSwitch?: (board: WorkspaceBoard) => void;
  onTabSyncNeeded?: () => void;
  handleProjectDrawerToggle: () => void;
  handleToolboxDrawerToggle: () => void;
  handleKnowledgeBaseToggle: () => void;
  handleTaskPanelToggle: () => void;
  setProjectDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setToolboxDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setMediaLibraryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setBackupRestoreOpen: React.Dispatch<React.SetStateAction<boolean>>;
  cloudSyncOpen: boolean;
  setCloudSyncOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleBeforeSwitch: () => Promise<void>;
  isDataReady: boolean;
  onCreateProjectForMemory: () => Promise<void>;
  currentBoardId?: string | null;
}

const DrawnixContent: React.FC<DrawnixContentProps> = ({
  value,
  viewport,
  theme,
  options,
  plugins,
  containerRef,
  appState,
  board,
  setBoard,
  projectDrawerOpen,
  toolboxDrawerOpen,
  taskPanelExpanded,
  backupRestoreOpen,
  cloudSyncOpen,
  onChange,
  onSelectionChange,
  onViewportChange,
  onThemeChange,
  onValueChange,
  afterInit,
  onBoardSwitch,
  onTabSyncNeeded,
  handleProjectDrawerToggle,
  handleToolboxDrawerToggle,
  handleKnowledgeBaseToggle,
  handleTaskPanelToggle,
  setProjectDrawerOpen,
  setToolboxDrawerOpen,
  setBackupRestoreOpen,
  setCloudSyncOpen,
  handleBeforeSwitch,
  isDataReady,
  onCreateProjectForMemory,
  currentBoardId,
}) => {
  const { chatDrawerRef } = useChatDrawer();
  const { setAppState: updateState } = useDrawnix();
  const { language } = useI18n();
  const playbackError = useCanvasAudioPlaybackSelector((state) => state.error);
  const lastPlaybackErrorRef = useRef<string | undefined>(undefined);

  // 画笔自定义光标
  usePencilCursor({ board, pointer: appState.pointer });

  // 处理 URL 参数中的工具打开请求
  // 当访问 ?tool=xxx 时，自动以 WinBox 全屏形式打开指定工具并设为常驻
  useToolFromUrl();

  // 标签页同步
  useTabSync({
    onSyncNeeded: useCallback(() => {
      // 如果父组件提供了回调，使用无刷新同步
      if (onTabSyncNeeded) {
        onTabSyncNeeded();
      } else {
        // 否则降级到刷新页面（向后兼容）
        safeReload();
      }
    }, [onTabSyncNeeded]),
    enabled: true,
    currentBoardId,
  });

  // 快捷工具栏状态
  const [quickToolbarVisible, setQuickToolbarVisible] = useState(false);
  const [quickToolbarPosition, setQuickToolbarPosition] = useState<[number, number] | null>(null);

  // 浮动文本输入状态（文本工具单击画布时使用）
  const [inlineTextInput, setInlineTextInput] = useState<{
    screenX: number;
    screenY: number;
    worldPoint: Point;
    zoom: number;
  } | null>(null);
  const inlineTextRef = useRef<HTMLDivElement>(null);

  // 媒体预览状态
  const [mediaPreviewVisible, setMediaPreviewVisible] = useState(false);
  const [mediaPreviewItems, setMediaPreviewItems] = useState<UnifiedMediaItem[]>([]);
  const [mediaPreviewInitialIndex, setMediaPreviewInitialIndex] = useState(0);

  useEffect(() => {
    if (!playbackError) {
      lastPlaybackErrorRef.current = undefined;
      return;
    }

    if (playbackError === lastPlaybackErrorRef.current) {
      return;
    }

    lastPlaybackErrorRef.current = playbackError;
    MessagePlugin.error(playbackError);
  }, [playbackError]);

  useEffect(() => {
    canvasAudioPlaybackService.setCanvasQueue(getCanvasAudioPlaybackQueue(value));
  }, [value]);

  useEffect(() => {
    return () => {
      canvasAudioPlaybackService.stopAndClear();
    };
  }, []);

  // 收集画布上所有图片和视频元素
  const collectCanvasMediaItems = useCallback((): { items: UnifiedMediaItem[]; elementIds: string[] } => {
    if (!board || !board.children) return { items: [], elementIds: [] };

    const items: UnifiedMediaItem[] = [];
    const elementIds: string[] = [];

    for (const element of board.children) {
      const url = (element as any).url;
      if (!url || typeof url !== 'string') continue;

      if (isAudioElement(element)) {
        continue;
      }

      // 检查是否为图片元素
      const isImage = PlaitDrawElement.isDrawElement(element) && PlaitDrawElement.isImage(element);
      // 检查是否为视频元素
      const isVideo = isVideoElement(element);

      if (isImage || isVideo) {
        items.push({
          id: element.id,
          url,
          type: isVideo ? 'video' : 'image',
          title: (element as any).name || undefined,
        });
        elementIds.push(element.id);
      }
    }

    return { items, elementIds };
  }, [board]);

  // 打开媒体预览
  const openMediaPreview = useCallback((targetElementId: string) => {
    const { items, elementIds } = collectCanvasMediaItems();
    if (items.length === 0) return;

    const targetIndex = elementIds.indexOf(targetElementId);
    if (targetIndex === -1) return;

    setMediaPreviewItems(items);
    setMediaPreviewInitialIndex(targetIndex);
    setMediaPreviewVisible(true);
  }, [collectCanvasMediaItems]);

  // 关闭媒体预览
  const closeMediaPreview = useCallback(() => {
    setMediaPreviewVisible(false);
  }, []);

  // 处理图片编辑覆盖保存（内置编辑器回调）
  const handleMediaEditorOverwrite = useCallback(async (editedImageUrl: string, originalItem: UnifiedMediaItem) => {
    const elementId = originalItem.id;
    if (!elementId || !board) return;
    
    try {
      // 导入必要服务
      const { unifiedCacheService } = await import('./services/unified-cache-service');
      const { Transforms } = await import('@plait/core');
      
      const taskId = `edited-image-${Date.now()}`;
      const stableUrl = `/__aitu_cache__/image/${taskId}.png`;
      
      // 将 data URL 转换为 Blob
      const response = await fetch(editedImageUrl);
      const blob = await response.blob();
      
      // 缓存到 Cache API
      await unifiedCacheService.cacheMediaFromBlob(stableUrl, blob, 'image', { taskId });
      
      // 加载图片获取尺寸
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load edited image'));
        img.src = editedImageUrl;
      });
      
      // 找到元素并更新
      const elementIndex = board.children.findIndex(child => child.id === elementId);
      if (elementIndex >= 0) {
        const element = board.children[elementIndex] as any;
        const { newPoints } = await calculateEditedImagePoints(
          {
            url: element.url,
            width: element.width,
            height: element.height,
            points: element.points || [[0, 0], [0, 0]],
          },
          img.naturalWidth,
          img.naturalHeight
        );
        
        Transforms.setNode(board, {
          url: stableUrl,
          width: img.naturalWidth,
          height: img.naturalHeight,
          points: newPoints,
        } as any, [elementIndex]);
      }
    } catch (error) {
      console.error('Failed to update image:', error);
      MessagePlugin.error('更新失败');
    }
  }, [board]);

  // 处理图片编辑插入到画布
  const handleMediaEditorInsert = useCallback(async (editedImageUrl: string) => {
    if (!board) return;
    
    try {
      const { unifiedCacheService } = await import('./services/unified-cache-service');
      const { insertImageFromUrl } = await import('./data/image');
      
      const taskId = `edited-image-${Date.now()}`;
      const stableUrl = `/__aitu_cache__/image/${taskId}.png`;
      
      // 将 data URL 转换为 Blob
      const response = await fetch(editedImageUrl);
      const blob = await response.blob();
      
      // 缓存到 Cache API
      await unifiedCacheService.cacheMediaFromBlob(stableUrl, blob, 'image', { taskId });
      
      // 加载图片获取尺寸
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load edited image'));
        img.src = editedImageUrl;
      });
      
      // 在当前视口中心位置插入图片
      const origination = getViewportOrigination(board);
      const insertPoint: [number, number] = [
        (origination?.[0] ?? 0) + 100,
        (origination?.[1] ?? 0) + 100
      ];
      
      await insertImageFromUrl(
        board,
        stableUrl,
        insertPoint,
        false,
        { width: img.naturalWidth, height: img.naturalHeight },
        false,
        true
      );
    } catch (error) {
      console.error('Failed to insert image:', error);
      MessagePlugin.error('插入失败');
    }
  }, [board]);

  // 自动完成形状选择器状态
  const {
    state: autoCompleteState,
    selectShape: selectAutoCompleteShape,
    closePicker: closeAutoCompletePicker,
  } = useAutoCompleteShapePicker(board);

  // 浮动文本输入：自动聚焦
  useEffect(() => {
    if (inlineTextInput && inlineTextRef.current) {
      inlineTextRef.current.focus();
    }
  }, [inlineTextInput]);

  // 浮动文本输入：提交文本到画布
  const commitInlineText = useCallback(() => {
    if (!board || !inlineTextInput || !inlineTextRef.current) {
      setInlineTextInput(null);
      return;
    }
    const text = inlineTextRef.current.innerText || '';
    if (text.trim()) {
      DrawTransforms.insertText(board, inlineTextInput.worldPoint, text);
      
      // 修正可能的 Infinity 高度问题
      requestAnimationFrame(() => {
        const lastElement = board.children[board.children.length - 1];
        if (PlaitDrawElement.isText(lastElement)) {
          const textEl = lastElement as any;
          if (!isFinite(textEl.textHeight)) {
            const rect = RectangleClient.getRectangleByPoints(textEl.points);
            Transforms.setNode(board, { textHeight: rect.height }, [board.children.length - 1]);
          }
        }
      });
    }
    setInlineTextInput(null);
    BoardTransforms.updatePointerType(board, PlaitPointerType.selection);
    updateState(prev => ({ ...prev, pointer: PlaitPointerType.selection }));
  }, [board, inlineTextInput, updateState]);

  // 监听双击事件 - 处理图片/视频预览和空白区域快捷工具栏
  useEffect(() => {
    if (!board) return;

    const handleDoubleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // 只处理画布区域内的双击（正向判断，避免维护浮层组件列表）
      const isInsideCanvas = target.closest('.board-host-svg') ||
                             target.closest('.plait-board-container');

      if (!isInsideCanvas) {
        return;
      }

      // 检查双击位置是否命中了画布上的元素
      const viewBoxPoint = toViewBoxPoint(board, toHostPoint(board, event.clientX, event.clientY));
      const hitElement = getHitElementByPoint(board, viewBoxPoint);

      // 如果双击了 Card 元素，打开知识库
      if (hitElement && isCardElement(hitElement)) {
        openCardInKnowledgeBase(board, hitElement as any, language as 'zh' | 'en');
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      // 如果双击了图片或视频元素，打开预览
      if (hitElement) {
        if (isAudioElement(hitElement)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        const url = (hitElement as any).url;
        if (url && typeof url === 'string') {
          const isImage = PlaitDrawElement.isDrawElement(hitElement) && PlaitDrawElement.isImage(hitElement);
          const isVideo = isVideoElement(hitElement);

          if (isImage || isVideo) {
            // 打开媒体预览
            openMediaPreview(hitElement.id);
            event.preventDefault();
            event.stopPropagation();
            return;
          }
        }
      }

      // 如果命中了 Plait 元素，或者双击的是工具容器内部（针对 foreignObject 元素）
      const isInsideInteractive = target.closest('.plait-tool-container') || 
                                   target.closest('.plait-workzone-container') ||
                                   target.closest('foreignObject');

      // 只有双击空白区域时才处理
      if (!hitElement && !isInsideInteractive) {
        const position: [number, number] = [event.clientX, event.clientY];
        setQuickToolbarPosition(position);
        setQuickToolbarVisible(true);
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('dblclick', handleDoubleClick);
    }

    return () => {
      if (container) {
        container.removeEventListener('dblclick', handleDoubleClick);
      }
    };
  }, [board, containerRef, openMediaPreview, language]);

  // 监听画板点击事件，关闭项目抽屉和工具箱抽屉
  useEffect(() => {
    if (!board) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // 只处理画布区域内的点击
      const isInsideCanvas = target.closest('.board-host-svg') ||
                             target.closest('.plait-board-container');

      if (!isInsideCanvas) {
        return;
      }

      const viewBoxPoint = toViewBoxPoint(
        board,
        toHostPoint(board, event.clientX, event.clientY)
      );
      const hitElement = getHitElementByPoint(board, viewBoxPoint);

      if (
        hitElement &&
        isAudioElement(hitElement) &&
        !isAudioNodeElement(hitElement)
      ) {
        const playbackSource = getAudioPlaybackSourceFromElement(hitElement);
        if (playbackSource) {
          event.preventDefault();
          event.stopPropagation();
          void canvasAudioPlaybackService.togglePlaybackInQueue(
            playbackSource,
            getCanvasAudioPlaybackQueue(board.children),
            {
              queueSource: 'canvas',
              queueId: AUDIO_PLAYLIST_CANVAS_AUDIO_ID,
              queueName: AUDIO_PLAYLIST_CANVAS_AUDIO_LABEL,
            }
          ).catch(() => {
            // Error feedback is surfaced from the playback store.
          });
          return;
        }
      }

      // 文本工具激活时：单击空白区域显示浮动文本输入
      if (PlaitBoard.isPointer(board, BasicShapes.text)) {
        const isInsideInteractive = target.closest('.plait-tool-container') ||
                                     target.closest('.plait-workzone-container') ||
                                     target.closest('foreignObject');
        if (!isInsideInteractive) {
          if (!hitElement) {
            setInlineTextInput({
              screenX: event.clientX,
              screenY: event.clientY,
              worldPoint: viewBoxPoint,
              zoom: board.viewport.zoom,
            });
            event.preventDefault();
            event.stopPropagation();
            return;
          }
        }
      }

      // 关闭项目抽屉和工具箱抽屉
      if (projectDrawerOpen) {
        setProjectDrawerOpen(false);
      }
      if (toolboxDrawerOpen) {
        setToolboxDrawerOpen(false);
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('click', handleClick);
    }

    return () => {
      if (container) {
        container.removeEventListener('click', handleClick);
      }
    };
  }, [board, containerRef, projectDrawerOpen, toolboxDrawerOpen, setProjectDrawerOpen, setToolboxDrawerOpen]);

  return (
    <div
      className={classNames('drawnix', {
        'drawnix--mobile': appState.isMobile,
      })}
      ref={containerRef}
    >
      <div className="drawnix__main">
        <Wrapper
          value={value}
          viewport={viewport}
          theme={theme}
          options={options}
          plugins={plugins}
          onChange={(data: BoardChangeData) => {
            onChange && onChange(data);
          }}
          onSelectionChange={onSelectionChange}
          onViewportChange={onViewportChange}
          onThemeChange={onThemeChange}
          onValueChange={onValueChange}
        >
          <Board
            afterInit={(board) => {
              setBoard(board as DrawnixBoard);
              // 挂载 board 实例到 window，供知识库等外部模块访问
              (window as any).__drawnixBoard = board;
              // 设置测试助手的 board 实例（仅开发环境）
              if (process.env.NODE_ENV === 'development') {
                toolTestHelper.setBoard(board);
              }

              // 预加载画布中使用的字体
              if (board.children && board.children.length > 0) {
                fontManagerService.preloadBoardFonts(board.children).catch(error => {
                  console.warn('Failed to preload board fonts:', error);
                });
              }

              afterInit && afterInit(board);

              // 手动触发 afterChange 以初始化渐变填充等插件
              // listRender.initialize() 不会触发 afterChange，
              // 需要确保 withGradientFill 等依赖 afterChange 的插件逻辑被执行
              if (board.afterChange) {
                board.afterChange();
              }
            }}
          ></Board>
          {/* 多选时的缩放控制点 */}
          <MultiSelectionHandles />
          {/* 统一左侧工具栏 (桌面端和移动端一致) */}
          <UnifiedToolbar
            projectDrawerOpen={projectDrawerOpen}
            onProjectDrawerToggle={handleProjectDrawerToggle}
            toolboxDrawerOpen={toolboxDrawerOpen}
            onToolboxDrawerToggle={handleToolboxDrawerToggle}
            taskPanelExpanded={taskPanelExpanded}
            onTaskPanelToggle={handleTaskPanelToggle}
            onOpenBackupRestore={() => setBackupRestoreOpen(true)}
            onOpenCloudSync={() => setCloudSyncOpen(true)}
            onKnowledgeBaseToggle={handleKnowledgeBaseToggle}
          />
          <CanvasAudioPlayer />

          <PopupToolbar></PopupToolbar>
          <LinkPopup></LinkPopup>
          <ClosePencilToolbar></ClosePencilToolbar>
          <PencilSettingsToolbar></PencilSettingsToolbar>
          <PenSettingsToolbar></PenSettingsToolbar>
          <EraserSettingsToolbar></EraserSettingsToolbar>
          {appState.openDialogTypes.size > 0 && (
            <Suspense fallback={null}>
              <TTDDialog container={containerRef.current}></TTDDialog>
            </Suspense>
          )}
          <CleanConfirm container={containerRef.current}></CleanConfirm>
          {appState.openSettings && (
            <Suspense fallback={null}>
              <SettingsDialog container={containerRef.current}></SettingsDialog>
            </Suspense>
          )}
          {backupRestoreOpen && (
            <Suspense fallback={null}>
              <BackupRestoreDialog
                open={backupRestoreOpen}
                onOpenChange={setBackupRestoreOpen}
                container={containerRef.current}
                onBeforeImport={async () => {
                  // 导入前先保存当前画板数据到 IndexedDB
                  if (handleBeforeSwitch) {
                    await handleBeforeSwitch();
                  }
                }}
                onSwitchBoard={async (boardId, viewport) => {
                  // 注意：这里不调用 handleBeforeSwitch
                  // 因为在备份恢复时，onBeforeImport 已经保存了当前画板
                  // 如果在这里再保存，会用旧的内存数据覆盖 IndexedDB 中刚合并的新数据
                  
                  // 切换到目标画板（使用已导入的 workspaceService 单例，确保数据一致性）
                  const board = await workspaceService.switchBoard(boardId);
                  if (board && onBoardSwitch) {
                    // 如果有 viewport，合并到 board 中
                    if (viewport) {
                      board.viewport = viewport;
                    }
                    onBoardSwitch(board);
                  }
                }}
              />
            </Suspense>
          )}
          {/* Cloud Sync Settings - 云端同步设置 */}
          <SyncSettings
            visible={cloudSyncOpen}
            onClose={() => setCloudSyncOpen(false)}
          />
          {/* Quick Creation Toolbar - 双击空白区域显示的快捷工具栏 */}
          <QuickCreationToolbar
            position={quickToolbarPosition}
            visible={quickToolbarVisible}
            onClose={() => setQuickToolbarVisible(false)}
          />
          {/* 浮动文本输入 - 文本工具双击画布时出现 */}
          {inlineTextInput && (
            <div
              ref={inlineTextRef}
              contentEditable
              suppressContentEditableWarning
              style={{
                position: 'fixed',
                left: inlineTextInput.screenX,
                top: inlineTextInput.screenY - 14 * inlineTextInput.zoom / 2,
                minWidth: '2px',
                minHeight: '1.5em',
                outline: 'none',
                border: 'none',
                background: 'transparent',
                fontSize: `${14 * inlineTextInput.zoom}px`,
                lineHeight: '1.5',
                color: '#333',
                caretColor: '#333',
                zIndex: 10000,
                whiteSpace: 'pre-wrap',
                fontFamily: 'inherit',
              }}
              onBlur={commitInlineText}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setInlineTextInput(null);
                }
                e.stopPropagation();
              }}
            />
          )}
          {/* Media Viewer - 画布图片/视频预览（支持内置编辑模式） */}
          <UnifiedMediaViewer
            visible={mediaPreviewVisible}
            items={mediaPreviewItems}
            initialIndex={mediaPreviewInitialIndex}
            onClose={closeMediaPreview}
            showThumbnails={true}
            useBuiltInEditor={true}
            showEditOverwrite={true}
            onEditOverwrite={handleMediaEditorOverwrite}
            onEditInsert={handleMediaEditorInsert}
          />
          {/* Auto Complete Shape Picker - 自动完成形状选择器 */}
          <AutoCompleteShapePicker
            visible={autoCompleteState.visible}
            position={autoCompleteState.position}
            currentShape={autoCompleteState.currentShape || undefined}
            onSelectShape={selectAutoCompleteShape}
            onClose={closeAutoCompletePicker}
            container={containerRef.current}
          />
          {/* AI Input Bar - 底部 AI 输入框 */}
          <AIInputBar isDataReady={isDataReady} />
          {/* Version Update Prompt - 顶部右上角升级提示 */}
          <VersionUpdatePrompt />
          {/* ViewNavigation - 视图导航（缩放 + 小地图） */}
          <ViewNavigation />
          <ToolWinBoxManager />
        </Wrapper>
        {/* Command Palette - 命令面板 (Cmd+K) */}
        <CommandPalette
          open={appState.openCommandPalette || false}
          onClose={useCallback(() => {
            updateState((prev) => ({ ...prev, openCommandPalette: false }));
          }, [updateState])}
          board={board}
          container={containerRef.current}
        />
        {/* Canvas Search - 画布搜索 (Cmd+F) */}
        <CanvasSearch
          open={appState.openCanvasSearch || false}
          onClose={useCallback(() => {
            updateState((prev) => ({ ...prev, openCanvasSearch: false }));
          }, [updateState])}
          board={board}
        />
        <ActiveTaskWarning />
        {/* Performance Panel - 性能监控面板 */}
        <PerformancePanel 
          container={containerRef.current} 
          onCreateProject={onCreateProjectForMemory}
          elements={board?.children || value}
        />
        <ChatDrawer ref={chatDrawerRef} />
        {/* 知识库通过 ToolWinBoxManager 以 WinBox 方式打开 */}
        <Suspense fallback={null}>
          <ProjectDrawer
            isOpen={projectDrawerOpen}
            onOpenChange={setProjectDrawerOpen}
            onBeforeSwitch={handleBeforeSwitch}
            onBoardSwitch={onBoardSwitch}
          />
        </Suspense>
        {toolboxDrawerOpen && (
          <Suspense fallback={null}>
            <ToolboxDrawer
              isOpen={toolboxDrawerOpen}
              onOpenChange={setToolboxDrawerOpen}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
};
