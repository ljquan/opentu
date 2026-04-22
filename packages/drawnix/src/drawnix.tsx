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
import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  lazy,
  Suspense,
} from 'react';
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
import {
  PencilSettingsToolbar,
  EraserSettingsToolbar,
} from './components/toolbar/pencil-settings-toolbar';
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
import type { MediaItem as UnifiedMediaItem } from './components/shared/media-preview/types';
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
import { ChatDrawer } from './components/chat-drawer';
import { ChatDrawerProvider, useChatDrawer } from './contexts/ChatDrawerContext';
import { AIComposerProvider } from './contexts/AIComposerContext';
import { useWorkspace } from './hooks/useWorkspace';
import { Board as WorkspaceBoard } from './types/workspace.types';
import { toolTestHelper } from './utils/tool-test-helper';
import { ViewNavigation } from './components/view-navigation';
import { AssetProvider } from './contexts/AssetContext';
import { AudioPlaylistProvider } from './contexts/AudioPlaylistContext';
import { ToolbarConfigProvider } from './hooks/use-toolbar-config';
import { QuickCreationToolbar } from './components/toolbar/quick-creation-toolbar/quick-creation-toolbar';
import { CacheQuotaProvider } from './components/cache-quota-provider/CacheQuotaProvider';
import { RecentColorsProvider } from './components/unified-color-picker';
import { GitHubSyncProvider } from './contexts/GitHubSyncContext';
import { usePencilCursor } from './hooks/usePencilCursor';
import { withArrowLineAutoCompleteExtend } from './plugins/with-arrow-line-auto-complete-extend';
import { withFlowchartShortcut } from './plugins/with-flowchart-shortcut';
import { withFrame } from './plugins/with-frame';
import { withCard } from './plugins/with-card';
import { withCardResize } from './plugins/with-card-resize';
import { withAudioNode } from './plugins/with-audio-node';
import { withAudioNodeResize } from './plugins/with-audio-node-resize';
import { AutoCompleteShapePicker } from './components/auto-complete-shape-picker';
import { useAutoCompleteShapePicker } from './hooks/useAutoCompleteShapePicker';
import { withDefaultFill } from './plugins/with-default-fill';
import { withGradientFill } from './plugins/with-gradient-fill';
import { withFrameResize } from './plugins/with-frame-resize';
import { withLassoSelection } from './plugins/with-lasso-selection';
import { withLockedElement } from './plugins/with-locked-element';
import {
  API_AUTH_ERROR_EVENT,
  ApiAuthErrorDetail,
} from './utils/api-auth-error-event';
import { MessagePlugin } from 'tdesign-react';
import { calculateEditedImagePoints } from './utils/image';
import { isCardElement } from './types/card.types';
import { openCardInKnowledgeBase } from './utils/card-actions';
import { useI18n } from './i18n';
import { safeReload } from './utils/active-tasks';
import { useTabSync } from './hooks/useTabSync';
import { canvasAudioPlaybackService } from './services/canvas-audio-playback-service';
import { useCanvasAudioPlaybackSelector } from './hooks/useCanvasAudioPlayback';
import { isAudioNodeElement } from './types/audio-node.types';
import {
  requestServiceWorkerIdlePrefetch,
  type IdlePrefetchGroup,
} from './utils/startup-prefetch';
import { DeferredAIInputBar } from './components/startup/DeferredAIInputBar';
import type { MediaLibraryModalProps } from './types/asset.types';
import { SelectionMode } from './types/asset.types';

type MediaLibraryOpenConfig = Pick<
  MediaLibraryModalProps,
  'mode' | 'filterType' | 'onSelect' | 'selectButtonText'
>;

interface SWIdlePrefetchStatusMessage {
  type: 'SW_IDLE_PREFETCH_STATUS';
  completedGroups?: string[];
}

