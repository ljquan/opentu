import type {
  AdapterContext,
  VideoGenerationRequest,
  VideoModelAdapter,
} from './types';
import type { ProviderVideoBindingMetadata } from '../provider-routing';
import { registerModelAdapter } from './registry';
import { sendAdapterRequest } from './context';

type KlingSubmitResponse = {
  code: number;
  message: string;
  request_id: string;
  data: {
    task_id: string;
    task_status: string;
    created_at: number;
    updated_at: number;
  };
};

type KlingQueryResponse = {
  code: number;
  message: string;
  request_id: string;
  data: {
    task_id: string;
    task_status: 'submitted' | 'processing' | 'succeed' | 'failed';
    task_status_msg?: string;
    task_result?: {
      videos?: Array<{ id: string; url: string; duration?: string }>;
    };
  };
};

type KlingCameraControlConfig = Partial<{
  horizontal: number;
  vertical: number;
  pan: number;
  tilt: number;
  roll: number;
  zoom: number;
}>;

type KlingCameraControl = {
  type?: string;
  config?: KlingCameraControlConfig;
};

type KlingCameraControlField = {
  key: keyof KlingCameraControlConfig;
  paramKey:
    | 'camera_horizontal'
    | 'camera_vertical'
    | 'camera_pan'
    | 'camera_tilt'
    | 'camera_roll'
    | 'camera_zoom';
  label: string;
};

type KlingElement = {
  name: string;
  description?: string;
  element_input_urls: string[];
};

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_POLL_MAX_ATTEMPTS = 1080;
const DEFAULT_KLING_MODEL_NAME = 'kling-v1-6';
const KLING_CFG_SCALE_MIN = 0;
const KLING_CFG_SCALE_MAX = 1;
const KLING_CAMERA_CONTROL_MIN = -10;
const KLING_CAMERA_CONTROL_MAX = 10;
const KLING_SUPPORTED_DATA_URL_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
]);
const KLING_CAMERA_CONTROL_FIELDS: KlingCameraControlField[] = [
  {
    key: 'horizontal',
    paramKey: 'camera_horizontal',
    label: '水平运镜',
  },
  {
    key: 'vertical',
    paramKey: 'camera_vertical',
    label: '垂直运镜',
  },
  {
    key: 'pan',
    paramKey: 'camera_pan',
    label: '水平摇镜',
  },
  {
    key: 'tilt',
    paramKey: 'camera_tilt',
    label: '垂直摇镜',
  },
  {
    key: 'roll',
    paramKey: 'camera_roll',
    label: '旋转运镜',
  },
  {
    key: 'zoom',
    paramKey: 'camera_zoom',
    label: '变焦',
  },
];
const LEGACY_KLING_EXECUTABLE_MODELS = new Set([
  'kling-v3',
  'kling-v2-6',
  'kling-v2-1',
  'kling-v1-6',
  'kling-v1-5',
  'kling-v1',
]);

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeKlingBoundedNumber(
  value: unknown,
  {
    fieldLabel,
    min,
    max,
    integer = false,
  }: {
    fieldLabel: string;
    min: number;
    max: number;
    integer?: boolean;
  }
): number | undefined {
  if (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && !value.trim())
  ) {
    return undefined;
  }

  const parsed = normalizeOptionalNumber(value);
  if (parsed === undefined) {
    throw new Error(
      integer
        ? `Kling ${fieldLabel} 必须是 ${min} 到 ${max} 之间的整数`
        : `Kling ${fieldLabel} 必须是 ${min} 到 ${max} 之间的数字`
    );
  }

  if (integer && !Number.isInteger(parsed)) {
    throw new Error(`Kling ${fieldLabel} 必须是 ${min} 到 ${max} 之间的整数`);
  }

  if (parsed < min || parsed > max) {
    throw new Error(
      integer
        ? `Kling ${fieldLabel} 必须是 ${min} 到 ${max} 之间的整数`
        : `Kling ${fieldLabel} 必须在 ${min} 到 ${max} 之间`
    );
  }

  return parsed;
}

