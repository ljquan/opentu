import { isGPTImage26ModelId } from '../../constants/model-config';
import type { ImageGenerationRequest } from './types';

/** The channel returns original media. Stale format/quality options can suppress GIF output. */
export function normalizeGPTImage26Request(
  request: ImageGenerationRequest,
  modelId = request.model
): ImageGenerationRequest {
  if (!modelId || !isGPTImage26ModelId(modelId)) return request;

  return {
    ...request,
    model: modelId,
    modelRef: request.modelRef
      ? { ...request.modelRef, modelId }
      : request.modelRef,
    size: 'auto',
    background: undefined,
    outputFormat: undefined,
    outputCompression: undefined,
    inputFidelity: undefined,
    params: {
      size: 'auto',
      n: 1,
      response_format: 'b64_json',
      // Keep edit intent even when it came from a saved task.
      maskImage: request.params?.maskImage,
      mask_image: request.params?.mask_image,
    },
  };
}
