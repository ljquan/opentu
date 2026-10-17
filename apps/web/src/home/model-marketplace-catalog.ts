export type MarketplaceCategory =
  | 'featured'
  | 'image'
  | 'video'
  | 'audio'
  | 'text'
  | 'research';

export type MarketplaceCatalogSource = 'managed' | 'curated';

export type MarketplaceModel = {
  id: string;
  name: string;
  vendor: string;
  category: Exclude<MarketplaceCategory, 'featured'>;
  description: string;
  tags: string[];
  featured?: boolean;
  accent: 'violet' | 'cyan' | 'rose' | 'green' | 'amber';
};

export type MarketplaceCatalog = {
  models: MarketplaceModel[];
  source: MarketplaceCatalogSource;
};

type CatalogLoadOptions = {
  apiBaseUrl?: string | null;
  embedded?: boolean;
  serverCatalog?: boolean;
  fetcher?: typeof fetch;
};

const CURATED_MODELS: MarketplaceModel[] = [
  {
    id: 'gpt-image-2',
    name: 'GPT Image 2',
    vendor: 'OpenAI',
    category: 'image',
    description: '适合高完成度视觉、文字排版与多轮画面修改。',
    tags: ['文字渲染', '图像编辑', '高完成度'],
    featured: true,
    accent: 'violet',
  },
  {
    id: 'nano-banana-2',
    name: 'Nano Banana 2',
    vendor: 'Google',
    category: 'image',
    description: '快速理解参考图，适合产品图、人物与连续视觉创作。',
    tags: ['参考图', '快速生成', '一致性'],
    featured: true,
    accent: 'amber',
  },
  {
    id: 'gemini-3.1-flash-image',
    name: 'Gemini 3.1 Flash Image',
    vendor: 'Google',
    category: 'image',
    description: '快速生成和编辑视觉内容，适合高频创作任务。',
    tags: ['快速', '多模态', '编辑'],
    accent: 'cyan',
  },
  {
    id: 'doubao-seedream-5-0-260128',
    name: 'Seedream 5.0',
    vendor: 'ByteDance',
    category: 'image',
    description: '兼顾中文语义、商业视觉和细节表现的图像模型。',
    tags: ['中文语义', '商业视觉', '细节'],
    accent: 'rose',
  },
  {
    id: 'qwen-image-3.0-pro',
    name: 'Qwen Image 3 Pro',
    vendor: 'Qwen',
    category: 'image',
    description: '适合中文文字、海报与复杂视觉指令。',
    tags: ['中文文字', '海报', '高质量'],
    accent: 'violet',
  },
  {
    id: 'bfl-flux-2-pro',
    name: 'FLUX 2 Pro',
    vendor: 'Black Forest Labs',
    category: 'image',
    description: '稳定的写实质感和构图控制，适合品牌视觉。',
    tags: ['写实', '构图', '品牌'],
    accent: 'green',
  },
  {
    id: 'midjourney',
    name: 'Midjourney',
    vendor: 'Midjourney',
    category: 'image',
    description: '鲜明的视觉风格与成熟审美，适合概念探索。',
    tags: ['风格化', '概念设计', '审美'],
    accent: 'amber',
  },
  {
    id: 'doubao-seedance-2-0-260128',
    name: 'Seedance 2.0',
    vendor: 'ByteDance',
    category: 'video',
    description: '面向镜头运动、叙事和人物表现的视频生成模型。',
    tags: ['镜头语言', '叙事', '人物'],
    featured: true,
    accent: 'rose',
  },
  {
    id: 'sora-2',
    name: 'Sora 2',
    vendor: 'OpenAI',
    category: 'video',
    description: '适合高质量场景生成、运动表现与视觉叙事。',
    tags: ['高质量', '运动', '叙事'],
    accent: 'violet',
  },
  {
    id: 'veo3.1',
    name: 'Veo 3.1',
    vendor: 'Google',
    category: 'video',
    description: '强调镜头真实感、提示词理解和视听表达。',
    tags: ['真实感', '镜头', '视听'],
    accent: 'cyan',
  },
  {
    id: 'kling-video-o1',
    name: 'Kling Video O1',
    vendor: 'Kling',
    category: 'video',
    description: '适合图生视频、动作延展和可控画面编辑。',
    tags: ['图生视频', '动作', '可控编辑'],
    accent: 'green',
  },
  {
    id: 'runway-vip-video',
    name: 'Runway',
    vendor: 'Runway',
    category: 'video',
    description: '成熟的视频创意工作流，适合广告和动态设计。',
    tags: ['广告', '动态设计', '工作流'],
    accent: 'amber',
  },
  {
    id: 'suno_music',
    name: 'Suno Music',
    vendor: 'Suno',
    category: 'audio',
    description: '从一句描述或歌词开始，生成完整歌曲与人声版本。',
    tags: ['歌曲生成', '歌词', '人声'],
    featured: true,
    accent: 'rose',
  },
  {
    id: 'udio130-v1.5',
    name: 'Udio 1.5',
    vendor: 'Udio',
    category: 'audio',
    description: '适合细腻编曲、音乐风格探索和高质量音频。',
    tags: ['编曲', '风格探索', '高质量'],
    accent: 'cyan',
  },
  {
    id: 'gpt-audio',
    name: 'GPT Audio',
    vendor: 'OpenAI',
    category: 'audio',
    description: '面向语音理解与生成的统一音频模型。',
    tags: ['语音', '音频理解', '生成'],
    accent: 'violet',
  },
  {
    id: 'gpt-5.6-sol',
    name: 'GPT 5.6 Sol',
    vendor: 'OpenAI',
    category: 'text',
    description: '复杂创作、策划和工具协作的旗舰文本模型。',
    tags: ['旗舰', '策划', '工具调用'],
    featured: true,
    accent: 'violet',
  },
  {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    vendor: 'Anthropic',
    category: 'text',
    description: '适合长文本、深度推理和高要求内容创作。',
    tags: ['长文本', '推理', '内容创作'],
    accent: 'amber',
  },
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    vendor: 'Google',
    category: 'text',
    description: '多模态理解、资料分析和综合任务处理。',
    tags: ['多模态', '分析', '综合任务'],
    accent: 'cyan',
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    vendor: 'DeepSeek',
    category: 'text',
    description: '中文推理、结构化写作和高性价比复杂任务。',
    tags: ['中文', '推理', '结构化'],
    accent: 'green',
  },
  {
    id: 'grok-4.5',
    name: 'Grok 4.5',
    vendor: 'xAI',
    category: 'text',
    description: '适合开放式探索、推理和实时信息型任务。',
    tags: ['探索', '推理', '信息'],
    accent: 'rose',
  },
  {
    id: 'gemini-3-pro-deepsearch',
    name: 'Gemini Deep Research',
    vendor: 'Google',
    category: 'research',
    description: '面向资料检索、交叉验证和完整研究报告。',
    tags: ['资料检索', '交叉验证', '报告'],
    featured: true,
    accent: 'cyan',
  },
  {
    id: 'o3-deep-research',
    name: 'OpenAI Deep Research',
    vendor: 'OpenAI',
    category: 'research',
    description: '适合需要多来源查证和长链路分析的研究任务。',
    tags: ['多来源', '查证', '深度分析'],
    accent: 'violet',
  },
  {
    id: 'gemini-2.5-pro-deepsearch',
    name: 'Gemini 2.5 Deep Research',
    vendor: 'Google',
    category: 'research',
    description: '稳定的深度搜索与长文档研究能力。',
    tags: ['深度搜索', '长文档', '研究'],
    accent: 'green',
  },
];