const DrawnixDeferredFeatures = lazy(() =>
  import('./components/startup/DrawnixDeferredFeatures').then((module) => ({
    default: module.DrawnixDeferredFeatures,
  }))
);
const DrawnixDeferredRuntime = lazy(() =>
  import('./components/startup/DrawnixDeferredRuntime').then((module) => ({
    default: module.DrawnixDeferredRuntime,
  }))
);
const TTDDialog = lazy(() =>
  import('./components/ttd-dialog/ttd-dialog').then((module) => ({
    default: module.TTDDialog,
  }))
);
const SettingsDialog = lazy(() =>
  import('./components/settings-dialog/settings-dialog').then((module) => ({
    default: module.SettingsDialog,
  }))
);
const UnifiedMediaViewer = lazy(() =>
  import('./components/shared/media-preview/UnifiedMediaViewer').then(
    (module) => ({
      default: module.UnifiedMediaViewer,
    })
  )
);
const CanvasAudioPlayer = lazy(() =>
  import('./components/audio-node-element/CanvasAudioPlayer').then(
    (module) => ({
      default: module.CanvasAudioPlayer,
    })
  )
);
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

const DEFAULT_IDLE_PREFETCH_GROUPS: IdlePrefetchGroup[] = ['tool-windows'];

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

  const [appState, setAppState] = useState<DrawnixState>(() => {
    // TODO: need to consider how to maintenance the pointer state in future
    const md = new MobileDetect(window.navigator.userAgent);
    return {
      pointer: PlaitPointerType.hand,
      isMobile: md.mobile() !== null,
      isPencilMode: false,
      openDialogTypes: new Set(),
      dialogInitialData: null,
      dialogInitialDataByType: {},
      openCleanConfirm: false,
      openSettings: false,
    };
  });

  const [board, setBoard] = useState<DrawnixBoard | null>(null);
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);
  const [toolboxDrawerOpen, setToolboxDrawerOpen] = useState(false);
  const [taskPanelExpanded, setTaskPanelExpanded] = useState(false);
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false);
  const [mediaLibraryConfig, setMediaLibraryConfig] =
    useState<MediaLibraryOpenConfig>({
      mode: SelectionMode.BROWSE,
    });
  const [backupRestoreOpen, setBackupRestoreOpen] = useState(false);
  const [cloudSyncOpen, setCloudSyncOpen] = useState(false);
  const [deferredRuntimeEnabled, setDeferredRuntimeEnabled] = useState(false);
  const [versionUpdateEnabled, setVersionUpdateEnabled] = useState(false);
  const [performancePanelEnabled, setPerformancePanelEnabled] = useState(false);
  const [toolWindowManagerEnabled, setToolWindowManagerEnabled] =
    useState(false);
  const [minimizedToolsBarEnabled, setMinimizedToolsBarEnabled] =
    useState(false);

  // 使用 ref 来保存 board 的最新引用,避免 useCallback 依赖问题
  const boardRef = useRef<DrawnixBoard | null>(null);

  // 关闭所有抄屉
  const closeAllDrawers = useCallback(() => {
    setProjectDrawerOpen(false);
    setToolboxDrawerOpen(false);
    setTaskPanelExpanded(false);
    setMediaLibraryOpen(false);
  }, []);

  const enableDeferredRuntime = useCallback(
    (groups: IdlePrefetchGroup[] = DEFAULT_IDLE_PREFETCH_GROUPS) => {
      requestServiceWorkerIdlePrefetch(groups);
      setDeferredRuntimeEnabled(true);
    },
    []
  );

  const enableToolWindows = useCallback(
    (groups: IdlePrefetchGroup[] = ['tool-windows']) => {
      enableDeferredRuntime(groups);
      setMinimizedToolsBarEnabled(true);
      setToolWindowManagerEnabled(true);
    },
    [enableDeferredRuntime]
  );

  // 处理知识库切换（通过 WinBox 打开）
  const handleKnowledgeBaseToggle = useCallback(() => {
    enableToolWindows(['tool-windows']);
    void Promise.all([
      import('./services/tool-window-service'),
      import('./constants/built-in-tools'),
    ]).then(([{ toolWindowService }, { BUILT_IN_TOOLS }]) => {
      const kbTool = BUILT_IN_TOOLS.find(
        (tool) => tool.id === 'knowledge-base'
      );
      if (!kbTool) {
        return;
      }

      const state = toolWindowService.getToolState(kbTool.id);
      if (state && state.status === 'open') {
        toolWindowService.closeTool(kbTool.id);
      } else {
        toolWindowService.openTool(kbTool);
      }
    });
  }, [enableToolWindows]);

  // 监听 kb:open 事件，支持从 popup-toolbar 等外部打开知识库并定位到指定笔记
  useEffect(() => {
    const handleKBOpen = (e: Event) => {
      const { noteId } = (e as CustomEvent<{ noteId?: string }>).detail;
      enableToolWindows(['tool-windows']);
      void Promise.all([
        import('./services/tool-window-service'),
        import('./constants/built-in-tools'),
      ]).then(([{ toolWindowService }, { BUILT_IN_TOOLS }]) => {
        const kbTool = BUILT_IN_TOOLS.find(
          (tool) => tool.id === 'knowledge-base'
        );
        if (!kbTool) {
          return;
        }

        const isAlreadyOpen = toolWindowService.isToolOpen(kbTool.id);
        toolWindowService.openTool(kbTool, {
          componentProps: noteId ? { initialNoteId: noteId } : {},
        });

        if (isAlreadyOpen && noteId) {
          window.setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent('kb:open-note', { detail: { noteId } })
            );
          }, 50);
        }
      });
    };
    window.addEventListener('kb:open', handleKBOpen);
    return () => window.removeEventListener('kb:open', handleKBOpen);
  }, [enableToolWindows]);

  // 处理项目抽屉切换（互斥逻辑）
  const handleProjectDrawerToggle = useCallback(() => {
    enableToolWindows(['tool-windows']);
    if (projectDrawerOpen) {
      setProjectDrawerOpen(false);
      return;
    }

    setToolboxDrawerOpen(false);
    setTaskPanelExpanded(false);
    setMediaLibraryOpen(false);
    setProjectDrawerOpen(true);
  }, [enableToolWindows, projectDrawerOpen]);

  // 处理工具箱抽屉切换（互斥逻辑）
  const handleToolboxDrawerToggle = useCallback(() => {
    enableToolWindows(['tool-windows']);
    if (toolboxDrawerOpen) {
      setToolboxDrawerOpen(false);
      return;
    }

    setProjectDrawerOpen(false);
    setTaskPanelExpanded(false);
    setMediaLibraryOpen(false);
    setToolboxDrawerOpen(true);
  }, [enableToolWindows, toolboxDrawerOpen]);

  // 处理任务面板切换（互斥逻辑）
  const handleTaskPanelToggle = useCallback(() => {
    enableDeferredRuntime(['tool-windows']);
    if (taskPanelExpanded) {
      setTaskPanelExpanded(false);
      return;
    }

    setProjectDrawerOpen(false);
    setToolboxDrawerOpen(false);
    setMediaLibraryOpen(false);
    setTaskPanelExpanded(true);
  }, [enableDeferredRuntime, taskPanelExpanded]);

  // 打开素材库（用于缓存满提示）
  const handleOpenMediaLibrary = useCallback((config?: MediaLibraryOpenConfig) => {
    enableToolWindows(['tool-windows']);
    closeAllDrawers();
    setMediaLibraryConfig({
      mode: SelectionMode.BROWSE,
      ...config,
    });
    setMediaLibraryOpen(true);
  }, [closeAllDrawers, enableToolWindows]);

  const handleOpenBackupRestore = useCallback(() => {
    enableDeferredRuntime(['tool-windows']);
    setBackupRestoreOpen(true);
  }, [enableDeferredRuntime]);

  const handleOpenCloudSync = useCallback(() => {
    enableDeferredRuntime(['tool-windows']);
    setCloudSyncOpen(true);
  }, [enableDeferredRuntime]);

  // 使用 useCallback 稳定 setAppState 函数引用，支持函数式更新
  const stableSetAppState = useCallback(
    (newAppState: DrawnixState | ((prev: DrawnixState) => DrawnixState)) => {
      if (typeof newAppState === 'function') {
        setAppState(newAppState);
      } else {
        setAppState(newAppState);
      }
    },
    []
  );

  const updateAppState = useCallback((newAppState: Partial<DrawnixState>) => {
    setAppState((prevState) => ({
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

  useEffect(() => {
    let disposed = false;
    const shouldLoadImmediately = new URLSearchParams(
      window.location.search
    ).has('tool');

    const startDeferredRuntime = () => {
      if (!disposed) {
        enableDeferredRuntime(
          shouldLoadImmediately
            ? ['tool-windows']
            : DEFAULT_IDLE_PREFETCH_GROUPS
        );
      }
    };

    if (shouldLoadImmediately) {
      enableToolWindows(['tool-windows']);
      return;
    }

    const idleCallback = (
      window as Window & {
        requestIdleCallback?: (
          callback: () => void,
          options?: { timeout: number }
        ) => number;
        cancelIdleCallback?: (id: number) => void;
      }
    ).requestIdleCallback;

    if (typeof idleCallback === 'function') {
      const id = idleCallback(startDeferredRuntime, { timeout: 1800 });
      return () => {
        disposed = true;
        (
          window as Window & {
            cancelIdleCallback?: (callbackId: number) => void;
          }
        ).cancelIdleCallback?.(id);
      };
    }

    const timer = window.setTimeout(startDeferredRuntime, 700);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [enableDeferredRuntime, enableToolWindows]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    let resolvedBySW = false;
    const isLocalDevHost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';

    const handleIdlePrefetchStatus = (
      event: MessageEvent<SWIdlePrefetchStatusMessage>
    ) => {
      if (event.data?.type !== 'SW_IDLE_PREFETCH_STATUS') {
        return;
      }

      if (!event.data.completedGroups?.includes('tool-windows')) {
        return;
      }

      resolvedBySW = true;
      setMinimizedToolsBarEnabled(true);
    };

    navigator.serviceWorker.addEventListener(
      'message',
      handleIdlePrefetchStatus
    );

    const message = { type: 'SW_IDLE_PREFETCH_STATUS_GET' as const };
    const controller = navigator.serviceWorker.controller;
    if (controller) {
      controller.postMessage(message);
    } else {
      navigator.serviceWorker.ready
        .then((registration) => {
          registration.active?.postMessage(message);
        })
        .catch(() => {
          // Ignore status sync failures; runtime still loads on direct interaction.
        });
    }

    const fallbackTimer = window.setTimeout(() => {
      if (resolvedBySW || minimizedToolsBarEnabled) {
        return;
      }

      // idle prefetch 只是优化项，不应阻塞常驻工具条显示。
      // 开发态或 manifest 缺失时，超时后直接放行显示，点击工具时再按需启完整运行时。
      if (isLocalDevHost) {
        console.info(
          '[Drawnix] SW idle prefetch status unresolved in dev, enabling minimized tools bar fallback'
        );
      } else {
        console.warn(
          '[Drawnix] SW idle prefetch status unresolved, enabling minimized tools bar fallback'
        );
      }
      setMinimizedToolsBarEnabled(true);
    }, 2200);

    return () => {
      window.clearTimeout(fallbackTimer);
      navigator.serviceWorker.removeEventListener(
        'message',
        handleIdlePrefetchStatus
      );
    };
  }, [minimizedToolsBarEnabled]);

  useEffect(() => {
    const idleCallback = (
      window as Window & {
        requestIdleCallback?: (
          callback: () => void,
          options?: { timeout: number }
        ) => number;
        cancelIdleCallback?: (id: number) => void;
      }
    ).requestIdleCallback;

    let idleId: number | undefined;
    const timer = window.setTimeout(() => {
      const enableNonCriticalUi = () => {
        setVersionUpdateEnabled(true);
        setPerformancePanelEnabled(true);
      };

      if (typeof idleCallback === 'function') {
        idleId = idleCallback(enableNonCriticalUi, { timeout: 2500 });
        return;
      }

      enableNonCriticalUi();
    }, 1200);

    return () => {
      window.clearTimeout(timer);
      if (typeof idleId === 'number') {
        (
          window as Window & {
            cancelIdleCallback?: (callbackId: number) => void;
          }
        ).cancelIdleCallback?.(idleId);
      }
    };
  }, []);

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
      setAppState((prev) => ({ ...prev, openSettings: true }));
    };

    window.addEventListener(API_AUTH_ERROR_EVENT, handleApiAuthError);
    return () => {
      window.removeEventListener(API_AUTH_ERROR_EVENT, handleApiAuthError);
    };
  }, []);

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
        void safeReload();
      }, 500);
    }
  }, [handleBeforeSwitch, createBoard, switchBoard]);

  // 处理选中状态变化,保存最近选中的元素IDs
  const handleSelectionChange = useCallback(
    (selection: Selection | null) => {
      const currentBoard = boardRef.current;
      if (currentBoard && selection) {
        // 使用Plait的getSelectedElements函数来获取选中的元素
        const selectedElements = getSelectedElements(currentBoard);

        const elementIds = selectedElements
          .map((el: any) => el.id)
          .filter(Boolean);

        // 更新lastSelectedElementIds（包括清空的情况）
        // console.log('Selection changed, saving element IDs:', elementIds);
        updateAppState({ lastSelectedElementIds: elementIds });
      }

      // 调用外部的onSelectionChange回调
      onSelectionChange && onSelectionChange(selection);
    },
    [onSelectionChange, updateAppState]
  );

  // 使用 useMemo 稳定 DrawnixContext.Provider 的 value
  const contextValue = useMemo(
    () => ({
      appState,
      setAppState: stableSetAppState,
      board,
    }),
    [appState, stableSetAppState, board]
  );

  const shouldRenderDeferredFeatures =
    versionUpdateEnabled ||
    performancePanelEnabled ||
    toolWindowManagerEnabled ||
    appState.openCommandPalette ||
    appState.openCanvasSearch ||
    projectDrawerOpen ||
    toolboxDrawerOpen ||
    mediaLibraryOpen ||
    backupRestoreOpen ||
    cloudSyncOpen;

  return (
    <I18nProvider>
      <RecentColorsProvider>
        <AssetProvider>
          <AudioPlaylistProvider>
            <ToolbarConfigProvider>
              <CacheQuotaProvider onOpenMediaLibrary={handleOpenMediaLibrary}>
                <GitHubSyncProvider>
                  <ChatDrawerProvider>
                    <AIComposerProvider>
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
                          mediaLibraryConfig={mediaLibraryConfig}
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
                          handleOpenMediaLibrary={handleOpenMediaLibrary}
                          handleOpenBackupRestore={handleOpenBackupRestore}
                          handleOpenCloudSync={handleOpenCloudSync}
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
                          deferredRuntimeEnabled={deferredRuntimeEnabled}
                          shouldRenderDeferredFeatures={shouldRenderDeferredFeatures}
                          versionUpdateEnabled={versionUpdateEnabled}
                          performancePanelEnabled={performancePanelEnabled}
                          toolWindowManagerEnabled={toolWindowManagerEnabled}
                          minimizedToolsBarEnabled={minimizedToolsBarEnabled}
                          enableToolWindows={enableToolWindows}
                        />
                      </DrawnixContext.Provider>
                    </AIComposerProvider>
                  </ChatDrawerProvider>
                </GitHubSyncProvider>
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
  mediaLibraryConfig: MediaLibraryOpenConfig;
  backupRestoreOpen: boolean;
  deferredRuntimeEnabled: boolean;
  shouldRenderDeferredFeatures: boolean;
  versionUpdateEnabled: boolean;
  performancePanelEnabled: boolean;
  toolWindowManagerEnabled: boolean;
  minimizedToolsBarEnabled: boolean;
  enableToolWindows: () => void;
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
  handleOpenMediaLibrary: (config?: MediaLibraryOpenConfig) => void;
  handleOpenBackupRestore: () => void;
  handleOpenCloudSync: () => void;
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
  mediaLibraryOpen,
  mediaLibraryConfig,
  backupRestoreOpen,
  deferredRuntimeEnabled,
  shouldRenderDeferredFeatures,
  versionUpdateEnabled,
  performancePanelEnabled,
  toolWindowManagerEnabled,
  minimizedToolsBarEnabled,
  enableToolWindows,
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
  handleOpenMediaLibrary,
  handleOpenBackupRestore,
  handleOpenCloudSync,
  setProjectDrawerOpen,
  setToolboxDrawerOpen,
  setMediaLibraryOpen,
  setBackupRestoreOpen,
  setCloudSyncOpen,
  handleBeforeSwitch,
  isDataReady,
  onCreateProjectForMemory,
  currentBoardId,
}) => {
  const { setAppState: updateState } = useDrawnix();
  const { chatDrawerRef } = useChatDrawer();
  const { language } = useI18n();
  const playbackError = useCanvasAudioPlaybackSelector((state) => state.error);
  const hasCanvasAudioPlayerActivity = useCanvasAudioPlaybackSelector(
    (state) => {
      return (
        state.playing ||
        Boolean(state.activeAudioUrl) ||
        Boolean(state.activeReadingSourceId)
      );
    }
  );
  const lastPlaybackErrorRef = useRef<string | undefined>(undefined);
  const [canvasAudioPlayerEnabled, setCanvasAudioPlayerEnabled] = useState(
    hasCanvasAudioPlayerActivity
  );

  // 画笔自定义光标
  usePencilCursor({ board, pointer: appState.pointer });

  // 标签页同步
  useTabSync({
    onSyncNeeded: useCallback(() => {
      // 如果父组件提供了回调，使用无刷新同步
      if (onTabSyncNeeded) {
        onTabSyncNeeded();
      } else {
        // 否则降级到刷新页面（向后兼容）
        void safeReload();
      }
    }, [onTabSyncNeeded]),
    enabled: true,
    currentBoardId,
  });

  // 快捷工具栏状态
  const [quickToolbarVisible, setQuickToolbarVisible] = useState(false);
  const [quickToolbarPosition, setQuickToolbarPosition] = useState<
    [number, number] | null
  >(null);

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
  const [mediaPreviewItems, setMediaPreviewItems] = useState<
    UnifiedMediaItem[]
  >([]);
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
    if (hasCanvasAudioPlayerActivity) {
      setCanvasAudioPlayerEnabled(true);
    }
  }, [hasCanvasAudioPlayerActivity]);

  useEffect(() => {
    canvasAudioPlaybackService.setCanvasQueue(
      getCanvasAudioPlaybackQueue(value)
    );
  }, [value]);

  useEffect(() => {
    return () => {
      canvasAudioPlaybackService.stopAndClear();
    };
  }, []);

  // 收集画布上所有图片和视频元素
  const collectCanvasMediaItems = useCallback((): {
    items: UnifiedMediaItem[];
    elementIds: string[];
  } => {
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
      const isImage =
        PlaitDrawElement.isDrawElement(element) &&
        PlaitDrawElement.isImage(element);
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
  const openMediaPreview = useCallback(
    (targetElementId: string) => {
      const { items, elementIds } = collectCanvasMediaItems();
      if (items.length === 0) return;

      const targetIndex = elementIds.indexOf(targetElementId);
      if (targetIndex === -1) return;

      setMediaPreviewItems(items);
      setMediaPreviewInitialIndex(targetIndex);
      setMediaPreviewVisible(true);
    },
    [collectCanvasMediaItems]
  );

  // 关闭媒体预览
  const closeMediaPreview = useCallback(() => {
    setMediaPreviewVisible(false);
  }, []);

  // 处理图片编辑覆盖保存（内置编辑器回调）
  const handleMediaEditorOverwrite = useCallback(
    async (editedImageUrl: string, originalItem: UnifiedMediaItem) => {
      const elementId = originalItem.id;
      if (!elementId || !board) return;

      try {
        // 导入必要服务
        const { unifiedCacheService } = await import(
          './services/unified-cache-service'
        );
        const { Transforms } = await import('@plait/core');

        const taskId = `edited-image-${Date.now()}`;
        const stableUrl = `/__aitu_cache__/image/${taskId}.png`;

        // 将 data URL 转换为 Blob
        const response = await fetch(editedImageUrl);
        const blob = await response.blob();

        // 缓存到 Cache API
        await unifiedCacheService.cacheMediaFromBlob(stableUrl, blob, 'image', {
          taskId,
        });

        // 加载图片获取尺寸
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Failed to load edited image'));
          img.src = editedImageUrl;
        });

        // 找到元素并更新
        const elementIndex = board.children.findIndex(
          (child) => child.id === elementId
        );
        if (elementIndex >= 0) {
          const element = board.children[elementIndex] as any;
          const { newPoints } = await calculateEditedImagePoints(
            {
              url: element.url,
              width: element.width,
              height: element.height,
              points: element.points || [
                [0, 0],
                [0, 0],
              ],
            },
            img.naturalWidth,
            img.naturalHeight
          );

          Transforms.setNode(
            board,
            {
              url: stableUrl,
              width: img.naturalWidth,
              height: img.naturalHeight,
              points: newPoints,
            } as any,
            [elementIndex]
          );
        }
      } catch (error) {
        console.error('Failed to update image:', error);
        MessagePlugin.error('更新失败');
      }
    },
    [board]
  );

  // 处理图片编辑插入到画布
  const handleMediaEditorInsert = useCallback(
    async (editedImageUrl: string) => {
      if (!board) return;

      try {
        const { unifiedCacheService } = await import(
          './services/unified-cache-service'
        );
        const { insertImageFromUrl } = await import('./data/image');

        const taskId = `edited-image-${Date.now()}`;
        const stableUrl = `/__aitu_cache__/image/${taskId}.png`;

        // 将 data URL 转换为 Blob
        const response = await fetch(editedImageUrl);
        const blob = await response.blob();

        // 缓存到 Cache API
        await unifiedCacheService.cacheMediaFromBlob(stableUrl, blob, 'image', {
          taskId,
        });

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
          (origination?.[1] ?? 0) + 100,
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
    },
    [board]
  );

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
            Transforms.setNode(board, { textHeight: rect.height }, [
              board.children.length - 1,
            ]);
          }
        }
      });
    }
    setInlineTextInput(null);
    BoardTransforms.updatePointerType(board, PlaitPointerType.selection);
    updateState((prev) => ({ ...prev, pointer: PlaitPointerType.selection }));
  }, [board, inlineTextInput, updateState]);

  // 监听双击事件 - 处理图片/视频预览和空白区域快捷工具栏
  useEffect(() => {
    if (!board) return;

    const handleDoubleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // 只处理画布区域内的双击（正向判断，避免维护浮层组件列表）
      const isInsideCanvas =
        target.closest('.board-host-svg') ||
        target.closest('.plait-board-container');

      if (!isInsideCanvas) {
        return;
      }

      // 检查双击位置是否命中了画布上的元素
      const viewBoxPoint = toViewBoxPoint(
        board,
        toHostPoint(board, event.clientX, event.clientY)
      );
      const hitElement = getHitElementByPoint(board, viewBoxPoint);

      // 如果双击了 Card 元素，打开知识库
      if (hitElement && isCardElement(hitElement)) {
        openCardInKnowledgeBase(
          board,
          hitElement as any,
          language as 'zh' | 'en'
        );
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
          const isImage =
            PlaitDrawElement.isDrawElement(hitElement) &&
            PlaitDrawElement.isImage(hitElement);
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
      const isInsideInteractive =
        target.closest('.plait-tool-container') ||
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
      const isInsideCanvas =
        target.closest('.board-host-svg') ||
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
        setCanvasAudioPlayerEnabled(true);
        const playbackSource = getAudioPlaybackSourceFromElement(hitElement);
        if (playbackSource) {
          event.preventDefault();
          event.stopPropagation();
          void canvasAudioPlaybackService
            .togglePlaybackInQueue(
              playbackSource,
              getCanvasAudioPlaybackQueue(board.children),
              {
                queueSource: 'canvas',
                queueId: AUDIO_PLAYLIST_CANVAS_AUDIO_ID,
                queueName: AUDIO_PLAYLIST_CANVAS_AUDIO_LABEL,
              }
            )
            .catch(() => {
              // Error feedback is surfaced from the playback store.
            });
          return;
        }
      }

      // 文本工具激活时：单击空白区域显示浮动文本输入
      if (PlaitBoard.isPointer(board, BasicShapes.text)) {
        const isInsideInteractive =
          target.closest('.plait-tool-container') ||
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
  }, [
    board,
    containerRef,
    projectDrawerOpen,
    toolboxDrawerOpen,
    setProjectDrawerOpen,
    setToolboxDrawerOpen,
  ]);

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
            onOpenBackupRestore={handleOpenBackupRestore}
            onOpenCloudSync={handleOpenCloudSync}
            onKnowledgeBaseToggle={handleKnowledgeBaseToggle}
            onOpenMediaLibrary={handleOpenMediaLibrary}
            deferredFeaturesEnabled={toolWindowManagerEnabled}
            minimizedToolsBarEnabled={minimizedToolsBarEnabled}
            onEnableToolWindows={enableToolWindows}
          />
          {canvasAudioPlayerEnabled && (
            <Suspense fallback={null}>
              <CanvasAudioPlayer />
            </Suspense>
          )}

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
          {appState.openSettings && (
            <Suspense fallback={null}>
              <SettingsDialog container={containerRef.current}></SettingsDialog>
            </Suspense>
          )}
          <CleanConfirm container={containerRef.current}></CleanConfirm>
          <DeferredAIInputBar isDataReady={isDataReady} activationKey={0} />
          {/* Quick Creation Toolbar - 双击空白区域显示的快捷工具栏 */}
          <QuickCreationToolbar
            position={quickToolbarPosition}
            visible={quickToolbarVisible}
            onClose={() => setQuickToolbarVisible(false)}
            onOpenMediaLibrary={handleOpenMediaLibrary}
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
                top: inlineTextInput.screenY - (14 * inlineTextInput.zoom) / 2,
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
          {mediaPreviewVisible && (
            <Suspense fallback={null}>
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
            </Suspense>
          )}
          {/* Auto Complete Shape Picker - 自动完成形状选择器 */}
          <AutoCompleteShapePicker
            visible={autoCompleteState.visible}
            position={autoCompleteState.position}
            currentShape={autoCompleteState.currentShape || undefined}
            onSelectShape={selectAutoCompleteShape}
            onClose={closeAutoCompletePicker}
            container={containerRef.current}
          />
          {/* ViewNavigation - 视图导航（缩放 + 小地图） */}
          <ViewNavigation />
        </Wrapper>
        <ChatDrawer ref={chatDrawerRef} />
        {deferredRuntimeEnabled && (
          <Suspense fallback={null}>
            <DrawnixDeferredRuntime board={board} value={value} />
          </Suspense>
        )}
        {shouldRenderDeferredFeatures && (
          <Suspense fallback={null}>
            <DrawnixDeferredFeatures
              board={board}
              value={value}
              containerRef={containerRef}
              versionUpdateEnabled={versionUpdateEnabled}
              performancePanelEnabled={performancePanelEnabled}
              toolWindowManagerEnabled={toolWindowManagerEnabled}
              projectDrawerOpen={projectDrawerOpen}
              toolboxDrawerOpen={toolboxDrawerOpen}
              mediaLibraryOpen={mediaLibraryOpen}
              mediaLibraryConfig={mediaLibraryConfig}
              backupRestoreOpen={backupRestoreOpen}
              cloudSyncOpen={cloudSyncOpen}
              onBoardSwitch={onBoardSwitch}
              setProjectDrawerOpen={setProjectDrawerOpen}
              setToolboxDrawerOpen={setToolboxDrawerOpen}
              setMediaLibraryOpen={setMediaLibraryOpen}
              setBackupRestoreOpen={setBackupRestoreOpen}
              setCloudSyncOpen={setCloudSyncOpen}
              handleBeforeSwitch={handleBeforeSwitch}
              onCreateProjectForMemory={onCreateProjectForMemory}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
};
