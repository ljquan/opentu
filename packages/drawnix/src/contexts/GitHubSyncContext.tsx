/**
 * GitHub Sync Context
 * 提供全局同步状态管理
 */

import React, { createContext, useContext, useCallback, useEffect, useState, useRef } from 'react';
import { maskId } from '@aitu/utils';
import {
  syncEngine,
  tokenService,
  mediaSyncService,
  SyncStatus,
  SyncResult,
  SyncConfig,
  logDebug,
  logInfo,
  logSuccess,
  logWarning,
  logError,
} from '../services/github-sync';
import { workspaceService } from '../services/workspace-service';

/** Gist 信息 */
export interface GistInfo {
  id: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  filesCount: number;
  url: string;
  isCurrent: boolean;
  /** 是否为分片主 Gist（包含 master-index.json） */
  isMaster: boolean;
}

/** 同步上下文值 */
interface GitHubSyncContextValue {
  // 连接状态
  isConnected: boolean;
  isConfigured: boolean;
  
  // 同步状态
  syncStatus: SyncStatus;
  isSyncing: boolean;
  lastSyncTime: number | null;
  
  // 用户信息
  userInfo: { login: string; name: string | null; avatar_url: string } | null;
  
  // 错误信息
  error: string | null;
  
  // Token 操作
  setToken: (token: string) => Promise<boolean>;
  clearToken: () => void;
  
  // 同步操作
  sync: () => Promise<SyncResult>;
  /** 以远程为准同步（下载远程数据，覆盖本地） */
  pullFromRemote: () => Promise<SyncResult>;
  /** 以本地为准同步（上传本地数据，覆盖远程） */
  pushToRemote: () => Promise<SyncResult>;
  
  // Gist URL
  gistUrl: string | null;
  
  // Gist 管理
  listGists: () => Promise<GistInfo[]>;
  switchGist: (gistId: string) => Promise<SyncResult>;
  deleteGist: (gistId: string) => Promise<void>;
  createNewGist: () => Promise<SyncResult>;
  
  // 配置
  config: SyncConfig | null;
  updateConfig: (config: Partial<SyncConfig>) => Promise<void>;
}

const GitHubSyncContext = createContext<GitHubSyncContextValue | null>(null);
const emptySyncResult: SyncResult = {
  success: false,
  uploaded: { boards: 0, prompts: 0, tasks: 0, media: 0, knowledgeBase: 0 },
  downloaded: { boards: 0, prompts: 0, tasks: 0, media: 0, knowledgeBase: 0 },
  conflicts: [],
  duration: 0,
  error: 'GitHub Sync context is unavailable',
};

const fallbackGitHubSyncContextValue: GitHubSyncContextValue = {
  isConnected: false,
  isConfigured: false,
  syncStatus: 'not_configured',
  isSyncing: false,
  lastSyncTime: null,
  userInfo: null,
  error: 'GitHub Sync context is unavailable',
  setToken: async () => false,
  clearToken: () => {},
  sync: async () => emptySyncResult,
  pullFromRemote: async () => emptySyncResult,
  pushToRemote: async () => emptySyncResult,
  gistUrl: null,
  listGists: async () => [],
  switchGist: async () => emptySyncResult,
  deleteGist: async () => {},
  createNewGist: async () => emptySyncResult,
  config: null,
  updateConfig: async () => {},
};

/** Provider Props */
interface GitHubSyncProviderProps {
  children: React.ReactNode;
}

/**
 * 处理同步后的画板切换逻辑
 * 这个函数被 setToken 和 sync 共用
 */