function normalizeKlingImageInput(
  value: unknown,
  field: 'image' | 'image_tail'
): string | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  const dataUrlMatch = normalized.match(/^data:([^;]+);base64,(.+)$/i);
  if (!dataUrlMatch) {
    return normalized;
  }

  const mimeType = dataUrlMatch[1].toLowerCase();
  if (!KLING_SUPPORTED_DATA_URL_MIME_TYPES.has(mimeType)) {
    throw new Error(
      `Kling ${field} 仅支持 JPG/JPEG/PNG 的 Data URL，当前为 ${mimeType}`
    );
  }

  const base64Payload = dataUrlMatch[2].replace(/\s+/g, '');
  if (!base64Payload) {
    throw new Error(`Kling ${field} 的 Base64 内容为空`);
  }

  return base64Payload;
}

function getKlingVideoMetadata(
  context: AdapterContext
): ProviderVideoBindingMetadata | null {
  return context.binding?.metadata?.video || null;
}

function resolveAllowedKlingVersions(
  metadata: ProviderVideoBindingMetadata | null,
  action2: 'text2video' | 'image2video'
): string[] {
  const actionSpecific = metadata?.versionOptionsByAction?.[action2];
  if (Array.isArray(actionSpecific) && actionSpecific.length > 0) {
    return actionSpecific;
  }

  return Array.isArray(metadata?.versionOptions) ? metadata.versionOptions : [];
}

function resolveKlingModelName(
  context: AdapterContext,
  request: VideoGenerationRequest,
  action2: 'text2video' | 'image2video'
): string {
  const metadata = getKlingVideoMetadata(context);
  const explicitModelName = normalizeOptionalString(request.params?.model_name);
  const requestedModel = normalizeOptionalString(request.model)?.toLowerCase();
  const legacyModelName =
    requestedModel && LEGACY_KLING_EXECUTABLE_MODELS.has(requestedModel)
      ? requestedModel
      : undefined;
  const defaultModelName =
    normalizeOptionalString(metadata?.defaultVersion) || DEFAULT_KLING_MODEL_NAME;
  const resolvedModelName =
    explicitModelName || legacyModelName || defaultModelName;

  const allowedVersions = resolveAllowedKlingVersions(metadata, action2);
  if (
    allowedVersions.length > 0 &&
    !allowedVersions.includes(resolvedModelName)
  ) {
    throw new Error(
      `Kling ${action2} 不支持模型版本 ${resolvedModelName}，可选版本：${allowedVersions.join(
        ', '
      )}`
    );
  }

  return resolvedModelName;
}

