/**
 * ProjectDrawer Component
 *
 * Left-side drawer for workspace management.
 * Displays folder tree with boards, supports drag-drop and copy.
 */

import React, {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  DragEvent,
} from 'react';
import {
  Button,
  Input,
  Dropdown,
  Dialog,
  MessagePlugin,
  Loading,
} from 'tdesign-react';
import {
  AddIcon,
  FolderAddIcon,
  ChevronRightIcon,
  SearchIcon,
  MoreIcon,
  FolderIcon,
  FolderOpenIcon,
  DeleteIcon,
  EditIcon,
  ArtboardIcon,
  FileCopyIcon,
  MoveIcon,
  DownloadIcon,
  UploadIcon,
  ViewListIcon,
  LayersIcon,
} from 'tdesign-icons-react';
import { useWorkspace } from '../../hooks/useWorkspace';
import {
  TreeNode,
  FolderTreeNode,
  BoardTreeNode,
  Board,
  WORKSPACE_DEFAULTS,
} from '../../types/workspace.types';
import { BaseDrawer } from '../side-drawer';
import { workspaceExportService } from '../../services/workspace-export-service';
import { safeReload } from '../../utils/active-tasks';
import {
  ContextMenu,
  useContextMenuState,
  type ContextMenuEntry,
} from '../shared';
import { ConfirmDialog } from '../dialog/ConfirmDialog';
import { FramePanel } from './FramePanel';
import { LayerPanel } from './LayerPanel';
import './project-drawer.scss';

export interface ProjectDrawerProps {
  /** Whether the drawer is open */
  isOpen?: boolean;
  /** Called when drawer open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Called when board data should be saved before switching */
  onBeforeSwitch?: () => Promise<void>;
  /** Called after board is switched */
  onBoardSwitch?: (board: Board) => void;
}

// Storage key for drawer width
export const PROJECT_DRAWER_WIDTH_KEY = 'project-drawer-width';

// Drag data interface
interface DragData {
  type: 'board' | 'folder';
  id: string;
}

// Drop position type
type DropPosition = 'before' | 'after' | 'inside' | null;

interface ProjectDrawerContextMenuPayload {
  type: 'folder' | 'board';
  id: string;
  name: string;
  folderId?: string | null;
  parentId?: string | null;
}

