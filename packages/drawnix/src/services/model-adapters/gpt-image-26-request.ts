import {
  GPT_IMAGE_26_1K_MODEL_ID,
  isGPTImage26ModelId,
  supportsGPTImage26Resolution,
} from '../../constants/model-config';
import type {
  ImageGenerationRequest,
  ImageGenerationResult,
} from './types';
import { buildImageRequestPrompt } from './image-request-prompt';
import { normalizeImageResolutionTier, resolveGPTImage26Size } from './image-size-quality-resolver';

const rasterFormats = ['png', 'jpeg', 'webp'];
const imageOptions = ['quality', 'background', 'moderation', 'user'];
const rasterOptions = ['output_format', 'output_compression', 'input_fidelity'];
const gifAspectRatios: Record<string, string> = {
  '1024x1024': '1:1',
  '1024x1536': '2:3',
  '1536x1024': '3:2',
  '16x9': '16:9',
  '9x16': '9:16',
};

/** Keep saved prompt-GIF choices aligned with the single GIF control. */
export function resolveGPTImage26OutputMode(modelId: string, output: string): string {
  return output === 'gif' && modelId.trim().toLowerCase() !== GPT_IMAGE_26_1K_MODEL_ID
    ? 'gif_official'
    : output;
}

/** Keep image controls in GIF modes without exposing conflicting static encodings. */
export function isGPTImage26ParamVisible(
  paramId: string,
  params: Record<string, string>
): boolean {
  const output = params.gpt_image_26_output || 'auto';
  if (paramId === 'resolution') return output === 'auto';
  if (paramId === 'frame_count') return output === 'gif_official';
  if (paramId === 'svg_model') return output === 'svg';
  if (imageOptions.includes(paramId) && output === 'svg') return false;
  if (rasterOptions.includes(paramId) && output !== 'auto') return false;
  if (paramId === 'output_compression') {
    return params.output_format === 'jpeg' || params.output_format === 'webp';
  }
  return true;
}

function allowedString(value: unknown, allowed: readonly string[]): string | undefined {
  return typeof value === 'string' && allowed.includes(value.trim())
    ? value.trim()
    : undefined;
}

export function isGPTImage26GifEditRequest(
  request: ImageGenerationRequest,
  modelId = request.model
): boolean {
  if (!isGPTImage26ModelId(modelId) || !request.referenceImages?.length) return false;
  const output = request.params?.gpt_image_26_output;
  if (output === 'svg') return false;
  return output === 'gif' || output === 'gif_official' ||
    request.params?.output_format === 'gif' ||
    /gif|动图|循环播放/i.test(request.prompt);
}

