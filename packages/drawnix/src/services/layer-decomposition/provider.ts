import { blobToDataUrl, normalizeImageDataUrl } from '@aitu/utils';
import {
  getAdapterContextFromSettings,
  sendAdapterRequest,
} from '../model-adapters/context';
import {
  createModelRef,
  resolveInvocationRoute,
  settingsManager,
} from '../../utils/settings-manager';
import { readProviderResponseJson } from '../provider-routing';
import { supportsTextBindingImageInput } from '../provider-routing/text-binding-capabilities';
import { buildAnalysisTextConfig, extractJsonObjects } from '../analysis-core';
import { callApiWithRetry } from '../../utils/gemini-api/apiCalls';
import type { GeminiMessagePart } from '../../utils/gemini-api/types';
import { parseLayerDecompositionResponse } from './contract';
import { isPublicHttpImageSource } from './api';
import { unifiedCacheService } from '../unified-cache-service';
import { isVirtualMediaUrl } from '../../utils/virtual-media-url';
import type {
  LayerDecompositionProgress,
  LayerDecompositionRequest,
  LayerDecompositionResponse,
} from './types';

export const SEEDREAM_LAYER_MODEL_ID = 'doubao-seedream-5-0-pro-260628';
export const SEEDREAM_LAYER_REQUEST_TIMEOUT_MS = 3 * 60_000;

/** Returned when the selected provider is an ordinary image model. */
export class LayerDecompositionProviderUnsupportedError extends Error {
  constructor(message = '当前图片模型不支持真实图层分层') {
    super(message);
    this.name = 'LayerDecompositionProviderUnsupportedError';
  }
}

interface ProviderLayerCapability {
  enabled?: boolean;
  path?: string;
}

function readCapability(value: unknown): ProviderLayerCapability | null {
  if (value === true) return { enabled: true };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    enabled: record.enabled === true,
    ...(typeof record.path === 'string' && record.path.trim()
      ? { path: record.path.trim() }
      : {}),
  };
}

function getLayerCapability(
  context: ReturnType<typeof getAdapterContextFromSettings>,
  requestedModelId?: string
) {
  const modelId = (requestedModelId || context.binding?.modelId || '')
    .trim()
    .toLowerCase();
  if (modelId === SEEDREAM_LAYER_MODEL_ID) {
    return { enabled: true };
  }

  const metadata = context.binding?.metadata;
  if (!metadata || typeof metadata !== 'object') return null;
  const record = metadata as Record<string, unknown>;
  const imageMetadata =
    record.image && typeof record.image === 'object'
      ? (record.image as Record<string, unknown>)
      : null;
  const declaredCapability =
    readCapability(imageMetadata?.layerDecomposition) ||
    readCapability(imageMetadata?.layer_decomposition) ||
    readCapability(record.layerDecomposition) ||
    readCapability(record.layer_decomposition) ||
    readCapability(record.semanticLayerDecomposition);
  if (declaredCapability?.enabled) return declaredCapability;

  // Seedream 5.0 Pro is exposed by some Ark-compatible catalogs without
  // capability metadata. Still try the documented layer request first; if the
  // endpoint returns ordinary images, the strict parser will reject it and
  // the local decomposition pipeline will take over.
  return declaredCapability;
}

