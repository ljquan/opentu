import { useEffect, useRef } from 'react';

const TAB_SYNC_KEY = 'aitu-tab-sync-version';
const POLL_INTERVAL = 500; // 500ms 轮询间隔（比 Excalidraw 的 50ms 更保守）

// 生成当前标签页的唯一ID
const TAB_ID = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

export type TabSyncHandler = () => boolean | void | Promise<boolean | void>;

interface UseTabSyncOptions {
  /** Return false when busy so the next poll retries this version. */
  onSyncNeeded: TabSyncHandler;
  /** 是否启用 */
  enabled?: boolean;
  /** 当前画板 ID（用于过滤同步事件） */
  currentBoardId?: string | null;
}

interface TabSyncData {
  version: number;
  tabId: string;
  boardId?: string; // 变更的画板 ID
}

/**
 * 标签页同步 Hook
 *
 * 通过 localStorage 版本号检测其他标签页的数据变更，
 * 当检测到其他标签页保存了数据时触发 onSyncNeeded 回调。
 *
 * 使用方式：
 * 1. 在数据保存后调用 markDataSaved() 更新版本号
 * 2. 其他标签页会在 POLL_INTERVAL 内检测到变更并触发 onSyncNeeded
 */
export function useTabSync({ onSyncNeeded, enabled = true, currentBoardId }: UseTabSyncOptions) {
  const localVersionRef = useRef<number>(-1);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  // 初始化版本号 & 标签页重新可见时同步
  useEffect(() => {
    if (!enabled) return;

    const stored = localStorage.getItem(TAB_SYNC_KEY);
    if (stored) {
      try {
        const data: TabSyncData = JSON.parse(stored);
        localVersionRef.current = data.version;
      } catch {
        // 兼容旧格式（纯数字）
        localVersionRef.current = parseInt(stored, 10) || Date.now();
      }
    } else {
      localVersionRef.current = Date.now();
    }
  }, [enabled]);

  // 轮询检测
  useEffect(() => {
    if (!enabled) return;

    let active = true;
    let syncing = false;
    const checkSync = async () => {
      const stored = localStorage.getItem(TAB_SYNC_KEY);
      if (!stored) return;

      try {
        const data: TabSyncData = JSON.parse(stored);
        // 只有当版本号更新且不是当前标签页触发的更新时，才触发同步
        if (data.version > localVersionRef.current && data.tabId !== TAB_ID) {
          // 必须有 boardId 才能过滤；无 boardId 的标记跳过（不触发同步）
          // 只有当变更画板 ID 与当前画板 ID 相同时才触发同步
          const shouldSync = currentBoardId && data.boardId && data.boardId === currentBoardId;

          if (shouldSync) {
            if (syncing) return;
            syncing = true;
            try {
              const applied = await onSyncNeeded();
              if (active && applied !== false) {
                localVersionRef.current = Math.max(
                  localVersionRef.current,
                  data.version
                );
              }
            } catch (error) {
              console.warn('[TabSync] Failed to apply board update:', error);
            } finally {
              syncing = false;
            }
          } else {
            localVersionRef.current = data.version;
          }
        } else if (data.version > localVersionRef.current && data.tabId === TAB_ID) {
          // 是自己触发的更新，只更新版本号，不触发同步
          localVersionRef.current = data.version;
        }
      } catch {
        // 兼容旧格式（纯数字）- 不触发同步（无法确定画板）
        const remote = parseInt(stored, 10);
        if (remote > localVersionRef.current) {
          localVersionRef.current = remote;
        }
      }
    };

    intervalRef.current = setInterval(() => {
      // 标签页不可见时不检测
      if (document.hidden) return;
      void checkSync();
    }, POLL_INTERVAL);

    // 标签页变为可见时立即检测，避免轮询间隔内用旧数据覆盖新数据
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void checkSync();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, onSyncNeeded, currentBoardId]);
}

/**
 * 标记数据已保存，通知其他标签页同步
 * 在每次保存数据后调用此函数。
 * @param boardId 可选的画板 ID，用于通知其他标签页哪个画板发生了变更
 */
export function markTabSyncVersion(boardId?: string) {
  try {
    const v = Date.now();
    const data: TabSyncData = { version: v, tabId: TAB_ID, boardId };
    localStorage.setItem(TAB_SYNC_KEY, JSON.stringify(data));
  } catch {
    // 静默处理
  }
}