export function normalizeGPTImage26Request(
  request: ImageGenerationRequest,
  modelId = request.model
): ImageGenerationRequest {
  const gifEdit = isGPTImage26GifEditRequest(request, modelId);
  if (!modelId || !isGPTImage26ModelId(modelId)) return request;

  const requestedSize = typeof request.params?.size === 'string' && request.params.size.trim()
    ? request.params.size
    : request.size;
  const resolvedSize = resolveGPTImage26Size(requestedSize, modelId, request.params, request.prompt);
  const requestedOutput = gifEdit
    ? modelId.trim().toLowerCase() === GPT_IMAGE_26_1K_MODEL_ID ? 'gif' : 'gif_official'
    : request.params?.gpt_image_26_output || (
    request.params?.output_format === 'gif' ? 'gif_official' :
    request.params?.output_format === 'svg' ? 'svg' : 'auto'
  );
  const output = resolveGPTImage26OutputMode(modelId, String(requestedOutput));
  if (!['auto', 'gif', 'gif_official', 'svg'].includes(String(output))) {
    throw new Error('GPT Image 2.6 输出类型无效，请重新选择');
  }
  // Explicit static pixels become per-frame dimensions upstream and can make
  // the GIF sheet exceed its size limit. Let the channel choose safe pixels.
  const size = output === 'gif_official' ? 'auto' : resolvedSize;
  const gifAspectRatio = output === 'gif_official' ? gifAspectRatios[resolvedSize] : undefined;
  const usesFormatParameter = output === 'gif_official' || output === 'svg';
  if (usesFormatParameter && modelId.trim().toLowerCase() === GPT_IMAGE_26_1K_MODEL_ID) {
    throw new Error('当前 2.6-1k 仅接入提示词 GIF，请使用其他 2.6 型号请求参数 GIF；SVG 还需官方 / 官方优惠分组');
  }
  if (output === 'svg' && (
    request.referenceImages?.length || request.maskImage ||
    request.params?.maskImage || request.params?.mask_image ||
    request.generationMode === 'image_edit' || request.generationMode === 'image_to_image'
  )) {
    throw new Error('参数 GIF / SVG 当前仅接入文字生图，请取消参考图和蒙版后生成');
  }
  const frameValue = request.params?.frame_count;
  const frameCount = frameValue === undefined || (typeof frameValue === 'string' && !frameValue.trim())
    ? undefined
    : typeof frameValue === 'number' || typeof frameValue === 'string'
      ? Number(frameValue)
      : NaN;
  if (output === 'gif_official' && frameCount !== undefined && (!Number.isSafeInteger(frameCount) || frameCount < 1)) {
    throw new Error('GIF 帧数必须为正整数，或留空使用渠道默认值');
  }
  const svgOptions = request.params?.svg;
  const svgModel = request.params?.svg_model || (
    svgOptions && typeof svgOptions === 'object' && 'model' in svgOptions ? svgOptions.model : undefined
  );

  const useImageOptions = output !== 'svg';
  const useRasterOptions = output === 'auto';
  const resolution = supportsGPTImage26Resolution(modelId) && useRasterOptions
    ? normalizeImageResolutionTier(request.params?.resolution)
    : undefined;
  const background = useImageOptions
    ? allowedString(request.background || request.params?.background, ['auto', 'transparent', 'opaque']) as ImageGenerationRequest['background']
    : undefined;
  const requestedFormat = useRasterOptions
    ? allowedString(request.outputFormat || request.params?.output_format, rasterFormats) as ImageGenerationRequest['outputFormat']
    : undefined;
  if (background === 'transparent' && requestedFormat === 'jpeg') {
    throw new Error('透明背景需要 PNG 或 WebP 输出，请修改输出格式');
  }
  const outputFormat = requestedFormat || (useRasterOptions && background === 'transparent' ? 'png' : undefined);
  const compressionValue = request.outputCompression ?? request.params?.output_compression;
  let outputCompression: number | undefined;
  const hasCompression = compressionValue !== undefined &&
    !(typeof compressionValue === 'string' && !compressionValue.trim());
  if ((outputFormat === 'jpeg' || outputFormat === 'webp') && hasCompression) {
    const parsed = typeof compressionValue === 'number' || typeof compressionValue === 'string'
      ? Number(compressionValue)
      : NaN;
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
      throw new Error('压缩质量必须为 0–100 的整数');
    }
    outputCompression = parsed;
  }
  const quality = useImageOptions
    ? allowedString(request.params?.quality, ['auto', 'low', 'medium', 'high'])
    : undefined;
  const moderation = useImageOptions
    ? allowedString(request.params?.moderation, ['auto', 'low'])
    : undefined;
  const user = useImageOptions && typeof request.params?.user === 'string'
    ? request.params.user.trim() || undefined
    : undefined;
  const inputFidelity = useRasterOptions && request.referenceImages?.length
    ? allowedString(request.inputFidelity || request.params?.input_fidelity, ['low', 'high']) as ImageGenerationRequest['inputFidelity']
    : undefined;

  return {
    ...request,
    model: modelId,
    modelRef: request.modelRef
      ? { ...request.modelRef, modelId }
      : request.modelRef,
    size,
    prompt: buildImageRequestPrompt(
      { prompt: request.prompt, background },
      output === 'gif' || output === 'gif_official',
      gifAspectRatio
    ),
    background,
    outputFormat,
    outputCompression,
    inputFidelity,
    params: {
      size,
      n: 1,
      ...(resolution ? { resolution } : {}),
      // Flare/Sunburst may route to the official upstream, which rejects this
      // legacy parameter. Only the previously verified 1k channel retains it.
      ...(modelId.trim().toLowerCase() === GPT_IMAGE_26_1K_MODEL_ID
        ? { response_format: 'b64_json' }
        : {}),
      gpt_image_26_output: output,
      ...(quality ? { quality } : {}),
      ...(background ? { background } : {}),
      ...(outputFormat ? { output_format: outputFormat } : {}),
      ...(outputCompression !== undefined ? { output_compression: outputCompression } : {}),
      ...(moderation ? { moderation } : {}),
      ...(user ? { user } : {}),
      ...(inputFidelity ? { input_fidelity: inputFidelity } : {}),
      ...(usesFormatParameter ? { output_format: output === 'svg' ? 'svg' : 'gif' } : {}),
      ...(gifEdit && output === 'gif' ? { output_format: 'gif' } : {}),
      ...(output === 'gif_official' && frameCount !== undefined ? { frame_count: frameCount } : {}),
      ...(output === 'svg' ? {
        svg: { model: typeof svgModel === 'string' && svgModel.trim() ? svgModel.trim() : 'gpt-5.5' },
      } : {}),
      // Keep edit intent even when it came from a saved task.
      maskImage: request.params?.maskImage,
      mask_image: request.params?.mask_image,
    },
  };
}

/** Share static image formats and channel-specific GIF/SVG fields across adapters. */
export function getGPTImage26OutputFields(
  request: ImageGenerationRequest
): Record<string, unknown> {
  if (!isGPTImage26ModelId(request.model)) return {};
  const params = normalizeGPTImage26Request(request).params;
  return {
    ...(params?.output_format ? { output_format: params.output_format } : {}),
    ...(params?.frame_count !== undefined ? { frame_count: params.frame_count } : {}),
    ...(params?.svg ? { svg: params.svg, stream: false } : {}),
  };
}

export function validateGPTImage26Output(
  request: ImageGenerationRequest,
  result: ImageGenerationResult
): ImageGenerationResult {
  if (!isGPTImage26ModelId(request.model)) return result;
  const normalized = normalizeGPTImage26Request(request);
  const output = normalized.params?.gpt_image_26_output;
  const expected = output === 'svg' ? 'svg' : output === 'gif' || output === 'gif_official' ? 'gif' : normalized.outputFormat;
  if (expected && result.format !== expected) {
    throw Object.assign(
      new Error(`已请求 ${expected.toUpperCase()}，但上游返回 ${result.format?.toUpperCase() || '未知格式'}。请核对令牌分组和输出方式；未自动重新生成。`),
      { code: 'IMAGE_OUTPUT_FORMAT_MISMATCH', accepted: true, retryable: false }
    );
  }
  return result;
}