const CURATED_MODEL_MAP = new Map(
  CURATED_MODELS.map((model) => [model.id.toLowerCase(), model])
);

const NON_CONSUMER_PATTERNS = [
  /embedding/,
  /moderation/,
  /transcrib/,
  /^whisper-/,
  /^tts-/,
  /^text-(ada|babbage|curie|davinci)/,
  /^search($|-gpts)/,
  /^url-analysis$/,
  /^get-gizmo/,
  /^avatar$/,
  /^api-/,
  /^chat-/,
  /^mj_/,
  /^suno_(?!music$)/,
  /^kling_(effects|extend|lip_sync|virtual_try_on)$/,
];

const CATEGORY_ACCENTS: Record<
  Exclude<MarketplaceCategory, 'featured'>,
  MarketplaceModel['accent']
> = {
  image: 'violet',
  video: 'cyan',
  audio: 'rose',
  text: 'green',
  research: 'amber',
};

export const marketplaceCategoryLabels: Record<MarketplaceCategory, string> = {
  featured: '精选',
  image: '生图',
  video: '视频',
  audio: '音乐',
  text: '文本',
  research: '研究',
};

export function isConsumerModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  return (
    normalized.length > 0 &&
    !NON_CONSUMER_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

function inferCategory(
  modelId: string
): Exclude<MarketplaceCategory, 'featured'> {
  const id = modelId.toLowerCase();
  if (/deep.?research|deepsearch|research/.test(id)) return 'research';
  if (/suno|udio|music|audio/.test(id)) return 'audio';
  if (/seedance|sora|veo|kling.*video|runway|pika|video/.test(id)) {
    return 'video';
  }
  if (
    /image|banana|seedream|seededit|flux|midjourney|^mj-|dall-e|playground|stable-diffusion|^sd3|qwen-image/.test(
      id
    )
  ) {
    return 'image';
  }
  return 'text';
}

function inferVendor(modelId: string): string {
  const id = modelId.toLowerCase();
  if (/gpt|dall-e|^o[134]-|sora/.test(id)) return 'OpenAI';
  if (/gemini|banana|veo/.test(id)) return 'Google';
  if (/claude/.test(id)) return 'Anthropic';
  if (/deepseek/.test(id)) return 'DeepSeek';
  if (/seedance|seedream|doubao/.test(id)) return 'ByteDance';
  if (/qwen|qwq/.test(id)) return 'Qwen';
  if (/grok/.test(id)) return 'xAI';
  if (/suno/.test(id)) return 'Suno';
  if (/udio/.test(id)) return 'Udio';
  if (/kling/.test(id)) return 'Kling';
  if (/flux|bfl-/.test(id)) return 'Black Forest Labs';
  if (/midjourney|^mj-/.test(id)) return 'Midjourney';
  if (/runway/.test(id)) return 'Runway';
  if (/glm|chatglm/.test(id)) return 'Zhipu';
  if (/kimi|moonshot/.test(id)) return 'Moonshot';
  return '狐图精选';
}

function formatModelName(modelId: string): string {
  return modelId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) =>
      /^(gpt|glm|veo|sora|udio|qwen|flux|ai)$/i.test(part)
        ? part.toUpperCase()
        : `${part.charAt(0).toUpperCase()}${part.slice(1)}`
    )
    .join(' ');
}

