import { getVideoModelConfig } from '../constants/video-model-config';
import { waitForTaskCompletion } from '../services/media-executor/task-polling';
import type { Task } from '../types/task.types';
import type { VideoModel } from '../types/video.types';

interface BuildBatchVideoReferenceImagesParams {
  model: VideoModel;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  extraReferenceUrls?: string[];
}

/**
 * 根据模型上传模式构建批量视频生成所需的参考图列表。
 * frames 模式：按 [首帧, 尾帧]
 * 其它模式：首图优先作为链路输入，其余补充为参考图
 */
export function buildBatchVideoReferenceImages(
  params: BuildBatchVideoReferenceImagesParams
): string[] | undefined {
  const { model, firstFrameUrl, lastFrameUrl, extraReferenceUrls = [] } = params;
  const config = getVideoModelConfig(model);
  const urls: string[] = [];
  const append = (url?: string) => {
    if (!url || urls.includes(url)) {
      return;
    }
    urls.push(url);
  };

  if (config.imageUpload.mode === 'frames') {
    append(firstFrameUrl);
    append(lastFrameUrl);
    return urls.length > 0 ? urls.slice(0, config.imageUpload.maxCount) : undefined;
  }

  append(firstFrameUrl);
  for (const url of extraReferenceUrls) {
    append(url);
    if (urls.length >= config.imageUpload.maxCount) {
      break;
    }
  }

  return urls.length > 0 ? urls : undefined;
}

export async function waitForBatchVideoTask(
  taskId: string,
  signal?: AbortSignal
): Promise<{ success: boolean; task?: Task; error?: string }> {
  return waitForTaskCompletion(taskId, {
    interval: 1000,
    timeout: 30 * 60 * 1000,
    signal,
  });
}
