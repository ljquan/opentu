import {
  RectangleClient,
  type PlaitBoard,
  type PlaitElement,
} from '@plait/core';
import { isFrameElement, type PlaitFrame } from '../../types/frame.types';
import { findPPTSlideImage } from '../../utils/frame-insertion-utils';
import {
  createPPTFrameSnapshotDataUrl,
  createPPTFrameSnapshotKey,
  getPPTFrameSnapshotElements,
} from '../../utils/frame-preview-snapshot';
import type { ModelRef } from '../../utils/settings-types';
import { generateImage } from '../media-generation/image-generation-service';
import { buildPPTImageGenerationPrompt, type PPTFrameMeta } from '../ppt';
import type { PptxImportCheckpoint } from '../pptx-import';
import { unifiedCacheService } from '../unified-cache-service';
import { putPptExplainerArtifact } from './internal-artifact-cache';
import type { PptExplainerSlide, PptExplainerTaskState } from './types';
import { PptExplainerValidationError } from './validation';

interface PptFrameWithMeta extends PlaitFrame {
  pptMeta: PPTFrameMeta;
}

function isPptFrame(element: PlaitElement): element is PptFrameWithMeta {
  const pptMeta = (element as PlaitElement & { pptMeta?: PPTFrameMeta })
    .pptMeta;
  return isFrameElement(element) && Boolean(pptMeta);
}

function collectPptFrames(
  elements: readonly PlaitElement[]
): PptFrameWithMeta[] {
  const frames: PptFrameWithMeta[] = [];
  const visit = (items: readonly PlaitElement[]) => {
    for (const element of items) {
      if (isPptFrame(element)) frames.push(element);
      const children = (element as PlaitElement & { children?: PlaitElement[] })
        .children;
      if (Array.isArray(children)) visit(children);
    }
  };
  visit(elements);
  return frames.sort((left, right) => {
    const leftIndex = left.pptMeta.pageIndex;
    const rightIndex = right.pptMeta.pageIndex;
    if (typeof leftIndex === 'number' && typeof rightIndex === 'number') {
      return leftIndex - rightIndex;
    }
    if (typeof leftIndex === 'number') return -1;
    if (typeof rightIndex === 'number') return 1;
    return left.name.localeCompare(right.name, 'zh-CN');
  });
}

async function createContentFingerprint(source: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(source)
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('');
  }

  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

async function createFrameRevision(
  board: PlaitBoard,
  frame: PptFrameWithMeta
): Promise<string> {
  return createContentFingerprint(
    createPPTFrameSnapshotKey(getPPTFrameSnapshotElements(board, frame))
  );
}

export interface CurrentPptSourceSelection {
  frameIds: string[];
  /** Omitted for reviewed topic outlines, whose selected pages remain editable. */
  frameRevisions?: Record<string, string>;
}

export function getCurrentPptExplainerDraftOwners(board: PlaitBoard): string[] {
  return Array.from(
    new Set(
      collectPptFrames(board.children as PlaitElement[])
        .map((frame) => frame.pptMeta.pptExplainerJobId?.trim())
        .filter((owner): owner is string => Boolean(owner))
    )
  );
}

export async function captureCurrentPptSourceSelection(
  board: PlaitBoard,
  pptExplainerJobId?: string
): Promise<CurrentPptSourceSelection> {
  const owner = pptExplainerJobId?.trim();
  const frames = collectPptFrames(board.children as PlaitElement[]).filter(
    (frame) => !owner || frame.pptMeta.pptExplainerJobId?.trim() === owner
  );
  if (frames.length === 0) {
    throw new PptExplainerValidationError('当前画板没有 PPT 页面');
  }

  const frameIds = frames.map((frame) => frame.id);
  const snapshotKeys = frames.map((frame) =>
    createPPTFrameSnapshotKey(getPPTFrameSnapshotElements(board, frame))
  );
  const frameRevisions: Record<string, string> = {};
  for (let index = 0; index < frames.length; index += 1) {
    frameRevisions[frames[index].id] = await createContentFingerprint(
      snapshotKeys[index]
    );
  }
  return { frameIds, frameRevisions };
}

