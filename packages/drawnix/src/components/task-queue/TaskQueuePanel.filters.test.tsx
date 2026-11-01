import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import React, { useMemo, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';
import {
  buildTaskQueueFilters,
  matchesTaskQueueFilters,
  type TaskQueueFilters,
} from '../../utils/task-queue-filters';
import { TaskQueueSearchFilters } from './TaskQueueSearchFilters';

// Run the panel's actual state, filtering, filter JSX and list selection with
// React. This avoids starting provider/media services unrelated to searching.
const source = readFileSync(resolve(__dirname, 'TaskQueuePanel.tsx'), 'utf8');
const tree = ts.createSourceFile(
  'TaskQueuePanel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX
);
const names = new Set([
  'activeTab', 'searchText', 'dateRange', 'taskFilters', 'typeFilter',
  'selectionMode', 'selectedTaskIds', 'isCharacterView', 'filteredTasks',
  'handleToggleSelectionMode', 'typeCounts', 'displayTotalCount',
  'taskRetentionHint', 'allTabLabel', 'archivedTabLabel', 'allLoadedText',
  'filterSection',
]);
const declarations: string[] = [];
let listExpression = '';
function visit(node: ts.Node): void {
  if (ts.isVariableDeclaration(node)) {
    const name = ts.isIdentifier(node.name)
      ? node.name.text
      : ts.isArrayBindingPattern(node.name)
      ? node.name.elements[0]?.getText(tree)
      : undefined;
    if (name && names.has(name)) declarations.push(`const ${node.getText(tree)};`);
  }
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'BaseDrawer') {
    const child = node.children.find(ts.isJsxExpression);
    if (child?.expression) listExpression = child.expression.getText(tree);
  }
  ts.forEachChild(node, visit);
}
visit(tree);
if (declarations.length !== names.size || !listExpression)
  throw new Error('Task queue filter declarations not found');

const compiled = ts.transpileModule(`
exports.Panel = function Panel({ tasks }) {
  const activeTasks = tasks.filter(task => task.status === TaskStatus.PROCESSING);
  const completedTasks = tasks.filter(task => task.status === TaskStatus.COMPLETED);
  const failedTasks = tasks.filter(task => task.status === TaskStatus.FAILED);
  const cancelledTasks = tasks.filter(task => task.status === TaskStatus.CANCELLED);
  const characters = [];
  const archivedCount = 123;
  const totalCount = tasks.length;
  const loadedCount = tasks.length;
  const isLoading = false;
  const isLoadingMore = false;
  const hasMore = false;
  const isConfigured = false;
  const isSyncing = false;
  const syncProgress = 0;
  const selectedActiveCount = 0;
  const selectedRetryableCount = 0;
  const selectedSyncableCount = 0;
  const loadMore = noop;
  const handleClear = noop;
  const handleSelectAll = noop;
  const handleDeselectAll = noop;
  const handleBatchCancel = noop;
  const handleBatchRetry = noop;
  const handleBatchSync = noop;
  const handleBatchDelete = noop;
  const handleSelectionChange = noop;
  const handleRetry = noop;
  const handleDelete = noop;
  const handleDownload = noop;
  const handleInsert = noop;
  const handleCopy = noop;
  const handleEdit = noop;
  const handleRegenerate = noop;
  const handleUpgradeTo2K = noop;
  const handlePreviewOpen = noop;
  const handleExtractCharacter = noop;
  ${declarations.join('\n')}
  return <>{filterSection}{${listExpression}}</>;
};`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
}).outputText;

