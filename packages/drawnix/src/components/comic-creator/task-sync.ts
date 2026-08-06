import type { Task } from '../../types/task.types';
import { TaskStatus, TaskType } from '../../types/task.types';
import {
  readTaskAction,
  readTaskChatResponse,
  readTaskStringParam,
} from '../shared/workflow/task-sync-utils';
import { updateWorkflowRecord } from '../shared/workflow/record-sync';
import { loadRecords, updateRecord } from './storage';
import type { ComicPage, ComicRecord } from './types';
import {
  appendComicPageImageVariants,
  buildComicPageImageVariantsFromResult,
  createComicPages,
  parseComicScriptResponse,
} from './utils';

type ComicCreatorAction = 'outline' | 'page-image';

function getComicCreatorAction(task: Task): ComicCreatorAction | null {
  return readTaskAction(task, 'comicCreatorAction', [
    'outline',
    'page-image',
  ] as const);
}

export function isComicCreatorTask(task: Task): boolean {
  return getComicCreatorAction(task) !== null;
}

function getTaskErrorMessage(task: Task): string {
  return (
    task.error?.message || task.error?.details?.originalError || '任务失败'
  );
}

function buildOutlineParseErrorMessage(
  error: unknown,
  responseText: string
): string {
  const reason = error instanceof Error ? error.message : '返回格式错误';
  const preview = responseText.trim().replace(/\s+/g, ' ').slice(0, 200);
  return preview
    ? `提示词规划未返回可解析 JSON：${reason}。响应预览：${preview}`
    : `提示词规划未返回可解析 JSON：${reason}`;
}

export function isComicCreatorTerminalTask(task: Task): task is Task {
  return (
    isComicCreatorTask(task) &&
    (task.status === TaskStatus.COMPLETED ||
      task.status === TaskStatus.FAILED ||
      task.status === TaskStatus.CANCELLED)
  );
}

export async function syncComicOutlineTask(task: Task): Promise<{
  records: ComicRecord[];
  record: ComicRecord;
} | null> {
  if (
    task.type !== TaskType.CHAT ||
    getComicCreatorAction(task) !== 'outline'
  ) {
    return null;
  }

  const recordId = readTaskStringParam(task, 'comicCreatorRecordId');
  if (!recordId) return null;

  const records = await loadRecords();
  const target = records.find((record) => record.id === recordId);
  if (!target || target.pendingOutlineTaskId !== task.id) return null;

  if (
    task.status === TaskStatus.FAILED ||
    task.status === TaskStatus.CANCELLED
  ) {
    return updateWorkflowRecord(
      target,
      {
        pendingOutlineTaskId: null,
        outlineError:
          task.status === TaskStatus.CANCELLED
            ? '提示词规划已取消'
            : getTaskErrorMessage(task),
        updatedAt: Date.now(),
      },
      updateRecord
    );
  }

  if (task.status !== TaskStatus.COMPLETED) {
    return null;
  }

  try {
    const chatResponse = readTaskChatResponse(task);
    const payload = parseComicScriptResponse(
      chatResponse,
      (task.params as { comicCreatorPageCount?: unknown })
        .comicCreatorPageCount || target.pageCount
    );

    const plannedPages = createComicPages(payload);

    return updateWorkflowRecord(
      target,
      {
        title: payload.title,
        commonPrompt: payload.commonPrompt,
        pageCount: plannedPages.length,
        pages: plannedPages,
        textModel: String(task.params.model || target.textModel || ''),
        textModelRef: task.params.modelRef || target.textModelRef || null,
        pendingOutlineTaskId: null,
        outlineError: undefined,
        updatedAt: Date.now(),
      },
      updateRecord
    );
  } catch (error) {
    return updateWorkflowRecord(
      target,
      {
        pendingOutlineTaskId: null,
        outlineError: buildOutlineParseErrorMessage(
          error,
          readTaskChatResponse(task)
        ),
        updatedAt: Date.now(),
      },
      updateRecord
    );
  }
}

export async function syncComicPageImageTask(task: Task): Promise<{
  records: ComicRecord[];
  record: ComicRecord;
} | null> {
  if (
    task.type !== TaskType.IMAGE ||
    getComicCreatorAction(task) !== 'page-image'
  ) {
    return null;
  }

  const recordId = readTaskStringParam(task, 'comicCreatorRecordId');
  const pageId = readTaskStringParam(task, 'comicCreatorPageId');
  if (!recordId || !pageId) return null;

  const records = await loadRecords();
  const target = records.find((record) => record.id === recordId);
  if (!target) return null;

  const targetPage = target.pages.find((page) => page.id === pageId);
  const targetTaskIds = new Set(
    [targetPage?.taskId, ...(targetPage?.taskIds || [])].filter(
      (id): id is string => !!id
    )
  );
  if (!targetPage || !targetTaskIds.has(task.id)) return null;

  const nextPages = target.pages.map((page): ComicPage => {
    if (page.id !== pageId) return page;

    if (task.status === TaskStatus.COMPLETED && task.result?.url) {
      const variants = buildComicPageImageVariantsFromResult({
        taskId: task.id,
        url: task.result.url,
        urls: task.result.urls,
        format: task.result.format,
        generatedAt: task.completedAt || Date.now(),
      });
      const nextPage = appendComicPageImageVariants(page, variants);
      return {
        ...nextPage,
        status: 'succeeded',
        error: undefined,
      };
    }

    if (task.status === TaskStatus.FAILED) {
      return {
        ...page,
        status: 'failed',
        error: getTaskErrorMessage(task),
      };
    }

    if (task.status === TaskStatus.CANCELLED) {
      return {
        ...page,
        status: 'cancelled',
        error: '图片生成已取消',
      };
    }

    return page;
  });

  if (nextPages === target.pages) return null;

  return updateWorkflowRecord(
    target,
    {
      pages: nextPages,
      updatedAt: Date.now(),
    },
    updateRecord
  );
}
