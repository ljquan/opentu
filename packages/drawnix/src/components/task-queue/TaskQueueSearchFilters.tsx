import React from 'react';
import { Button, Input } from 'tdesign-react';
import { SearchIcon } from 'tdesign-icons-react';
import type { TaskDateRange } from '../../utils/task-queue-filters';

interface TaskQueueSearchFiltersProps {
  searchText: string;
  onSearchTextChange: (value: string) => void;
  dateRange: TaskDateRange;
  onDateRangeChange: (value: TaskDateRange) => void;
  actions?: React.ReactNode;
}

export function TaskQueueSearchFilters({
  searchText,
  onSearchTextChange,
  dateRange,
  onDateRangeChange,
  actions,
}: TaskQueueSearchFiltersProps) {
  return (
    <div className="task-queue-panel__search-filters">
      <div className="task-queue-panel__search-row">
        <label className="task-queue-panel__search-input">
          <span className="task-queue-panel__search-label">搜索任务</span>
          <Input
            value={searchText}
            onChange={onSearchTextChange}
            placeholder="搜索提示词或内容"
            clearable
            prefixIcon={<SearchIcon />}
            size="small"
          />
        </label>
        {actions}
      </div>
      <fieldset className="task-queue-panel__date-filter">
        <legend className="task-queue-panel__search-label">创建日期</legend>
        <span className="task-queue-panel__date-caption" aria-hidden="true">
          创建日期
        </span>
        <div className="task-queue-panel__date-range">
          <label>
            <span className="task-queue-panel__search-label">开始日期</span>
            <input
              type="date"
              value={dateRange[0] || ''}
              max={dateRange[1] || undefined}
              onChange={(event) =>
                onDateRangeChange([event.target.value, dateRange[1] || ''])
              }
            />
          </label>
          <span className="task-queue-panel__date-separator" aria-hidden="true">
            至
          </span>
          <label>
            <span className="task-queue-panel__search-label">结束日期</span>
            <input
              type="date"
              value={dateRange[1] || ''}
              min={dateRange[0] || undefined}
              onChange={(event) =>
                onDateRangeChange([dateRange[0] || '', event.target.value])
              }
            />
          </label>
        </div>
        {(dateRange[0] || dateRange[1]) && (
          <Button
            size="small"
            variant="text"
            className="task-queue-panel__date-clear"
            onClick={() => onDateRangeChange([])}
          >
            清除日期
          </Button>
        )}
      </fieldset>
    </div>
  );
}