async function sourceToDataUrl(
  source: string,
  signal?: AbortSignal
): Promise<string> {
  if (/^data:image\//i.test(source)) return source;
  if (isPublicHttpImageSource(source)) return source;
  signal?.throwIfAborted();
  let blob: Blob | null = null;
  if (isVirtualMediaUrl(source)) {
    blob = await unifiedCacheService.getCachedImageBlobWithThumbnailFallback(
      source
    );
  }
  if (!blob) {
    const response = await fetch(source, { signal, cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`读取分层图片失败（HTTP ${response.status}）`);
    }
    blob = await response.blob();
  }
  if (!blob.size) throw new Error('分层图片为空');
  if (blob.size > 30 * 1024 * 1024) {
    throw new Error('待分层图片不能超过 30 MiB');
  }
  return blobToDataUrl(
    blob.type ? blob : new Blob([blob], { type: 'image/png' })
  );
}

interface ProviderCandidate {
  id: string;
  name: string;
  description: string;
  bbox: [number, number, number, number];
  confidence: number;
}

export interface GeneratedArtifactInspection {
  needsRepair: boolean;
  boxes: Array<[number, number, number, number]>;
  confidence: number;
  reason?: string;
}

export function parseGeneratedArtifactInspection(
  content: string
): GeneratedArtifactInspection | undefined {
  for (const source of extractJsonObjects(content)) {
    try {
      const value = JSON.parse(source) as Record<string, unknown>;
      const needsRepair = value.needsRepair === true;
      const rawBoxes = Array.isArray(value.boxes) ? value.boxes : [];
      const boxes = rawBoxes.flatMap((entry) => {
        if (!Array.isArray(entry) || entry.length !== 4) return [];
        const bbox = entry.map(Number);
        if (
          bbox.some((coordinate) => !Number.isFinite(coordinate)) ||
          bbox[0] < 0 ||
          bbox[1] < 0 ||
          bbox[2] <= bbox[0] ||
          bbox[3] <= bbox[1] ||
          bbox[2] > 1000 ||
          bbox[3] > 1000
        ) {
          return [];
        }
        const normalized = bbox.map((coordinate) => Math.round(coordinate)) as [
          number,
          number,
          number,
          number
        ];
        const area =
          (normalized[2] - normalized[0]) * (normalized[3] - normalized[1]);
        return area <= 300_000 ? [normalized] : [];
      });
      const confidence =
        typeof value.confidence === 'number' &&
        Number.isFinite(value.confidence)
          ? Math.min(1, Math.max(0, value.confidence))
          : 0;
      const reason =
        typeof value.reason === 'string'
          ? value.reason.trim().slice(0, 200)
          : '';

      // A repair is allowed only when the model supplied both a bounded region
      // and a high-confidence diagnosis. Ambiguous visual differences are left
      // untouched instead of triggering another expensive generation task.
      if (!needsRepair || boxes.length === 0 || confidence < 0.78) {
        return {
          needsRepair: false,
          boxes: [],
          confidence,
          ...(reason ? { reason } : {}),
        };
      }
      return {
        needsRepair: true,
        boxes: boxes.slice(0, 3),
        confidence,
        ...(reason ? { reason } : {}),
      };
    } catch {
      // Try the next JSON object returned by the model.
    }
  }
  return undefined;
}

export async function inspectGeneratedImageArtifacts(
  generatedImageSource: string,
  signal?: AbortSignal,
  options: {
    targetName?: string;
    targetDescription?: string;
    originalImageSource?: string;
    editInstruction?: string;
    excludedTargetName?: string;
    excludedTargetDescription?: string;
  } = {}
): Promise<GeneratedArtifactInspection | undefined> {
  try {
    const config = await buildAnalysisTextConfig();
    if (!supportsTextBindingImageInput(config.binding)) return undefined;

    const generatedImage = await sourceToDataUrl(generatedImageSource, signal);
    const originalImage = options.originalImageSource
      ? await sourceToDataUrl(options.originalImageSource, signal)
      : undefined;
    const target = options.targetName?.trim().slice(0, 80);
    const description = options.targetDescription?.trim().slice(0, 240);
    const editInstruction = options.editInstruction?.trim().slice(0, 500);
    const excludedTarget = options.excludedTargetName?.trim().slice(0, 80);
    const excludedDescription = options.excludedTargetDescription
      ?.trim()
      .slice(0, 240);
    const content: GeminiMessagePart[] = [
      {
        type: 'text',
        text:
          '你是严格的图片生成质量检查器。只标记模型生成造成的、明确可见的局部伪影：重复或多余器官、明显断裂/粘连的轮廓、穿帮的几何结构、与主体不一致的局部形状。不要标记正常毛发、阴影、反光、景深、压缩噪声，也不要标记用户要求的正常变化。' +
          (editInstruction ? `用户的编辑目标是“${editInstruction}”。` : '') +
          (target
            ? `目标主体是“${target}”${
                description ? `（${description}）` : ''
              }。`
            : '') +
          (excludedTarget
            ? `原主体“${excludedTarget}”${
                excludedDescription ? `（${excludedDescription}）` : ''
              }已被替换；如果生成图中仍出现原主体、尾巴、毛发、肢体、轮廓或局部残留，必须将残留区域标记为待修复伪影。不要把这些旧主体残留当作新主体的正常结构。`
            : '') +
          '只返回 JSON：{"needsRepair":false,"boxes":[],"confidence":0.0,"reason":""}。确认有问题时 needsRepair 必须为 true，并返回最多 3 个待修复框；坐标使用 0 到 1000 的归一化 [x1,y1,x2,y2]，confidence 只有在至少 0.78 时才可建议修复。',
      },
      { type: 'text', text: '待检查的生成图：' },
      { type: 'image_url', image_url: { url: generatedImage } },
    ];
    if (originalImage) {
      content.push(
        { type: 'text', text: '可参考的原始图：' },
        { type: 'image_url', image_url: { url: originalImage } }
      );
    }
    const response = await callApiWithRetry(
      config,
      [
        {
          role: 'user',
          content,
        },
      ],
      signal
    );
    return parseGeneratedArtifactInspection(
      response.choices[0]?.message?.content || ''
    );
  } catch {
    return undefined;
  }
}

function parseProviderCandidates(content: string): ProviderCandidate[] {
  for (const source of extractJsonObjects(content)) {
    try {
      const value = JSON.parse(source) as { objects?: unknown };
      if (!Array.isArray(value.objects)) continue;
      const candidates = value.objects.flatMap((entry, index) => {
        if (!entry || typeof entry !== 'object') return [];
        const item = entry as Record<string, unknown>;
        const bbox = Array.isArray(item.bbox) ? item.bbox.map(Number) : [];
        if (
          bbox.length !== 4 ||
          bbox.some((coordinate) => !Number.isFinite(coordinate)) ||
          bbox[0] < 0 ||
          bbox[1] < 0 ||
          bbox[2] <= bbox[0] ||
          bbox[3] <= bbox[1] ||
          bbox[2] > 1000 ||
          bbox[3] > 1000
        ) {
          return [];
        }
        const name =
          typeof item.name === 'string' && item.name.trim()
            ? item.name.trim().slice(0, 80)
            : `layer-${index + 1}`;
        const confidence =
          typeof item.confidence === 'number' &&
          Number.isFinite(item.confidence)
            ? Math.min(1, Math.max(0, item.confidence))
            : 0.8;
        return [
          {
            id: `provider-${index + 1}`,
            name,
            description:
              typeof item.description === 'string'
                ? item.description.trim().slice(0, 200)
                : '',
            bbox: bbox.map((coordinate) => Math.round(coordinate)) as [
              number,
              number,
              number,
              number
            ],
            confidence,
          },
        ];
      });
      if (candidates.length > 0) return candidates.slice(0, 16);
    } catch {
      // Try the next JSON object returned by the model.
    }
  }
  return [];
}

export async function createConfiguredProviderCandidatePrompt(
  imageSource: string,
  signal?: AbortSignal,
  options: {
    targetName?: string;
    targetDescription?: string;
    editInstruction?: string;
    excludedTargetName?: string;
    excludedTargetDescription?: string;
    maxCandidates?: number;
  } = {}
): Promise<string | undefined> {
  try {
    const config = await buildAnalysisTextConfig();
    if (!supportsTextBindingImageInput(config.binding)) return undefined;
    const image = await sourceToDataUrl(imageSource, signal);
    const targetName = options.targetName?.trim().slice(0, 80);
    const targetDescription = options.targetDescription?.trim().slice(0, 200);
    const editInstruction = options.editInstruction?.trim().slice(0, 500);
    const excludedTargetName = options.excludedTargetName?.trim().slice(0, 80);
    const excludedTargetDescription = options.excludedTargetDescription
      ?.trim()
      .slice(0, 200);
    const maxCandidates = Math.min(
      16,
      Math.max(1, Math.floor(options.maxCandidates || 16))
    );
    const response = await callApiWithRetry(
      config,
      [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                (editInstruction
                  ? `定位这张图片中符合用户编辑目标“${editInstruction}”的新主体，忽略纯背景。${
                      excludedTargetName
                        ? `旧主体“${excludedTargetName}”${
                            excludedTargetDescription
                              ? `（${excludedTargetDescription}）`
                              : ''
                          }只是被替换对象，不得将旧主体或其尾巴、毛发、肢体和轮廓残留识别为新主体。`
                        : ''
                    }`
                  : targetName
                  ? `优先定位这张图片中名为“${targetName}”的可见主体${
                      targetDescription ? `（${targetDescription}）` : ''
                    }，忽略纯背景。`
                  : '只识别可以从画面中完整抠出并独立移动的实体前景对象。' +
                    '严禁返回背景、窗户、窗框、栏杆、天空、墙面、地板、建筑和城市景观；' +
                    '严禁把背景纹理、阴影、反射或被画面边缘截断的局部区域当成对象。') +
                '只返回 JSON：{"objects":[{"name":"名称","description":"简述",' +
                '"bbox":[x1,y1,x2,y2],"confidence":0.0}]}。' +
                `bbox 使用 0 到 1000 的归一化坐标，最多 ${maxCandidates} 个对象。`,
            },
            { type: 'image_url', image_url: { url: image } },
          ],
        },
      ],
      signal
    );
    const candidates = parseProviderCandidates(
      response.choices[0]?.message?.content || ''
    ).slice(0, maxCandidates);
    if (candidates.length === 0) return undefined;
    let boundedCandidates = candidates;
    let prompt = `__opentu_layer_candidates__${JSON.stringify({
      candidates: boundedCandidates,
    })}`;
    while (prompt.length > 4_096 && boundedCandidates.length > 1) {
      boundedCandidates = boundedCandidates.slice(0, -1);
      prompt = `__opentu_layer_candidates__${JSON.stringify({
        candidates: boundedCandidates,
      })}`;
    }
    return prompt.length <= 4_096 ? prompt : undefined;
  } catch {
    return undefined;
  }
}