async function resolveSelectedPptFrames(
  board: PlaitBoard,
  selection?: CurrentPptSourceSelection
): Promise<PptFrameWithMeta[]> {
  const frames = collectPptFrames(board.children as PlaitElement[]);
  if (!selection) return frames;
  if (selection.frameIds.length === 0) {
    throw new PptExplainerValidationError(
      '当前 PPT 的提交页集合为空，请重新创建任务'
    );
  }

  const frameById = new Map(frames.map((frame) => [frame.id, frame]));
  const selected: PptFrameWithMeta[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < selection.frameIds.length; index += 1) {
    const frameId = selection.frameIds[index];
    if (!frameId || seen.has(frameId)) {
      throw new PptExplainerValidationError(
        '当前 PPT 的提交页集合无效，请重新创建任务'
      );
    }
    seen.add(frameId);

    const frame = frameById.get(frameId);
    if (!frame) {
      throw new PptExplainerValidationError(
        `提交时的第 ${index + 1} 页已缺失，请重新创建任务`
      );
    }
    if (selection.frameRevisions) {
      const expectedRevision = selection.frameRevisions[frameId];
      if (!expectedRevision) {
        throw new PptExplainerValidationError(
          `提交时的第 ${index + 1} 页缺少版本信息，请重新创建任务`
        );
      }
      if ((await createFrameRevision(board, frame)) !== expectedRevision) {
        throw new PptExplainerValidationError(
          `提交时的第 ${index + 1} 页内容已变更，请重新创建任务`
        );
      }
    }
    selected.push(frame);
  }
  return selected;
}

async function readSnapshotBlob(
  url: string,
  signal?: AbortSignal
): Promise<Blob> {
  signal?.throwIfAborted();
  const cached = await unifiedCacheService.getCachedBlob(url);
  if (cached?.size) return cached;

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`页面快照读取失败（HTTP ${response.status}）`);
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error('页面快照为空');
  return blob;
}

async function renderFrameSnapshot(
  board: PlaitBoard,
  frame: PptFrameWithMeta,
  signal?: AbortSignal
): Promise<Blob> {
  signal?.throwIfAborted();
  const rect = RectangleClient.getRectangleByPoints(frame.points);
  const snapshotUrl = await createPPTFrameSnapshotDataUrl(board, frame, {
    maxDimension: Math.max(1, Math.ceil(Math.max(rect.width, rect.height))),
  });
  signal?.throwIfAborted();
  if (!snapshotUrl) throw new Error('无法渲染页面内容');
  return readSnapshotBlob(snapshotUrl, signal);
}

async function createDeckFingerprint(slides: readonly PptExplainerSlide[]) {
  const source = JSON.stringify(
    slides.map((slide) => ({
      pageIndex: slide.pageIndex,
      frameId: slide.frameId,
      title: slide.title,
      snapshotUrl: slide.snapshotUrl,
      snapshotMimeType: slide.snapshotMimeType,
      notes: slide.notes,
      transition: slide.transition,
    }))
  );
  return createContentFingerprint(source);
}

export interface FrozenPptSource {
  slides: PptExplainerSlide[];
  deckFingerprint: string;
  frameIds: string[];
}

function clonePptxCheckpoint(
  checkpoint: PptxImportCheckpoint
): PptxImportCheckpoint {
  return {
    ...checkpoint,
    source: { ...checkpoint.source },
    slideSize: { ...checkpoint.slideSize },
    slides: checkpoint.slides.map((slide) => ({
      ...slide,
      diagnostics: slide.diagnostics.map((item) => ({ ...item })),
    })),
    diagnostics: checkpoint.diagnostics.map((item) => ({ ...item })),
    renderer: { ...checkpoint.renderer },
  };
}

export function applyPptxCheckpointToExplainerState(
  state: PptExplainerTaskState,
  checkpoint: PptxImportCheckpoint
): PptExplainerTaskState {
  return {
    ...state,
    pptxImport: clonePptxCheckpoint(checkpoint),
    pptx: {
      filename: checkpoint.source.fileName,
      mimeType: checkpoint.source.mimeType,
      cacheUrl: checkpoint.source.cacheUrl,
      fingerprint: checkpoint.source.fingerprint,
    },
    deckFingerprint: checkpoint.source.fingerprint,
    slides: checkpoint.slides.map((slide) => ({
      pageIndex: slide.pageIndex,
      title: `PPT 页面 ${slide.pageIndex}`,
      ...(slide.cacheUrl
        ? {
            snapshotUrl: slide.cacheUrl,
            snapshotMimeType: 'image/svg+xml',
          }
        : {}),
      notes: slide.notes,
      turns: [],
      diagnostics: slide.diagnostics.map((item) => item.message),
    })),
    diagnostics: checkpoint.diagnostics.map((item) => item.message),
  };
}

export interface PreparePptSlideImagesOptions {
  model?: string;
  modelRef?: ModelRef | null;
  signal?: AbortSignal;
  selection?: CurrentPptSourceSelection;
  onInternalTaskCreated?: (taskId: string) => void;
}

export function currentPptNeedsGeneratedSlideImages(
  board: PlaitBoard,
  frameIds?: readonly string[]
): boolean {
  const selectedIds = frameIds ? new Set(frameIds) : null;
  return collectPptFrames(board.children as PlaitElement[]).some(
    (frame) =>
      (!selectedIds || selectedIds.has(frame.id)) &&
      Boolean(frame.pptMeta.slidePrompt?.trim()) &&
      !findPPTSlideImage(board, frame.id)?.url &&
      !frame.pptMeta.slideImageUrl
  );
}

/**
 * Generate only missing image-first PPT pages. Work is intentionally serial so
 * several large decks cannot fan out image decoding in this orchestrator.
 */