// Inner component for tree content
const ProjectDrawerContent: React.FC<{
  tree: TreeNode[];
  currentBoard: Board | null;
  onBoardClick: (board: Board) => void;
  onCreateBoard: (folderId?: string) => void;
  onCreateFolder: (parentId?: string) => void;
  onRename: (type: 'folder' | 'board', id: string, name: string) => void;
  onDelete: (type: 'folder' | 'board', id: string, name: string) => void;
  onDeleteMultiple: (boardIds: string[]) => void;
  onCopyBoard: (id: string) => void;
  onMoveBoard: (
    id: string,
    targetFolderId: string | null,
    targetId?: string,
    position?: 'before' | 'after'
  ) => void;
  onMoveFolder: (
    id: string,
    targetParentId: string | null,
    targetId?: string,
    position?: 'before' | 'after'
  ) => void;
  toggleFolderExpanded: (id: string) => void;
  /** 新建画板后自动进入编辑状态的画板 ID */
  autoEditBoardId?: string | null;
  /** 清除自动编辑状态 */
  onAutoEditDone?: () => void;
  /** 多选状态 */
  selectedBoardIds: Set<string>;
  /** 设置多选状态 */
  onSelectionChange: (ids: Set<string>) => void;
  /** 上次点击的画板 ID（用于 Shift 范围选择）*/
  lastClickedBoardId: string | null;
  /** 设置上次点击的画板 ID */
  onLastClickedChange: (id: string | null) => void;
}> = ({
  tree,
  currentBoard,
  onBoardClick,
  onCreateBoard,
  onCreateFolder,
  onRename,
  onDelete,
  onDeleteMultiple,
  onCopyBoard,
  onMoveBoard,
  onMoveFolder,
  toggleFolderExpanded,
  autoEditBoardId,
  onAutoEditDone,
  selectedBoardIds,
  onSelectionChange,
  lastClickedBoardId,
  onLastClickedChange,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const {
    contextMenu,
    open: openContextMenu,
    close: closeContextMenu,
  } = useContextMenuState<ProjectDrawerContextMenuPayload>();

  const findBoardNameById = useCallback(
    (nodes: TreeNode[], id: string): string | null => {
      for (const node of nodes) {
        if (node.type === 'board' && (node as BoardTreeNode).data.id === id) {
          return (node as BoardTreeNode).data.name;
        }
        if (node.type === 'folder' && (node as FolderTreeNode).children) {
          const found = findBoardNameById(
            (node as FolderTreeNode).children!,
            id
          );
          if (found) return found;
        }
      }
      return null;
    },
    []
  );

  // 扁平化画板列表，用于 Shift 范围选择
  const flattenBoards = useCallback((nodes: TreeNode[]): Board[] => {
    const result: Board[] = [];
    for (const node of nodes) {
      if (node.type === 'board') {
        result.push((node as BoardTreeNode).data);
      } else if (node.type === 'folder') {
        const folderNode = node as FolderTreeNode;
        if (folderNode.data.isExpanded && folderNode.children) {
          result.push(...flattenBoards(folderNode.children));
        }
      }
    }
    return result;
  }, []);

  // 获取扁平化的画板列表
  const flatBoardList = useMemo(() => flattenBoards(tree), [flattenBoards, tree]);

  // 处理画板点击（支持 Shift 和 Ctrl/Cmd 多选）
  const handleBoardClickWithSelection = useCallback(
    (board: Board, e: React.MouseEvent) => {
      const isShift = e.shiftKey;
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      if (isShift && lastClickedBoardId) {
        // Shift+点击：范围选择
        const startIndex = flatBoardList.findIndex(b => b.id === lastClickedBoardId);
        const endIndex = flatBoardList.findIndex(b => b.id === board.id);
        if (startIndex !== -1 && endIndex !== -1) {
          const [from, to] = startIndex < endIndex 
            ? [startIndex, endIndex] 
            : [endIndex, startIndex];
          const rangeIds = flatBoardList.slice(from, to + 1).map(b => b.id);
          const newSelection = new Set(selectedBoardIds ?? []);
          rangeIds.forEach(id => newSelection.add(id));
          onSelectionChange?.(newSelection);
        }
      } else if (isCtrlOrCmd) {
        // Ctrl/Cmd+点击：切换单个选择
        const newSelection = new Set(selectedBoardIds ?? []);
        if (newSelection.has(board.id)) {
          newSelection.delete(board.id);
        } else {
          newSelection.add(board.id);
        }
        onSelectionChange?.(newSelection);
        onLastClickedChange?.(board.id);
      } else {
        // 普通点击：清除选择，切换画板
        onSelectionChange?.(new Set());
        onLastClickedChange?.(board.id);
        onBoardClick(board);
      }
    },
    [flatBoardList, lastClickedBoardId, selectedBoardIds, onSelectionChange, onLastClickedChange, onBoardClick]
  );

  // 当有新建画板时自动进入编辑状态
  useEffect(() => {
    if (autoEditBoardId) {
      setEditingId(autoEditBoardId);
      const boardName = findBoardNameById(tree, autoEditBoardId);
      setEditingName(boardName || WORKSPACE_DEFAULTS.DEFAULT_BOARD_NAME);
      onAutoEditDone?.();
    }
  }, [autoEditBoardId, onAutoEditDone, tree, findBoardNameById]);

  // Drag state
  const [dragData, setDragData] = useState<DragData | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<DropPosition>(null);

  // Click delay timer for distinguishing single/double click
  const clickTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup timer on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
    };
  }, []);

  // 处理右键菜单
  const handleContextMenu = useCallback((
    e: React.MouseEvent,
    type: 'folder' | 'board',
    id: string,
    name: string,
    folderId?: string | null,
    parentId?: string | null
  ) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e, {
      type,
      id,
      name,
      folderId,
      parentId,
    });
  }, [openContextMenu]);

  // Auto-select text when input is focused
  const handleInputFocus = useCallback(
    (_value: string, context: { e: React.FocusEvent<HTMLInputElement> }) => {
      const input = context.e.target as HTMLInputElement;
      if (input && input.select) {
        input.select();
      }
    },
    []
  );

  // Handle rename submit
  const handleRenameSubmit = useCallback(
    async (type: 'folder' | 'board', id: string) => {
      if (!editingName.trim()) {
        setEditingId(null);
        return;
      }
      try {
        await onRename(type, id, editingName.trim());
        // 重命名成功，关闭编辑状态
        setEditingId(null);
      } catch (error: any) {
        // 重命名失败（如验证错误），保持编辑状态让用户修改
        // 错误提示已在 handleRename 中显示
        console.log('Rename failed, keeping edit mode active');
      }
    },
    [editingName, onRename]
  );

  // Start editing
  const startEditing = useCallback((id: string, name: string) => {
    setEditingId(id);
    setEditingName(name);
  }, []);

  // Get all folder options for move menu
  const getFolderOptions = useCallback(
    (excludeId?: string) => {
      const options: Array<{ content: string; value: string }> = [
        { content: '根目录', value: 'root' },
      ];

      const addFolderOptions = (nodes: TreeNode[], prefix: string = '') => {
        nodes.forEach((node) => {
          if (node.type === 'folder') {
            const folder = (node as FolderTreeNode).data;
            if (folder.id !== excludeId) {
              options.push({
                content: prefix + folder.name,
                value: folder.id,
              });
              if ((node as FolderTreeNode).children) {
                addFolderOptions(
                  (node as FolderTreeNode).children,
                  prefix + '  '
                );
              }
            }
          }
        });
      };

      addFolderOptions(tree);
      return options;
    },
    [tree]
  );

  // Drag handlers
  const handleDragStart = useCallback(
    (e: DragEvent, type: 'board' | 'folder', id: string) => {
      const data: DragData = { type, id };
      setDragData(data);

      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/json', JSON.stringify(data));
    },
    []
  );

  const handleDragEnd = useCallback(() => {
    setDragData(null);
    setDragOverId(null);
    setDropPosition(null);
  }, []);

  const handleDragOver = useCallback(
    (e: DragEvent, targetId: string, targetType: 'board' | 'folder') => {
      if (!dragData) return;

      // Can't drop on itself
      if (dragData.id === targetId) return;

      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const y = e.clientY - rect.top;
      const height = rect.height;

      let position: DropPosition;
      if (targetType === 'folder') {
        // For folders: top 25% = before, middle 50% = inside, bottom 25% = after
        if (y < height * 0.25) {
          position = 'before';
        } else if (y > height * 0.75) {
          position = 'after';
        } else {
          position = 'inside';
        }
      } else {
        // For boards: top 50% = before, bottom 50% = after
        position = y < height / 2 ? 'before' : 'after';
      }

      if (dragOverId !== targetId || dropPosition !== position) {
        setDragOverId(targetId);
        setDropPosition(position);
      }
    },
    [dragData, dragOverId, dropPosition]
  );

  const handleDragLeave = useCallback((e: DragEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement;
    const currentTarget = e.currentTarget as HTMLElement;

    if (!currentTarget.contains(relatedTarget)) {
      setDragOverId(null);
      setDropPosition(null);
    }
  }, []);

  const handleDrop = useCallback(
    (
      e: DragEvent,
      targetId: string,
      targetType: 'board' | 'folder',
      targetParentId: string | null
    ) => {
      e.preventDefault();

      if (!dragData || !dropPosition) return;

      const { type: sourceType, id: sourceId } = dragData;

      // Handle move to folder (drop inside)
      if (dropPosition === 'inside' && targetType === 'folder') {
        // Move item into folder (at the end)
        if (sourceType === 'board') {
          onMoveBoard(sourceId, targetId);
        } else {
          onMoveFolder(sourceId, targetId);
        }
      } else if (dropPosition === 'before' || dropPosition === 'after') {
        // Reorder: move to same parent as target, with position relative to target
        if (sourceType === 'board') {
          onMoveBoard(sourceId, targetParentId, targetId, dropPosition);
        } else {
          onMoveFolder(sourceId, targetParentId, targetId, dropPosition);
        }
      }

      handleDragEnd();
    },
    [dragData, dropPosition, onMoveBoard, onMoveFolder, handleDragEnd]
  );

  // Get drag-over class names
  const getDragOverClass = (id: string) => {
    if (dragOverId !== id) return '';
    switch (dropPosition) {
      case 'before':
        return 'project-drawer-node__row--drag-over-before';
      case 'after':
        return 'project-drawer-node__row--drag-over-after';
      case 'inside':
        return 'project-drawer-node__row--drag-over-inside';
      default:
        return '';
    }
  };

  // Render folder node
  const renderFolderNode = (
    node: FolderTreeNode,
    level: number = 0
  ): React.ReactNode => {
    const { data: folder, children } = node;
    const isExpanded = folder.isExpanded;
    const isEditing = editingId === folder.id;
    const isDragging = dragData?.id === folder.id;
    const paddingLeft = level * 16 + 8;

    return (
      <div key={folder.id} className="project-drawer-node">
        <div
          className={`project-drawer-node__row project-drawer-node__row--folder
            ${isDragging ? 'project-drawer-node__row--dragging' : ''}
            ${getDragOverClass(folder.id)}`}
          style={{ paddingLeft }}
          draggable={!isEditing}
          onClick={() => {
            if (!isEditing) {
              // Clear any existing timer
              if (clickTimerRef.current) {
                clearTimeout(clickTimerRef.current);
              }
              // Delay folder toggle to allow double-click to work
              clickTimerRef.current = setTimeout(() => {
                toggleFolderExpanded(folder.id);
              }, 200);
            }
          }}
          onDragStart={(e) => handleDragStart(e, 'folder', folder.id)}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => handleDragOver(e, folder.id, 'folder')}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, folder.id, 'folder', folder.parentId)}
          onContextMenu={(e) => handleContextMenu(e, 'folder', folder.id, folder.name, undefined, folder.parentId)}
        >
          <span
            className="project-drawer-node__expand"
            onClick={(e) => {
              e.stopPropagation();
              toggleFolderExpanded(folder.id);
            }}
          >
            <ChevronRightIcon
              style={{
                transform: isExpanded ? 'rotate(90deg)' : 'none',
                transition: 'transform 0.2s',
              }}
            />
          </span>

          <span className="project-drawer-node__icon">
            {isExpanded ? <FolderOpenIcon /> : <FolderIcon />}
          </span>

          {isEditing ? (
            <Input
              value={editingName}
              size="small"
              autofocus
              onFocus={handleInputFocus}
              onClick={(e: { e: React.MouseEvent }) => e.e.stopPropagation()}
              onChange={(value) => setEditingName(value)}
              onBlur={() => handleRenameSubmit('folder', folder.id)}
              onKeydown={(
                _value: string,
                context: { e: React.KeyboardEvent }
              ) => {
                if (context.e.key === 'Enter') {
                  handleRenameSubmit('folder', folder.id);
                } else if (context.e.key === 'Escape') {
                  setEditingId(null);
                }
              }}
            />
          ) : (
            <span
              className="project-drawer-node__label"
              onDoubleClick={(e) => {
                e.stopPropagation();
                // Clear single-click timer
                if (clickTimerRef.current) {
                  clearTimeout(clickTimerRef.current);
                  clickTimerRef.current = null;
                }
                startEditing(folder.id, folder.name);
              }}
            >
              {folder.name}
            </span>
          )}

          <div
            className="project-drawer-node__actions"
            onClick={(e) => e.stopPropagation()}
          >
            <Dropdown
              options={[
                {
                  content: '新建画板',
                  value: 'new-board',
                  prefixIcon: <AddIcon />,
                },
                {
                  content: '新建文件夹',
                  value: 'new-folder',
                  prefixIcon: <FolderAddIcon />,
                },
                {
                  content: '重命名',
                  value: 'rename',
                  prefixIcon: <EditIcon />,
                },
                {
                  content: '删除',
                  value: 'delete',
                  prefixIcon: <DeleteIcon />,
                },
              ]}
              onClick={(data) => {
                if (data.value === 'new-board') {
                  onCreateBoard(folder.id);
                } else if (data.value === 'new-folder') {
                  onCreateFolder(folder.id);
                } else if (data.value === 'rename') {
                  startEditing(folder.id, folder.name);
                } else if (data.value === 'delete') {
                  onDelete('folder', folder.id, folder.name);
                }
              }}
            >
              <Button variant="text" size="small" icon={<MoreIcon />} />
            </Dropdown>
          </div>
        </div>

        {isExpanded && children && children.length > 0 && (
          <div className="project-drawer-node__children">
            {children.map((child) =>
              child.type === 'folder'
                ? renderFolderNode(child as FolderTreeNode, level + 1)
                : renderBoardNode(child as BoardTreeNode, level + 1)
            )}
          </div>
        )}
      </div>
    );
  };

  // Render board node
  const renderBoardNode = (
    node: BoardTreeNode,
    level: number = 0
  ): React.ReactNode => {
    const { data: board } = node;
    const isActive = board.id === currentBoard?.id;
    const isEditing = editingId === board.id;
    const isDragging = dragData?.id === board.id;
    const isSelected = selectedBoardIds?.has(board.id) ?? false;
    const paddingLeft = level * 16 + 8;

    return (
      <div key={board.id} className="project-drawer-node">
        <div
          className={`project-drawer-node__row
            ${isActive ? 'project-drawer-node__row--active' : ''}
            ${isSelected ? 'project-drawer-node__row--selected' : ''}
            ${isDragging ? 'project-drawer-node__row--dragging' : ''}
            ${getDragOverClass(board.id)}`}
          style={{ paddingLeft }}
          draggable={!isEditing}
          onClick={(e) => {
            if (!isEditing) {
              // Clear any existing timer
              if (clickTimerRef.current) {
                clearTimeout(clickTimerRef.current);
              }
              // Capture mouse event properties before timeout
              const isShift = e.shiftKey;
              const isCtrlOrCmd = e.ctrlKey || e.metaKey;
              // Delay board click to allow double-click to work
              clickTimerRef.current = setTimeout(() => {
                handleBoardClickWithSelection(board, { 
                  shiftKey: isShift, 
                  ctrlKey: isCtrlOrCmd, 
                  metaKey: isCtrlOrCmd 
                } as React.MouseEvent);
              }, 200);
            }
          }}
          onDragStart={(e) => handleDragStart(e, 'board', board.id)}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => handleDragOver(e, board.id, 'board')}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, board.id, 'board', board.folderId)}
          onContextMenu={(e) => handleContextMenu(e, 'board', board.id, board.name, board.folderId)}
        >
          <span className="project-drawer-node__expand"></span>

          <span className="project-drawer-node__icon">
            <ArtboardIcon />
          </span>

          {isEditing ? (
            <Input
              value={editingName}
              size="small"
              autofocus
              onFocus={handleInputFocus}
              onClick={(e: { e: React.MouseEvent }) => e.e.stopPropagation()}
              onChange={(value) => setEditingName(value)}
              onBlur={() => handleRenameSubmit('board', board.id)}
              onKeydown={(
                _value: string,
                context: { e: React.KeyboardEvent }
              ) => {
                if (context.e.key === 'Enter') {
                  handleRenameSubmit('board', board.id);
                } else if (context.e.key === 'Escape') {
                  setEditingId(null);
                }
              }}
            />
          ) : (
            <span
              className="project-drawer-node__label"
              onDoubleClick={(e) => {
                e.stopPropagation();
                // Clear single-click timer
                if (clickTimerRef.current) {
                  clearTimeout(clickTimerRef.current);
                  clickTimerRef.current = null;
                }
                startEditing(board.id, board.name);
              }}
            >
              {board.name}
            </span>
          )}

          <div
            className="project-drawer-node__actions"
            onClick={(e) => e.stopPropagation()}
          >
            <Dropdown
              options={[
                {
                  content: '复制',
                  value: 'copy',
                  prefixIcon: <FileCopyIcon />,
                },
                {
                  content: '重命名',
                  value: 'rename',
                  prefixIcon: <EditIcon />,
                },
                {
                  content: '移动到',
                  value: 'move',
                  prefixIcon: <MoveIcon />,
                  children: getFolderOptions(),
                },
                {
                  content: '删除',
                  value: 'delete',
                  prefixIcon: <DeleteIcon />,
                },
                // 如果有多选，显示批量删除选项
                ...((selectedBoardIds?.size ?? 0) > 1 && isSelected ? [{
                  content: `删除选中的 ${selectedBoardIds?.size ?? 0} 个画板`,
                  value: 'delete-selected',
                  prefixIcon: <DeleteIcon />,
                }] : []),
              ]}
              onClick={(data) => {
                if (data.value === 'copy') {
                  onCopyBoard(board.id);
                } else if (data.value === 'rename') {
                  startEditing(board.id, board.name);
                } else if (data.value === 'delete') {
                  onDelete('board', board.id, board.name);
                } else if (data.value === 'delete-selected') {
                  onDeleteMultiple?.(Array.from(selectedBoardIds ?? []));
                } else if (data.value === 'root') {
                  onMoveBoard(board.id, null);
                } else if (
                  typeof data.value === 'string' &&
                  data.value !== 'move'
                ) {
                  // Move to specific folder
                  onMoveBoard(board.id, data.value);
                }
              }}
            >
              <Button variant="text" size="small" icon={<MoreIcon />} />
            </Dropdown>
          </div>
        </div>
      </div>
    );
  };

  // 处理右键菜单点击
  const handleContextMenuAction = useCallback((action: string, payload: ProjectDrawerContextMenuPayload) => {
    const { type, id, name } = payload;

    switch (action) {
      case 'new-board':
        onCreateBoard(id);
        break;
      case 'new-folder':
        onCreateFolder(id);
        break;
      case 'copy':
        onCopyBoard(id);
        break;
      case 'rename':
        startEditing(id, name);
        break;
      case 'delete':
        onDelete(type, id, name);
        break;
      case 'delete-selected':
        onDeleteMultiple?.(Array.from(selectedBoardIds ?? []));
        break;
      case 'move-root':
        if (type === 'board') {
          onMoveBoard(id, null);
        }
        break;
      default:
        // 移动到指定文件夹
        if (action.startsWith('move-')) {
          const targetFolderId = action.replace('move-', '');
          if (type === 'board') {
            onMoveBoard(id, targetFolderId);
          }
        }
        break;
    }

    closeContextMenu();
  }, [onCreateBoard, onCreateFolder, onCopyBoard, startEditing, onDelete, onDeleteMultiple, selectedBoardIds, onMoveBoard, closeContextMenu]);

  // 获取移动菜单选项
  const moveOptions = useMemo(() => {
    if (!contextMenu || contextMenu.payload.type !== 'board') return [];
    return getFolderOptions();
  }, [contextMenu, getFolderOptions]);

  const contextMenuItems = useMemo<ContextMenuEntry<ProjectDrawerContextMenuPayload>[]>(() => {
    if (!contextMenu) {
      return [];
    }

    const payload = contextMenu.payload;
    if (payload.type === 'folder') {
      return [
        {
          key: 'new-board',
          label: '新建画板',
          icon: <AddIcon />,
          onSelect: (current) => handleContextMenuAction('new-board', current),
        },
        {
          key: 'new-folder',
          label: '新建文件夹',
          icon: <FolderAddIcon />,
          onSelect: (current) => handleContextMenuAction('new-folder', current),
        },
        { key: 'divider-1', type: 'divider' },
        {
          key: 'rename',
          label: '重命名',
          icon: <EditIcon />,
          onSelect: (current) => handleContextMenuAction('rename', current),
        },
        {
          key: 'delete',
          label: '删除',
          icon: <DeleteIcon />,
          danger: true,
          onSelect: (current) => handleContextMenuAction('delete', current),
        },
      ];
    }

    return [
      {
        key: 'copy',
        label: '复制',
        icon: <FileCopyIcon />,
        onSelect: (current) => handleContextMenuAction('copy', current),
      },
      {
        key: 'rename',
        label: '重命名',
        icon: <EditIcon />,
        onSelect: (current) => handleContextMenuAction('rename', current),
      },
      {
        key: 'move',
        type: 'submenu',
        label: '移动到',
        icon: <MoveIcon />,
        children: moveOptions.map((opt) => ({
          key: `move-${opt.value}`,
          label: opt.content,
          onSelect: (current: ProjectDrawerContextMenuPayload) =>
            handleContextMenuAction(
              opt.value === 'root' ? 'move-root' : `move-${opt.value}`,
              current
            ),
        })),
      },
      { key: 'divider-1', type: 'divider' },
      {
        key: 'delete',
        label: '删除',
        icon: <DeleteIcon />,
        danger: true,
        onSelect: (current) => handleContextMenuAction('delete', current),
      },
      {
        key: 'delete-selected',
        label: `删除选中的 ${selectedBoardIds?.size ?? 0} 个画板`,
        icon: <DeleteIcon />,
        danger: true,
        disabled: (current) =>
          (selectedBoardIds?.size ?? 0) <= 1 || !selectedBoardIds?.has(current.id),
        onSelect: (current) => handleContextMenuAction('delete-selected', current),
      },
    ];
  }, [contextMenu, handleContextMenuAction, moveOptions, selectedBoardIds]);

  return (
    <>
      <div className="project-drawer__tree">
        {tree.map((node) =>
          node.type === 'folder'
            ? renderFolderNode(node as FolderTreeNode)
            : renderBoardNode(node as BoardTreeNode)
        )}
      </div>
      <ContextMenu
        state={contextMenu}
        items={contextMenuItems}
        onClose={closeContextMenu}
      />
    </>
  );
};