function inferModel(modelId: string): MarketplaceModel {
  const category = inferCategory(modelId);
  const vendor = inferVendor(modelId);
  const categoryLabel = marketplaceCategoryLabels[category];
  return {
    id: modelId,
    name: formatModelName(modelId),
    vendor,
    category,
    description: `${vendor} 提供的${categoryLabel}模型，已由平台管理员开放使用。`,
    tags: [categoryLabel, vendor, '平台可用'],
    accent: CATEGORY_ACCENTS[category],
  };
}

export function adaptPublishedModelIds(modelIds: string[]): MarketplaceModel[] {
  const seen = new Set<string>();
  return modelIds.flatMap((rawId) => {
    const id = rawId.trim();
    const key = id.toLowerCase();
    if (!isConsumerModelId(id) || seen.has(key)) return [];
    seen.add(key);
    return [{ ...(CURATED_MODEL_MAP.get(key) || inferModel(id)) }];
  });
}

export function getMarketplaceModel(modelId: string | null | undefined): MarketplaceModel | undefined {
  if (!modelId) return undefined;
  const key = modelId.trim().toLowerCase();
  return CURATED_MODEL_MAP.get(key) || (isConsumerModelId(modelId) ? inferModel(modelId) : undefined);
}

function readDefaultOptions(): Required<Pick<CatalogLoadOptions, 'embedded'>> &
  Pick<CatalogLoadOptions, 'apiBaseUrl' | 'serverCatalog'> {
  const env = import.meta.env as Record<string, string | undefined>;
  return {
    embedded:
      String(env.VITE_TUZI_EMBEDDED_MODE || '').toLowerCase() === 'true',
    apiBaseUrl: env.VITE_TUZI_API_BASE_URL || null,
    serverCatalog:
      String(env.VITE_OPENTU_SERVER_CATALOG || '').toLowerCase() === 'true' ||
      String(env.VITE_TUZI_EMBEDDED_MODE || '').toLowerCase() === 'true',
  };
}