function resolveKlingCameraControl(
  request: VideoGenerationRequest,
  action2: 'text2video' | 'image2video'
): KlingCameraControl | undefined {
  if (action2 !== 'text2video' || !request.params) {
    return undefined;
  }

  const existingCameraControl = request.params.camera_control;
  if (
    existingCameraControl !== undefined &&
    existingCameraControl !== null &&
    (typeof existingCameraControl !== 'object' ||
      Array.isArray(existingCameraControl))
  ) {
    throw new Error('Kling camera_control 必须是对象');
  }

  if (
    existingCameraControl &&
    typeof existingCameraControl === 'object' &&
    !Array.isArray(existingCameraControl)
  ) {
    const existingRecord = existingCameraControl as Record<string, unknown>;
    const existingType = normalizeOptionalString(existingRecord.type);
    const existingConfigInput =
      existingRecord.config &&
      typeof existingRecord.config === 'object' &&
      !Array.isArray(existingRecord.config)
        ? (existingRecord.config as Record<string, unknown>)
        : existingRecord.config === undefined || existingRecord.config === null
          ? undefined
          : null;

    if (existingConfigInput === null) {
      throw new Error('Kling camera_control.config 必须是对象');
    }

    const validatedConfig: KlingCameraControlConfig = {};
    for (const field of KLING_CAMERA_CONTROL_FIELDS) {
      const value = normalizeKlingBoundedNumber(
        existingConfigInput?.[field.key],
        {
          fieldLabel: field.label,
          min: KLING_CAMERA_CONTROL_MIN,
          max: KLING_CAMERA_CONTROL_MAX,
          integer: true,
        }
      );
      if (value !== undefined) {
        validatedConfig[field.key] = value;
      }
    }

    if (!existingType && Object.keys(validatedConfig).length === 0) {
      return undefined;
    }

    return {
      type:
        existingType ||
        (Object.keys(validatedConfig).length > 0 ? 'simple' : undefined),
      config:
        Object.keys(validatedConfig).length > 0 ? validatedConfig : undefined,
    };
  }

  const type = normalizeOptionalString(request.params.camera_control_type);
  const config: KlingCameraControlConfig = {};
  for (const field of KLING_CAMERA_CONTROL_FIELDS) {
    const value = normalizeKlingBoundedNumber(request.params[field.paramKey], {
      fieldLabel: field.label,
      min: KLING_CAMERA_CONTROL_MIN,
      max: KLING_CAMERA_CONTROL_MAX,
      integer: true,
    });

    if (value !== undefined) {
      config[field.key] = value;
    }
  }

  if (!type && Object.keys(config).length === 0) {
    return undefined;
  }

  return {
    type: type || (Object.keys(config).length > 0 ? 'simple' : undefined),
    config: Object.keys(config).length > 0 ? config : undefined,
  };
}

const resolveBaseUrl = (context: AdapterContext): string => {
  if (!context.baseUrl) {
    throw new Error('Missing baseUrl for Kling adapter');
  }
  const normalized = context.baseUrl.replace(/\/$/, '');
  return normalized.endsWith('/v1') ? normalized.slice(0, -3) : normalized;
};

const submitKlingVideo = async (
  context: AdapterContext,
  action2: 'text2video' | 'image2video',
  body: Record<string, unknown>
): Promise<KlingSubmitResponse> => {
  const baseUrl = resolveBaseUrl(context);
  const response = await sendAdapterRequest(
    context,
    {
      path: `/kling/v1/videos/${action2}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    baseUrl
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Kling submit failed: ${response.status} - ${errorText}`);
  }

  return response.json();
};

