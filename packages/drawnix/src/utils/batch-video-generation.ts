import { getVideoModelConfig } from '../constants/video-model-config';
import { waitForTaskCompletion } from '../services/media-executor/task-polling';
import type { Task } from '../types/task.types';
import type { VideoModel } from '../types/video.types';

interface BuildBatchVideoReferenceImagesParams {
  model: VideoModel;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  extraReferenceUrls?: string[];
  /** 角色参考图 URL 列表，优先级高于 extraReferenceUrls */
  characterReferenceUrls?: string[];
}

export interface BatchVideoReferenceResult {
  /** 传给视频生成 API 的参考图列表 */
  referenceImages?: string[];
  /**
   * frames 模式下无法在 referenceImages 中传角色参考图（槽位被首尾帧占满），
   * 调用方应将此字段注入 prompt（如 "The same [characterDescription]"）
   * 非 frames 模式下此字段为空（角色参考图已包含在 referenceImages 中）
   */
  unusedCharacterReferenceUrls?: string[];
}

/**
 * 根据模型上传模式构建批量视频生成所需的参考图列表。
 *
 * frames 模式（Veo3.1/Seedance）：
 *   - referenceImages = [首帧, 尾帧]（固定，角色参考图无法放入）
 *   - unusedCharacterReferenceUrls = characterReferenceUrls（供调用方注入 prompt）
 *
 * 其它模式（Kling/Sora 等）：
 *   - referenceImages = [角色参考图..., 首帧, ...extras]（角色参考图优先）
 *   - unusedCharacterReferenceUrls = undefined
 */
export function buildBatchVideoReferenceImages(
  params: BuildBatchVideoReferenceImagesParams
): BatchVideoReferenceResult {
  const { model, firstFrameUrl, lastFrameUrl, extraReferenceUrls = [], characterReferenceUrls = [] } = params;
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
    const referenceImages = urls.length > 0 ? urls.slice(0, config.imageUpload.maxCount) : undefined;
    // frames 模式槽位被首尾帧占满，角色参考图只能通过 prompt 注入
    const unusedCharacterReferenceUrls = characterReferenceUrls.length > 0 ? characterReferenceUrls : undefined;
    return { referenceImages, unusedCharacterReferenceUrls };
  }

  // 非 frames 模式：角色参考图优先，然后是首帧，再是额外参考图
  for (const url of characterReferenceUrls) {
    append(url);
    if (urls.length >= config.imageUpload.maxCount) break;
  }
  append(firstFrameUrl);
  for (const url of extraReferenceUrls) {
    append(url);
    if (urls.length >= config.imageUpload.maxCount) break;
  }

  return { referenceImages: urls.length > 0 ? urls : undefined };
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
