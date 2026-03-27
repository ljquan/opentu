import type {
  AdapterContext,
  VideoGenerationRequest,
  VideoModelAdapter,
} from './types';
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

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_POLL_MAX_ATTEMPTS = 1080;

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
  supportedModels: ['kling-v1', 'kling-v1-6'],
  defaultModel: 'kling-v1-6',
  async generateVideo(context, request: VideoGenerationRequest) {
    const action2: 'text2video' | 'image2video' =
      (request.params?.klingAction2 as
        | 'text2video'
        | 'image2video'
        | undefined) ||
      (request.referenceImages && request.referenceImages.length > 0
        ? 'image2video'
        : 'text2video');

    if (action2 === 'image2video' && !request.referenceImages?.[0]) {
      throw new Error('Kling image2video requires a reference image');
    }

    const aspectRatio =
      (request.params?.aspect_ratio as string | undefined) ||
      deriveAspectRatio(request.size);

    const submitResponse = await submitKlingVideo(context, action2, {
      model_name: request.model || 'kling-v1-5',
      image: request.referenceImages?.[0],
      prompt: request.prompt,
      aspect_ratio: aspectRatio,
      duration: request.duration ? String(request.duration) : undefined,
      ...(request.params || {}),
    });

    const taskId = submitResponse.data.task_id;
    let attempts = 0;

    while (attempts < DEFAULT_POLL_MAX_ATTEMPTS) {
      await new Promise((resolve) =>
        setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS)
      );
      attempts += 1;

      const status = await queryKlingVideo(context, action2, taskId);

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