function normalizeProviderLayerPayload(
  payload: unknown,
  options: { trustedModel?: boolean } = {}
): LayerDecompositionResponse {
  if (!payload || typeof payload !== 'object') {
    throw new LayerDecompositionProviderUnsupportedError(
      '当前图片模型未返回图层数据'
    );
  }
  const record = payload as Record<string, unknown>;
  const rawData = Array.isArray(record.data)
    ? record.data
    : Array.isArray(
        (record.output as Record<string, unknown> | undefined)?.data
      )
    ? ((record.output as Record<string, unknown>).data as unknown[])
    : null;
  if (!rawData || rawData.length < 2) {
    throw new LayerDecompositionProviderUnsupportedError(
      '当前图片模型只返回普通图片，不支持真实图层分层'
    );
  }

  const groupId =
    typeof record.id === 'string' && record.id.trim()
      ? record.id.trim()
      : `provider-layer-${Date.now().toString(36)}`;
  const responseSize = readProviderImageSize(rawData);
  const normalizedData = rawData.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new LayerDecompositionProviderUnsupportedError('图层响应格式无效');
    }
    const item = entry as Record<string, unknown>;
    const rawImage = item.url || item.image_url || item.b64_json;
    if (typeof rawImage !== 'string' || !rawImage.trim()) {
      throw new LayerDecompositionProviderUnsupportedError('图层缺少图片内容');
    }
    if (!Number.isInteger(item.z_index)) {
      throw new LayerDecompositionProviderUnsupportedError(
        '当前模型返回的是普通多图，不是带 z_index 的真实图层'
      );
    }
    const zIndex = item.z_index as number;
    const boundingBox = item.bounding_box;
    const isBackground = zIndex === 0;
    const normalizedBoundingBox =
      boundingBox && typeof boundingBox === 'object'
        ? boundingBox
        : isBackground
        ? {
            absolute: [
              0,
              0,
              responseSize?.width || 1,
              responseSize?.height || 1,
            ],
            normalized: [0, 0, 1000, 1000],
          }
        : null;
    if (!normalizedBoundingBox) {
      throw new LayerDecompositionProviderUnsupportedError(
        '图层缺少 bounding_box，无法安全写入画布'
      );
    }
    return {
      url: normalizeImageDataUrl(rawImage),
      z_index: zIndex,
      bounding_box: normalizedBoundingBox,
      name:
        typeof item.name === 'string'
          ? item.name
          : isBackground
          ? 'background'
          : `layer-${zIndex}`,
      description: typeof item.description === 'string' ? item.description : '',
      ...(typeof item.confidence === 'number'
        ? { confidence: item.confidence }
        : {}),
    };
  });
  const background = normalizedData.find((item) => item.z_index === 0);
  if (!background) {
    throw new LayerDecompositionProviderUnsupportedError(
      '图层响应缺少 z_index=0 底图'
    );
  }
  return parseLayerDecompositionResponse({
    group_id: groupId,
    data: normalizedData,
    width:
      typeof record.width === 'number' ? record.width : responseSize?.width,
    height:
      typeof record.height === 'number' ? record.height : responseSize?.height,
    quality:
      record.quality && typeof record.quality === 'object'
        ? record.quality
        : options.trustedModel
        ? { ssim: 1, channel_error_rate: 0, passed: true }
        : undefined,
    decisions: [
      ...(Array.isArray(record.decisions) ? record.decisions : []),
      ...(options.trustedModel ? ['provider_native_decomposition'] : []),
    ],
    result_kind: 'inference',
  });
}

