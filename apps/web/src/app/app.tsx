import {
  useState,
  useEffect,
  useCallback,
  useRef,
  lazy,
  Suspense,
} from 'react';
import {
  WorkspaceService,
  migrateToWorkspace,
  isWorkspaceMigrationCompleted,
  Board,
  BoardChangeData,
  TreeNode,
  crashRecoveryService,
  safeReload,
  useDocumentTitle,
  markTabSyncVersion,
  requestServiceWorkerIdlePrefetch,
  requestAIInputPrefill,
  MessagePlugin,
} from '@drawnix/drawnix/runtime';
import type {
  PlaitBoard,
  PlaitElement,
  PlaitTheme,
  Viewport,
} from '@plait/core';
import { ErrorFallbackUI, safeModeReload, goToDebug } from './ErrorBoundary';
import { collectAndDownloadErrorLog } from '../utils/error-log-exporter';
import { WorkspaceShell } from '../workspace/presentation/WorkspaceShell';
import { HomePage } from '../home/HomePage';
import { CreativeCenterPage } from '../creative-center/CreativeCenterPage';
import {
  clearCreationCenterDraft,
  creationPrefillParams,
  saveCreationCenterDraft,
  type CreationRequest,
} from '../creative-center/creation-request';
import type { MarketplaceModel } from '../home/model-marketplace-catalog';

const Drawnix = lazy(() =>
  import('@drawnix/drawnix').then((module) => ({
    default: module.Drawnix,
  }))
);

const MusicStationPage = lazy(() =>
  import('../music-station/MusicStationPage').then((module) => ({
    default: module.MusicStationPage,
  }))
);

const WorksPage = lazy(() =>
  import('../library/WorksPage').then((module) => ({
    default: module.WorksPage,
  }))
);

const WorkflowsPage = lazy(() =>
  import('../library/WorkflowsPage').then((module) => ({
    default: module.WorkflowsPage,
  }))
);

const ProviderAdminPage = lazy(() =>
  import('../admin/ProviderAdminPage').then((module) => ({
    default: module.ProviderAdminPage,
  }))
);

function RouteLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'grid',
        minHeight: '100dvh',
        placeItems: 'center',
        color: '#cfc6e8',
        background: '#111218',
        fontSize: 14,
      }}
    >
      正在打开页面...
    </div>
  );
}

// 节流保存 viewport 的间隔（毫秒）
const VIEWPORT_SAVE_DEBOUNCE = 500;

// URL 参数名
const BOARD_URL_PARAM = 'board';
const BOARD_CLOSE_SNAPSHOT_KEY = 'aitu_board_close_snapshot_v1';
const PENDING_CREATION_KEY = 'foxvue_pending_creation_v1';
const managedGeneration = String((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_OPENTU_MANAGED_GENERATION || '').toLowerCase() === 'true';

type PendingCreation = Required<Pick<CreationRequest, 'mode'>> & {
  boardId: string;
  prompt: string;
  modelId: string | null;
  aspectRatio?: CreationRequest['aspectRatio'];
  quality?: CreationRequest['quality'];
  referenceImages?: CreationRequest['referenceImages'];
};

// Global flag to prevent duplicate initialization in StrictMode
let appInitialized = false;

async function refreshBoardViewportBounds(board: PlaitBoard): Promise<void> {
  const { initializeViewBox, updateViewBox, updateViewportOffset } =
    await import('@plait/core');
  initializeViewBox(board);
  updateViewBox(board);
  updateViewportOffset(board);
}

type BoardPersistencePayload = {
  children: PlaitElement[];
  viewport?: Viewport;
  theme?: PlaitTheme;
};

type BoardCloseSnapshot = BoardPersistencePayload & {
  boardId: string;
  updatedAt: number;
};

type BootController = {
  markReady: () => void;
  markError: (message?: string) => void;
};

function getBootController(): BootController | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return (window as Window & { __OPENTU_BOOT__?: BootController })
    .__OPENTU_BOOT__;
}

/**
 * 从 URL 获取画布 ID 参数
 */
function getBoardIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get(BOARD_URL_PARAM);
}

type AppLocation = {
  pathname: string;
  search: string;
  hash: string;
};

function readAppLocation(): AppLocation {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
  };
}

function isCreativeCenterPath(pathname: string): boolean {
  return pathname === '/creative-center' || pathname === '/creative-center/';
}

function isMusicStationPath(pathname: string): boolean {
  return pathname === '/music-station' || pathname === '/music-station/';
}

function isWorksPath(pathname: string): boolean {
  return pathname === '/works' || pathname === '/works/';
}

function isWorkflowsPath(pathname: string): boolean {
  return pathname === '/workflows' || pathname === '/workflows/';
}

function isProviderAdminPath(pathname: string): boolean {
  return pathname === '/admin/providers' || pathname === '/admin/providers/';
}

/**
 * 更新 URL 中的画布 ID 参数（不刷新页面）
 * @param boardId 画布 ID
 * @param replace 是否使用 replaceState（默认 false，使用 pushState）
 */
function updateBoardIdInUrl(
  boardId: string | null,
  replace = false
): void {
  const url = new URL(window.location.href);
  if (boardId) {
    url.searchParams.set(BOARD_URL_PARAM, boardId);
  } else {
    url.searchParams.delete(BOARD_URL_PARAM);
  }

  // 使用 pushState 产生历史记录，支持浏览器前进后退
  // 初始加载时使用 replaceState 避免重复记录
  if (replace) {
    window.history.replaceState({ boardId }, '', url.toString());
  } else {
    window.history.pushState({ boardId }, '', url.toString());
  }
}