function Tabs({ children, onChange }: {
  children: React.ReactNode;
  onChange: (value: string) => void;
}) {
  return <div role="tablist">{React.Children.map(children, child => {
    const tab = child as React.ReactElement<{ value: string; label: React.ReactNode }>;
    return <button role="tab" onClick={() => onChange(tab.props.value)}>{tab.props.label}</button>;
  })}</div>;
}
function Button({ children, icon, onClick }: {
  children?: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: () => void;
}) {
  return <button onClick={onClick}>{icon}{children}</button>;
}
function HoverTip({ children, content }: { children: React.ReactNode; content: React.ReactNode }) {
  return <span title={typeof content === 'string' ? content : undefined}>{children}</span>;
}
const Icon = () => <span />;
const exports = {} as { Panel: React.ComponentType<{ tasks: Task[] }> };
runInNewContext(compiled, {
  exports, React, useMemo, useState, TaskType, TaskStatus,
  buildTaskQueueFilters, matchesTaskQueueFilters, TaskQueueSearchFilters,
  Tabs, TabPanel: Icon, Button, HoverTip,
  FilterIcon: Icon, ImageIcon: Icon, VideoIcon: Icon, Music4: Icon, UserIcon: Icon,
  CheckDoubleIcon: Icon, DeleteIcon: Icon, PauseCircleIcon: Icon, RefreshIcon: Icon,
  CloudUploadIcon: Icon, Checkbox: Icon,
  noop: () => undefined,
  ArchivedTaskList: ({ filters }: { filters: TaskQueueFilters }) =>
    <output aria-label="历史筛选">{JSON.stringify(filters)}</output>,
  CharacterList: () => <div>角色列表</div>,
  VirtualTaskList: ({ tasks, emptyContent }: { tasks: Task[]; emptyContent: React.ReactNode }) =>
    tasks.length
      ? <output aria-label="当前任务">{JSON.stringify(tasks.map(task => task.id))}</output>
      : emptyContent,
});

function task(id: string, prompt: string, year: number, month: number, day: number): Task {
  const createdAt = new Date(year, month - 1, day, 12).getTime();
  return { id, params: { prompt }, createdAt, updatedAt: createdAt,
    type: TaskType.IMAGE, status: TaskStatus.COMPLETED };
}
const tasks = [
  task('old-forest', '森林', 2025, 1, 1),
  task('old-sky', '天空', 2025, 1, 10),
  task('end-forest', '森林', 2025, 1, 31),
  task('new-forest', '森林', 2025, 2, 1),
];
afterEach(cleanup);

describe('TaskQueuePanel filter wiring', () => {
  it('shows search and date controls in history and forwards their combined values', () => {
    render(<exports.Panel tasks={tasks} />);
    fireEvent.click(screen.getByRole('tab', { name: /^历史/ }));
    fireEvent.change(screen.getByLabelText('搜索任务'), { target: { value: ' 森林 ' } });
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2025-01-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2025-01-31' } });
    expect(screen.getByLabelText('历史筛选').textContent).toBe(JSON.stringify({
      searchText: '森林',
      createdAtFrom: new Date(2025, 0, 1).getTime(),
      createdAtTo: new Date(2025, 1, 1).getTime(),
    }));
    fireEvent.click(screen.getByRole('button', { name: '清除日期' }));
    expect(screen.getByLabelText('历史筛选').textContent).toBe('{"searchText":"森林"}');
  });

  it('uses the same date and text combination in the current list across tab switches', () => {
    render(<exports.Panel tasks={tasks} />);
    fireEvent.change(screen.getByLabelText('搜索任务'), { target: { value: '森林' } });
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2025-01-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2025-01-31' } });
    expect(screen.getByLabelText('当前任务').textContent).toBe('["end-forest","old-forest"]');
    fireEvent.click(screen.getByRole('tab', { name: /^历史/ }));
    expect(screen.getByLabelText('历史筛选').textContent).toContain('森林');
    fireEvent.click(screen.getByRole('tab', { name: /^已完成/ }));
    expect(screen.getByLabelText('当前任务').textContent).toBe('["end-forest","old-forest"]');
  });

  it('opens history after selecting the character view instead of leaving it covered', () => {
    render(<exports.Panel tasks={tasks} />);
    const characterButton = screen.getByTitle('角色 (0)').querySelector('button');
    if (!characterButton) throw new Error('Missing character filter button');
    fireEvent.click(characterButton);
    expect(screen.getByText('角色列表')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /^历史/ }));
    expect(screen.queryByText('角色列表')).toBeNull();
    expect(screen.getByLabelText('历史筛选')).toBeTruthy();
    expect(screen.getByLabelText('开始日期')).toBeTruthy();
  });
});