async function handleBoardSwitchAfterSync(result: SyncResult): Promise<void> {
  logDebug('handleBoardSwitchAfterSync START', {
    success: result.success,
    downloaded: result.downloaded,
    uploaded: result.uploaded,
    remoteCurrentBoardId: result.remoteCurrentBoardId,
  });
  
  if (!result.success) {
    logDebug('handleBoardSwitchAfterSync END (not successful)');
    return;
  }
  
  try {
    // 先获取工作区当前状态
    const workspaceState = workspaceService.getState();
    const currentBoardId = workspaceState.currentBoardId;
    const allBoards = workspaceService.getAllBoardMetadata();

    logDebug('Current workspace state', {
      currentBoardId,
      totalBoards: allBoards.length,
    });
    
    // 确定目标画板
    let targetBoardId = result.remoteCurrentBoardId;
    logDebug('Initial targetBoardId', { targetBoardId });
    
    // 如果没有远程当前画板记录，使用第一个可用画板
    if (!targetBoardId) {
      if (allBoards.length > 0) {
        targetBoardId = allBoards[0].id;
        logDebug('Using first board as target', { targetBoardId, name: allBoards[0].name });
      } else {
        logDebug('No boards available');
      }
    }
    
    logDebug('Final targetBoardId', { targetBoardId });
    
    // 如果没有找到目标画板，直接返回
    if (!targetBoardId) {
      logDebug('handleBoardSwitchAfterSync END (no target)');
      return;
    }
    
    // 验证目标画板是否在可用画板列表中
    const targetExists = allBoards.some(b => b.id === targetBoardId);
    logDebug('Target board exists in metadata', { targetExists });
    if (!targetExists) {
      logWarning('Target board not found in available boards', { 
        targetBoardId, 
        availableIds: allBoards.map(b => b.id) 
      });
    }
    
    // 情况1：当前没有选中任何画板，直接切换到目标画板
    if (!currentBoardId) {
      logDebug('DECISION: No current board, switching to target', { targetBoardId });
      await workspaceService.switchBoard(targetBoardId);
      logDebug('handleBoardSwitchAfterSync END (switched from null)');
      return;
    }

    // 情况2：目标画板与当前画板相同
    // 虽然不需要切换，但需要刷新内存缓存中的画板数据（因为同步可能更新了存储中的数据）
    if (targetBoardId === currentBoardId) {
      logDebug('DECISION: Target board is current board, reloading');
      try {
        // 刷新画板数据，让 UI 显示最新同步的内容
        await workspaceService.reloadBoard(targetBoardId);
        logDebug('Board data reloaded successfully');
      } catch (reloadError) {
        logError('Failed to reload board data', reloadError instanceof Error ? reloadError : new Error(String(reloadError)));
      }
      logDebug('handleBoardSwitchAfterSync END (same board, reloaded)');
      return;
    }
    
    // 情况3：检查当前画板是否是"默认空白画板"
    const isCurrentDefaultEmpty = await workspaceService.isDefaultEmptyBoard(currentBoardId);
    logDebug('isCurrentDefaultEmpty', { isCurrentDefaultEmpty });
    
    if (isCurrentDefaultEmpty) {
      logDebug('DECISION: Current board is default empty, auto-switching', { targetBoardId });
      // 先切换到新画板
      await workspaceService.switchBoard(targetBoardId);
      // 再删除旧的默认空白画板
      await workspaceService.deleteBoard(currentBoardId);
      logDebug('handleBoardSwitchAfterSync END (replaced default)');
    } else {
      // 当前画板非空或非默认画板，保持当前画板不变
      logDebug('DECISION: Current board is not default empty, keeping current');
      logDebug('handleBoardSwitchAfterSync END (keep current)');
    }
  } catch (e) {
    logError('handleBoardSwitchAfterSync failed', e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * GitHub Sync Provider
 */
export function GitHubSyncProvider({ children }: GitHubSyncProviderProps) {
  // 状态
  const [isConnected, setIsConnected] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('not_configured');
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
  const [userInfo, setUserInfo] = useState<{ login: string; name: string | null; avatar_url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [gistUrl, setGistUrl] = useState<string | null>(null);

  // 初始化标记
  const initializedRef = useRef(false);

  // 初始化
  useEffect(() => {
    if (initializedRef.current) {
      return;
    }
    initializedRef.current = true;
    logDebug('GitHubSyncProvider initializing');

    const initialize = async () => {
      // 检查是否已配置 Token
      const hasToken = tokenService.hasToken();
      setIsConfigured(hasToken);

      if (hasToken) {
        // 验证 Token 并获取用户信息（一次请求完成）
        const { isValid, userInfo: info } = await tokenService.validateAndGetUserInfo();
        setIsConnected(isValid);

        if (isValid) {
          setUserInfo(info);

          // 获取配置
          const syncConfig = await syncEngine.getConfig();
          setConfig(syncConfig);
          setLastSyncTime(syncConfig.lastSyncTime);
          setGistUrl(syncEngine.getGistUrl());

          // 刷新媒体同步状态（只有在已配置 gistId 时才执行）
          if (syncConfig.gistId) {
            // 延迟执行同步操作，避免阻塞首屏渲染
            // 使用 requestIdleCallback 在浏览器空闲时执行
            const scheduleSync = () => {
              if ('requestIdleCallback' in window) {
                (window as Window).requestIdleCallback(async () => {
                  await performAutoSync();
                }, { timeout: 3000 }); // 最多延迟 3 秒
              } else {
                // Safari 不支持 requestIdleCallback，使用 setTimeout 兜底
                setTimeout(async () => {
                  await performAutoSync();
                }, 1000);
              }
            };

            const performAutoSync = async () => {
              try {
                // 刷新媒体同步状态
                mediaSyncService.refreshSyncStatus().catch(() => {});
                
                // 页面加载时自动从远程同步数据
                // 使用 pullFromRemote 而不是双向 sync，以确保获取远程最新数据
                logInfo('Auto-syncing from remote on page load (deferred)');
                const result = await syncEngine.pullFromRemote();
                if (result.success) {
                  logSuccess('Auto-sync from remote successful', result.downloaded);
                  // 更新最后同步时间
                  const updatedConfig = await syncEngine.getConfig();
                  setLastSyncTime(updatedConfig.lastSyncTime);
                  // 处理画板切换逻辑
                  await handleBoardSwitchAfterSync(result);
                } else {
                  logWarning('Auto-sync from remote failed', { error: result.error });
                }
              } catch (error) {
                logError('Auto-sync from remote error', error instanceof Error ? error : new Error(String(error)));
              }
            };

            scheduleSync();
          }
        } else {
          setError('Token 无效，请重新配置');
        }
      }

      // 获取初始同步状态
      setSyncStatus(syncEngine.getSyncStatus());
    };

    initialize();

    // 监听同步状态变化
    const handleStatusChange = (status: SyncStatus, message?: string) => {
      setSyncStatus(status);
      setIsSyncing(status === 'syncing');
      if (status === 'error' && message) {
        setError(message);
      } else if (status === 'synced') {
        setError(null);
      }
    };

    syncEngine.addStatusListener(handleStatusChange);

    // 页面隐藏时自动同步（切换标签页、最小化窗口等）
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // 页面变为隐藏时，如果已连接且有未同步的变更，触发同步
        if (tokenService.hasToken() && syncEngine.hasPendingChanges()) {
          logDebug('Page hidden, triggering sync');
          syncEngine.sync().catch(() => {});
        }
      }
    };

    // 页面关闭/刷新前的警告
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      // 如果正在同步，显示警告
      if (syncEngine.getSyncStatus() === 'syncing') {
        event.preventDefault();
        event.returnValue = '同步正在进行中，确定要离开吗？';
        return event.returnValue;
      }
      // 如果有未同步的变更，触发同步（不阻塞页面关闭）
      if (tokenService.hasToken() && syncEngine.hasPendingChanges()) {
        logDebug('Page unloading, triggering sync');
        // 使用同步方式触发，但不等待结果
        syncEngine.sync().catch(() => {});
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    // 监听工作区变更，自动标记需要同步
    logDebug('Setting up workspace event subscription');
    
    // 获取 observable
    const observable = workspaceService.observeEvents();
    
    const workspaceSubscription = observable.subscribe({
      next: (event) => {
        // 只对同步相关事件处理
        const syncTriggerEvents = [
          'boardCreated',
          'boardUpdated',
          'boardDeleted',
          'folderCreated',
          'folderUpdated',
          'folderDeleted',
        ];
      
      // 只在已连接时才标记变更
      if (!tokenService.hasToken()) {
        return;
      }
      
      if (syncTriggerEvents.includes(event.type)) {
        logDebug('Workspace changed, marking dirty', { eventType: event.type });
        syncEngine.markDirty();
        // 记录本地删除的画板，并立即同步到远程回收站
        if (event.type === 'boardDeleted') {
          const boardId = (event.payload as { id?: string })?.id;
          if (boardId && typeof boardId === 'string') {
            logDebug('Syncing board deletion to remote', { boardId });
            // 先记录本地删除，然后立即同步到远程
            syncEngine.recordLocalDeletion(boardId).then(() => {
              // 立即同步删除到远程回收站
              return syncEngine.syncBoardDeletion(boardId);
            }).then((result) => {
              if (result.success) {
                logSuccess('Board moved to remote recycle bin', { boardId });
              } else {
                logWarning('Failed to sync deletion to remote', { boardId, error: result.error });
              }
            }).catch((err) => {
              logError('Failed to sync board deletion', err instanceof Error ? err : new Error(String(err)), { boardId });
            });
          } else {
            logWarning('boardDeleted event has invalid payload', { payload: event.payload });
          }
        }
      }
      },
      error: (err) => {
        logError('Workspace event subscription error', err instanceof Error ? err : new Error(String(err)));
      },
      complete: () => {
        logDebug('Workspace event subscription completed');
      }
    });
    logDebug('Workspace event subscription established');

    return () => {
      syncEngine.removeStatusListener(handleStatusChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      workspaceSubscription.unsubscribe();
    };
  }, []);

  // 设置 Token
  const setToken = useCallback(async (token: string): Promise<boolean> => {
    try {
      setError(null);

      // 验证 Token 格式
      if (!tokenService.isValidTokenFormat(token)) {
        setError('Token 格式无效');
        return false;
      }

      // 验证 Token 有效性并获取用户信息（一次请求完成）
      const { isValid, userInfo: info } = await tokenService.validateAndGetUserInfo(token);
      if (!isValid) {
        setError('Token 无效或已过期');
        return false;
      }

      // 检查 gist 权限
      await tokenService.saveToken(token);
      const hasGistScope = await tokenService.hasGistScope();
      if (!hasGistScope) {
        setError('Token 缺少 gist 权限，请重新创建');
        tokenService.clearToken();
        return false;
      }

      setUserInfo(info);

      // 自动查找主数据库并同步（sync 内部会使用 findSyncGist 选择最新的主 Gist）
      try {
        logInfo('Auto-connecting and syncing...');
        
        // 重置 gistId，强制 sync() 重新选择正确的主数据库
        await syncEngine.saveConfig({ gistId: null });
        
        // 调用 sync()，它会自动查找包含 master-index.json 的最新主 Gist
        const result = await syncEngine.sync();
        
        // 更新配置状态（无论同步是否成功，Gist ID 可能已经被设置）
        const syncConfig = await syncEngine.getConfig();
        setConfig(syncConfig);
        setLastSyncTime(syncConfig.lastSyncTime);
        setGistUrl(syncEngine.getGistUrl());
        
        if (!result.success) {
          logWarning('Auto-connect sync failed', { error: result.error });
        } else {
          // 同步成功后，处理画板切换逻辑
          logSuccess('Auto-connect sync successful', { 
            downloaded: result.downloaded,
            gistId: syncConfig.gistId ? maskId(syncConfig.gistId) : null,
          });
          await handleBoardSwitchAfterSync(result);
        }
      } catch (error) {
        logError('Failed to auto-connect gist', error instanceof Error ? error : new Error(String(error)));
      }

      // 更新状态 - 延迟到所有初始化完成后
      setIsConfigured(true);
      setIsConnected(true);

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : '设置 Token 失败';
      setError(message);
      return false;
    }
  }, []);

  // 清除 Token
  const clearToken = useCallback(() => {
    tokenService.clearToken();
    syncEngine.disconnect();
    
    setIsConfigured(false);
    setIsConnected(false);
    setUserInfo(null);
    setSyncStatus('not_configured');
    setLastSyncTime(null);
    setGistUrl(null);
    setConfig(null);
    setError(null);
  }, []);

  // 执行同步
  const sync = useCallback(async (): Promise<SyncResult> => {
    // 如果已经在同步中，直接返回，不设置错误
    if (isSyncing) {
      return {
        success: false,
        uploaded: { boards: 0, prompts: 0, tasks: 0, media: 0, knowledgeBase: 0 },
        downloaded: { boards: 0, prompts: 0, tasks: 0, media: 0, knowledgeBase: 0 },
        conflicts: [],
        duration: 0,
      };
    }

    setError(null);
    const result = await syncEngine.sync();
    
    if (result.success) {
      const syncConfig = await syncEngine.getConfig();
      setLastSyncTime(syncConfig.lastSyncTime);
      setGistUrl(syncEngine.getGistUrl());
      setConfig(syncConfig);

      // 如果有下载的画板，且当前画板被更新，刷新当前画板数据
      // 这解决了同步后，虽然数据已更新到存储，但内存中仍是旧数据导致显示为空的问题
      if (result.downloaded.boards > 0) {
        const currentBoardId = workspaceService.getState().currentBoardId;
        if (currentBoardId) {
          try {
            // 尝试重新加载当前画板，确保 UI 显示最新数据
            await workspaceService.reloadBoard(currentBoardId);
          } catch (e) {
            // 忽略错误，可能是当前画板已被删除或不在下载列表中
            logWarning('Failed to reload current board', { error: String(e) });
          }
        }
      }

      // 处理画板切换逻辑（使用公共函数）
      await handleBoardSwitchAfterSync(result);
    } else if (result.error) {
      // 忽略"同步正在进行中"的错误消息，这是正常的并发保护
      if (result.error !== '同步正在进行中') {
        setError(result.error);
      }
    }

    return result;
  }, [isSyncing]);

  // 以远程为准同步（下载远程数据，覆盖本地）
  const pullFromRemote = useCallback(async (): Promise<SyncResult> => {
    if (isSyncing) {
      return {
        success: false,
        uploaded: { boards: 0, prompts: 0, tasks: 0, media: 0, knowledgeBase: 0 },
        downloaded: { boards: 0, prompts: 0, tasks: 0, media: 0, knowledgeBase: 0 },
        conflicts: [],
        duration: 0,
      };
    }

    setError(null);
    const result = await syncEngine.pullFromRemote();
    
    if (result.success) {
      const syncConfig = await syncEngine.getConfig();
      setLastSyncTime(syncConfig.lastSyncTime);
      setGistUrl(syncEngine.getGistUrl());
      setConfig(syncConfig);

      // 处理画板切换逻辑
      await handleBoardSwitchAfterSync(result);
    } else if (result.error) {
      if (result.error !== '同步正在进行中') {
        setError(result.error);
      }
    }

    return result;
  }, [isSyncing]);

  // 以本地为准同步（上传本地数据，覆盖远程）
  const pushToRemote = useCallback(async (): Promise<SyncResult> => {
    if (isSyncing) {
      return {
        success: false,
        uploaded: { boards: 0, prompts: 0, tasks: 0, media: 0, knowledgeBase: 0 },
        downloaded: { boards: 0, prompts: 0, tasks: 0, media: 0, knowledgeBase: 0 },
        conflicts: [],
        duration: 0,
      };
    }

    setError(null);
    const result = await syncEngine.pushToRemote();
    
    if (result.success) {
      const syncConfig = await syncEngine.getConfig();
      setLastSyncTime(syncConfig.lastSyncTime);
      setGistUrl(syncEngine.getGistUrl());
      setConfig(syncConfig);
    } else if (result.error) {
      if (result.error !== '同步正在进行中') {
        setError(result.error);
      }
    }

    return result;
  }, [isSyncing]);

  // 更新配置
  const updateConfig = useCallback(async (newConfig: Partial<SyncConfig>) => {
    await syncEngine.saveConfig(newConfig);
    const updatedConfig = await syncEngine.getConfig();
    setConfig(updatedConfig);
  }, []);

  // 列出所有同步 Gist
  const listGists = useCallback(async (): Promise<GistInfo[]> => {
    if (!isConnected) {
      return [];
    }
    return syncEngine.listSyncGists();
  }, [isConnected]);

  // 切换到指定 Gist
  const switchGist = useCallback(async (gistId: string): Promise<SyncResult> => {
    setError(null);
    const result = await syncEngine.switchToGist(gistId);
    
    if (result.success) {
      const syncConfig = await syncEngine.getConfig();
      setLastSyncTime(syncConfig.lastSyncTime);
      setGistUrl(syncEngine.getGistUrl());
      setConfig(syncConfig);
    } else if (result.error) {
      // 忽略"同步正在进行中"的错误消息，这是正常的并发保护
      if (result.error !== '同步正在进行中') {
        setError(result.error);
      }
    }

    return result;
  }, []);

  // 删除指定 Gist
  const deleteGist = useCallback(async (gistId: string): Promise<void> => {
    await syncEngine.deleteGist(gistId);
    // 如果删除的是当前 Gist，更新状态
    const syncConfig = await syncEngine.getConfig();
    if (!syncConfig.gistId) {
      setGistUrl(null);
      setConfig(syncConfig);
      setSyncStatus('not_configured');
    }
  }, []);

  // 创建新 Gist
  const createNewGist = useCallback(async (): Promise<SyncResult> => {
    setError(null);
    const result = await syncEngine.createNewGist();
    
    if (result.success) {
      const syncConfig = await syncEngine.getConfig();
      setLastSyncTime(syncConfig.lastSyncTime);
      setGistUrl(syncEngine.getGistUrl());
      setConfig(syncConfig);
    } else if (result.error) {
      // 忽略"同步正在进行中"的错误消息，这是正常的并发保护
      if (result.error !== '同步正在进行中') {
        setError(result.error);
      }
    }

    return result;
  }, []);

  const value: GitHubSyncContextValue = {
    isConnected,
    isConfigured,
    syncStatus,
    isSyncing,
    lastSyncTime,
    userInfo,
    error,
    setToken,
    clearToken,
    sync,
    pullFromRemote,
    pushToRemote,
    gistUrl,
    listGists,
    switchGist,
    deleteGist,
    createNewGist,
    config,
    updateConfig,
  };

  return (
    <GitHubSyncContext.Provider value={value}>
      {children}
    </GitHubSyncContext.Provider>
  );
}

/**
 * useGitHubSync Hook
 */
export function useGitHubSync(): GitHubSyncContextValue {
  const context = useContext(GitHubSyncContext);
  return context ?? fallbackGitHubSyncContextValue;
}

/**
 * 可选的 useGitHubSync Hook（不抛出错误）
 */
export function useGitHubSyncOptional(): GitHubSyncContextValue | null {
  return useContext(GitHubSyncContext);
}