function saveBoardCloseSnapshot(snapshot: BoardCloseSnapshot): void {
  try {
    localStorage.setItem(BOARD_CLOSE_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.warn('[App] Failed to save board close snapshot:', error);
  }
}

function loadBoardCloseSnapshot(): BoardCloseSnapshot | null {
  try {
    const raw = localStorage.getItem(BOARD_CLOSE_SNAPSHOT_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<BoardCloseSnapshot>;
    if (
      !parsed ||
      typeof parsed.boardId !== 'string' ||
      typeof parsed.updatedAt !== 'number' ||
      !Array.isArray(parsed.children)
    ) {
      return null;
    }
    return parsed as BoardCloseSnapshot;
  } catch (error) {
    console.warn('[App] Failed to load board close snapshot:', error);
    return null;
  }
}

function clearBoardCloseSnapshot(boardId?: string | null): void {
  try {
    const existing = loadBoardCloseSnapshot();
    if (!existing) {
      return;
    }
    if (!boardId || existing.boardId === boardId) {
      localStorage.removeItem(BOARD_CLOSE_SNAPSHOT_KEY);
    }
  } catch (error) {
    console.warn('[App] Failed to clear board close snapshot:', error);
  }
}

function getCreationBoardName(prompt?: string): string {
  const normalized = prompt?.replace(/\s+/g, ' ').trim() || '';
  if (!normalized) return '新的创作空间';
  return normalized.length > 24 ? `${normalized.slice(0, 24)}…` : normalized;
}

function savePendingCreation(pending: PendingCreation): void {
  try {
    sessionStorage.setItem(PENDING_CREATION_KEY, JSON.stringify(pending));
  } catch (error) {
    console.warn('[App] Failed to save pending creation:', error);
  }
}

function loadPendingCreation(boardId: string): PendingCreation | null {
  try {
    const raw = sessionStorage.getItem(PENDING_CREATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingCreation>;
    if (
      parsed.boardId !== boardId ||
      typeof parsed.prompt !== 'string' ||
      !parsed.prompt.trim() ||
      !['image', 'video', 'audio', 'canvas'].includes(parsed.mode || '')
    ) {
      return null;
    }
    return parsed as PendingCreation;
  } catch (error) {
    console.warn('[App] Failed to read pending creation:', error);
    return null;
  }
}

function clearPendingCreation(): void {
  try {
    sessionStorage.removeItem(PENDING_CREATION_KEY);
  } catch (error) {
    console.warn('[App] Failed to clear pending creation:', error);
  }
}

export function App() {
  const [appLocation, setAppLocation] = useState<AppLocation>(readAppLocation);
  // Ordinary pages do not need IndexedDB/workspace boot before rendering.
  // Keep the loading state only for a direct canvas URL.
  const [isLoading, setIsLoading] = useState(() => Boolean(getBoardIdFromUrl()));
  const [isDataReady, setIsDataReady] = useState(false);
  // 使用 ref 跟踪 isDataReady，避免 handleBoardChange 因闭包捕获旧值导致保存被跳过
  // Wrapper 中 BOARD_TO_AFTER_CHANGE 的 effect 只依赖 [board]，不会因为 onChange 变化而更新
  // 如果 handleBoardChange 依赖 isDataReady state，onChange 变化后旧回调中 isDataReady 永远为 false
  const isDataReadyRef = useRef(false);
  const [showCrashDialog, setShowCrashDialog] = useState(false);
  const [initError, setInitError] = useState<Error | null>(null);
  const [value, setValue] = useState<{
    children: PlaitElement[];
    viewport?: Viewport;
    theme?: PlaitTheme;
  }>({ children: [] });
  // 当前画板 ID，用于更新页面标题
  const [currentBoardId, setCurrentBoardId] = useState<string | null>(null);
  const [isStartingWorkspace, setIsStartingWorkspace] = useState(false);
  const currentBoardIdRef = useRef<string | null>(null);
  const pendingCreationTimerRef = useRef<number | null>(null);

  // 存储最新的 viewport，用于页面关闭前保存
  const latestViewportRef = useRef<Viewport | undefined>();
  const latestBoardDataRef = useRef<BoardCloseSnapshot | null>(null);
  // 防抖定时器
  const viewportSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  // 标记是否正在处理浏览器前进后退
  const isHandlingPopStateRef = useRef<boolean>(false);
  // 保存 board 引用，用于手动触发边界更新
  const boardRef = useRef<PlaitBoard | null>(null);
  // 标记是否正在同步其他标签页的数据（同步期间不保存，防止旧数据覆盖新数据）
  const isSyncingRef = useRef<boolean>(false);
  // 标记本标签页是否有用户主动修改（只有用户修改过才在 visibilitychange 时保存）
  const localDirtyRef = useRef<boolean>(false);
  // 标记当前标签页是否还有未落盘的本地变更（含元素与 viewport）
  const hasPendingPersistenceRef = useRef<boolean>(false);

  const navigateTo = useCallback((pathname: string) => {
    const nextUrl = new URL(pathname, window.location.origin);
    window.history.pushState(
      { pathname: nextUrl.pathname },
      '',
      nextUrl.toString()
    );
    setAppLocation(readAppLocation());
    // pushState intentionally does not emit a navigation event. Notify pages
    // that derive in-page state from the URL hash (for example the home model
    // marketplace) after changing routes programmatically.
    window.dispatchEvent(new Event('popstate'));
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, []);

  useEffect(() => {
    // 普通页面由路由统一管理滚动位置，避免浏览器恢复到半截内容。
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = previousRestoration;
    };
  }, []);

  // 使用 useDocumentTitle hook 管理页面标题
  useDocumentTitle(
    currentBoardId,
    currentBoardId ? undefined : 'AI 创作工作区'
  );

  useEffect(() => {
    currentBoardIdRef.current = currentBoardId;
  }, [currentBoardId]);

  const updateLatestBoardData = useCallback(
    (
      boardId: string,
      payload: BoardPersistencePayload,
      updatedAt: number = Date.now()
    ) => {
      latestViewportRef.current = payload.viewport;
      latestBoardDataRef.current = {
        boardId,
        children: payload.children,
        viewport: payload.viewport,
        theme: payload.theme,
        updatedAt,
      };
    },
    []
  );

  const persistCloseSnapshot = useCallback(
    (reason: 'visibilitychange' | 'pagehide' | 'beforeunload') => {
      const snapshot = latestBoardDataRef.current;
      const boardId = currentBoardIdRef.current;
      if (
        !snapshot ||
        !boardId ||
        snapshot.boardId !== boardId ||
        !hasPendingPersistenceRef.current
      ) {
        return;
      }
      saveBoardCloseSnapshot({
        ...snapshot,
        updatedAt: Date.now(),
      });

      const workspaceService = WorkspaceService.getInstance();
      workspaceService
        .saveCurrentBoard({
          children: snapshot.children,
          viewport: snapshot.viewport,
          theme: snapshot.theme,
        })
        .catch((error: Error) => {
          console.warn(`[App] Failed to flush board on ${reason}:`, error);
        });
    },
    []
  );

  useEffect(() => {
    const bootController = getBootController();
    if (!bootController) {
      return;
    }

    if (showCrashDialog || initError || !isLoading) {
      bootController.markReady();
    }
  }, [initError, isLoading, showCrashDialog]);

  useEffect(() => {
    if (showCrashDialog || initError || isLoading) {
      return;
    }

    requestServiceWorkerIdlePrefetch(['offline-static-assets']);
  }, [initError, isLoading, showCrashDialog]);

  useEffect(() => {
    if (showCrashDialog || initError || isLoading || getBoardIdFromUrl()) {
      return;
    }

    const preload = () => {
      void import('../music-station/MusicStationPage').catch((error) => {
        console.warn('[App] Music station preload skipped:', error);
      });
    };
    const idleCallback = (
      window as Window & {
        requestIdleCallback?: (
          callback: () => void,
          options?: { timeout: number }
        ) => number;
        cancelIdleCallback?: (handle: number) => void;
      }
    ).requestIdleCallback;

    if (idleCallback) {
      const handle = idleCallback(preload, { timeout: 1800 });
      return () => {
        (
          window as Window & { cancelIdleCallback?: (handle: number) => void }
        ).cancelIdleCallback?.(handle);
      };
    }

    const handle = window.setTimeout(preload, 900);
    return () => window.clearTimeout(handle);
  }, [initError, isLoading, showCrashDialog]);

  // Initialize workspace and handle migration
  useEffect(() => {
    const initialize = async () => {
      // 根路由是产品首页，只有带 board 参数时才启动完整工作区。
      if (!getBoardIdFromUrl()) {
        crashRecoveryService.markLoadingComplete();
        isDataReadyRef.current = true;
        setIsDataReady(true);
        setIsLoading(false);
        return;
      }

      // 检查是否需要显示崩溃恢复对话框
      if (
        crashRecoveryService.shouldShowSafeModePrompt() &&
        !crashRecoveryService.isSafeMode()
      ) {
        setShowCrashDialog(true);
        setIsLoading(false);
        return;
      }

      // Prevent duplicate initialization in StrictMode
      if (appInitialized) {
        // 等待 workspaceService 完全初始化
        const workspaceService = WorkspaceService.getInstance();
        // 首屏壳子已可挂载，不再等待工作区数据恢复完成才结束启动遮罩。
        setIsLoading(false);
        await workspaceService.waitForInitialization();
        // 使用 switchBoard 确保加载完整数据
        const currentBoardId = workspaceService.getState().currentBoardId;
        // 验证画板是否存在，防止旧状态中的 currentBoardId 指向不存在的画板

        if (
          currentBoardId &&
          workspaceService.getBoardMetadata(currentBoardId)
        ) {
          const currentBoard = await workspaceService.switchBoard(
            currentBoardId
          );
          const nextData = {
            children: currentBoard.elements || [],
            viewport: currentBoard.viewport,
            theme: currentBoard.theme,
          };
          updateLatestBoardData(
            currentBoard.id,
            nextData,
            currentBoard.updatedAt
          );
          hasPendingPersistenceRef.current = false;
          setValue(nextData);
        }
        setIsLoading(false);
        // 标记加载完成
        crashRecoveryService.markLoadingComplete();
        return;
      }
      appInitialized = true;

      try {
        const workspaceService = WorkspaceService.getInstance();
        // boot loading 只覆盖首屏壳子资源，不阻塞后续工作区初始化与缓存预热。
        setIsLoading(false);
        await workspaceService.initialize();

        // Check and perform migration if needed
        const migrated = await isWorkspaceMigrationCompleted();
        if (!migrated) {
          await migrateToWorkspace();
        }

        // 安全模式：优先复用已有的空白安全模式画板，否则创建新的
        if (crashRecoveryService.isSafeMode()) {
          // 查找已有的安全模式画板（名称以 "安全模式" 开头且元素为空）
          const allBoards = workspaceService.getAllBoards();
          const safeModeBoard = allBoards.find(
            (b) =>
              b.name.startsWith('安全模式') &&
              (!b.elements || b.elements.length === 0)
          );

          if (safeModeBoard) {
            await workspaceService.switchBoard(safeModeBoard.id);
            setCurrentBoardId(safeModeBoard.id);
          } else {
            // 使用时间戳生成唯一名称，避免名称冲突
            const timestamp = new Date()
              .toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })
              .replace(/\//g, '-');
            const board = await workspaceService.createBoard({
              name: `安全模式 ${timestamp}`,
              elements: [],
            });
            if (board) {
              await workspaceService.switchBoard(board.id);
              setCurrentBoardId(board.id);
            }
          }

          const safeModeData = { children: [] as PlaitElement[] };
          const safeModeBoardId =
            safeModeBoard?.id || currentBoardIdRef.current || 'safe-mode';
          updateLatestBoardData(safeModeBoardId, safeModeData, Date.now());
          setValue(safeModeData);
          isDataReadyRef.current = true;
          setIsDataReady(true);
          setIsLoading(false);
          crashRecoveryService.markLoadingComplete();

          // 安全模式成功加载后，清除安全模式标记（下次正常加载）
          crashRecoveryService.disableSafeMode();

          // 提示用户当前处于安全模式
          setTimeout(() => {
            MessagePlugin.warning({
              content:
                '当前处于安全模式，已创建空白画布。可从侧边栏切换到其他画布。',
              duration: 8000,
              closeBtn: true,
            });
          }, 500);
          return;
        }

        // Load current board data if available
        let currentBoard: Board | null = null;

        // 优先使用 URL 参数中的画布 ID
        const urlBoardId = getBoardIdFromUrl();
        const stateBoardId = workspaceService.getState().currentBoardId;

        // 确定要加载的画布 ID（优先级：URL 参数 > 上次状态）
        let targetBoardId: string | null = null;
        if (urlBoardId && workspaceService.getBoardMetadata(urlBoardId)) {
          targetBoardId = urlBoardId;
        } else if (
          stateBoardId &&
          workspaceService.getBoardMetadata(stateBoardId)
        ) {
          targetBoardId = stateBoardId;
        }

        // If has target board ID, load it via switchBoard (triggers lazy loading)
        if (targetBoardId) {
          currentBoard = await workspaceService.switchBoard(targetBoardId);
        } else if (workspaceService.hasBoards()) {
          // No valid board ID, select first available board
          const tree = workspaceService.getTree();
          const firstBoard = findFirstBoard(tree);
          if (firstBoard) {
            currentBoard = await workspaceService.switchBoard(firstBoard.id);
          }
        } else {
          // No boards exist, create default board
          const board = await workspaceService.createBoard({
            name: '我的画板1',
            elements: [],
          });

          if (board) {
            currentBoard = await workspaceService.switchBoard(board.id);
          }
        }
        // 更新 URL 参数和当前画布 ID
        if (currentBoard) {
          updateBoardIdInUrl(currentBoard.id, true); // 初始加载使用 replace
          setCurrentBoardId(currentBoard.id);
          // 持久化到 sessionStorage，确保标签页隔离
          workspaceService.persistCurrentBoardId(currentBoard.id);
          hasPendingPersistenceRef.current = false;
        }

        if (currentBoard) {
          const closeSnapshot = loadBoardCloseSnapshot();
          let initialData: BoardPersistencePayload = {
            children: currentBoard.elements || [],
            viewport: currentBoard.viewport,
            theme: currentBoard.theme,
          };

          if (
            closeSnapshot &&
            closeSnapshot.boardId === currentBoard.id &&
            closeSnapshot.updatedAt > currentBoard.updatedAt
          ) {
            initialData = {
              children: closeSnapshot.children,
              viewport: closeSnapshot.viewport,
              theme: closeSnapshot.theme,
            };
            currentBoard = {
              ...currentBoard,
              ...initialData,
              updatedAt: closeSnapshot.updatedAt,
            };
            const restoredBoardId = currentBoard.id;
            void workspaceService
              .saveBoard(restoredBoardId, initialData)
              .then(() => {
                hasPendingPersistenceRef.current = false;
                clearBoardCloseSnapshot(restoredBoardId);
              })
              .catch((error: Error) => {
                console.warn(
                  '[App] Failed to rehydrate board from close snapshot:',
                  error
                );
              });
            MessagePlugin.warning({
              content: '检测到上次关闭前的未落盘画布，已自动恢复',
              duration: 5000,
              closeBtn: true,
            });
          } else if (
            closeSnapshot &&
            closeSnapshot.boardId &&
            !workspaceService.getBoardMetadata(closeSnapshot.boardId)
          ) {
            clearBoardCloseSnapshot(closeSnapshot.boardId);
          }

          updateLatestBoardData(
            currentBoard.id,
            initialData,
            currentBoard.updatedAt
          );
          hasPendingPersistenceRef.current = false;

          // 先设置原始元素，让页面先渲染
          setValue(initialData);

          // 异步恢复视频 URL，不阻塞页面加载
          recoverVideoUrlsInElements(initialData.children)
            .then((recoveredElements) => {
              // 只有当有元素被恢复时才更新
              if (recoveredElements !== initialData.children) {
                const nextData = {
                  ...initialData,
                  children: recoveredElements,
                };
                updateLatestBoardData(currentBoard!.id, nextData, Date.now());
                setValue(nextData);
              }
            })
            .catch((error) => {
              console.error('[App] Video URL recovery failed:', error);
            });
        }
      } catch (error) {
        console.error('[App] Initialization failed:', error);
        setInitError(error instanceof Error ? error : new Error(String(error)));
      } finally {
        isDataReadyRef.current = true;
        setIsDataReady(true);
        setIsLoading(false);
        // 标记加载完成
        crashRecoveryService.markLoadingComplete();
      }
    };

    initialize();
  }, [updateLatestBoardData]);

  // Handle board switching
  const handleBoardSwitch = useCallback(
    async (board: Board, skipUrlUpdate = false) => {
      try {
        // 立即更新 URL 和 sessionStorage，确保刷新页面时能恢复到正确的画板
        // 必须在任何异步操作之前执行，避免刷新时丢失画板选择
        if (!skipUrlUpdate) {
          updateBoardIdInUrl(board.id);
          const workspaceService = WorkspaceService.getInstance();
          workspaceService.persistCurrentBoardId(board.id);
        }
        setCurrentBoardId(board.id);

        // 切换画布时重置脏标志，新画布的初始数据不需要保存
        localDirtyRef.current = false;
        hasPendingPersistenceRef.current = false;

        // 在设置 state 之前，预先恢复失效的视频 URL
        const elements = await recoverVideoUrlsInElements(board.elements || []);
        const nextData = {
          children: elements,
          viewport: board.viewport,
          theme: board.theme,
        };
        updateLatestBoardData(board.id, nextData, board.updatedAt);

        setValue(nextData);

        // 等待 React 更新完成后，手动触发画布边界更新
        // 使用 setTimeout 而不是 queueMicrotask，给 React 更多时间完成 DOM 更新
        setTimeout(() => {
          if (boardRef.current) {
            refreshBoardViewportBounds(boardRef.current).catch((error) => {
              console.warn('[App] Failed to refresh board bounds:', error);
            });
          }
        }, 0);
      } catch (error) {
        console.error('[App] Board switch failed:', error);
        MessagePlugin.error({
          content: `切换画板失败: ${
            error instanceof Error ? error.message : '未知错误'
          }`,
          duration: 5000,
          closeBtn: true,
        });
      }
    },
    [updateLatestBoardData]
  );

  const handleCreateBoard = useCallback(async () => {
    const workspaceService = WorkspaceService.getInstance();
    const snapshot = latestBoardDataRef.current;
    if (snapshot && snapshot.boardId === currentBoardIdRef.current) {
      await workspaceService.saveCurrentBoard({
        children: snapshot.children,
        viewport: snapshot.viewport,
        theme: snapshot.theme,
      });
      hasPendingPersistenceRef.current = false;
      clearBoardCloseSnapshot(snapshot.boardId);
    }
    const board = await workspaceService.createBoard({
      name: '新创作空间',
      elements: [],
    });
    if (board) {
      await handleBoardSwitch(board);
    }
  }, [handleBoardSwitch]);

  const handleSwitchBoardById = useCallback(
    async (boardId: string) => {
      const workspaceService = WorkspaceService.getInstance();
      const board = await workspaceService.switchBoard(boardId);
      if (!board) {
        throw new Error('创作空间不存在');
      }
      await handleBoardSwitch(board);
    },
    [handleBoardSwitch]
  );

  const handleRenameBoard = useCallback(
    async (boardId: string, name: string) => {
      await WorkspaceService.getInstance().renameBoard(boardId, name);
    },
    []
  );

  const handleStartCreating = useCallback(async (request?: CreationRequest) => {
    if (isStartingWorkspace) {
      return;
    }

    setIsStartingWorkspace(true);
    try {
      const workspaceService = WorkspaceService.getInstance();
      await workspaceService.initialize();

      if (!(await isWorkspaceMigrationCompleted())) {
        await migrateToWorkspace();
      }

      const existingNames = new Set(
        workspaceService
          .getAllBoards()
          .map((existingBoard) => existingBoard.name)
      );
      const baseBoardName = getCreationBoardName(request?.prompt);
      let boardName = baseBoardName;
      let boardIndex = 2;
      while (existingNames.has(boardName)) {
        boardName = `${baseBoardName} ${boardIndex}`;
        boardIndex += 1;
      }

      const board = await workspaceService.createBoard({
        name: boardName,
        elements: [],
      });
      if (!board) {
        throw new Error('无法创建创作空间');
      }

      const normalizedPrompt = request?.prompt?.trim() || '';
      if (normalizedPrompt) {
        savePendingCreation({
          boardId: board.id,
          prompt: normalizedPrompt,
          mode: request?.mode || 'image',
          modelId: request?.modelId || null,
          aspectRatio: request?.aspectRatio,
          quality: request?.quality,
          referenceImages: request?.referenceImages,
        });
      } else {
        clearPendingCreation();
      }

      await workspaceService.switchBoard(board.id);
      workspaceService.persistCurrentBoardId(board.id);
      const url = new URL('/', window.location.origin);
      url.searchParams.set(BOARD_URL_PARAM, board.id);
      window.location.assign(url.toString());
    } catch (error) {
      console.error('[App] Failed to enter workspace:', error);
      MessagePlugin.error({
        content: '创作工作台暂时无法打开，请稍后重试',
        duration: 5000,
        closeBtn: true,
      });
      setIsStartingWorkspace(false);
    }
  }, [isStartingWorkspace]);

  const prefillPendingCreation = useCallback((boardId: string | null) => {
    if (!boardId) return;
    if (pendingCreationTimerRef.current !== null) {
      window.clearTimeout(pendingCreationTimerRef.current);
    }

    let attempts = 0;
    const deliver = () => {
      const pending = loadPendingCreation(boardId);
      if (!pending) return;
      const input = document.querySelector('[data-testid="ai-input-textarea"]');
      if (!input && attempts < 40) {
        attempts += 1;
        pendingCreationTimerRef.current = window.setTimeout(deliver, 100);
        return;
      }
      pendingCreationTimerRef.current = null;
      if (!input) return;
      requestAIInputPrefill({
        generationType:
          pending.mode === 'video'
            ? 'video'
            : pending.mode === 'audio'
              ? 'audio'
              : 'image',
        prompt: pending.prompt,
        model: pending.modelId || undefined,
        images: pending.referenceImages,
        params: creationPrefillParams(pending, managedGeneration),
        source: 'canvas-toolbar',
      });
      clearPendingCreation();
    };

    pendingCreationTimerRef.current = window.setTimeout(deliver, 100);
  }, []);

  useEffect(() => () => {
    if (pendingCreationTimerRef.current !== null) {
      window.clearTimeout(pendingCreationTimerRef.current);
    }
  }, []);

  const handleOpenCreativeCenter = useCallback(async (modelId?: string) => {
    clearCreationCenterDraft();
    const url = new URL('/creative-center', window.location.origin);
    if (modelId) {
      url.searchParams.set('model', modelId);
      url.searchParams.set('mode', modelId.includes('suno') || modelId.includes('udio') ? 'audio' : 'image');
    }
    navigateTo(`${url.pathname}${url.search}`);
  }, [navigateTo]);

  const handleOpenCreativeCenterRequest = useCallback(async (request?: CreationRequest) => {
    if (request && Object.keys(request).length > 0) {
      saveCreationCenterDraft(request);
    } else {
      clearCreationCenterDraft();
    }
    navigateTo('/creative-center');
  }, [navigateTo]);

  const handleGoHome = useCallback(() => {
    navigateTo('/');
  }, [navigateTo]);

  const handleOpenMusicStation = useCallback((modelId?: string) => {
    const url = new URL('/music-station', window.location.origin);
    if (modelId) url.searchParams.set('model', modelId);
    navigateTo(`${url.pathname}${url.search}`);
  }, [navigateTo]);

  const handleOpenModel = useCallback((model: MarketplaceModel) => {
    if (model.category === 'audio') {
      handleOpenMusicStation(model.id);
      return;
    }
    void handleOpenCreativeCenter(model.id);
  }, [handleOpenCreativeCenter, handleOpenMusicStation]);

  const handleOpenWorks = useCallback(() => {
    navigateTo('/works');
  }, [navigateTo]);

  const handleOpenWorkflows = useCallback(() => {
    navigateTo('/workflows');
  }, [navigateTo]);

  const handleOpenModels = useCallback(() => {
    navigateTo('/#models');
  }, [navigateTo]);

  const handleOpenTemplates = useCallback(() => {
    navigateTo('/#templates');
  }, [navigateTo]);

  const handleOpenAccount = useCallback((nextPath: string) => {
    window.location.assign(`/account?next=${encodeURIComponent(nextPath)}`);
  }, []);

  const handleOpenBoardFromCenter = useCallback(async (boardId: string) => {
    try {
      const workspaceService = WorkspaceService.getInstance();
      await workspaceService.initialize();
      const board = await workspaceService.switchBoard(boardId);
      if (!board) {
        throw new Error('创作空间不存在');
      }
      workspaceService.persistCurrentBoardId(board.id);
      const url = new URL('/', window.location.origin);
      url.searchParams.set(BOARD_URL_PARAM, board.id);
      window.location.assign(url.toString());
    } catch (error) {
      console.error('[App] Failed to open board from creative center:', error);
      MessagePlugin.error({
        content: '画布暂时无法打开，请稍后重试',
        duration: 5000,
        closeBtn: true,
      });
    }
  }, []);

  // Keep ordinary pages in sync with browser back/forward navigation.
  useEffect(() => {
    const handlePopState = async () => {
      if (isHandlingPopStateRef.current) {
        return;
      }

      isHandlingPopStateRef.current = true;

      try {
        setAppLocation(readAppLocation());
        const urlBoardId = getBoardIdFromUrl();

        if (!urlBoardId) {
          setCurrentBoardId(null);
          window.requestAnimationFrame(() => {
            window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
          });
          return;
        }

        // 如果 URL 中的画布 ID 与当前画布不同，则切换
        if (urlBoardId && urlBoardId !== currentBoardId) {
          const workspaceService = WorkspaceService.getInstance();
          const board = await workspaceService.switchBoard(urlBoardId);

          if (board) {
            // skipUrlUpdate: true 因为 URL 已被浏览器更新
            await handleBoardSwitch(board, true);
            // 但仍需持久化 currentBoardId 到 sessionStorage
            workspaceService.persistCurrentBoardId(board.id);
          }
        }
      } catch (error) {
        console.error('[App] Failed to handle browser navigation:', error);
      } finally {
        isHandlingPopStateRef.current = false;
      }
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [currentBoardId, handleBoardSwitch]);

  // Handle tab sync (when other tab modified data)
  const handleTabSyncNeeded = useCallback(async () => {
    // 设置同步标志，防止同步期间的 onChange 触发保存（保存旧数据覆盖新数据）
    isSyncingRef.current = true;

    try {
      const workspaceService = WorkspaceService.getInstance();
      let currentBoard = workspaceService.getCurrentBoard();

      // 如果画板未加载（getCurrentBoard 返回 null），先通过 switchBoard 加载
      if (!currentBoard) {
        const currentBoardId = workspaceService.getState().currentBoardId;
        if (!currentBoardId) {
          console.warn('[App] handleTabSyncNeeded: no current board ID');
          return;
        }

        // 验证画板是否存在
        if (!workspaceService.getBoardMetadata(currentBoardId)) {
          console.warn(
            '[App] handleTabSyncNeeded: board not found',
            currentBoardId
          );
          return;
        }

        try {
          // 加载画板完整数据
          currentBoard = await workspaceService.switchBoard(currentBoardId);
        } catch (error) {
          console.error(
            '[App] handleTabSyncNeeded: failed to load board',
            error
          );
          return;
        }
      }

      // 使用 reloadBoard 强制从 IndexedDB 重新加载数据（而不是使用缓存）
      const updatedBoard = await workspaceService.reloadBoard(currentBoard.id);

      if (updatedBoard) {
        // 恢复视频 URL
        const elements = await recoverVideoUrlsInElements(
          updatedBoard.elements || []
        );
        const nextData = {
          children: elements,
          viewport: updatedBoard.viewport,
          theme: updatedBoard.theme,
        };
        updateLatestBoardData(
          updatedBoard.id,
          nextData,
          updatedBoard.updatedAt
        );
        hasPendingPersistenceRef.current = false;

        // 更新 React 状态，触发重新渲染
        setValue(nextData);
      }
    } catch (error) {
      console.error('[App] Failed to sync board data:', error);
      // 如果同步失败，降级到刷新页面
      void safeReload();
    } finally {
      // 延迟清除同步标志，等待 React 重渲染完成后 onChange 触发的保存被跳过
      // React 18 的批量更新可能在下一帧才执行，所以使用 setTimeout 确保足够延迟
      setTimeout(() => {
        isSyncingRef.current = false;
      }, 100);
    }
  }, [updateLatestBoardData]);

  // Handle board changes (auto-save)
  const handleBoardChange = useCallback(
    (data: BoardChangeData) => {
      setValue(data);
      // 同步更新最新 viewport
      latestViewportRef.current = data.viewport;

      // 只在数据准备好之后才保存，避免在初始化时保存空数据
      // 使用 ref 而非 state，避免闭包捕获旧值（Wrapper 中 BOARD_TO_AFTER_CHANGE 不会因 onChange 变化而更新）
      if (!isDataReadyRef.current) {
        return;
      }

      // 同步期间不保存，防止用旧数据覆盖其他标签页保存的新数据
      if (isSyncingRef.current) {
        return;
      }

      // 标记本标签页有用户主动修改
      localDirtyRef.current = true;
      hasPendingPersistenceRef.current = true;

      // Save to current board
      const workspaceService = WorkspaceService.getInstance();

      // 额外安全检查：确保当前画板已经完全加载
      const currentBoard = workspaceService.getCurrentBoard();
      if (!currentBoard) {
        console.warn(
          '[App] handleBoardChange: board not fully loaded, skipping save'
        );
        return;
      }

      updateLatestBoardData(currentBoard.id, data);

      workspaceService
        .saveCurrentBoard(data)
        .then(() => {
          hasPendingPersistenceRef.current = false;
          clearBoardCloseSnapshot(currentBoard.id);
          // 通知其他标签页数据已更新
          markTabSyncVersion(currentBoard.id);
        })
        .catch((err: Error) => {
          console.error('[App] Failed to save board:', err);
        });
    },
    [updateLatestBoardData]
  );

  // Handle viewport changes (pan/zoom) - 单独保存 viewport
  const handleViewportChange = useCallback(
    (viewport: Viewport) => {
      // 更新最新 viewport
      latestViewportRef.current = viewport;
      const latestSnapshot = latestBoardDataRef.current;
      if (latestSnapshot) {
        latestBoardDataRef.current = {
          ...latestSnapshot,
          viewport,
          updatedAt: Date.now(),
        };
      }

      // 同步期间不保存 viewport，防止用旧数据覆盖
      if (isSyncingRef.current) {
        return;
      }

      hasPendingPersistenceRef.current = true;

      // 防抖保存
      if (viewportSaveTimerRef.current) {
        clearTimeout(viewportSaveTimerRef.current);
      }
      viewportSaveTimerRef.current = setTimeout(() => {
        // 再次检查同步状态
        if (isSyncingRef.current) {
          return;
        }

        const workspaceService = WorkspaceService.getInstance();
        const currentBoard = workspaceService.getCurrentBoard();
        if (currentBoard) {
          // 只保存 viewport，不影响其他数据
          workspaceService
            .saveCurrentBoard({
              children: currentBoard.elements,
              viewport: viewport,
              theme: currentBoard.theme,
            })
            .then(() => {
              hasPendingPersistenceRef.current = false;
              clearBoardCloseSnapshot(currentBoard.id);
            })
            .catch((err: Error) => {
              console.error('[App] Failed to save viewport:', err);
            });
        }
      }, VIEWPORT_SAVE_DEBOUNCE);
    },
    [updateLatestBoardData]
  );

  // 页面关闭/隐藏前保存当前画布快照，并尽量 flush 到 IndexedDB
  useEffect(() => {
    const flushBoardBeforeLeave = (
      reason: 'visibilitychange' | 'pagehide' | 'beforeunload'
    ) => {
      // 清除防抖定时器
      if (viewportSaveTimerRef.current) {
        clearTimeout(viewportSaveTimerRef.current);
        viewportSaveTimerRef.current = null;
      }

      // 同步期间不保存，防止旧数据覆盖
      if (isSyncingRef.current) {
        return;
      }

      const workspaceService = WorkspaceService.getInstance();
      const currentBoard = workspaceService.getCurrentBoard();
      const latestSnapshot = latestBoardDataRef.current;
      const viewport = latestViewportRef.current;
      const boardId = currentBoardIdRef.current;

      if (
        currentBoard &&
        boardId &&
        (!latestSnapshot || latestSnapshot.boardId !== boardId)
      ) {
        updateLatestBoardData(
          currentBoard.id,
          {
            children: currentBoard.elements,
            viewport: viewport ?? currentBoard.viewport,
            theme: currentBoard.theme,
          },
          Date.now()
        );
      }

      if (reason === 'visibilitychange' && !localDirtyRef.current) {
        return;
      }

      persistCloseSnapshot(reason);
    };

    const handleBeforeUnload = () => {
      flushBoardBeforeLeave('beforeunload');
    };

    // 页面隐藏时也保存（处理移动端和标签页切换）
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushBoardBeforeLeave('visibilitychange');
      }
    };

    const handlePageHide = () => {
      flushBoardBeforeLeave('pagehide');
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      // 清理定时器
      if (viewportSaveTimerRef.current) {
        clearTimeout(viewportSaveTimerRef.current);
      }
    };
  }, [persistCloseSnapshot, updateLatestBoardData]);

  // 处理安全模式选择
  const handleSafeModeChoice = useCallback((useSafeMode: boolean) => {
    setShowCrashDialog(false);
    if (useSafeMode) {
      crashRecoveryService.enableSafeMode();
    } else {
      crashRecoveryService.clearCrashState();
    }
    // 重新初始化
    setIsLoading(true);
    appInitialized = false;
    // 使用 setTimeout 确保状态更新后再触发 useEffect
    setTimeout(() => {
      void safeReload();
    }, 100);
  }, []);

  // 显示崩溃恢复对话框（统一使用 ErrorFallbackUI）
  if (showCrashDialog) {
    return (
      <ErrorFallbackUI
        variant="crash"
        crashCount={crashRecoveryService.getCrashCount()}
        memoryInfo={crashRecoveryService.getMemoryInfo()}
        onIgnore={() => handleSafeModeChoice(false)}
        onSafeModeReload={() => handleSafeModeChoice(true)}
        onGoToDebug={goToDebug}
      />
    );
  }

  // 初始化失败：展示错误 UI 而非白屏
  if (initError) {
    return (
      <ErrorFallbackUI
        variant="error"
        title="应用初始化失败"
        description="无法加载画板数据，可能是存储损坏或浏览器限制。"
        errorMessage={initError.message}
        errorStack={initError.stack}
        onExportLog={() => collectAndDownloadErrorLog(initError)}
        onSafeModeReload={safeModeReload}
        onGoToDebug={goToDebug}
      />
    );
  }

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
        }}
      >
        加载中...
      </div>
    );
  }

  const hasBoard = new URLSearchParams(appLocation.search).has(BOARD_URL_PARAM);

  if (isCreativeCenterPath(appLocation.pathname) && !hasBoard) {
    const centerParams = new URLSearchParams(appLocation.search);
    return (
      <CreativeCenterPage
        isCreating={isStartingWorkspace}
        onCreateBoard={handleStartCreating}
        onOpenBoard={handleOpenBoardFromCenter}
        onGoHome={handleGoHome}
        onLogin={() => {
          window.location.assign('/account?next=/creative-center');
        }}
        onOpenWorks={handleOpenWorks}
        onOpenWorkflows={handleOpenWorkflows}
        onOpenMusicStation={handleOpenMusicStation}
        onOpenModels={handleOpenModels}
        onOpenTemplates={handleOpenTemplates}
        onOpenAdmin={() => navigateTo('/admin/providers')}
        selectedModelId={centerParams.get('model')}
        selectedMode={centerParams.get('mode')}
      />
    );
  }

  if (isMusicStationPath(appLocation.pathname) && !hasBoard) {
    return (
      <Suspense fallback={<RouteLoading />}>
        <MusicStationPage
          onGoHome={handleGoHome}
          onGoCreativeCenter={handleOpenCreativeCenter}
          onOpenAccount={() => handleOpenAccount('/music-station')}
        />
      </Suspense>
    );
  }

  if (isWorksPath(appLocation.pathname) && !hasBoard) {
    return (
      <Suspense fallback={<RouteLoading />}>
        <WorksPage
          onGoHome={handleGoHome}
          onGoCreativeCenter={handleOpenCreativeCenterRequest}
          onOpenWorkflows={handleOpenWorkflows}
          onOpenBoard={handleOpenBoardFromCenter}
          onOpenAccount={() => handleOpenAccount('/works')}
        />
      </Suspense>
    );
  }

  if (isWorkflowsPath(appLocation.pathname) && !hasBoard) {
    return (
      <Suspense fallback={<RouteLoading />}>
        <WorkflowsPage
          onGoHome={handleGoHome}
          onGoCreativeCenter={handleOpenCreativeCenterRequest}
          onOpenWorks={handleOpenWorks}
          onOpenAccount={() => handleOpenAccount('/workflows')}
        />
      </Suspense>
    );
  }

  if (isProviderAdminPath(appLocation.pathname) && !hasBoard) {
    return (
      <Suspense fallback={<RouteLoading />}>
        <ProviderAdminPage onGoHome={handleGoHome} onGoCreativeCenter={() => void handleOpenCreativeCenter()} />
      </Suspense>
    );
  }

  if (!hasBoard) {
      return (
        <HomePage
          onStartCreating={handleOpenCreativeCenterRequest}
          onLogin={() => {
            window.location.assign('/account');
          }}
        onOpenMusicStation={handleOpenMusicStation}
        onOpenModel={handleOpenModel}
        onOpenWorks={handleOpenWorks}
        onOpenWorkflows={handleOpenWorkflows}
        onOpenAdmin={() => navigateTo('/admin/providers')}
      />
    );
  }

  const currentBoard = WorkspaceService.getInstance().getCurrentBoard();

  return (
    <WorkspaceShell
      boardName={currentBoard?.name || '未命名创作空间'}
      boardId={currentBoardId}
      elementCount={value.children.length}
      isReady={isDataReady}
      onCreateBoard={handleCreateBoard}
      onSwitchBoard={handleSwitchBoardById}
      onRenameBoard={handleRenameBoard}
      onOpenWorkflows={handleOpenWorkflows}
      onOpenAccount={() => handleOpenAccount(`${window.location.pathname}${window.location.search}`)}
    >
      <Suspense fallback={<RouteLoading />}>
        <Drawnix
          value={value.children}
          viewport={value.viewport}
          theme={value.theme}
          onChange={handleBoardChange}
          onViewportChange={handleViewportChange}
          onBoardSwitch={handleBoardSwitch}
          onTabSyncNeeded={handleTabSyncNeeded}
          isDataReady={isDataReady}
          currentBoardId={currentBoardId}
          afterInit={(board) => {
            // 保存 board 引用，用于手动触发边界更新
            boardRef.current = board;
            prefillPendingCreation(getBoardIdFromUrl());

            (
              window as unknown as {
                __drawnix__web__console: (value: string) => void;
              }
            )['__drawnix__web__console'] = (value: string) => {
              addDebugLog(board, value);
            };
          }}
        />
      </Suspense>
    </WorkspaceShell>
  );
}

