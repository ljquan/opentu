import { taskQueueService } from '../services/task-queue';
import { resolveTaskInvocationRouteModel } from '../services/task-invocation-route';
import { TaskType, type Task } from '../types/task.types';
import { taskStorageReader } from '../services/task-storage-reader';

export interface CanvasImageDetailsSource {
  id: string;
  url?: string;
  width?: number;
  height?: number;
  prompt?: string;
  generationTaskId?: string;
  kind?: 'image' | 'video' | 'audio' | 'text';
  duration?: number;
}

export async function findCanvasImageTask(
  image: CanvasImageDetailsSource
): Promise<Task | undefined> {
  const taskId = image.generationTaskId?.trim();
  const type = (
    {
      image: TaskType.IMAGE,
      video: TaskType.VIDEO,
      audio: TaskType.AUDIO,
      text: TaskType.CHAT,
    } as const
  )[image.kind || 'image'];
  if (taskId) {
    const task = await taskQueueService.getCompleteTask(taskId);
    if (task?.type === type) return task;
  }
  if (!image.url || type === TaskType.CHAT) return undefined;
  const url = image.url;
  if (type === TaskType.IMAGE)
    return taskQueueService.findImageTaskByResultUrl(image.url);
  const matches = (task: Task) =>
    task.type === type &&
    (task.result?.url === url || task.result?.urls?.includes(url));
  const memoryTask = taskQueueService.getAllTasks().find(matches);
  if (memoryTask) return taskQueueService.getCompleteTask(memoryTask.id);
  const storedTaskId = await taskStorageReader.findMediaTaskIdByResultUrl(
    image.url,
    type,
    { includeArchived: true, throwOnError: true }
  );
  return storedTaskId
    ? taskQueueService.getCompleteTask(storedTaskId)
    : undefined;
}

const GENERATION_FIELDS = [
  'size',
  'aspectRatio',
  'width',
  'height',
  'seed',
  'quality',
  'style',
  'generationMode',
  'inputFidelity',
  'background',
  'outputFormat',
  'outputCompression',
  'batchTotal',
  'count',
  'duration',
  'resolution',
  'fps',
  'generateAudio',
  'title',
  'tags',
  'instrumental',
  'mv',
  'sunoAction',
  'temperature',
  'top_p',
  'topP',
  'max_tokens',
  'maxTokens',
  'presence_penalty',
  'frequency_penalty',
];
const PRIVATE_FIELD =
  /api.?key|token|secret|password|authorization|credential|headers|cookie|base.?url|endpoint|^(url|maskImage|mask_image|uploadedImages?|referenceImages?|inputReference)$/i;

type ParameterValue =
  | string
  | number
  | boolean
  | ParameterValue[]
  | {
      [key: string]: ParameterValue;
    };

function publicParameter(
  value: unknown,
  depth = 0
): ParameterValue | undefined {
  if (depth > 4) return undefined;
  if (typeof value === 'string') {
    return value.trim() && !/^(data:|blob:|https?:\/\/)/i.test(value)
      ? value
      : undefined;
  }
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const items = value
      .map((item) => publicParameter(item, depth + 1))
      .filter((item): item is ParameterValue => item !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).flatMap(([key, item]) => {
      if (PRIVATE_FIELD.test(key) && !['max_tokens', 'maxTokens'].includes(key))
        return [];
      const safeValue = publicParameter(item, depth + 1);
      return safeValue === undefined ? [] : [[key, safeValue] as const];
    });
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return undefined;
}

export function getCanvasImageDetails(
  image: CanvasImageDetailsSource,
  task?: Task
) {
  // Only generation settings are projected; never serialize the full task or route.
  const parameters: Record<string, ParameterValue> = {};
  if (task) {
    for (const key of GENERATION_FIELDS) {
      const value = publicParameter(task.params[key]);
      if (value !== undefined) parameters[key] = value;
    }
    const nested = publicParameter(task.params.params);
    if (nested && !Array.isArray(nested) && typeof nested === 'object') {
      Object.assign(parameters, nested);
    }
  }
  const routeModel = task ? resolveTaskInvocationRouteModel(task) : null;
  const model =
    typeof routeModel === 'string'
      ? routeModel
      : routeModel?.modelId || task?.params.model;
  const width = image.width || task?.result?.width;
  const height = image.height || task?.result?.height;
  return {
    createdAt: task?.createdAt,
    completedAt: task?.completedAt,
    model,
    prompt: task?.params.prompt || image.prompt,
    dimensions:
      (!image.kind || image.kind === 'image' || image.kind === 'video') &&
      width &&
      height
        ? `${width} × ${height} px`
        : undefined,
    duration: image.duration ?? task?.result?.duration,
    parameters: Object.entries(parameters).map(([name, value]) => ({
      name,
      value: typeof value === 'object' ? JSON.stringify(value) : String(value),
    })),
  };
}