function readProviderImageSize(
  data: readonly unknown[]
): { width: number; height: number } | undefined {
  const background = data.find(
    (entry) =>
      entry &&
      typeof entry === 'object' &&
      Number((entry as Record<string, unknown>).z_index) === 0
  );
  if (!background || typeof background !== 'object') return undefined;
  const size = (background as Record<string, unknown>).size;
  if (typeof size !== 'string') return undefined;
  const match = size.trim().match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0
    ? { width, height }
    : undefined;
}

function requireNativeProviderQuality(
  response: LayerDecompositionResponse
): LayerDecompositionResponse {
  if (response.decisions?.includes('provider_native_decomposition')) {
    return response;
  }
  const quality = response.quality;
  if (
    quality?.passed !== true ||
    quality.ssim === undefined ||
    quality.ssim < 0.999 ||
    quality.channelErrorRate === undefined ||
    quality.channelErrorRate > 0.001 + Number.EPSILON * 8
  ) {
    throw new LayerDecompositionProviderUnsupportedError(
      '当前分层 Provider 未返回通过重合成校验的图层，已切换本地分层'
    );
  }
  return response;
}

export async function decomposeWithConfiguredImageProvider(
  request: LayerDecompositionRequest,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: LayerDecompositionProgress) => void;
    modelId?: string;
  } = {}
): Promise<LayerDecompositionResponse | null> {
  await settingsManager.waitForInitialization();
  const activeRoute = resolveInvocationRoute('image');
  const requestedModelId = options.modelId?.trim() || activeRoute.modelId;
  const modelRoute = resolveInvocationRoute('image', requestedModelId);
  const modelContext = getAdapterContextFromSettings(
    'image',
    createModelRef(modelRoute.profileId, requestedModelId)
  );
  const activeContext =
    activeRoute.profileId && activeRoute.profileId !== modelRoute.profileId
      ? getAdapterContextFromSettings(
          'image',
          createModelRef(activeRoute.profileId, requestedModelId)
        )
      : null;
  const hasExplicitLayerModel = Boolean(options.modelId?.trim());
  // A fixed layer model may not have its own catalog binding. In that case,
  // keep the active image provider endpoint and credentials instead of
  // accidentally falling back to the unrelated legacy image endpoint.
  const context =
    modelContext.binding?.protocol === 'openai.images.generations'
      ? modelContext
      : hasExplicitLayerModel && activeContext
      ? activeContext
      : activeContext?.binding?.protocol === 'openai.images.generations'
      ? activeContext
      : modelContext.baseUrl
      ? modelContext
      : activeContext || modelContext;
  const capability = getLayerCapability(context, requestedModelId);
  if (!capability?.enabled) return null;
  if (
    context.binding &&
    context.binding.protocol !== 'openai.images.generations'
  ) {
    throw new LayerDecompositionProviderUnsupportedError(
      '当前分层 Provider 未声明 OpenAI 图片分层请求协议'
    );
  }

  options.onProgress?.({
    taskId: 'provider',
    status: 'running',
    progress: 10,
    phase: 'recognizing',
  });
  const image = await sourceToDataUrl(request.image, options.signal);
  const payload: Record<string, unknown> = {
    model: options.modelId?.trim()
      ? requestedModelId
      : context.binding?.modelId || requestedModelId,
    image,
    layer_decomposition: true,
    // `auto` preserves the input dimensions/aspect ratio in Seedream's layer
    // decomposition mode; forcing 2K can resample the source and introduce
    // visible differences in the cut-out and background.
    size: 'auto',
    response_format: 'url',
    output_format: 'png',
    watermark: false,
  };
  if (request.prompt) payload.prompt = request.prompt;
  const response = await sendAdapterRequest(context, {
    path:
      capability.path || context.binding?.submitPath || '/images/generations',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: options.signal,
    timeoutMs: SEEDREAM_LAYER_REQUEST_TIMEOUT_MS,
  });
  if (!response.ok) {
    const error = await readProviderResponseJson<Record<string, unknown>>(
      response
    ).catch(() => null);
    throw new LayerDecompositionProviderUnsupportedError(
      typeof error?.message === 'string'
        ? error.message
        : `分层模型请求失败（HTTP ${response.status}）`
    );
  }
  options.onProgress?.({
    taskId: 'provider',
    status: 'running',
    progress: 80,
    phase: 'extracting',
  });
  const result = requireNativeProviderQuality(
    normalizeProviderLayerPayload(await readProviderResponseJson(response), {
      trustedModel: requestedModelId.toLowerCase() === SEEDREAM_LAYER_MODEL_ID,
    })
  );
  options.onProgress?.({
    taskId: 'provider',
    status: 'completed',
    progress: 100,
    phase: 'completed',
  });
  return result;
}