function parsePublishedModelIds(payload: unknown): string[] | null {
  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  const data = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.data)
    ? record.data
    : null;
  if (!data) return null;
  return data.filter((item): item is string => typeof item === 'string');
}

export async function loadMarketplaceCatalog(
  options: CatalogLoadOptions = {}
): Promise<MarketplaceCatalog> {
  const defaults = readDefaultOptions();
  const embedded = options.embedded ?? defaults.embedded;
  const apiBaseUrl = options.apiBaseUrl ?? defaults.apiBaseUrl;
  const serverCatalog = options.serverCatalog ?? defaults.serverCatalog;
  const fetcher = options.fetcher || fetch;

  if (serverCatalog) {
    try {
      const response = await fetcher('/api/catalog/models', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as unknown;
      const record =
        payload && typeof payload === 'object' && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : null;
      const data = Array.isArray(record?.data) ? record.data : [];
      const models = data.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const model = item as Partial<MarketplaceModel>;
        if (
          typeof model.id !== 'string' ||
          typeof model.name !== 'string' ||
          typeof model.vendor !== 'string' ||
          !['image', 'video', 'audio', 'text', 'research'].includes(
            String(model.category)
          )
        ) {
          return [];
        }
        return [
          {
            id: model.id,
            name: model.name,
            vendor: model.vendor,
            category: model.category as MarketplaceModel['category'],
            description:
              typeof model.description === 'string' ? model.description : '',
            tags: Array.isArray(model.tags)
              ? model.tags.filter((tag): tag is string => typeof tag === 'string')
              : [],
            accent:
              ['violet', 'cyan', 'rose', 'green', 'amber'].includes(
                String(model.accent)
              )
                ? (model.accent as MarketplaceModel['accent'])
                : 'cyan',
          },
        ];
      });
      return { models, source: 'managed' };
    } catch (error) {
      console.warn('[ModelMarketplace] Server catalog unavailable:', error);
      if (!import.meta.env.DEV) return { models: [], source: 'managed' };
    }
  }

  if (embedded && apiBaseUrl) {
    try {
      const baseUrl = new URL(apiBaseUrl);
      if (baseUrl.protocol !== 'https:' && baseUrl.protocol !== 'http:') {
        throw new Error('Unsupported model catalog origin');
      }
      const url = new URL('/api/user/models', baseUrl);
      const response = await fetcher(url.toString(), {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const modelIds = parsePublishedModelIds(await response.json());
      if (!modelIds) throw new Error('Invalid model catalog response');
      return {
        models: adaptPublishedModelIds(modelIds),
        source: 'managed',
      };
    } catch (error) {
      console.warn('[ModelMarketplace] Falling back to curated catalog:', error);
    }
  }

  return {
    models: CURATED_MODELS.map((model) => ({ ...model, tags: [...model.tags] })),
    source: 'curated',
  };
}
