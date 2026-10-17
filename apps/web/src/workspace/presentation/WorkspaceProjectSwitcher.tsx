import {
  Check,
  CheckIcon,
  ChevronDown,
  FilePlus2,
  FolderOpen,
  Pencil,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { WorkspaceBoardSummary } from '../domain/workspace-model';

interface WorkspaceProjectSwitcherProps {
  boardName: string;
  currentBoardId?: string | null;
  boards: WorkspaceBoardSummary[];
  disabled?: boolean;
  openRequest?: number;
  onSelect: (boardId: string) => void;
  onCreate: () => void;
  onRename?: (boardId: string, name: string) => void;
}

export function WorkspaceProjectSwitcher({
  boardName,
  currentBoardId,
  boards,
  disabled,
  openRequest = 0,
  onSelect,
  onCreate,
  onRename,
}: WorkspaceProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [editingBoardId, setEditingBoardId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const filteredBoards = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? boards.filter((board) => board.name.toLowerCase().includes(normalized))
      : boards;
  }, [boards, query]);

  useEffect(() => {
    if (openRequest > 0) setOpen(true);
  }, [openRequest]);

  return (
    <div className="next-workspace__project-switcher">
      <button
        className="next-workspace__project-name"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{boardName || '未命名创作空间'}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          className="next-workspace__project-popover"
          role="dialog"
          aria-label="项目切换器"
        >
          <div className="next-workspace__project-popover-head">
            <strong>你的创作空间</strong>
            <button
              type="button"
              aria-label="新建创作空间"
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                onCreate();
              }}
            >
              <FilePlus2 size={15} />
            </button>
          </div>
          <label className="next-workspace__project-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索空间"
              aria-label="搜索创作空间"
            />
          </label>
          <div className="next-workspace__project-list">
            {filteredBoards.slice(0, 12).map((board) => {
              const isEditing = editingBoardId === board.id;
              return (
                <div
                  key={board.id}
                  className={`next-workspace__project-list-item${
                    board.id === currentBoardId ? ' is-active' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="next-workspace__project-list-main"
                    onClick={() => {
                      if (!isEditing) {
                        setOpen(false);
                        onSelect(board.id);
                      }
                    }}
                  >
                    <span className="next-workspace__project-list-icon">
                      <FolderOpen size={14} />
                    </span>
                    {isEditing ? (
                      <input
                        autoFocus
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            onRename?.(board.id, draftName);
                            setEditingBoardId(null);
                          }
                          if (event.key === 'Escape') setEditingBoardId(null);
                        }}
                        aria-label="创作空间名称"
                      />
                    ) : (
                      <span>
                        <strong title={board.name}>
                          {board.name || '未命名画布'}
                        </strong>
                        <small>
                          {new Date(board.updatedAt).toLocaleDateString(
                            'zh-CN'
                          )}
                        </small>
                      </span>
                    )}
                    {board.id === currentBoardId && !isEditing && (
                      <Check size={15} />
                    )}
                  </button>
                  {onRename &&
                    (isEditing ? (
                      <>
                        <button
                          type="button"
                          className="next-workspace__project-edit"
                          aria-label="保存空间名称"
                          onClick={() => {
                            onRename(board.id, draftName);
                            setEditingBoardId(null);
                          }}
                        >
                          <CheckIcon size={14} />
                        </button>
                        <button
                          type="button"
                          className="next-workspace__project-edit"
                          aria-label="取消重命名"
                          onClick={() => setEditingBoardId(null)}
                        >
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="next-workspace__project-edit"
                        aria-label={`重命名${board.name || '创作空间'}`}
                        onClick={() => {
                          setEditingBoardId(board.id);
                          setDraftName(board.name);
                        }}
                      >
                        <Pencil size={13} />
                      </button>
                    ))}
                </div>
              );
            })}
            {filteredBoards.length === 0 && (
              <div className="next-workspace__empty-state">
                没有匹配的创作空间
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