export async function prepareMissingPptSlideImages(
  board: PlaitBoard,
  options: PreparePptSlideImagesOptions
): Promise<Map<string, string>> {
  const frames = await resolveSelectedPptFrames(board, options.selection);
  const generated = new Map<string, string>();

  for (const frame of frames) {
    options.signal?.throwIfAborted();
    const existingImageUrl =
      findPPTSlideImage(board, frame.id)?.url || frame.pptMeta.slideImageUrl;
    if (existingImageUrl) {
      generated.set(frame.id, existingImageUrl);
      continue;
    }

    const slidePrompt = frame.pptMeta.slidePrompt?.trim();
    if (!slidePrompt) continue;
    if (!options.model && !options.modelRef) {
      throw new PptExplainerValidationError(
        `第 ${
          frame.pptMeta.pageIndex || frame.name
        } 页需要生成页面图，但未选择图片模型`
      );
    }

    const result = await generateImage(
      buildPPTImageGenerationPrompt(
        frame.pptMeta.commonPrompt || '',
        slidePrompt
      ),
      {
        model: options.model,
        modelRef: options.modelRef,
        size: '16x9',
        referenceImages: frame.pptMeta.referenceImages,
        signal: options.signal,
        promptMeta: {
          initialPrompt: slidePrompt,
          sentPrompt: slidePrompt,
          title: frame.name || 'PPT 页面',
          category: 'agent',
          tags: ['PPT讲解视频', '页面快照'],
          skillId: 'generate_ppt_explainer_video',
          skillName: 'PPT讲解视频',
        },
        resultVisibility: 'internal',
        autoInsertToCanvas: false,
        onTaskCreated: options.onInternalTaskCreated,
      }
    );
    options.signal?.throwIfAborted();
    const url =
      result.url || result.task.result?.urls?.at(-1) || result.task.result?.url;
    if (!url) {
      throw new PptExplainerValidationError(
        `第 ${frame.pptMeta.pageIndex || frame.name} 页图片生成失败：${
          result.task.error?.message || '未返回图片'
        }`
      );
    }

    generated.set(frame.id, url);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  return generated;
}

/**
 * Freeze PPT frames one page at a time. Binary snapshots live in a dedicated
 * internal Cache Storage namespace and never enter task parameters.
 */
export async function freezeCurrentPptSource(
  board: PlaitBoard,
  jobId: string,
  options: {
    signal?: AbortSignal;
    slideImageOverrides?: ReadonlyMap<string, string>;
    selection?: CurrentPptSourceSelection;
  } = {}
): Promise<FrozenPptSource> {
  const frames = await resolveSelectedPptFrames(board, options.selection);
  if (frames.length === 0) {
    throw new PptExplainerValidationError('当前画板没有 PPT 页面');
  }

  const slides: PptExplainerSlide[] = [];
  for (let index = 0; index < frames.length; index += 1) {
    options.signal?.throwIfAborted();
    const frame = frames[index];
    const pageIndex = index + 1;
    try {
      const existingImageUrl =
        options.slideImageOverrides?.get(frame.id) ||
        findPPTSlideImage(board, frame.id)?.url ||
        frame.pptMeta.slideImageUrl;
      const blob = existingImageUrl
        ? await readSnapshotBlob(existingImageUrl, options.signal)
        : await renderFrameSnapshot(board, frame, options.signal);
      options.signal?.throwIfAborted();
      const extension = blob.type.includes('svg')
        ? 'svg'
        : blob.type.includes('webp')
        ? 'webp'
        : blob.type.includes('jpeg')
        ? 'jpg'
        : 'png';
      const snapshotUrl = await putPptExplainerArtifact(
        jobId,
        `slide-${pageIndex}.${extension}`,
        blob
      );
      slides.push({
        pageIndex,
        frameId: frame.id,
        title: frame.name?.trim() || `PPT 页面 ${pageIndex}`,
        snapshotUrl,
        snapshotMimeType: blob.type || undefined,
        notes: frame.pptMeta.notes?.trim() || undefined,
        transition: frame.pptMeta.transition,
        turns: [],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new PptExplainerValidationError(
        `第 ${pageIndex} 页快照失败：${message}`
      );
    }

    // Yield between pages so large decks do not monopolize the main thread.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  return {
    slides,
    deckFingerprint: await createDeckFingerprint(slides),
    frameIds: frames.map((frame) => frame.id),
  };
}

export function listCurrentPptFrameIds(
  board: PlaitBoard,
  pptExplainerJobId?: string
): string[] {
  const normalizedOwner = pptExplainerJobId?.trim();
  return collectPptFrames(board.children as PlaitElement[])
    .filter(
      (frame) =>
        !normalizedOwner ||
        frame.pptMeta.pptExplainerJobId?.trim() === normalizedOwner
    )
    .map((frame) => frame.id);
}