const addDebugLog = async (board: PlaitBoard, value: string) => {
  const { PlaitBoard } = await import('@plait/core');
  const container = PlaitBoard.getBoardContainer(board).closest(
    '.drawnix'
  ) as HTMLElement | null;
  if (!container) {
    return;
  }
  let consoleContainer = container.querySelector('.drawnix-console');
  if (!consoleContainer) {
    consoleContainer = document.createElement('div');
    consoleContainer.classList.add('drawnix-console');
    container.append(consoleContainer);
  }
  const div = document.createElement('div');
  div.textContent = value;
  consoleContainer.append(div);
};

/**
 * 迁移元素数组中的视频 URL 格式
 * 新格式 (/__aitu_cache__/video/...) 是稳定的，由 Service Worker 直接从 Cache API 返回
 * 旧格式 (blob:...#merged-video-xxx) 需要迁移到新格式
 */
async function recoverVideoUrlsInElements(
  elements: PlaitElement[]
): Promise<PlaitElement[]> {
  return elements.map((element) => {
    const url = (element as any).url as string | undefined;

    // 新格式：稳定 URL，无需处理
    if (url?.startsWith('/__aitu_cache__/video/')) {
      return element;
    }

    // 旧格式：blob URL + #merged-video-xxx
    // 提取 taskId，转换为新格式
    if (url?.startsWith('blob:') && url.includes('#merged-video-')) {
      const hashIndex = url.indexOf('#merged-video-');
      if (hashIndex !== -1) {
        const afterHash = url.substring(hashIndex + 1);
        const nextHashIndex = afterHash.indexOf('#', 1);
        const taskId =
          nextHashIndex > 0 ? afterHash.substring(0, nextHashIndex) : afterHash;

        // 转换为新格式的稳定 URL（带 .mp4 后缀）
        const newUrl = `/__aitu_cache__/video/${taskId}.mp4`;
        // console.log(`[App] Migrating video URL: ${taskId}`);
        return { ...element, url: newUrl };
      }
    }

    return element;
  });
}

/**
 * 从树结构中找到第一个画板
 */
function findFirstBoard(nodes: TreeNode[]): Board | null {
  for (const node of nodes) {
    if (node.type === 'board') {
      return node.data;
    }
    if (node.type === 'folder' && node.children) {
      const board = findFirstBoard(node.children);
      if (board) return board;
    }
  }
  return null;
}

export default App;
