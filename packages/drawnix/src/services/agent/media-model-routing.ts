import { getModelType } from '../../constants/model-config';
import type { ModelRef } from '../../utils/settings-manager';

export type MediaModelType = 'image' | 'video' | 'audio';

const TOOL_MEDIA_TYPE: Record<string, MediaModelType> = {
  generate_image: 'image',
  generate_grid_image: 'image',
  generate_photo_wall: 'image',
  generate_inspiration_board: 'image',
  generate_video: 'video',
  generate_long_video: 'video',
  generate_ppt_explainer_video: 'video',
  generate_audio: 'audio',
};

export interface MediaModelRoutingOptions {
  defaultModels?: Partial<Record<MediaModelType, string>>;
  defaultModelRefs?: Partial<Record<MediaModelType, ModelRef | null>>;
  fallbackModels?: Partial<Record<MediaModelType, string>>;
  contextModel?: {
    id?: string | null;
    type?: 'text' | MediaModelType;
  };
  contextModelRef?: ModelRef | null;
  overrideSpecifiedModel?: boolean;
}

export function getMediaTypeForTool(
  toolName?: string | null
): MediaModelType | undefined {
  return toolName ? TOOL_MEDIA_TYPE[toolName] : undefined;
}

export function applyMediaModelDefaultsToArgs(
  toolName: string,
  args: Record<string, unknown>,
  options: MediaModelRoutingOptions
): Record<string, unknown> {
  if (toolName === 'generate_ppt_explainer_video') {
    delete args.model;
    delete args.modelRef;
    applyPPTTextModel(args, options);
    applyNamedMediaModel(args, 'image', 'imageModel', 'imageModelRef', options);
    applyNamedMediaModel(args, 'video', 'videoModel', 'videoModelRef', options);
    return args;
  }

  if (toolName === 'generate_ppt') {
    delete args.imageModel;
    delete args.imageModelRef;
    applyPPTTextModel(args, options);
    return args;
  }

  const mediaType = getMediaTypeForTool(toolName);
  if (!mediaType) {
    return args;
  }

  const selectedModel = resolveSelectedMediaModel(mediaType, options);
  if (!selectedModel) {
    return args;
  }

  const selectedModelRef = resolveSelectedMediaModelRef(
    mediaType,
    selectedModel,
    options
  );
  const specifiedModel =
    typeof args.model === 'string' && args.model.trim()
      ? args.model.trim()
      : undefined;
  const shouldUseSelectedModel =
    options.overrideSpecifiedModel ||
    !specifiedModel ||
    !isModelCompatibleWithMediaType(specifiedModel, mediaType);

  if (shouldUseSelectedModel) {
    args.model = selectedModel;
    if (selectedModelRef) {
      args.modelRef = selectedModelRef;
    } else {
      delete args.modelRef;
    }

    return args;
  }

  if (selectedModelRef && selectedModelRef.modelId === specifiedModel) {
    args.modelRef = selectedModelRef;
  } else {
    delete args.modelRef;
  }

  return args;
}

function applyNamedMediaModel(
  args: Record<string, unknown>,
  mediaType: MediaModelType,
  modelKey: string,
  modelRefKey: string,
  options: MediaModelRoutingOptions
): void {
  const selectedModel = resolveSelectedMediaModel(mediaType, options);
  if (!selectedModel) return;

  args[modelKey] = selectedModel;
  const selectedModelRef = resolveSelectedMediaModelRef(
    mediaType,
    selectedModel,
    options
  );
  if (selectedModelRef) {
    args[modelRefKey] = selectedModelRef;
  } else {
    delete args[modelRefKey];
  }
}

function applyPPTTextModel(
  args: Record<string, unknown>,
  options: MediaModelRoutingOptions
): void {
  if (options.contextModel?.type !== 'text' || !options.contextModel.id) {
    return;
  }

  args.textModel = options.contextModel.id;
  if (options.contextModelRef?.modelId === options.contextModel.id) {
    args.textModelRef = options.contextModelRef;
  } else {
    delete args.textModelRef;
  }
}

function resolveSelectedMediaModel(
  mediaType: MediaModelType,
  options: MediaModelRoutingOptions
): string | undefined {
  const defaultModel = options.defaultModels?.[mediaType];
  if (defaultModel) {
    return defaultModel;
  }

  if (options.contextModel?.type === mediaType && options.contextModel.id) {
    return options.contextModel.id;
  }

  return options.fallbackModels?.[mediaType];
}

function resolveSelectedMediaModelRef(
  mediaType: MediaModelType,
  selectedModel: string,
  options: MediaModelRoutingOptions
): ModelRef | null {
  const defaultModelRef = options.defaultModelRefs?.[mediaType];
  if (defaultModelRef?.modelId === selectedModel) {
    return defaultModelRef;
  }

  if (
    options.contextModel?.type === mediaType &&
    options.contextModelRef?.modelId === selectedModel
  ) {
    return options.contextModelRef;
  }

  return null;
}

function isModelCompatibleWithMediaType(
  modelId: string,
  mediaType: MediaModelType
): boolean {
  const modelType = getModelType(modelId);
  return !modelType || modelType === mediaType;
}
