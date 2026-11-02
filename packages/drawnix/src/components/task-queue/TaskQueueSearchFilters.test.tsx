import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskQueueSearchFilters } from './TaskQueueSearchFilters';
import {
  buildTaskQueueFilters,
  type TaskDateRange,
} from '../../utils/task-queue-filters';

function Filters() {
  const [query, setQuery] = useState('');
  const [range, setRange] = useState<TaskDateRange>([]);
  return (
    <>
      <TaskQueueSearchFilters
        searchText={query}
        onSearchTextChange={setQuery}
        dateRange={range}
        onDateRangeChange={setRange}
      />
      <output aria-label="筛选条件">
        {JSON.stringify(buildTaskQueueFilters(query, range))}
      </output>
    </>
  );
}
afterEach(cleanup);

describe('task date filter controls', () => {
  it('accepts older dates and an independent keyword, then clears only dates', () => {
    render(<Filters />);
    fireEvent.change(screen.getByLabelText('搜索任务'), {
      target: { value: '森林' },
    });
    fireEvent.change(screen.getByLabelText('开始日期'), {
      target: { value: '2025-01-01' },
    });
    fireEvent.change(screen.getByLabelText('结束日期'), {
      target: { value: '2025-01-31' },
    });
    expect(screen.getByLabelText('筛选条件').textContent).toBe(
      JSON.stringify({
        searchText: '森林',
        createdAtFrom: new Date(2025, 0, 1).getTime(),
        createdAtTo: new Date(2025, 1, 1).getTime(),
      })
    );
    fireEvent.click(screen.getByRole('button', { name: '清除日期' }));
    expect(screen.getByLabelText('筛选条件').textContent).toBe(
      '{"searchText":"森林"}'
    );
    expect((screen.getByLabelText('开始日期') as HTMLInputElement).value).toBe(
      ''
    );
    expect((screen.getByLabelText('结束日期') as HTMLInputElement).value).toBe(
      ''
    );
  });

  it('permits a single-day range and sets matching calendar bounds', () => {
    render(<Filters />);
    const start = screen.getByLabelText('开始日期') as HTMLInputElement;
    const end = screen.getByLabelText('结束日期') as HTMLInputElement;
    fireEvent.change(start, { target: { value: '2026-06-01' } });
    fireEvent.change(end, { target: { value: '2026-06-01' } });
    expect(start.max).toBe('2026-06-01');
    expect(end.min).toBe('2026-06-01');
    expect(start.validity.valid).toBe(true);
    expect(end.validity.valid).toBe(true);
  });
});