export const ProjectDrawer: React.FC<ProjectDrawerProps> = ({
  isOpen = false,
  onOpenChange,
  onBeforeSwitch,
  onBoardSwitch,
}) => {
  const {
    isLoading,
    tree,
    currentBoard,
    createFolder,
    renameFolder,
    deleteFolder,
    deleteFolderWithContents,
    moveFolder,
    toggleFolderExpanded,
    createBoard,
    renameBoard,
    deleteBoard,
    moveBoard,
    copyBoard,
    switchBoard,
  } = useWorkspace();

  const [activeTab, setActiveTab] = useState<'boards' | 'frames' | 'layers'>('boards');
  const [searchQuery, setSearchQuery] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    type: 'folder' | 'board';
    id: string;
    name: string;
  } | null>(null);
  // 多选状态
  const [selectedBoardIds, setSelectedBoardIds] = useState<Set<string>>(new Set());
  const [lastClickedBoardId, setLastClickedBoardId] = useState<string | null>(null);
  // 批量删除目标
  const [deleteMultipleTargets, setDeleteMultipleTargets] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [importProgress, setImportProgress] = useState({
    progress: 0,
    message: '',
  });
  const [exportProgress, setExportProgress] = useState({
    progress: 0,
    message: '',
  });
  const [autoEditBoardId, setAutoEditBoardId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle close
  const handleClose = useCallback(() => {
    onOpenChange?.(false);
  }, [onOpenChange]);

  // Handle creating new board
  const handleCreateBoard = useCallback(
    async (folderId?: string) => {
      // Save current before creating/switching
      if (onBeforeSwitch) {
        await onBeforeSwitch();
      }

      const board = await createBoard({
        name: WORKSPACE_DEFAULTS.DEFAULT_BOARD_NAME,
        folderId: folderId || null,
      });
      if (board) {
        // 自动切换到新建的画板
        const switched = await switchBoard(board.id);
        // 通知父组件更新画布数据
        if (switched && onBoardSwitch) {
          onBoardSwitch(switched);
        }
        // 自动进入重命名状态
        setAutoEditBoardId(board.id);
        MessagePlugin.success('画板已创建');
      }
    },
    [createBoard, switchBoard, onBeforeSwitch, onBoardSwitch]
  );

  // Handle creating new folder
  const handleCreateFolder = useCallback(
    async (parentId?: string) => {
      await createFolder({
        name: WORKSPACE_DEFAULTS.DEFAULT_FOLDER_NAME,
        parentId: parentId || null,
      });
    },
    [createFolder]
  );

  // Handle rename
  const handleRename = useCallback(
    async (type: 'folder' | 'board', id: string, name: string) => {
      try {
        if (type === 'folder') {
          await renameFolder(id, name);
        } else {
          await renameBoard(id, name);
        }
        MessagePlugin.success('重命名成功');
      } catch (error: any) {
        // 处理验证错误
        if (error.name === 'ValidationError') {
          MessagePlugin.warning({
            content: error.message,
            duration: 3000,
          });
          // 返回 false 表示重命名失败，保持编辑状态
          throw error;
        } else {
          // 其他错误
          MessagePlugin.error({
            content: '重命名失败',
            duration: 3000,
          });
          throw error;
        }
      }
    },
    [renameFolder, renameBoard]
  );

  // Handle delete confirmation
  const handleDeleteConfirm = useCallback(
    (type: 'folder' | 'board', id: string, name: string) => {
      setDeleteTarget({ type, id, name });
      setShowDeleteDialog(true);
    },
    []
  );

  // Handle delete (folder only - moves contents to root)
  const handleDeleteFolderOnly = useCallback(async () => {
    if (!deleteTarget || deleteTarget.type !== 'folder') return;

    const success = await deleteFolder(deleteTarget.id);
    if (success) {
      MessagePlugin.success('删除成功');
    }
    setShowDeleteDialog(false);
    setDeleteTarget(null);
  }, [deleteTarget, deleteFolder]);

  // Handle delete (folder with all contents)
  const handleDeleteFolderWithContents = useCallback(async () => {
    if (!deleteTarget || deleteTarget.type !== 'folder') return;

    const success = await deleteFolderWithContents(deleteTarget.id);
    if (success) {
      MessagePlugin.success('删除成功');
    }
    setShowDeleteDialog(false);
    setDeleteTarget(null);
  }, [deleteTarget, deleteFolderWithContents]);

  // Helper function to get the first available board from tree (excluding specific ids)
  const getFirstBoardFromTree = useCallback(
    (nodes: TreeNode[], ...excludeIds: string[]): Board | null => {
      const excludeSet = new Set(excludeIds);
      const findBoard = (nodes: TreeNode[]): Board | null => {
        for (const node of nodes) {
          if (node.type === 'board' && !excludeSet.has(node.data.id)) {
            return node.data;
          }
          if (node.type === 'folder' && node.children) {
            const board = findBoard(node.children);
            if (board) return board;
          }
        }
        return null;
      };
      return findBoard(nodes);
    },
    []
  );

  // Handle delete (board)
  const handleDeleteBoard = useCallback(async () => {
    if (!deleteTarget || deleteTarget.type !== 'board') return;

    const deletingCurrentBoard = deleteTarget.id === currentBoard?.id;
    const success = await deleteBoard(deleteTarget.id);

    if (success) {
      MessagePlugin.success('删除成功');

      // If we deleted the current board, switch to the first available board
      if (deletingCurrentBoard) {
        const firstBoard = getFirstBoardFromTree(tree, deleteTarget.id);
        if (firstBoard) {
          // Save before switching (though current board is deleted, this ensures clean state)
          if (onBeforeSwitch) {
            await onBeforeSwitch();
          }
          const switched = await switchBoard(firstBoard.id);
          if (switched && onBoardSwitch) {
            onBoardSwitch(switched);
          }
        }
      }
    }
    setShowDeleteDialog(false);
    setDeleteTarget(null);
  }, [
    deleteTarget,
    deleteBoard,
    currentBoard,
    tree,
    getFirstBoardFromTree,
    onBeforeSwitch,
    switchBoard,
    onBoardSwitch,
  ]);

  // Handle delete multiple boards confirmation
  const handleDeleteMultipleConfirm = useCallback((boardIds: string[]) => {
    setDeleteMultipleTargets(boardIds);
    setShowDeleteDialog(true);
  }, []);

  // Handle delete multiple boards
  const handleDeleteMultipleBoards = useCallback(async () => {
    if (deleteMultipleTargets.length === 0) return;

    const deletingCurrentBoard = currentBoard && deleteMultipleTargets.includes(currentBoard.id);
    let deletedCount = 0;

    for (const boardId of deleteMultipleTargets) {
      const success = await deleteBoard(boardId);
      if (success) deletedCount++;
    }

    if (deletedCount > 0) {
      MessagePlugin.success(`成功删除 ${deletedCount} 个画板`);

      // Clear selection
      setSelectedBoardIds(new Set());

      // If we deleted the current board, switch to the first available board
      if (deletingCurrentBoard) {
        const firstBoard = getFirstBoardFromTree(tree, ...deleteMultipleTargets);
        if (firstBoard) {
          if (onBeforeSwitch) {
            await onBeforeSwitch();
          }
          const switched = await switchBoard(firstBoard.id);
          if (switched && onBoardSwitch) {
            onBoardSwitch(switched);
          }
        }
      }
    }
    setShowDeleteDialog(false);
    setDeleteMultipleTargets([]);
  }, [
    deleteMultipleTargets,
    deleteBoard,
    currentBoard,
    tree,
    getFirstBoardFromTree,
    onBeforeSwitch,
    switchBoard,
    onBoardSwitch,
  ]);

  // Handle copy board
  const handleCopyBoard = useCallback(
    async (id: string) => {
      const newBoard = await copyBoard(id);
      if (newBoard) {
        MessagePlugin.success('画板已复制');
      }
    },
    [copyBoard]
  );

  // Handle move board
  const handleMoveBoard = useCallback(
    async (
      id: string,
      targetFolderId: string | null,
      targetId?: string,
      position?: 'before' | 'after'
    ) => {
      try {
        await moveBoard(id, targetFolderId, targetId, position);
      } catch (error: any) {
        if (error?.name === 'ValidationError') {
          MessagePlugin.warning({
            content: error.message,
            duration: 3000,
          });
        } else {
          MessagePlugin.error('移动失败');
        }
      }
    },
    [moveBoard]
  );

  // Handle move folder
  const handleMoveFolder = useCallback(
    async (
      id: string,
      targetParentId: string | null,
      targetId?: string,
      position?: 'before' | 'after'
    ) => {
      try {
        await moveFolder(id, targetParentId, targetId, position);
      } catch (error: any) {
        if (error?.name === 'ValidationError') {
          MessagePlugin.warning({
            content: error.message,
            duration: 3000,
          });
        } else {
          MessagePlugin.error('无法移动文件夹到其子目录');
        }
      }
    },
    [moveFolder]
  );

  // Handle export
  const handleExport = useCallback(async () => {
    if (isExporting) return;

    try {
      setIsExporting(true);
      setShowExportDialog(true);
      setExportProgress({ progress: 0, message: '准备导出...' });

      // Save current board before export
      if (onBeforeSwitch) {
        await onBeforeSwitch();
      }

      const blob = await workspaceExportService.exportToZip({
        onProgress: (progress, message) => {
          setExportProgress({ progress, message });
        },
      });
      workspaceExportService.downloadZip(blob);
      MessagePlugin.success('导出成功');
    } catch (error: any) {
      console.error('[ProjectDrawer] Export failed:', error);
      MessagePlugin.error(`导出失败: ${error.message}`);
    } finally {
      setIsExporting(false);
      setShowExportDialog(false);
    }
  }, [isExporting, onBeforeSwitch]);

  // Handle import button click
  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Handle file selection for import
  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Reset input
      e.target.value = '';

      // Validate file type
      if (!file.name.endsWith('.zip')) {
        MessagePlugin.error('请选择 ZIP 文件');
        return;
      }

      setShowImportDialog(true);
      setIsImporting(true);
      setImportProgress({ progress: 0, message: '准备导入...' });

      try {
        // Save current board before import
        if (onBeforeSwitch) {
          await onBeforeSwitch();
        }

        const result = await workspaceExportService.importFromZip(file, {
          merge: false,
          onProgress: (progress, message) => {
            setImportProgress({ progress, message });
          },
        });

        if (result.success) {
          MessagePlugin.success(
            `导入成功：${result.folders} 个文件夹，${result.boards} 个画板，${result.assets} 个素材`
          );
          // Reload the page to refresh workspace
          safeReload();
        } else {
          if (result.errors.length > 0) {
            MessagePlugin.warning(
              `导入完成，但有 ${result.errors.length} 个错误`
            );
            console.warn('[ProjectDrawer] Import errors:', result.errors);
          }
          // Reload anyway to show imported data
          safeReload();
        }
      } catch (error: any) {
        console.error('[ProjectDrawer] Import failed:', error);
        MessagePlugin.error(`导入失败: ${error.message}`);
      } finally {
        setIsImporting(false);
        setShowImportDialog(false);
      }
    },
    [onBeforeSwitch]
  );

  // Handle board click
  const handleBoardClick = useCallback(
    async (board: Board) => {
      if (board.id === currentBoard?.id) {
        return;
      }

      // Save current before switching
      if (onBeforeSwitch) {
        await onBeforeSwitch();
      }

      const switched = await switchBoard(board.id);

      if (switched && onBoardSwitch) {
        onBoardSwitch(switched);
      }
    },
    [currentBoard, onBeforeSwitch, onBoardSwitch, switchBoard]
  );

  // Filter tree based on search query
  const filteredTree = useMemo(() => {
    if (!searchQuery.trim()) return tree;

    const query = searchQuery.toLowerCase().trim();

    const filterNode = (node: TreeNode): TreeNode | null => {
      if (node.type === 'board') {
        const board = (node as BoardTreeNode).data;
        return board.name.toLowerCase().includes(query) ? node : null;
      }

      if (node.type === 'folder') {
        const folderNode = node as FolderTreeNode;
        const folder = folderNode.data;

        // Filter children recursively
        const filteredChildren = folderNode.children
          ? folderNode.children
              .map(filterNode)
              .filter((n): n is TreeNode => n !== null)
          : [];

        // Show folder if it matches OR has matching children
        const folderMatches = folder.name.toLowerCase().includes(query);
        if (folderMatches || filteredChildren.length > 0) {
          return {
            ...folderNode,
            children: filteredChildren,
          };
        }

        return null;
      }

      return null;
    };

    return tree.map(filterNode).filter((n): n is TreeNode => n !== null);
  }, [tree, searchQuery]);

  // Tab switcher + filter section
  const tabSwitcher = (
    <div className="project-drawer-tabs">
      <button
        type="button"
        className={`project-drawer-tabs__tab${activeTab === 'boards' ? ' project-drawer-tabs__tab--active' : ''}`}
        onClick={() => setActiveTab('boards')}
      >
        <ArtboardIcon />
        画布管理
      </button>
      <button
        type="button"
        className={`project-drawer-tabs__tab${activeTab === 'frames' ? ' project-drawer-tabs__tab--active' : ''}`}
        onClick={() => setActiveTab('frames')}
      >
        <ViewListIcon />
        Frame 管理
      </button>
      <button
        type="button"
        className={`project-drawer-tabs__tab${activeTab === 'layers' ? ' project-drawer-tabs__tab--active' : ''}`}
        onClick={() => setActiveTab('layers')}
      >
        <LayersIcon />
        图层
      </button>
    </div>
  );

  const filterSection = (
    <div className="project-drawer__filter-section">
      {tabSwitcher}
      {activeTab === 'boards' && (
        <>
          <Input
            placeholder="搜索..."
            value={searchQuery}
            onChange={setSearchQuery}
            prefixIcon={<SearchIcon />}
            size="small"
          />
          <div className="project-drawer__actions">
            <Button
              variant="outline"
              size="small"
              icon={<AddIcon />}
              onClick={() => handleCreateBoard()}
            >
              新建画板
            </Button>
            <Button
              variant="outline"
              size="small"
              icon={<FolderAddIcon />}
              onClick={() => handleCreateFolder()}
            >
              新建目录
            </Button>
          </div>
          {selectedBoardIds.size > 0 && (
            <div className="project-drawer__selection-bar">
              <span className="project-drawer__selection-count">
                已选择 {selectedBoardIds.size} 个画板
              </span>
              <Button
                variant="text"
                size="small"
                theme="danger"
                icon={<DeleteIcon />}
                onClick={() => handleDeleteMultipleConfirm(Array.from(selectedBoardIds))}
              >
                删除
              </Button>
              <Button
                variant="text"
                size="small"
                onClick={() => setSelectedBoardIds(new Set())}
              >
                取消
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );

  // Footer with import/export buttons (only for boards tab)
  const footerSection = activeTab === 'boards' ? (
    <div className="project-drawer__footer-actions">
      <Button
        variant="outline"
        size="small"
        icon={<UploadIcon />}
        onClick={handleImportClick}
        disabled={isImporting}
        title="从 ZIP 文件导入"
      >
        导入
      </Button>
      <Button
        variant="outline"
        size="small"
        icon={<DownloadIcon />}
        onClick={handleExport}
        loading={isExporting}
        title="导出为 ZIP 文件"
      >
        导出
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />
    </div>
  ) : null;

  return (
    <>
      <BaseDrawer
        isOpen={isOpen}
        onClose={handleClose}
        title="项目"
        filterSection={filterSection}
        footer={footerSection}
        position="toolbar-right"
        width="narrow"
        storageKey={PROJECT_DRAWER_WIDTH_KEY}
        resizable={true}
        className="project-drawer"
        contentClassName="project-drawer__content"
        data-testid="project-drawer"
      >
        {activeTab === 'layers' ? (
          <LayerPanel />
        ) : activeTab === 'frames' ? (
          <FramePanel />
        ) : isLoading ? (
          <div className="project-drawer__loading">加载中...</div>
        ) : filteredTree.length === 0 ? (
          <div className="project-drawer__empty">
            <p>暂无画板</p>
            <Button size="small" onClick={() => handleCreateBoard()}>
              创建第一个画板
            </Button>
          </div>
        ) : (
          <ProjectDrawerContent
            tree={filteredTree}
            currentBoard={currentBoard}
            onBoardClick={handleBoardClick}
            onCreateBoard={handleCreateBoard}
            onCreateFolder={handleCreateFolder}
            onRename={handleRename}
            onDelete={handleDeleteConfirm}
            onDeleteMultiple={handleDeleteMultipleConfirm}
            onCopyBoard={handleCopyBoard}
            onMoveBoard={handleMoveBoard}
            onMoveFolder={handleMoveFolder}
            toggleFolderExpanded={toggleFolderExpanded}
            autoEditBoardId={autoEditBoardId}
            onAutoEditDone={() => setAutoEditBoardId(null)}
            selectedBoardIds={selectedBoardIds}
            onSelectionChange={setSelectedBoardIds}
            lastClickedBoardId={lastClickedBoardId}
            onLastClickedChange={setLastClickedBoardId}
          />
        )}
      </BaseDrawer>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={showDeleteDialog}
        title="确认删除"
        onOpenChange={(open) => {
          if (open) {
            return;
          }
          setShowDeleteDialog(false);
          setDeleteTarget(null);
          setDeleteMultipleTargets([]);
        }}
        footer={
          deleteTarget?.type === 'folder' ? (
            <div className="project-drawer__delete-dialog-footer">
              <Button
                variant="outline"
                onClick={() => setShowDeleteDialog(false)}
              >
                取消
              </Button>
              <Button theme="default" onClick={handleDeleteFolderOnly}>
                仅删目录
              </Button>
              <Button theme="danger" onClick={handleDeleteFolderWithContents}>
                删除目录及文件
              </Button>
            </div>
          ) : undefined
        }
        onConfirm={
          deleteMultipleTargets.length > 0 
            ? handleDeleteMultipleBoards 
            : deleteTarget?.type === 'board' 
              ? handleDeleteBoard 
              : undefined
        }
        confirmText={
          deleteMultipleTargets.length > 0 || deleteTarget?.type === 'board' 
            ? '删除' 
            : undefined
        }
        cancelText={
          deleteMultipleTargets.length > 0 || deleteTarget?.type === 'board' 
            ? '取消' 
            : undefined
        }
        danger
      >
        {deleteMultipleTargets.length > 0 ? (
          <p>确定要删除选中的 {deleteMultipleTargets.length} 个画板吗？此操作不可撤销。</p>
        ) : (
          <p>
            确定要删除 {deleteTarget?.type === 'folder' ? '文件夹' : '画板'} "
            {deleteTarget?.name}" 吗？
            {deleteTarget?.type === 'folder' && (
              <span
                style={{
                  color: 'var(--td-text-color-secondary)',
                  display: 'block',
                  marginTop: '8px',
                }}
              >
                仅删目录时，文件夹内的所有内容将被移动到根目录。
              </span>
            )}
          </p>
        )}
      </ConfirmDialog>

      {/* Import progress dialog */}
      <Dialog
        visible={showImportDialog}
        header="正在导入"
        closeOnOverlayClick={false}
        closeOnEscKeydown={false}
        showOverlay={true}
        footer={false}
      >
        <div className="project-drawer__import-progress">
          <Loading loading={true} size="medium" />
          <p className="project-drawer__import-message">
            {importProgress.message}
          </p>
          <div className="project-drawer__import-bar">
            <div
              className="project-drawer__import-bar-fill"
              style={{ width: `${importProgress.progress}%` }}
            />
          </div>
          <p className="project-drawer__import-percent">
            {Math.round(importProgress.progress)}%
          </p>
        </div>
      </Dialog>

      {/* Export progress dialog */}
      <Dialog
        visible={showExportDialog}
        header="正在导出"
        closeOnOverlayClick={false}
        closeOnEscKeydown={false}
        showOverlay={true}
        footer={false}
      >
        <div className="project-drawer__import-progress">
          <Loading loading={true} size="medium" />
          <p className="project-drawer__import-message">
            {exportProgress.message}
          </p>
          <div className="project-drawer__import-bar">
            <div
              className="project-drawer__import-bar-fill"
              style={{ width: `${exportProgress.progress}%` }}
            />
          </div>
          <p className="project-drawer__import-percent">
            {Math.round(exportProgress.progress)}%
          </p>
        </div>
      </Dialog>
    </>
  );
};
