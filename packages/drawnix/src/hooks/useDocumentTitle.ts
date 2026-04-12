/**
 * useDocumentTitle Hook
 *
 * 管理页面标题，格式为 "Opentu - 项目名"
 * 监听画板名称变化并同步更新页面标题
 */

import { useEffect, useCallback } from 'react';
import { workspaceService } from '../services/workspace-service';

// 默认标题前缀
const TITLE_PREFIX = 'Opentu';
// 默认标题（无项目时）
const DEFAULT_TITLE = 'Opentu - AI应用平台';

/**
 * 设置页面标题
 * @param boardName 画板名称，如果为空则使用默认标题
 */
function setDocumentTitle(boardName?: string): void {
  if (boardName && boardName.trim()) {
    document.title = `${TITLE_PREFIX} - ${boardName.trim()}`;
  } else {
    document.title = DEFAULT_TITLE;
  }
}

/**
 * 根据画板 ID 获取画板名称并更新标题
 * @param boardId 画板 ID
 */
function updateTitleByBoardId(boardId?: string | null): void {
  if (!boardId) {
    setDocumentTitle();
    return;
  }
  
  const board = workspaceService.getBoard(boardId);
  setDocumentTitle(board?.name);
}

/**
 * useDocumentTitle Hook
 * 
 * 监听当前画板变化并自动更新页面标题
 * 
 * @param currentBoardId 当前画板 ID
 * @param currentBoardName 当前画板名称（可选，用于直接设置）
 */
export function useDocumentTitle(
  currentBoardId?: string | null,
  currentBoardName?: string
): {
  updateTitle: (boardName?: string) => void;
} {
  // 如果直接提供了画板名称，优先使用
  useEffect(() => {
    if (currentBoardName !== undefined) {
      setDocumentTitle(currentBoardName);
    } else {
      updateTitleByBoardId(currentBoardId);
    }
  }, [currentBoardId, currentBoardName]);

  // 监听画板更新事件（处理重命名）
  useEffect(() => {
    const subscription = workspaceService.observeEvents().subscribe((event) => {
      // 只关注画板更新事件
      if (event.type === 'boardUpdated') {
        const updatedBoard = event.payload as { id: string; name: string } | undefined;
        // 如果更新的是当前画板，同步更新标题
        if (updatedBoard && updatedBoard.id === currentBoardId) {
          setDocumentTitle(updatedBoard.name);
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [currentBoardId]);

  // 返回手动更新标题的函数
  const updateTitle = useCallback((boardName?: string) => {
    setDocumentTitle(boardName);
  }, []);

  return { updateTitle };
}