const queryKlingVideo = async (
  context: AdapterContext,
  action2: 'text2video' | 'image2video',
  taskId: string
): Promise<KlingQueryResponse> => {
  const baseUrl = resolveBaseUrl(context);
  const response = await sendAdapterRequest(
    context,
    {
      path: `/kling/v1/videos/${action2}/${taskId}`,
      method: 'GET',
    },
    baseUrl
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Kling query failed: ${response.status} - ${errorText}`);
  }

  return response.json();
};

const deriveAspectRatio = (size?: string): string | undefined => {
  if (!size || !size.includes('x')) {
    return undefined;
  }
  const [wRaw, hRaw] = size.split('x');
  const width = Number(wRaw);
  const height = Number(hRaw);
  if (!width || !height) {
    return undefined;
  }
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
};

export const klingAdapter: VideoModelAdapter = {
  id: 'kling-video-adapter',
  label: 'Kling Video',
  kind: 'video',
  docsUrl: 'https://tuzi-api.apifox.cn',
  matchProtocols: ['kling.video'],
  matchRequestSchemas: ['kling.video.auto-action-json'],
  supportedModels: [
    'kling_video',
    'kling-v3',
    'kling-v2-6',
    'kling-v2-1',
    'kling-v1-6',
    'kling-v1-5',
    'kling-v1',
  ],
  defaultModel: 'kling_video',
  async generateVideo(context, request: VideoGenerationRequest) {
    const action2: 'text2video' | 'image2video' =
      (request.params?.klingAction2 as
        | 'text2video'
        | 'image2video'
        | undefined) ||
      (request.referenceImages && request.referenceImages.length > 0
        ? 'image2video'
        : 'text2video');

    const onProgress = request.params?.onProgress as
      | ((progress: number, status?: string) => void)
      | undefined;
    const onSubmitted = request.params?.onSubmitted as
      | ((videoId: string) => void)
      | undefined;
    const modelName = resolveKlingModelName(context, request, action2);
    const aspectRatio =
      (request.params?.aspect_ratio as string | undefined) ||
      deriveAspectRatio(request.size);
    const cfgScale = normalizeKlingBoundedNumber(request.params?.cfg_scale, {
      fieldLabel: '自由度 cfg_scale',
      min: KLING_CFG_SCALE_MIN,
      max: KLING_CFG_SCALE_MAX,
    });
    const cameraControl = resolveKlingCameraControl(request, action2);
    const image = normalizeKlingImageInput(
      request.referenceImages?.[0],
      'image'
    );
    const imageTail =
      normalizeKlingImageInput(request.params?.image_tail, 'image_tail') ||
      normalizeKlingImageInput(request.referenceImages?.[1], 'image_tail');

    if (action2 === 'image2video' && !image) {
      throw new Error('Kling image2video requires a reference image');
    }

    const adapterParams = request.params
      ? Object.fromEntries(
          Object.entries(request.params).filter(
            ([key]) =>
              key !== 'onProgress' &&
              key !== 'onSubmitted' &&
              key !== 'klingAction2' &&
              key !== 'camera_control_type' &&
              key !== 'camera_horizontal' &&
              key !== 'camera_vertical' &&
              key !== 'camera_pan' &&
              key !== 'camera_tilt' &&
              key !== 'camera_roll' &&
              key !== 'camera_zoom' &&
              key !== 'kling_elements'
          )
        )
      : undefined;

    // kling_elements：角色/元素参考图，用于保持多镜头角色一致性
    // 格式：[{ name: string, description?: string, element_input_urls: string[] }]
    const klingElements = request.params?.kling_elements;
    const normalizedKlingElements: KlingElement[] | undefined =
      Array.isArray(klingElements) && klingElements.length > 0
        ? (klingElements as KlingElement[]).filter(
            (el) => el.name && Array.isArray(el.element_input_urls) && el.element_input_urls.length > 0
          )
        : undefined;

    onProgress?.(5, 'submitting');

    const submitResponse = await submitKlingVideo(context, action2, {
      ...(adapterParams || {}),
      model_name: modelName,
      image,
      image_tail: action2 === 'image2video' ? imageTail : undefined,
      prompt: request.prompt,
      aspect_ratio: aspectRatio,
      cfg_scale: cfgScale,
      camera_control: action2 === 'text2video' ? cameraControl : undefined,
      duration: request.duration ? String(request.duration) : undefined,
      kling_elements: normalizedKlingElements,
    });

    const taskId = submitResponse.data.task_id;
    onSubmitted?.(taskId);
    onProgress?.(10, 'processing');
    let attempts = 0;

    while (attempts < DEFAULT_POLL_MAX_ATTEMPTS) {
      await new Promise((resolve) =>
        setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS)
      );
      attempts += 1;

      const status = await queryKlingVideo(context, action2, taskId);
      const progress =
        status.data.task_status === 'submitted'
          ? 10
          : status.data.task_status === 'processing'
            ? Math.min(90, 10 + attempts)
            : 100;
      onProgress?.(progress, status.data.task_status);

      if (status.data.task_status === 'succeed') {
        const url = status.data.task_result?.videos?.[0]?.url;
        if (!url) {
          throw new Error('Kling result missing url');
        }
        return {
          url,
          format: 'mp4',
          duration: status.data.task_result?.videos?.[0]?.duration
            ? parseFloat(status.data.task_result.videos[0].duration)
            : undefined,
          raw: status,
        };
      }

      if (status.data.task_status === 'failed') {
        throw new Error(
          status.data.task_status_msg || 'Kling generation failed'
        );
      }
    }

    throw new Error('Kling generation timeout');
  },
};

export const registerKlingAdapter = (): void => {
  registerModelAdapter(klingAdapter);
};
