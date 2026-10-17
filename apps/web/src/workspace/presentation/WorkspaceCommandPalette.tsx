import { Search } from 'lucide-react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';

export interface WorkspaceCommandItem {
  label: string;
  description: string;
  icon: ReactNode;
  action: string;
}

interface WorkspaceCommandPaletteProps {
  commands: WorkspaceCommandItem[];
  query: string;
  activeIndex: number;
  inputRef: RefObject<HTMLInputElement>;
  onQueryChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onHover: (index: number) => void;
  onRun: (command: WorkspaceCommandItem) => void;
  onClose: () => void;
}

export function WorkspaceCommandPalette({
  commands,
  query,
  activeIndex,
  inputRef,
  onQueryChange,
  onKeyDown,
  onHover,
  onRun,
  onClose,
}: WorkspaceCommandPaletteProps) {
  return (
    <div
      className="next-workspace__palette-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        className="next-workspace__palette"
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="next-workspace__palette-search">
          <Search size={17} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索命令…"
            aria-label="搜索命令"
          />
          <kbd>ESC</kbd>
        </div>
        <div className="next-workspace__palette-list">
          {commands.map((command, index) => (
            <button
              className={index === activeIndex ? 'is-active' : ''}
              type="button"
              key={command.action}
              onMouseEnter={() => onHover(index)}
              onClick={() => onRun(command)}
            >
              <span className="next-workspace__palette-icon">
                {command.icon}
              </span>
              <span>
                <strong>{command.label}</strong>
                <small>{command.description}</small>
              </span>
              <span className="next-workspace__palette-arrow">↵</span>
            </button>
          ))}
          {commands.length === 0 && (
            <div className="next-workspace__empty-state">没有找到匹配命令</div>
          )}
        </div>
        <div className="next-workspace__palette-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd>选择
          </span>
          <span>
            <kbd>↵</kbd>执行
          </span>
          <span>
            <kbd>esc</kbd>关闭
          </span>
        </div>
      </div>
    </div>
  );
}
